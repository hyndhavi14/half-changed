import type { PlanChecks, ProcessMove } from '../../data/factoryInsight'
import { formatCurrency, formatDuration, formatKw, formatKwh } from '../../data/format'
import styles from './MoveExplanation.module.css'

interface MoveExplanationProps {
  move: ProcessMove
  checks: PlanChecks | null
  timeZone: string
  currency: string
  /** "hero" = the dashboard recommendation; "row" = one entry in the SolarShift list. */
  variant?: 'hero' | 'row'
  /** False outside the SolarShift demo: no solar reason and no grid-energy tile. */
  showSolar?: boolean
}

type Mark = 'yes' | 'no' | 'unknown'

function clock(at: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(at))
}

function number(value: number, digits = 2): string {
  return value.toLocaleString('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: 0 })
}

function moveReasons(move: ProcessMove, checks: PlanChecks | null, currency: string): Array<{ mark: Mark; text: string }> {
  const solar: Mark = move.baselineSolarKw === null || move.optimizedSolarKw === null
    ? 'unknown'
    : move.optimizedSolarKw > move.baselineSolarKw + 1e-6 ? 'yes' : 'no'
  const tariff: Mark = move.baselinePrice === null || move.optimizedPrice === null
    ? 'unknown'
    : move.optimizedPrice < move.baselinePrice - 1e-9 ? 'yes' : 'no'
  return [
    {
      mark: solar,
      text: solar === 'unknown'
        ? 'Solar availability: no readings cover one of the windows'
        : `${solar === 'yes' ? 'Higher' : 'No higher'} solar availability: ${formatKw(move.baselineSolarKw)} → ${formatKw(move.optimizedSolarKw)} average`,
    },
    {
      mark: tariff,
      text: tariff === 'unknown'
        ? 'Tariff: no single tariff window covers one of the slots'
        : `${tariff === 'yes' ? 'Lower' : 'No lower'} tariff period: ${number(move.baselinePrice ?? 0, 4)} → ${number(move.optimizedPrice ?? 0, 4)} ${currency}/kWh average`,
    },
    {
      mark: checks?.dependencies === null || !checks ? 'unknown' : checks.dependencies ? 'yes' : 'no',
      text: checks?.dependencies === null ? 'No process dependencies are stored for this factory' : 'Production dependencies maintained',
    },
    { mark: !checks ? 'unknown' : checks.machineConflicts ? 'yes' : 'no', text: 'Machine conflict avoided — one process per machine at a time' },
    { mark: !checks ? 'unknown' : checks.withinHorizon ? 'yes' : 'no', text: 'Deadline maintained — finishes inside the planning horizon' },
  ]
}

export default function MoveExplanation({ move, checks, timeZone, currency, variant = 'hero', showSolar = true }: MoveExplanationProps) {
  const allReasons = moveReasons(move, checks, currency).filter((_reason, index) => showSolar || index !== 0)
  // Rows repeat for every process, so they keep only the energy reasons and fold the
  // production-rule checks (identical for every process) into one line.
  const energyReasons = showSolar ? 2 : 1
  const rulesKept = allReasons.slice(energyReasons).every((reason) => reason.mark === 'yes')
  const reasons = variant === 'row'
    ? [...allReasons.slice(0, energyReasons), { mark: (rulesKept ? 'yes' : 'unknown') as Mark, text: rulesKept ? 'All production rules kept (order, machines, deadline)' : 'Production rules: see the constraints on the dashboard' }]
    : allReasons
  const gridSaved = move.baselineGridKwh !== null && move.optimizedGridKwh !== null ? move.baselineGridKwh - move.optimizedGridKwh : null
  const costSaved = move.baselineCost !== null && move.optimizedCost !== null ? move.baselineCost - move.optimizedCost : null
  const direction = move.shiftMinutes > 0 ? 'later' : 'earlier'

  return (
    <article className={`${styles.card} ${variant === 'hero' ? styles.hero : styles.row}`}>
      <div className={styles.what}>
        <span className={styles.step}>What changed</span>
        <h3 className={styles.title}>{variant === 'hero' ? `Move ${move.processName}` : move.processName}</h3>
        <p className={styles.time}>
          <span className={styles.was}>{clock(move.baselineStart, timeZone)}–{clock(move.baselineEnd, timeZone)}</span>
          <span aria-hidden="true" className={styles.arrow}>→</span>
          <span className="visually-hidden">moved to</span>
          <strong>{clock(move.optimizedStart, timeZone)}–{clock(move.optimizedEnd, timeZone)}</strong>
        </p>
        <p className={styles.meta}>
          {move.machineLabel}{move.powerKw !== null ? ` · ${number(move.powerKw, 1)} kW` : ''} · {formatDuration(Math.abs(move.shiftMinutes))} {direction}
        </p>
      </div>
      <div className={styles.why}>
        <span className={styles.step}>Why</span>
        <ul className={styles.reasons}>
          {reasons.map((reason) => (
            <li key={reason.text}>
              <span className={`${styles.mark} ${styles[reason.mark]}`} aria-hidden="true">{reason.mark === 'yes' ? '✓' : reason.mark === 'no' ? '–' : '?'}</span>
              <span>{reason.text}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className={styles.impact}>
        <span className={styles.step}>Impact</span>
        <div className={styles.impactGrid}>
          {showSolar && (
            <div>
              <strong>{gridSaved === null ? 'Not available' : formatKwh(gridSaved)}</strong>
              <span>{gridSaved !== null && gridSaved < 0 ? 'more grid energy' : 'less grid energy'}</span>
            </div>
          )}
          <div>
            <strong>{costSaved === null ? 'Not available' : formatCurrency(costSaved, currency)}</strong>
            <span>modeled cost reduction</span>
          </div>
        </div>
      </div>
    </article>
  )
}
