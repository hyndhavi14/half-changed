import { useState } from 'react'
import styles from './SolarDemandChart.module.css'

export interface SolarDemandPoint {
  start: number
  solarKw: number | null
  baselineKw: number
  optimizedKw: number
  band: 'peak' | 'mid' | 'off' | null
  price?: number | null
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
  /** Shown in the hover readout next to the price. */
  currency?: string
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
  points, view, timeZone, ariaLabel, selectedIndex, onSelect, solarLabel, minColumn = 14, currency,
}: SolarDemandChartProps) {
  const [hover, setHover] = useState<number | null>(null)
  const top = niceMax(Math.max(0, ...points.map((point) => Math.max(point.solarKw ?? 0, point.baselineKw, point.optimizedKw))) * 1.05)
  const clock = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' })
  const day = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short' })
  const multiDay = points.length > 24
  const labelEvery = points.length <= 12 ? 1 : points.length <= 30 ? 3 : 12
  const hasSolar = points.some((point) => point.solarKw !== null)
  const hasBands = points.some((point) => point.band !== null)
  const fmt = (value: number) => value.toLocaleString('en-IN', { maximumFractionDigits: 1 })

  const shown = hover ?? selectedIndex ?? null
  const active = shown !== null ? points[shown] : undefined
  const readout = (() => {
    if (!active) return 'Hover or select an hour to see exact values.'
    const demand = view === 'baseline' ? active.baselineKw : active.optimizedKw
    const solar = active.solarKw
    const grid = Math.max(0, demand - (solar ?? 0))
    const when = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(active.start))
    return `${when} · Solar ${solar === null ? 'not recorded' : `${fmt(solar)} kW`} · Demand ${fmt(demand)} kW · Grid import ${fmt(grid)} kW${active.price != null ? ` · ${active.price.toLocaleString('en-GB', { maximumFractionDigits: 4 })} ${currency ?? ''}/kWh` : ''}`
  })()

  return (
    <figure className={styles.figure} aria-label={ariaLabel}>
      <p className={styles.readout} aria-live="polite">{readout}</p>
      <div className={styles.body}>
        <div className={styles.yAxis} aria-hidden="true">
          <span>{fmt(top)} kW</span>
          <span>{fmt(top / 2)}</span>
          <span>0</span>
        </div>
        <div className={styles.scroller} tabIndex={0} role="region" aria-label={`${ariaLabel}, scrollable`}>
          <div className={styles.plot} style={{ minWidth: `${points.length * minColumn}px` }}>
            <div className={styles.columns} onMouseLeave={() => setHover(null)}>
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
                  <button key={point.start} type="button" className={className} aria-label={description} aria-pressed={index === selectedIndex} onClick={() => onSelect(index)} onMouseEnter={() => setHover(index)} onFocus={() => setHover(index)} onBlur={() => setHover(null)}>
                    {inner}
                  </button>
                ) : (
                  <span key={point.start} className={className} title={description} onMouseEnter={() => setHover(index)}>{inner}</span>
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
        <span><i className={styles.keyFromGrid} />Grid import (demand not covered by solar)</span>
        {hasBands && <span><i className={styles.keyPeak} />Peak</span>}
        {hasBands && <span><i className={styles.keyMid} />Mid</span>}
        {hasBands && <span><i className={styles.keyOff} />Off-peak tariff</span>}
        {!hasSolar && <strong>Solar data not available for this window.</strong>}
      </figcaption>
    </figure>
  )
}
