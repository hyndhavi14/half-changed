// Phases 8-9 - shared view model for the 2D flow plan (Factory View and Processes & machines).
// Pure functions only. The flow order is derived from persisted process dependencies; no physical
// machine positions are stored, so the plan never claims to be a floor layout.
import type { BackendFactoryData } from '../../data/backendApi'
import { machineStages, processStages } from '../../data/stageView.ts'
import { plannedLoadPct, type StoredSchedule } from '../DashboardPage/dashboardView.ts'

type FlowData = Pick<BackendFactoryData, 'machines' | 'processes' | 'dependencies'>

export interface FlowZone {
  number: number
  title: string
  machineIds: string[]
}

export interface FlowPlan {
  zones: FlowZone[]
  unassignedMachineIds: string[]
  cyclic: boolean
}

/**
 * Groups machines into flow zones: each machine sits in the earliest dependency stage of the processes
 * assigned to it. The zone title lists the processes those machines run.
 */
export function flowPlan(data: FlowData): FlowPlan {
  const { stages, cyclic } = processStages(data.processes, data.dependencies)
  const grouped = machineStages(data.machines, data.processes, stages)
  const zones = grouped.stages.map((stage, index) => {
    const machineIds = stage.machines.map((machine) => machine.id)
    const names = data.processes
      .filter((process) => machineIds.includes(process.machineId))
      .map((process) => process.name)
    return {
      number: index + 1,
      title: names.length ? names.join(' · ') : `Stage ${index + 1}`,
      machineIds,
    }
  })
  return { zones, unassignedMachineIds: grouped.unassigned.map((machine) => machine.id), cyclic }
}

export type GlyphKind = 'conveyor' | 'oven' | 'mixer' | 'tank' | 'generator' | 'generic'

/** Picks one of the original tile glyphs from the stored machine type text. */
export function glyphKind(type: string | null): GlyphKind {
  const value = (type ?? '').toLowerCase()
  if (value.includes('conveyor') || value.includes('line')) return 'conveyor'
  if (value.includes('thermal') || value.includes('oven') || value.includes('heat')) return 'oven'
  if (value.includes('rotational') || value.includes('mixer') || value.includes('grinder')) return 'mixer'
  if (value.includes('tank') || value.includes('vessel')) return 'tank'
  if (value.includes('generator') || value.includes('pv') || value.includes('solar')) return 'generator'
  return 'generic'
}

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

export interface MachinePlan {
  entryCount: number
  solarKwh: number | null
  gridKwh: number | null
  nextSlot: string | null
  loadPct: number | null
  processNames: string[]
}

/** Planned (optimized schedule) facts for one machine. Solar/grid only when every entry carries both values. */
export function machinePlan(
  data: Pick<BackendFactoryData, 'processes' | 'factory'>,
  schedule: StoredSchedule | undefined,
  machineId: string,
): MachinePlan {
  const processNames = data.processes.filter((process) => process.machineId === machineId).map((process) => process.name)
  const entries = (schedule?.entries ?? [])
    .filter((entry) => entry.machineId === machineId)
    .sort((left, right) => (toTime(left.startsAt) ?? 0) - (toTime(right.startsAt) ?? 0))
  let solar = 0
  let grid = 0
  let complete = entries.length > 0
  for (const entry of entries) {
    const metadata: unknown = Reflect.get(entry, 'metadata')
    const record = typeof metadata === 'object' && metadata !== null ? metadata as Record<string, unknown> : null
    const s = toNumber(record?.solar_kwh)
    const g = toNumber(record?.grid_kwh)
    if (s === null || g === null) {
      complete = false
      break
    }
    solar += s
    grid += g
  }
  const first = entries[0]
  let nextSlot: string | null = null
  if (first) {
    const start = toTime(first.startsAt)
    const end = toTime(first.endsAt)
    if (start !== null && end !== null) {
      const day = new Intl.DateTimeFormat('en-GB', { timeZone: data.factory.timezone, weekday: 'short', day: '2-digit' })
      const clock = new Intl.DateTimeFormat('en-GB', { timeZone: data.factory.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      nextSlot = `${day.format(new Date(start)).replace(',', '')} ${clock.format(new Date(start))}–${clock.format(new Date(end))}`
    }
  }
  return {
    entryCount: entries.length,
    solarKwh: complete ? Math.round(solar * 10) / 10 : null,
    gridKwh: complete ? Math.round(grid * 10) / 10 : null,
    nextSlot,
    loadPct: schedule ? plannedLoadPct(schedule, machineId) : null,
    processNames,
  }
}

/** Link into the separate Factory-3D app, using the URL parameters it already reads. */
export function factory3dUrl(base: string, factoryId: string, scheduleId: string): string {
  const target = new URL(base)
  target.searchParams.set('factoryId', factoryId)
  target.searchParams.set('scheduleId', scheduleId)
  return target.toString()
}
