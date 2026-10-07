import { ValidationError } from '../errors'
import type { OptimizationProblem, ProblemTariff } from './contract'

export interface PythonOptimizerRequest {
  factory: {
    factory_id: string
    factory_name: string
    planning_horizon_hours: number
    production_deadline: number
    processes: Array<Record<string, unknown>>
    machines: Array<Record<string, unknown>>
  }
  energy: {
    solar_profile: Record<string, number>
    tariff_profile: Record<string, number>
  }
  options: {
    objective: 'cost' | 'solar'
  }
}

const HOUR_MS = 60 * 60 * 1000
const QUARTER_HOUR_MS = 15 * 60 * 1000
const SOLAR_POWER_SCALE = 5

function problem(message: string, details?: unknown): never {
  throw new ValidationError(`Cannot map backend optimization problem to Python API v2: ${message}`, details)
}

function finite(value: number | null, field: string): number {
  if (value === null || !Number.isFinite(value)) problem(`${field} must be a finite number.`)
  return value
}

function closeToInteger(value: number): boolean {
  return Math.abs(value - Math.round(value)) < 1e-8
}

function buildSolarProfile(
  problemDocument: OptimizationProblem,
  start: number,
  horizonHours: number,
): Record<string, number> {
  const horizonEnd = start + horizonHours * HOUR_MS
  const byStart = new Map<number, typeof problemDocument.energyData[number]>()
  let previousTimestamp = Number.NEGATIVE_INFINITY

  for (const interval of problemDocument.energyData) {
    const at = Date.parse(interval.recordedAt)
    if (!Number.isFinite(at)) {
      problem('solar interval timestamps must be valid ISO timestamps.')
    }
    if (at <= previousTimestamp) {
      problem(at === previousTimestamp
        ? 'solar input contains duplicate interval timestamps.'
        : 'solar intervals must be provided in chronological order.')
    }
    previousTimestamp = at
    if (at < start || at >= horizonEnd) continue
    if (interval.intervalMinutes !== 15 ||
      (interval.machineId !== null && interval.generationKwh !== 0)) {
      problem('solar input must consist of site-level 15-minute intervals.')
    }
    if ((at - start) % QUARTER_HOUR_MS !== 0) {
      problem('solar interval timestamps must align to the 15-minute grid from the horizon start.')
    }
    if (byStart.has(at)) problem('solar input contains duplicate interval timestamps.')
    byStart.set(at, interval)
  }

  const profile: Record<string, number> = {}
  for (let hour = 0; hour < horizonHours; hour += 1) {
    let generationKwh = 0
    for (let quarter = 0; quarter < 4; quarter += 1) {
      const at = start + hour * HOUR_MS + quarter * QUARTER_HOUR_MS
      const interval = byStart.get(at)
      if (!interval) {
        problem(`solar input is missing the 15-minute interval at ${new Date(at).toISOString()}.`)
      }
      const generation = finite(interval.generationKwh, 'generation_kwh')
      generationKwh += generation
    }
    if (!closeToInteger(generationKwh * SOLAR_POWER_SCALE)) {
      problem(`hour ${hour} solar generation is not representable at the optimizer's 0.2 kW precision.`)
    }
    profile[String(hour)] = generationKwh
  }
  return profile
}

function parseClock(value: string, field: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.\d+)?)?$/.exec(value)
  if (!match) problem(`${field} has an unsupported time format.`)
  const [, hourText, minuteText, secondText] = match
  if (secondText && Number(secondText) !== 0) problem(`${field} must be on an exact minute boundary.`)
  return Number(hourText) * 60 + Number(minuteText)
}

function localClock(at: number, timeZone: string): { day: number; minute: number } {
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(at)
  } catch {
    return problem(`factory timezone '${timeZone}' is not a supported IANA timezone.`)
  }
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  const weekdays: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }
  const day = weekdays[values.weekday ?? '']
  if (!day || !values.hour || !values.minute) problem('could not resolve a local tariff time.')
  return { day, minute: Number(values.hour) * 60 + Number(values.minute) }
}

function tariffApplies(tariff: ProblemTariff, at: number, timeZone: string): boolean {
  if (tariff.effectiveFrom && at < Date.parse(tariff.effectiveFrom)) return false
  if (tariff.effectiveTo && at >= Date.parse(tariff.effectiveTo)) return false

  const { day, minute } = localClock(at, timeZone)
  if (tariff.daysOfWeek && !tariff.daysOfWeek.includes(day)) return false
  const start = parseClock(tariff.startTime, `tariff '${tariff.slug}' start_time`)
  const end = parseClock(tariff.endTime, `tariff '${tariff.slug}' end_time`)
  return start < end ? minute >= start && minute < end : minute >= start || minute < end
}

function buildTariffProfile(
  problemDocument: OptimizationProblem,
  start: number,
  horizonHours: number,
): Record<string, number> {
  const { factory, tariffs } = problemDocument
  const profile: Record<string, number> = {}
  const warnings = new Set<string>()

  for (const tariff of tariffs) {
    if ((tariff.demandChargePerKw ?? 0) > 0 || (tariff.fixedCharge ?? 0) > 0) {
      warnings.add('Demand and fixed charges are present in backend tariffs but are not optimized by the Python engine.')
    }
    if ((tariff.taxRate ?? 0) > 0) {
      warnings.add('Tariff taxes are present in backend data but are not included in Python energy-cost optimization.')
    }
  }

  for (let hour = 0; hour < horizonHours; hour += 1) {
    const at = start + hour * HOUR_MS
    const active = tariffs.filter((tariff) => {
      const demandOnly = tariff.energyPricePerKwh === 0 &&
        ((tariff.demandChargePerKw ?? 0) > 0 || (tariff.fixedCharge ?? 0) > 0)
      return !demandOnly && tariffApplies(tariff, at, factory.timezone)
    })
    if (active.some((tariff) => tariff.currency !== factory.currency)) {
      problem(`applicable tariff currency must match factory currency '${factory.currency}'.`)
    }
    if (active.length === 0) {
      problem(`no energy tariff applies at ${new Date(at).toISOString()}.`)
    }
    const priority = Math.max(...active.map((tariff) => tariff.priority))
    const highest = active.filter((tariff) => tariff.priority === priority)
    if (highest.length !== 1) {
      problem(`tariff priority is ambiguous at ${new Date(at).toISOString()}.`)
    }
    profile[String(hour)] = finite(highest[0]?.energyPricePerKwh ?? null, 'energy_price_per_kwh')
  }
  return profile
}

export function buildPythonOptimizerRequest(problemDocument: OptimizationProblem): {
  request: PythonOptimizerRequest
  integrationWarnings: string[]
} {
  const { horizon, factory, processes, machines, dependencies } = problemDocument
  if (!horizon.start || !horizon.end) problem('both horizon timestamps are required.')
  const start = Date.parse(horizon.start)
  const end = Date.parse(horizon.end)
  const horizonHours = (end - start) / HOUR_MS
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    !Number.isSafeInteger(horizonHours) ||
    horizonHours < 24 ||
    start % HOUR_MS !== 0
  ) {
    problem('the Python profile contract requires a horizon of at least 24 whole hours aligned to a UTC hour.')
  }

  const objectiveKeys = Object.keys(problemDocument.objective)
  let objective: 'cost' | 'solar' = 'cost'
  if (objectiveKeys.length === 1 && problemDocument.objective.objective === 'solar') objective = 'solar'
  else if (
    objectiveKeys.length === 1 &&
    (problemDocument.objective.objective === 'cost' || problemDocument.objective.cost === 1)
  ) objective = 'cost'
  else if (objectiveKeys.length > 0) {
    problem('objective must be empty, { objective: "cost" | "solar" }, or { cost: 1 }.')
  }
  if (Object.keys(problemDocument.constraints).length > 0) {
    problem('the current Python adapter cannot represent caller-supplied backend constraints without changing their meaning.')
  }

  const processIds = new Set(processes.map((process) => process.id))
  const dependenciesByProcess = new Map<string, string[]>()
  const unsupportedDependencies = dependencies.filter((edge) =>
    edge.dependencyType !== 'finish_to_start' || edge.lagMinutes !== 0,
  )
  if (unsupportedDependencies.length > 0) {
    problem('only finish_to_start dependencies with zero lag are supported by the current Python contract.')
  }
  for (const edge of dependencies) {
    if (!processIds.has(edge.processId) || !processIds.has(edge.dependsOnProcessId)) {
      problem('a dependency references a process outside this optimization problem.')
    }
    const required = dependenciesByProcess.get(edge.processId) ?? []
    required.push(edge.dependsOnProcessId)
    dependenciesByProcess.set(edge.processId, required)
  }

  const pythonProcesses = processes.map((process) => {
    const duration = finite(process.durationMinutes, `process '${process.slug}' duration_minutes`)
    const power = finite(process.powerRequirementKw, `process '${process.slug}' power_requirement_kw`)
    if (duration <= 0 || !Number.isSafeInteger(duration)) {
      problem(`process '${process.slug}' duration_minutes must be a positive whole number of minutes.`)
    }
    if (power < 0 || !closeToInteger(power * 5)) {
      problem(`process '${process.slug}' power_requirement_kw must be representable at 0.2 kW precision.`)
    }
    return {
      process_id: process.id,
      process_name: process.name,
      duration_hours: duration / 60,
      power_kw: power,
      quantity: process.productionQuantity,
      quantity_unit: process.unit,
      dependencies: dependenciesByProcess.get(process.id) ?? [],
      machine_id: process.machineId,
    }
  })

  const pythonMachines = machines.map((machine) => ({
    machine_id: machine.id,
    machine_name: machine.name,
    availability: JSON.stringify(machine.availability),
  }))

  const integrationWarnings = [
    'Python does not enforce the backend machine availability calendars; they are passed as informational values only.',
    'Python defaults processes to flexible and machine capacity to one because the backend schema has no corresponding fields.',
    'Production orders have no process relationship in the backend and are not assigned to scheduled processes.',
    'Energy-cost results exclude tariff demand charges, fixed charges, and taxes.',
    'Backend consumption readings are retained but are not used as process energy; optimizer energy derives from process power and duration.',
  ]
  if (factory.config.scheduling) {
    integrationWarnings.push('Factory scheduling configuration is not enforced unless explicitly represented by the supported optimizer contract.')
  }

  return {
    request: {
      factory: {
        factory_id: problemDocument.factoryId,
        factory_name: factory.name,
        planning_horizon_hours: horizonHours,
        production_deadline: horizonHours,
        processes: pythonProcesses,
        machines: pythonMachines,
      },
      energy: {
        solar_profile: buildSolarProfile(problemDocument, start, horizonHours),
        tariff_profile: buildTariffProfile(problemDocument, start, horizonHours),
      },
      options: { objective },
    },
    integrationWarnings,
  }
}
