/**
 * Optimizer adapter.
 *
 * This is the only module that talks to the Python optimizer, and it talks to
 * it ONLY when every part of the interface has been configured explicitly.
 *
 * Nothing here invents an endpoint, a method, an auth scheme, or a response
 * shape. If any of them is missing, `isConfigured` is false, `solve` throws
 * `ServiceUnavailableError`, and the API answers 503. There is no code path
 * that returns a fabricated schedule or result.
 *
 * TO WIRE UP THE REAL OPTIMIZER (once your teammate confirms the interface):
 *   1. Set BYTEME_OPTIMIZER_ENABLED=true
 *   2. Set BYTEME_OPTIMIZER_BASE_URL=https://host:port
 *   3. Set BYTEME_OPTIMIZER_SOLVE_PATH=/the-real-path   (e.g. /v1/solve)
 *   4. Set BYTEME_OPTIMIZER_SOLVE_METHOD=POST             (e.g. POST)
 *   5. Set BYTEME_OPTIMIZER_DECODER=byteme-envelope      once the response
 *      shape is confirmed, OR replace `decodeSolution` below with a decoder for
 *      the real response.
 *   6. Set BYTEME_OPTIMIZER_API_KEY if the service is authenticated.
 *
 * Steps 3-5 are required rather than defaulted on purpose: guessing them is
 * exactly the failure this adapter exists to prevent.
 */

import { z } from 'zod'
import { resolve } from 'node:path'
import { ServiceUnavailableError, UpstreamError, ValidationError } from '../errors'
import {
  OPEN_OPTIMIZER_QUESTIONS,
  type OptimizationProblem,
  type OptimizationSolution,
  type OptimizerTransport,
} from './contract'
import { PythonSubprocessOptimizerTransport } from './pythonSubprocess'

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

export interface OptimizerConfig {
  enabled: boolean
  transport?: string
  pythonExecutable?: string
  pythonWorkingDirectory?: string
  baseUrl: string
  solvePath: string
  /** Explicitly configured; never defaulted. */
  method: string
  decoder: string
  apiKey: string
  timeoutMs: number
}

/** Maximum optimizer wait (including response-body parsing), in milliseconds. */
export const MAX_OPTIMIZER_TIMEOUT_MS = 300_000

/**
 * Reads optimizer configuration from the environment.
 * Exported so `/api/v1/health` and the factories summary can report optimizer
 * status without attempting a solve.
 */
export function readOptimizerConfig(): OptimizerConfig {
  // Deliberately does not go through serverEnv(): readiness must be reportable
  // even when Supabase credentials are missing, or health would throw instead
  // of reporting a degraded database.
  // Non-numeric values fall back to the documented 60s default.
  const rawTimeout = Number(process.env.BYTEME_OPTIMIZER_TIMEOUT_MS)
  const timeoutMs =
    Number.isFinite(rawTimeout) && rawTimeout > 0 ? Math.trunc(rawTimeout) : 60_000

  return {
    enabled: process.env.BYTEME_OPTIMIZER_ENABLED === 'true',
    transport: (process.env.BYTEME_OPTIMIZER_TRANSPORT ?? 'http').trim().toLowerCase(),
    pythonExecutable: (process.env.BYTEME_OPTIMIZER_PYTHON_EXECUTABLE ?? '').trim(),
    pythonWorkingDirectory: (
      process.env.BYTEME_OPTIMIZER_PYTHON_WORKING_DIRECTORY ??
      resolve(process.cwd(), '..')
    ).trim(),
    baseUrl: (process.env.BYTEME_OPTIMIZER_BASE_URL ?? '').trim(),
    solvePath: (process.env.BYTEME_OPTIMIZER_SOLVE_PATH ?? '').trim(),
    method: (process.env.BYTEME_OPTIMIZER_SOLVE_METHOD ?? '').trim(),
    decoder: (process.env.BYTEME_OPTIMIZER_DECODER ?? '').trim(),
    apiKey: (process.env.BYTEME_OPTIMIZER_API_KEY ?? '').trim(),
    timeoutMs,
  }
}

/**
 * Why the optimizer is unusable, or `null` when it is fully configured.
 *
 * Returned verbatim in the 503 body so whoever is integrating can see exactly
 * which setting is missing.
 */
export function optimizerUnavailableReason(config: OptimizerConfig = readOptimizerConfig()): string | null {
  if (!config.enabled) {
    return 'Optimizer integration is disabled (set BYTEME_OPTIMIZER_ENABLED=true).'
  }
  if (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs < 1 || config.timeoutMs > MAX_OPTIMIZER_TIMEOUT_MS) {
    return `BYTEME_OPTIMIZER_TIMEOUT_MS must be an integer between 1 and ${MAX_OPTIMIZER_TIMEOUT_MS}.`
  }
  const transport = config.transport ?? 'http'
  if (transport !== 'http' && transport !== 'python-subprocess') {
    return 'BYTEME_OPTIMIZER_TRANSPORT must be http or python-subprocess.'
  }
  if (transport === 'python-subprocess') {
    if (!config.pythonExecutable?.trim()) {
      return 'BYTEME_OPTIMIZER_PYTHON_EXECUTABLE is not set.'
    }
    if (!config.pythonWorkingDirectory?.trim()) {
      return 'BYTEME_OPTIMIZER_PYTHON_WORKING_DIRECTORY is not set.'
    }
    return null
  }
  if (!config.baseUrl) {
    return 'BYTEME_OPTIMIZER_BASE_URL is not set.'
  }
  if (!config.solvePath) {
    return 'BYTEME_OPTIMIZER_SOLVE_PATH is not set; ByteMe will not guess the solve endpoint.'
  }
  if (!config.method) {
    return 'BYTEME_OPTIMIZER_SOLVE_METHOD is not set; ByteMe will not guess the HTTP method.'
  }
  if (!config.decoder) {
    return 'BYTEME_OPTIMIZER_DECODER is not set; ByteMe will not guess the response format.'
  }
  return null
}

/* -------------------------------------------------------------------------- */
/* Runtime contract validation                                                */
/* -------------------------------------------------------------------------- */

const nullableNumber = z.number().nullable()
const nullableNonnegativeNumber = z.number().nonnegative().nullable()
const optionalProblemTimestamp = z.string().datetime({ offset: true }).nullable()

const problemMachineSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  type: z.string().nullable(),
  ratedPowerKw: nullableNumber,
  minPowerKw: nullableNumber,
  maxPowerKw: nullableNumber,
  minRuntimeMinutes: nullableNumber,
  maxRuntimeMinutes: nullableNumber,
  availability: z.record(z.string(), z.unknown()),
  metadata: z.record(z.string(), z.unknown()),
}).strict()

const problemProcessSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  durationMinutes: nullableNumber,
  machineId: z.string().uuid(),
  powerRequirementKw: nullableNumber,
  productionQuantity: nullableNumber,
  unit: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
}).strict()

const problemDependencySchema = z.object({
  processId: z.string().uuid(),
  dependsOnProcessId: z.string().uuid(),
  dependencyType: z.string(),
  lagMinutes: z.number(),
}).strict()

const problemOrderSchema = z.object({
  id: z.string().uuid(),
  reference: z.string(),
  product: z.string().nullable(),
  quantity: z.number(),
  unit: z.string().nullable(),
  dueAt: z.string().datetime({ offset: true }).nullable(),
  priority: z.number().int(),
  status: z.string(),
  requirements: z.record(z.string(), z.unknown()),
}).strict()

const problemEnergySchema = z.object({
  recordedAt: z.string().datetime({ offset: true }),
  intervalMinutes: z.number().int(),
  consumptionKwh: z.number(),
  generationKwh: z.number(),
  machineId: z.string().uuid().nullable(),
}).strict()

const problemTariffSchema = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  name: z.string(),
  currency: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  daysOfWeek: z.array(z.number().int()).nullable(),
  energyPricePerKwh: z.number(),
  demandChargePerKw: nullableNumber,
  fixedCharge: nullableNumber,
  taxRate: nullableNumber,
  effectiveFrom: optionalProblemTimestamp,
  effectiveTo: optionalProblemTimestamp,
  priority: z.number().int(),
}).strict()

const optimizationProblemSchema = z.object({
  schemaVersion: z.string().min(1),
  requestReference: z.string().min(1),
  factoryId: z.string().uuid(),
  factory: z.object({
    slug: z.string(),
    name: z.string(),
    timezone: z.string(),
    currency: z.string(),
    config: z.record(z.string(), z.unknown()),
    metadata: z.record(z.string(), z.unknown()),
  }).strict(),
  horizon: z.object({
    start: optionalProblemTimestamp,
    end: optionalProblemTimestamp,
  }).strict().superRefine((horizon, context) => {
    if (horizon.start && horizon.end && Date.parse(horizon.start) >= Date.parse(horizon.end)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['end'], message: 'must be after start' })
    }
  }),
  machines: z.array(problemMachineSchema),
  processes: z.array(problemProcessSchema),
  dependencies: z.array(problemDependencySchema),
  productionOrders: z.array(problemOrderSchema),
  energyData: z.array(problemEnergySchema),
  tariffs: z.array(problemTariffSchema),
  objective: z.record(z.string(), z.unknown()),
  constraints: z.record(z.string(), z.unknown()),
}).strict().superRefine((problem, context) => {
  const machines = new Map(problem.machines.map((machine) => [machine.id, machine]))
  const processes = new Map(problem.processes.map((process) => [process.id, process]))

  for (const [index, process] of problem.processes.entries()) {
    if (!machines.has(process.machineId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['processes', index, 'machineId'],
        message: 'must reference a machine in this problem',
      })
    }
  }
  for (const [index, edge] of problem.dependencies.entries()) {
    if (!processes.has(edge.processId) || !processes.has(edge.dependsOnProcessId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['dependencies', index],
        message: 'must reference processes in this problem',
      })
    }
  }
  for (const [index, interval] of problem.energyData.entries()) {
    if (interval.machineId && !machines.has(interval.machineId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['energyData', index, 'machineId'],
        message: 'must reference a machine in this problem',
      })
    }
  }
  for (const [name, ids] of [
    ['machines', problem.machines.map((row) => row.id)],
    ['processes', problem.processes.map((row) => row.id)],
    ['productionOrders', problem.productionOrders.map((row) => row.id)],
  ] as const) {
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: [name], message: 'ids must be unique' })
    }
  }
})

const solutionEntrySchema = z.object({
  machineId: z.string().uuid(),
  processId: z.string().uuid(),
  productionOrderId: z.string().uuid().nullable(),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  powerKw: nullableNonnegativeNumber,
  energyKwh: nullableNonnegativeNumber,
  cost: nullableNonnegativeNumber,
  quantity: nullableNonnegativeNumber,
  sequence: z.number().int(),
  metadata: z.record(z.string(), z.unknown()),
}).superRefine((entry, context) => {
  if (Date.parse(entry.startsAt) >= Date.parse(entry.endsAt)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['endsAt'], message: 'must be after startsAt' })
  }
})

const bytemeEnvelopeSchema = z.object({
  objectiveValue: nullableNumber,
  totalEnergyCost: nullableNonnegativeNumber,
  totalEnergyKwh: nullableNonnegativeNumber,
  peakDemandKw: nullableNonnegativeNumber,
  entries: z.array(solutionEntrySchema),
  metrics: z.record(z.string(), z.unknown()),
})

function issueDetails(error: z.ZodError): { issues: Array<{ path: string; message: string }> } {
  return {
    issues: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
  }
}

/** Validates the exact existing outbound contract before any network request. */
export function validateOptimizationProblem(problem: OptimizationProblem): OptimizationProblem {
  const parsed = optimizationProblemSchema.safeParse(problem)
  if (!parsed.success) {
    throw new ValidationError('Optimization problem failed contract validation', issueDetails(parsed.error))
  }
  return parsed.data
}

/**
 * Decodes an optimizer response into an `OptimizationSolution`.
 *
 * The default decoder expects the optimizer to answer with ByteMe's own
 * envelope (snake_case JSON would also work with the mapping below). It is
 * enabled only when `BYTEME_OPTIMIZER_DECODER=byteme-envelope` is set, i.e.
 * after the response shape has actually been agreed.
 *
 * To support a different response shape, replace this function. It must throw
 * rather than return a partially-valid solution.
 */
export function decodeSolution(raw: unknown, problem?: OptimizationProblem): OptimizationSolution {
  const parsed = bytemeEnvelopeSchema.safeParse(raw)

  if (!parsed.success) {
    throw new UpstreamError(
      'Optimizer response could not be decoded into an OptimizationSolution. ' +
        'The response shape does not match BYTEME_OPTIMIZER_DECODER; update decodeSolution() in lib/optimizer/client.ts.',
      issueDetails(parsed.error),
    )
  }

  if (problem) validateSolutionReferences(parsed.data, problem)

  return {
    objectiveValue: parsed.data.objectiveValue,
    totalEnergyCost: parsed.data.totalEnergyCost,
    totalEnergyKwh: parsed.data.totalEnergyKwh,
    peakDemandKw: parsed.data.peakDemandKw,
    entries: parsed.data.entries.map((entry) => ({
      machineId: entry.machineId,
      processId: entry.processId,
      productionOrderId: entry.productionOrderId,
      startsAt: entry.startsAt,
      endsAt: entry.endsAt,
      powerKw: entry.powerKw,
      energyKwh: entry.energyKwh,
      cost: entry.cost,
      quantity: entry.quantity,
      sequence: entry.sequence,
      metadata: entry.metadata,
    })),
    metrics: parsed.data.metrics,
    raw,
  }
}

function validateSolutionReferences(
  solution: z.infer<typeof bytemeEnvelopeSchema>,
  problem: OptimizationProblem,
): void {
  const machines = new Map(problem.machines.map((machine) => [machine.id, machine]))
  const processes = new Map(problem.processes.map((process) => [process.id, process]))
  const orders = new Set(problem.productionOrders.map((order) => order.id))
  const byMachine = new Map<string, Array<{ startsAt: number; endsAt: number; index: number }>>()
  const horizonStart = problem.horizon.start ? Date.parse(problem.horizon.start) : null
  const horizonEnd = problem.horizon.end ? Date.parse(problem.horizon.end) : null
  const issues: Array<{ path: string; message: string }> = []

  solution.entries.forEach((entry, index) => {
    const path = `entries.${index}`
    const process = processes.get(entry.processId)
    if (!machines.has(entry.machineId)) {
      issues.push({ path: `${path}.machineId`, message: 'does not reference a machine in the submitted problem' })
    }
    if (!process) {
      issues.push({ path: `${path}.processId`, message: 'does not reference a process in the submitted problem' })
    } else if (process.machineId !== entry.machineId) {
      issues.push({ path: `${path}.machineId`, message: 'does not match the process machine in the submitted problem' })
    }
    if (entry.productionOrderId && !orders.has(entry.productionOrderId)) {
      issues.push({ path: `${path}.productionOrderId`, message: 'does not reference an order in the submitted problem' })
    }

    const startsAt = Date.parse(entry.startsAt)
    const endsAt = Date.parse(entry.endsAt)
    if (horizonStart !== null && startsAt < horizonStart) {
      issues.push({ path: `${path}.startsAt`, message: 'is before the submitted horizon' })
    }
    if (horizonEnd !== null && endsAt > horizonEnd) {
      issues.push({ path: `${path}.endsAt`, message: 'is after the submitted horizon' })
    }

    const intervals = byMachine.get(entry.machineId) ?? []
    intervals.push({ startsAt, endsAt, index })
    byMachine.set(entry.machineId, intervals)
  })

  for (const [machineId, intervals] of byMachine) {
    intervals.sort((left, right) => left.startsAt - right.startsAt)
    for (let index = 1; index < intervals.length; index += 1) {
      const previous = intervals[index - 1]
      const current = intervals[index]
      if (previous && current && previous.endsAt > current.startsAt) {
        issues.push({ path: `entries.${current.index}.startsAt`, message: `overlaps another entry on machine ${machineId}` })
      }
    }
  }

  if (issues.length > 0) {
    throw new UpstreamError('Optimizer response contains entries inconsistent with the submitted problem.', { issues })
  }
}

/* -------------------------------------------------------------------------- */
/* Unconfigured transport                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The transport used until a real endpoint is configured.
 *
 * `solve` always throws a 503. It is the reason ByteMe never produces a
 * fabricated schedule.
 */
export class UnconfiguredOptimizerTransport implements OptimizerTransport {
  readonly name = 'unconfigured'

  readonly isConfigured = false

  constructor(
    private readonly reason: string | null,
    private readonly requiredConfiguration = [
      'BYTEME_OPTIMIZER_ENABLED=true',
      'BYTEME_OPTIMIZER_BASE_URL',
      'BYTEME_OPTIMIZER_SOLVE_PATH',
      'BYTEME_OPTIMIZER_SOLVE_METHOD',
      'BYTEME_OPTIMIZER_DECODER',
    ],
  ) {}

  async solve(): Promise<OptimizationSolution> {
    throw new ServiceUnavailableError(
      'The optimizer is not configured, so no schedule can be produced.',
      {
        reason: this.reason ?? 'The optimizer integration is incomplete.',
        requiredConfiguration: this.requiredConfiguration,
        openQuestions: [...OPEN_OPTIMIZER_QUESTIONS],
        note: 'ByteMe does not generate a schedule without a real optimizer result.',
      },
    )
  }
}

/* -------------------------------------------------------------------------- */
/* HTTP transport                                                             */
/* -------------------------------------------------------------------------- */

/** Sends the problem document over HTTP to the configured endpoint. */
export class HttpOptimizerTransport implements OptimizerTransport {
  readonly name = 'http'

  constructor(private readonly config: OptimizerConfig) {}

  get isConfigured(): boolean {
    return true
  }

  async solve(problem: OptimizationProblem, signal?: AbortSignal): Promise<OptimizationSolution> {
    const { baseUrl, solvePath, method, apiKey, timeoutMs } = this.config
    const validatedProblem = validateOptimizationProblem(problem)
    const startedAt = Date.now()

    // Combine the caller's signal with our own timeout.
    const timeoutController = new AbortController()
    const timer = setTimeout(() => timeoutController.abort(), timeoutMs)
    const combinedSignal = signal ? AbortSignal.any([signal, timeoutController.signal]) : timeoutController.signal

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json',
    }
    if (apiKey) headers.authorization = `Bearer ${apiKey}`

    try {
      const response = await fetch(new URL(solvePath, baseUrl), {
        method: method.toUpperCase(),
        headers,
        body: JSON.stringify(validatedProblem),
        signal: combinedSignal,
      })

      if (!response.ok) {
        // Do not return upstream response text: it may contain credentials,
        // stack traces, or sensitive request data. The HTTP status is enough
        // to diagnose this boundary without expanding the public API contract.
        try {
          await response.body?.cancel()
        } catch {
          // The response status already determines the safe client error.
        }
        throw new UpstreamError(`Optimizer responded with HTTP ${response.status}.`, {
          status: response.status,
        })
      }

      let raw: unknown
      try {
        raw = await response.json()
      } catch (error) {
        if (timeoutController.signal.aborted || signal?.aborted) throw error
        throw new UpstreamError('Optimizer response was not valid JSON.')
      }

      const solution = decodeSolution(raw, validatedProblem)
      if (timeoutController.signal.aborted || Date.now() - startedAt >= timeoutMs) {
        throw new UpstreamError('Optimizer request timed out.', { reason: 'timeout' })
      }
      if (signal?.aborted) throw new UpstreamError('Optimizer request was cancelled.', { reason: 'cancelled' })
      return solution
    } catch (error) {
      if (timeoutController.signal.aborted || Date.now() - startedAt >= timeoutMs) {
        throw new UpstreamError('Optimizer request timed out.', { reason: 'timeout' })
      }
      if (signal?.aborted) {
        throw new UpstreamError('Optimizer request was cancelled.', { reason: 'cancelled' })
      }
      if (error instanceof UpstreamError) throw error
      throw new UpstreamError('Failed to reach the optimizer service.', { reason: 'unavailable' })
    } finally {
      // Keep the deadline active through response-body consumption and decoding,
      // not just until the server sends response headers.
      clearTimeout(timer)
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Factory                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Returns the transport to use for this deployment.
 *
 * Yields `UnconfiguredOptimizerTransport` unless every required setting is
 * present, which is what turns optimization endpoints into a clean 503 instead
 * of a guessed request.
 */
export function createOptimizerTransport(): OptimizerTransport {
  const config = readOptimizerConfig()
  const reason = optimizerUnavailableReason(config)

  if (reason) {
    const requiredConfiguration = config.transport === 'python-subprocess'
      ? [
          'BYTEME_OPTIMIZER_ENABLED=true',
          'BYTEME_OPTIMIZER_PYTHON_EXECUTABLE',
          'BYTEME_OPTIMIZER_PYTHON_WORKING_DIRECTORY',
        ]
      : undefined
    return new UnconfiguredOptimizerTransport(reason, requiredConfiguration)
  }
  if (config.transport === 'python-subprocess') return new PythonSubprocessOptimizerTransport(config)
  return new HttpOptimizerTransport(config)
}

/** True when a real optimizer endpoint is fully configured. */
export function isOptimizerConfigured(config: OptimizerConfig = readOptimizerConfig()): boolean {
  return optimizerUnavailableReason(config) === null
}

/**
 * Solves a problem through the configured transport.
 *
 * @throws ServiceUnavailableError when the optimizer is not configured.
 * @throws UpstreamError when the optimizer is unreachable or undecodable.
 */
export async function solve(problem: OptimizationProblem, signal?: AbortSignal): Promise<OptimizationSolution> {
  const transport = createOptimizerTransport()
  return transport.solve(problem, signal)
}