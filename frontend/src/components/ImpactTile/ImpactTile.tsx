import styles from './ImpactTile.module.css'

interface ImpactTileProps {
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  tone?: 'good' | 'bad' | 'neutral' | 'solar'
  provenance?: React.ReactNode
}

/** A large headline number for savings and impact, with a coloured accent by tone. */
export default function ImpactTile({ label, value, sub, tone = 'neutral', provenance }: ImpactTileProps) {
  return (
    <div className={`${styles.tile} ${styles[tone]}`}>
      <div className={styles.head}>
        <span className={styles.label}>{label}</span>
        {provenance}
      </div>
      <div className={styles.value}>{value}</div>
      {sub !== undefined && <div className={styles.sub}>{sub}</div>}
    </div>
  )
}
