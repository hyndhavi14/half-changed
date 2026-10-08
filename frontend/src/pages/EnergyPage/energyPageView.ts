// Phase 6 - Energy page view helpers.
// Pure functions only (no React). Values come from persisted backend data; nothing is invented.
import type { BackendFactoryData } from '../../data/backendApi'
import type { EnergyChartPoint } from '../../components/EnergyChart/EnergyChart'
import {
  NOT_AVAILABLE,
  dashboardTariffBand,
  localDay,
  tariffWindows,
  type StoredSchedule,
  type TariffBand,
  type TariffWindow,
} from '../DashboardPage/dashboardView.ts'

type Entry = StoredSchedule['entries'][number]
const MINUTE_MS = 60_000
const SLICE_MINUTES = 5

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function toTime(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const time = Date.parse(value)
  return Number.isFinite(time) ? time : null
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export function formatNumber(value: number, digits = 1): string {
  return value.toLocaleString('en-GB', { maximumFractionDigits: digits, minimumFractionDigits: 0 })
}

export function formatEnergy(value: number | null): string {
  return value === null ? NOT_AVAILABLE : `${formatNumber(value)} kWh`
}

/** Money with the currency's own symbol (₹, €) as stored; never converted. */
export function formatMoney(value: number | null, currency: string): string {
  if (value === null) return NOT_AVAILABLE
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
  } catch {
    return `${currency} ${formatNumber(value, 2)}`
  }
}

// ---------------------------------------------------------------- recorded readings

const HOUR_FORMAT = new Map<string, Intl.DateTimeFormat>()
function hourFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = HOUR_FORMAT.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' })
    HOUR_FORMAT.set(timeZone, formatter)
  }
  return formatter
}

/** The local day with the most readings (latest wins a tie), so a partial last day is not the default. */
export function defaultEnergyDay(rows: readonly Record<string, unknown>[], timeZone: string): string | undefined {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const time = toTime(row.recorded_at)
    if (time === null) continue
    const day = localDay(time, timeZone)
    counts.set(day, (counts.get(day) ?? 0) + 1)
  }
  let best: string | undefined
  let bestCount = -1
  for (const day of [...counts.keys()].sort()) {
    const count = counts.get(day) ?? 0
    if (count >= bestCount) {
      best = day
      bestCount = count
    }
  }
  return best
}

/** 24 points for one local day. Hours without readings stay null and are drawn as "no reading". */
export function fullDayPoints(rows: readonly Record<string, unknown>[], timeZone: string, day: string): EnergyChartPoint[] {
  const points: EnergyChartPoint[] = Array.from({ length: 24 }, (_, hour) => ({ hour, generationKwh: null, consumptionKwh: null }))
  for (const row of rows) {
    const time = toTime(row.recorded_at)
    if (time === null || localDay(time, timeZone) !== day) continue
    const generation = toNumber(row.generation_kwh)
    const consumption = toNumber(row.consumption_kwh)
    if (generation === null || consumption === null) continue
    const hour = Number(hourFormatter(timeZone).format(new Date(time)))
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) continue
    const point = points[hour]
    point.generationKwh = round((point.generationKwh ?? 0) + generation, 4)
    point.consumptionKwh = round((point.consumptionKwh ?? 0) + consumption, 4)
  }
  return points
}

function isoWeekdayOfDay(day: string): number {
  const utcDay = new Date(`${day}T12:00:00Z`).getUTCDay()
  return utcDay === 0 ? 7 : utcDay
}

/** Tariff band at the middle of each local hour of a day, resolved like the backend optimizer payload. */
export function dayTariffBands(windows: readonly TariffWindow[], day: string): Array<TariffBand | null> {
  const weekday = isoWeekdayOfDay(day)
  return Array.from({ length: 24 }, (_, hour) => dashboardTariffBand(windows, hour * 60 + 30, weekday, null))
}

export interface ReadingsSummary {
  count: number
  consumptionKwh: number | null
  generationKwh: number | null
  intervalMinutes: number[]
  firstDay: string | null
  lastDay: string | null
}

export function readingsSummary(rows: readonly Record<string, unknown>[], timeZone: string): ReadingsSummary {
  let consumption: number | null = null
  let generation: number | null = null
  const intervals = new Set<number>()
  let first: number | null = null
  let last: number | null = null
  for (const row of rows) {
    const c = toNumber(row.consumption_kwh)
    const g = toNumber(row.generation_kwh)
    if (c !== null) consumption = (consumption ?? 0) + c
    if (g !== null) generation = (generation ?? 0) + g
    const interval = toNumber(row.interval_minutes)
    if (interval !== null) intervals.add(interval)
    const time = toTime(row.recorded_at)
    if (time !== null) {
      first = first === null ? time : Math.min(first, time)
      last = last === null ? time : Math.max(last, time)
    }
  }
  return {
    count: rows.length,
    consumptionKwh: consumption === null ? null : round(consumption),
    generationKwh: generation === null ? null : round(generation),
    intervalMinutes: [...intervals].sort((a, b) => a - b),
    firstDay: first === null ? null : localDay(first, timeZone),
    lastDay: last === null ? null : localDay(last, timeZone),
  }
}

export function readingsSummaryText(summary: ReadingsSummary): string {
  if (summary.count === 0) return 'No energy readings are stored for this factory.'
  const interval = summary.intervalMinutes.length === 1
    ? `${summary.intervalMinutes[0]}-minute intervals`
    : summary.intervalMinutes.length > 1 ? `mixed intervals (${summary.intervalMinutes.join(', ')} min)` : 'interval not recorded'
  const range = summary.firstDay && summary.lastDay
    ? (summary.firstDay === summary.lastDay ? summary.firstDay : `${summary.firstDay} to ${summary.lastDay}`)
    : 'dates not recorded'
  return `${summary.count} stored readings, ${interval}, ${range}. ` +
    `Total consumption ${formatEnergy(summary.consumptionKwh)}, total generation ${formatEnergy(summary.generationKwh)}.`
}

// ---------------------------------------------------------------- planned (optimized schedule) energy

export interface PlannedTotals {
  totalKwh: number | null
  solarKwh: number | null
  gridKwh: number | null
  cost: number | null
  solarSharePct: number | null
}

function entryMetadata(entry: Entry): Record<string, unknown> | null {
  const metadata: unknown = Reflect.get(entry, 'metadata')
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) return null
  return metadata as Record<string, unknown>
}

/** Solar/grid totals are only reported when every entry carries both optimizer values. */
export function plannedTotals(schedule: StoredSchedule | undefined): PlannedTotals {
  if (!schedule) return { totalKwh: null, solarKwh: null, gridKwh: null, cost: null, solarSharePct: null }
  let solar = 0
  let grid = 0
  let complete = schedule.entries.length > 0
  for (const entry of schedule.entries) {
    const metadata = entryMetadata(entry)
    const s = toNumber(metadata?.solar_kwh)
    const g = toNumber(metadata?.grid_kwh)
    if (s === null || g === null) {
      complete = false
      break
    }
    solar += s
    grid += g
  }
  const solarKwh = complete ? round(solar) : null
  const gridKwh = complete ? round(grid) : null
  const split = solarKwh !== null && gridKwh !== null ? solarKwh + gridKwh : null
  return {
    totalKwh: toNumber(schedule.totalEnergyKwh),
    solarKwh,
    gridKwh,
    cost: toNumber(schedule.totalEnergyCost),
    solarSharePct: split !== null && split > 0 && solarKwh !== null ? (solarKwh / split) * 100 : null,
  }
}

// ---------------------------------------------------------------- planned energy by tariff band

export type BandKey = TariffBand | 'none'

export interface BandAllocation {
  band: BandKey
  label: string
  kwh: number
  cost: number | null
  sharePct: number
}

export const BAND_LABELS: Record<BandKey, string> = { peak: 'Peak', mid: 'Mid', off: 'Off-peak', none: 'No tariff window' }

const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }
const CLOCK_FORMAT = new Map<string, Intl.DateTimeFormat>()
function localClock(instant: number, timeZone: string): { minute: number; weekday: number } {
  let formatter = CLOCK_FORMAT.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' })
    CLOCK_FORMAT.set(timeZone, formatter)
  }
  const parts = formatter.formatToParts(new Date(instant))
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0)
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? 0)
  const weekday = WEEKDAY[parts.find((part) => part.type === 'weekday')?.value ?? 'Mon'] ?? 1
  return { minute: hour * 60 + minute, weekday }
}

/**
 * Splits each optimized entry into 5-minute slices and assigns them to the tariff band in force.
 * Energy is split by time (entries run at constant power). Entry cost is also split by time, which is
 * exact for entries inside one band and an approximation for entries that span two bands.
 */
export function bandAllocation(
  data: Pick<BackendFactoryData, 'tariffs' | 'factory'>,
  schedule: StoredSchedule | undefined,
): { rows: BandAllocation[]; spanningEntries: number; totalKwh: number } {
  const totals = new Map<BandKey, { kwh: number; cost: number; costKnown: boolean }>()
  const windows = tariffWindows(data.tariffs)
  let spanning = 0
  let total = 0
  for (const entry of schedule?.entries ?? []) {
    const start = toTime(entry.startsAt)
    const end = toTime(entry.endsAt)
    if (start === null || end === null || end <= start) continue
    const minutes = (end - start) / MINUTE_MS
    const power = toNumber(entry.powerKw)
    const energy = toNumber(entry.energyKwh) ?? (power === null ? null : (power * minutes) / 60)
    if (energy === null) continue
    const cost = toNumber(entry.cost)
    const bandsSeen = new Set<BandKey>()
    for (let offset = 0; offset < minutes; offset += SLICE_MINUTES) {
      const slice = Math.min(SLICE_MINUTES, minutes - offset)
      const instant = start + (offset + slice / 2) * MINUTE_MS
      const clock = localClock(instant, data.factory.timezone)
      const band: BandKey = windows.length ? (dashboardTariffBand(windows, clock.minute, clock.weekday, instant) ?? 'none') : 'none'
      bandsSeen.add(band)
      const bucket = totals.get(band) ?? { kwh: 0, cost: 0, costKnown: true }
      bucket.kwh += energy * (slice / minutes)
      if (cost === null) bucket.costKnown = false
      else bucket.cost += cost * (slice / minutes)
      totals.set(band, bucket)
    }
    if (bandsSeen.size > 1) spanning += 1
    total += energy
  }
  const order: BandKey[] = ['peak', 'mid', 'off', 'none']
  const rows = order
    .filter((band) => band !== 'none' || totals.has('none'))
    .filter((band) => windows.length > 0 || band === 'none')
    .map((band) => {
      const bucket = totals.get(band)
      const kwh = bucket ? round(bucket.kwh) : 0
      return {
        band,
        label: BAND_LABELS[band],
        kwh,
        cost: bucket ? (bucket.costKnown ? round(bucket.cost) : null) : 0,
        sharePct: total > 0 ? (kwh / total) * 100 : 0,
      }
    })
  return { rows, spanningEntries: spanning, totalKwh: round(total) }
}

// ---------------------------------------------------------------- tariff windows (as configured)

const DAY_NAMES = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function daysText(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return 'Every day'
  const days = value.map(toNumber).filter((day): day is number => day !== null && day >= 1 && day <= 7).sort((a, b) => a - b)
  if (days.length === 0) return 'Every day'
  if (days.length === 7) return 'Every day'
  const contiguous = days.every((day, index) => index === 0 || day === days[index - 1] + 1)
  if (contiguous && days.length > 2) return `${DAY_NAMES[days[0]]}–${DAY_NAMES[days[days.length - 1]]}`
  return days.map((day) => DAY_NAMES[day]).join(', ')
}

function clockText(value: unknown): string {
  if (typeof value !== 'string') return '--:--'
  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim())
  return match ? `${match[1].padStart(2, '0')}:${match[2]}` : '--:--'
}

export interface TariffWindowLine {
  band: BandKey
  text: string
}

/** One line per configured energy-price window, grouped later by the band it resolves to. */
export function tariffWindowLines(data: Pick<BackendFactoryData, 'tariffs' | 'factory'>): TariffWindowLine[] {
  const windows = tariffWindows(data.tariffs)
  const lines: TariffWindowLine[] = []
  for (const row of data.tariffs) {
    const price = toNumber(row.energy_price_per_kwh)
    if (price === null) continue
    const demandOnly = price === 0 &&
      ((toNumber(row.demand_charge_per_kw) ?? 0) > 0 || (toNumber(row.fixed_charge) ?? 0) > 0)
    if (demandOnly) continue
    const parsed = tariffWindows([row])[0]
    let band: BandKey = 'none'
    if (parsed) {
      band = parsed.label ?? (() => {
        const prices = [...new Set(windows.map((window) => window.price))].sort((a, b) => a - b)
        if (prices.length < 2) return 'none' as BandKey
        if (price >= prices[prices.length - 1]) return 'peak' as BandKey
        if (price <= prices[0]) return 'off' as BandKey
        return 'mid' as BandKey
      })()
    }
    const name = typeof row.name === 'string' && row.name.trim() ? row.name.trim() : 'Unnamed tariff'
    const currency = typeof row.currency === 'string' ? row.currency : data.factory.currency
    lines.push({
      band,
      text: `${name}: ${daysText(row.days_of_week)} ${clockText(row.start_time)}–${clockText(row.end_time)} · ${formatNumber(price, 4)} ${currency}/kWh`,
    })
  }
  return lines
}

/** Charges stored on tariffs that the optimizer's modeled energy cost does not include. */
export function excludedChargesNote(data: Pick<BackendFactoryData, 'tariffs' | 'factory'>): string | null {
  const parts: string[] = []
  const demand = new Set<string>()
  const fixed = new Set<string>()
  const tax = new Set<string>()
  for (const row of data.tariffs) {
    const currency = typeof row.currency === 'string' ? row.currency : data.factory.currency
    const d = toNumber(row.demand_charge_per_kw)
    const f = toNumber(row.fixed_charge)
    const t = toNumber(row.tax_rate)
    if (d !== null && d > 0) demand.add(`${formatNumber(d, 2)} ${currency}/kW`)
    if (f !== null && f > 0) fixed.add(`${formatNumber(f, 2)} ${currency}`)
    if (t !== null && t > 0) tax.add(`${formatNumber(t * 100, 2)}%`)
  }
  if (demand.size) parts.push(`demand charge ${[...demand].join(', ')}`)
  if (fixed.size) parts.push(`fixed charge ${[...fixed].join(', ')}`)
  if (tax.size) parts.push(`tax ${[...tax].join(', ')}`)
  if (parts.length === 0) return null
  return `Configured ${parts.join(', ')} ${parts.length === 1 ? 'is' : 'are'} not included in the modeled energy cost, so it is not an electricity bill.`
}
