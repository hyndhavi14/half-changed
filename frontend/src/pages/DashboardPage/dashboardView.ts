// Phase 4 - Dashboard view helpers.
// Pure functions only: no React, no network, no value imports (node:test safe).
// Every value is derived from persisted backend data. Nothing is invented.
import type { BackendFactoryData } from '../../data/backendApi'
import type { CompareMetric } from '../../data/types'

export type StoredSchedule = BackendFactoryData['schedules'][number]
type ScheduleEntry = StoredSchedule['entries'][number]
export type DeltaTone = 'good' | 'bad' | 'neutral'
export type TariffBand = 'peak' | 'mid' | 'off'
export type MetricKey = 'cost' | 'energy' | 'solar' | 'makespan' | 'peak'

export const NOT_AVAILABLE = 'Not available'
const HOUR_MS = 3_600_000
const DAY_MINUTES = 1440

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

function formatNumber(value: number, digits = 1): string {
  return value.toLocaleString('en-GB', { maximumFractionDigits: digits, minimumFractionDigits: 0 })
}

function entryMetadata(entry: ScheduleEntry): Record<string, unknown> | null {
  const metadata: unknown = Reflect.get(entry, 'metadata')
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) return null
  return metadata as Record<string, unknown>
}

// ---------------------------------------------------------------- schedule metrics

export function makespanHours(schedule: StoredSchedule | undefined): number | null {
  if (!schedule) return null
  let first = Infinity
  let last = -Infinity
  for (const entry of schedule.entries) {
    const start = toTime(entry.startsAt)
    const end = toTime(entry.endsAt)
    if (start === null || end === null || end <= start) continue
    first = Math.min(first, start)
    last = Math.max(last, end)
  }
  return Number.isFinite(first) ? (last - first) / HOUR_MS : null
}

export function plannedPeakKw(schedule: StoredSchedule | undefined): number | null {
  if (!schedule) return null
  const events: Array<[number, number]> = []
  for (const entry of schedule.entries) {
    const start = toTime(entry.startsAt)
    const end = toTime(entry.endsAt)
    const power = toNumber(entry.powerKw)
    if (start === null || end === null || end <= start || power === null) continue
    events.push([start, power], [end, -power])
  }
  if (events.length === 0) return null
  events.sort((left, right) => left[0] - right[0] || left[1] - right[1])
  let running = 0
  let peak = 0
  for (const [, delta] of events) {
    running += delta
    peak = Math.max(peak, running)
  }
  return peak
}

export function solarSharePct(schedule: StoredSchedule | undefined): number | null {
  if (!schedule) return null
  let solar = 0
  let grid = 0
  let counted = 0
  for (const entry of schedule.entries) {
    const metadata = entryMetadata(entry)
    if (!metadata) continue
    const solarKwh = toNumber(metadata.solar_kwh)
    const gridKwh = toNumber(metadata.grid_kwh)
    if (solarKwh === null || gridKwh === null) continue
    solar += solarKwh
    grid += gridKwh
    counted += 1
  }
  const total = solar + grid
  if (counted === 0 || total <= 0) return null
  return (solar / total) * 100
}

interface MetricDefinition {
  key: MetricKey
  label: string
  better: 'lower' | 'higher'
  points: boolean
  read: (schedule: StoredSchedule | undefined) => number | null
  format: (value: number, currency: string) => string
}

const METRICS: Record<MetricKey, MetricDefinition> = {
  cost: {
    key: 'cost', label: 'Energy cost', better: 'lower', points: false,
    read: (schedule) => toNumber(schedule?.totalEnergyCost),
    format: (value, currency) => `${currency} ${formatNumber(value, 2)}`,
  },
  energy: {
    key: 'energy', label: 'Planned energy', better: 'lower', points: false,
    read: (schedule) => toNumber(schedule?.totalEnergyKwh),
    format: (value) => `${formatNumber(value)} kWh`,
  },
  solar: {
    key: 'solar', label: 'Solar share', better: 'higher', points: true,
    read: solarSharePct,
    format: (value) => `${formatNumber(value)}%`,
  },
  makespan: {
    key: 'makespan', label: 'Makespan', better: 'lower', points: false,
    read: makespanHours,
    format: (value) => `${formatNumber(value)} h`,
  },
  peak: {
    key: 'peak', label: 'Peak planned load', better: 'lower', points: false,
    read: plannedPeakKw,
    format: (value) => `${formatNumber(value)} kW`,
  },
}

export interface MetricPair {
  key: MetricKey
  label: string
  better: 'lower' | 'higher'
  baseline: number | null
  optimized: number | null
}

export function metricPair(
  key: MetricKey,
  baseline: StoredSchedule | undefined,
  optimized: StoredSchedule | undefined,
): MetricPair {
  const definition = METRICS[key]
  return {
    key,
    label: definition.label,
    better: definition.better,
    baseline: definition.read(baseline),
    optimized: definition.read(optimized),
  }
}

export function deltaTone(pair: MetricPair): DeltaTone {
  if (pair.baseline === null || pair.optimized === null) return 'neutral'
  const diff = pair.optimized - pair.baseline
  if (Math.abs(diff) < 1e-9) return 'neutral'
  const improved = pair.better === 'lower' ? diff < 0 : diff > 0
  return improved ? 'good' : 'bad'
}

export function deltaText(pair: MetricPair): string | undefined {
  if (pair.baseline === null || pair.optimized === null) return undefined
  const diff = pair.optimized - pair.baseline
  if (Math.abs(diff) < 1e-9) return 'No change vs baseline'
  if (METRICS[pair.key].points) {
    return `${diff > 0 ? '+' : '\u2212'}${formatNumber(Math.abs(diff))} pp vs baseline`
  }
  if (pair.baseline === 0) return 'Baseline is zero'
  const pct = (diff / Math.abs(pair.baseline)) * 100
  return `${pct > 0 ? '+' : '\u2212'}${formatNumber(Math.abs(pct))}% vs baseline`
}

export interface KpiView {
  key: MetricKey
  label: string
  value: string
  delta?: string
  deltaTone: DeltaTone
  note: string
}

export const KPI_KEYS: readonly MetricKey[] = ['cost', 'solar', 'makespan', 'peak']

export function kpiViews(
  baseline: StoredSchedule | undefined,
  optimized: StoredSchedule | undefined,
  currency: string,
): KpiView[] {
  return KPI_KEYS.map((key) => {
    const pair = metricPair(key, baseline, optimized)
    const definition = METRICS[key]
    // Short delta pill plus a short note keep the original KPI card shape; the Modeled tag is shown separately.
    let note = 'vs baseline schedule'
    if (!optimized) note = 'No optimized schedule yet'
    else if (pair.optimized === null) note = 'Not recorded on the optimized schedule'
    else if (pair.baseline === null) note = 'No baseline value to compare'
    const fullDelta = deltaText(pair)
    return {
      key,
      label: definition.label,
      value: pair.optimized === null ? NOT_AVAILABLE : definition.format(pair.optimized, currency),
      delta: fullDelta?.replace(/ vs baseline$/, ''),
      deltaTone: deltaTone(pair),
      note: fullDelta === 'Baseline is zero' ? 'Baseline value is zero' : note,
    }
  })
}

export const COMPARE_KEYS: readonly MetricKey[] = ['energy', 'cost', 'solar', 'makespan', 'peak']

export function compareMetrics(
  baseline: StoredSchedule | undefined,
  optimized: StoredSchedule | undefined,
  currency: string,
): CompareMetric[] {
  if (!baseline || !optimized) return []
  const metrics: CompareMetric[] = []
  for (const key of COMPARE_KEYS) {
    const pair = metricPair(key, baseline, optimized)
    if (pair.baseline === null || pair.optimized === null || pair.baseline < 0 || pair.optimized < 0) continue
    const definition = METRICS[key]
    const largest = Math.max(pair.baseline, pair.optimized)
    const diff = pair.optimized - pair.baseline
    let change = 'No change'
    if (Math.abs(diff) >= 1e-9) {
      const direction = diff < 0 ? 'lower' : 'higher'
      if (definition.points) change = `${formatNumber(Math.abs(diff))} pp ${direction}`
      else if (pair.baseline === 0) change = 'Baseline is zero'
      else change = `${formatNumber(Math.abs(diff / pair.baseline) * 100)}% ${direction}`
    }
    metrics.push({
      label: definition.label,
      baseline: definition.format(pair.baseline, currency),
      optimized: definition.format(pair.optimized, currency),
      baselinePct: largest === 0 ? 100 : (pair.baseline / largest) * 100,
      optimizedPct: largest === 0 ? 100 : (pair.optimized / largest) * 100,
      change,
    })
  }
  return metrics
}

export function recordCountsCaption(data: Pick<BackendFactoryData, 'machines' | 'processes' | 'schedules' | 'energy'>): string {
  return `Persisted records: ${data.machines.length} machines \u00b7 ${data.processes.length} processes \u00b7 ` +
    `${data.schedules.length} schedules \u00b7 ${data.energy.length} energy readings`
}

// ---------------------------------------------------------------- energy

export function localDay(time: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(time))
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '00'
  return `${part('year')}-${part('month')}-${part('day')}`
}

export function energyDays(rows: readonly Record<string, unknown>[], timeZone: string): string[] {
  const days = new Set<string>()
  for (const row of rows) {
    const time = toTime(row.recorded_at)
    if (time !== null) days.add(localDay(time, timeZone))
  }
  return [...days].sort()
}

export function rowsForDay(
  rows: readonly Record<string, unknown>[],
  timeZone: string,
  day: string,
): Record<string, unknown>[] {
  return rows.filter((row) => {
    const time = toTime(row.recorded_at)
    return time !== null && localDay(time, timeZone) === day
  })
}

export type EnergySourceLabel = 'Measured' | 'Simulated' | 'Modeled' | 'Recorded' | 'Mixed sources' | 'Not available'

export function energySourceLabel(rows: readonly Record<string, unknown>[]): EnergySourceLabel {
  const labels = new Set<EnergySourceLabel>()
  for (const row of rows) {
    const source = typeof row.source === 'string' ? row.source : 'measured'
    if (source === 'measured') labels.add('Measured')
    else if (source === 'simulated') labels.add('Simulated')
    else if (source.startsWith('modeled')) labels.add('Modeled')
    else labels.add('Recorded')
  }
  if (labels.size === 0) return 'Not available'
  if (labels.size > 1) return 'Mixed sources'
  return [...labels][0]
}

export function energySourceNote(label: EnergySourceLabel): string {
  switch (label) {
    case 'Measured': return 'Source: measured meter readings stored for this factory.'
    case 'Simulated': return 'Source: simulated demo readings (seed data), not meter telemetry.'
    case 'Modeled': return 'Source: modeled values (NASA POWER based), not site measurements.'
    case 'Recorded': return 'Source: recorded readings with an unlabelled source.'
    case 'Mixed sources': return 'Source: mixed (measured, simulated or modeled rows on the same day).'
    default: return 'No energy readings are stored for this day.'
  }
}

// ---------------------------------------------------------------- tariffs

export interface TariffWindow {
  startMinute: number
  endMinute: number
  price: number
  priority: number
  isoDays: number[] | null
  effectiveFrom: number | null
  effectiveTo: number | null
  label: TariffBand | null
}

function parseClock(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim())
  if (!match) return null
  const minutes = Number(match[1]) * 60 + Number(match[2])
  return minutes >= 0 && minutes <= DAY_MINUTES ? minutes : null
}

// Band label stored by the backend in tariff metadata.band (e.g. seed data), when recognised.
function metadataBand(value: unknown): TariffBand | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const band = (value as Record<string, unknown>).band
  if (typeof band !== 'string') return null
  const key = band.trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (key === 'peak') return 'peak'
  if (key === 'off_peak' || key === 'offpeak' || key === 'off') return 'off'
  if (key === 'shoulder' || key === 'mid' || key === 'standard') return 'mid'
  return null
}

// Mirrors backend/lib/optimizer/pythonPayload.ts buildTariffProfile:
// demand-only rows (energy price 0 with a demand or fixed charge) are not energy-price windows.
export function tariffWindows(rows: readonly Record<string, unknown>[]): TariffWindow[] {
  const windows: TariffWindow[] = []
  for (const row of rows) {
    const start = parseClock(row.start_time)
    const end = parseClock(row.end_time)
    const price = toNumber(row.energy_price_per_kwh)
    if (start === null || end === null || price === null) continue
    const demandOnly = price === 0 &&
      ((toNumber(row.demand_charge_per_kw) ?? 0) > 0 || (toNumber(row.fixed_charge) ?? 0) > 0)
    if (demandOnly) continue
    const days = Array.isArray(row.days_of_week)
      ? row.days_of_week.map(toNumber).filter((day): day is number => day !== null)
      : null
    windows.push({
      startMinute: start,
      endMinute: end,
      price,
      priority: toNumber(row.priority) ?? 0,
      isoDays: days && days.length > 0 ? days : null,
      effectiveFrom: toTime(row.effective_from),
      effectiveTo: toTime(row.effective_to),
      label: metadataBand(row.metadata),
    })
  }
  return windows
}

function windowCovers(window: TariffWindow, minute: number): boolean {
  if (window.startMinute < window.endMinute) return minute >= window.startMinute && minute < window.endMinute
  return minute >= window.startMinute || minute < window.endMinute
}

export function bandForPrice(windows: readonly TariffWindow[], price: number): TariffBand | null {
  const prices = [...new Set(windows.map((window) => window.price))].sort((a, b) => a - b)
  if (prices.length < 2) return null
  if (price >= prices[prices.length - 1]) return 'peak'
  if (price <= prices[0]) return 'off'
  return 'mid'
}

// Highest priority wins, as in the backend optimizer payload. A tie at the highest
// priority is ambiguous in the backend, so no band is shown.
export function dashboardTariffBand(
  windows: readonly TariffWindow[],
  minuteOfDay: number,
  isoWeekday: number,
  instant: number | null,
): TariffBand | null {
  const active = windows.filter((window) =>
    windowCovers(window, minuteOfDay) &&
    (window.isoDays === null || window.isoDays.includes(isoWeekday)) &&
    (instant === null || window.effectiveFrom === null || instant >= window.effectiveFrom) &&
    (instant === null || window.effectiveTo === null || instant < window.effectiveTo))
  if (active.length === 0) return null
  const top = Math.max(...active.map((window) => window.priority))
  const highest = active.filter((window) => window.priority === top)
  if (highest.length !== 1) return null
  const chosen = highest[0]
  return chosen.label ?? bandForPrice(windows, chosen.price)
}

export interface BandSegment {
  band: TariffBand
  startFraction: number
  endFraction: number
}

function mergeSamples(samples: Array<TariffBand | null>): BandSegment[] {
  const segments: BandSegment[] = []
  const step = 1 / samples.length
  samples.forEach((band, index) => {
    if (band === null) return
    const last = segments[segments.length - 1]
    if (last && last.band === band && Math.abs(last.endFraction - index * step) < 1e-9) {
      last.endFraction = (index + 1) * step
    } else {
      segments.push({ band, startFraction: index * step, endFraction: (index + 1) * step })
    }
  })
  return segments
}

export function daySegments(windows: readonly TariffWindow[], day: string): BandSegment[] {
  const utcDay = new Date(`${day}T12:00:00Z`).getUTCDay()
  const isoWeekday = utcDay === 0 ? 7 : utcDay
  const samples: Array<TariffBand | null> = []
  for (let slot = 0; slot < 48; slot += 1) {
    samples.push(dashboardTariffBand(windows, slot * 30 + 15, isoWeekday, null))
  }
  return mergeSamples(samples)
}

const ISO_WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }

export function horizonSegments(
  windows: readonly TariffWindow[],
  horizonStart: number,
  horizonEnd: number,
  timeZone: string,
  sampleCount = 96,
): BandSegment[] {
  if (!(horizonEnd > horizonStart) || windows.length === 0) return []
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone, hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
  })
  const samples: Array<TariffBand | null> = []
  const step = (horizonEnd - horizonStart) / sampleCount
  for (let index = 0; index < sampleCount; index += 1) {
    const instant = horizonStart + step * (index + 0.5)
    const parts = formatter.formatToParts(new Date(instant))
    const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0)
    const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0)
    const weekday = ISO_WEEKDAY[parts.find((part) => part.type === 'weekday')?.value ?? 'Mon'] ?? 1
    samples.push(dashboardTariffBand(windows, hour * 60 + minute, weekday, instant))
  }
  return mergeSamples(samples)
}

// ---------------------------------------------------------------- schedule preview

export interface GanttBlockView {
  id: string
  machineId: string
  processId: string
  processName: string
  colorIndex: number
  leftFraction: number
  widthFraction: number
  startHour: number
  endHour: number
  shifted: boolean
  tooltip: string
}

export interface GanttRowView {
  machineId: string
  machineName: string
  blocks: GanttBlockView[]
}

export function processColorIndex(data: Pick<BackendFactoryData, 'processes'>, processId: string): number {
  const index = data.processes.findIndex((process) => process.id === processId)
  return (index < 0 ? 0 : index) % 8
}

export function ganttRows(
  data: Pick<BackendFactoryData, 'machines' | 'processes' | 'factory'>,
  schedule: StoredSchedule,
  baseline: StoredSchedule | undefined,
): GanttRowView[] {
  const horizonStart = toTime(schedule.horizonStart)
  const horizonEnd = toTime(schedule.horizonEnd)
  if (horizonStart === null || horizonEnd === null || horizonEnd <= horizonStart) return []
  const duration = horizonEnd - horizonStart
  const timeZone = data.factory.timezone
  const clock = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const baselineStarts = new Map(
    (baseline?.entries ?? []).map((entry) => [`${entry.processId}|${entry.machineId}`, toTime(entry.startsAt)]),
  )
  const rows = new Map<string, GanttRowView>()

  for (const entry of schedule.entries) {
    const start = toTime(entry.startsAt)
    const end = toTime(entry.endsAt)
    if (start === null || end === null || end <= start) continue
    const left = Math.max(0, (start - horizonStart) / duration)
    const right = Math.min(1, (end - horizonStart) / duration)
    if (right <= 0 || left >= 1 || right <= left) continue
    const machineName = data.machines.find((machine) => machine.id === entry.machineId)?.name ??
      `Unknown machine (${entry.machineId})`
    const processName = data.processes.find((process) => process.id === entry.processId)?.name ??
      `Unknown process (${entry.processId})`
    const baselineStart = baselineStarts.get(`${entry.processId}|${entry.machineId}`)
    const shifted = baselineStart !== undefined && baselineStart !== null && baselineStart !== start
    const row = rows.get(entry.machineId) ?? { machineId: entry.machineId, machineName, blocks: [] }
    row.blocks.push({
      id: entry.id,
      machineId: entry.machineId,
      processId: entry.processId,
      processName,
      colorIndex: processColorIndex(data, entry.processId),
      leftFraction: left,
      widthFraction: right - left,
      startHour: left * 24,
      endHour: right * 24,
      shifted,
      tooltip: `${processName} \u00b7 ${machineName} \u00b7 ${clock.format(new Date(start))}\u2013${clock.format(new Date(end))} (${timeZone})` +
        (shifted ? ' \u00b7 moved from baseline' : ''),
    })
    rows.set(entry.machineId, row)
  }

  const order = new Map(data.machines.map((machine, index) => [machine.id, index]))
  return [...rows.values()].sort((a, b) => (order.get(a.machineId) ?? 1e9) - (order.get(b.machineId) ?? 1e9))
}

export function horizonTicks(schedule: StoredSchedule, timeZone: string): string[] {
  const start = toTime(schedule.horizonStart)
  const end = toTime(schedule.horizonEnd)
  if (start === null || end === null || end <= start) return []
  const clock = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  return [0, 0.25, 0.5, 0.75, 1].map((fraction) => clock.format(new Date(start + (end - start) * fraction)))
}

// ---------------------------------------------------------------- machines

export function plannedLoadPct(schedule: StoredSchedule | undefined, machineId: string): number | null {
  if (!schedule) return null
  const horizonStart = toTime(schedule.horizonStart)
  const horizonEnd = toTime(schedule.horizonEnd)
  if (horizonStart === null || horizonEnd === null || horizonEnd <= horizonStart) return null
  const intervals: Array<[number, number]> = []
  for (const entry of schedule.entries) {
    if (entry.machineId !== machineId) continue
    const start = toTime(entry.startsAt)
    const end = toTime(entry.endsAt)
    if (start === null || end === null || end <= start) continue
    const clippedStart = Math.max(start, horizonStart)
    const clippedEnd = Math.min(end, horizonEnd)
    if (clippedEnd > clippedStart) intervals.push([clippedStart, clippedEnd])
  }
  intervals.sort((a, b) => a[0] - b[0])
  let busy = 0
  let cursor = -Infinity
  for (const [start, end] of intervals) {
    const from = Math.max(start, cursor)
    if (end > from) busy += end - from
    cursor = Math.max(cursor, end)
  }
  return Math.min(100, (busy / (horizonEnd - horizonStart)) * 100)
}

// ---------------------------------------------------------------- dashboard preview window

/**
 * The Dashboard preview shows only the part of the horizon that contains work (whole hours),
 * plus one hour either side, so a multi-day horizon does not shrink the blocks to slivers. The full horizon stays on the Schedule page.
 */
export function activeWindow(schedule: StoredSchedule): StoredSchedule {
  const horizonStart = toTime(schedule.horizonStart)
  const horizonEnd = toTime(schedule.horizonEnd)
  if (horizonStart === null || horizonEnd === null || horizonEnd <= horizonStart) return schedule
  let first = Infinity
  let last = -Infinity
  for (const entry of schedule.entries) {
    const start = toTime(entry.startsAt)
    const end = toTime(entry.endsAt)
    if (start === null || end === null || end <= start) continue
    first = Math.min(first, start)
    last = Math.max(last, end)
  }
  if (!Number.isFinite(first)) return schedule
  // One hour of padding on each side keeps the first and last blocks clear of the track edges.
  const start = Math.max(horizonStart, Math.floor(first / HOUR_MS) * HOUR_MS - HOUR_MS)
  const end = Math.min(horizonEnd, Math.ceil(last / HOUR_MS) * HOUR_MS + HOUR_MS)
  if (end <= start || (start === horizonStart && end === horizonEnd)) return schedule
  return { ...schedule, horizonStart: new Date(start).toISOString(), horizonEnd: new Date(end).toISOString() }
}
