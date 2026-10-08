export interface ImpactProcess {
  id: string
  name: string
  machineId: string
  durationMinutes: number
  powerKw: number
}

export interface ImpactEntry {
  processId: string
  machineId: string
  startsAt: string
  endsAt: string
  powerKw: number
  energyKwh: number
  solarKwh: number
  gridKwh: number
  touCost: number
}

export interface SolarReading {
  recordedAt: string
  intervalMinutes: number
  generationKwh: number
  machineId: string | null
}

export interface ScheduleImpact {
  totalProcessEnergyKwh: number
  modeledSolarAllocatedKwh: number
  modeledGridImportKwh: number
  modeledTouEnergyCost: number
  modeledPeakScheduledLoadKw: number
  completionHoursFromHorizonStart: number
  solarProfileAvailableKwh: number
  unallocatedSolarProfileKwh: number
  solarProfileAllocationPercent: number
}

export interface ProcessStartShift {
  processId: string
  processName: string
  baselineStartsAt: string
  optimizedStartsAt: string
  shiftMinutes: number
}

export interface ProcessMoveComparison extends ProcessStartShift {
  baselineSolarKwh: number
  optimizedSolarKwh: number
  solarDeltaKwh: number
  baselineTouCost: number
  optimizedTouCost: number
  touCostDelta: number
}

export interface DemandShiftComparison {
  baseline: ScheduleImpact
  optimized: ScheduleImpact
  processEnergyChangeKwh: number
  modeledSolarAllocationChangeKwh: number
  modeledGridImportReductionKwh: number
  modeledTouCostReduction: number
  modeledTouCostReductionPercent: number
  modeledPeakScheduledLoadReductionKw: number
  completionTimeChangeHours: number
  processStartShifts: ProcessStartShift[]
  processMoveComparisons: ProcessMoveComparison[]
}

type JsonRecord = Record<string, unknown>

const QUARTER_HOUR_MS = 15 * 60_000
const TOLERANCE = 1e-6

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteNonnegative(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a finite, nonnegative number.`)
  }
  return value
}

function closeEnough(left: number, right: number): boolean {
  return Math.abs(left - right) <= Math.max(TOLERANCE, Math.abs(right) * 1e-9)
}

export function projectPersistedImpactEntries(
  persistedEntries: readonly JsonRecord[],
  optimizerRows: readonly unknown[],
  horizonStart: string,
): ImpactEntry[] {
  const horizonStartMs = Date.parse(horizonStart)
  if (!Number.isFinite(horizonStartMs) || persistedEntries.length !== optimizerRows.length) {
    throw new Error('Optimizer result and persisted schedule impact entries are incomplete or inconsistent.')
  }
  const optimizerByProcess = new Map<string, JsonRecord>()
  for (const value of optimizerRows) {
    if (!isRecord(value) || typeof value.process_id !== 'string' || optimizerByProcess.has(value.process_id)) {
      throw new Error('Optimizer impact result contains an invalid or duplicate process identity.')
    }
    optimizerByProcess.set(value.process_id, value)
  }

  return persistedEntries.map((entry) => {
    const processId = entry.process_id
    const optimizer = typeof processId === 'string' ? optimizerByProcess.get(processId) : undefined
    const metadata = entry.metadata
    const startsAt = Date.parse(String(entry.starts_at))
    const endsAt = Date.parse(String(entry.ends_at))
    if (typeof processId !== 'string' || !optimizer || !isRecord(metadata) ||
      typeof entry.machine_id !== 'string' ||
      typeof optimizer.machine_id !== 'string' ||
      typeof optimizer.start_time !== 'number' ||
      typeof optimizer.end_time !== 'number' ||
      typeof optimizer.power_kw !== 'number' ||
      typeof optimizer.solar_kwh !== 'number' ||
      typeof optimizer.grid_kwh !== 'number' ||
      typeof optimizer.energy_cost !== 'number' ||
      typeof entry.power_kw !== 'number' ||
      typeof entry.energy_kwh !== 'number' ||
      typeof entry.cost !== 'number' ||
      typeof metadata.solar_kwh !== 'number' ||
      typeof metadata.grid_kwh !== 'number' ||
      optimizer.machine_id !== entry.machine_id ||
      startsAt !== horizonStartMs + optimizer.start_time * 3_600_000 ||
      endsAt !== horizonStartMs + optimizer.end_time * 3_600_000 ||
      !closeEnough(optimizer.power_kw, entry.power_kw) ||
      !closeEnough(optimizer.solar_kwh, metadata.solar_kwh) ||
      !closeEnough(optimizer.grid_kwh, metadata.grid_kwh) ||
      !closeEnough(optimizer.energy_cost, entry.cost) ||
      !closeEnough(optimizer.solar_kwh + optimizer.grid_kwh, entry.energy_kwh)) {
      throw new Error('Persisted impact energy, TOU cost, timestamps, or IDs differ from the raw optimizer response.')
    }
    return {
      processId,
      machineId: entry.machine_id,
      startsAt: String(entry.starts_at),
      endsAt: String(entry.ends_at),
      powerKw: entry.power_kw,
      energyKwh: entry.energy_kwh,
      solarKwh: metadata.solar_kwh,
      gridKwh: metadata.grid_kwh,
      touCost: entry.cost,
    }
  })
}

function solarAvailability(
  readings: readonly SolarReading[],
  horizonStart: string,
  horizonEnd: string,
): number {
  const start = Date.parse(horizonStart)
  const end = Date.parse(horizonEnd)
  const intervalCount = (end - start) / QUARTER_HOUR_MS
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start >= end ||
    !Number.isSafeInteger(intervalCount) ||
    start % QUARTER_HOUR_MS !== 0
  ) {
    throw new Error('Solar impact profile requires a positive, quarter-hour-aligned horizon.')
  }

  const inHorizon = new Map<number, SolarReading>()
  for (const reading of readings) {
    const at = Date.parse(reading.recordedAt)
    if (!Number.isFinite(at)) throw new Error('Solar impact profile contains an invalid timestamp.')
    if (at < start || at >= end) continue
    if (
      reading.intervalMinutes !== 15 ||
      at % QUARTER_HOUR_MS !== 0 ||
      (reading.machineId !== null && reading.generationKwh !== 0)
    ) {
      throw new Error('Solar impact profile must use site-level 15-minute intervals.')
    }
    finiteNonnegative(reading.generationKwh, 'Solar generation')
    if (inHorizon.has(at)) throw new Error('Solar impact profile contains duplicate intervals.')
    inHorizon.set(at, reading)
  }
  if (inHorizon.size !== intervalCount) {
    throw new Error(`Solar impact profile is incomplete: expected ${intervalCount} intervals, got ${inHorizon.size}.`)
  }
  for (let at = start; at < end; at += QUARTER_HOUR_MS) {
    if (!inHorizon.has(at)) throw new Error(`Solar impact profile is missing ${new Date(at).toISOString()}.`)
  }
  return [...inHorizon.values()].reduce(
    (total, reading) => total + reading.generationKwh,
    0,
  )
}

function validateEntries(
  entries: readonly ImpactEntry[],
  processes: readonly ImpactProcess[],
  horizonStart: string,
  horizonEnd: string,
): ImpactEntry[] {
  const start = Date.parse(horizonStart)
  const end = Date.parse(horizonEnd)
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    throw new Error('Schedule impact requires a valid absolute horizon.')
  }

  const processById = new Map(processes.map((process) => [process.id, process]))
  if (
    processById.size !== processes.length ||
    processById.size === 0 ||
    entries.length !== processById.size
  ) {
    throw new Error('Schedule impact requires exactly one entry per canonical process.')
  }
  for (const process of processes) {
    if (
      !process.id ||
      !process.machineId ||
      !Number.isInteger(process.durationMinutes) ||
      process.durationMinutes <= 0
    ) {
      throw new Error('Schedule impact has an invalid canonical process profile.')
    }
    finiteNonnegative(process.powerKw, 'Canonical process power')
  }
  const seen = new Set<string>()
  for (const entry of entries) {
    const process = processById.get(entry.processId)
    const startsAt = Date.parse(entry.startsAt)
    const endsAt = Date.parse(entry.endsAt)
    if (!process || seen.has(entry.processId) || entry.machineId !== process.machineId) {
      throw new Error('Schedule impact contains an unknown, duplicate, or misassigned process.')
    }
    seen.add(entry.processId)
    finiteNonnegative(entry.powerKw, 'Schedule entry power')
    finiteNonnegative(entry.energyKwh, 'Schedule entry energy')
    finiteNonnegative(entry.solarKwh, 'Modeled solar allocation')
    finiteNonnegative(entry.gridKwh, 'Modeled grid import')
    finiteNonnegative(entry.touCost, 'Optimizer-modeled TOU cost')
    if (
      !Number.isFinite(startsAt) ||
      !Number.isFinite(endsAt) ||
      startsAt < start ||
      endsAt > end ||
      endsAt <= startsAt ||
      endsAt - startsAt !== process.durationMinutes * 60_000 ||
      entry.powerKw !== process.powerKw ||
      !closeEnough(entry.energyKwh, entry.solarKwh + entry.gridKwh) ||
      !closeEnough(entry.energyKwh, process.powerKw * process.durationMinutes / 60)
    ) {
      throw new Error('Schedule impact entry violates its exact-duration or energy-model contract.')
    }
  }
  if (seen.size !== processById.size) {
    throw new Error('Schedule impact is missing a canonical process.')
  }
  return [...entries]
}

function summarizeSchedule(
  entries: readonly ImpactEntry[],
  solarProfileAvailableKwh: number,
  horizonStart: string,
): ScheduleImpact {
  const modeledSolarAllocatedKwh = entries.reduce((sum, entry) => sum + entry.solarKwh, 0)
  const modeledGridImportKwh = entries.reduce((sum, entry) => sum + entry.gridKwh, 0)
  if (modeledSolarAllocatedKwh > solarProfileAvailableKwh + TOLERANCE) {
    throw new Error('Schedule solar allocation exceeds the supplied solar profile.')
  }

  const events = entries.flatMap((entry) => [
    { at: Date.parse(entry.startsAt), delta: entry.powerKw },
    { at: Date.parse(entry.endsAt), delta: -entry.powerKw },
  ]).sort((left, right) => left.at - right.at || left.delta - right.delta)
  let currentLoad = 0
  let modeledPeakScheduledLoadKw = 0
  for (const event of events) {
    currentLoad += event.delta
    if (currentLoad < -TOLERANCE) throw new Error('Schedule load events are internally inconsistent.')
    modeledPeakScheduledLoadKw = Math.max(modeledPeakScheduledLoadKw, currentLoad)
  }

  const totalProcessEnergyKwh = entries.reduce((sum, entry) => sum + entry.energyKwh, 0)
  return {
    totalProcessEnergyKwh,
    modeledSolarAllocatedKwh,
    modeledGridImportKwh,
    modeledTouEnergyCost: entries.reduce((sum, entry) => sum + entry.touCost, 0),
    modeledPeakScheduledLoadKw,
    completionHoursFromHorizonStart: Math.max(
      ...entries.map((entry) => (Date.parse(entry.endsAt) - Date.parse(horizonStart)) / 3_600_000),
    ),
    solarProfileAvailableKwh,
    unallocatedSolarProfileKwh: solarProfileAvailableKwh - modeledSolarAllocatedKwh,
    solarProfileAllocationPercent: solarProfileAvailableKwh > 0
      ? modeledSolarAllocatedKwh / solarProfileAvailableKwh * 100
      : 0,
  }
}

export function compareScheduleImpact(input: {
  baselineEntries: readonly ImpactEntry[]
  optimizedEntries: readonly ImpactEntry[]
  processes: readonly ImpactProcess[]
  solarReadings: readonly SolarReading[]
  horizonStart: string
  horizonEnd: string
}): DemandShiftComparison {
  const availableKwh = solarAvailability(input.solarReadings, input.horizonStart, input.horizonEnd)
  const baselineEntries = validateEntries(
    input.baselineEntries,
    input.processes,
    input.horizonStart,
    input.horizonEnd,
  )
  const optimizedEntries = validateEntries(
    input.optimizedEntries,
    input.processes,
    input.horizonStart,
    input.horizonEnd,
  )
  const baseline = summarizeSchedule(baselineEntries, availableKwh, input.horizonStart)
  const optimized = summarizeSchedule(optimizedEntries, availableKwh, input.horizonStart)
  const baselineByProcess = new Map(baselineEntries.map((entry) => [entry.processId, entry]))
  const processById = new Map(input.processes.map((process) => [process.id, process]))
  const processStartShifts = optimizedEntries.flatMap((entry) => {
    const baselineEntry = baselineByProcess.get(entry.processId)
    if (!baselineEntry || Date.parse(baselineEntry.startsAt) === Date.parse(entry.startsAt)) return []
    const process = processById.get(entry.processId)
    if (!process) throw new Error('Schedule shift references an unknown process.')
    return [{
      processId: entry.processId,
      processName: process.name,
      baselineStartsAt: baselineEntry.startsAt,
      optimizedStartsAt: entry.startsAt,
      shiftMinutes: (Date.parse(entry.startsAt) - Date.parse(baselineEntry.startsAt)) / 60_000,
    }]
  }).sort((left, right) => left.processName.localeCompare(right.processName))

  const optimizedByProcess = new Map(optimizedEntries.map((entry) => [entry.processId, entry]))
  const processMoveComparisons = processStartShifts.map((shift) => {
    const baselineEntry = baselineByProcess.get(shift.processId)
    const optimizedEntry = optimizedByProcess.get(shift.processId)
    if (!baselineEntry || !optimizedEntry) {
      throw new Error('Process shift comparison is missing a baseline or optimized entry.')
    }
    const solarDeltaKwh = optimizedEntry.solarKwh - baselineEntry.solarKwh
    const touCostDelta = optimizedEntry.touCost - baselineEntry.touCost
    return {
      ...shift,
      baselineSolarKwh: baselineEntry.solarKwh,
      optimizedSolarKwh: optimizedEntry.solarKwh,
      solarDeltaKwh,
      baselineTouCost: baselineEntry.touCost,
      optimizedTouCost: optimizedEntry.touCost,
      touCostDelta,
    }
  })

  return {
    baseline,
    optimized,
    processEnergyChangeKwh: optimized.totalProcessEnergyKwh - baseline.totalProcessEnergyKwh,
    modeledSolarAllocationChangeKwh: optimized.modeledSolarAllocatedKwh - baseline.modeledSolarAllocatedKwh,
    modeledGridImportReductionKwh: baseline.modeledGridImportKwh - optimized.modeledGridImportKwh,
    modeledTouCostReduction: baseline.modeledTouEnergyCost - optimized.modeledTouEnergyCost,
    modeledTouCostReductionPercent: baseline.modeledTouEnergyCost > 0
      ? (baseline.modeledTouEnergyCost - optimized.modeledTouEnergyCost) /
        baseline.modeledTouEnergyCost * 100
      : 0,
    modeledPeakScheduledLoadReductionKw:
      baseline.modeledPeakScheduledLoadKw - optimized.modeledPeakScheduledLoadKw,
    completionTimeChangeHours:
      optimized.completionHoursFromHorizonStart - baseline.completionHoursFromHorizonStart,
    processStartShifts,
    processMoveComparisons,
  }
}
