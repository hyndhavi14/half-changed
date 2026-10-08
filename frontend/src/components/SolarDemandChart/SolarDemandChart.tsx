import styles from './SolarDemandChart.module.css'

export interface SolarDemandPoint {
  start: number
  solarKw: number | null
  baselineKw: number
  optimizedKw: number
  band: 'peak' | 'mid' | 'off' | null
}

interface SolarDemandChartProps {
  points: SolarDemandPoint[]
  view: 'baseline' | 'optimized'
  timeZone: string
  ariaLabel: string
  selectedIndex?: number
  onSelect?: (index: number) => void
  /** Label for the solar series, e.g. "Solar available (simulated)" or "Modelled PV". */
  solarLabel: string
  /** Minimum px per hour column; long horizons scroll instead of shrinking. */
  minColumn?: number
}

const BAND_LABEL = { peak: 'peak tariff', mid: 'mid tariff', off: 'off-peak tariff' } as const

function niceMax(value: number): number {
  if (value <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const steps = [1, 2, 2.5, 5, 10]
  const step = steps.find((candidate) => candidate * magnitude >= value) ?? 10
  return step * magnitude
}

export default function SolarDemandChart({
  points, view, timeZone, ariaLabel, selectedIndex, onSelect, solarLabel, minColumn = 14,
}: SolarDemandChartProps) {
  const top = niceMax(Math.max(0, ...points.map((point) => Math.max(point.solarKw ?? 0, point.baselineKw, point.optimizedKw))) * 1.05)
  const clock = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' })
  const day = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short' })
  const multiDay = points.length > 24
  const labelEvery = points.length <= 12 ? 1 : points.length <= 30 ? 3 : 12
  const hasSolar = points.some((point) => point.solarKw !== null)
  const hasBands = points.some((point) => point.band !== null)
  const fmt = (value: number) => value.toLocaleString('en-IN', { maximumFractionDigits: 1 })

  return (
    <figure className={styles.figure} aria-label={ariaLabel}>
      <div className={styles.body}>
        <div className={styles.yAxis} aria-hidden="true">
          <span>{fmt(top)} kW</span>
          <span>{fmt(top / 2)}</span>
          <span>0</span>
        </div>
        <div className={styles.scroller} tabIndex={0} role="region" aria-label={`${ariaLabel}, scrollable`}>
          <div className={styles.plot} style={{ minWidth: `${points.length * minColumn}px` }}>
            <div className={styles.columns}>
              {points.map((point, index) => {
                const demand = view === 'baseline' ? point.baselineKw : point.optimizedKw
                const solar = point.solarKw ?? 0
                const fromSolar = Math.min(solar, demand)
                const fromGrid = Math.max(0, demand - fromSolar)
                const surplus = point.solarKw !== null && solar - demand > top * 0.05
                const time = `${multiDay ? `${day.format(new Date(point.start))} ` : ''}${clock.format(new Date(point.start))}:00`
                const description = `${time}: ${point.solarKw === null ? 'solar not available' : `solar ${fmt(solar)} kW`}, demand ${fmt(demand)} kW${point.band ? `, ${BAND_LABEL[point.band]}` : ''}`
                const inner = (
                  <>
                    {point.solarKw !== null && <span className={styles.solar} style={{ height: `${(solar / top) * 100}%` }} />}
                    <span className={styles.fromSolar} style={{ height: `${(fromSolar / top) * 100}%` }} />
                    <span className={styles.fromGrid} style={{ bottom: `${(fromSolar / top) * 100}%`, height: `${(fromGrid / top) * 100}%` }} />
                  </>
                )
                const className = `${styles.column}${surplus ? ` ${styles.surplus}` : ''}${index === selectedIndex ? ` ${styles.selected}` : ''}`
                return onSelect ? (
                  <button key={point.start} type="button" className={className} aria-label={description} aria-pressed={index === selectedIndex} onClick={() => onSelect(index)}>
                    {inner}
                  </button>
                ) : (
                  <span key={point.start} className={className} title={description}>{inner}</span>
                )
              })}
            </div>
            {hasBands && (
              <div className={styles.bands} aria-hidden="true">
                {points.map((point) => <span key={point.start} className={point.band ? styles[`band_${point.band}`] : styles.band_none} />)}
              </div>
            )}
            <div className={styles.xAxis} aria-hidden="true">
              {points.map((point, index) => (
                <span key={point.start}>
                  {index % labelEvery === 0
                    ? `${multiDay && clock.format(new Date(point.start)) === '00' ? day.format(new Date(point.start)) : clock.format(new Date(point.start))}`
                    : ''}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
      <figcaption className={styles.legend}>
        <span><i className={styles.keySolar} />{solarLabel}</span>
        <span><i className={styles.keyFromSolar} />Demand met by solar</span>
        <span><i className={styles.keyFromGrid} />Demand from grid</span>
        {hasBands && <span><i className={styles.keyPeak} />Peak</span>}
        {hasBands && <span><i className={styles.keyMid} />Mid</span>}
        {hasBands && <span><i className={styles.keyOff} />Off-peak tariff</span>}
        {!hasSolar && <strong>Solar data not available for this window.</strong>}
      </figcaption>
    </figure>
  )
}
