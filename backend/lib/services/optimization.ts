/**
 * Optimization service.
 *
 * Responsibilities, in order:
 *   1. Load the factory's machines, processes, dependencies, orders, energy
 *      data and tariffs.
 *   2. Assemble a generic `OptimizationProblem` (lib/optimizer/payload.ts).
 *   3. Hand it to the optimizer adapter (lib/optimizer/client.ts).
 *   4. Record the outcome against the optimization_requests row.
 *
 * When the optimizer is not configured, step 3 throws a 503 and this service
 * records the request as `not_configured` with the payload it WOULD have sent.
 * No schedule, result or cost figure is ever synthesised here.
 */

import { randomUUID } from 'node:crypto'
import { InternalError, ServiceUnavailableError, ValidationError } from '../errors'
import {
  createOptimizerTransport,
  isOptimizerConfigured,
  optimizerUnavailableReason,
  readOptimizerConfig,
} from '../optimizer/client'
import { buildOptimizationProblem } from '../optimizer/payload'
import type { OptimizationProblem, OptimizationSolution } from '../optimizer/contract'
import { buildOptimizationScheduleWrites } from '../optimizer/scheduleMapping'
import { energyTimeWindow } from '../repositories/energy-data'
import { listTariffsForHorizon } from '../repositories/electricity-tariffs'
import { machinesRepository } from '../repositories/machines'
import {
  attachRequestPayload,
  getResultForRequest,
  optimizationRequestsRepository,
  optimizationResultsRepository,
} from '../repositories/optimization'
import { processDependenciesRepository, processesRepository } from '../repositories/processes'
import { productionOrdersRepository } from '../repositories/production-orders'
import { energyDataRepository, listEnergyData } from '../repositories/energy-data'
import { persistOptimizationSchedules } from '../repositories/schedules'
import type { PersistedOptimizationSchedule } from '../repositories/schedules'
import type {
  OptimizationRequestCreate,
  OptimizationRequestRow,
} from '../schemas/optimization'
import type { ListResult } from '../repositories/types'
import { requireFactory } from './factories'

/**
 * Page size used when draining a factory's rows for the optimizer.
 *
 * Not a cap — `drainAll` keeps paging until the database reports no more rows.
 * It exists only so a large factory does not arrive as one enormous response.
 */
const LOAD_PAGE_SIZE = 1_000

/**
 * Ceiling on the readings included in one problem document.
 *
 * This is a genuine safety limit rather than a silent one: if a horizon
 * contains more readings than this, the request is REJECTED with an
 * explanation, because a truncated energy history is not a smaller problem,
 * it is a wrong one. The optimizer would plan against a factory that appears to
 * have no consumption in the omitted window and could return a schedule that is
 * cheap precisely because it assumed the missing data.
 *
 * Reaching it requires a horizon holding more than this many readings — at
 * 15-minute intervals, roughly a year and a half. The caller narrows the
 * horizon; they are not given a quietly shortened problem.
 */
const MAX_ENERGY_INTERVALS = 50_000

/**
 * Loads every matching row for the optimizer, paging until exhausted.
 *
 * The previous code passed a single hard `limit` per entity (1,000 machines,
 * 2,000 processes, 5,000 dependencies, 2,000 orders, 2,000 readings) and used
 * whatever came back. Nothing reported the omission, and the problem document
 * has no field in which to report it — so a factory with 1,001 processes was
 * described to the optimizer as a factory with 1,000. The resulting schedule
 * would be internally consistent and operationally wrong, which is the hardest
 * kind of defect to notice.
 *
 * `describe` names the entity in the guard's error message, so an oversized
 * factory is told which one is too big.
 */
async function drainAll<Row>(
  load: (limit: number, offset: number) => Promise<ListResult<Row>>,
  describe: string,
  maxRows = Number.POSITIVE_INFINITY,
): Promise<Row[]> {
  const rows: Row[] = []

  for (let offset = 0; ; offset += LOAD_PAGE_SIZE) {
    const page = await load(LOAD_PAGE_SIZE, offset)
    rows.push(...page.rows)

    // The exact count is known after the FIRST page, so an oversized set is
    // rejected before it is loaded rather than after. Checking only after the
    // rows are in hand would be too late: the loop would finish normally and the
    // oversized request would sail through.
    if (page.total !== null) {
      if (page.total > maxRows) {
        throw new ValidationError(
          `This horizon contains more than ${maxRows} ${describe}, which is too much to load in one ` +
            `optimization request. Narrow horizon_start / horizon_end, or split the work into ` +
            `several requests.`,
          { resource: describe, matching_rows: page.total, limit: maxRows },
        )
      }
      // Termination driven by the database, so an exactly-full last page does
      // not cause one extra empty round trip.
      if (rows.length >= page.total) break
    } else if (page.rows.length < LOAD_PAGE_SIZE) {
      break
    }

    // A page that returns nothing cannot make progress; without this an
    // infinite loop is possible if a count ever overstated the rows available.
    if (page.rows.length === 0) break
  }

  return rows
}

/**
 * Loads everything the optimizer needs and assembles the problem document.
 *
 * @param factoryId factory to schedule.
 * @param request the request body, already validated.
 * @param requestReference correlation id used inside the problem document.
 */
export async function buildProblem(
  factoryId: string,
  request: Pick<
    OptimizationRequestCreate,
    'horizon_start' | 'horizon_end' | 'objective' | 'constraints' | 'created_by'
  >,
  requestReference: string,
): Promise<{ problem: OptimizationProblem; request: OptimizationRequestRow }> {
  const factory = await requireFactory(factoryId)

  // Default the horizon to the window covered by stored energy data rather than
  // inventing one. If there is no energy data and the caller gave no horizon,
  // the caller is told to supply one.
  const energyWindow = await energyTimeWindow(factoryId)

  const horizonStart = request.horizon_start ?? energyWindow.from
  const horizonEnd = request.horizon_end ?? energyWindow.to

  if (!horizonStart || !horizonEnd) {
    throw new ValidationError(
      'Cannot determine a scheduling horizon: no horizon was supplied and the factory has no energy data to derive one from.',
      { factory_id: factoryId, hint: 'Provide horizon_start and horizon_end, or ingest energy data first.' },
    )
  }

  if (new Date(horizonStart) >= new Date(horizonEnd)) {
    throw new ValidationError('horizon_end must be after horizon_start', {
      horizon_start: horizonStart,
      horizon_end: horizonEnd,
    })
  }

  // Every entity is drained completely rather than capped. The problem document
  // has no field in which to record "this was truncated", so a cap here would be
  // indistinguishable from a factory that genuinely is that size.
  const [machineRows, processRows, dependencyRows, productionOrderRows, energyRows, tariffs] =
    await Promise.all([
      drainAll(
        (limit, offset) => machinesRepository.list(factoryId, { limit, offset }),
        'machines',
      ),
      drainAll(
        (limit, offset) => processesRepository.list(factoryId, { limit, offset }),
        'processes',
      ),
      drainAll(
        (limit, offset) => processDependenciesRepository.list(factoryId, { limit, offset }),
        'process dependencies',
      ),
      drainAll(
        (limit, offset) => productionOrdersRepository.list(factoryId, { limit, offset }),
        'production orders',
      ),
      drainAll(
        (limit, offset) =>
          listEnergyData(
            factoryId,
            { limit, offset, sortColumn: 'recorded_at', sortAscending: true },
            { from: horizonStart, to: horizonEnd },
          ),
        'energy readings',
        // The one place a bound is appropriate, and it fails loudly instead of
        // sending a partial history.
        MAX_ENERGY_INTERVALS,
      ),
      listTariffsForHorizon(factoryId, horizonStart, horizonEnd),
    ])

  const machines = { rows: machineRows }
  const processes = { rows: processRows }
  const dependencies = { rows: dependencyRows }
  const productionOrders = { rows: productionOrderRows }
  const energyData = { rows: energyRows }

  // Only orders that could still be scheduled belong in the problem.
  const openOrders = productionOrders.rows.filter((order) => order.status !== 'cancelled')

  const problem = buildOptimizationProblem({
    factory,
    machines: machines.rows,
    processes: processes.rows,
    dependencies: dependencies.rows,
    productionOrders: openOrders,
    energyData: energyData.rows,
    tariffs,
    requestReference,
    horizonStart,
    horizonEnd,
    objective: request.objective,
    constraints: request.constraints,
  })

  const optimizationRequest = await optimizationRequestsRepository.create(factoryId, {
    reference: requestReference,
    horizon_start: horizonStart,
    horizon_end: horizonEnd,
    objective: request.objective ?? {},
    constraints: request.constraints ?? {},
    status: 'pending',
    created_by: request.created_by ?? null,
    error_message: null,
    adapter_metadata: null,
    request_payload: null,
  })

  // Store the exact document so the run is reproducible and auditable.
  const withPayload = await attachRequestPayload(factoryId, optimizationRequest.id, problem)

  return { problem, request: withPayload }
}

export interface RunOptimizationResult {
  request: OptimizationRequestRow
  /** Present only when a real optimizer produced a solution. */
  solution: OptimizationSolution | null
  /** Draft schedules created atomically after the result was audited. */
  schedules: PersistedOptimizationSchedule[]
}

/**
 * Builds a problem and submits it to the optimizer.
 *
 * Behaviour:
 *   - `dry_run: true` returns the problem document without contacting anything.
 *   - optimizer unconfigured: records the request as `not_configured` and
 *     throws 503 with the reason and the payload it would have sent.
 *   - optimizer configured: stores whatever it returns and records `succeeded`
 *     or `failed`. A failed run is recorded as failed, never padded out.
 */
export async function runOptimization(
  factoryId: string,
  request: OptimizationRequestCreate,
): Promise<RunOptimizationResult> {
  const reference = request.reference ?? `req-${randomUUID()}`
  const { problem, request: optimizationRequest } = await buildProblem(factoryId, request, reference)

  if (request.dry_run) {
    const updated = await optimizationRequestsRepository.update(factoryId, optimizationRequest.id, {
      status: 'succeeded',
      adapter_metadata: {
        adapter: 'dry-run',
        note: 'Payload built without contacting the optimizer. No solution was produced.',
      } as Record<string, unknown>,
    })

    return { request: updated, solution: null, schedules: [] }
  }

  const config = readOptimizerConfig()
  const transport = createOptimizerTransport()

  if (!transport.isConfigured) {
    const reason = optimizerUnavailableReason(config)

    await optimizationRequestsRepository.update(factoryId, optimizationRequest.id, {
      status: 'not_configured',
      error_message: reason ?? 'The optimizer integration is incomplete.',
    })

    // 503, with the payload attached so the integration can be developed
    // against a real problem document.
    throw new ServiceUnavailableError(
      'The optimizer is not configured, so no schedule was produced.',
      {
        reason: reason ?? 'The optimizer integration is incomplete.',
        optimization_request_id: optimizationRequest.id,
        reference,
        payload_would_be_sent: problem,
      },
    )
  }

  await optimizationRequestsRepository.update(factoryId, optimizationRequest.id, { status: 'running' })

  let solution: OptimizationSolution
  try {
    solution = await transport.solve(problem)
  } catch (error) {
    await optimizationRequestsRepository.update(factoryId, optimizationRequest.id, {
      status: 'failed',
      error_message: error instanceof Error ? error.message : String(error),
    })
    throw error
  }

  const result = await optimizationResultsRepository.create(factoryId, {
    optimization_request_id: optimizationRequest.id,
    status: 'succeeded',
    objective_value: solution.objectiveValue,
    total_energy_cost: solution.totalEnergyCost,
    total_energy_kwh: solution.totalEnergyKwh,
    peak_demand_kw: solution.peakDemandKw,
    solution: solution.raw,
    metrics: solution.metrics,
  })

  try {
    const scheduleWrites = buildOptimizationScheduleWrites(problem, solution)
    const persisted = await persistOptimizationSchedules(
      factoryId,
      optimizationRequest.id,
      result.id,
      transport.name,
      scheduleWrites,
    )
    return { request: persisted.request, solution, schedules: persisted.schedules }
  } catch (error) {
    const failureMessage = `Schedule persistence failed after optimizer result ${result.id} was retained.`
    try {
      await optimizationRequestsRepository.update(factoryId, optimizationRequest.id, {
        status: 'failed',
        error_message: failureMessage,
        adapter_metadata: {
          adapter: transport.name,
          optimization_result_id: result.id,
          schedule_persistence_status: 'failed',
        },
      })
    } catch (recordError) {
      throw new InternalError(
        'Schedule persistence failed after the optimizer result was retained, and the request failure could not be recorded.',
        {
          optimization_request_id: optimizationRequest.id,
          optimization_result_id: result.id,
          schedule_persistence_status: 'failed',
        },
        recordError,
      )
    }
    throw new InternalError(failureMessage, {
      optimization_request_id: optimizationRequest.id,
      optimization_result_id: result.id,
      schedule_persistence_status: 'failed',
    }, error)
  }
}

/** Optimizer readiness, surfaced by the health endpoint and factory summary. */
export function optimizerStatus(): { configured: boolean; reason: string | null } {
  const config = readOptimizerConfig()
  return { configured: isOptimizerConfigured(config), reason: optimizerUnavailableReason(config) }
}

/** The stored result for a request, or null when the optimizer has not run. */
export async function resultForRequest(
  factoryId: string,
  requestId: string,
): Promise<ReturnType<typeof getResultForRequest>> {
  return getResultForRequest(factoryId, requestId)
}