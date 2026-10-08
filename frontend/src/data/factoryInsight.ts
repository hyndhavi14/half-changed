// Factory-aware insight model shared by Dashboard, Schedule, Energy, SolarShift and 3D pages.
// Pure functions only (node:test safe). Every value is derived from the selected factory's
// persisted backend data: machines, processes, dependencies, energy readings, tariffs and the
// stored baseline / optimized schedules. Nothing here is factory-specific and nothing is invented:
// when a value cannot be derived it is null and the UI says so.
import type { BackendFactoryData } from './backendApi'
import { scheduleKind } from './backendView.ts'
import { dashboardTariffBand, tariffWindows, type TariffBand, type TariffWindow } from '../pages/DashboardPage/dashboardView.ts'
import { machineStages, processStages } from './stageView.ts'

export type StoredSchedule = BackendFactoryData['schedules'][number]
type Entry = StoredSchedule['entries'][number]

const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000
/** Starts that differ by less than this are treated as unchanged (optimizer output is minute-based). */
const MOVE_TOLERANCE_MS = MINUTE_MS

function toTime(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : null
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function metadataNumber(entry: Pick<Entry, 'metadata'>, key: string): number | null {
  const metadata: unknown = Reflect.get(entry, 'metadata')
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) return null
  return toNumber((metadata as Record<string, unknown>)[key])
}

// ---------------------------------------------------------------- schedules

export interface SchedulePair {
  baseline: StoredSchedule | undefined
  optimized: StoredSchedule | undefined
}

export function schedulePair(data: Pick<BackendFactoryData, 'schedules'>): SchedulePair {
  return {
    baseline: data.schedules.find((schedule) => scheduleKind(schedule) === 'baseline'),
    optimized: data.schedules.find((schedule) => scheduleKind(schedule) === 'optimized'),
  }
}

// ---------------------------------------------------------------- machine labels

export interface MachineLabel {
  id: string
  /** Display code in production-flow order: M01, M02, … */
  code: string
  name: string
  /** "M01 — Cocoa Roaster" */
  label: string
  stage: number | null
}

/**
 * Machines in production-flow order (earliest dependency stage first, stored order inside a stage),
 * unassigned machines last. Codes are display positions, the names are the stored machine names.
 */
export function machineLabels(data: Pick<BackendFactoryData, 'machines' | 'processes' | 'dependencies'>): MachineLabel[] {
  const { stages } = processStages(data.processes, data.dependencies)
  const grouped = machineStages(data.machines, data.processes, stages)
  const ordered: Array<{ id: string; name: string; stage: number | null }> = []
  grouped.stages.forEach((stage, index) => {
    for (const machine of stage.machines) ordered.push({ id: machine.id, name: machine.name, stage: index + 1 })
  })
  for (const machine of grouped.unassigned) ordered.push({ id: machine.id, name: machine.name, stage: null })
  const width = Math.max(2, String(ordered.length).length)
  return ordered.map((machine, index) => {
    const code = `M${String(index + 1).padStart(width, '0')}`
    return { ...machine, code, label: `${code} — ${machine.name}` }
  })
}

// ---------------------------------------------------------------- totals and outcome

export interface ScheduleTotals {
  energyKwh: number | null
  solarKwh: number | null
  gridKwh: number | null
  cost: number | null
  completionHours: number | null
  peakKw: number | null
  entryCount: number
}

function sumIfComplete(values: Array<number | null>): number | null {
  if (values.length === 0 || values.some((value) => value === null)) return null
  return (values as number[]).reduce((total, value) => total + value, 0)
}

function peakLoad(entries: readonly Entry[]): number | null {
  const events: Array<[number, number]> = []
  for (const entry of entries) {
    const start = toTime(entry.startsAt)
    const end = toTime(entry.endsAt)
    const power = toNumber(entry.powerKw)
    if (start === null || end === null || power === null || end <= start) return null
    events.push([start, power], [end, -power])
  }
  if (events.length === 0) return null
  events.sort((left, right) => left[0] - right[0] || left[1] - right[1])
  let load = 0
  let peak = 0
  for (const [, delta] of events) {
    load += delta
    peak = Math.max(peak, load)
  }
  return peak
}

/** Totals of one stored schedule. Solar and grid need every entry to carry both values. */
export function scheduleTotals(schedule: StoredSchedule | undefined): ScheduleTotals {
  if (!schedule) return { energyKwh: null, solarKwh: null, gridKwh: null, cost: null, completionHours: null, peakKw: null, entryCount: 0 }
  const entries = schedule.entries
  const horizonStart = toTime(schedule.horizonStart)
  const ends = entries.map((entry) => toTime(entry.endsAt))
  const lastEnd = ends.some((end) => end === null) || ends.length === 0 ? null : Math.max(...(ends as number[]))
  return {
    energyKwh: schedule.totalEnergyKwh ?? sumIfComplete(entries.map((entry) => toNumber(entry.energyKwh))),
    solarKwh: sumIfComplete(entries.map((entry) => metadataNumber(entry, 'solar_kwh'))),
    gridKwh: sumIfComplete(entries.map((entry) => metadataNumber(entry, 'grid_kwh'))),
    cost: schedule.totalEnergyCost ?? sumIfComplete(entries.map((entry) => toNumber(entry.cost))),
    completionHours: horizonStart !== null && lastEnd !== null ? (lastEnd - horizonStart) / HOUR_MS : null,
    peakKw: peakLoad(entries),
    entryCount: entries.length,
  }
}

export interface OptimizationOutcome {
  baseline: ScheduleTotals
  optimized: ScheduleTotals
  /** Both schedules cover the same processes over the same horizon start. */
  comparable: boolean
  gridSavedKwh: number | null
  solarGainKwh: number | null
  costSaved: number | null
  costSavedPct: number | null
  /** Change in grid share of planned energy, in percentage points (negative = less grid). */
  gridDependencyChangePts: number | null
}

export function optimizationOutcome(pair: SchedulePair): OptimizationOutcome {
  const baseline = scheduleTotals(pair.baseline)
  const optimized = scheduleTotals(pair.optimized)
  const processIds = (schedule: StoredSchedule | undefined) => [...new Set(schedule?.entries.map((entry) => entry.processId) ?? [])].sort().join('|')
  const comparable = Boolean(pair.baseline && pair.optimized) &&
    processIds(pair.baseline) === processIds(pair.optimized) &&
    processIds(pair.baseline).length > 0 &&
    toTime(pair.baseline?.horizonStart) === toTime(pair.optimized?.horizonStart)
  const diff = (before: number | null, after: number | null) => (comparable && before !== null && after !== null ? before - after : null)
  const share = (totals: ScheduleTotals) =>
    totals.gridKwh !== null && totals.energyKwh !== null && totals.energyKwh > 0 ? (totals.gridKwh / totals.energyKwh) * 100 : null
  const baselineShare = share(baseline)
  const optimizedShare = share(optimized)
  const costSaved = diff(baseline.cost, optimized.cost)
  return {
    baseline,
    optimized,
    comparable,
    gridSavedKwh: diff(baseline.gridKwh, optimized.gridKwh),
    solarGainKwh: comparable && baseline.solarKwh !== null && optimized.solarKwh !== null ? optimized.solarKwh - baseline.solarKwh : null,
    costSaved,
    costSavedPct: costSaved !== null && baseline.cost !== null && baseline.cost > 0 ? (costSaved / baseline.cost) * 100 : null,
    gridDependencyChangePts: comparable && baselineShare !== null && optimizedShare !== null ? optimizedShare - baselineShare : null,
  }
}

// ---------------------------------------------------------------- solar readings and tariff

export interface SolarSample {
  start: number
  end: number
  kwh: number
}

/** Site-level generation readings (rows without a machine) as time slices. */
export function solarSamples(rows: readonly Record<string, unknown>[]): SolarSample[] {
  const samples: SolarSample[] = []
  for (const row of rows) {
    if (row.machine_id !== null && row.machine_id !== undefined) continue
    const start = toTime(row.recorded_at)
    const minutes = toNumber(row.interval_minutes)
    const kwh = toNumber(row.generation_kwh)
    if (start === null || minutes === null || minutes <= 0 || kwh === null) continue
    samples.push({ start, end: start + minutes * MINUTE_MS, kwh })
  }
  return samples.sort((left, right) => left.start - right.start)
}

/** Average solar power (kW) available over [start, end), or null when readings do not cover it. */
export function averageSolarKw(samples: readonly SolarSample[], start: number, end: number): number | null {
  if (!(end > start)) return null
  let energy = 0
  let covered = 0
  for (const sample of samples) {
    if (sample.end <= start || sample.start >= end) continue
    const overlap = Math.min(end, sample.end) - Math.max(start, sample.start)
    energy += sample.kwh * (overlap / (sample.end - sample.start))
    covered += overlap
  }
  if (covered < (end - start) * 0.999) return null
  return energy / ((end - start) / HOUR_MS)
}

const ISO_WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }

function localClock(instant: number, timeZone: string): { minute: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
  }).formatToParts(new Date(instant))
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0)
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0)
  return { minute: hour * 60 + minute, weekday: ISO_WEEKDAY[parts.find((part) => part.type === 'weekday')?.value ?? 'Mon'] ?? 1 }
}

function covers(window: TariffWindow, minute: number): boolean {
  if (window.startMinute < window.endMinute) return minute >= window.startMinute && minute < window.endMinute
  return minute >= window.startMinute || minute < window.endMinute
}

/** Energy price at an instant: the single highest-priority active window (as the optimizer payload resolves it). */
export function tariffPriceAt(windows: readonly TariffWindow[], instant: number, timeZone: string): number | null {
  const { minute, weekday } = localClock(instant, timeZone)
  const active = windows.filter((window) =>
    covers(window, minute) &&
    (window.isoDays === null || window.isoDays.includes(weekday)) &&
    (window.effectiveFrom === null || instant >= window.effectiveFrom) &&
    (window.effectiveTo === null || instant < window.effectiveTo))
  if (active.length === 0) return null
  const top = Math.max(...active.map((window) => window.priority))
  const highest = active.filter((window) => window.priority === top)
  return highest.length === 1 ? highest[0].price : null
}

export function tariffBandAt(windows: readonly TariffWindow[], instant: number, timeZone: string): TariffBand | null {
  const { minute, weekday } = localClock(instant, timeZone)
  return dashboardTariffBand(windows, minute, weekday, instant)
}

function averagePrice(windows: readonly TariffWindow[], start: number, end: number, timeZone: string): number | null {
  if (!(end > start) || windows.length === 0) return null
  const step = 5 * MINUTE_MS
  let total = 0
  let count = 0
  for (let instant = start + step / 2; instant < end; instant += step) {
    const price = tariffPriceAt(windows, instant, timeZone)
    if (price === null) return null
    total += price
    count += 1
  }
  return count ? total / count : null
}

// ---------------------------------------------------------------- moves and checks

export interface ProcessMove {
  processId: string
  processName: string
  machineId: string
  machineLabel: string
  powerKw: number | null
  baselineStart: number
  baselineEnd: number
  optimizedStart: number
  optimizedEnd: number
  shiftMinutes: number
  moved: boolean
  baselineSolarKwh: number | null
  optimizedSolarKwh: number | null
  baselineGridKwh: number | null
  optimizedGridKwh: number | null
  baselineCost: number | null
  optimizedCost: number | null
  baselineSolarKw: number | null
  optimizedSolarKw: number | null
  baselinePrice: number | null
  optimizedPrice: number | null
}

/** One row per process present in both schedules, in optimized start order. */
export function processMoves(data: BackendFactoryData, pair: SchedulePair): ProcessMove[] {
  if (!pair.baseline || !pair.optimized) return []
  const labels = new Map(machineLabels(data).map((label) => [label.id, label.label]))
  const names = new Map(data.processes.map((process) => [process.id, process.name]))
  const samples = solarSamples(data.energy)
  const windows = tariffWindows(data.tariffs)
  const timeZone = data.factory.timezone
  const baselineByProcess = new Map(pair.baseline.entries.map((entry) => [entry.processId, entry]))
  const rows: ProcessMove[] = []
  for (const entry of pair.optimized.entries) {
    const before = baselineByProcess.get(entry.processId)
    if (!before) continue
    const bs = toTime(before.startsAt)
    const be = toTime(before.endsAt)
    const os = toTime(entry.startsAt)
    const oe = toTime(entry.endsAt)
    if (bs === null || be === null || os === null || oe === null) continue
    rows.push({
      processId: entry.processId,
      processName: names.get(entry.processId) ?? 'Unknown process',
      machineId: entry.machineId,
      machineLabel: labels.get(entry.machineId) ?? 'Unknown machine',
      powerKw: toNumber(entry.powerKw),
      baselineStart: bs,
      baselineEnd: be,
      optimizedStart: os,
      optimizedEnd: oe,
      shiftMinutes: Math.round((os - bs) / MINUTE_MS),
      moved: Math.abs(os - bs) >= MOVE_TOLERANCE_MS,
      baselineSolarKwh: metadataNumber(before, 'solar_kwh'),
      optimizedSolarKwh: metadataNumber(entry, 'solar_kwh'),
      baselineGridKwh: metadataNumber(before, 'grid_kwh'),
      optimizedGridKwh: metadataNumber(entry, 'grid_kwh'),
      baselineCost: toNumber(before.cost),
      optimizedCost: toNumber(entry.cost),
      baselineSolarKw: averageSolarKw(samples, bs, be),
      optimizedSolarKw: averageSolarKw(samples, os, oe),
      baselinePrice: averagePrice(windows, bs, be, timeZone),
      optimizedPrice: averagePrice(windows, os, oe, timeZone),
    })
  }
  return rows.sort((left, right) => left.optimizedStart - right.optimizedStart)
}

export interface PlanChecks {
  /** null when the factory stores no dependencies. */
  dependencies: boolean | null
  machineConflicts: boolean
  withinHorizon: boolean
}

export function planChecks(data: Pick<BackendFactoryData, 'dependencies'>, schedule: StoredSchedule | undefined): PlanChecks | null {
  if (!schedule || schedule.entries.length === 0) return null
  const byProcess = new Map(schedule.entries.map((entry) => [entry.processId, entry]))
  const finishToStart = data.dependencies.filter((dependency) => dependency.type === 'finish_to_start')
  const dependencies = finishToStart.length === 0
    ? null
    : finishToStart.every((dependency) => {
        const current = byProcess.get(dependency.processId)
        const prerequisite = byProcess.get(dependency.dependsOnProcessId)
        if (!current || !prerequisite) return true
        const start = toTime(current.startsAt)
        const end = toTime(prerequisite.endsAt)
        return start !== null && end !== null && start + dependency.lagMinutes * MINUTE_MS >= end
      })
  const byMachine = new Map<string, Array<[number, number]>>()
  for (const entry of schedule.entries) {
    const start = toTime(entry.startsAt)
    const end = toTime(entry.endsAt)
    if (start === null || end === null) continue
    const list = byMachine.get(entry.machineId) ?? []
    list.push([start, end])
    byMachine.set(entry.machineId, list)
  }
  let machineConflicts = true
  for (const list of byMachine.values()) {
    list.sort((left, right) => left[0] - right[0])
    for (let index = 1; index < list.length; index += 1) {
      if (list[index][0] < list[index - 1][1]) machineConflicts = false
    }
  }
  const horizonEnd = toTime(schedule.horizonEnd)
  const lastEnd = Math.max(...schedule.entries.map((entry) => toTime(entry.endsAt) ?? Infinity))
  return { dependencies, machineConflicts, withinHorizon: horizonEnd !== null && lastEnd <= horizonEnd }
}

/**
 * The single most useful move to explain: a moved process whose modeled grid energy or cost fell,
 * ranked by grid energy saved, then cost saved. Null when no move produced a benefit.
 */
export function recommendation(moves: readonly ProcessMove[]): ProcessMove | null {
  const benefit = (move: ProcessMove) => ({
    grid: move.baselineGridKwh !== null && move.optimizedGridKwh !== null ? move.baselineGridKwh - move.optimizedGridKwh : 0,
    cost: move.baselineCost !== null && move.optimizedCost !== null ? move.baselineCost - move.optimizedCost : 0,
  })
  const candidates = moves.filter((move) => {
    if (!move.moved) return false
    const value = benefit(move)
    return value.grid > 1e-6 || value.cost > 1e-6
  })
  if (candidates.length === 0) return null
  return [...candidates].sort((left, right) => {
    const a = benefit(left)
    const b = benefit(right)
    return b.grid - a.grid || b.cost - a.cost
  })[0]
}

// ---------------------------------------------------------------- windows, hourly series, Gantt

export interface TimeWindow {
  start: number
  end: number
}

/** Whole-hour window around the work in both schedules, one hour of padding, clamped to the horizon. */
export function workWindow(pair: SchedulePair): TimeWindow | null {
  const schedules = [pair.baseline, pair.optimized].filter((schedule): schedule is StoredSchedule => Boolean(schedule))
  if (schedules.length === 0) return null
  let first = Infinity
  let last = -Infinity
  let horizonStart = Infinity
  let horizonEnd = -Infinity
  for (const schedule of schedules) {
    const hs = toTime(schedule.horizonStart)
    const he = toTime(schedule.horizonEnd)
    if (hs !== null) horizonStart = Math.min(horizonStart, hs)
    if (he !== null) horizonEnd = Math.max(horizonEnd, he)
    for (const entry of schedule.entries) {
      const start = toTime(entry.startsAt)
      const end = toTime(entry.endsAt)
      if (start === null || end === null) continue
      first = Math.min(first, start)
      last = Math.max(last, end)
    }
  }
  if (!Number.isFinite(first)) return null
  let start = Math.floor(first / HOUR_MS) * HOUR_MS - HOUR_MS
  let end = Math.ceil(last / HOUR_MS) * HOUR_MS + HOUR_MS
  if (Number.isFinite(horizonStart)) start = Math.max(start, horizonStart)
  if (Number.isFinite(horizonEnd)) end = Math.min(end, horizonEnd)
  return end > start ? { start, end } : null
}

export interface DemandInterval {
  start: number
  end: number
  kw: number
}

export function demandIntervals(schedule: StoredSchedule | undefined): DemandInterval[] {
  if (!schedule) return []
  const intervals: DemandInterval[] = []
  for (const entry of schedule.entries) {
    const start = toTime(entry.startsAt)
    const end = toTime(entry.endsAt)
    const kw = toNumber(entry.powerKw)
    if (start === null || end === null || kw === null || end <= start) continue
    intervals.push({ start, end, kw })
  }
  return intervals
}

export interface HourPoint {
  start: number
  /** Average solar power available in the hour, null when no readings cover it. */
  solarKw: number | null
  baselineKw: number
  optimizedKw: number
  band: TariffBand | null
  price: number | null
}

function averageDemand(intervals: readonly DemandInterval[], start: number, end: number): number {
  let energy = 0
  for (const interval of intervals) {
    const overlap = Math.min(end, interval.end) - Math.max(start, interval.start)
    if (overlap > 0) energy += interval.kw * overlap
  }
  return energy / (end - start)
}

export function hourlySeries(input: {
  window: TimeWindow
  baseline: readonly DemandInterval[]
  optimized: readonly DemandInterval[]
  solarKw: (start: number, end: number) => number | null
  band: (instant: number) => TariffBand | null
  price: (instant: number) => number | null
}): HourPoint[] {
  const points: HourPoint[] = []
  for (let start = input.window.start; start < input.window.end; start += HOUR_MS) {
    const end = Math.min(start + HOUR_MS, input.window.end)
    const middle = start + (end - start) / 2
    points.push({
      start,
      solarKw: input.solarKw(start, end),
      baselineKw: averageDemand(input.baseline, start, end),
      optimizedKw: averageDemand(input.optimized, start, end),
      band: input.band(middle),
      price: input.price(middle),
    })
  }
  return points
}

/** Hourly solar / demand / tariff series for the selected factory over its work window. */
export function factoryHourlySeries(data: BackendFactoryData, pair: SchedulePair): HourPoint[] {
  const window = workWindow(pair)
  if (!window) return []
  const samples = solarSamples(data.energy)
  const windows = tariffWindows(data.tariffs)
  const timeZone = data.factory.timezone
  return hourlySeries({
    window,
    baseline: demandIntervals(pair.baseline),
    optimized: demandIntervals(pair.optimized),
    solarKw: (start, end) => averageSolarKw(samples, start, end),
    band: (instant) => (windows.length ? tariffBandAt(windows, instant, timeZone) : null),
    price: (instant) => (windows.length ? tariffPriceAt(windows, instant, timeZone) : null),
  })
}

export interface GanttBlock {
  id: string
  processId: string
  label: string
  start: number
  end: number
  moved: boolean
  powerKw: number | null
}

export interface GanttLane {
  id: string
  code: string
  name: string
  baseline: GanttBlock[]
  optimized: GanttBlock[]
}

function blocks(schedule: StoredSchedule | undefined, machineId: string, names: Map<string, string>, moved: Set<string>): GanttBlock[] {
  if (!schedule) return []
  const result: GanttBlock[] = []
  for (const entry of schedule.entries) {
    if (entry.machineId !== machineId) continue
    const start = toTime(entry.startsAt)
    const end = toTime(entry.endsAt)
    if (start === null || end === null || end <= start) continue
    result.push({
      id: entry.id,
      processId: entry.processId,
      label: names.get(entry.processId) ?? 'Unknown process',
      start,
      end,
      moved: moved.has(entry.processId),
      powerKw: toNumber(entry.powerKw),
    })
  }
  return result.sort((left, right) => left.start - right.start)
}

/** One lane per machine that has work in either schedule, labelled with its stored name. */
export function ganttLanes(data: BackendFactoryData, pair: SchedulePair): GanttLane[] {
  const names = new Map(data.processes.map((process) => [process.id, process.name]))
  const moved = new Set(processMoves(data, pair).filter((move) => move.moved).map((move) => move.processId))
  return machineLabels(data)
    .map((machine) => ({
      id: machine.id,
      code: machine.code,
      name: machine.name,
      baseline: blocks(pair.baseline, machine.id, names, moved),
      optimized: blocks(pair.optimized, machine.id, names, moved),
    }))
    .filter((lane) => lane.baseline.length > 0 || lane.optimized.length > 0)
}

/** Total solar energy the stored readings make available across a schedule's horizon, null if not fully covered. */
export function solarAvailableKwh(data: Pick<BackendFactoryData, 'energy'>, schedule: StoredSchedule | undefined): number | null {
  if (!schedule) return null
  const start = toTime(schedule.horizonStart)
  const end = toTime(schedule.horizonEnd)
  if (start === null || end === null || end <= start) return null
  const average = averageSolarKw(solarSamples(data.energy), start, end)
  return average === null ? null : average * ((end - start) / HOUR_MS)
}
