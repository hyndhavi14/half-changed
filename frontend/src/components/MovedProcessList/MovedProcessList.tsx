import type { BackendFactoryData } from '../../data/backendApi'
import { moveReasons, type ProcessMove } from '../../data/factoryInsight'
import { formatDuration } from '../../data/format'
import styles from './MovedProcessList.module.css'

interface MovedProcessListProps {
  moves: ProcessMove[]
  dependencies: BackendFactoryData['dependencies']
  timeZone: string
  selectedId?: string
  onSelect?: (processId: string) => void
  /** Show only the first N moved processes (reasons still use every move). */
  limit?: number
  /** False outside the SolarShift demo: solar reasons are not shown. */
  showSolar?: boolean
}

function clock(at: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(at))
}

/** Baseline → optimized start for every moved process, with only data-supported reasons. */
export default function MovedProcessList({ moves, dependencies, timeZone, selectedId, onSelect, limit, showSolar = true }: MovedProcessListProps) {
  const moved = moves.filter((move) => move.moved)
  if (moved.length === 0) {
    return <p className={styles.empty}>No process changed its start time between the baseline and the optimized schedule.</p>
  }
  return (
    <ol className={styles.list}>
      {moved.slice(0, limit ?? moved.length).map((move) => {
        const reasons = moveReasons(move, moves, dependencies).filter((reason) => showSolar || reason !== 'More solar')
        const body = (
          <>
            <span className={styles.name}>
              <strong>{move.processName}</strong>
              <small>{move.machineLabel}</small>
            </span>
            <span className={styles.times}>
              <span className={styles.was}>{clock(move.baselineStart, timeZone)}</span>
              <span aria-hidden="true" className={styles.arrow}>→</span>
              <span className="visually-hidden">moved to</span>
              <strong>{clock(move.optimizedStart, timeZone)}</strong>
              <small>{formatDuration(Math.abs(move.shiftMinutes))} {move.shiftMinutes > 0 ? 'later' : 'earlier'}</small>
            </span>
            <span className={styles.reasons}>
              {reasons.length
                ? reasons.map((reason) => <span key={reason} className={styles.reason}>{reason}</span>)
                : <span className={styles.reasonMuted}>Re-timed by the optimizer</span>}
            </span>
          </>
        )
        return (
          <li key={move.processId}>
            {onSelect ? (
              <button type="button" className={`${styles.row} ${selectedId === move.processId ? styles.selected : ''}`} aria-pressed={selectedId === move.processId} onClick={() => onSelect(move.processId)}>
                {body}
              </button>
            ) : (
              <div className={styles.row}>{body}</div>
            )}
          </li>
        )
      })}
    </ol>
  )
}
