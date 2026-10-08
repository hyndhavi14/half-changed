import type { MeasuredEnergyPoint } from '../components/EnergyChart/EnergyChart'

function numeric(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

export function aggregateMeasuredEnergy(
  rows: readonly Record<string, unknown>[],
  timeZone: string,
): MeasuredEnergyPoint[] {
  const formatHour = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  })
  const totals = new Map<number, MeasuredEnergyPoint>()

  for (const row of rows) {
    const recordedAt = row.recorded_at
    if (typeof recordedAt !== 'string') continue
    const timestamp = new Date(recordedAt)
    if (!Number.isFinite(timestamp.getTime())) continue
    const generationKwh = numeric(row.generation_kwh)
    const consumptionKwh = numeric(row.consumption_kwh)
    if (generationKwh === null || consumptionKwh === null) continue

    const hour = Number(formatHour.format(timestamp))
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) continue
    const total = totals.get(hour) ?? { hour, generationKwh: 0, consumptionKwh: 0 }
    total.generationKwh += generationKwh
    total.consumptionKwh += consumptionKwh
    totals.set(hour, total)
  }

  return [...totals.values()].sort((left, right) => left.hour - right.hour)
}
