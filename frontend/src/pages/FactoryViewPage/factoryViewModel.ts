// Phases 8-9 - shared view model for the 2D flow plan (Factory View and Processes & machines).
// Pure functions only. The flow order is derived from persisted process dependencies; no physical
// machine positions are stored, so the plan never claims to be a floor layout.
import type { BackendFactoryData } from '../../data/backendApi'
import { machineStages, processStages } from '../../data/stageView.ts'

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

/** Link into the separate Factory-3D app, using the URL parameters it already reads. */
export function factory3dUrl(base: string, factoryId: string, scheduleId: string): string {
  const target = new URL(base)
  target.searchParams.set('factoryId', factoryId)
  target.searchParams.set('scheduleId', scheduleId)
  return target.toString()
}

export interface ActivityBlock {
  label: string
  start: number
  end: number
  moved: boolean
  powerKw: number | null
}

export interface MachineActivity<T extends ActivityBlock = ActivityBlock> {
  state: 'running' | 'waiting' | 'done' | 'unused'
  current: T | null
  next: T | null
}

/** What a machine is doing at one instant of a planned schedule (planned, not telemetry). */
export function machineActivity<T extends ActivityBlock>(blocks: readonly T[], at: number): MachineActivity<T> {
  if (blocks.length === 0) return { state: 'unused', current: null, next: null }
  const sorted = [...blocks].sort((left, right) => left.start - right.start)
  const current = sorted.find((block) => at >= block.start && at < block.end) ?? null
  const next = sorted.find((block) => block.start > at) ?? null
  if (current) return { state: 'running', current, next }
  return { state: next ? 'waiting' : 'done', current: null, next }
}

/** Factory-3D link for embedding: same parameters plus embed=1, which turns on the parent handshake. */
export function factory3dEmbedUrl(base: string, factoryId: string, scheduleId: string): string {
  const target = new URL(factory3dUrl(base, factoryId, scheduleId))
  target.searchParams.set('embed', '1')
  return target.toString()
}
