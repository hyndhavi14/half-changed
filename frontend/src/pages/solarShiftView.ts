// Phase 11 - SolarShift historical replay view helpers. Pure functions, no React.
// Every value comes from the public SolarShift API payload; nothing is invented.
import type { CompareMetric } from '../data/types'

export type JsonRecord = Record<string, unknown>

export type ScenarioData = {
  factory: JsonRecord
  manifest: JsonRecord
  energyRows: JsonRecord[]
  hourlyProfile: JsonRecord[]
  tariffs: JsonRecord[]
  requests: JsonRecord[]
  results: JsonRecord[]
  schedules: JsonRecord[]
  entries: JsonRecord[]
  processes: JsonRecord[]
  machines: JsonRecord[]
}

export const NOT_AVAILABLE = 'Not available'

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function text(value: unknown, fallback = NOT_AVAILABLE): string {
  if (typeof value === 'string' && value.length > 0) return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return fallback
}

export function object(value: unknown): JsonRecord {
  return isRecord(value) ? value : {}
}

export function toNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  return Number.isFinite(parsed) ? parsed : null
}

export function showKwh(value: unknown): string {
  const parsed = toNumber(value)
  return parsed === null ? NOT_AVAILABLE : `${parsed.toFixed(4)} kWh`
}

export function showInr(value: unknown): string {
  const parsed = toNumber(value)
  return parsed === null
    ? NOT_AVAILABLE
    : `₹${parsed.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`
}

export function localTimestamp(value: unknown): string {
  if (typeof value !== 'string') return NOT_AVAILABLE
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return NOT_AVAILABLE
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
    hour12: false,
  }).format(date)
}

export function scheduleFor(scenario: Pick<ScenarioData, 'schedules'>, kind: 'baseline' | 'optimized'): JsonRecord | undefined {
  const expectedName = kind === 'baseline' ? 'SolarShift historical baseline' : 'SolarShift historical optimized'
  return scenario.schedules.find((schedule) => schedule.name === expectedName)
}

export function scheduleEntries(scenario: Pick<ScenarioData, 'entries'>, schedule: JsonRecord | undefined): JsonRecord[] {
  if (!schedule || typeof schedule.id !== 'string') return []
  return scenario.entries
    .filter((entry) => entry.schedule_id === schedule.id)
    .sort((left, right) => String(left.starts_at).localeCompare(String(right.starts_at)))
}

/** Exact modeled solar/grid energy of one entry, from the optimizer's integer energy units (600 000 per kWh). */
export function entryEnergyUnits(entry: JsonRecord, key: 'solar_energy_units' | 'grid_energy_units'): number | null {
  const units = toNumber(object(entry.metadata)[key])
  return units === null ? null : units / 600_000
}

interface MetricDef {
  label: string
  read: (schedule: JsonRecord | undefined) => number | null
  format: (value: number) => string
  better: 'lower' | 'higher'
}

const METRICS: MetricDef[] = [
  { label: 'Modeled tariff energy cost', read: (s) => toNumber(s?.total_energy_cost), format: (v) => showInr(v), better: 'lower' },
  { label: 'Modeled solar allocation', read: (s) => toNumber(object(s?.metadata).modeled_solar_kwh), format: (v) => showKwh(v), better: 'higher' },
  { label: 'Modeled grid energy', read: (s) => toNumber(object(s?.metadata).modeled_grid_kwh), format: (v) => showKwh(v), better: 'lower' },
  { label: 'Completion / makespan', read: (s) => toNumber(object(s?.metadata).makespan_minutes), format: (v) => `${v} min`, better: 'lower' },
]

/** Baseline vs optimized metrics for the shared CompareCard. Metrics missing on either schedule are left out. */
export function scenarioCompare(scenario: Pick<ScenarioData, 'schedules'>): Array<CompareMetric & { changeTone: 'good' | 'bad' | 'neutral' }> {
  const baseline = scheduleFor(scenario, 'baseline')
  const optimized = scheduleFor(scenario, 'optimized')
  const rows: Array<CompareMetric & { changeTone: 'good' | 'bad' | 'neutral' }> = []
  for (const metric of METRICS) {
    const before = metric.read(baseline)
    const after = metric.read(optimized)
    if (before === null || after === null || before < 0 || after < 0) continue
    const largest = Math.max(before, after)
    const diff = after - before
    let change = 'No change'
    let changeTone: 'good' | 'bad' | 'neutral' = 'neutral'
    if (Math.abs(diff) > 1e-9) {
      change = before === 0
        ? 'Baseline is zero'
        : `${(Math.abs(diff / before) * 100).toLocaleString('en-GB', { maximumFractionDigits: 1 })}% ${diff < 0 ? 'lower' : 'higher'}`
      changeTone = (metric.better === 'lower' ? diff < 0 : diff > 0) ? 'good' : 'bad'
    }
    rows.push({
      label: metric.label,
      baseline: metric.format(before),
      optimized: metric.format(after),
      baselinePct: largest === 0 ? 100 : (before / largest) * 100,
      optimizedPct: largest === 0 ? 100 : (after / largest) * 100,
      change,
      changeTone,
    })
  }
  return rows
}

export interface OverviewRow {
  code: string
  nasaTotal: string
  modeledPv: string
  baselineCost: string
  optimizedCost: string
  costChange: string
  optimizedSolar: string
}

/** One row per scenario for the HGD vs LGD overview table. The cost change is calculated from the two stored costs. */
export function overviewRow(scenario: ScenarioData): OverviewRow {
  const manifest = scenario.manifest
  const baseline = scheduleFor(scenario, 'baseline')
  const optimized = scheduleFor(scenario, 'optimized')
  const before = toNumber(baseline?.total_energy_cost)
  const after = toNumber(optimized?.total_energy_cost)
  const nasa = toNumber(manifest.nasa_total_wh_m2)
  return {
    code: text(manifest.scenario_code),
    nasaTotal: nasa === null ? NOT_AVAILABLE : `${nasa.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Wh/m²`,
    modeledPv: showKwh(manifest.modeled_pv_total_kwh),
    baselineCost: showInr(before),
    optimizedCost: showInr(after),
    costChange: before === null || after === null || before === 0
      ? NOT_AVAILABLE
      : `${after <= before ? '−' : '+'}${(Math.abs((after - before) / before) * 100).toLocaleString('en-GB', { maximumFractionDigits: 1 })}%`,
    optimizedSolar: showKwh(object(optimized?.metadata).modeled_solar_kwh),
  }
}

export interface DailyBar {
  date: string
  value: number
  pct: number
}

/** Daily NASA solar resource totals with their share of the week's highest day, for the bar list. */
export function dailyBars(manifest: JsonRecord): DailyBar[] {
  const stats = object(manifest.solar_statistics)
  const days = Array.isArray(stats.daily_totals_wh_m2) ? stats.daily_totals_wh_m2.filter(isRecord) : []
  const parsed = days
    .map((day) => ({ date: text(day.date), value: toNumber(day.total_wh_m2) }))
    .filter((day): day is { date: string; value: number } => day.value !== null)
  const max = Math.max(0, ...parsed.map((day) => day.value))
  return parsed.map((day) => ({ ...day, pct: max > 0 ? (day.value / max) * 100 : 0 }))
}

export type ApercBand = 'peak' | 'normal' | 'off_peak'

export interface BandSegment {
  band: ApercBand
  startFraction: number
  endFraction: number
}

function minutes(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{1,2}):(\d{2})/.exec(value)
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

/** 24-hour strip of the stored APERC windows (end 00:00 means midnight). Unknown bands are skipped. */
export function tariffDaySegments(tariffs: readonly JsonRecord[]): BandSegment[] {
  const segments: BandSegment[] = []
  for (const tariff of tariffs) {
    const band = tariff.band
    if (band !== 'peak' && band !== 'normal' && band !== 'off_peak') continue
    const start = minutes(tariff.start_time)
    let end = minutes(tariff.end_time)
    if (start === null || end === null) continue
    if (end === 0) end = 1440
    if (end <= start) continue
    segments.push({ band, startFraction: start / 1440, endFraction: end / 1440 })
  }
  return segments.sort((left, right) => left.startFraction - right.startFraction)
}

export function clockText(value: unknown): string {
  const total = minutes(value)
  return total === null ? NOT_AVAILABLE : `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

export const BAND_LABEL: Record<ApercBand, string> = { peak: 'Peak', normal: 'Normal', off_peak: 'Off-peak' }

// ---------------------------------------------------------------- Historical replay visuals

const HOUR_MS = 3_600_000
const SCENARIO_TZ = 'Asia/Kolkata'

function time(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** "11–18 Mar 2026" from the manifest's local window (end exclusive), in Asia/Kolkata. */
export function scenarioDateRange(manifest: JsonRecord): string {
  const start = time(manifest.local_start) ?? time(manifest.selected_utc_start)
  const endExclusive = time(manifest.local_end_exclusive) ?? time(manifest.selected_utc_end_exclusive)
  if (start === null || endExclusive === null || endExclusive <= start) return NOT_AVAILABLE
  const end = endExclusive - 60_000
  const day = new Intl.DateTimeFormat('en-GB', { timeZone: SCENARIO_TZ, day: 'numeric' })
  const full = new Intl.DateTimeFormat('en-GB', { timeZone: SCENARIO_TZ, day: 'numeric', month: 'short', year: 'numeric' })
  const month = new Intl.DateTimeFormat('en-GB', { timeZone: SCENARIO_TZ, month: 'short', year: 'numeric' })
  return month.format(start) === month.format(end)
    ? `${day.format(start)}–${full.format(end)}`
    : `${full.format(start)} – ${full.format(end)}`
}

type HistoricalBand = 'peak' | 'mid' | 'off'
const BAND_MAP: Record<ApercBand, HistoricalBand> = { peak: 'peak', normal: 'mid', off_peak: 'off' }

function localMinute(instant: number): number {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: SCENARIO_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(instant))
  return Number(parts.find((part) => part.type === 'hour')?.value ?? 0) * 60 + Number(parts.find((part) => part.type === 'minute')?.value ?? 0)
}

/** APERC band at an instant from the stored local-time windows (end 00:00 = midnight). */
export function scenarioBandAt(tariffs: readonly JsonRecord[], instant: number): HistoricalBand | null {
  const minute = localMinute(instant)
  for (const segment of tariffDaySegments(tariffs)) {
    if (minute >= segment.startFraction * 1440 && minute < segment.endFraction * 1440) return BAND_MAP[segment.band]
  }
  return null
}

export interface ScenarioHour {
  start: number
  solarKw: number | null
  baselineKw: number
  optimizedKw: number
  band: HistoricalBand | null
}

/** Hourly modeled PV (kWh in an hour = average kW) with baseline / optimized demand from the stored entries. */
export function scenarioHourly(scenario: Pick<ScenarioData, 'hourlyProfile' | 'schedules' | 'entries' | 'tariffs'>): ScenarioHour[] {
  const demand = (kind: 'baseline' | 'optimized') => scheduleEntries(scenario, scheduleFor(scenario, kind)).flatMap((entry) => {
    const start = time(entry.starts_at)
    const end = time(entry.ends_at)
    const kw = toNumber(entry.power_kw)
    return start !== null && end !== null && kw !== null && end > start ? [{ start, end, kw }] : []
  })
  const baseline = demand('baseline')
  const optimized = demand('optimized')
  const average = (intervals: typeof baseline, start: number, end: number) =>
    intervals.reduce((total, interval) => total + interval.kw * Math.max(0, Math.min(end, interval.end) - Math.max(start, interval.start)), 0) / (end - start)
  return scenario.hourlyProfile.flatMap((hour) => {
    const start = time(hour.timestamp_utc)
    if (start === null) return []
    const end = start + HOUR_MS
    return [{
      start,
      solarKw: toNumber(hour.modeled_pv_kwh),
      baselineKw: average(baseline, start, end),
      optimizedKw: average(optimized, start, end),
      band: scenario.tariffs.length ? scenarioBandAt(scenario.tariffs, start + HOUR_MS / 2) : null,
    }]
  }).sort((left, right) => left.start - right.start)
}

export interface ScenarioLane {
  id: string
  code: string
  name: string
  baseline: Array<{ id: string; label: string; start: number; end: number; moved: boolean; powerKw: number | null }>
  optimized: Array<{ id: string; label: string; start: number; end: number; moved: boolean; powerKw: number | null }>
}

/** Machine lanes (in first-use order) with baseline and optimized blocks for the replay timeline. */
export function scenarioLanes(scenario: Pick<ScenarioData, 'machines' | 'processes' | 'schedules' | 'entries'>): { lanes: ScenarioLane[]; window: { start: number; end: number } | null } {
  const baselineEntries = scheduleEntries(scenario, scheduleFor(scenario, 'baseline'))
  const optimizedEntries = scheduleEntries(scenario, scheduleFor(scenario, 'optimized'))
  const processNames = new Map(scenario.processes.map((process) => [process.id, text(process.name)]))
  const baselineStart = new Map(baselineEntries.map((entry) => [entry.process_id, time(entry.starts_at)]))
  const moved = new Set(optimizedEntries.filter((entry) => {
    const before = baselineStart.get(entry.process_id)
    const after = time(entry.starts_at)
    return before !== null && before !== undefined && after !== null && Math.abs(after - before) >= 60_000
  }).map((entry) => entry.process_id))
  const order: string[] = []
  for (const entry of [...baselineEntries, ...optimizedEntries]) {
    if (typeof entry.machine_id === 'string' && !order.includes(entry.machine_id)) order.push(entry.machine_id)
  }
  const machineNames = new Map(scenario.machines.map((machine) => [machine.id, text(machine.name)]))
  const blocks = (entries: JsonRecord[], machineId: string) => entries.flatMap((entry) => {
    const start = time(entry.starts_at)
    const end = time(entry.ends_at)
    if (entry.machine_id !== machineId || start === null || end === null || end <= start) return []
    return [{ id: text(entry.id), label: text(processNames.get(entry.process_id)), start, end, moved: moved.has(entry.process_id), powerKw: toNumber(entry.power_kw) }]
  })
  const width = Math.max(2, String(order.length).length)
  const lanes = order.map((machineId, index) => ({
    id: machineId,
    code: `M${String(index + 1).padStart(width, '0')}`,
    name: text(machineNames.get(machineId)),
    baseline: blocks(baselineEntries, machineId),
    optimized: blocks(optimizedEntries, machineId),
  }))
  const all = lanes.flatMap((lane) => [...lane.baseline, ...lane.optimized])
  if (all.length === 0) return { lanes, window: null }
  const start = Math.floor(Math.min(...all.map((block) => block.start)) / HOUR_MS) * HOUR_MS - HOUR_MS
  const end = Math.ceil(Math.max(...all.map((block) => block.end)) / HOUR_MS) * HOUR_MS + HOUR_MS
  return { lanes, window: { start, end } }
}
