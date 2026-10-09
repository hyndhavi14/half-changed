import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { FactoryTwin, MockMachineDataProvider } from '../twin'
import { ApiMachineDataProvider } from '../data/providers/ApiMachineDataProvider'
import { PlannedMachineDataProvider } from '../data/providers/PlannedMachineDataProvider'
import { hourlySolarKw, planBounds, solarAt } from '../data/planned'
import { supabase } from '../data/supabase'
import { useEnergyStore } from '../state/energyStore'
import { usePlanStore } from '../state/planStore'
import { useScheduleStore } from '../state/scheduleStore'
import { PlanTimePanel } from '../ui/panels/PlanTimePanel'
import {
  isPublicSolarShiftCode,
  isPublicSolarShiftSchedule,
  PublicSolarShiftReplay,
} from './PublicSolarShiftReplay'

const configuredApiBase = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '')
const API_BASE_URL = configuredApiBase
  ? configuredApiBase.endsWith('/api/v1')
    ? configuredApiBase
    : `${configuredApiBase}/api/v1`
  : '/api/v1'
/** Pages allowed to embed this app and hand it a session (never taken from the URL). */
const HOST_ORIGINS = (import.meta.env.VITE_FRONTEND_ORIGIN ?? 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map((origin: string) => origin.trim().replace(/\/+$/, ''))
  .filter(Boolean)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const pageStyle: CSSProperties = {
  minHeight: '100vh',
  display: 'grid',
  placeItems: 'center',
  padding: 24,
  background: '#f3eee5',
  color: '#2a1b12',
  fontFamily: "'Inter', 'Segoe UI', system-ui, sans-serif",
}

const formStyle: CSSProperties = {
  width: 'min(100%, 480px)',
  display: 'grid',
  gap: 14,
  padding: 24,
  border: '1px solid #e2d3bd',
  borderRadius: 16,
  background: '#fffcf6',
  boxShadow: '0 8px 32px rgba(59, 36, 22, 0.12)',
}

/**
 * Embedded in the ByteMe frontend: announce readiness to the allow-listed parent origin,
 * accept the signed-in session and the plan time from it, and report time changes back.
 */
function useHostBridge(embedded: boolean) {
  const [hostOrigin, setHostOrigin] = useState<string | null>(null)
  useEffect(() => {
    if (!embedded || window.parent === window) return
    let attempts = 0
    const announce = () => {
      for (const origin of HOST_ORIGINS) window.parent.postMessage({ type: 'byteme-3d-ready' }, origin)
    }
    announce()
    const timer = window.setInterval(() => {
      attempts += 1
      if (attempts > 10 || usePlanStore.getState().factoryName) window.clearInterval(timer)
      else announce()
    }, 1000)
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent || !HOST_ORIGINS.includes(event.origin)) return
      const data = event.data as { type?: unknown; accessToken?: unknown; refreshToken?: unknown; at?: unknown } | null
      if (!data || typeof data.type !== 'string') return
      if (data.type === 'byteme-3d-session' && typeof data.accessToken === 'string' && typeof data.refreshToken === 'string') {
        setHostOrigin(event.origin)
        void supabase.auth.setSession({ access_token: data.accessToken, refresh_token: data.refreshToken })
      } else if (data.type === 'byteme-3d-time' && typeof data.at === 'number' && Number.isFinite(data.at)) {
        setHostOrigin(event.origin)
        usePlanStore.getState().set({ at: data.at, playing: false, fromHost: true })
      }
    }
    window.addEventListener('message', onMessage)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('message', onMessage)
    }
  }, [embedded])

  useEffect(() => {
    if (!hostOrigin) return
    return usePlanStore.subscribe((state, previous) => {
      if (state.at !== previous.at && state.at !== null && !state.fromHost) {
        window.parent.postMessage({ type: 'byteme-3d-time', at: state.at }, hostOrigin)
      }
    })
  }, [hostOrigin])
}

/** Keeps the planned machine states and the solar reading in step with the plan time. */
function usePlanSync(planned: PlannedMachineDataProvider | null) {
  useEffect(() => {
    if (!planned) return
    let alive = true
    let profile: Map<number, number> | null = null
    const plan = usePlanStore.getState()
    plan.set({ at: null, start: null, end: null, playing: false })
    void planned.base.getFactoryInfo().then((info) => {
      if (!alive) return
      usePlanStore.getState().set({ timeZone: info.timeZone, factoryName: info.name })
      planned.setTimeZone(info.timeZone)
    }).catch(() => undefined)
    void planned.base.getProcessNames().then((names) => alive && planned.setProcessNames(names)).catch(() => undefined)

    const applyTime = (at: number | null) => {
      planned.setTime(at)
      useEnergyStore.getState().setSolar(solarAt(profile, at))
    }
    const onSchedule = (schedule: ReturnType<typeof useScheduleStore.getState>['schedule']) => {
      const bounds = planBounds(schedule)
      if (!bounds) return
      const current = usePlanStore.getState().at
      const at = current !== null && current >= bounds.start && current < bounds.end ? current : bounds.start
      usePlanStore.getState().set({ start: bounds.start, end: bounds.end, at })
      void planned.base.getEnergyRows(new Date(bounds.start).toISOString(), new Date(bounds.end).toISOString())
        .then((rows) => {
          if (!alive) return
          profile = hourlySolarKw(rows)
          applyTime(usePlanStore.getState().at)
        })
        .catch(() => undefined)
    }
    onSchedule(useScheduleStore.getState().schedule)
    const stopSchedule = useScheduleStore.subscribe((state, previous) => {
      if (state.schedule !== previous.schedule) onSchedule(state.schedule)
    })
    const stopTime = usePlanStore.subscribe((state, previous) => {
      if (state.at !== previous.at) applyTime(state.at)
    })
    return () => {
      alive = false
      stopSchedule()
      stopTime()
    }
  }, [planned])
}

function AuthenticatedFactory3D() {
  const search = new URLSearchParams(window.location.search)
  const factoryId = search.get('factoryId') ?? ''
  const scheduleId = search.get('scheduleId') ?? ''
  const demoMode = search.get('demo') === 'true'
  const embedded = search.get('embed') === '1'
  const mockProvider = useMemo(() => new MockMachineDataProvider(), [])
  const [session, setSession] = useState<Session | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [provider, setProvider] = useState<PlannedMachineDataProvider | null>(null)
  const [waitingForHost, setWaitingForHost] = useState(embedded)
  useHostBridge(embedded)
  usePlanSync(provider)
  useEffect(() => {
    if (!waitingForHost) return
    const timer = window.setTimeout(() => setWaitingForHost(false), 8000)
    return () => window.clearTimeout(timer)
  }, [waitingForHost])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(
    UUID.test(factoryId) && UUID.test(scheduleId)
      ? null
      : 'Open Factory-3D from the frontend launcher with a backend factory and schedule selected.',
  )
  const [refreshErrors, setRefreshErrors] = useState<{
    machines: string | null
    schedule: string | null
  }>({ machines: null, schedule: null })

  const reportError = useCallback((failure: Error, resource: 'machines' | 'schedule') => {
    setRefreshErrors((current) => ({ ...current, [resource]: failure.message }))
  }, [])
  const clearRefreshError = useCallback((resource: 'machines' | 'schedule') => {
    setRefreshErrors((current) => ({ ...current, [resource]: null }))
  }, [])

  useEffect(() => {
    let active = true
    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return
      if (sessionError) setError('Supabase session could not be restored.')
      setSession(data.session)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
    })
    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!session) {
      setProvider(null)
      return
    }
    if (!UUID.test(factoryId) || !UUID.test(scheduleId)) {
      setError('Open Factory-3D from the frontend launcher with a backend factory and schedule selected.')
      setProvider(null)
      return
    }
    const apiProvider = new ApiMachineDataProvider({
      baseUrl: API_BASE_URL,
      factoryId,
      scheduleId,
      headers: { Authorization: `Bearer ${session.access_token}` },
      onError: reportError,
      onRecovery: clearRefreshError,
    })
    useEnergyStore.getState().setSolar(null)
    setProvider(new PlannedMachineDataProvider(apiProvider))
    setError(null)
    setRefreshErrors({ machines: null, schedule: null })
    void apiProvider.getMachines().catch((failure: unknown) => {
      setError(failure instanceof Error ? failure.message : 'Backend machines could not be loaded.')
    })
  }, [session, factoryId, scheduleId, reportError, clearRefreshError])

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
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Sign-out failed.')
    } finally {
      setBusy(false)
    }
  }

  if (demoMode) {
    return (
      <div style={{ position: 'fixed', inset: 0 }}>
        <FactoryTwin
          provider={mockProvider}
          initialView="reset"
          dataLabel="explicit mock/demo data"
        />
      </div>
    )
  }

  if (provider) {
    return (
      <div style={{ position: 'fixed', inset: 0 }}>
        <FactoryTwin
          provider={provider}
          initialView="reset"
          simulate={false}
          readOnly
          dataLabel="planned schedule · not live telemetry"
          className={embedded ? 'is-embedded' : undefined}
        >
          <PlanTimePanel />
        </FactoryTwin>
        {!embedded && <button
          type="button"
          onClick={() => void signOut()}
          disabled={busy}
          style={{ position: 'fixed', zIndex: 25, right: 16, top: 16 }}
        >
          Sign out
        </button>}
        {(refreshErrors.machines || refreshErrors.schedule) && (
          <div
            role="alert"
            style={{
              position: 'fixed',
              zIndex: 20,
              right: 16,
              bottom: 16,
              maxWidth: 'min(560px, calc(100% - 32px))',
              padding: '10px 14px',
              border: '1px solid #a53b28',
              borderRadius: 10,
              background: '#fff4ef',
              color: '#712519',
              overflowWrap: 'anywhere',
            }}
          >
            {refreshErrors.machines && <p>Machine refresh failed: {refreshErrors.machines}</p>}
            {refreshErrors.schedule && <p>Schedule refresh failed: {refreshErrors.schedule}</p>}
          </div>
        )}
      </div>
    )
  }

  if (embedded && waitingForHost && !error) {
    return <main style={pageStyle} role="status">Connecting to ByteMe…</main>
  }

  return (
    <main style={pageStyle}>
      <form style={formStyle} onSubmit={(event) => void signIn(event)}>
        <h1 style={{ margin: 0, fontFamily: 'Georgia, serif' }}>Sign in to Factory-3D</h1>
        <p style={{ margin: 0, lineHeight: 1.5 }}>
          Sign in with your Supabase Auth account. Factory and schedule UUIDs
          come from the frontend launcher; credentials are never placed in the URL.
        </p>
        <p style={{ margin: 0, overflowWrap: 'anywhere', fontSize: 13 }}>
          Factory UUID: {factoryId || 'missing'}
          <br />
          Schedule UUID: {scheduleId || 'missing'}
        </p>
        <label htmlFor="auth-email">Email</label>
        <input
          id="auth-email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.currentTarget.value)}
          style={{ minHeight: 44, padding: '8px 10px', border: '1px solid #bba58c', borderRadius: 8 }}
          required
        />
        <label htmlFor="auth-password">Password</label>
        <input
          id="auth-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.currentTarget.value)}
          style={{ minHeight: 44, padding: '8px 10px', border: '1px solid #bba58c', borderRadius: 8 }}
          required
        />
        {error && <p role="alert" style={{ margin: 0, color: '#9b2e1d' }}>{error}</p>}
        <button
          type="submit"
          disabled={busy}
          style={{ minHeight: 44, border: 0, borderRadius: 8, background: '#5c351f', color: 'white', fontWeight: 700 }}
        >
          {busy ? 'Signing in…' : 'Sign in with Supabase Auth'}
        </button>
        <p style={{ margin: 0, color: '#654d3a', fontSize: 13 }}>
          The separate <code>?demo=true</code> visual mock remains an explicit mode only;
          it is never used as a fallback for Backend errors.
        </p>
      </form>
    </main>
  )
}

export function App() {
  const search = new URLSearchParams(window.location.search)
  const requestedScenario = search.get('scenario')
  if (requestedScenario !== null) {
    const requestedSchedule = search.get('schedule') ?? 'optimized'
    if (!isPublicSolarShiftCode(requestedScenario)) {
      return <main className="bm-public-replay-error" role="alert">Only the approved HGD and LGD public scenarios are available.</main>
    }
    if (!isPublicSolarShiftSchedule(requestedSchedule)) {
      return <main className="bm-public-replay-error" role="alert">Choose either the baseline or optimized stored schedule.</main>
    }
    return <PublicSolarShiftReplay code={requestedScenario} scheduleKind={requestedSchedule} />
  }
  return <AuthenticatedFactory3D />
}
