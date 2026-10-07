import { NavLink, useLocation } from 'react-router-dom'
import Logo from '../components/Logo/Logo'
import Factory3DLauncher from '../components/Factory3DLauncher/Factory3DLauncher'
import { useFactory } from '../context/useFactory'
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
  const { factories, selectedFactoryId, setFactoryId } = useFactory()
  const isHistoricalReplay = useLocation().pathname === '/solarshift-historical'

  return (
    <nav aria-label="Main" className={styles.sidebar}>
      <div className={styles.logoRow}>
        <Logo tone="light" size={40} />
      </div>

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

      <ul className={styles.navList}>
        {NAV_ITEMS.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.to === '/'}
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
      </ul>

      <div className={styles.optimizerCard}>
        <strong className={styles.optimizerTitle}>Optimizer ready</strong>
        <span>Last run: today, 09:40</span>
      </div>

      {!isHistoricalReplay && <Factory3DLauncher />}
    </nav>
  )
}
