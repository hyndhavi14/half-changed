/**
 * Phase 2 — transactional schedule replacement.
 *
 * THE DEFECT UNDER TEST
 * ---------------------
 * Replacing a schedule's entries used to be two separate PostgREST requests:
 *
 *   1. DELETE FROM schedule_entries WHERE schedule_id = ?
 *   2. INSERT INTO schedule_entries (...) VALUES ...
 *
 * PostgREST runs each request in its own transaction and there is no way to
 * hold one open across two HTTP calls, so those statements could not be made
 * atomic. If the INSERT failed, the schedule was left with zero entries: a
 * silent data loss that a retry could not recover, because the previous
 * contents were already gone.
 *
 * WHAT IS ASSERTED HERE
 * ---------------------
 * The rollback cases are the point. Each one deliberately provokes a mid-write
 * failure — a foreign key to a machine that does not exist, a check constraint,
 * a NOT NULL column — and then asserts the ORIGINAL entries are still there.
 * A test that only checked the happy path would pass against the old
 * two-request implementation, which is why the failure cases are written to
 * fail loudly rather than merely return an error.
 *
 * Everything runs against an isolated in-memory database through the real
 * repositories and the real `client()` seam, so this exercises the same code
 * path production uses.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { closeDb, getDb } from '@/lib/offline/db'
import { resetEnvCache } from '@/lib/env'
import { initOfflineSchema } from '@/lib/offline/init'
import { seedOfflineDatabase } from '@/lib/offline/seed'
import { offlineRpc, replaceScheduleEntries } from '@/lib/offline/writes'

import {
  computeTotals,
  persistOptimizationSchedules,
  scheduleEntriesRepository,
  schedulesRepository,
} from '@/lib/repositories/schedules'
import {
  optimizationRequestsRepository,
  optimizationResultsRepository,
} from '@/lib/repositories/optimization'
import { mapDatabaseError } from '@/lib/http'
import { scheduleEntryBulkSchema } from '@/lib/schemas/schedules'
import type { SqliteDatabase } from '@/lib/offline/db'

/* -------------------------------------------------------------------------- */
/* Harness                                                                    */
/* -------------------------------------------------------------------------- */

const savedEnv = {
  mode: process.env.BYTEME_OFFLINE_MODE,
  path: process.env.BYTEME_OFFLINE_DB_PATH,
}

const T0 = '2032-05-01T08:00:00.000Z'
const T1 = '2032-05-01T09:00:00.000Z'
const T2 = '2032-05-01T10:00:00.000Z'
const T3 = '2032-05-01T11:00:00.000Z'

/** A uuid that is well-formed but references nothing. */
const MISSING_UUID = '00000000-0000-4000-8000-00000000dead'

let db: SqliteDatabase
let factoryId = ''
let machineId = ''
let secondMachineId = ''
let processId = ''

function entry(overrides: Record<string, unknown> = {}) {
  return {
    machine_id: machineId,
    process_id: processId,
    starts_at: T0,
    ends_at: T1,
    power_kw: 100,
    energy_kwh: 100,
    cost: 10,
    sequence: 1,
    ...overrides,
  }
}

/** Current entry count straight from SQL, bypassing the repository. */
function entryCount(scheduleId: string): number {
  const row = db.prepare('SELECT COUNT(*) AS c FROM schedule_entries WHERE schedule_id = ?').get(scheduleId) as {
    c: number
  }
  return row.c
}

/** Machine ids currently stored, so a rollback can be checked precisely. */
function storedMachineIds(scheduleId: string): string[] {
  const rows = db
    .prepare('SELECT machine_id FROM schedule_entries WHERE schedule_id = ? ORDER BY starts_at')
    .all(scheduleId) as Array<{ machine_id: string }>
  return rows.map((row) => row.machine_id)
}

function readSchedule(scheduleId: string): Record<string, unknown> {
  return db.prepare('SELECT * FROM schedules WHERE id = ?').get(scheduleId) as Record<string, unknown>
}

/** Creates a fresh schedule so each test starts from a known state. */
async function newSchedule(name: string): Promise<string> {
  const schedule = await schedulesRepository.create(factoryId, {
    name,
    version: 1,
    status: 'draft',
    horizon_start: T0,
    horizon_end: T3,
  })
  return schedule.id
}

beforeAll(async () => {
  process.env.BYTEME_OFFLINE_MODE = 'true'
  process.env.BYTEME_OFFLINE_DB_PATH = ':memory:'
  // serverEnv() memoises, so the flags above have to be dropped before it is
  // read or `client()` keeps returning the Supabase path.
  resetEnvCache()

  // getDb(), not a private handle: the repositories reach the database through
  // the same `client()` seam production uses, so seeding a different connection
  // would leave the queries running against an empty schema.
  db = getDb()
  initOfflineSchema(db)

  const seeded = await seedOfflineDatabase(db)
  factoryId = seeded.factoryId
  machineId = Object.values(seeded.machineIds)[0] ?? ''
  secondMachineId = Object.values(seeded.machineIds)[1] ?? ''
  processId = Object.values(seeded.processIds)[0] ?? ''
})

afterAll(() => {
  closeDb()

  if (savedEnv.mode === undefined) delete process.env.BYTEME_OFFLINE_MODE
  else process.env.BYTEME_OFFLINE_MODE = savedEnv.mode

  if (savedEnv.path === undefined) delete process.env.BYTEME_OFFLINE_DB_PATH
  else process.env.BYTEME_OFFLINE_DB_PATH = savedEnv.path

  resetEnvCache()
})

/* -------------------------------------------------------------------------- */
/* Rollback: the whole point of the phase                                     */
/* -------------------------------------------------------------------------- */

describe('a failed replacement leaves the schedule exactly as it was', () => {
  let scheduleId = ''

  beforeEach(async () => {
    scheduleId = await newSchedule(`rollback-${Math.random().toString(36).slice(2, 8)}`)

    // Two known-good entries, one on each machine.
    await scheduleEntriesRepository.replaceAll(scheduleId, {
      entries: [
        entry({ machine_id: machineId, starts_at: T0, ends_at: T1, sequence: 1 }),
        entry({ machine_id: secondMachineId, starts_at: T2, ends_at: T3, sequence: 2 }),
      ],
    })
  })

  it('rolls back the delete when an entry references a machine that does not exist', async () => {
    const before = storedMachineIds(scheduleId)
    expect(before).toEqual([machineId, secondMachineId])

    // The foreign key fails on the SECOND row of the batch. With the old
    // delete-then-insert implementation, the delete had already committed by
    // the time this error surfaced.
    await expect(
      scheduleEntriesRepository.replaceAll(scheduleId, {
        entries: [
          entry({ machine_id: machineId, starts_at: T0, ends_at: T1 }),
          entry({ machine_id: MISSING_UUID, starts_at: T2, ends_at: T3 }),
        ],
      }),
    ).rejects.toThrow()

    expect(entryCount(scheduleId)).toBe(2)
    expect(storedMachineIds(scheduleId)).toEqual(before)
  })

  it('rolls back when the batch violates a check constraint', async () => {
    const before = storedMachineIds(scheduleId)

    // ends_at must be after starts_at. The bad row is second, so the first
    // row's insert has already run when the failure occurs.
    await expect(
      scheduleEntriesRepository.replaceAll(scheduleId, {
        entries: [
          entry({ machine_id: machineId, starts_at: T0, ends_at: T1 }),
          entry({ machine_id: secondMachineId, starts_at: T2, ends_at: T2 }),
        ],
      }),
    ).rejects.toThrow()

    expect(entryCount(scheduleId)).toBe(2)
    expect(storedMachineIds(scheduleId)).toEqual(before)
  })

  it('rolls back a negative power_kw, which the table rejects', async () => {
    const before = storedMachineIds(scheduleId)

    await expect(
      scheduleEntriesRepository.replaceAll(scheduleId, {
        entries: [
          entry({ machine_id: machineId, starts_at: T0, ends_at: T1 }),
          entry({ machine_id: secondMachineId, starts_at: T2, ends_at: T3, power_kw: -5 }),
        ],
      }),
    ).rejects.toThrow()

    expect(entryCount(scheduleId)).toBe(2)
    expect(storedMachineIds(scheduleId)).toEqual(before)
  })

  it('leaves the schedule row untouched when the entries fail', async () => {
    const before = readSchedule(scheduleId)

    await expect(
      scheduleEntriesRepository.replaceAll(scheduleId, {
        entries: [entry({ machine_id: MISSING_UUID })],
      }),
    ).rejects.toThrow()

    const after = readSchedule(scheduleId)
    // The status/totals/metadata update must not have committed either. If the
    // entries and the schedule row were two separate operations, a totals
    // update would survive a failed entry write.
    expect(after.status).toBe(before.status)
    expect(after.total_energy_kwh).toBe(before.total_energy_kwh)
    expect(after.total_energy_cost).toBe(before.total_energy_cost)
    expect(after.metadata).toBe(before.metadata)
  })

  it('does not leave a partially written batch behind', async () => {
    // Five entries, the third bad. Nothing at all should be committed.
    await expect(
      scheduleEntriesRepository.replaceAll(scheduleId, {
        entries: [
          entry({ machine_id: machineId, starts_at: T0, ends_at: T1, sequence: 1 }),
          entry({ machine_id: secondMachineId, starts_at: T1, ends_at: T2, sequence: 2 }),
          entry({ machine_id: MISSING_UUID, starts_at: T2, ends_at: T3, sequence: 3 }),
          entry({ machine_id: machineId, starts_at: T2, ends_at: T3, sequence: 4 }),
        ],
      }),
    ).rejects.toThrow()

    expect(entryCount(scheduleId)).toBe(2)
  })

  it('rejects the whole call when the schedule does not exist, writing nothing', async () => {
    const result = replaceScheduleEntries(db, MISSING_UUID, [entry()], {})

    expect(result.error?.code).toBe('P0002')
    expect(result.data).toBeNull()
  })
})

/* -------------------------------------------------------------------------- */
/* Commit: the successful path writes all three parts together                */
/* -------------------------------------------------------------------------- */

describe('a successful replacement commits entries, totals and status together', () => {
  it('replaces the entries and returns exactly what was stored', async () => {
    const scheduleId = await newSchedule('commit-entries')

    const rows = await scheduleEntriesRepository.replaceAll(scheduleId, {
      entries: [
        entry({ machine_id: machineId, starts_at: T0, ends_at: T1, power_kw: 150, energy_kwh: 150, cost: 20 }),
        entry({ machine_id: secondMachineId, starts_at: T2, ends_at: T3, power_kw: 50, energy_kwh: 50, cost: 5 }),
      ],
    })

    expect(rows).toHaveLength(2)
    // Returned rows are the stored rows: real generated ids, not the input.
    for (const row of rows) {
      expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/)
      expect(row.schedule_id).toBe(scheduleId)
    }
    expect(storedMachineIds(scheduleId)).toEqual([machineId, secondMachineId])
  })

  it('stores the recomputed totals on the schedule row', async () => {
    const scheduleId = await newSchedule('commit-totals')

    const entries = [
      entry({ machine_id: machineId, starts_at: T0, ends_at: T1, power_kw: 150, energy_kwh: 150, cost: 20 }),
      entry({ machine_id: secondMachineId, starts_at: T2, ends_at: T3, power_kw: 50, energy_kwh: 50, cost: 5 }),
    ]

    await scheduleEntriesRepository.replaceAll(scheduleId, { entries }, computeTotals(entries))

    const stored = readSchedule(scheduleId)
    // 150 + 50 = 200 kWh, 20 + 5 = 25 cost. The two entries do not overlap, so
    // the peak is the larger single draw rather than the sum.
    expect(stored.total_energy_kwh).toBeCloseTo(200, 5)
    expect(stored.total_energy_cost).toBeCloseTo(25, 5)
    expect(stored.peak_demand_kw).toBeCloseTo(150, 5)
  })

  it('updates the status in the same transaction as the entries', async () => {
    const scheduleId = await newSchedule('commit-status')

    await scheduleEntriesRepository.replaceAll(scheduleId, { entries: [entry()] }, { status: 'published' })

    expect(readSchedule(scheduleId).status).toBe('published')
  })

  it('merges metadata rather than replacing it', async () => {
    const scheduleId = await newSchedule('commit-metadata')

    await schedulesRepository.update(factoryId, scheduleId, {
      metadata: { kept: 'yes', replaced: 'before' },
    })

    await scheduleEntriesRepository.replaceAll(
      scheduleId,
      { entries: [entry()] },
      { metadata: { replaced: 'after', added: 'new' } },
    )

    const metadata = JSON.parse(String(readSchedule(scheduleId).metadata)) as Record<string, unknown>
    // A key the patch did not mention must survive.
    expect(metadata.kept).toBe('yes')
    expect(metadata.replaced).toBe('after')
    expect(metadata.added).toBe('new')
  })

  it('leaves an omitted patch key alone instead of nulling it', async () => {
    const scheduleId = await newSchedule('commit-absent-patch')

    await scheduleEntriesRepository.replaceAll(
      scheduleId,
      { entries: [entry()] },
      { total_energy_kwh: 42, status: 'published' },
    )
    // A second replacement that patches only the status must not clear the
    // totals set by the first one.
    await scheduleEntriesRepository.replaceAll(scheduleId, { entries: [entry()] }, { status: 'active' })

    const stored = readSchedule(scheduleId)
    expect(stored.status).toBe('active')
    expect(stored.total_energy_kwh).toBeCloseTo(42, 5)
  })

  it('replaces with a genuinely empty set when asked to', async () => {
    const scheduleId = await newSchedule('commit-empty')

    await scheduleEntriesRepository.replaceAll(scheduleId, { entries: [entry()] })
    expect(entryCount(scheduleId)).toBe(1)

    const rows = await replaceScheduleEntries(db, scheduleId, [], {})
    expect(rows.count).toBe(0)
    expect(entryCount(scheduleId)).toBe(0)
  })
})

/* -------------------------------------------------------------------------- */
/* Atomic append                                                              */
/* -------------------------------------------------------------------------- */

describe('a failed batch append commits nothing', () => {
  it('keeps the existing entries when the batch fails', async () => {
    const scheduleId = await newSchedule('append-rollback')

    await scheduleEntriesRepository.replaceAll(scheduleId, { entries: [entry({ machine_id: machineId })] })
    const before = storedMachineIds(scheduleId)

    await expect(
      scheduleEntriesRepository.appendMany(scheduleId, {
        entries: [
          entry({ machine_id: secondMachineId, starts_at: T1, ends_at: T2 }),
          entry({ machine_id: MISSING_UUID, starts_at: T2, ends_at: T3 }),
        ],
      }),
    ).rejects.toThrow()

    // The appending implementation inserted row by row, so the first of these
    // two would have been committed when the second failed.
    expect(entryCount(scheduleId)).toBe(1)
    expect(storedMachineIds(scheduleId)).toEqual(before)
  })

  it('appends without deleting, and returns only the new rows', async () => {
    const scheduleId = await newSchedule('append-success')

    await scheduleEntriesRepository.replaceAll(scheduleId, { entries: [entry({ machine_id: machineId })] })

    const appended = await scheduleEntriesRepository.appendMany(scheduleId, {
      entries: [entry({ machine_id: secondMachineId, starts_at: T2, ends_at: T3, sequence: 2 })],
    })

    expect(appended).toHaveLength(1)
    expect(entryCount(scheduleId)).toBe(2)
    expect(storedMachineIds(scheduleId)).toEqual([machineId, secondMachineId])
  })

  it('returns exactly the rows it inserted, not rows an earlier append committed', async () => {
    const scheduleId = await newSchedule('append-scope')

    await scheduleEntriesRepository.appendMany(scheduleId, {
      entries: [entry({ machine_id: machineId, starts_at: T0, ends_at: T1 })],
    })
    const second = await scheduleEntriesRepository.appendMany(scheduleId, {
      entries: [entry({ machine_id: secondMachineId, starts_at: T2, ends_at: T3 })],
    })

    // Filtering by created_at or min(created_at) would return both rows here,
    // because two appends can land in the same clock tick.
    expect(second).toHaveLength(1)
    expect(second[0]?.machine_id).toBe(secondMachineId)
  })
})

/* -------------------------------------------------------------------------- */
/* The rpc seam                                                               */
/* -------------------------------------------------------------------------- */

describe('the rpc surface', () => {
  it('dispatches both function names', async () => {
    const scheduleId = await newSchedule('rpc-dispatch')

    const replaced = offlineRpc('replace_schedule_entries', { p_schedule_id: scheduleId, p_entries: [entry()] }, db)
    expect(replaced.error).toBeNull()
    expect(replaced.count).toBe(1)

    const appended = offlineRpc('append_schedule_entries', { p_schedule_id: scheduleId, p_entries: [entry()] }, db)
    expect(appended.error).toBeNull()
    expect(entryCount(scheduleId)).toBe(2)
  })

  it('fails loudly on an unknown function name rather than silently succeeding', () => {
    const result = offlineRpc('replace_schedule_entryz', {}, db)

    expect(result.error?.code).toBe('PGRST202')
    expect(result.data).toBeNull()
  })

  it('maps a failed entry write onto the same Postgres-shaped codes as PostgREST', async () => {
    const scheduleId = await newSchedule('rpc-error-codes')

    const failed = replaceScheduleEntries(db, scheduleId, [entry({ machine_id: MISSING_UUID })], {})

    expect(failed.error?.code).toBe('23503')

    // The identical error must surface as the identical HTTP status on both
    // backends, which is what mapDatabaseError is keyed on. 23503 maps to
    // ValidationError, which this project returns as 400.
    const mapped = mapDatabaseError(failed.error as never, 'replace schedule entries')
    expect(mapped.status).toBe(400)
  })

  it('reports an unknown table the same way the adapter does', async () => {
    const { client: repoClient } = await import('@/lib/repositories/base')
    const result = await repoClient().from('not_a_table').select('*')

    expect(result.error?.code).toBe('42P01')
  })
})

/* -------------------------------------------------------------------------- */
/* The SQL migration                                                          */
/* -------------------------------------------------------------------------- */

describe('migration 0003 — transactional schedule replace', () => {
  const sql = readFileSync(
    join('supabase', 'migrations', '0003_transactional_schedule_replace.sql'),
    'utf8',
  )

  it('defines both functions', () => {
    expect(sql).toContain('create or replace function public.replace_schedule_entries(')
    expect(sql).toContain('create or replace function public.append_schedule_entries(')
  })

  it('locks the schedule row, which is what serialises concurrent replacements', () => {
    // Without FOR UPDATE two callers could interleave their delete and insert
    // and produce a schedule holding neither caller's entries.
    expect(sql).toMatch(/for update;/)
    expect(sql).toMatch(/select s\.id into v_locked_id/)
  })

  it('deletes and inserts inside the function body, not from the client', () => {
    expect(sql).toContain('delete from public.schedule_entries se')
    expect(sql).toContain('insert into public.schedule_entries (')
  })

  it('updates the schedule state and metadata in the same transaction', () => {
    expect(sql).toContain('update public.schedules s')
    expect(sql).toContain("when p_patch ? 'status' then")
    expect(sql).toContain("metadata = s.metadata || coalesce(p_patch->'metadata'")
  })

  it('does not create or alter any table', () => {
    // The schema must stay as 0001 left it; 0003 adds functions only.
    expect(sql).not.toMatch(/create\s+table/i)
    expect(sql).not.toMatch(/alter\s+table/i)
    expect(sql).not.toMatch(/drop\s+table/i)
  })

  it('is security invoker so RLS still governs it', () => {
    // SECURITY DEFINER would let `authenticated` write with the owner's rights,
    // bypassing the factory authorization the API enforces.
    expect(sql).toContain('security invoker')
    expect(sql).not.toContain('security definer')
  })

  it('pins search_path', () => {
    expect(sql).toMatch(/set search_path = public, pg_temp/)
  })

  it('grants execute to service_role only, revoking the PUBLIC default first', () => {
    // PostgREST grants EXECUTE to PUBLIC on new functions by default. Leaving
    // that in place would let `authenticated` call this directly over PostgREST
    // and bypass lib/auth entirely.
    expect(sql).toContain('revoke execute on function public.replace_schedule_entries(uuid, jsonb, jsonb) from public;')
    expect(sql).toContain('revoke execute on function public.append_schedule_entries(uuid, jsonb, jsonb) from public;')
    expect(sql).toContain('revoke execute on function public.replace_schedule_entries(uuid, jsonb, jsonb) from authenticated;')
    expect(sql).toContain('revoke execute on function public.append_schedule_entries(uuid, jsonb, jsonb) from authenticated;')
    expect(sql).toContain('grant execute on function public.replace_schedule_entries(uuid, jsonb, jsonb) to service_role;')
    expect(sql).toContain('grant execute on function public.append_schedule_entries(uuid, jsonb, jsonb) to service_role;')
  })

  it('grants nothing to anon', () => {
    expect(sql).not.toMatch(/grant[^\n;]*\bto anon\b/i)
  })

  it('tells PostgREST to reload its schema cache', () => {
    // Without this the new functions appear to be missing (PGRST202).
    expect(sql).toContain("notify pgrst, 'reload schema'")
  })

  it('mentions no factory-specific domain terms', () => {
    const lowered = sql.toLowerCase()
    for (const term of ['chocolate', 'cocoa', 'conche', 'tempering', 'mould', 'cacao']) {
      expect(lowered).not.toContain(term)
    }
  })
})

/* -------------------------------------------------------------------------- */
/* The request schema                                                         */
/* -------------------------------------------------------------------------- */

describe('the entries bulk schema', () => {
  it('still accepts a body with only entries', () => {
    // Backwards compatibility: existing callers must not have to change.
    const parsed = scheduleEntryBulkSchema.parse({ entries: [entry()] })
    expect(parsed.entries).toHaveLength(1)
    expect(parsed.schedule).toBeUndefined()
  })

  describe('optimizer result schedule persistence', () => {
    async function createSuccessfulResult() {
      const createdRequest = await optimizationRequestsRepository.create(factoryId, {
        reference: `phase3-${crypto.randomUUID()}`,
        horizon_start: T0,
        horizon_end: T3,
        objective: {},
        constraints: {},
        status: 'running',
        created_by: null,
        error_message: null,
        adapter_metadata: { adapter: 'test' },
        request_payload: { canonical: true },
      })
      const request = await optimizationRequestsRepository.update(factoryId, createdRequest.id, {
        status: 'running',
      })
      const raw = { api_version: '2.0', status: 'OPTIMAL', result: { preserved: true } }
      const result = await optimizationResultsRepository.create(factoryId, {
        optimization_request_id: request.id,
        status: 'succeeded',
        solution: raw,
        metrics: { optimizer_status: 'OPTIMAL' },
      })
      return { request, result, raw }
    }

    function scheduleSpec(kind: 'baseline' | 'optimized', machine = machineId) {
      return {
        kind,
        horizon_start: T0,
        horizon_end: T3,
        total_energy_cost: 10,
        total_energy_kwh: 100,
        peak_demand_kw: 100,
        entries: [{
          machine_id: machine,
          process_id: processId,
          production_order_id: null,
          starts_at: T0,
          ends_at: T1,
          power_kw: 100,
          energy_kwh: 100,
          cost: 10,
          quantity: 20,
          sequence: 0,
          metadata: { planned: true },
        }],
      }
    }

    it('creates linked baseline and optimized draft schedules and entries with canonical IDs', async () => {
      const { request, result } = await createSuccessfulResult()
      const persisted = await persistOptimizationSchedules(
        factoryId,
        request.id,
        result.id,
        'test-adapter',
        [scheduleSpec('baseline'), scheduleSpec('optimized')],
      )

      expect(persisted.request.status).toBe('succeeded')
      expect(persisted.request.adapter_metadata).toMatchObject({
        optimization_result_id: result.id,
        schedule_persistence_status: 'succeeded',
      })
      expect(persisted.schedules).toHaveLength(2)
      expect(persisted.schedules.map(({ schedule }) => schedule.metadata.kind)).toEqual(['baseline', 'optimized'])
      for (const { schedule, entries, computed_totals } of persisted.schedules) {
        expect(schedule.status).toBe('draft')
        expect(schedule.factory_id).toBe(factoryId)
        expect(schedule.optimization_request_id).toBe(request.id)
        expect(schedule.optimization_result_id).toBe(result.id)
        expect(entries).toHaveLength(1)
        expect(entries[0]).toMatchObject({
          machine_id: machineId,
          process_id: processId,
          production_order_id: null,
          schedule_id: schedule.id,
        })
        expect(computed_totals).toMatchObject({
          total_energy_kwh: 100,
          total_energy_cost: 10,
          peak_demand_kw: 100,
          duration_minutes: 60,
        })
      }
      expect(new Set(persisted.schedules.map(({ schedule }) => schedule.id)).size).toBe(2)
    })

    it('rolls back every schedule and entry if a later schedule entry violates a foreign key', async () => {
      const { request, result, raw } = await createSuccessfulResult()

      await expect(persistOptimizationSchedules(
        factoryId,
        request.id,
        result.id,
        'test-adapter',
        [scheduleSpec('baseline'), scheduleSpec('optimized', MISSING_UUID)],
      )).rejects.toThrow()

      const schedules = await schedulesRepository.list(factoryId, { limit: 100, offset: 0 })
      expect(schedules.rows.filter((schedule) => schedule.optimization_request_id === request.id)).toEqual([])
      const storedRequest = await optimizationRequestsRepository.getById(factoryId, request.id)
      expect(storedRequest?.status).toBe('running')
      const storedResult = await optimizationResultsRepository.getById(factoryId, result.id)
      expect(storedResult?.solution).toEqual(raw)
      expect(db.prepare(`
        SELECT COUNT(*) AS c
          FROM schedule_entries
         WHERE schedule_id IN (
           SELECT id FROM schedules WHERE optimization_request_id = ?
         )
      `).get(request.id)).toMatchObject({ c: 0 })
    })

    it('allocates later versions without replacing earlier schedules', async () => {
      const first = await createSuccessfulResult()
      const firstPersisted = await persistOptimizationSchedules(
        factoryId,
        first.request.id,
        first.result.id,
        'test-adapter',
        [scheduleSpec('optimized')],
      )
      const second = await createSuccessfulResult()
      const secondPersisted = await persistOptimizationSchedules(
        factoryId,
        second.request.id,
        second.result.id,
        'test-adapter',
        [scheduleSpec('optimized')],
      )

      const firstVersion = firstPersisted.schedules[0]?.schedule.version ?? 0
      expect(firstVersion).toBeGreaterThan(0)
      expect(secondPersisted.schedules[0]?.schedule.version).toBe(firstVersion + 1)
      expect(await scheduleEntriesRepository.count(firstPersisted.schedules[0]!.schedule.id)).toBe(1)
      expect(await scheduleEntriesRepository.count(secondPersisted.schedules[0]!.schedule.id)).toBe(1)
    })
  })

  it('accepts an optional schedule patch', () => {
    const parsed = scheduleEntryBulkSchema.parse({
      entries: [entry()],
      schedule: { status: 'published', total_energy_kwh: 100 },
    })
    expect(parsed.schedule?.status).toBe('published')
  })

  it('rejects an unknown key inside the patch', () => {
    expect(() =>
      scheduleEntryBulkSchema.parse({ entries: [entry()], schedule: { nope: true } }),
    ).toThrow()
  })

  it('rejects an unknown key at the top level, as before', () => {
    expect(() => scheduleEntryBulkSchema.parse({ entries: [entry()], surprise: 1 })).toThrow()
  })

  it('will not let a patch change the schedule id being written', () => {
    // `schedule_id` is supplied by the function, not the payload.
    expect(() =>
      scheduleEntryBulkSchema.parse({ entries: [{ ...entry(), schedule_id: MISSING_UUID }] }),
    ).toThrow()
  })
})
