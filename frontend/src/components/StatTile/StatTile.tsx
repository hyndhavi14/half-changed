import styles from './StatTile.module.css'

interface StatTileProps {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  provenance?: React.ReactNode
}

export default function StatTile({ label, value, sub, provenance }: StatTileProps) {
  return (
    <div className={styles.tile}>
      {provenance !== undefined ? (
        <div className={styles.labelRow}>
          <span className={styles.label}>{label}</span>
          {provenance}
        </div>
      ) : (
        <span className={styles.label}>{label}</span>
      )}
      <div className={styles.value}>{value}</div>
      {sub !== undefined && <div className={styles.sub}>{sub}</div>}
    </div>
  )
}
