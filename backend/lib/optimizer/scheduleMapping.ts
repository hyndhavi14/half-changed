import { UpstreamError } from '../errors'
import { jsonObjectSchema } from '../schemas/common'
import { computeTotals } from '../repositories/schedules'
import type { OptimizationScheduleWrite } from '../repositories/schedules'
import type { OptimizationProblem, OptimizationSolution, SolutionEntry } from './contract'

const TOTALS_TOLERANCE = 1e-6

function assertMetricMatches(label: string, reported: number | null, computed: number): void {
  if (reported === null) return
  const tolerance = Math.max(TOTALS_TOLERANCE, Math.abs(reported) * 1e-9)
  if (Math.abs(reported - computed) > tolerance) {
    throw new UpstreamError(`Optimizer ${label} does not match the returned schedule entries.`, {
      reported,
      computed,
      tolerance,
    })
  }
}

function toScheduleEntry(entry: SolutionEntry) {
  return {
    machine_id: entry.machineId,
    process_id: entry.processId,
    production_order_id: entry.productionOrderId,
    starts_at: entry.startsAt,
    ends_at: entry.endsAt,
    power_kw: entry.powerKw,
    energy_kwh: entry.energyKwh,
    cost: entry.cost,
    quantity: entry.quantity,
    sequence: entry.sequence,
    metadata: jsonObjectSchema.parse(entry.metadata),
  }
}

function buildSchedule(
  kind: 'baseline' | 'optimized',
  entries: SolutionEntry[],
  problem: OptimizationProblem,
  reportedEnergy: number | null,
  reportedCost: number | null,
): OptimizationScheduleWrite {
  const { start, end } = problem.horizon
  if (!start || !end) {
    throw new UpstreamError('Cannot persist an optimizer schedule without an absolute horizon.')
  }
  const startMs = Date.parse(start)
  const endMs = Date.parse(end)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) {
    throw new UpstreamError(`Optimizer ${kind} schedule has an invalid absolute horizon.`)
  }
  const processes = new Map(problem.processes.map((process) => [process.id, process]))
  const machines = new Set(problem.machines.map((machine) => machine.id))
  const seen = new Set<string>()
  const normalized = entries.map((entry) => {
    const process = processes.get(entry.processId)
    if (!process || seen.has(entry.processId) || process.machineId !== entry.machineId || !machines.has(entry.machineId)) {
      throw new UpstreamError(`Optimizer ${kind} schedule contains invalid or duplicate canonical IDs.`, {
        process_id: entry.processId,
        machine_id: entry.machineId,
      })
    }
    seen.add(entry.processId)
    if (entry.productionOrderId !== null && !problem.productionOrders.some((order) => order.id === entry.productionOrderId)) {
      throw new UpstreamError(`Optimizer ${kind} schedule references an unknown production order.`, {
        production_order_id: entry.productionOrderId,
      })
    }
    const entryStart = Date.parse(entry.startsAt)
    const entryEnd = Date.parse(entry.endsAt)
    const expectedDurationMs = (process.durationMinutes ?? 0) * 60_000
    if (
      !Number.isFinite(entryStart) ||
      !Number.isFinite(entryEnd) ||
      entryStart < startMs ||
      entryEnd > endMs ||
      entryEnd <= entryStart ||
      entryEnd - entryStart !== expectedDurationMs
    ) {
      throw new UpstreamError(`Optimizer ${kind} schedule interval does not preserve the submitted process duration.`, {
        process_id: entry.processId,
      })
    }
    return toScheduleEntry(entry)
  })
  if (seen.size !== processes.size) {
    throw new UpstreamError(`Optimizer ${kind} schedule must contain exactly one entry per submitted process.`, {
      expected: processes.size,
      actual: seen.size,
    })
  }

  const totals = computeTotals(normalized)
  const energyKnown = normalized.every((entry) => entry.energy_kwh !== null)
  const costKnown = normalized.every((entry) => entry.cost !== null)
  const powerKnown = normalized.every((entry) => entry.power_kw !== null)
  if (!energyKnown && reportedEnergy !== null) {
    throw new UpstreamError(`Optimizer ${kind} result reports energy but an entry has unknown energy.`)
  }
  if (!costKnown && reportedCost !== null) {
    throw new UpstreamError(`Optimizer ${kind} result reports cost but an entry has unknown cost.`)
  }
  if (energyKnown) assertMetricMatches(`${kind} energy`, reportedEnergy, totals.total_energy_kwh)
  if (costKnown) assertMetricMatches(`${kind} cost`, reportedCost, totals.total_energy_cost)
  return {
    kind,
    horizon_start: new Date(startMs).toISOString(),
    horizon_end: new Date(endMs).toISOString(),
    total_energy_cost: costKnown ? totals.total_energy_cost : null,
    total_energy_kwh: energyKnown ? totals.total_energy_kwh : null,
    peak_demand_kw: powerKnown ? totals.peak_demand_kw : null,
    entries: normalized,
  }
}

export function buildOptimizationScheduleWrites(
  problem: OptimizationProblem,
  solution: OptimizationSolution,
): OptimizationScheduleWrite[] {
  const writes: OptimizationScheduleWrite[] = []
  if (solution.baselineEntries) {
    writes.push(buildSchedule('baseline', solution.baselineEntries, problem, null, null))
  }
  writes.push(buildSchedule(
    'optimized',
    solution.entries,
    problem,
    solution.totalEnergyKwh,
    solution.totalEnergyCost,
  ))
  return writes
}
