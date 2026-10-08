import { energySourceProvenance, type Provenance } from './provenance.ts'

export interface HourlyEnergyPoint {
  hour: number
  generationKwh: number | null
  consumptionKwh: number | null
}

interface EnergyReading {
  recordedAt: string
  generationKwh: number | null
  consumptionKwh: number | null
  source: unknown
  timestamp: number
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function partsAt(iso: string, timeZone: string): Record<string, string> | null {
  const at = Date.parse(iso)
  if (!Number.isFinite(at)) return null
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(at)
    return Object.fromEntries(parts.map((part) => [part.type, part.value]))
  } catch {
    return null
  }
}

function dayKey(parts: Record<string, string>): string {
  return `${parts.year}-${parts.month}-${parts.day}`
}

function readingsForDay(
  rows: readonly Record<string, unknown>[],
  timeZone: string,
): Array<EnergyReading & { localDay: string; hour: number }> {
  const output: Array<EnergyReading & { localDay: string; hour: number }> = []
  for (const row of rows) {
    if (typeof row.recorded_at !== 'string') continue
    const timestamp = Date.parse(row.recorded_at)
    const parts = partsAt(row.recorded_at, timeZone)
    if (!Number.isFinite(timestamp) || !parts) continue
    output.push({
      recordedAt: row.recorded_at,
      generationKwh: finiteNumber(row.generation_kwh),
      consumptionKwh: finiteNumber(row.consumption_kwh),
      source: row.source,
      timestamp,
      localDay: dayKey(parts),
      hour: Number(parts.hour),
    })
  }
  return output
}

function sumComplete(values: Array<number | null>): number | null {
  if (values.length === 0 || values.some((value) => value === null)) return null
  return values.reduce<number>((sum, value) => sum + value!, 0)
}

function oneSourceProvenance(rows: readonly EnergyReading[]): Provenance {
  if (rows.length === 0) return 'unclassified'
  const sources = new Set(rows.map((row) => energySourceProvenance(row.source)))
  return sources.size === 1 ? [...sources][0]! : 'unclassified'
}

export function availableDays(
  rows: readonly Record<string, unknown>[],
  timeZone: string,
): string[] {
  return [...new Set(readingsForDay(rows, timeZone).map((row) => row.localDay))].sort()
}

export function dayHourly(
  rows: readonly Record<string, unknown>[],
  timeZone: string,
  day: string,
): HourlyEnergyPoint[] {
  const byHour = new Map<number, Array<EnergyReading & { localDay: string; hour: number }>>()
  for (const reading of readingsForDay(rows, timeZone)) {
    if (reading.localDay !== day) continue
    const hourRows = byHour.get(reading.hour) ?? []
    hourRows.push(reading)
    byHour.set(reading.hour, hourRows)
  }
  return Array.from({ length: 24 }, (_, hour) => {
    const hourRows = byHour.get(hour) ?? []
    return {
      hour,
      generationKwh: sumComplete(hourRows.map((row) => row.generationKwh)),
      consumptionKwh: sumComplete(hourRows.map((row) => row.consumptionKwh)),
    }
  })
}

export function averageDayHourly(
  rows: readonly Record<string, unknown>[],
  timeZone: string,
): { points: HourlyEnergyPoint[]; dayCount: number } {
  const days = availableDays(rows, timeZone)
  const daily = days.map((day) => dayHourly(rows, timeZone, day))
  const points = Array.from({ length: 24 }, (_, hour) => {
    const values = daily.map((day) => day[hour]!)
    const generations = values.flatMap((point) =>
      point.generationKwh === null ? [] : [point.generationKwh])
    const consumptions = values.flatMap((point) =>
      point.consumptionKwh === null ? [] : [point.consumptionKwh])
    return {
      hour,
      generationKwh: generations.length > 0
        ? generations.reduce((sum, value) => sum + value, 0) / generations.length
        : null,
      consumptionKwh: consumptions.length > 0
        ? consumptions.reduce((sum, value) => sum + value, 0) / consumptions.length
        : null,
    }
  })
  return { points, dayCount: days.length }
}

export function dayTotals(
  rows: readonly Record<string, unknown>[],
  timeZone: string,
  day: string,
): {
  consumptionKwh: number | null
  generationKwh: number | null
  readingCount: number
  provenance: Provenance
} {
  const dayRows = readingsForDay(rows, timeZone).filter((row) => row.localDay === day)
  return {
    consumptionKwh: sumComplete(dayRows.map((row) => row.consumptionKwh)),
    generationKwh: sumComplete(dayRows.map((row) => row.generationKwh)),
    readingCount: dayRows.length,
    provenance: oneSourceProvenance(dayRows),
  }
}
