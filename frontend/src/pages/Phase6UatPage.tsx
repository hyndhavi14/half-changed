import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../data/supabase'
import {
  compareScheduleImpact,
  projectPersistedImpactEntries,
  type DemandShiftComparison,
  type ImpactProcess,
  type SolarReading,
} from './phase6EnergyImpact'
import {
  authGateFailureState,
  canRunOptimization,
  identifyPersistedSchedulePair,
} from './phase6UatValidation'

const FACTORY_ID = 'f02b6ad2-d787-411e-812e-4c1f3dbc5cf2'
const OTHER_FACTORY_ID = '00000000-0000-4000-8000-000000000000'
const RUN_MARKER = `byteme-phase6-optimization-attempt:${FACTORY_ID}`
const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '')
const API_ROOT = API_BASE
  ? API_BASE.endsWith('/api/v1') ? API_BASE : `${API_BASE}/api/v1`
  : '/api/v1'
const PAGE_SIZE = 200

type JsonRecord = Record<string, unknown>
type Snapshot = {
  factory: JsonRecord
  summary: JsonRecord
  machines: JsonRecord[]
  processes: JsonRecord[]
  dependencies: JsonRecord[]
  orders: JsonRecord[]
  energy: JsonRecord[]
  tariffs: JsonRecord[]
  requests: JsonRecord[]
  results: JsonRecord[]
  schedules: JsonRecord[]
  scheduleDetails: JsonRecord[]
}
type UatOutcome = {
  requestId: string
  resultId: string
  baselineScheduleId: string
  scheduleId: string
  entryIds: string[]
  optimizerStatus: string
  scheduleStatus: string
  checks: string[]
  energyImpact: DemandShiftComparison
  currency: string
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function fixed(value: number): string {
  return value.toFixed(2)
}

function signed(value: number): string {
  return `${value > 0 ? '+' : ''}${fixed(value)}`
}

function envelopeData(value: unknown): unknown {
  if (!isRecord(value) || !('data' in value)) {
    throw new Error('Backend response is missing its data envelope.')
  }
  return value.data
}

function apiMessage(value: unknown): string | null {
  if (!isRecord(value) || !isRecord(value.error) || typeof value.error.message !== 'string') {
    return null
  }
  return value.error.message
}

async function request(
  path: string,
  token?: string,
  init: RequestInit = {},
): Promise<{ status: number; payload: unknown }> {
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (init.body) headers.set('Content-Type', 'application/json')
  const response = await fetch(`${API_ROOT}${path}`, { ...init, headers })
  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new Error('The ByteMe API returned invalid JSON.')
  }
  return { status: response.status, payload }
}

async function requireOk(path: string, token: string, init?: RequestInit): Promise<unknown> {
  const response = await request(path, token, init)
  if (response.status < 200 || response.status >= 300) {
    throw new Error(apiMessage(response.payload) ?? `Backend returned HTTP ${response.status}.`)
  }
  return response.payload
}

async function readRows(path: string, token: string): Promise<JsonRecord[]> {
  const rows: JsonRecord[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const payload = await requireOk(
      `${path}${path.includes('?') ? '&' : '?'}limit=${PAGE_SIZE}&offset=${offset}`,
      token,
    )
    if (!isRecord(payload) || !('data' in payload)) {
      throw new Error('Backend list response has an invalid envelope.')
    }
    const data = payload.data
    const page = Array.isArray(data)
      ? data
      : isRecord(data) && Array.isArray(data.intervals)
        ? data.intervals
        : null
    if (!page || !page.every(isRecord)) {
      throw new Error('Backend list response has an invalid row collection.')
    }
    rows.push(...page)
    const total =
      isRecord(payload.meta) &&
      typeof payload.meta.total === 'number' &&
      Number.isSafeInteger(payload.meta.total) &&
      payload.meta.total >= 0
        ? payload.meta.total
        : null
    if (total !== null ? rows.length >= total : page.length < PAGE_SIZE) return rows
    if (page.length === 0) throw new Error('Backend pagination did not make progress.')
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (!isRecord(value)) return JSON.stringify(value)
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
}

function assertUuid(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error(`Invalid canonical UUID in ${label}.`)
  }
}

async function takeSnapshot(token: string): Promise<Snapshot> {
  const prefix = `/factories/${FACTORY_ID}`
  const [
    factoryPayload,
    summaryPayload,
    machines,
    processes,
    dependencies,
    orders,
    energy,
    tariffs,
    requests,
    results,
    schedules,
  ] = await Promise.all([
    requireOk(prefix, token),
    requireOk(`${prefix}/summary`, token),
    readRows(`${prefix}/machines`, token),
    readRows(`${prefix}/processes`, token),
    readRows(`${prefix}/process-dependencies`, token),
    readRows(`${prefix}/production-orders`, token),
    readRows(`${prefix}/energy-data`, token),
    readRows(`${prefix}/tariffs`, token),
    readRows(`${prefix}/optimization-requests`, token),
    readRows(`${prefix}/optimization-results`, token),
    readRows(`${prefix}/schedules`, token),
  ])
  const scheduleDetails = await Promise.all(
    schedules.map(async (schedule) => {
      assertUuid(schedule.id, 'schedule.id')
      return envelopeData(await requireOk(
        `${prefix}/schedules/${encodeURIComponent(schedule.id)}`,
        token,
      )) as JsonRecord
    }),
  )
  const factory = envelopeData(factoryPayload)
  const summary = envelopeData(summaryPayload)
  if (!isRecord(factory) || factory.id !== FACTORY_ID) {
    throw new Error('Backend factory does not match the canonical Chocolate UUID.')
  }
  if (!isRecord(summary)) throw new Error('Backend factory summary is invalid.')
  return {
    factory,
    summary,
    machines,
    processes,
    dependencies,
    orders,
    energy,
    tariffs,
    requests,
    results,
    schedules,
    scheduleDetails,
  }
}

function verifySnapshot(snapshot: Snapshot): void {
  if (!isRecord(snapshot.summary.optimizer) || snapshot.summary.optimizer.configured !== true) {
    throw new Error('Backend reports the real optimizer is not configured; stopping before optimization.')
  }
  const durations = new Set<number>()
  const machineIds = new Set(snapshot.machines.map((row) => row.id))
  for (const row of snapshot.machines) {
    assertUuid(row.id, 'machine.id')
    if (row.factory_id !== FACTORY_ID) throw new Error('Machine belongs to a different factory.')
  }
  for (const row of snapshot.processes) {
    assertUuid(row.id, 'process.id')
    assertUuid(row.machine_id, 'process.machine_id')
    if (row.factory_id !== FACTORY_ID || !machineIds.has(row.machine_id)) {
      throw new Error('Process or its machine does not belong to the canonical factory.')
    }
    if (typeof row.duration_minutes === 'number') {
      if (!Number.isSafeInteger(row.duration_minutes)) {
        throw new Error('Canonical process duration is not an exact whole number of minutes.')
      }
      durations.add(row.duration_minutes)
    }
  }
  for (const expected of [25, 35, 40, 45]) {
    if (!durations.has(expected)) {
      throw new Error(`Canonical process duration ${expected} minutes was not found; stopping before optimization.`)
    }
  }
  for (const row of [...snapshot.dependencies, ...snapshot.orders, ...snapshot.energy, ...snapshot.tariffs]) {
    assertUuid(row.id, 'canonical row id')
    if (row.factory_id !== FACTORY_ID) throw new Error('Canonical row belongs to a different factory.')
  }
  const offPeak = snapshot.tariffs.find((row) => row.slug === 'off-peak')
  const shoulder = snapshot.tariffs.find((row) => row.slug === 'shoulder')
  const time = (value: unknown) => typeof value === 'string' ? value.slice(0, 5) : ''
  if (
    !offPeak || time(offPeak.start_time) !== '22:00' || time(offPeak.end_time) !== '07:00' ||
    !shoulder || time(shoulder.start_time) !== '07:00' || time(shoulder.end_time) !== '22:00'
  ) {
    throw new Error('Canonical approved off-peak/shoulder tariff windows do not match; stopping before optimization.')
  }
}

function verifyDependency(
  dependency: JsonRecord,
  entriesByProcess: Map<string, JsonRecord[]>,
): boolean {
  const processEntries = entriesByProcess.get(String(dependency.process_id)) ?? []
  const predecessorEntries = entriesByProcess.get(String(dependency.depends_on_process_id)) ?? []
  if (!processEntries.length || !predecessorEntries.length) return false
  const lagMs = Number(dependency.lag_minutes) * 60_000
  const type = dependency.dependency_type
  return processEntries.every((current) => predecessorEntries.some((previous) => {
    const currentStart = Date.parse(String(current.starts_at))
    const currentEnd = Date.parse(String(current.ends_at))
    const previousStart = Date.parse(String(previous.starts_at))
    const previousEnd = Date.parse(String(previous.ends_at))
    if (type === 'finish_to_start') return currentStart >= previousEnd + lagMs
    if (type === 'start_to_start') return currentStart >= previousStart + lagMs
    if (type === 'finish_to_finish') return currentEnd >= previousEnd + lagMs
    if (type === 'start_to_finish') return currentEnd >= previousStart + lagMs
    return false
  }))
}

const styles = {
  page: { minHeight: '100vh', padding: 24, background: '#f7f2e9', color: '#2a1b12', fontFamily: 'Segoe UI, sans-serif' },
  card: { maxWidth: 1100, margin: '0 auto', padding: 24, borderRadius: 14, background: '#fffdf8', boxShadow: '0 4px 20px #563b201c' },
  button: { minHeight: 42, padding: '8px 16px', border: 0, borderRadius: 8, background: '#5c351f', color: '#fff', fontWeight: 700, cursor: 'pointer' },
  input: { display: 'block', width: '100%', minHeight: 40, margin: '6px 0 14px', padding: '8px 10px', boxSizing: 'border-box' as const },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 12 },
  error: { color: '#9b2e1d', whiteSpace: 'pre-wrap' as const },
  code: { overflowWrap: 'anywhere' as const, fontFamily: 'Consolas, monospace', fontSize: 13 },
}

export default function Phase6UatPage() {
  const [session, setSession] = useState<Session | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [authPassed, setAuthPassed] = useState(false)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [outcome, setOutcome] = useState<UatOutcome | null>(null)
  const [events, setEvents] = useState<string[]>([])
  const optimizeStarted = useRef(false)
  const [optimizationAttempted, setOptimizationAttempted] = useState(
    () => window.sessionStorage.getItem(RUN_MARKER) === 'submitted',
  )

  useEffect(() => {
    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (sessionError) setError('Supabase session could not be restored.')
      setSession(data.session)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      if (!nextSession) {
        resetDemoState()
      }
    })
    return () => data.subscription.unsubscribe()
  }, [])

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password })
      if (signInError || !data.session) throw new Error(signInError?.message ?? 'Sign-in did not return a session.')
      setPassword('')
      setSession(data.session)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Sign-in failed.')
    } finally {
      setBusy(false)
    }
  }

  async function signOut() {
    setBusy(true)
    setError(null)
    try {
      const { error: signOutError } = await supabase.auth.signOut()
      if (signOutError) throw signOutError
      setSession(null)
      resetDemoState()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Sign-out failed.')
    } finally {
      setBusy(false)
    }
  }

  async function verifyAuth() {
    if (!session) return
    setBusy(true)
    setError(null)
    const checks: string[] = []
    try {
      const appMetadata = session.user.app_metadata
      const factoryIds = appMetadata.factory_ids
      if (appMetadata.provider !== 'email' ||
        !Array.isArray(appMetadata.providers) ||
        appMetadata.providers.length !== 1 ||
        appMetadata.providers[0] !== 'email' ||
        !Array.isArray(factoryIds) ||
        factoryIds.length !== 1 ||
        factoryIds[0] !== FACTORY_ID ||
        Object.prototype.hasOwnProperty.call(appMetadata, 'byteme_admin')) {
        throw new Error('Signed-in user claims do not match the approved least-privilege grant.')
      }
      checks.push('Signed-in user has email provider and exactly the approved factory grant; no admin claim.')

      const factoriesResponse = await request('/factories', session.access_token)
      if (factoriesResponse.status !== 200) throw new Error(`Authenticated Backend access returned HTTP ${factoriesResponse.status}.`)
      const factoryRows = envelopeData(factoriesResponse.payload)
      if (!Array.isArray(factoryRows) || !factoryRows.some((row) => isRecord(row) && row.id === FACTORY_ID)) {
        throw new Error('The canonical factory is not accessible to this user.')
      }
      checks.push('Authenticated Backend accepts the user token and returns the canonical factory.')

      const noToken = await request('/factories')
      const invalidToken = await request('/factories', 'invalid-phase6-token')
      if (noToken.status !== 401 || invalidToken.status !== 401) {
        throw new Error('Backend did not reject the missing/invalid-token checks with HTTP 401.')
      }
      checks.push('Backend rejects missing and invalid tokens (HTTP 401).')

      const wrongFactory = await request(`/factories/${OTHER_FACTORY_ID}`, session.access_token)
      if (wrongFactory.status !== 404) throw new Error(`Wrong-factory access returned HTTP ${wrongFactory.status}, expected 404.`)
      checks.push('Backend rejects mismatched factory access (HTTP 404).')

      const badUuid = await request(`/factories/${FACTORY_ID}/machines/not-a-uuid`, session.access_token)
      if (badUuid.status !== 400) throw new Error(`Invalid UUID probe returned HTTP ${badUuid.status}, expected 400.`)
      checks.push('Backend rejects invalid UUID input (HTTP 400).')

      if (window.location.href.includes(session.access_token)) {
        throw new Error('A session token was found in the current URL.')
      }
      checks.push('No access token appears in the page URL.')
      setEvents(checks)
      setAuthPassed(true)
    } catch (failure) {
      const cleared = authGateFailureState(optimizationAttempted)
      setAuthPassed(cleared.authPassed)
      setSnapshot(cleared.snapshot)
      setOutcome(cleared.outcome)
      setEvents(cleared.events)
      setOptimizationAttempted(cleared.optimizationAttempted)
      setError(failure instanceof Error ? failure.message : 'Auth gate failed.')
    } finally {
      setBusy(false)
    }
  }

  async function loadSnapshot() {
    if (!session || !authPassed) return
    setBusy(true)
    setError(null)
    try {
      const next = await takeSnapshot(session.access_token)
      verifySnapshot(next)
      setSnapshot(next)
      setEvents((current) => [...current, 'One read-only pre-run snapshot captured; canonical UUIDs and exact 25/35/40/45-minute process durations verified.'])
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Read-only snapshot failed.')
    } finally {
      setBusy(false)
    }
  }

  function resetDemoState() {
    const cleared = authGateFailureState(optimizationAttempted)
    setAuthPassed(cleared.authPassed)
    setSnapshot(cleared.snapshot)
    setOutcome(cleared.outcome)
    setEvents(cleared.events)
    setOptimizationAttempted(cleared.optimizationAttempted)
  }

  function scheduleValidationContext(
    requestId: string,
    resultId: string,
    request: JsonRecord,
  ) {
    if (!snapshot || typeof request.horizon_start !== 'string' || typeof request.horizon_end !== 'string') {
      throw new Error('Persisted optimization request is missing its canonical snapshot or absolute horizon.')
    }
    const processes = snapshot.processes.map((process) => {
      if (
        typeof process.id !== 'string' ||
        typeof process.machine_id !== 'string' ||
        typeof process.duration_minutes !== 'number'
      ) {
        throw new Error('Canonical process snapshot has an invalid identity or duration.')
      }
      return {
        id: process.id,
        machine_id: process.machine_id,
        duration_minutes: process.duration_minutes,
      }
    })
    return {
      factoryId: FACTORY_ID,
      requestId,
      resultId,
      horizonStart: request.horizon_start,
      horizonEnd: request.horizon_end,
      processes,
      machineIds: new Set(snapshot.machines.map((machine) => String(machine.id))),
      orderIds: new Set(snapshot.orders.map((order) => String(order.id))),
    }
  }
  async function verifyPersistedOptimization(
    requestId: string,
    returnedStatus?: string,
    returnedSchedules?: unknown,
  ) {
    if (!session || !snapshot) throw new Error('Authenticated session or canonical snapshot is not available.')
    const prefix = `/factories/${FACTORY_ID}`
    const requestReadback = envelopeData(await requireOk(
      `${prefix}/optimization-requests/${encodeURIComponent(requestId)}`,
      session.access_token,
    ))
    if (!isRecord(requestReadback) || !isRecord(requestReadback.result) ||
      !isRecord(requestReadback.request_payload) ||
      !Array.isArray(requestReadback.request_payload.processes)) {
      throw new Error('Persisted request, problem payload, or result read-back is incomplete.')
    }
    if (requestReadback.id !== requestId || requestReadback.factory_id !== FACTORY_ID ||
      requestReadback.status !== 'succeeded' ||
      requestReadback.request_payload.factoryId !== FACTORY_ID) {
      throw new Error('Persisted successful optimizer request identity or status is invalid.')
    }

    const payloadProcesses = requestReadback.request_payload.processes.filter(isRecord)
    const sourceProcesses = new Map(snapshot.processes.map((process) => [String(process.id), process]))
    if (payloadProcesses.length !== snapshot.processes.length ||
      payloadProcesses.some((process) => {
        const source = sourceProcesses.get(String(process.id))
        return !source ||
          process.machineId !== source.machine_id ||
          process.durationMinutes !== source.duration_minutes
      })) {
      throw new Error('Optimizer request payload changed canonical factory/process/machine UUIDs or exact durations.')
    }

    const resultReadback = requestReadback.result
    assertUuid(resultReadback.id, 'optimization result id')
    if (resultReadback.optimization_request_id !== requestId ||
      resultReadback.factory_id !== FACTORY_ID ||
      resultReadback.status !== 'succeeded' ||
      !isRecord(resultReadback.solution) ||
      !isRecord(resultReadback.solution.result) ||
      !isRecord(resultReadback.solution.result.optimized)) {
      throw new Error('Persisted successful raw optimizer result does not match the request.')
    }
    const optimizerStatus = resultReadback.solution.status
    if ((optimizerStatus !== 'OPTIMAL' && optimizerStatus !== 'FEASIBLE') ||
      resultReadback.solution.result.status !== optimizerStatus ||
      (returnedStatus !== undefined && optimizerStatus !== returnedStatus)) {
      throw new Error('Persisted optimizer status differs from the validated successful response.')
    }

    const scheduleRows = await readRows(`${prefix}/schedules`, session.access_token)
    const relatedScheduleRows = scheduleRows.filter((schedule) => schedule.optimization_request_id === requestId)
    const detailRows = await Promise.all(relatedScheduleRows.map(async (schedule) =>
      envelopeData(await requireOk(
        `${prefix}/schedules/${encodeURIComponent(String(schedule.id))}`,
        session.access_token,
      )),
    ))
    const persistedPairPayload = detailRows.map((detail) => {
      if (!isRecord(detail) || !Array.isArray(detail.entries)) {
        throw new Error('Persisted schedule detail read-back is incomplete.')
      }
      const { entries, ...schedule } = detail
      return { schedule, entries }
    })
    const context = scheduleValidationContext(requestId, String(resultReadback.id), requestReadback)
    const pair = identifyPersistedSchedulePair(persistedPairPayload, context)
    if (returnedSchedules !== undefined) {
      const returnedPair = identifyPersistedSchedulePair(returnedSchedules, context)
      if (returnedPair.baseline.schedule.id !== pair.baseline.schedule.id ||
        returnedPair.optimized.schedule.id !== pair.optimized.schedule.id) {
        throw new Error('Backend optimization response differs from persisted baseline/optimized schedule IDs.')
      }
    }

    const adapterMetadata = requestReadback.adapter_metadata
    if (!isRecord(adapterMetadata) ||
      adapterMetadata.optimization_result_id !== resultReadback.id ||
      adapterMetadata.schedule_persistence_status !== 'succeeded' ||
      !Array.isArray(adapterMetadata.schedule_ids) ||
      adapterMetadata.schedule_ids.length !== 2 ||
      !adapterMetadata.schedule_ids.includes(pair.baseline.schedule.id) ||
      !adapterMetadata.schedule_ids.includes(pair.optimized.schedule.id)) {
      throw new Error('Persisted request metadata does not link exactly the baseline/optimized schedule pair.')
    }

    const rawSolution = resultReadback.solution.result
    const rawScheduleProcesses = {
      baseline: isRecord(rawSolution.baseline) ? rawSolution.baseline.processes : undefined,
      optimized: isRecord(rawSolution.optimized) ? rawSolution.optimized.processes : undefined,
    }
    if (!Array.isArray(rawScheduleProcesses.baseline) || !Array.isArray(rawScheduleProcesses.optimized)) {
      throw new Error('Raw optimizer baseline and optimized energy/cost data are required for comparison.')
    }
    const impactEntries = {
      baseline: projectPersistedImpactEntries(
        pair.baseline.entries,
        rawScheduleProcesses.baseline,
        context.horizonStart,
      ),
      optimized: projectPersistedImpactEntries(
        pair.optimized.entries,
        rawScheduleProcesses.optimized,
        context.horizonStart,
      ),
    }

    const impactProcesses: ImpactProcess[] = snapshot.processes.map((process) => {
      if (typeof process.id !== 'string' ||
        typeof process.name !== 'string' ||
        typeof process.machine_id !== 'string' ||
        typeof process.duration_minutes !== 'number' ||
        typeof process.power_requirement_kw !== 'number') {
        throw new Error('Canonical process snapshot is missing power or exact-duration data for impact analysis.')
      }
      return {
        id: process.id,
        name: process.name,
        machineId: process.machine_id,
        durationMinutes: process.duration_minutes,
        powerKw: process.power_requirement_kw,
      }
    })
    const solarReadings: SolarReading[] = snapshot.energy.map((reading) => {
      if (typeof reading.recorded_at !== 'string' ||
        typeof reading.interval_minutes !== 'number' ||
        typeof reading.generation_kwh !== 'number' ||
        (reading.machine_id !== null && typeof reading.machine_id !== 'string')) {
        throw new Error('Canonical solar readings are incomplete for impact analysis.')
      }
      return {
        recordedAt: reading.recorded_at,
        intervalMinutes: reading.interval_minutes,
        generationKwh: reading.generation_kwh,
        machineId: reading.machine_id,
      }
    })
    const energyImpact = compareScheduleImpact({
      baselineEntries: impactEntries.baseline,
      optimizedEntries: impactEntries.optimized,
      processes: impactProcesses,
      solarReadings,
      horizonStart: context.horizonStart,
      horizonEnd: context.horizonEnd,
    })
    const currency = snapshot.tariffs[0]?.currency
    if (typeof currency !== 'string' || snapshot.tariffs.some((tariff) => tariff.currency !== currency)) {
      throw new Error('Canonical tariffs do not provide one consistent currency for modeled cost comparison.')
    }

    for (const [kind, schedule] of [
      ['baseline', pair.baseline],
      ['optimized', pair.optimized],
    ] as const) {
      const entriesByProcess = schedule.entries.reduce((map, entry) => {
        const id = String(entry.process_id)
        map.set(id, [...(map.get(id) ?? []), entry])
        return map
      }, new Map<string, JsonRecord[]>())
      if (!snapshot.dependencies.every((dependency) => verifyDependency(dependency, entriesByProcess))) {
        throw new Error(`Persisted ${kind} schedule violates a canonical process dependency.`)
      }
    }

    const [energyAfter, tariffsAfter] = await Promise.all([
      readRows(`${prefix}/energy-data`, session.access_token),
      readRows(`${prefix}/tariffs`, session.access_token),
    ])
    if (stableJson(energyAfter) !== stableJson(snapshot.energy) ||
      stableJson(tariffsAfter) !== stableJson(snapshot.tariffs)) {
      throw new Error('Raw source energy or tariff rows changed during optimization.')
    }

    const checks = [
      'Successful request, raw optimizer result, and both schedules read back through the authenticated Backend.',
      'Exactly one baseline and one optimized schedule are linked to the result; both remain draft and unpublished.',
      'Optimized schedule UUIDs, machine/process/order references, and exact-minute durations match canonical data.',
      'Optimizer-relative times map exactly to absolute UTC timestamps; both schedules satisfy all dependencies and machine non-overlap.',
      'Raw energy readings and tariff rows are unchanged after optimization.',
    ]
    setOutcome({
      requestId,
      resultId: String(resultReadback.id),
      baselineScheduleId: String(pair.baseline.schedule.id),
      scheduleId: String(pair.optimized.schedule.id),
      entryIds: pair.optimized.entries.map((entry) => String(entry.id)),
      optimizerStatus,
      scheduleStatus: String(pair.optimized.schedule.status),
      checks,
      energyImpact,
      currency,
    })
    setEvents((current) => [...current, ...checks])
  }

  async function resumePersistedOptimization() {
    if (!session || !snapshot) return
    setBusy(true)
    setError(null)
    try {
      const successfulRuns = snapshot.requests.filter((request) =>
        request.status === 'succeeded' &&
        isRecord(request.adapter_metadata) &&
        request.adapter_metadata.adapter === 'python-subprocess' &&
        request.adapter_metadata.schedule_persistence_status === 'succeeded',
      )
      if (successfulRuns.length !== 1 || typeof successfulRuns[0]?.id !== 'string') {
        throw new Error('Expected exactly one previously successful persisted Python optimization; no new request will be sent.')
      }
      await verifyPersistedOptimization(successfulRuns[0].id)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Persisted optimization verification failed.')
    } finally {
      setBusy(false)
    }
  }

  async function runExactlyOnce() {
    if (!session || !snapshot || !canRunOptimization({
      authPassed,
      hasSnapshot: Boolean(snapshot),
      optimizationAttempted,
      busy,
    }) || optimizeStarted.current) return
    try {
      window.sessionStorage.setItem(RUN_MARKER, 'submitted')
    } catch {
      setError('Could not persist the one-run safety marker; no optimization request was sent.')
      return
    }
    optimizeStarted.current = true
    setOptimizationAttempted(true)
    setBusy(true)
    setError(null)
    setEvents((current) => [...current, 'One authenticated optimization POST submitted; automatic retry is disabled.'])
    try {
      const prefix = `/factories/${FACTORY_ID}`
      const responsePayload = await requireOk(
        `${prefix}/optimization-requests`,
        session.access_token,
        { method: 'POST', body: JSON.stringify({ dry_run: false }) },
      )
      const responseData = envelopeData(responsePayload)
      if (!isRecord(responseData) || !isRecord(responseData.request) ||
        !isRecord(responseData.solution) || !Array.isArray(responseData.schedules)) {
        throw new Error('Optimization response did not contain a real request, solution, and schedules.')
      }
      const requestId = responseData.request.id
      assertUuid(requestId, 'optimization request id')
      const solution = responseData.solution
      const status = solution.status
      if (status !== 'OPTIMAL' && status !== 'FEASIBLE') {
        throw new Error('Optimizer did not return an accepted OPTIMAL or FEASIBLE status.')
      }
      await verifyPersistedOptimization(requestId, status, responseData.schedules)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Optimization UAT failed. No retry will be attempted.')
    } finally {
      setBusy(false)
    }
  }

  const factory3dUrl = outcome
    ? new URL(import.meta.env.VITE_FACTORY_3D_URL ?? 'http://localhost:5174', window.location.origin)
    : null
  if (factory3dUrl && outcome) {
    factory3dUrl.searchParams.set('factoryId', FACTORY_ID)
    factory3dUrl.searchParams.set('scheduleId', outcome.scheduleId)
  }

  return (
    <main style={styles.page}>
      <section style={styles.card}>
        <h1>SolarShift — Chocolate Factory Demo</h1>
        <p>Backend is the system of record for this synthetic, model-based demonstration; no fallback data is shown.</p>
        <p style={styles.code}>Canonical factory UUID: {FACTORY_ID}</p>
        {!session ? (
          <form onSubmit={(event) => void signIn(event)} style={{ maxWidth: 420 }}>
            <label htmlFor="phase6-email">Demo account email</label>
            <input id="phase6-email" style={styles.input} type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.currentTarget.value)} required />
            <label htmlFor="phase6-password">Password</label>
            <input id="phase6-password" style={styles.input} type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.currentTarget.value)} required />
            <button style={styles.button} type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in with Supabase Auth'}</button>
          </form>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
              <button style={styles.button} type="button" onClick={() => void signOut()} disabled={busy}>Sign out</button>
              <button style={styles.button} type="button" onClick={() => void verifyAuth()} disabled={busy}>Run Auth gate</button>
              <button style={styles.button} type="button" onClick={() => void loadSnapshot()} disabled={busy || !authPassed || (Boolean(snapshot) && !optimizationAttempted)}>{optimizationAttempted ? 'Refresh read-only snapshot' : 'Take read-only snapshot'}</button>
              {optimizationAttempted
                ? <button style={styles.button} type="button" onClick={() => void resumePersistedOptimization()} disabled={busy || !snapshot || Boolean(outcome)}>Verify persisted optimization (read-only)</button>
                : <button style={styles.button} type="button" onClick={() => void runExactlyOnce()} disabled={!canRunOptimization({
                  authPassed,
                  hasSnapshot: Boolean(snapshot),
                  optimizationAttempted,
                  busy,
                })}>Run one optimization</button>}
            </div>
            <p>Authenticated as the current Supabase user. Password and tokens are not displayed.</p>
            {authPassed && <p role="status">Auth gate passed.</p>}
            {snapshot && (
              <>
                <h2>Pre-run canonical snapshot</h2>
                <div style={styles.grid}>
                  {Object.entries({
                    machines: snapshot.machines.length,
                    processes: snapshot.processes.length,
                    dependencies: snapshot.dependencies.length,
                    orders: snapshot.orders.length,
                    raw_energy_readings: snapshot.energy.length,
                    tariffs: snapshot.tariffs.length,
                    prior_optimization_requests: snapshot.requests.length,
                    prior_optimization_results: snapshot.results.length,
                    prior_schedules: snapshot.schedules.length,
                  }).map(([name, count]) => <p key={name}><strong>{name}</strong>: {count}</p>)}
                </div>
                <h3>Process durations (canonical minutes)</h3>
                <p>{snapshot.processes.map((process) => `${String(process.name)}: ${String(process.duration_minutes)} min`).join(' · ')}</p>
                <h3>Approved tariff windows (canonical)</h3>
                <ul>{snapshot.tariffs.map((tariff) => <li key={String(tariff.id)}>{String(tariff.name)}: {String(tariff.start_time)}–{String(tariff.end_time)}; {String(tariff.energy_price_per_kwh)} {String(tariff.currency)}/kWh</li>)}</ul>
                <h3>Pre-run UUID inventory</h3>
                <pre style={{ whiteSpace: 'pre-wrap', ...styles.code }}>{JSON.stringify({
                  factory: snapshot.factory.id,
                  machines: snapshot.machines.map((row) => row.id),
                  processes: snapshot.processes.map((row) => ({ id: row.id, duration_minutes: row.duration_minutes })),
                  dependencies: snapshot.dependencies.map((row) => row.id),
                  production_orders: snapshot.orders.map((row) => row.id),
                  energy_readings: snapshot.energy.map((row) => row.id),
                  tariffs: snapshot.tariffs.map((row) => row.id),
                  optimization_requests: snapshot.requests.map((row) => row.id),
                  optimization_results: snapshot.results.map((row) => row.id),
                  schedules: snapshot.scheduleDetails.map((row) => ({
                    id: row.id,
                    entries: Array.isArray(row.entries) ? row.entries.filter(isRecord).map((entry) => entry.id) : [],
                  })),
                }, null, 2)}</pre>
              </>
            )}
            {outcome && (
              <>
                <h2>Persisted optimization result</h2>
                <p>Optimizer status: {outcome.optimizerStatus}; schedule status: {outcome.scheduleStatus}</p>
                <p style={styles.code}>Request: {outcome.requestId}<br />Result: {outcome.resultId}<br />Baseline schedule: {outcome.baselineScheduleId}<br />Optimized schedule: {outcome.scheduleId}<br />Entries: {outcome.entryIds.join(', ') || '(none)'}</p>
                <ul>{outcome.checks.map((check) => <li key={check}>{check}</li>)}</ul>
                <h3>Modeled demand-shift impact — synthetic demo data</h3>
                <p>
                  These estimates compare optimizer-reported per-process solar allocation, grid import and
                  tariff-weighted energy cost, plus scheduled process power and timing. They are not measured
                  factory demand, utility-bill savings, verified solar self-consumption or actual curtailment.
                  The cost model excludes demand charges, fixed charges and taxes; peak load is scheduled
                  process load, not metered site peak.
                </p>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead>
                      <tr>
                        <th scope="col">Metric</th>
                        <th scope="col">Baseline</th>
                        <th scope="col">Optimized</th>
                        <th scope="col">Optimized − baseline</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ['Canonical IDs, exact durations, machine non-overlap and dependencies', 'Pass', 'Pass', '—'],
                        ['Modeled process energy (kWh)', fixed(outcome.energyImpact.baseline.totalProcessEnergyKwh), fixed(outcome.energyImpact.optimized.totalProcessEnergyKwh), signed(outcome.energyImpact.processEnergyChangeKwh)],
                        ['Modeled solar allocated to processes (kWh)', fixed(outcome.energyImpact.baseline.modeledSolarAllocatedKwh), fixed(outcome.energyImpact.optimized.modeledSolarAllocatedKwh), signed(outcome.energyImpact.modeledSolarAllocationChangeKwh)],
                        ['Modeled grid import (kWh)', fixed(outcome.energyImpact.baseline.modeledGridImportKwh), fixed(outcome.energyImpact.optimized.modeledGridImportKwh), signed(outcome.energyImpact.optimized.modeledGridImportKwh - outcome.energyImpact.baseline.modeledGridImportKwh)],
                        [`Modeled TOU energy cost (${outcome.currency})`, fixed(outcome.energyImpact.baseline.modeledTouEnergyCost), fixed(outcome.energyImpact.optimized.modeledTouEnergyCost), `${signed(outcome.energyImpact.optimized.modeledTouEnergyCost - outcome.energyImpact.baseline.modeledTouEnergyCost)} ${outcome.currency} (${signed(-outcome.energyImpact.modeledTouCostReductionPercent)}%)`],
                        ['Synthetic solar-profile energy available (kWh)', fixed(outcome.energyImpact.baseline.solarProfileAvailableKwh), fixed(outcome.energyImpact.optimized.solarProfileAvailableKwh), fixed(outcome.energyImpact.optimized.solarProfileAvailableKwh - outcome.energyImpact.baseline.solarProfileAvailableKwh)],
                        ['Synthetic solar-profile allocation (%)', fixed(outcome.energyImpact.baseline.solarProfileAllocationPercent), fixed(outcome.energyImpact.optimized.solarProfileAllocationPercent), signed(outcome.energyImpact.optimized.solarProfileAllocationPercent - outcome.energyImpact.baseline.solarProfileAllocationPercent)],
                        ['Unallocated synthetic solar-profile energy (kWh; not curtailment)', fixed(outcome.energyImpact.baseline.unallocatedSolarProfileKwh), fixed(outcome.energyImpact.optimized.unallocatedSolarProfileKwh), signed(outcome.energyImpact.optimized.unallocatedSolarProfileKwh - outcome.energyImpact.baseline.unallocatedSolarProfileKwh)],
                        ['Peak scheduled process load (kW)', fixed(outcome.energyImpact.baseline.modeledPeakScheduledLoadKw), fixed(outcome.energyImpact.optimized.modeledPeakScheduledLoadKw), signed(outcome.energyImpact.optimized.modeledPeakScheduledLoadKw - outcome.energyImpact.baseline.modeledPeakScheduledLoadKw)],
                        ['Completion elapsed from horizon start (hours)', fixed(outcome.energyImpact.baseline.completionHoursFromHorizonStart), fixed(outcome.energyImpact.optimized.completionHoursFromHorizonStart), signed(outcome.energyImpact.completionTimeChangeHours)],
                      ].map(([metric, baseline, optimized, change]) => (
                        <tr key={metric}>
                          <th scope="row">{metric}</th>
                          <td>{baseline}</td>
                          <td>{optimized}</td>
                          <td>{change}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p>
                  “Synthetic solar-profile allocation” is modeled process allocation divided by the solar
                  profile supplied to this optimization; it does not establish physical site consumption.
                  A negative grid-import or cost change means the optimized schedule has a lower modeled
                  value. Cost uses {outcome.currency} as declared by the canonical tariffs.
                </p>
                {outcome.energyImpact.processMoveComparisons.length > 0 && (
                  <>
                    <h4>Movement &amp; modeled results</h4>
                    <ul>
                      {outcome.energyImpact.processMoveComparisons.map((shift) => (
                        <li key={shift.processId}>
                          <strong>{shift.processName}</strong>: baseline {shift.baselineStartsAt} → optimized {shift.optimizedStartsAt}
                          {' '}({signed(shift.shiftMinutes)} min).
                          {' '}Modeled solar allocation: {fixed(shift.baselineSolarKwh)} → {fixed(shift.optimizedSolarKwh)} kWh
                          {' '}({signed(shift.solarDeltaKwh)} kWh).
                          {' '}Modeled TOU energy cost: {fixed(shift.baselineTouCost)} → {fixed(shift.optimizedTouCost)} {outcome.currency}
                          {' '}({signed(shift.touCostDelta)} {outcome.currency}).
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {factory3dUrl && <p><a href={factory3dUrl.toString()} target="_blank" rel="noreferrer">Open this canonical schedule in separate Factory-3D</a></p>}
              </>
            )}
          </>
        )}
        {error && <p role="alert" style={styles.error}>{error}</p>}
        {events.length > 0 && <details><summary>UAT gate and verification events</summary><ul>{events.map((event, index) => <li key={`${index}-${event}`}>{event}</li>)}</ul></details>}
      </section>
    </main>
  )
}
