import styles from './TariffStrip.module.css'

export interface TariffStripCell {
  tone: 'peak' | 'mid' | 'off' | null
  label: string
}

interface TariffStripProps {
  cells: TariffStripCell[]
  summary?: string
}

export default function TariffStrip({ cells, summary }: TariffStripProps) {
  return (
    <>
      <div className={styles.strip} aria-hidden="true">
        {cells.map((cell, index) => (
          <span
            key={index}
            className={`${styles.cell} ${styles[cell.tone ?? 'none']}`}
            title={cell.label}
          />
        ))}
      </div>
      {summary && <p className="visually-hidden">{summary}</p>}
    </>
  )
}
