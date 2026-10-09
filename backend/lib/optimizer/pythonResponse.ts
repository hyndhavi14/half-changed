import { z } from 'zod'
import { UpstreamError } from '../errors'
import type { OptimizationProblem, OptimizationSolution, SolutionEntry } from './contract'

const solveStatus = z.enum(['OPTIMAL', 'FEASIBLE', 'INFEASIBLE', 'UNKNOWN', 'INVALID INPUT', 'ERROR'])
const processResult = z.object({
  process_id: z.string(),
  start_time: z.number().finite(),
  end_time: z.number().finite(),
  duration_hours: z.number().finite(),
  power_kw: z.number().finite(),
  machine_id: z.string().nullable(),
  quantity: z.number().finite().nullable(),
  solar_kwh: z.number().finite().nonnegative(),
  grid_kwh: z.number().finite().nonnegative(),
  energy_cost: z.number().finite().nonnegative(),
}).passthrough()
const scheduleResult = z.object({
  status: z.enum(['OPTIMAL', 'FEASIBLE']),
  makespan_hours: z.number().finite().nonnegative(),
  solve_time_seconds: z.number().finite().nonnegative().nullable().optional(),
  processes: z.array(processResult),
  energy: z.object({
    total_kwh: z.number().finite().nonnegative(),
    solar_kwh: z.number().finite().nonnegative(),
    grid_kwh: z.number().finite().nonnegative(),
  }).passthrough(),
}).passthrough()
const responseEnvelope = z.object({
  api_version: z.string(),
  status: solveStatus,
  result: z.object({
    status: solveStatus,
    optimization_scope: z.string().optional(),
    baseline: scheduleResult.nullable().optional(),
    optimized: scheduleResult.nullable().optional(),
    comparison: z.object({
      cost_optimized: z.number().finite().nonnegative().optional(),
    }).nullable().optional(),
    warnings: z.array(z.string()).nullable().optional(),
  }).passthrough().nullable(),
  errors: z.array(z.string()).nullable(),
  warnings: z.array(z.string()),
  error_category: z.string().nullable(),
}).passthrough()

function reject(message: string, details?: unknown): never {
  throw new UpstreamError(message, details)
}

function sameNumber(left: number, right: number): boolean {
  return Math.abs(left - right) < 1e-8
}

// Python reports times in hours, so a whole minute such as 7 arrives as 7/60 h.
// Multiplying back by 60 can leave binary floating-point noise (7.000000000000001),
// so a value counts as a whole minute when it is within one microminute of one.
// Genuinely fractional minutes (for example 0.01 h = 0.6 min) are still rejected.
function exactMinutes(hours: number): number | null {
  const minutes = hours * 60
  const rounded = Math.round(minutes)
  return Number.isSafeInteger(rounded) && Math.abs(minutes - rounded) < 1e-6 ? rounded : null
}

function minuteAligned(hours: number): boolean {
  return exactMinutes(hours) !== null
}

function toIso(horizonStart: number, relativeHours: number): string {
  const minutes = exactMinutes(relativeHours)
  const milliseconds = minutes === null ? Number.NaN : minutes * 60_000
  if (!Number.isSafeInteger(milliseconds) || !Number.isFinite(new Date(horizonStart + milliseconds).getTime())) {
    reject('Python schedule time cannot be represented exactly in milliseconds.')
  }
  return new Date(horizonStart + milliseconds).toISOString()
}

function mapSchedule(
  schedule: z.infer<typeof scheduleResult>,
  problem: OptimizationProblem,
  label: 'baseline' | 'optimized',
): SolutionEntry[] {
  if (!problem.horizon.start || !problem.horizon.end) {
    reject('The submitted problem has no absolute scheduling horizon.')
  }

  const horizonStart = Date.parse(problem.horizon.start)
  const horizonEnd = Date.parse(problem.horizon.end)
  const expectedProcesses = new Map(problem.processes.map((process) => [process.id, process]))
  const machineIds = new Set(problem.machines.map((machine) => machine.id))
  const seenProcesses = new Set<string>()
  const dependenciesByProcess = new Map<string, string[]>()
  for (const dependency of problem.dependencies) {
    const required = dependenciesByProcess.get(dependency.processId) ?? []
    required.push(dependency.dependsOnProcessId)
    dependenciesByProcess.set(dependency.processId, required)
  }

  const indexed = schedule.processes.map((entry, index) => {
    const process = expectedProcesses.get(entry.process_id)
    if (!process || seenProcesses.has(entry.process_id)) {
      reject(`Python ${label} schedule contains an unknown or duplicate process UUID.`, {
        process_id: entry.process_id,
      })
    }
    seenProcesses.add(entry.process_id)
    if (!entry.machine_id || !machineIds.has(entry.machine_id) || entry.machine_id !== process.machineId) {
      reject(`Python ${label} schedule machine UUID does not match the submitted process assignment.`, {
        process_id: entry.process_id,
        machine_id: entry.machine_id,
      })
    }
    const expectedDuration = (process.durationMinutes ?? 0) / 60
    if (
      entry.start_time < 0 ||
      entry.end_time > (horizonEnd - horizonStart) / 3_600_000 ||
      entry.end_time <= entry.start_time ||
      !minuteAligned(entry.start_time) ||
      !minuteAligned(entry.end_time) ||
      !sameNumber(entry.duration_hours, expectedDuration) ||
      !sameNumber(entry.end_time - entry.start_time, expectedDuration) ||
      !sameNumber(entry.power_kw, process.powerRequirementKw ?? Number.NaN) ||
      (entry.quantity !== null && !sameNumber(entry.quantity, process.productionQuantity ?? Number.NaN))
    ) {
      reject(`Python ${label} schedule interval or process values differ from the submitted problem.`, {
        process_id: entry.process_id,
      })
    }
    return { entry, process, index }
  })

  if (seenProcesses.size !== expectedProcesses.size) {
    reject(`Python ${label} schedule does not contain exactly one entry for every submitted process.`, {
      expected: expectedProcesses.size,
      actual: seenProcesses.size,
    })
  }

  const ordered = [...indexed].sort((left, right) =>
    left.entry.start_time - right.entry.start_time ||
    left.entry.end_time - right.entry.end_time ||
    left.index - right.index,
  )
  const entries: SolutionEntry[] = ordered.map(({ entry, process }, sequence) => ({
    machineId: process.machineId,
    processId: process.id,
    productionOrderId: null,
    startsAt: toIso(horizonStart, entry.start_time),
    endsAt: toIso(horizonStart, entry.end_time),
    powerKw: entry.power_kw,
    energyKwh: entry.solar_kwh + entry.grid_kwh,
    cost: entry.energy_cost,
    quantity: entry.quantity,
    sequence,
    metadata: {
      planned: true,
      solar_kwh: entry.solar_kwh,
      grid_kwh: entry.grid_kwh,
      optimizer_relative_start_hours: entry.start_time,
      optimizer_relative_end_hours: entry.end_time,
    },
  }))

  const byMachine = new Map<string, SolutionEntry[]>()
  for (const entry of entries) {
    const machineEntries = byMachine.get(entry.machineId) ?? []
    machineEntries.push(entry)
    byMachine.set(entry.machineId, machineEntries)
  }
  for (const [machineId, machineEntries] of byMachine) {
    machineEntries.sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt))
    for (let index = 1; index < machineEntries.length; index += 1) {
      const previous = machineEntries[index - 1]
      const current = machineEntries[index]
      if (previous && current && Date.parse(previous.endsAt) > Date.parse(current.startsAt)) {
        reject(`Python ${label} schedule overlaps work on a unit-capacity machine.`, { machine_id: machineId })
      }
    }
  }

  const byProcess = new Map(entries.map((entry) => [entry.processId, entry]))
  for (const [processId, dependencies] of dependenciesByProcess) {
    const current = byProcess.get(processId)
    for (const dependsOnProcessId of dependencies) {
      const prerequisite = byProcess.get(dependsOnProcessId)
      if (current && prerequisite && Date.parse(current.startsAt) < Date.parse(prerequisite.endsAt)) {
        reject(`Python ${label} schedule violates a submitted finish-to-start dependency.`, {
          process_id: processId,
          depends_on_process_id: dependsOnProcessId,
        })
      }
    }
  }
  return entries
}

export function decodePythonResponse(
  raw: unknown,
  problem: OptimizationProblem,
  integrationWarnings: string[],
): OptimizationSolution {
  const parsed = responseEnvelope.safeParse(raw)
  if (!parsed.success) {
    reject('Python optimizer response does not match public API v2.', {
      issues: parsed.error.issues.map(({ path, message }) => ({ path: path.join('.'), message })),
    })
  }

  const envelope = parsed.data
  if (envelope.api_version !== '2.0') {
    reject('Python optimizer API version is not supported.', { api_version: envelope.api_version })
  }
  if (envelope.status !== 'OPTIMAL' && envelope.status !== 'FEASIBLE') {
    reject(`Python optimizer completed with status ${envelope.status}.`, {
      optimizer_status: envelope.status,
      error_category: envelope.error_category,
      errors: envelope.errors,
      warnings: envelope.warnings,
    })
  }
  const result = envelope.result
  const optimized = result?.optimized
  if (!result || !optimized || result.status !== envelope.status || optimized.status !== envelope.status) {
    reject('Python optimizer reported success without a matching optimized schedule.', {
      optimizer_status: envelope.status,
    })
  }
  const entries = mapSchedule(optimized, problem, 'optimized')
  const baselineEntries = result.baseline ? mapSchedule(result.baseline, problem, 'baseline') : null

  const energyKwh = optimized.energy.total_kwh
  const energyCost = result.comparison?.cost_optimized ?? null
  return {
    objectiveValue: null,
    totalEnergyCost: energyCost,
    totalEnergyKwh: energyKwh,
    peakDemandKw: null,
    entries,
    baselineEntries,
    metrics: {
      api_version: envelope.api_version,
      optimizer_status: envelope.status,
      optimization_scope: result.optimization_scope ?? null,
      solve_time_seconds: optimized.solve_time_seconds ?? null,
      warnings: [...envelope.warnings, ...(result.warnings ?? [])],
      integration_warnings: integrationWarnings,
      baseline: result.baseline ?? null,
      comparison: result.comparison ?? null,
      optimized_energy: optimized.energy,
    },
    raw,
  }
}
