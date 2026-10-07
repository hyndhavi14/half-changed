import { useState, type FormEvent } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Button from '../components/Button/Button'
import Card from '../components/Card/Card'
import { useFactory } from '../context/useFactory'
import { supabase } from '../data/supabase'
import Sidebar from './Sidebar'
import styles from './AppShell.module.css'

export default function AppShell() {
  const { factories, loading, error, reloadFactories } = useFactory()
  const isHistoricalReplay = useLocation().pathname === '/solarshift-historical'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setAuthBusy(true)
    setAuthError(null)
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
      if (signInError) throw signInError
      setPassword('')
      await reloadFactories()
    } catch (failure) {
      setAuthError(failure instanceof Error ? failure.message : 'Sign-in failed.')
    } finally {
      setAuthBusy(false)
    }
  }

  const requiresSignIn = error?.includes('Authentication required') ?? false
  const dataState = isHistoricalReplay ? null : loading ? (
    <Card title="Loading factory data…">
      <p className={styles.stateText}>Please wait while factory data loads.</p>
    </Card>
  ) : requiresSignIn ? (
    <Card title="Sign in to the factory workspace">
      <form onSubmit={(event) => void signIn(event)} className={styles.authForm}>
        <label htmlFor="workspace-email">Email</label>
        <input
          id="workspace-email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.currentTarget.value)}
          required
        />
        <label htmlFor="workspace-password">Password</label>
        <input
          id="workspace-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.currentTarget.value)}
          required
        />
        {authError && <p role="alert" className={styles.stateText}>{authError}</p>}
        <Button variant="primary" type="submit" isLoading={authBusy}>
          Sign in
        </Button>
      </form>
    </Card>
  ) : error ? (
    <Card title="Factory data could not be loaded">
      <p className={styles.stateText}>{error}</p>
      <Button variant="primary" onClick={() => void reloadFactories()}>
        Try again
      </Button>
    </Card>
  ) : factories.length === 0 ? (
    <Card title="No factory data yet">
      <p className={styles.stateText}>
        No factories are available from the configured data source.
      </p>
      <Button variant="primary" onClick={() => void reloadFactories()}>
        Try again
      </Button>
    </Card>
  ) : null

  return (
    <div className={styles.shell}>
      <Sidebar />
      <main className={styles.main}>
        {dataState ?? <Outlet />}
      </main>
    </div>
  )
}
