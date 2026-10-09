import { useState } from 'react'
import styles from './TariffChart.module.css'

export interface TariffChartPoint {
  start: number
  price: number | null
  band: 'peak' | 'mid' | 'off' | null
}

interface TariffChartProps {
  points: TariffChartPoint[]
  currency: string
  timeZone: string
  ariaLabel: string
  selectedIndex?: number
  onSelect?: (index: number) => void
}

const BAND_TEXT = { peak: 'Peak', mid: 'Mid', off: 'Off-peak' } as const
const HOUR = 3_600_000

/**
 * Electricity price per hour exactly as supplied to the optimizer (the tariff window in force at
 * the start of each hour). Hover or focus a bar for the exact value; hours without a single
 * applicable window are hatched and labelled "Not recorded".
 */
export default function TariffChart({ points, currency, timeZone, ariaLabel, selectedIndex, onSelect }: TariffChartProps) {
  const [hover, setHover] = useState<number | null>(null)
  const prices = points.map((point) => point.price).filter((price): price is number => price !== null)
  if (prices.length === 0) return <p className={styles.empty}>Tariff not recorded for this window.</p>
  const max = Math.max(...prices)
  const min = Math.min(...prices)
  const top = max * 1.1 || 1
  const clock = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const hourOnly = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' })
  const day = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short' })
  const fmt = (value: number) => value.toLocaleString('en-GB', { minimumFractionDigits: 3, maximumFractionDigits: 4 })
  const labelEvery = points.length <= 12 ? 1 : points.length <= 30 ? 3 : 12
  const shown = hover ?? selectedIndex ?? null
  const active = shown !== null ? points[shown] : null
  const describe = (point: TariffChartPoint) =>
    `${clock.format(new Date(point.start))}–${hourOnly.format(new Date(point.start + HOUR))}:00 · ${point.price === null ? 'tariff not recorded' : `${fmt(point.price)} ${currency}/kWh${point.band ? ` · ${BAND_TEXT[point.band]}` : ''}`}`

  return (
    <figure className={styles.figure} aria-label={ariaLabel}>
      <p className={styles.readout} aria-live="polite">
        {active ? describe(active) : `Cheapest ${fmt(min)} · most expensive ${fmt(max)} ${currency}/kWh. Hover a bar for the exact price.`}
      </p>
      <div className={styles.body}>
        <div className={styles.yAxis} aria-hidden="true">
          <span>{fmt(max)}</span>
          <span>{currency}/kWh</span>
          <span>0</span>
        </div>
        <div className={styles.scroller} tabIndex={-1}>
          <div className={styles.plot} style={{ minWidth: `${points.length * 14}px` }}>
            <div className={styles.columns} onMouseLeave={() => setHover(null)}>
              {points.map((point, index) => (
                <button
                  key={point.start}
                  type="button"
                  className={`${styles.column}${index === shown ? ` ${styles.active}` : ''}`}
                  aria-label={describe(point)}
                  aria-pressed={onSelect ? index === selectedIndex : undefined}
                  onMouseEnter={() => setHover(index)}
                  onFocus={() => setHover(index)}
                  onBlur={() => setHover(null)}
                  onClick={() => onSelect?.(index)}
                >
                  <span
                    className={point.price === null ? styles.none : styles[`band_${point.band ?? 'mid'}`]}
                    style={{ height: point.price === null ? '100%' : `${(point.price / top) * 100}%` }}
                  />
                </button>
              ))}
            </div>
            <div className={styles.xAxis} aria-hidden="true">
              {points.map((point, index) => (
                <span key={point.start}>
                  {index % labelEvery === 0
                    ? (points.length > 24 && hourOnly.format(new Date(point.start)) === '00' ? day.format(new Date(point.start)) : hourOnly.format(new Date(point.start)))
                    : ''}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
      <figcaption className={styles.legend}>
        <span><i className={styles.band_peak} />Peak (expensive)</span>
        <span><i className={styles.band_mid} />Mid</span>
        <span><i className={styles.band_off} />Off-peak (cheap)</span>
        {points.some((point) => point.price === null) && <span><i className={styles.none} />Not recorded</span>}
        <span className={styles.zone}>Times in {timeZone}</span>
      </figcaption>
    </figure>
  )
}
