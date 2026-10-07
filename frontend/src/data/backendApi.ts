import { ApiError } from './api'
import { requestApiJson } from './apiTransport'
import {
  mapApiFactory,
  mapApiMachine,
  mapApiProcess,
  mapApiDependency,
  mapApiOrder,
  mapApiSchedule,
  mapApiScheduleEntry,
  parseEnergyPage,
  unwrapApiEnvelope,
  type FrontendFactoryRef,
} from './backendContracts'
import { supabase } from './supabase'

export interface BackendFactoryData {
  factory: FrontendFactoryRef
  machines: ReturnType<typeof mapApiMachine>[]
  processes: ReturnType<typeof mapApiProcess>[]
  dependencies: ReturnType<typeof mapApiDependency>[]
  orders: ReturnType<typeof mapApiOrder>[]
  energy: Record<string, unknown>[]
  tariffs: Record<string, unknown>[]
  schedules: Array<ReturnType<typeof mapApiSchedule> & {
    entries: ReturnType<typeof mapApiScheduleEntry>[]
    metadata: Record<string, unknown>
    totalEnergyCost: number | null
    totalEnergyKwh: number | null
  }>
  optimizationRequests: Record<string, unknown>[]
  optimizationResults: Record<string, unknown>[]
}

const API_BASE_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '')
const PAGE_SIZE = 200

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ApiError(`The ByteMe API returned an invalid ${label} record.`)
  }
  return value as Record<string, unknown>
}

function records(value: unknown, label: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) throw new ApiError(`The ByteMe API returned an invalid ${label} list.`)
  return value.map((row) => record(row, label))
}

async function authenticatedRequest(path: string, init?: RequestInit): Promise<unknown> {
  const { data, error } = await supabase.auth.getSession()
  if (error) throw new ApiError(`Could not restore the Supabase session: ${error.message}`)
  try {
    return await requestApiJson(API_BASE_URL, path, data.session?.access_token ?? null, init)
  } catch (failure) {
    throw new ApiError(
      failure instanceof Error ? failure.message : 'The ByteMe API request failed.',
      { cause: failure },
    )
  }
}

async function listRows<T>(
  path: string,
  map: (value: unknown) => T,
): Promise<T[]> {
  const result: T[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const payload = await authenticatedRequest(
      `${path}${path.includes('?') ? '&' : '?'}limit=${PAGE_SIZE}&offset=${offset}`,
    )
    const rows = records(unwrapApiEnvelope<unknown>(payload), path)
    result.push(...rows.map(map))
    const envelope = record(payload, 'list envelope')
    const meta = envelope.meta
    const total = typeof meta === 'object' && meta !== null && !Array.isArray(meta) &&
      typeof (meta as Record<string, unknown>).total === 'number'
      ? (meta as Record<string, number>).total
      : null
    if (total !== null ? result.length >= total : rows.length < PAGE_SIZE) return result
    if (rows.length === 0) throw new ApiError(`The ByteMe API pagination did not progress for ${path}.`)
  }
}

export interface FactoryBuilderSavePayload {
  factory_id: string | null
  factory: {
    slug: string
    name: string
    industry: string
    currency: string
    working_hours_per_day: number
    solar_capacity_kw: number
    peak_tariff: number
    off_peak_tariff: number
  }
  machines: Array<{
    slug: string
    name: string
    type: string
    rated_power_kw: number
    is_active: boolean
  }>
  processes: Array<{
    slug: string
    name: string
    machine_slug: string
    duration_minutes: number
  }>
}

export async function saveBackendFactoryBuilder(
  payload: FactoryBuilderSavePayload,
): Promise<string> {
  const response = await authenticatedRequest('factory-builder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const result = unwrapApiEnvelope<unknown>(response)
  const recordValue = record(result, 'factory builder result')
  if (typeof recordValue.factory_id !== 'string') {
    throw new ApiError('The ByteMe API returned an invalid saved factory identifier.')
  }
  return recordValue.factory_id
}

export async function listBackendFactories(): Promise<FrontendFactoryRef[]> {
  return listRows('/factories', mapApiFactory)
}

export async function loadBackendFactory(factoryId: string): Promise<BackendFactoryData> {
  const base = `/factories/${encodeURIComponent(factoryId)}`
  const [
    factoryPayload,
    machines,
    processes,
    dependencies,
    orders,
    energy,
    tariffs,
    schedules,
    optimizationRequests,
    optimizationResults,
  ] = await Promise.all([
    authenticatedRequest(base),
    listRows(`${base}/machines`, mapApiMachine),
    listRows(`${base}/processes`, mapApiProcess),
    listRows(`${base}/process-dependencies`, mapApiDependency),
    listRows(`${base}/production-orders`, mapApiOrder),
    listEnergyRows(`${base}/energy-data`),
    listRows(`${base}/tariffs`, (row) => record(row, 'tariff')),
    listRows(`${base}/schedules`, (row) => record(row, 'schedule')),
    listRows(`${base}/optimization-requests`, (row) => record(row, 'optimization request')),
    listRows(`${base}/optimization-results`, (row) => record(row, 'optimization result')),
  ])
  const factoryRecord = record(unwrapApiEnvelope<unknown>(factoryPayload), 'factory')
  const mappedFactory = mapApiFactory(factoryRecord)
  if (mappedFactory.id !== factoryId) {
    throw new ApiError('The ByteMe API returned a factory outside the selected factory.')
  }
  const fullSchedules = await Promise.all(schedules.map(async (scheduleValue) => {
    const scheduleRecord = record(scheduleValue, 'schedule')
    const schedule = mapApiSchedule(scheduleRecord)
    if (schedule.factoryId !== factoryId) {
      throw new ApiError('The ByteMe API returned a schedule outside the selected factory.')
    }
    const detailPayload = await authenticatedRequest(
      `${base}/schedules/${encodeURIComponent(schedule.id)}`,
    )
    const detail = record(unwrapApiEnvelope<unknown>(detailPayload), 'schedule')
    const entries = records(detail.entries, 'schedule entry').map(mapApiScheduleEntry)
    const metadataValue = detail.metadata
    const metadata = typeof metadataValue === 'object' && metadataValue !== null && !Array.isArray(metadataValue)
      ? metadataValue as Record<string, unknown>
      : {}
    return {
      ...schedule,
      entries,
      metadata,
      totalEnergyCost: numeric(detail.total_energy_cost),
      totalEnergyKwh: numeric(detail.total_energy_kwh),
    }
  }))
  return {
    factory: mappedFactory,
    machines,
    processes,
    dependencies,
    orders,
    energy,
    tariffs,
    schedules: fullSchedules,
    optimizationRequests,
    optimizationResults,
  }
}

async function listEnergyRows(path: string): Promise<Record<string, unknown>[]> {
  const result: Record<string, unknown>[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const payload = await authenticatedRequest(
      `${path}?limit=${PAGE_SIZE}&offset=${offset}`,
    )
    const page = parseEnergyPage(payload)
    const rows = page.rows
    result.push(...rows)
    if (page.total !== null ? result.length >= page.total : rows.length < PAGE_SIZE) return result
    if (rows.length === 0) throw new ApiError(`The ByteMe API pagination did not progress for ${path}.`)
  }
}

function numeric(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
