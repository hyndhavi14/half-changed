import type { BackendFactoryData } from './backendApi'

export type StoredSchedule = BackendFactoryData['schedules'][number]

export function scheduleKind(schedule: StoredSchedule): 'baseline' | 'optimized' | null {
  const metadataKind = schedule.metadata.kind
  if (metadataKind === 'baseline' || metadataKind === 'optimized') return metadataKind
  const name = schedule.name.toLowerCase()
  if (name.includes('baseline')) return 'baseline'
  if (name.includes('optimized')) return 'optimized'
  return null
}

export function findStoredSchedule(
  data: BackendFactoryData,
  kind: 'baseline' | 'optimized',
): StoredSchedule | undefined {
  return data.schedules.find((schedule) => scheduleKind(schedule) === kind)
}

export function displayValue(value: unknown, suffix = ''): string {
  if (typeof value === 'string' && value.length > 0) return `${value}${suffix}`
  if (typeof value === 'number' && Number.isFinite(value)) return `${value}${suffix}`
  return 'Not available'
}

export function displayTimestamp(value: string, timeZone: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'Invalid timestamp'
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    dateStyle: 'medium',
    timeStyle: 'short',
    hour12: false,
  }).format(date)
}

export function machineName(data: BackendFactoryData, id: string): string {
  return data.machines.find((machine) => machine.id === id)?.name ?? `Unknown machine (${id})`
}

export function processName(data: BackendFactoryData, id: string): string {
  return data.processes.find((process) => process.id === id)?.name ?? `Unknown process (${id})`
}
