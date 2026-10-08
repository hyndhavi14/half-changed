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
