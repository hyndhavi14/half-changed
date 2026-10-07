import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { FactoryTwin, MockMachineDataProvider } from '../twin'
import { ApiMachineDataProvider } from '../data/providers/ApiMachineDataProvider'
import { supabase } from '../data/supabase'
import { useEnergyStore } from '../state/energyStore'
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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const pageStyle: CSSProperties = {
  minHeight: '100vh',
  display: 'grid',
  placeItems: 'center',
  padding: 24,
  background: '#f3eee5',
  color: '#2a1b12',
  fontFamily: "'Atkinson Hyperlegible', 'Segoe UI', system-ui, sans-serif",
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

function AuthenticatedFactory3D() {
  const search = new URLSearchParams(window.location.search)
  const factoryId = search.get('factoryId') ?? ''
  const scheduleId = search.get('scheduleId') ?? ''
  const demoMode = search.get('demo') === 'true'
  const mockProvider = useMemo(() => new MockMachineDataProvider(), [])
  const [session, setSession] = useState<Session | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [provider, setProvider] = useState<ApiMachineDataProvider | null>(null)
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
  const [unmappedMachines, setUnmappedMachines] = useState<string[]>([])

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
      setUnmappedMachines([])
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
    setProvider(apiProvider)
    setError(null)
    setRefreshErrors({ machines: null, schedule: null })
    void apiProvider.getMachines().then((machines) => {
      setUnmappedMachines(
        machines.filter((machine) => !machine.layout_id).map((machine) => `${machine.name} (${machine.machine_id})`),
      )
    }).catch((failure: unknown) => {
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
          dataLabel="backend demo · status not reported"
        />
        <button
          type="button"
          onClick={() => void signOut()}
          disabled={busy}
          style={{ position: 'fixed', zIndex: 25, right: 16, top: 16 }}
        >
          Sign out
        </button>
        {unmappedMachines.length > 0 && (
          <aside
            role="status"
            style={{
              position: 'fixed',
              zIndex: 20,
              left: 16,
              bottom: 16,
              maxWidth: 'min(560px, calc(100% - 32px))',
              padding: '10px 14px',
              borderRadius: 10,
              background: '#fffcf6',
              color: '#2a1b12',
            }}
          >
            No scene geometry mapping for: {unmappedMachines.join(', ')}
          </aside>
        )}
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
