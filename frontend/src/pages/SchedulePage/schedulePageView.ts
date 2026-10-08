import type { BackendFactoryData } from '../../data/backendApi.ts'
import type {
  BandSegment,
  EnergySourceLabel,
  StoredSchedule,
} from '../DashboardPage/dashboardView.ts'
import {
  NOT_AVAILABLE,
  dashboardTariffBand,
  deltaText,
  energySourceLabel,
  ganttRows,
  makespanHours,
  metricPair,
  plannedPeakKw,
  solarSharePct,
  tariffWindows,
} from '../DashboardPage/dashboardView.ts'

export type Entry = StoredSchedule['entries'][number]
export type ObservedChange =
  | 'Moved out of peak price'
  | 'Moved into peak price'
  | 'Moved into generation hours'
  | 'Retimed'

export function allEntriesPlanned(schedule: StoredSchedule): boolean | null {
  if (schedule.entries.length === 0) return null
  let sawMetadataObject = false
  let everyEntryPlanned = true
  for (const entry of schedule.entries) {
    const metadata = plainRecord(Reflect.get(entry, 'metadata'))
    if (metadata === null) {
      everyEntryPlanned = false
      continue
    }
    sawMetadataObject = true
    if (metadata.planned !== true) return false
  }
  if (!sawMetadataObject) return null
  return everyEntryPlanned
}

type ScheduleData = Pick<
  BackendFactoryData,
  'machines' | 'processes' | 'factory' | 'tariffs' | 'energy'
>

type OptimizationData = Pick<BackendFactoryData, 'optimizationResults' | 'factory'>

type Pair = { key: string; baseline: Entry; optimized: Entry }

const HOUR_MS = 60 * 60 * 1000
const NOT_CHECKED =
  'Process dependencies and order requirements are not stored per schedule, so they are not checked.'

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function timestamp(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function rulerLabels(
  schedule: StoredSchedule,
  timeZone: string,
  tickCount = 7,
): string[] {
  const start = timestamp(schedule.horizonStart)
  const end = timestamp(schedule.horizonEnd)
  if (start === null || end === null || end <= start || !Number.isInteger(tickCount) || tickCount < 2) {
    return []
  }

  try {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      ...(end - start > 24 * 60 * 60 * 1000 ? { weekday: 'short', day: '2-digit' } : {}),
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
    return Array.from({ length: tickCount }, (_, index) => {
      const instant = start + ((end - start) * index) / (tickCount - 1)
      const values = new Map(
        formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]),
      )
      const time = `${values.get('hour')}:${values.get('minute')}`
      return end - start > 24 * 60 * 60 * 1000
        ? `${values.get('weekday')} ${values.get('day')} ${time}`
        : time
    })
  } catch {
    return []
  }
}

export function tariffSampleCount(schedule: StoredSchedule): number {
  const start = timestamp(schedule.horizonStart)
  const end = timestamp(schedule.horizonEnd)
  if (start === null || end === null || end <= start) return 96
  const hours = (end - start) / (60 * 60 * 1000)
  return Math.min(2016, Math.max(96, Math.ceil(hours * 4)))
}

function plainRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
    ? value as Record<string, unknown>
    : null
}

function sortedEntries(schedule: StoredSchedule): Entry[] {
  return [...schedule.entries].sort((left, right) =>
    left.sequence - right.sequence ||
    (timestamp(left.startsAt) ?? Number.POSITIVE_INFINITY) -
      (timestamp(right.startsAt) ?? Number.POSITIVE_INFINITY),
  )
}

export function pairEntries(
  baseline: StoredSchedule,
  optimized: StoredSchedule,
): {
  pairs: Array<{ key: string; baseline: Entry; optimized: Entry }>
  unmatchedBaseline: Entry[]
  unmatchedOptimized: Entry[]
} {
  const occurrenceEntries = (schedule: StoredSchedule) => {
    const occurrences = new Map<string, number>()
    return sortedEntries(schedule).map((entry) => {
      const identity = `${entry.processId}|${entry.machineId}`
      const occurrence = occurrences.get(identity) ?? 0
      occurrences.set(identity, occurrence + 1)
      return { key: `${identity}|${occurrence}`, entry }
    })
  }
  const baselineEntries = occurrenceEntries(baseline)
  const optimizedEntries = occurrenceEntries(optimized)
  const optimizedByKey = new Map(optimizedEntries.map(({ key, entry }) => [key, entry]))
  const baselineKeys = new Set(baselineEntries.map(({ key }) => key))
  const pairs: Pair[] = []
  const unmatchedBaseline: Entry[] = []
  const unmatchedOptimized: Entry[] = []

  for (const { key, entry } of baselineEntries) {
    const match = optimizedByKey.get(key)
    if (match) pairs.push({ key, baseline: entry, optimized: match })
    else unmatchedBaseline.push(entry)
  }
  for (const { key, entry } of optimizedEntries) {
    if (!baselineKeys.has(key)) unmatchedOptimized.push(entry)
  }
  return { pairs, unmatchedBaseline, unmatchedOptimized }
}

export function scheduleComparability(
  baseline: StoredSchedule,
  optimized: StoredSchedule,
): { comparable: boolean; reasons: string[]; notChecked: string } {
  const { pairs, unmatchedBaseline, unmatchedOptimized } = pairEntries(baseline, optimized)
  const reasons: string[] = []
  if (baseline.factoryId !== optimized.factoryId) reasons.push('Different factory')
  if (unmatchedBaseline.length > 0 || unmatchedOptimized.length > 0) {
    reasons.push(
      `Process/machine assignments differ (${unmatchedBaseline.length} baseline-only, ${unmatchedOptimized.length} optimized-only entries)`,
    )
  }

  let durationDifferences = 0
  let quantityDifferences = 0
  for (const pair of pairs) {
    const baselineStart = timestamp(pair.baseline.startsAt)
    const baselineEnd = timestamp(pair.baseline.endsAt)
    const optimizedStart = timestamp(pair.optimized.startsAt)
    const optimizedEnd = timestamp(pair.optimized.endsAt)
    if (
      baselineStart !== null &&
      baselineEnd !== null &&
      optimizedStart !== null &&
      optimizedEnd !== null &&
      Math.abs((baselineEnd - baselineStart) - (optimizedEnd - optimizedStart)) > 60_000
    ) {
      durationDifferences += 1
    }
    if (
      finite(pair.baseline.quantity) &&
      finite(pair.optimized.quantity) &&
      pair.baseline.quantity !== pair.optimized.quantity
    ) {
      quantityDifferences += 1
    }
  }
  if (durationDifferences > 0) {
    reasons.push(`Process durations differ for ${durationDifferences} entries`)
  }
  if (quantityDifferences > 0) {
    reasons.push(`Production quantities differ for ${quantityDifferences} entries`)
  }

  const baselineStart = timestamp(baseline.horizonStart)
  const baselineEnd = timestamp(baseline.horizonEnd)
  const optimizedStart = timestamp(optimized.horizonStart)
  const optimizedEnd = timestamp(optimized.horizonEnd)
  if (
    baselineStart !== null &&
    baselineEnd !== null &&
    optimizedStart !== null &&
    optimizedEnd !== null &&
    Math.abs((baselineEnd - baselineStart) - (optimizedEnd - optimizedStart)) > 60_000
  ) {
    reasons.push('Planning horizon length differs')
  }
  return { comparable: reasons.length === 0, reasons, notChecked: NOT_CHECKED }
}

interface LocalParts {
  day: string
  hour: number
  minute: number
  weekday: number
}

const ISO_WEEKDAY: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
}

function localParts(time: number, timeZone: string): LocalParts | null {
  if (!Number.isFinite(time)) return null
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    }).formatToParts(new Date(time))
    const values = new Map(parts.map((part) => [part.type, part.value]))
    const year = values.get('year')
    const month = values.get('month')
    const day = values.get('day')
    const hour = Number(values.get('hour'))
    const minute = Number(values.get('minute'))
    const weekday = ISO_WEEKDAY[values.get('weekday') ?? '']
    if (!year || !month || !day || !Number.isFinite(hour) || !Number.isFinite(minute) || !weekday) {
      return null
    }
    return { day: `${year}-${month}-${day}`, hour, minute, weekday }
  } catch {
    return null
  }
}

export function generationHourKeys(
  rows: readonly Record<string, unknown>[],
  timeZone: string,
): Set<string> {
  const totals = new Map<string, number>()
  for (const row of rows) {
    const time = timestamp(row.recorded_at)
    if (time === null || !finite(row.generation_kwh)) continue
    const parts = localParts(time, timeZone)
    if (!parts) continue
    const key = `${parts.day}|${parts.hour}`
    totals.set(key, (totals.get(key) ?? 0) + row.generation_kwh)
  }
  return new Set([...totals].filter(([, total]) => total > 0).map(([key]) => key))
}

function numberText(value: number, digits = 1): string {
  return value.toLocaleString('en-GB', { maximumFractionDigits: digits })
}

function costChangeText(delta: number | null, currency: string): string {
  if (delta === null) return NOT_AVAILABLE
  if (delta < 0) return `${currency} ${numberText(Math.abs(delta), 2)} lower`
  if (delta > 0) return `${currency} ${numberText(delta, 2)} higher`
  return 'No change'
}

function timeWindow(startIso: string, endIso: string, timeZone: string): string {
  const start = timestamp(startIso)
  const end = timestamp(endIso)
  if (start === null || end === null) return NOT_AVAILABLE
  try {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
    const startParts = new Map(
      formatter.formatToParts(new Date(start)).map((part) => [part.type, part.value]),
    )
    const endParts = new Map(
      formatter.formatToParts(new Date(end)).map((part) => [part.type, part.value]),
    )
    const startDay = `${startParts.get('day')} ${startParts.get('month')}`
    const endDay = `${endParts.get('day')} ${endParts.get('month')}`
    const startClock = `${startParts.get('hour')}:${startParts.get('minute')}`
    const endClock = `${endParts.get('hour')}:${endParts.get('minute')}`
    if ([startDay, endDay, startClock, endClock].some((part) => part.includes('undefined'))) {
      return NOT_AVAILABLE
    }
    return startDay === endDay
      ? `${startDay} ${startClock}–${endClock}`
      : `${startDay} ${startClock}–${endDay} ${endClock}`
  } catch {
    return NOT_AVAILABLE
  }
}

function tariffAt(data: ScheduleData, time: number | null): string | null {
  if (time === null) return null
  const parts = localParts(time, data.factory.timezone)
  if (!parts) return null
  return dashboardTariffBand(
    tariffWindows(data.tariffs),
    parts.hour * 60 + parts.minute,
    parts.weekday,
    time,
  )
}

export function shiftRows(
  data: ScheduleData,
  baseline: StoredSchedule,
  optimized: StoredSchedule,
): Array<{
  id: string
  process: string
  machine: string
  was: string
  now: string
  change: ObservedChange
  costDelta: number | null
  costText: string
}> {
  const { pairs } = pairEntries(baseline, optimized)
  const generationHours = generationHourKeys(data.energy, data.factory.timezone)
  const rows = pairs.flatMap(({ optimized: next, baseline: previous }) => {
    if (previous.startsAt === next.startsAt && previous.endsAt === next.endsAt) return []
    const beforeTime = timestamp(previous.startsAt)
    const afterTime = timestamp(next.startsAt)
    const beforeBand = tariffAt(data, beforeTime)
    const afterBand = tariffAt(data, afterTime)
    let change: ObservedChange = 'Retimed'
    if (beforeBand === 'peak' && afterBand !== 'peak') {
      change = 'Moved out of peak price'
    } else if (afterBand === 'peak' && beforeBand !== 'peak') {
      change = 'Moved into peak price'
    } else {
      const beforeParts = beforeTime === null ? null : localParts(beforeTime, data.factory.timezone)
      const afterParts = afterTime === null ? null : localParts(afterTime, data.factory.timezone)
      const beforeKey = beforeParts ? `${beforeParts.day}|${beforeParts.hour}` : ''
      const afterKey = afterParts ? `${afterParts.day}|${afterParts.hour}` : ''
      if (generationHours.has(afterKey) && !generationHours.has(beforeKey)) {
        change = 'Moved into generation hours'
      }
    }
    const costDelta = finite(previous.cost) && finite(next.cost)
      ? next.cost - previous.cost
      : null
    return [{
      id: next.id,
      process: data.processes.find((process) => process.id === next.processId)?.name ??
        `Unknown process (${next.processId})`,
      machine: data.machines.find((machine) => machine.id === next.machineId)?.name ??
        `Unknown machine (${next.machineId})`,
      was: timeWindow(previous.startsAt, previous.endsAt, data.factory.timezone),
      now: timeWindow(next.startsAt, next.endsAt, data.factory.timezone),
      change,
      costDelta,
      costText: costChangeText(costDelta, data.factory.currency),
    }]
  })
  return rows.sort((left, right) =>
    (timestamp(optimized.entries.find((entry) => entry.id === left.id)?.startsAt) ?? 0) -
    (timestamp(optimized.entries.find((entry) => entry.id === right.id)?.startsAt) ?? 0),
  )
}

function metricText(value: number | null, unit: string, digits: number): string {
  return finite(value) ? `${numberText(value, digits)}${unit}` : NOT_AVAILABLE
}

export function summaryTiles(
  data: ScheduleData,
  selected: StoredSchedule,
  baseline: StoredSchedule | undefined,
  optimized: StoredSchedule | undefined,
): Array<{ key: 'makespan' | 'cost' | 'solar' | 'shifted'; label: string; value: string; sub?: string }> {
  const optimizedSelected = optimized?.id === selected.id
  const baselineSelected = baseline?.id === selected.id
  const makespan = makespanHours(selected)
  const cost = finite(selected.totalEnergyCost) ? selected.totalEnergyCost : null
  const solar = solarSharePct(selected)
  const delta = (key: 'makespan' | 'cost' | 'solar') =>
    optimizedSelected && baseline && optimized
      ? deltaText(metricPair(key, baseline, optimized))
      : undefined
  return [
    {
      key: 'makespan',
      label: 'Makespan',
      value: metricText(makespan, ' h', 1),
      ...(delta('makespan') ? { sub: delta('makespan') } : {}),
    },
    {
      key: 'cost',
      label: 'Energy cost',
      value: cost === null
        ? NOT_AVAILABLE
        : `${data.factory.currency} ${numberText(cost, 2)}`,
      ...(delta('cost') ? { sub: delta('cost') } : {}),
    },
    {
      key: 'solar',
      label: 'Solar share',
      value: metricText(solar, '%', 1),
      ...(delta('solar') ? { sub: delta('solar') } : {}),
    },
    {
      key: 'shifted',
      label: 'Processes shifted',
      value: baselineSelected
        ? 'Not applicable'
        : baseline && optimized && optimizedSelected
          ? String(shiftRows(data, baseline, optimized).length)
          : NOT_AVAILABLE,
      ...(baselineSelected
        ? { sub: 'Baseline is the reference' }
        : {}),
    },
  ]
}

export function generationSegments(
  rows: readonly Record<string, unknown>[],
  schedule: StoredSchedule,
  timeZone: string,
): { segments: BandSegment[]; source: EnergySourceLabel } {
  const start = timestamp(schedule.horizonStart)
  const end = timestamp(schedule.horizonEnd)
  if (start === null || end === null || end <= start || localParts(start, timeZone) === null) {
    return { segments: [], source: 'Not available' }
  }
  const inside = rows.flatMap((row) => {
    const time = timestamp(row.recorded_at)
    return time !== null && time >= start && time < end ? [{ row, time }] : []
  })
  if (inside.length === 0) return { segments: [], source: 'Not available' }

  const slots: Array<{ start: number; end: number; positive: boolean }> = []
  for (let slotStart = start; slotStart < end;) {
    const slotEnd = Math.min(slotStart + HOUR_MS, end)
    const total = inside.reduce((sum, item) => {
      const generation = item.time >= slotStart && item.time < slotEnd &&
        finite(item.row.generation_kwh)
        ? item.row.generation_kwh
        : 0
      return sum + generation
    }, 0)
    slots.push({ start: slotStart, end: slotEnd, positive: total > 0 })
    slotStart = slotEnd
  }
  const segments: BandSegment[] = []
  for (const slot of slots) {
    if (!slot.positive) continue
    const startFraction = (slot.start - start) / (end - start)
    const endFraction = (slot.end - start) / (end - start)
    const previous = segments[segments.length - 1]
    if (previous && Math.abs(previous.endFraction - startFraction) < 1e-9) {
      previous.endFraction = endFraction
    } else {
      segments.push({ band: 'off', startFraction, endFraction })
    }
  }
  return { segments, source: energySourceLabel(inside.map(({ row }) => row)) }
}

export function entryDetail(entry: Entry, currency: string): string {
  const parts: string[] = []
  if (finite(entry.powerKw)) parts.push(`${numberText(entry.powerKw, 2)} kW`)
  if (finite(entry.energyKwh)) {
    const metadata = plainRecord(Reflect.get(entry, 'metadata'))
    const solar = metadata?.solar_kwh
    const grid = metadata?.grid_kwh
    const split = finite(solar) && finite(grid)
      ? ` (solar ${numberText(solar, 2)} / grid ${numberText(grid, 2)})`
      : ''
    parts.push(`${numberText(entry.energyKwh, 2)} kWh${split}`)
  }
  if (finite(entry.cost)) {
    parts.push(`${currency} ${entry.cost.toLocaleString('en-GB', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`)
  }
  if (finite(entry.quantity)) parts.push(`qty ${numberText(entry.quantity, 2)}`)
  return parts.join(' · ')
}

export function machineRows(
  data: Pick<BackendFactoryData, 'machines' | 'processes' | 'factory'>,
  schedule: StoredSchedule,
  baseline: StoredSchedule | undefined,
): Array<{
  machineId: string
  name: string
  sublabel: string
  blocks: ReturnType<typeof ganttRows>[number]['blocks']
}> {
  const gantt = ganttRows(data, schedule, baseline)
  const blocksByMachine = new Map(gantt.map((row) => [row.machineId, row.blocks]))
  const entryById = new Map(schedule.entries.map((entry) => [entry.id, entry]))
  const knownMachineIds = new Set(data.machines.map((machine) => machine.id))
  const rows = data.machines.map((machine) => ({
    machineId: machine.id,
    name: machine.name,
    sublabel: `${finite(machine.ratedPowerKw)
      ? `${numberText(machine.ratedPowerKw, 2)} kW rated`
      : 'Rated power not available'}${machine.isActive === false ? ' · Inactive' : ''}`,
    blocks: (blocksByMachine.get(machine.id) ?? []).map((block) => {
      const entry = entryById.get(block.id)
      const detail = entry ? entryDetail(entry, data.factory.currency) : ''
      return {
        ...block,
        tooltip: `${block.tooltip}${detail ? ` · ${detail}` : ''}`,
      }
    }),
  }))
  const unknownIds = [...new Set(
    schedule.entries
      .map((entry) => entry.machineId)
      .filter((machineId) => !knownMachineIds.has(machineId)),
  )]
  for (const machineId of unknownIds) {
    const blocks = (blocksByMachine.get(machineId) ?? []).map((block) => {
      const entry = entryById.get(block.id)
      const detail = entry ? entryDetail(entry, data.factory.currency) : ''
      return {
        ...block,
        tooltip: `${block.tooltip}${detail ? ` · ${detail}` : ''}`,
      }
    })
    rows.push({
      machineId,
      name: `Unknown machine (${machineId})`,
      sublabel: 'Rated power not available',
      blocks,
    })
  }
  return rows
}

export function runDetails(
  data: OptimizationData,
  schedule: StoredSchedule,
): { lines: string[]; warnings: string[] } {
  const plannedEnergy = finite(schedule.totalEnergyKwh)
    ? `Planned energy ${numberText(schedule.totalEnergyKwh, 1)} kWh`
    : 'Planned energy Not available'
  const lines = [
    `Version ${schedule.version} · ${schedule.status}`,
    `${schedule.entries.length} scheduled ${schedule.entries.length === 1 ? 'entry' : 'entries'} · ${plannedEnergy}`,
  ]
  const persistedPeak: unknown = Reflect.get(schedule, 'peakDemandKw')
  if (finite(persistedPeak)) {
    lines.push(`Peak demand ${numberText(persistedPeak, 1)} kW (persisted)`)
  } else {
    const calculatedPeak = plannedPeakKw(schedule)
    lines.push(calculatedPeak === null
      ? 'Peak demand Not available'
      : `Peak planned load ${numberText(calculatedPeak, 1)} kW (calculated from entries)`)
  }

  const result = typeof schedule.optimizationResultId === 'string'
    ? data.optimizationResults.find((item) => item.id === schedule.optimizationResultId)
    : undefined
  if (!result) {
    lines.push('No optimization result is linked to this schedule')
    return { lines, warnings: [] }
  }

  const metrics = plainRecord(result.metrics)
  const optimizerStatus = typeof metrics?.optimizer_status === 'string'
    ? metrics.optimizer_status
    : typeof result.status === 'string'
      ? result.status
      : null
  const details = optimizerStatus
    ? [`Optimizer ${optimizerStatus}`]
    : ['Optimizer status Not available']
  if (finite(metrics?.solve_time_seconds)) {
    details.push(`solved in ${numberText(metrics.solve_time_seconds, 2)} s`)
  }
  if (typeof metrics?.optimization_scope === 'string' && metrics.optimization_scope.length > 0) {
    details.push(`scope ${metrics.optimization_scope}`)
  }
  const createdAt = timestamp(result.created_at)
  if (createdAt !== null) {
    try {
      details.push(`result recorded ${new Intl.DateTimeFormat('en-GB', {
        timeZone: data.factory.timezone,
        dateStyle: 'medium',
        timeStyle: 'short',
        hourCycle: 'h23',
      }).format(new Date(createdAt))}`)
    } catch {
      // An invalid factory timezone should not make stored result details unusable.
    }
  }
  lines.push(details.join(' · '))

  const warningValues = [
    ...(Array.isArray(metrics?.warnings) ? metrics.warnings : []),
    ...(Array.isArray(metrics?.integration_warnings) ? metrics.integration_warnings : []),
  ]
  const warnings = [...new Set(
    warningValues.filter(
      (warning): warning is string => typeof warning === 'string' && warning.trim().length > 0,
    ),
  )]
  return { lines, warnings }
}

export function tariffCurrencyNote(
  data: Pick<BackendFactoryData, 'tariffs' | 'factory'>,
): string | null {
  const differingCurrencies = [...new Set(
    data.tariffs.flatMap((tariff) =>
      typeof tariff.currency === 'string' &&
      tariff.currency.length > 0 &&
      tariff.currency !== data.factory.currency
        ? [tariff.currency]
        : [],
    ),
  )]
  return differingCurrencies.length === 0
    ? null
    : `Tariff currency differs from factory currency (${differingCurrencies.join(', ')})`
}
