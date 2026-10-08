import styles from './KpiCard.module.css'

interface KpiCardProps {
  label?: string
  value: React.ReactNode
  delta?: string
  note?: string
  dotColor?: string
  deltaTone?: 'good' | 'bad' | 'neutral'
  provenance?: React.ReactNode
}

export default function KpiCard({
  label,
  value,
  delta,
  note,
  dotColor,
  deltaTone = 'good',
  provenance,
}: KpiCardProps) {
  return (
    <section className={styles.card}>
      <div className={styles.labelRow}>
        <span
          className={styles.dot}
          style={{ backgroundColor: dotColor ?? 'var(--caramel)' }}
          aria-hidden="true"
        />
        <span className={styles.label}>{label}</span>
        {provenance !== undefined && <span className={styles.provenance}>{provenance}</span>}
      </div>
      <div className={styles.value}>
        {value}
      </div>
      {(delta || note) && (
        <div className={styles.bottomRow}>
          {delta && (
            <span className={`${styles.deltaPill}${deltaTone === 'bad' ? ` ${styles.deltaBad}` : deltaTone === 'neutral' ? ` ${styles.deltaNeutral}` : ''}`}>
              {delta}
            </span>
          )}
          {note && <span className={styles.note}>{note}</span>}
        </div>
      )}
    </section>
  )
}
