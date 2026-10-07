import {
  scheduleEntryRowSchema,
  scheduleRowSchema,
  type ScheduleCreate,
  type ScheduleEntryBulkInput,
  type ScheduleEntryCreate,
  type ScheduleEntryRow,
  type ScheduleEntryUpdate,
  type ScheduleRow,
  type ScheduleUpdate,
  type ScheduleWithEntries,
} from '../schemas/schedules'
import { InternalError } from '../errors'
import { optimizationRequestRowSchema } from '../schemas/optimization'
import type { OptimizationRequestRow } from '../schemas/optimization'
import { applyPagination, client, notFound, throwIfError, validateRow } from './base'
import { createScopedRepository, definedFields, jsonColumn } from './create-scoped-repository'
import type { ListParams, ListResult } from './types'

const SCHEDULE_COLUMNS = {
  name: 'name',
  version: 'version',
  status: 'status',
  horizon_start: 'horizon_start',
  horizon_end: 'horizon_end',
  optimization_request_id: 'optimization_request_id',
  optimization_result_id: 'optimization_result_id',
  total_energy_cost: 'total_energy_cost',
  total_energy_kwh: 'total_energy_kwh',
  peak_demand_kw: 'peak_demand_kw',
} as const

export const schedulesRepository = createScopedRepository<ScheduleRow, ScheduleCreate, ScheduleUpdate>({
  table: 'schedules',
  resource: 'schedules',
  rowSchema: scheduleRowSchema,
  defaultSortColumn: 'created_at',
  defaultSortAscending: false,

  toInsert(_factoryId, input) {
    return {
      ...definedFields(input, SCHEDULE_COLUMNS),
      optimization_request_id: input.optimization_request_id ?? null,
      optimization_result_id: input.optimization_result_id ?? null,
      metadata: jsonColumn(input.metadata, {}),
    }
  },

  toUpdate(input) {
    return {
      ...definedFields(input, SCHEDULE_COLUMNS),
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    }
  },
})

/* -------------------------------------------------------------------------- */
/* Entries                                                                    */
/* -------------------------------------------------------------------------- */

const ENTRY_COLUMNS = {
  machine_id: 'machine_id',
  process_id: 'process_id',
  production_order_id: 'production_order_id',
  starts_at: 'starts_at',
  ends_at: 'ends_at',
  power_kw: 'power_kw',
  energy_kwh: 'energy_kwh',
  cost: 'cost',
  quantity: 'quantity',
  sequence: 'sequence',
} as const

const ENTRY_UPDATE_COLUMNS = {
  production_order_id: 'production_order_id',
  starts_at: 'starts_at',
  ends_at: 'ends_at',
  power_kw: 'power_kw',
  energy_kwh: 'energy_kwh',
  cost: 'cost',
  quantity: 'quantity',
  sequence: 'sequence',
} as const

/**
 * Schedule columns a replacement or append may update alongside the entries.
 *
 * Every field is optional and its absence is meaningful: a key that is not
 * present leaves the column untouched, whereas a key present with `null` clears
 * it. That is why these are optional rather than `| null`.
 */
export interface SchedulePatch {
  status?: ScheduleUpdate['status']
  total_energy_cost?: number | null
  total_energy_kwh?: number | null
  peak_demand_kw?: number | null
  /** Merged into the existing metadata rather than replacing it. */
  metadata?: Record<string, unknown>
}

/**
 * Issues one transaction-spanning write for a schedule's entries.
 *
 * Both backends expose this as a function call, because that is the only way a
 * multi-statement change can be atomic: PostgREST runs each request in its own
 * transaction, and SQLite needs a BEGIN issued in the same place. Calling one
 * function name keeps the branch out of the repository — this code is
 * identical whichever database is underneath.
 *
 * A failure inside the transaction rolls back the delete, the insert and the
 * schedule update together, so the previous contents survive intact.
 */
async function writeEntries(
  rpcName: 'replace_schedule_entries' | 'append_schedule_entries',
  scheduleId: string,
  input: ScheduleEntryBulkInput,
  patch: SchedulePatch,
): Promise<ScheduleEntryRow[]> {
  // `schedule_id` is supplied by the function, not the payload: the route
  // addresses one schedule and letting a body override the id it replaces would
  // be a way to write into an unrelated schedule.
  const entries = input.entries.map((entry) => ({
    machine_id: entry.machine_id,
    process_id: entry.process_id,
    production_order_id: entry.production_order_id ?? null,
    starts_at: entry.starts_at,
    ends_at: entry.ends_at,
    power_kw: entry.power_kw ?? null,
    energy_kwh: entry.energy_kwh ?? null,
    cost: entry.cost ?? null,
    quantity: entry.quantity ?? null,
    sequence: entry.sequence,
    metadata: entry.metadata ?? {},
  }))

  // Strip undefined-valued patch keys so "absent" and "null" stay
  // distinguishable on the way to the database.
  const schedulePatch: Record<string, unknown> = {}
  for (const [column, value] of Object.entries(patch)) {
    if (value !== undefined) schedulePatch[column] = value
  }

  const { data, error } = await client().rpc(rpcName, {
    p_schedule_id: scheduleId,
    p_entries: entries,
    p_patch: schedulePatch,
  })

  throwIfError(error, rpcName === 'replace_schedule_entries' ? 'replace schedule entries' : 'append schedule entries')

  return ((data ?? []) as unknown[]).map((row) =>
    validateRow(scheduleEntryRowSchema, row, 'schedule_entries'),
  )
}

/**
 * Schedule entries are keyed by `schedule_id`, not `factory_id`, so this
 * repository does not use the generic scoped builder.
 */
export const scheduleEntriesRepository = {
  async list(scheduleId: string, params: ListParams): Promise<ListResult<ScheduleEntryRow>> {
    const query = applyPagination(
      client().from('schedule_entries').select('*', { count: 'exact' }).eq('schedule_id', scheduleId),
      params,
    ).order(params.sortColumn ?? 'starts_at', { ascending: params.sortAscending ?? true })

    const { data, error, count } = await query

    throwIfError(error, 'list schedule entries')
    return {
      rows: (data ?? []).map((row) => validateRow(scheduleEntryRowSchema, row, 'schedule_entries')),
      total: count ?? null,
    }
  },

  async getById(scheduleId: string, id: string): Promise<ScheduleEntryRow | null> {
    const { data, error } = await client()
      .from('schedule_entries')
      .select('*')
      .eq('schedule_id', scheduleId)
      .eq('id', id)
      .maybeSingle()

    throwIfError(error, 'get schedule entry')
    return data ? validateRow(scheduleEntryRowSchema, data, 'schedule_entries') : null
  },

  async create(scheduleId: string, input: ScheduleEntryCreate): Promise<ScheduleEntryRow> {
    const { data, error } = await client()
      .from('schedule_entries')
      .insert({
        ...definedFields(input, ENTRY_COLUMNS),
        schedule_id: scheduleId,
        production_order_id: input.production_order_id ?? null,
        metadata: jsonColumn(input.metadata, {}),
      })
      .select('*')
      .single()

    throwIfError(error, 'create schedule entry')
    return validateRow(scheduleEntryRowSchema, data, 'schedule_entries')
  },

  async update(scheduleId: string, id: string, input: ScheduleEntryUpdate): Promise<ScheduleEntryRow> {
    const { data, error } = await client()
      .from('schedule_entries')
      .update({
        ...definedFields(input, ENTRY_UPDATE_COLUMNS),
        ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
      })
      .eq('schedule_id', scheduleId)
      .eq('id', id)
      .select('*')
      .maybeSingle()

    throwIfError(error, 'update schedule entry')
    if (!data) throw notFound('schedule entries', id)
    return validateRow(scheduleEntryRowSchema, data, 'schedule_entries')
  },

  async remove(scheduleId: string, id: string): Promise<void> {
    const { data, error } = await client()
      .from('schedule_entries')
      .delete()
      .eq('schedule_id', scheduleId)
      .eq('id', id)
      .select('id')
      .maybeSingle()

    throwIfError(error, 'delete schedule entry')
    if (!data) throw notFound('schedule entries', id)
  },

  /**
   * Replaces every entry of a schedule with the supplied set, atomically.
   *
   * The delete, the insert and the schedule-row update happen inside ONE
   * database transaction (see migration 0003). This is not an optimisation: as
   * two separate PostgREST requests they could not be made atomic at all, since
   * PostgREST opens a transaction per request and there is no way to hold one
   * across two HTTP calls. A failure between them left the schedule empty.
   *
   * `patch` updates the schedule's state and metadata in the same transaction.
   * A key absent from the patch is left alone; a key present with null clears
   * the column. `metadata` is merged, not replaced.
   */
  async replaceAll(
    scheduleId: string,
    input: ScheduleEntryBulkInput,
    patch: SchedulePatch = {},
  ): Promise<ScheduleEntryRow[]> {
    return writeEntries('replace_schedule_entries', scheduleId, input, patch)
  },

  /**
   * Appends a batch of entries atomically, without deleting anything.
   *
   * Same transaction guarantee as `replaceAll`, so a batch that fails part way
   * through commits nothing rather than leaving the first few rows behind.
   */
  async appendMany(
    scheduleId: string,
    input: ScheduleEntryBulkInput,
    patch: SchedulePatch = {},
  ): Promise<ScheduleEntryRow[]> {
    return writeEntries('append_schedule_entries', scheduleId, input, patch)
  },

  /** Total entries across every schedule of a factory, for the summary view. */
  async countEntries(factoryId: string): Promise<number> {
    const schedules = await client().from('schedules').select('id').eq('factory_id', factoryId)

    throwIfError(schedules.error, 'list schedules for entry count')

    const ids = (schedules.data ?? []).map((row) => row.id as string)
    if (ids.length === 0) return 0

    const { count, error } = await client()
      .from('schedule_entries')
      .select('id', { count: 'exact', head: true })
      .in('schedule_id', ids)

    throwIfError(error, 'count schedule entries for factory')
    return count ?? 0
  },

  async count(scheduleId: string): Promise<number> {
    const { count, error } = await client()
      .from('schedule_entries')
      .select('id', { count: 'exact', head: true })
      .eq('schedule_id', scheduleId)

    throwIfError(error, 'count schedule entries')
    return count ?? 0
  },
}

/* -------------------------------------------------------------------------- */
/* Composite reads                                                            */
/* -------------------------------------------------------------------------- */

export interface ScheduleFilters {
  status?: string
  active_at?: string
}

/** Schedules with `status` and `active_at` horizon-overlap filters. */
export async function listSchedules(
  factoryId: string,
  params: ListParams,
  filters: ScheduleFilters = {},
): Promise<ListResult<ScheduleRow>> {
  let query = client().from('schedules').select('*', { count: 'exact' }).eq('factory_id', factoryId)

  if (filters.status) query = query.eq('status', filters.status)
  // A schedule is "active at" an instant when its horizon contains it.
  if (filters.active_at) {
    query = query.lte('horizon_start', filters.active_at).gte('horizon_end', filters.active_at)
  }

  query = applyPagination(query, params).order(
    params.sortColumn ?? 'created_at',
    { ascending: params.sortAscending ?? false },
  )

  const { data, error, count } = await query

  throwIfError(error, 'list schedules')
  return {
    rows: (data ?? []).map((row) => validateRow(scheduleRowSchema, row, 'schedules')),
    total: count ?? null,
  }
}

/** Page size used when loading a whole schedule. Not a cap: see loadAllEntries. */
const ENTRY_PAGE_SIZE = 1_000

/**
 * Loads every entry of a schedule, in chronological order.
 *
 * Previously this was a single `limit(10_000)` read. That was a silent
 * truncation: a schedule with 10,001 entries returned 10,000 of them, and the
 * response carried no indication that anything was missing. It was worse than
 * a plain cap, because the same numbers feed `computed_totals` — the peak
 * demand and totals in the response would describe the first 10,000 entries and
 * be presented as the schedule's totals.
 *
 * Now it pages until the database reports no more rows. `list` asks for an
 * exact count, so termination is driven by the database rather than by "this
 * page came back short", which would stop early on an exactly-full page.
 *
 * Ordering is by `starts_at`, with `id` as the tie-break, so entries sharing a
 * start instant have a stable order across pages. Without the tie-break, two
 * rows with the same `starts_at` could swap between page 1 and page 2 and one
 * could be duplicated while another was dropped.
 */
async function loadAllEntries(scheduleId: string): Promise<ScheduleEntryRow[]> {
  const entries: ScheduleEntryRow[] = []
  const pageSize = ENTRY_PAGE_SIZE

  for (let offset = 0; ; offset += pageSize) {
    const page = await listEntriesPage(scheduleId, pageSize, offset)
    entries.push(...page.rows)

    // `total` is the exact count of matching rows. Once we hold that many, the
    // schedule is fully loaded regardless of what the page returned.
    if (page.total !== null) {
      if (entries.length >= page.total) break
    } else if (page.rows.length < pageSize) {
      // No count available (a backend that did not ask for one): fall back to
      // a short page meaning "no more rows".
      break
    }

    // Defensive: a page that returns nothing cannot make progress. Without
    // this an infinite loop is possible if `total` ever reports more rows than
    // the query can return.
    if (page.rows.length === 0) break
  }

  return entries
}

/** One page of a schedule's entries, ordered with a stable tie-break. */
async function listEntriesPage(
  scheduleId: string,
  limit: number,
  offset: number,
): Promise<ListResult<ScheduleEntryRow>> {
  // Ordering by `starts_at` alone leaves rows sharing a start instant in an
  // unspecified order, which is fine for a single page and unsafe across pages:
  // page 1 and page 2 could each return a different one of two tied rows,
  // duplicating one and dropping the other. `id` is unique, so adding it makes
  // the order total. This needs the adapter's `order()` to accumulate, which it
  // now does, matching PostgREST.
  const { data, error, count } = await client()
    .from('schedule_entries')
    .select('*', { count: 'exact' })
    .eq('schedule_id', scheduleId)
    .order('starts_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(limit)
    .range(offset, offset + limit - 1)

  throwIfError(error, 'list schedule entries')

  return {
    rows: ((data ?? []) as unknown[]).map((row) =>
      validateRow(scheduleEntryRowSchema, row, 'schedule_entries'),
    ),
    total: count ?? null,
  }
}

/** Loads a schedule with its chronological entries and recomputed totals. */
export async function getScheduleWithEntries(
  factoryId: string,
  scheduleId: string,
): Promise<ScheduleWithEntries | null> {
  const schedule = await schedulesRepository.getById(factoryId, scheduleId)
  if (!schedule) return null

  const entries = await loadAllEntries(scheduleId)

  return { ...schedule, entries, entry_count: entries.length, computed_totals: computeTotals(entries) }
}

/**
 * The minimum an entry must supply to be totalled.
 *
 * Structural rather than `ScheduleEntryRow`, so the same function totals
 * persisted rows and validated-but-not-yet-written ones. The replacement path
 * needs the latter: it has to know the totals before the transaction commits,
 * so they can be written to `schedules` in that same transaction.
 */
export interface TotalsEntry {
  starts_at: string
  ends_at: string
  power_kw?: number | null
  energy_kwh?: number | null
  cost?: number | null
}

/**
 * Totals derived from entries.
 *
 * `peak_demand_kw` is the largest simultaneous power draw, computed with a
 * sweep over start/end events rather than a max, because the peak is a sum
 * across machines that run at the same time.
 */
export function computeTotals(entries: readonly TotalsEntry[]): ScheduleWithEntries['computed_totals'] {
  let totalEnergyKwh = 0
  let totalCost = 0
  let durationMinutes = 0

  const events: Array<{ at: string; delta: number }> = []

  for (const entry of entries) {
    totalEnergyKwh += entry.energy_kwh ?? 0
    totalCost += entry.cost ?? 0

    const start = new Date(entry.starts_at).getTime()
    const end = new Date(entry.ends_at).getTime()
    if (Number.isFinite(start) && Number.isFinite(end)) {
      durationMinutes += (end - start) / 60_000
      const power = entry.power_kw ?? 0
      if (power !== 0) {
        // Ends are processed before starts at the same instant so two touching
        // entries on one machine never look like an overlap.
        events.push({ at: entry.starts_at, delta: power })
        events.push({ at: entry.ends_at, delta: -power })
      }
    }
  }

  events.sort((a, b) => {
    const diff = new Date(a.at).getTime() - new Date(b.at).getTime()
    if (diff !== 0) return diff
    return a.delta - b.delta
  })

  let running = 0
  let peak = 0
  for (const event of events) {
    running += event.delta
    if (running > peak) peak = running
  }

  return {
    total_energy_kwh: totalEnergyKwh,
    total_energy_cost: totalCost,
    peak_demand_kw: peak,
    duration_minutes: durationMinutes,
  }
}

export interface OptimizationScheduleWrite {
  kind: 'baseline' | 'optimized'
  horizon_start: string
  horizon_end: string
  total_energy_cost: number | null
  total_energy_kwh: number | null
  peak_demand_kw: number | null
  entries: ScheduleEntryCreate[]
}

export interface PersistedOptimizationSchedule {
  schedule: ScheduleRow
  entries: ScheduleEntryRow[]
  computed_totals: ScheduleWithEntries['computed_totals']
}

export interface PersistedOptimizationSchedules {
  request: OptimizationRequestRow
  schedules: PersistedOptimizationSchedule[]
}

/**
 * Creates every schedule and entry for one optimizer result in one database
 * transaction. The successful optimization result is deliberately written
 * separately first so it remains auditable if this schedule transaction fails.
 */
export async function persistOptimizationSchedules(
  factoryId: string,
  requestId: string,
  resultId: string,
  adapter: string,
  schedules: OptimizationScheduleWrite[],
): Promise<PersistedOptimizationSchedules> {
  const { data, error } = await client().rpc('persist_optimization_schedules', {
    p_factory_id: factoryId,
    p_optimization_request_id: requestId,
    p_optimization_result_id: resultId,
    p_adapter: adapter,
    p_schedules: schedules.map((schedule) => ({
      kind: schedule.kind,
      horizon_start: schedule.horizon_start,
      horizon_end: schedule.horizon_end,
      total_energy_cost: schedule.total_energy_cost,
      total_energy_kwh: schedule.total_energy_kwh,
      peak_demand_kw: schedule.peak_demand_kw,
      entries: schedule.entries.map((entry) => ({
        machine_id: entry.machine_id,
        process_id: entry.process_id,
        production_order_id: entry.production_order_id ?? null,
        starts_at: entry.starts_at,
        ends_at: entry.ends_at,
        power_kw: entry.power_kw ?? null,
        energy_kwh: entry.energy_kwh ?? null,
        cost: entry.cost ?? null,
        quantity: entry.quantity ?? null,
        sequence: entry.sequence,
        metadata: entry.metadata ?? {},
      })),
    })),
  })
  throwIfError(error, 'persist optimizer schedules')

  const response: unknown = data
  if (
    typeof response !== 'object' || response === null ||
    !('schedules' in response) || !('request' in response) ||
    !Array.isArray(response.schedules) || response.schedules.length !== schedules.length
  ) {
    throw new InternalError('Atomic optimizer schedule write returned an invalid response.')
  }

  const request = validateRow(optimizationRequestRowSchema, response.request, 'optimization_requests')
  const schedulePayloads: unknown[] = response.schedules
  const persistedSchedules = schedulePayloads.map((raw) => {
    if (
      typeof raw !== 'object' || raw === null || !('schedule' in raw) ||
      !('entries' in raw) || !Array.isArray(raw.entries)
    ) {
      throw new InternalError('Atomic optimizer schedule write returned an invalid schedule.')
    }
    const schedule = validateRow(scheduleRowSchema, raw.schedule, 'schedules')
    const entryPayloads: unknown[] = raw.entries
    const entries = entryPayloads.map((entry) => validateRow(scheduleEntryRowSchema, entry, 'schedule_entries'))
    if (entries.some((entry) => entry.schedule_id !== schedule.id)) {
      throw new InternalError('Atomic optimizer schedule write returned entries for another schedule.')
    }
    return { schedule, entries, computed_totals: computeTotals(entries) }
  })
  return { request, schedules: persistedSchedules }
}

/** Entries for a machine that overlap a time window, ignoring the entry itself. */
export async function findOverlappingEntries(
  scheduleId: string,
  machineId: string,
  startsAt: string,
  endsAt: string,
  excludeEntryId?: string,
): Promise<ScheduleEntryRow[]> {
  let query = client()
    .from('schedule_entries')
    .select('*')
    .eq('schedule_id', scheduleId)
    .eq('machine_id', machineId)
    .lt('starts_at', endsAt)
    .gt('ends_at', startsAt)

  if (excludeEntryId) query = query.neq('id', excludeEntryId)

  const { data, error } = await query

  throwIfError(error, 'check schedule entry overlap')
  return (data ?? []).map((row) => validateRow(scheduleEntryRowSchema, row, 'schedule_entries'))
}