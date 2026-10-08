import type { BackendFactoryData } from './backendApi.ts'
import type { FrontendScheduleEntryRef, FrontendScheduleRef } from './backendContracts.ts'
import { formatRange } from './format.ts'

type StoredSchedule = BackendFactoryData['schedules'][number]
type MetricDirection = 'lower-better' | 'higher-better'

export const PROCESS_COLOR_KEYS = [
  'process-0',
  'process-1',
  'process-2',
  'process-3',
  'process-4',
  'process-5',
  'process-6',
  'process-7',
] as const

export type ProcessColorKey = (typeof PROCESS_COLOR_KEYS)[number]

export interface ScheduleBlock {
  processId: string
  processName: string
  machineId: string
  startsAt: string
  endsAt: string
  startMs: number
  endMs: number
  startFraction: number
  endFraction: number
  colorKey: ProcessColorKey
  shifted: boolean
  tooltip: string
}

export interface ComparisonMetric {
  key: string
  label: string
  baseline: number
  optimized: number
  unit: string
  direction: MetricDirection
  provenance: 'modeled'
}

export interface ProcessShift {
  processId: string
  processName: string
  machineName: string
  baselineStart: string
  baselineEnd: string
  optimizedStart: string
  optimizedEnd: string
  shiftMinutes: number
  costDelta: number | null
  solarDeltaKwh: number | null
  baselineBand: TariffBand | null
  optimizedBand: TariffBand | null
}

export interface TariffBand {
  name: string
  price: number | null
}

const COLOR_KEYS = PROCESS_COLOR_KEYS

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function timestamp(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function findSchedule(data: BackendFactoryData, kind: 'baseline' | 'optimized'): StoredSchedule | null {
  return data.schedules.find((schedule) => schedule.metadata.kind === kind) ?? null
}

function startFor(entry: FrontendScheduleEntryRef): number | null {
  return timestamp(entry.startsAt)
}

function endFor(entry: FrontendScheduleEntryRef): number | null {
  return timestamp(entry.endsAt)
}

export function processColorKey(
  processId: string,
  orderedProcessIds: readonly string[],
): ProcessColorKey {
  const index = orderedProcessIds.indexOf(processId)
  return COLOR_KEYS[(index < 0 ? 0 : index) % COLOR_KEYS.length] ?? COLOR_KEYS[0]!
}

export function scheduleBlocks(data: BackendFactoryData, schedule: StoredSchedule): ScheduleBlock[] {
  const horizonStart = timestamp(schedule.horizonStart)
  const horizonEnd = timestamp(schedule.horizonEnd)
  if (horizonStart === null || horizonEnd === null || horizonEnd <= horizonStart) return []
  const horizonLength = horizonEnd - horizonStart
  const baseline = findSchedule(data, 'baseline')
  const baselineStarts = new Map(
    baseline?.entries.map((entry) => [entry.processId, startFor(entry)] as const) ?? [],
  )
  const processById = new Map(data.processes.map((process) => [process.id, process]))
  const processIds = data.processes.map((process) => process.id)
  return schedule.entries.flatMap((entry) => {
    const startMs = startFor(entry)
    const endMs = endFor(entry)
    if (startMs === null || endMs === null || endMs <= startMs) return []
    const process = processById.get(entry.processId)
    const startFraction = Math.max(0, Math.min(1, (startMs - horizonStart) / horizonLength))
    const endFraction = Math.max(0, Math.min(1, (endMs - horizonStart) / horizonLength))
    return [{
      processId: entry.processId,
      processName: process?.name ?? entry.processId,
      machineId: entry.machineId,
      startsAt: entry.startsAt,
      endsAt: entry.endsAt,
      startMs,
      endMs,
      startFraction,
      endFraction,
      colorKey: processColorKey(entry.processId, processIds),
      shifted: baselineStarts.has(entry.processId) &&
        baselineStarts.get(entry.processId) !== startMs,
      tooltip: formatRange(entry.startsAt, entry.endsAt, data.factory.timezone),
    }]
  })
}

export function makespanMinutes(schedule: Pick<StoredSchedule, 'entries'>): number | null {
  if (schedule.entries.length === 0) return null
  const starts = schedule.entries.map(startFor)
  const ends = schedule.entries.map(endFor)
  if (starts.some((value) => value === null) || ends.some((value) => value === null)) return null
  return (Math.max(...ends as number[]) - Math.min(...starts as number[])) / 60_000
}

export function entrySolarKwh(entry: Pick<FrontendScheduleEntryRef, 'metadata'>): number | null {
  const value = record(entry.metadata)?.solar_kwh
  return finite(value) ? value : null
}

export function entryGridKwh(entry: Pick<FrontendScheduleEntryRef, 'metadata'>): number | null {
  const value = record(entry.metadata)?.grid_kwh
  return finite(value) ? value : null
}

export function scheduleEnergySplit(schedule: Pick<StoredSchedule, 'entries'>): {
  solarKwh: number | null
  gridKwh: number | null
} {
  if (schedule.entries.length === 0) return { solarKwh: null, gridKwh: null }
  const splits = schedule.entries.map((entry) => ({
    solar: entrySolarKwh(entry),
    grid: entryGridKwh(entry),
  }))
  if (splits.some((split) => split.solar === null || split.grid === null)) {
    return { solarKwh: null, gridKwh: null }
  }
  return {
    solarKwh: splits.reduce((sum, split) => sum + split.solar!, 0),
    gridKwh: splits.reduce((sum, split) => sum + split.grid!, 0),
  }
}

export function comparisonMetrics(data: BackendFactoryData): ComparisonMetric[] {
  const baseline = findSchedule(data, 'baseline')
  const optimized = findSchedule(data, 'optimized')
  if (!baseline || !optimized) return []
  const baselineSplit = scheduleEnergySplit(baseline)
  const optimizedSplit = scheduleEnergySplit(optimized)
  const solarShare = (solar: number | null, grid: number | null): number | null => {
    if (solar === null || grid === null || solar + grid <= 0) return null
    return solar / (solar + grid) * 100
  }
  const candidates: Array<Omit<ComparisonMetric, 'baseline' | 'optimized'> & {
    baseline: number | null
    optimized: number | null
  }> = [
    {
      key: 'energy',
      label: 'Energy',
      baseline: baseline.totalEnergyKwh,
      optimized: optimized.totalEnergyKwh,
      unit: 'kWh',
      direction: 'lower-better',
      provenance: 'modeled',
    },
    {
      key: 'cost',
      label: 'Cost',
      baseline: baseline.totalEnergyCost,
      optimized: optimized.totalEnergyCost,
      unit: data.factory.currency,
      direction: 'lower-better',
      provenance: 'modeled',
    },
    {
      key: 'grid-import',
      label: 'Grid import',
      baseline: baselineSplit.gridKwh,
      optimized: optimizedSplit.gridKwh,
      unit: 'kWh',
      direction: 'lower-better',
      provenance: 'modeled',
    },
    {
      key: 'solar-share',
      label: 'Solar share',
      baseline: solarShare(baselineSplit.solarKwh, baselineSplit.gridKwh),
      optimized: solarShare(optimizedSplit.solarKwh, optimizedSplit.gridKwh),
      unit: '%',
      direction: 'higher-better',
      provenance: 'modeled',
    },
    {
      key: 'peak-load',
      label: 'Peak planned load',
      baseline: baseline.peakDemandKw,
      optimized: optimized.peakDemandKw,
      unit: 'kW',
      direction: 'lower-better',
      provenance: 'modeled',
    },
    {
      key: 'makespan',
      label: 'Makespan',
      baseline: makespanMinutes(baseline),
      optimized: makespanMinutes(optimized),
      unit: 'min',
      direction: 'lower-better',
      provenance: 'modeled',
    },
  ]
  return candidates.filter(
    (metric): metric is ComparisonMetric =>
      finite(metric.baseline) && finite(metric.optimized),
  )
}

function numeric(value: unknown): number | null {
  if (finite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function localTime(iso: string, timeZone: string): string | null {
  const at = timestamp(iso)
  if (at === null) return null
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(at)
    const hour = parts.find((part) => part.type === 'hour')?.value
    const minute = parts.find((part) => part.type === 'minute')?.value
    return hour && minute ? `${hour}:${minute}` : null
  } catch {
    return null
  }
}

function minutesOfDay(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  const second = Number(match[3] ?? '0')
  if (hour > 23 || minute > 59 || second > 59) return null
  return hour * 60 + minute + second / 60
}

export function tariffBandAt(
  tariffs: readonly Record<string, unknown>[],
  iso: string,
  timeZone: string,
): TariffBand | null {
  const time = localTime(iso, timeZone)
  if (time === null) return null
  const [hour, minute] = time.split(':').map(Number)
  const current = hour! * 60 + minute!
  for (const tariff of tariffs) {
    const start = minutesOfDay(tariff.start_time)
    const end = minutesOfDay(tariff.end_time)
    if (start === null || end === null) continue
    const contains = start <= end
      ? current >= start && current < end
      : current >= start || current < end
    if (contains && typeof tariff.name === 'string') {
      return { name: tariff.name, price: numeric(tariff.energy_price_per_kwh) }
    }
  }
  return null
}

export function processShifts(data: BackendFactoryData): ProcessShift[] {
  const baseline = findSchedule(data, 'baseline')
  const optimized = findSchedule(data, 'optimized')
  if (!baseline || !optimized) return []
  const baselineByProcess = new Map(baseline.entries.map((entry) => [entry.processId, entry]))
  const processById = new Map(data.processes.map((process) => [process.id, process]))
  const machineById = new Map(data.machines.map((machine) => [machine.id, machine]))
  return optimized.entries.flatMap((entry) => {
    const before = baselineByProcess.get(entry.processId)
    const beforeStart = before ? startFor(before) : null
    const beforeEnd = before ? endFor(before) : null
    const afterStart = startFor(entry)
    const afterEnd = endFor(entry)
    if (!before || beforeStart === null || beforeEnd === null ||
      afterStart === null || afterEnd === null ||
      (beforeStart === afterStart && beforeEnd === afterEnd && before.machineId === entry.machineId)) return []
    const process = processById.get(entry.processId)
    const baselineSolar = entrySolarKwh(before)
    const optimizedSolar = entrySolarKwh(entry)
    const baselineCost = numeric(before.cost)
    const optimizedCost = numeric(entry.cost)
    return [{
      processId: entry.processId,
      processName: process?.name ?? entry.processId,
      machineName: machineById.get(entry.machineId)?.name ?? entry.machineId,
      baselineStart: before.startsAt,
      baselineEnd: before.endsAt,
      optimizedStart: entry.startsAt,
      optimizedEnd: entry.endsAt,
      shiftMinutes: (afterStart - beforeStart) / 60_000,
      costDelta: baselineCost !== null && optimizedCost !== null
        ? optimizedCost - baselineCost
        : null,
      solarDeltaKwh: baselineSolar !== null && optimizedSolar !== null
        ? optimizedSolar - baselineSolar
        : null,
      baselineBand: tariffBandAt(data.tariffs, before.startsAt, data.factory.timezone),
      optimizedBand: tariffBandAt(data.tariffs, entry.startsAt, data.factory.timezone),
    }]
  })
}

export function plannedLoad(
  _data: BackendFactoryData,
  schedule: StoredSchedule,
  machineId: string,
): {
  scheduledMinutes: number
  horizonMinutes: number | null
  percent: number | null
  provenance: 'planned'
} {
  const scheduledMinutes = schedule.entries
    .filter((entry) => entry.machineId === machineId)
    .reduce((total, entry) => {
      const start = startFor(entry)
      const end = endFor(entry)
      return start !== null && end !== null && end > start
        ? total + (end - start) / 60_000
        : total
    }, 0)
  const start = timestamp(schedule.horizonStart)
  const end = timestamp(schedule.horizonEnd)
  const horizonMinutes = start !== null && end !== null && end > start
    ? (end - start) / 60_000
    : null
  return {
    scheduledMinutes,
    horizonMinutes,
    percent: horizonMinutes !== null ? scheduledMinutes / horizonMinutes * 100 : null,
    provenance: 'planned',
  }
}

export type ScheduleReference = FrontendScheduleRef
