import { useState } from 'react'
import SegmentedToggle from '../SegmentedToggle/SegmentedToggle'
import styles from './ScheduleGantt.module.css'

export interface GanttBlockInput {
  id: string
  label: string
  start: number
  end: number
  moved: boolean
  powerKw: number | null
}

export interface GanttLaneInput {
  id: string
  code: string
  name: string
  baseline: GanttBlockInput[]
  optimized: GanttBlockInput[]
}

export interface GanttBand {
  band: 'peak' | 'mid' | 'off'
  startFraction: number
  endFraction: number
}

export type GanttMode = 'compare' | 'baseline' | 'optimized'

interface ScheduleGanttProps {
  lanes: GanttLaneInput[]
  window: { start: number; end: number }
  timeZone: string
  mode: GanttMode
  /** Tariff bands across the window, drawn as a strip above the lanes. */
  bands?: GanttBand[]
  /** A vertical marker, e.g. the planning-horizon end or the selected hour. */
  marker?: { at: number; label: string }
  ariaLabel: string
  compact?: boolean
  /** Starting zoom; '2' keeps one-hour blocks wide enough for their names. */
  initialZoom?: '1' | '2' | '4'
}

const HOUR_MS = 3_600_000
const ZOOMS = [
  { value: '1', label: 'Fit' },
  { value: '2', label: '2×' },
  { value: '4', label: '4×' },
]
const TICK_STEPS = [1, 2, 3, 6, 12, 24]

function pct(value: number, window: { start: number; end: number }): number {
  return ((value - window.start) / (window.end - window.start)) * 100
}

function tickLabels(window: { start: number; end: number }, timeZone: string, zoom: number) {
  const hours = (window.end - window.start) / HOUR_MS
  const multiDay = hours > 24
  const step = TICK_STEPS.find((candidate) => hours / candidate <= (multiDay ? 6 : 9) * zoom) ?? 24
  const day = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short' })
  const clock = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const ticks: Array<{ left: number; label: string }> = []
  for (let at = window.start; at <= window.end + 1; at += step * HOUR_MS) {
    const date = new Date(at)
    ticks.push({ left: pct(at, window), label: multiDay ? `${day.format(date)} ${clock.format(date)}` : clock.format(date) })
  }
  return ticks
}

function range(block: GanttBlockInput, timeZone: string): string {
  const clock = new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  return `${clock.format(new Date(block.start))}–${clock.format(new Date(block.end)).replace(/^\w+ /, '')}`
}

export default function ScheduleGantt({ lanes, window, timeZone, mode, bands, marker, ariaLabel, compact = false, initialZoom }: ScheduleGanttProps) {
  const hours = (window.end - window.start) / HOUR_MS
  const [zoom, setZoom] = useState<string>(initialZoom ?? (hours > 12 ? '2' : '1'))
  const zoomFactor = Number(zoom)
  const ticks = tickLabels(window, timeZone, zoomFactor)
  const trackMin = (compact ? 560 : 720) * zoomFactor
  const showBaseline = mode !== 'optimized'
  const showOptimized = mode !== 'baseline'

  return (
    <div className={styles.wrapper}>
      <div className={styles.toolbar}>
        <div className={styles.legend} aria-hidden="true">
          {showOptimized && <span><i className={styles.keyMoved} />Optimized · moved</span>}
          {showOptimized && <span><i className={styles.keyKept} />Optimized · unchanged</span>}
          {showBaseline && <span><i className={mode === 'baseline' ? styles.keyKept : styles.keyBaseline} />{mode === 'baseline' ? 'Baseline' : 'Baseline position'}</span>}
          {bands && bands.length > 0 && <span><i className={styles.keyPeak} />Peak tariff</span>}
        </div>
        <SegmentedToggle options={ZOOMS} value={zoom} onChange={setZoom} ariaLabel="Timeline zoom" />
      </div>
      <div className={styles.scroller} tabIndex={0} role="region" aria-label={`${ariaLabel}, scrollable`}>
        <div className={`${styles.grid} ${compact ? styles.compact : ''}`} style={{ minWidth: `calc(var(--gantt-label) + ${trackMin}px)` }}>
          <div className={styles.corner} />
          <div className={styles.axis}>
            {bands && bands.length > 0 && (
              <div className={styles.bandStrip} aria-hidden="true">
                {bands.map((band) => (
                  <span
                    key={`${band.band}-${band.startFraction}`}
                    className={styles[`band_${band.band}`]}
                    style={{ left: `${band.startFraction * 100}%`, width: `${(band.endFraction - band.startFraction) * 100}%` }}
                  />
                ))}
              </div>
            )}
            <div className={styles.ticks}>
              {ticks.map((tick) => (
                <span key={tick.left} style={{ left: `${tick.left}%` }}>{tick.label}</span>
              ))}
            </div>
          </div>
          {lanes.map((lane) => (
            <div className={styles.lane} key={lane.id}>
              <div className={styles.label}>
                <span className={styles.code}>{lane.code}</span>
                <span className={styles.name}>{lane.name}</span>
              </div>
              <div className={styles.track}>
                {ticks.map((tick) => <span key={tick.left} className={styles.gridLine} style={{ left: `${tick.left}%` }} />)}
                {marker && marker.at >= window.start && marker.at <= window.end && (
                  <span className={styles.marker} style={{ left: `${pct(marker.at, window)}%` }} title={marker.label} />
                )}
                {showBaseline && lane.baseline
                  .filter((block) => mode === 'baseline' || block.moved)
                  .map((block) => (
                    <span
                      key={`b-${block.id}`}
                      className={mode === 'baseline' ? `${styles.block} ${block.moved ? styles.willMove : styles.kept}` : styles.ghost}
                      style={{ left: `${pct(block.start, window)}%`, width: `${pct(block.end, window) - pct(block.start, window)}%` }}
                      title={`${block.label} · baseline ${range(block, timeZone)}${block.powerKw !== null ? ` · ${block.powerKw} kW` : ''}`}
                    >
                      {mode === 'baseline' && <span className={styles.blockLabel}>{block.label}</span>}
                    </span>
                  ))}
                {showOptimized && lane.optimized.map((block) => (
                  <span
                    key={`o-${block.id}`}
                    className={`${styles.block} ${block.moved ? styles.moved : styles.kept}`}
                    style={{ left: `${pct(block.start, window)}%`, width: `${pct(block.end, window) - pct(block.start, window)}%` }}
                    title={`${block.label} · optimized ${range(block, timeZone)}${block.powerKw !== null ? ` · ${block.powerKw} kW` : ''}${block.moved ? ' · moved' : ''}`}
                  >
                    <span className={styles.blockLabel}>{block.label}</span>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      {marker && <p className={styles.markerNote}><i className={styles.keyMarker} aria-hidden="true" />{marker.label}</p>}
    </div>
  )
}
