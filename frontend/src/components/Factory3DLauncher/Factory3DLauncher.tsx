import { useCallback, useEffect, useRef, useState } from 'react'
import {
  mapApiFactory,
  mapApiSchedule,
  unwrapApiEnvelope,
  type FrontendFactoryRef,
  type FrontendScheduleRef,
} from '../../data/backendContracts'
import styles from './Factory3DLauncher.module.css'
import { supabase } from '../../data/supabase'

const configuredApiBase = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '')
const API_BASE_URL = configuredApiBase
  ? configuredApiBase.endsWith('/api/v1')
    ? configuredApiBase
    : `${configuredApiBase}/api/v1`
  : '/api/v1'
const FACTORY_3D_URL = import.meta.env.VITE_FACTORY_3D_URL ?? 'http://localhost:5174'
const PAGE_SIZE = 200

function apiErrorMessage(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || !('error' in value)) return null
  const error = value.error
  if (typeof error !== 'object' || error === null || !('message' in error)) return null
  return typeof error.message === 'string' ? error.message : null
}

async function fetchJson(path: string, token: string, signal?: AbortSignal): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new Error(
      error instanceof Error
        ? `Could not connect to the ByteMe API: ${error.message}`
        : 'Could not connect to the ByteMe API.',
      { cause: error },
    )
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch (error) {
    throw new Error('The ByteMe API returned invalid JSON.', { cause: error })
  }
  if (!response.ok) {
    throw new Error(
      apiErrorMessage(payload) ??
        `The ByteMe API returned ${response.status} ${response.statusText}.`,
    )
  }
  return payload
}

async function fetchRows<T>(
  path: string,
  token: string,
  map: (row: unknown) => T,
  signal?: AbortSignal,
): Promise<T[]> {
  const rows: T[] = []
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const payload = await fetchJson(
      `${path}${path.includes('?') ? '&' : '?'}limit=${PAGE_SIZE}&offset=${offset}`,
      token,
      signal,
    )
    const data = unwrapApiEnvelope<unknown>(payload)
    if (!Array.isArray(data)) throw new Error('The ByteMe API returned an invalid list.')
    rows.push(...data.map(map))

    const meta =
      typeof payload === 'object' && payload !== null && 'meta' in payload
        ? payload.meta
        : null
    const total =
      typeof meta === 'object' &&
      meta !== null &&
      'total' in meta &&
      typeof meta.total === 'number' &&
      Number.isSafeInteger(meta.total) &&
      meta.total >= 0
        ? meta.total
        : null
    if (total !== null ? rows.length >= total : data.length < PAGE_SIZE) return rows
    if (data.length === 0) {
      throw new Error('The ByteMe API pagination did not make progress.')
    }
  }
}

export default function Factory3DLauncher() {
  const [token, setToken] = useState<string | null>(null)
  const tokenRef = useRef<string | null>(null)
  const [sessionLoaded, setSessionLoaded] = useState(false)
  const [factories, setFactories] = useState<FrontendFactoryRef[]>([])
  const [factoryId, setFactoryId] = useState('')
  const [schedules, setSchedules] = useState<FrontendScheduleRef[]>([])
  const [scheduleId, setScheduleId] = useState('')
  const [loadingFactories, setLoadingFactories] = useState(false)
  const [loadingSchedules, setLoadingSchedules] = useState(false)
  const [factoriesLoaded, setFactoriesLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const updateSessionToken = useCallback((nextToken: string | null) => {
    if (tokenRef.current !== nextToken) {
      tokenRef.current = nextToken
      setFactories([])
      setFactoryId('')
      setSchedules([])
      setScheduleId('')
      setFactoriesLoaded(false)
      setLoadingFactories(false)
      setLoadingSchedules(false)
      setError(null)
    }
    setToken(nextToken)
  }, [])

  useEffect(() => {
    let active = true
    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return
      if (sessionError) setError(`Could not restore the Supabase session: ${sessionError.message}`)
      updateSessionToken(data.session?.access_token ?? null)
      setSessionLoaded(true)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      updateSessionToken(session?.access_token ?? null)
    })
    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [updateSessionToken])

  useEffect(() => {
    if (!factoryId || !token) return

    const controller = new AbortController()
    void fetchRows(
      `/factories/${encodeURIComponent(factoryId)}/schedules`,
      token,
      mapApiSchedule,
      controller.signal,
    )
      .then((rows) => {
        if (rows.some((schedule) => schedule.factoryId !== factoryId)) {
          throw new Error('Backend returned a schedule outside the selected factory.')
        }
        setSchedules(rows)
      })
      .catch((loadError: unknown) => {
        if (loadError instanceof DOMException && loadError.name === 'AbortError') return
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Schedules could not be loaded.',
        )
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingSchedules(false)
      })
    return () => controller.abort()
  }, [factoryId, token])

  async function loadFactories() {
    if (!token) {
      setError('Sign in to the protected workspace before loading backend factories.')
      return
    }
    setLoadingFactories(true)
    setError(null)
    setFactories([])
    setFactoriesLoaded(false)
    setFactoryId('')
    setSchedules([])
    setScheduleId('')
    try {
      const rows = await fetchRows('/factories', token, mapApiFactory)
      setFactories(rows)
      setFactoriesLoaded(true)
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Factories could not be loaded.',
      )
    } finally {
      setLoadingFactories(false)
    }
  }

  function openFactoryTwin() {
    if (!factoryId || !scheduleId) return
    const target = new URL(FACTORY_3D_URL, window.location.origin)
    target.searchParams.set('factoryId', factoryId)
    target.searchParams.set('scheduleId', scheduleId)
    window.open(target, '_blank', 'noopener,noreferrer')
  }

  return (
    <section className={styles.launcher} aria-label="Open backend factory in Factory-3D">
      <h2 className={styles.title}>Factory-3D · backend demo</h2>
      <div className={styles.form}>
        <p className={styles.note}>
          {token
            ? 'Using the signed-in Supabase session to load authorized Backend records.'
            : sessionLoaded
              ? 'Sign in to the protected workspace before loading private factory data.'
              : 'Restoring the protected workspace session…'}
        </p>
        <button className={styles.button} type="button" onClick={() => void loadFactories()} disabled={loadingFactories || !token}>
          {loadingFactories ? 'Loading factories…' : 'Load accessible factories'}
        </button>
      </div>

      {factories.length > 0 && (
        <div className={styles.form}>
          <label className={styles.label} htmlFor="backend-factory">
            Backend factory
          </label>
          <select
            id="backend-factory"
            className={styles.input}
            value={factoryId}
            onChange={(event) => {
              setSchedules([])
              setScheduleId('')
              setLoadingSchedules(Boolean(event.currentTarget.value))
              setError(null)
              setFactoryId(event.currentTarget.value)
            }}
          >
            <option value="">Choose a factory</option>
            {factories.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {factoryId && (
        <div className={styles.form}>
          <label className={styles.label} htmlFor="backend-schedule">
            Stored schedule
          </label>
          <select
            id="backend-schedule"
            className={styles.input}
            value={scheduleId}
            onChange={(event) => setScheduleId(event.currentTarget.value)}
            disabled={loadingSchedules || schedules.length === 0}
          >
            <option value="">
              {loadingSchedules
                ? 'Loading schedules…'
                : schedules.length
                  ? 'Choose a schedule'
                  : 'No stored schedules'}
            </option>
            {schedules.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · v{item.version} · {item.status} · {item.horizonStart}
              </option>
            ))}
          </select>
        </div>
      )}

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {factoriesLoaded && factories.length === 0 && (
        <p className={styles.note}>This account has no accessible backend factories.</p>
      )}
      <button
        className={styles.button}
        type="button"
        disabled={!factoryId || !scheduleId}
        onClick={openFactoryTwin}
      >
        Open selected schedule in 3D
      </button>
    </section>
  )
}
