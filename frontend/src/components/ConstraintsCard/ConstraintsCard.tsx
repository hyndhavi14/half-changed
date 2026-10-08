import Card from '../Card/Card'
import type { PlanChecks } from '../../data/factoryInsight'
import styles from './ConstraintsCard.module.css'

interface ConstraintsCardProps {
  checks: PlanChecks | null
}

function verdict(value: boolean | null | undefined): { text: string; tone: 'ok' | 'fail' | 'muted' } {
  if (value === true) return { text: 'Checked in plan', tone: 'ok' }
  if (value === false) return { text: 'Violated', tone: 'fail' }
  return { text: 'Enforced', tone: 'muted' }
}

/**
 * Constraints as the backend actually sends them to the optimizer (backend/lib/optimizer/pythonPayload.ts).
 * Where the stored optimized schedule can be checked, the check result is shown.
 */
export default function ConstraintsCard({ checks }: ConstraintsCardProps) {
  const enforced = [
    { label: 'Process durations', value: undefined },
    { label: 'Machine assignment', value: undefined },
    { label: 'One process per machine at a time', value: checks?.machineConflicts },
    {
      label: checks && checks.dependencies === null ? 'Process dependencies (none stored)' : 'Finish-to-start dependencies',
      value: checks?.dependencies ?? undefined,
    },
    { label: 'Finish inside the planning horizon (deadline)', value: checks?.withinHorizon },
  ]
  const engineOnly = ['Process time windows', 'Fixed (non-flexible) processes — every stored process is treated as flexible']
  const future = ['Machine availability calendars (stored, informational only)', 'Maintenance windows', 'Shift constraints', 'Maximum continuous runtime', 'Production orders (stored, not scheduled)']

  return (
    <Card title="Production constraints">
      <div className={styles.columns}>
        <div className={styles.column}>
          <h3>Enforced by the optimizer</h3>
          <ul>
            {enforced.map((item) => {
              const state = verdict(item.value)
              return (
                <li key={item.label}>
                  <span className={`${styles.mark} ${styles[state.tone]}`} aria-hidden="true">{state.tone === 'fail' ? '!' : '✓'}</span>
                  <span className={styles.text}>{item.label}</span>
                  <span className={`${styles.state} ${styles[`${state.tone}Text`]}`}>{state.text}</span>
                </li>
              )
            })}
          </ul>
        </div>
        <div className={styles.column}>
          <h3>Not currently modeled</h3>
          <ul>
            {engineOnly.map((label) => (
              <li key={label}>
                <span className={`${styles.mark} ${styles.empty}`} aria-hidden="true">–</span>
                <span className={styles.text}>{label}</span>
                <span className={styles.state}>Engine supports · not configurable</span>
              </li>
            ))}
            {future.map((label) => (
              <li key={label}>
                <span className={`${styles.mark} ${styles.empty}`} aria-hidden="true">–</span>
                <span className={styles.text}>{label}</span>
                <span className={styles.state}>Future</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  )
}
