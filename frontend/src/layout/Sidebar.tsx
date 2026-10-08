import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import Logo from '../components/Logo/Logo'
import Factory3DLauncher from '../components/Factory3DLauncher/Factory3DLauncher'
import { useFactory } from '../context/useFactory'
import { latestOptimization } from '../data/optimizationView'
import { supabase } from '../data/supabase'
import { optimizerCardText } from './shellStatus'
import styles from './Sidebar.module.css'

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', number: 1 },
  { to: '/processes', label: 'Processes & Machines', number: 2 },
  { to: '/schedule', label: 'Production Schedule', number: 3 },
  { to: '/energy', label: 'Energy Analysis', number: 4 },
  { to: '/compare', label: 'Baseline vs Optimized', number: 5 },
  { to: '/builder', label: 'Factory Builder', number: 6 },
  { to: '/factory-view', label: 'Factory View (2D / 3D)', number: 7 },
  { to: '/solarshift-historical', label: 'SolarShift Historical Replay', number: 8 },
]

export default function Sidebar() {
  const { factories, selectedFactoryId, setFactoryId, backendData, optimizing } = useFactory()
  const isHistoricalReplay = useLocation().pathname === '/solarshift-historical'
  const [menuOpen, setMenuOpen] = useState(false)
  const [email, setEmail] = useState<string | null>(null)
  const [signingOut, setSigningOut] = useState(false)
  const [accountError, setAccountError] = useState<string | null>(null)
  const latest = backendData ? latestOptimization(backendData.optimizationRequests) : null
  const optimizerText = optimizerCardText({
    latest,
    timeZone: backendData?.factory.timezone ?? null,
    optimizing,
    hasData: backendData !== null,
  })

  useEffect(() => {
    let active = true
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) setEmail(session?.user.email ?? null)
    })
    void supabase.auth.getSession()
      .then(({ data: sessionData, error }) => {
        if (!active) return
        if (error) {
          setAccountError(error.message)
          return
        }
        setEmail(sessionData.session?.user.email ?? null)
      })
      .catch((failure: unknown) => {
        if (active) {
          setAccountError(failure instanceof Error ? failure.message : 'Could not restore the signed-in account.')
        }
      })
    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [])

  async function signOut() {
    setSigningOut(true)
    setAccountError(null)
    try {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
      window.location.assign('/')
    } catch (failure) {
      setAccountError(failure instanceof Error ? failure.message : 'Sign out failed.')
      setSigningOut(false)
    }
  }

  return (
    <nav aria-label="Main" className={styles.sidebar}>
      <div className={styles.logoRow}>
        <Logo tone="light" size={40} />
      </div>

      <button
        type="button"
        className={styles.menuToggle}
        aria-expanded={menuOpen}
        aria-controls="sidebar-panel"
        onClick={() => setMenuOpen((open) => !open)}
      >
        {menuOpen ? 'Close menu' : 'Menu'}
      </button>

      <div id="sidebar-panel" className={`${styles.panel}${menuOpen ? ` ${styles.panelOpen}` : ''}`}>
        {!isHistoricalReplay && (
          <div className={styles.factoryPicker}>
            <label htmlFor="factory-select" className={styles.eyebrow}>
              Factory
            </label>
            <select
              id="factory-select"
              className={styles.select}
              value={selectedFactoryId}
              onChange={(event) => setFactoryId(event.currentTarget.value)}
            >
              {factories.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <ul className={styles.navList}>
          {NAV_ITEMS.slice(0, 7).map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.to === '/'}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  `${styles.navLink}${isActive ? ` ${styles.active}` : ''}`
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      className={`${styles.badge}${
                        isActive ? ` ${styles.badgeActive}` : ''
                      }`}
                      aria-hidden="true"
                    >
                      {item.number}
                    </span>
                    {item.label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
          <li className={styles.navDivider} aria-hidden="true" />
          {NAV_ITEMS.slice(7).map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                onClick={() => setMenuOpen(false)}
                className={({ isActive }) =>
                  `${styles.navLink}${isActive ? ` ${styles.active}` : ''}`
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      className={`${styles.badge}${
                        isActive ? ` ${styles.badgeActive}` : ''
                      }`}
                      aria-hidden="true"
                    >
                      {item.number}
                    </span>
                    <span>
                      {item.label}
                      <span className={styles.navCaption}>Public replay</span>
                    </span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>

        {!isHistoricalReplay && (
          <div className={styles.optimizerCard}>
            <strong className={styles.optimizerTitle}>{optimizerText.title}</strong>
            <span>{optimizerText.detail}</span>
          </div>
        )}

        {email !== null && (
          <div className={styles.account}>
            <span className={styles.accountLabel}>Signed in as</span>
            <span className={styles.accountEmail}>{email}</span>
            <button
              type="button"
              className={styles.signOut}
              onClick={() => void signOut()}
              disabled={signingOut}
            >
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
            {accountError && <p role="alert" className={styles.accountError}>{accountError}</p>}
          </div>
        )}
        {email === null && accountError && (
          <p role="alert" className={styles.accountError}>{accountError}</p>
        )}

        {!isHistoricalReplay && (
          <details className={styles.launcherDetails}>
            <summary className={styles.launcherSummary}>Open a schedule in Factory-3D</summary>
            <Factory3DLauncher />
          </details>
        )}
      </div>
    </nav>
  )
}
