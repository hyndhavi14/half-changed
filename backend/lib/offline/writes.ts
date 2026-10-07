/**
 * The offline implementation of the atomic schedule write operations.
 *
 * 0003 adds `replace_schedule_entries` and `append_schedule_entries` to
 * Postgres, because PostgREST cannot hold a transaction open across two HTTP
 * requests and the delete+insert of a schedule replacement therefore had to
 * happen inside the database. SQLite has no such limitation, but the guarantee
 * still has to be implemented or the offline backend would quietly be the one
 * that can half-apply a replacement.
 *
 * So this module runs the same three steps inside a real
 * `db.transaction(...)`, which is better-sqlite3's BEGIN/COMMIT/ROLLBACK:
 *
 *   1. lock the schedule row      (BEGIN IMMEDIATE takes the write lock, and
 *                                  the existence check proves the id is real)
 *   2. delete / append the entries
 *   3. update the schedule's status, metadata and denormalised totals
 *
 * Any throw inside the callback rolls the whole thing back, so a bad entry in
 * the middle of a batch leaves the previous contents intact — the property the
 * Postgres functions provide.
 *
 * PATCH SEMANTICS
 * ---------------
 * A key absent from the patch leaves the column alone; a key present with a
 * null clears it. `undefined` means absent, `null` means clear, which is why
 * the patch is built with an explicit key-presence test rather than
 * coalesced. This mirrors the `p_patch ? 'key'` test in the SQL migration, and
 * `metadata` is merged rather than replaced for the same reason it is there.
 */

import type { SqliteDatabase } from './db'
import { getDb } from './db'
import { COLUMN_TYPES, type TableName } from './schema'
import { offlineAggregateRpc } from './aggregates'

type Row = Record<string, unknown>

/** A schedule-entry column set, decoded from the repository's jsonb payload. */
type EntryInput = {
  machine_id: string
  process_id: string
  production_order_id?: string | null
  starts_at: string
  ends_at: string
  power_kw?: number | null
  energy_kwh?: number | null
  cost?: number | null
  quantity?: number | null
  sequence?: number | null
  metadata?: Record<string, unknown> | null
}

/** Columns the replacement/append writes on `schedules`. */
const SCHEDULE_PATCH_COLUMNS = [
  'status',
  'total_energy_cost',
  'total_energy_kwh',
  'peak_demand_kw',
] as const

/** SQLite raises this text for a FOREIGN KEY constraint failure. */
function isForeignKeyFailure(error: unknown): boolean {
  return /FOREIGN KEY constraint failed/i.test(String((error as Error)?.message ?? ''))
}

/** SQLite raises this text for a NOT NULL constraint failure. */
function isNotNullFailure(error: unknown): boolean {
  return /NOT NULL constraint failed/i.test(String((error as Error)?.message ?? ''))
}

/** SQLite raises this text for a CHECK constraint failure. */
function isCheckFailure(error: unknown): boolean {
  return /CHECK constraint failed/i.test(String((error as Error)?.message ?? ''))
}

/**
 * Shapes a thrown SQLite error like PostgREST, so `mapDatabaseError` in
 * lib/http.ts maps it to the same HTTP status on both backends.
 *
 * These codes are the SQLite equivalents:
 *   FK violation   -> 23503  (ValidationError, "references a record that does
 *                              not exist")
 *   NOT NULL       -> 23502  (ValidationError, "a required field was missing")
 *   CHECK          -> 23514  (ValidationError, "violates a check constraint")
 */
export function offlineEntryError(error: unknown): {
  code: string
  message: string
  details: string | null
  hint: string | null
} {
  const message = String((error as Error)?.message ?? error)

  if (isForeignKeyFailure(error)) {
    return {
      code: '23503',
      message: 'FOREIGN KEY constraint failed',
      details: message,
      hint: 'A referenced machine, process or production order does not exist.',
    }
  }
  if (isNotNullFailure(error)) {
    return { code: '23502', message: 'NOT NULL constraint failed', details: message, hint: null }
  }
  if (isCheckFailure(error)) {
    return { code: '23514', message: 'CHECK constraint failed', details: message, hint: null }
  }

  return { code: 'P0001', message, details: null, hint: null }
}

/** Maps the `schedule does not exist` signal onto the same code the SQL uses. */
function scheduleMissing(scheduleId: string) {
  return {
    code: 'P0002',
    message: `schedule ${scheduleId} does not exist`,
    details: null,
    hint: null,
  }
}

function toEntries(payload: unknown): EntryInput[] {
  return Array.isArray(payload) ? (payload as EntryInput[]) : []
}

function toPatch(payload: unknown): Row {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return {}
  return payload as Row
}

/**
 * Builds the INSERT for a batch of entries.
 *
 * The column list is the union across the batch, mirroring the adapter's own
 * insert: a key absent from one entry falls back to its column default rather
 * than being written as NULL.
 */
function insertEntries(
  db: SqliteDatabase,
  scheduleId: string,
  entries: EntryInput[],
): Row[] {
  if (entries.length === 0) return []

  const kinds = COLUMN_TYPES.schedule_entries
  const prepared = entries.map((entry) => ({
    id: crypto.randomUUID(),
    schedule_id: scheduleId,
    machine_id: entry.machine_id,
    process_id: entry.process_id,
    production_order_id: entry.production_order_id ?? null,
    starts_at: entry.starts_at,
    ends_at: entry.ends_at,
    power_kw: entry.power_kw ?? null,
    energy_kwh: entry.energy_kwh ?? null,
    cost: entry.cost ?? null,
    quantity: entry.quantity ?? null,
    sequence: entry.sequence ?? 0,
    metadata: JSON.stringify(entry.metadata ?? {}),
  }))

  const columns = [...new Set(prepared.flatMap((row) => Object.keys(row)))]
  const sql =
    `INSERT INTO schedule_entries (${columns.join(', ')}) VALUES ` +
    prepared.map(() => `(${columns.map(() => '?').join(', ')})`).join(', ')

  // One statement, one binding of the whole batch. Executing the same prepared
  // statement once per row does not work: the SQL still carries a placeholder
  // for every row, so `get()` would bind a single row's parameters against a
  // multi-row statement and better-sqlite3 would reject it as "too few
  // parameter values".
  const params = prepared.flatMap((entry) => {
    const record = entry as Row
    return columns.map((column) => {
      const value = record[column]
      return kinds[column as keyof typeof kinds] === 'json' && typeof value === 'string'
        ? value
        : (value ?? null)
    })
  })

  return db.prepare(`${sql} RETURNING *`).all(...params) as Row[]
}

/**
 * Applies the schedule patch.
 *
 * Key presence decides what is written, exactly as `p_patch ? 'key'` does in
 * the SQL migration. `metadata` is merged so a patch that mentions one key
 * does not discard the caller's others.
 */
function patchSchedule(db: SqliteDatabase, scheduleId: string, patch: Row): void {
  const assignments: string[] = []
  const params: unknown[] = []

  for (const column of SCHEDULE_PATCH_COLUMNS) {
    if (!(column in patch)) continue
    assignments.push(`${column} = ?`)
    params.push(patch[column] ?? null)
  }

  if ('metadata' in patch) {
    const current = db
      .prepare('SELECT metadata FROM schedules WHERE id = ?')
      .get(scheduleId) as { metadata?: string } | undefined

    let existing: Record<string, unknown> = {}
    if (current?.metadata) {
      try {
        existing = JSON.parse(current.metadata) as Record<string, unknown>
      } catch {
        existing = {}
      }
    }

    const incoming = (patch.metadata ?? {}) as Record<string, unknown>
    assignments.push('metadata = ?')
    params.push(JSON.stringify({ ...existing, ...incoming }))
  }

  if (assignments.length === 0) return

  // SQL always issues the UPDATE, even for an empty patch, so `updated_at` is
  // bumped via the 0001 trigger. Here an empty patch issues no statement at
  // all, so `updated_at` is left alone. That is a deliberate difference: the
  // offline trigger only fires when an UPDATE reaches the row, and no caller
  // reads `updated_at` to decide whether a replacement happened — the entry
  // rows themselves are the record.
  db.prepare(`UPDATE schedules SET ${assignments.join(', ')} WHERE id = ?`).run(...params, scheduleId)
}

/** True when the schedule exists, locking the write for the transaction. */
function scheduleExists(db: SqliteDatabase, scheduleId: string): boolean {
  const row = db.prepare('SELECT id FROM schedules WHERE id = ?').get(scheduleId)
  return row !== undefined
}

function orderRows(rows: Row[]): Row[] {
  return [...rows].sort((a, b) => {
    const byStart = String(a.starts_at).localeCompare(String(b.starts_at))
    if (byStart !== 0) return byStart
    const bySequence = Number(a.sequence ?? 0) - Number(b.sequence ?? 0)
    if (bySequence !== 0) return bySequence
    return String(a.id).localeCompare(String(b.id))
  })
}

function decodeEntry(row: Row): Row {
  const out: Row = { ...row }
  const kinds = COLUMN_TYPES.schedule_entries
  for (const [column, kind] of Object.entries(kinds)) {
    if (kind === 'json' && typeof out[column] === 'string') {
      try {
        out[column] = JSON.parse(out[column] as string)
      } catch {
        out[column] = {}
      }
    }
  }
  return out
}

function decodeRpcRow(table: TableName, row: Row): Row {
  const decoded = { ...row }
  for (const [column, kind] of Object.entries(COLUMN_TYPES[table])) {
    const value = decoded[column]
    if (value === null || value === undefined) continue
    if ((kind === 'json' || kind === 'array') && typeof value === 'string') {
      decoded[column] = JSON.parse(value) as unknown
    } else if (kind === 'bool') {
      decoded[column] = value === 1
    } else if (kind === 'number') {
      decoded[column] = Number(value)
    }
  }
  return decoded
}

export interface OfflineWriteResult {
  data: unknown
  error: ReturnType<typeof offlineEntryError> | null
  count: number | null
}

/**
 * Deletes every entry of a schedule and inserts `payload` in their place,
 * updating the schedule row in the same transaction.
 */
export function replaceScheduleEntries(
  db: SqliteDatabase,
  scheduleId: string,
  payload: unknown,
  patchPayload: unknown,
): OfflineWriteResult {
  const entries = toEntries(payload)
  const patch = toPatch(patchPayload)

  const run = db.transaction((): Row[] => {
    if (!scheduleExists(db, scheduleId)) throw Object.assign(new Error('missing'), { __offlineMissing: true })

    db.prepare('DELETE FROM schedule_entries WHERE schedule_id = ?').run(scheduleId)
    const inserted = insertEntries(db, scheduleId, entries)
    patchSchedule(db, scheduleId, patch)

    return orderRows(inserted)
  })

  try {
    const rows = run()
    return { data: rows.map(decodeEntry), error: null, count: rows.length }
  } catch (error) {
    if ((error as { __offlineMissing?: boolean }).__offlineMissing) {
      return { data: null, error: scheduleMissing(scheduleId), count: null }
    }
    return { data: null, error: offlineEntryError(error), count: null }
  }
}

/** Appends `payload` to a schedule without deleting anything, atomically. */
export function appendScheduleEntries(
  db: SqliteDatabase,
  scheduleId: string,
  payload: unknown,
  patchPayload: unknown,
): OfflineWriteResult {
  const entries = toEntries(payload)
  const patch = toPatch(patchPayload)

  const run = db.transaction((): Row[] => {
    if (!scheduleExists(db, scheduleId)) throw Object.assign(new Error('missing'), { __offlineMissing: true })

    const inserted = insertEntries(db, scheduleId, entries)
    patchSchedule(db, scheduleId, patch)

    return orderRows(inserted)
  })

  try {
    const rows = run()
    return { data: rows.map(decodeEntry), error: null, count: rows.length }
  } catch (error) {
    if ((error as { __offlineMissing?: boolean }).__offlineMissing) {
      return { data: null, error: scheduleMissing(scheduleId), count: null }
    }
    return { data: null, error: offlineEntryError(error), count: null }
  }
}

interface OptimizationScheduleInput {
  kind: 'baseline' | 'optimized'
  horizon_start: string
  horizon_end: string
  total_energy_cost: number | null
  total_energy_kwh: number | null
  peak_demand_kw: number | null
  entries: EntryInput[]
}

/**
 * Inserts all draft schedules and their entries together. The corresponding
 * successful optimization result is intentionally already persisted.
 */
export function persistOptimizationSchedules(
  db: SqliteDatabase,
  factoryId: string,
  requestId: string,
  resultId: string,
  adapter: string,
  payload: unknown,
): OfflineWriteResult {
  const schedules = Array.isArray(payload) ? payload as OptimizationScheduleInput[] : []

  const run = db.transaction((): Row => {
    const factory = db.prepare('SELECT id FROM factories WHERE id = ?').get(factoryId)
    const request = db.prepare(
      'SELECT id, factory_id, status, adapter_metadata FROM optimization_requests WHERE id = ?',
    ).get(requestId) as Row | undefined
    const result = db.prepare(
      'SELECT id, factory_id, optimization_request_id, status FROM optimization_results WHERE id = ?',
    ).get(resultId) as Row | undefined
    if (
      !factory ||
      !request || request.factory_id !== factoryId || request.status !== 'running' ||
      !result || result.factory_id !== factoryId || result.optimization_request_id !== requestId || result.status !== 'succeeded' ||
      schedules.length < 1 || schedules.length > 2
    ) {
      throw new Error('optimization persistence references are invalid')
    }

    const kinds = new Set<string>()
    const created: Row[] = []
    for (const spec of schedules) {
      if (
        (spec.kind !== 'baseline' && spec.kind !== 'optimized') ||
        kinds.has(spec.kind) ||
        !Array.isArray(spec.entries) ||
        spec.entries.length === 0
      ) {
        throw new Error('optimization schedule payload is invalid')
      }
      kinds.add(spec.kind)

      const name = spec.kind === 'baseline' ? 'Optimizer baseline' : 'Optimizer optimized'
      const current = db.prepare(
        'SELECT MAX(version) AS version FROM schedules WHERE factory_id = ? AND name = ?',
      ).get(factoryId, name) as { version: number | null }
      const version = (current.version ?? 0) + 1
      const scheduleId = crypto.randomUUID()
      db.prepare(`
        INSERT INTO schedules (
          id, factory_id, name, version, status, horizon_start, horizon_end,
          optimization_request_id, optimization_result_id, total_energy_cost,
          total_energy_kwh, peak_demand_kw, metadata
        ) VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        scheduleId,
        factoryId,
        name,
        version,
        spec.horizon_start,
        spec.horizon_end,
        requestId,
        resultId,
        spec.total_energy_cost,
        spec.total_energy_kwh,
        spec.peak_demand_kw,
        JSON.stringify({ kind: spec.kind }),
      )
      const entryRows = insertEntries(db, scheduleId, spec.entries)
      const scheduleRow = db.prepare('SELECT * FROM schedules WHERE id = ?').get(scheduleId) as Row
      created.push({
        schedule: decodeRpcRow('schedules', scheduleRow),
        entries: orderRows(entryRows).map((entryRow) => decodeRpcRow('schedule_entries', entryRow)),
      })
    }

    if (!kinds.has('optimized')) throw new Error('optimized schedule is required')
    const existingMetadata = request.adapter_metadata
      ? JSON.parse(String(request.adapter_metadata)) as Row
      : {}
    db.prepare(`
      UPDATE optimization_requests
         SET status = 'succeeded', error_message = NULL, adapter_metadata = ?
       WHERE id = ? AND factory_id = ?
    `).run(
      JSON.stringify({
        ...existingMetadata,
        adapter,
        optimization_result_id: resultId,
        schedule_persistence_status: 'succeeded',
        schedule_ids: created.map((item) => (item.schedule as Row).id),
      }),
      requestId,
      factoryId,
    )
    const updatedRequest = db.prepare(
      'SELECT * FROM optimization_requests WHERE id = ? AND factory_id = ?',
    ).get(requestId, factoryId) as Row
    return {
      request: decodeRpcRow('optimization_requests', updatedRequest),
      schedules: created,
    }
  })

  try {
    return { data: run(), error: null, count: schedules.length }
  } catch (error) {
    return { data: null, error: offlineEntryError(error), count: null }
  }
}

interface BuilderMachineInput {
  slug: string
  name: string
  type: string
  rated_power_kw: number
  is_active: boolean
}

interface BuilderProcessInput {
  slug: string
  name: string
  machine_slug: string
  duration_minutes: number
  is_active: boolean
}

function jsonObject(value: unknown): Row {
  if (typeof value !== 'string') return {}
  try {
    const parsed: unknown = JSON.parse(value)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Row
      : {}
  } catch {
    return {}
  }
}

/** Persists a factory model and its Builder-owned child rows atomically. */
export function saveFactoryBuilder(
  db: SqliteDatabase,
  factoryId: string | null,
  factory: Row,
  machines: BuilderMachineInput[],
  processes: BuilderProcessInput[],
): OfflineWriteResult {
  const run = db.transaction((): Row => {
    const now = new Date().toISOString()
    let savedFactoryId = factoryId
    if (savedFactoryId) {
      const existing = db.prepare('SELECT config, metadata FROM factories WHERE id = ?')
        .get(savedFactoryId) as Row | undefined
      if (!existing) throw new Error(`factory ${savedFactoryId} does not exist`)
      const config = jsonObject(existing.config)
      config.builder = {
        industry: factory.industry,
        working_hours_per_day: factory.working_hours_per_day,
        solar_capacity_kw: factory.solar_capacity_kw,
      }
      const metadata = jsonObject(existing.metadata)
      metadata.managed_by = 'factory_builder'
      db.prepare(`
        UPDATE factories
           SET name = ?, description = ?, currency = ?, config = ?, metadata = ?
         WHERE id = ?
      `).run(factory.name, factory.industry, factory.currency, JSON.stringify(config), JSON.stringify(metadata), savedFactoryId)
    } else {
      savedFactoryId = crypto.randomUUID()
      db.prepare(`
        INSERT INTO factories
          (id, slug, name, description, timezone, currency, config, metadata, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'UTC', ?, ?, ?, 1, ?, ?)
      `).run(
        savedFactoryId,
        factory.slug,
        factory.name,
        factory.industry,
        factory.currency,
        JSON.stringify({
          builder: {
            industry: factory.industry,
            working_hours_per_day: factory.working_hours_per_day,
            solar_capacity_kw: factory.solar_capacity_kw,
          },
        }),
        JSON.stringify({ managed_by: 'factory_builder' }),
        now,
        now,
      )
    }

    const machineIds = new Map<string, string>()
    const machineRows: Row[] = []
    for (const machine of machines) {
      db.prepare(`
        INSERT INTO machines
          (id, factory_id, slug, name, type, rated_power_kw, availability, metadata, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, ?)
        ON CONFLICT(factory_id, slug) DO UPDATE SET
          name = excluded.name,
          type = excluded.type,
          rated_power_kw = excluded.rated_power_kw,
          metadata = json_patch(machines.metadata, excluded.metadata),
          is_active = excluded.is_active
      `).run(
        crypto.randomUUID(), savedFactoryId, machine.slug, machine.name, machine.type,
        machine.rated_power_kw, JSON.stringify({ managed_by: 'factory_builder' }),
        machine.is_active ? 1 : 0, now, now,
      )
      const row = db.prepare('SELECT * FROM machines WHERE factory_id = ? AND slug = ?')
        .get(savedFactoryId, machine.slug) as Row
      machineIds.set(machine.slug, String(row.id))
      machineRows.push(decodeRpcRow('machines', row))
    }

    const machineSlugs = machines.map((machine) => machine.slug)
    db.prepare(`UPDATE machines SET is_active = 0 WHERE factory_id = ? AND slug NOT IN (${machineSlugs.map(() => '?').join(', ')})`)
      .run(savedFactoryId, ...machineSlugs)

    const processRows: Row[] = []
    for (const process of processes) {
      const machineId = machineIds.get(process.machine_slug)
      const machine = machines.find((candidate) => candidate.slug === process.machine_slug)
      if (!machineId || !machine || (process.is_active && !machine.is_active)) {
        throw new Error('active process references an unavailable factory machine')
      }
      db.prepare(`
        INSERT INTO processes
          (id, factory_id, slug, name, duration_minutes, machine_id, power_requirement_kw, metadata, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(factory_id, slug) DO UPDATE SET
          name = excluded.name,
          duration_minutes = excluded.duration_minutes,
          machine_id = excluded.machine_id,
          power_requirement_kw = excluded.power_requirement_kw,
          metadata = json_patch(processes.metadata, excluded.metadata),
          is_active = excluded.is_active
      `).run(
        crypto.randomUUID(), savedFactoryId, process.slug, process.name,
        process.duration_minutes, machineId, machine.rated_power_kw,
        JSON.stringify({ managed_by: 'factory_builder' }), process.is_active ? 1 : 0, now, now,
      )
      const row = db.prepare('SELECT * FROM processes WHERE factory_id = ? AND slug = ?')
        .get(savedFactoryId, process.slug) as Row
      processRows.push(decodeRpcRow('processes', row))
    }

    const processSlugs = processes.map((process) => process.slug)
    db.prepare(`UPDATE processes SET is_active = 0 WHERE factory_id = ? AND slug NOT IN (${processSlugs.map(() => '?').join(', ')})`)
      .run(savedFactoryId, ...processSlugs)

    const tariffs = [
      ['builder-off-peak-early', 'Builder off-peak', '00:00', '18:00', factory.off_peak_tariff, 10],
      ['builder-peak', 'Builder peak', '18:00', '22:00', factory.peak_tariff, 20],
      ['builder-off-peak-late', 'Builder off-peak', '22:00', '23:59', factory.off_peak_tariff, 10],
    ] as const
    for (const [slug, name, start, end, price, priority] of tariffs) {
      db.prepare(`
        INSERT INTO electricity_tariffs
          (id, factory_id, slug, name, currency, start_time, end_time, energy_price_per_kwh, priority, metadata, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(factory_id, slug) DO UPDATE SET
          name = excluded.name, currency = excluded.currency,
          start_time = excluded.start_time, end_time = excluded.end_time,
          energy_price_per_kwh = excluded.energy_price_per_kwh,
          priority = excluded.priority,
          metadata = json_patch(electricity_tariffs.metadata, excluded.metadata)
      `).run(
        crypto.randomUUID(), savedFactoryId, slug, name, factory.currency, start, end, price, priority,
        JSON.stringify({ managed_by: 'factory_builder' }), now, now,
      )
    }

    const savedFactory = decodeRpcRow(
      'factories',
      db.prepare('SELECT * FROM factories WHERE id = ?').get(savedFactoryId) as Row,
    )
    return { factory_id: savedFactoryId, factory: savedFactory, machines: machineRows, processes: processRows }
  })

  try {
    return { data: run(), error: null, count: 1 }
  } catch (error) {
    return { data: null, error: offlineEntryError(error), count: null }
  }
}

/**
 * Dispatches an RPC name to its offline implementation.
 *
 * Mirrors PostgREST's `/rest/v1/rpc/<name>` surface so the repository can call
 * one function name regardless of backend. An unknown name is a 404-shaped
 * error rather than a silent no-op, so a typo fails loudly.
 *
 * Aggregate functions (migration 0004) are dispatched first, in
 * lib/offline/aggregates.ts; the multi-statement writes live here.
 */
export function offlineRpc(
  name: string,
  args: Record<string, unknown> = {},
  db: SqliteDatabase = getDb(),
): OfflineWriteResult {
  // Aggregates are a different concern in a different module; try them first so
  // this dispatcher stays focused on the writes it owns.
  const aggregate = offlineAggregateRpc(name, args as never, db)
  if (aggregate.error?.code !== 'PGRST202') return aggregate

  const scheduleId = typeof args.p_schedule_id === 'string' ? args.p_schedule_id : ''

  switch (name) {
    case 'replace_schedule_entries':
      return replaceScheduleEntries(db, scheduleId, args.p_entries, args.p_patch)
    case 'append_schedule_entries':
      return appendScheduleEntries(db, scheduleId, args.p_entries, args.p_patch)
    case 'persist_optimization_schedules':
      return persistOptimizationSchedules(
        db,
        typeof args.p_factory_id === 'string' ? args.p_factory_id : '',
        typeof args.p_optimization_request_id === 'string' ? args.p_optimization_request_id : '',
        typeof args.p_optimization_result_id === 'string' ? args.p_optimization_result_id : '',
        typeof args.p_adapter === 'string' ? args.p_adapter : '',
        args.p_schedules,
      )
    case 'save_factory_builder':
      return saveFactoryBuilder(
        db,
        typeof args.p_factory_id === 'string' ? args.p_factory_id : null,
        (args.p_factory ?? {}) as Row,
        (Array.isArray(args.p_machines) ? args.p_machines : []) as BuilderMachineInput[],
        (Array.isArray(args.p_processes) ? args.p_processes : []) as BuilderProcessInput[],
      )
    default:
      return {
        data: null,
        error: {
          code: 'PGRST202',
          message: `offline: no RPC named '${name}'`,
          details: null,
          hint: 'Implement it in lib/offline/writes.ts or lib/offline/aggregates.ts, or call the repository directly.',
        },
        count: null,
      }
  }
}
