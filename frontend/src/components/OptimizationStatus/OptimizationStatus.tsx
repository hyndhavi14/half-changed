import Button from '../Button/Button'
import type { OptimizationState } from '../../data/optimizationState'
import styles from './OptimizationStatus.module.css'

interface OptimizationStatusProps {
  state: OptimizationState
  onRun: () => void
  running: boolean
  /** Compact = one line for secondary pages; the dashboard shows the full banner. */
  compact?: boolean
}

const BUTTON: Record<OptimizationState['kind'], string> = {
  not_run: 'Run optimization',
  running: 'Optimizing…',
  success: 'Run again',
  failed: 'Retry optimization',
  last_success: 'Run optimization',
}

/** The single source of truth for "what state is the optimization in" on every page. */
export default function OptimizationStatus({ state, onRun, running, compact = false }: OptimizationStatusProps) {
  return (
    <section
      className={`${styles.status} ${styles[state.kind]} ${compact ? styles.compact : ''}`}
      aria-live="polite"
      role={state.kind === 'failed' ? 'alert' : 'status'}
    >
      <div className={styles.copy}>
        <span className={styles.chip}>{state.title}</span>
        {!compact && <p className={styles.detail}>{state.detail}</p>}
        {compact && state.kind === 'failed' && <p className={styles.detail}>{state.detail}</p>}
        {state.hint && <p className={styles.hint}><strong>How to fix:</strong> {state.hint}</p>}
        {state.resultLabel && <p className={styles.label}>Showing: <strong>{state.resultLabel}</strong></p>}
      </div>
      <Button variant={state.kind === 'failed' || state.kind === 'not_run' ? 'primary' : 'secondary'} isLoading={running} onClick={onRun}>
        {BUTTON[state.kind]}
      </Button>
    </section>
  )
}
