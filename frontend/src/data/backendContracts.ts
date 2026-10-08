/**
 * Backend API row shapes used by the frontend integration boundary.
 *
 * These retain the backend's snake_case names and UUID identities. UI-specific
 * formatting belongs in the mapper functions below, not in API payloads.
 */

export interface ApiEnvelope<T> {
  data: T
  meta?: {
    total?: number
    limit?: number
    offset?: number
    [key: string]: unknown
  }
}

export interface ApiFactory {
  id: string
  slug: string
  name: string
  description: string | null
  timezone: string
  currency: string
  config: Record<string, unknown>
  metadata: Record<string, unknown>
  is_active: boolean
}

export interface ApiMachine {
  id: string
  factory_id: string
  slug: string
  name: string
  type: string | null
  rated_power_kw: number | null
  min_power_kw: number | null
  max_power_kw: number | null
  min_runtime_minutes: number | null
  max_runtime_minutes: number | null
  availability: Record<string, unknown>
  metadata: Record<string, unknown>
  is_active: boolean
}

export interface ApiProcess {
  id: string
  factory_id: string
  slug: string
  name: string
  description: string | null
  duration_minutes: number | null
  machine_id: string
  power_requirement_kw: number | null
  production_quantity: number | null
  unit: string | null
  metadata: Record<string, unknown>
  is_active: boolean
}

export interface ApiProcessDependency {
  id: string
  factory_id: string
  process_id: string
  depends_on_process_id: string
  dependency_type:
    | 'finish_to_start'
    | 'start_to_start'
    | 'finish_to_finish'
    | 'start_to_finish'
  lag_minutes: number
}

export interface ApiProductionOrder {
  id: string
  factory_id: string
  reference: string
  product: string | null
  quantity: number
  unit: string | null
  due_at: string | null
  priority: number
  status: 'planned' | 'released' | 'in_progress' | 'completed' | 'cancelled' | 'on_hold'
}

export interface ApiSchedule {
  id: string
  factory_id: string
  name: string
  version: number
  status: 'draft' | 'published' | 'active' | 'completed' | 'superseded' | 'cancelled'
  horizon_start: string
  horizon_end: string
  optimization_request_id: string | null
  optimization_result_id: string | null
}

export interface ApiScheduleEntry {
  id: string
  schedule_id: string
  machine_id: string
  process_id: string
  production_order_id: string | null
  starts_at: string
  ends_at: string
  power_kw: number | null
  energy_kwh: number | null
  cost: number | null
  quantity: number | null
  sequence: number
}

export interface FactorySummary {
  factory: ApiFactory
  counts: Record<string, number>
  energy_window: { from: string | null; to: string | null }
  optimizer: { configured: boolean; reason: string | null }
}

export interface FrontendFactoryRef {
  id: string
  slug: string
  name: string
  timezone: string
  currency: string
  description: string | null
  config: Record<string, unknown>
}

export interface FrontendMachineRef {
  id: string
  factoryId: string
  slug: string
  name: string
  type: string | null
  ratedPowerKw: number | null
  isActive: boolean
}

export interface FrontendProcessRef {
  id: string
  factoryId: string
  slug: string
  name: string
  durationMinutes: number | null
  machineId: string
  powerRequirementKw: number | null
  quantity: number | null
  unit: string | null
  isActive: boolean
}

export interface FrontendDependencyRef {
  id: string
  factoryId: string
  processId: string
  dependsOnProcessId: string
  type: ApiProcessDependency['dependency_type']
  lagMinutes: number
}

export interface FrontendOrderRef {
  id: string
  factoryId: string
  reference: string
  product: string | null
  quantity: number
  unit: string | null
  dueAt: string | null
  priority: number
  status: ApiProductionOrder['status']
}

export interface FrontendScheduleRef {
  id: string
  factoryId: string
  name: string
  version: number
  status: ApiSchedule['status']
  horizonStart: string
  horizonEnd: string
  optimizationRequestId: string | null
  optimizationResultId: string | null
}

export interface FrontendScheduleEntryRef {
  id: string
  scheduleId: string
  machineId: string
  processId: string
  productionOrderId: string | null
  startsAt: string
  endsAt: string
  powerKw: number | null
  energyKwh: number | null
  cost: number | null
  quantity: number | null
  sequence: number
  metadata: Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Backend record has an invalid ${key}.`)
  }
  return value
}

function uuidValue(record: Record<string, unknown>, key: string): string {
  const value = requiredString(record, key)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`Backend record has an invalid UUID in ${key}.`)
  }
  return value
}

function enumValue<T extends string>(record: Record<string, unknown>, key: string, values: readonly T[]): T {
  const value = requiredString(record, key)
  if (!values.includes(value as T)) throw new Error(`Backend record has an unsupported ${key}.`)
  return value as T
}

function timestampValue(record: Record<string, unknown>, key: string): string {
  const value = requiredString(record, key)
  if (!/(Z|[+-]\d{2}:\d{2})$/i.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(`Backend record has an invalid offset-aware timestamp in ${key}.`)
  }
  return value
}

function nullableString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  if (value === null) return null
  if (typeof value !== 'string') throw new Error(`Backend record has an invalid ${key}.`)
  return value
}

function nullableNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key]
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Backend record has an invalid ${key}.`)
  }
  return value
}

export function numericValue(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function numberValue(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Backend record has an invalid ${key}.`)
  }
  return value
}

function booleanValue(record: Record<string, unknown>, key: string): boolean {
  const value = record[key]
  if (typeof value !== 'boolean') throw new Error(`Backend record has an invalid ${key}.`)
  return value
}

function objectValue(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key]
  if (!isRecord(value)) throw new Error(`Backend record has an invalid ${key}.`)
  return value
}

export function unwrapApiEnvelope<T>(value: unknown): T {
  if (!isRecord(value) || !('data' in value)) {
    throw new Error('Backend response is missing its data envelope.')
  }
  return value.data as T
}

export function parseEnergyPage(value: unknown): {
  rows: Record<string, unknown>[]
  total: number | null
} {
  if (!isRecord(value) || !isRecord(value.data) || !Array.isArray(value.data.intervals)) {
    throw new Error('Backend energy response is missing its data.intervals collection.')
  }
  if (!value.data.intervals.every(isRecord)) {
    throw new Error('Backend energy response contains an invalid interval record.')
  }
  const meta = isRecord(value.meta) ? value.meta : null
  const total = meta && typeof meta.total === 'number' &&
    Number.isSafeInteger(meta.total) && meta.total >= 0
    ? meta.total
    : null
  return { rows: value.data.intervals, total }
}

export function mapApiFactory(value: unknown): FrontendFactoryRef {
  if (!isRecord(value)) throw new Error('Backend factory record is invalid.')
  return {
    id: uuidValue(value, 'id'),
    slug: requiredString(value, 'slug'),
    name: requiredString(value, 'name'),
    timezone: requiredString(value, 'timezone'),
    currency: requiredString(value, 'currency'),
    description: nullableString(value, 'description'),
    config: objectValue(value, 'config'),
  }
}

export function mapApiMachine(value: unknown): FrontendMachineRef {
  if (!isRecord(value)) throw new Error('Backend machine record is invalid.')
  return {
    id: uuidValue(value, 'id'),
    factoryId: uuidValue(value, 'factory_id'),
    slug: requiredString(value, 'slug'),
    name: requiredString(value, 'name'),
    type: nullableString(value, 'type'),
    ratedPowerKw: nullableNumber(value, 'rated_power_kw'),
    isActive: booleanValue(value, 'is_active'),
  }
}

export function mapApiProcess(value: unknown): FrontendProcessRef {
  if (!isRecord(value)) throw new Error('Backend process record is invalid.')
  return {
    id: uuidValue(value, 'id'),
    factoryId: uuidValue(value, 'factory_id'),
    slug: requiredString(value, 'slug'),
    name: requiredString(value, 'name'),
    durationMinutes: nullableNumber(value, 'duration_minutes'),
    machineId: uuidValue(value, 'machine_id'),
    powerRequirementKw: nullableNumber(value, 'power_requirement_kw'),
    quantity: nullableNumber(value, 'production_quantity'),
    unit: nullableString(value, 'unit'),
    isActive: booleanValue(value, 'is_active'),
  }
}

export function mapApiDependency(value: unknown): FrontendDependencyRef {
  if (!isRecord(value)) throw new Error('Backend dependency record is invalid.')
  const type = requiredString(value, 'dependency_type')
  if (!['finish_to_start', 'start_to_start', 'finish_to_finish', 'start_to_finish'].includes(type)) {
    throw new Error('Backend dependency has an unsupported dependency_type.')
  }
  return {
    id: uuidValue(value, 'id'),
    factoryId: uuidValue(value, 'factory_id'),
    processId: uuidValue(value, 'process_id'),
    dependsOnProcessId: uuidValue(value, 'depends_on_process_id'),
    type: enumValue(value, 'dependency_type', [
      'finish_to_start',
      'start_to_start',
      'finish_to_finish',
      'start_to_finish',
    ]),
    lagMinutes: numberValue(value, 'lag_minutes'),
  }
}

export function mapApiOrder(value: unknown): FrontendOrderRef {
  if (!isRecord(value)) throw new Error('Backend production order record is invalid.')
  return {
    id: uuidValue(value, 'id'),
    factoryId: uuidValue(value, 'factory_id'),
    reference: requiredString(value, 'reference'),
    product: nullableString(value, 'product'),
    quantity: numberValue(value, 'quantity'),
    unit: nullableString(value, 'unit'),
    dueAt: nullableString(value, 'due_at'),
    priority: numberValue(value, 'priority'),
    status: enumValue(value, 'status', [
      'planned',
      'released',
      'in_progress',
      'completed',
      'cancelled',
      'on_hold',
    ]),
  }
}

export function mapApiSchedule(value: unknown): FrontendScheduleRef {
  if (!isRecord(value)) throw new Error('Backend schedule record is invalid.')
  return {
    id: uuidValue(value, 'id'),
    factoryId: uuidValue(value, 'factory_id'),
    name: requiredString(value, 'name'),
    version: numberValue(value, 'version'),
    status: enumValue(value, 'status', [
      'draft',
      'published',
      'active',
      'completed',
      'superseded',
      'cancelled',
    ]),
    horizonStart: timestampValue(value, 'horizon_start'),
    horizonEnd: timestampValue(value, 'horizon_end'),
    optimizationRequestId: nullableUuid(value, 'optimization_request_id'),
    optimizationResultId: nullableUuid(value, 'optimization_result_id'),
  }
}

export function mapApiScheduleEntry(value: unknown): FrontendScheduleEntryRef {
  if (!isRecord(value)) throw new Error('Backend schedule entry record is invalid.')
  return {
    id: uuidValue(value, 'id'),
    scheduleId: uuidValue(value, 'schedule_id'),
    machineId: uuidValue(value, 'machine_id'),
    processId: uuidValue(value, 'process_id'),
    productionOrderId: nullableUuid(value, 'production_order_id'),
    startsAt: timestampValue(value, 'starts_at'),
    endsAt: timestampValue(value, 'ends_at'),
    powerKw: nullableNumber(value, 'power_kw'),
    energyKwh: nullableNumber(value, 'energy_kwh'),
    cost: nullableNumber(value, 'cost'),
    quantity: nullableNumber(value, 'quantity'),
    sequence: numberValue(value, 'sequence'),
    metadata: isRecord(value.metadata) ? value.metadata : {},
  }
}

function nullableUuid(record: Record<string, unknown>, key: string): string | null {
  const value = nullableString(record, key)
  if (value === null) return null
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`Backend record has an invalid UUID in ${key}.`)
  }
  return value
}

export function mapApiSummary(value: unknown): FactorySummary {
  if (!isRecord(value) || !isRecord(value.factory) || !isRecord(value.counts) ||
      !isRecord(value.energy_window) || !isRecord(value.optimizer)) {
    throw new Error('Backend factory summary is invalid.')
  }
  const counts: Record<string, number> = {}
  for (const [key, count] of Object.entries(value.counts)) {
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
      throw new Error(`Backend factory summary has an invalid ${key} count.`)
    }
    counts[key] = count
  }
  if (
    (value.energy_window.from !== null && typeof value.energy_window.from !== 'string') ||
    (value.energy_window.to !== null && typeof value.energy_window.to !== 'string') ||
    typeof value.optimizer.configured !== 'boolean' ||
    (value.optimizer.reason !== null && typeof value.optimizer.reason !== 'string')
  ) {
    throw new Error('Backend factory summary contains invalid fields.')
  }
  return {
    factory: {
      id: uuidValue(value.factory, 'id'),
      slug: requiredString(value.factory, 'slug'),
      name: requiredString(value.factory, 'name'),
      description: nullableString(value.factory, 'description'),
      timezone: requiredString(value.factory, 'timezone'),
      currency: requiredString(value.factory, 'currency'),
      config: objectValue(value.factory, 'config'),
      metadata: objectValue(value.factory, 'metadata'),
      is_active: value.factory.is_active === true,
    },
    counts,
    energy_window: {
      from: value.energy_window.from as string | null,
      to: value.energy_window.to as string | null,
    },
    optimizer: {
      configured: value.optimizer.configured,
      reason: value.optimizer.reason as string | null,
    },
  }
}
