import Card from '../../components/Card/Card'
import CompareCard from '../../components/CompareCard/CompareCard'
import GanttRow from '../../components/GanttRow/GanttRow'
import Legend from '../../components/Legend/Legend'
import PageHeader from '../../components/PageHeader/PageHeader'
import ProvenanceTag from '../../components/ProvenanceTag/ProvenanceTag'
import StatusChip from '../../components/StatusChip/StatusChip'
import { useFactory } from '../../context/useFactory'
import { findStoredSchedule } from '../../data/backendView'
import { PROCESS_COLOR_KEYS, type ProcessColorKey } from '../../data/scheduleView'
import type { ScheduleBlock, ScheduleColorKey } from '../../data/types'
import { compareMetrics, horizonSegments, tariffWindows, type GanttBlockView } from '../DashboardPage/dashboardView'
import { rulerLabels, runDetails, scheduleComparability, shiftRows } from '../SchedulePage/schedulePageView'
import { objectiveText, requestObjective, sharedWindow, timelineBlocks } from './comparePageView'
import styles from './ComparePage.module.css'

const LEGACY_COLOR_KEYS: ScheduleColorKey[] = ['roast', 'grind', 'conche', 'temper', 'mould', 'pack']
const CHANGE_STATUS = {
  'Moved out of peak price': 'Saved',
  'Moved into peak price': 'Peak',
  'Moved into generation hours': 'Solar',
  Retimed: 'Idle',
} as const

type Block = ScheduleBlock & { processColor: ProcessColorKey; tooltip: string; leftFraction: number; widthFraction: number }

function toBlocks(blocks: GanttBlockView[]): Block[] {
  return blocks.map((block) => ({
    id: block.id,
    processName: block.processName,
    machineId: block.machineId,
    start: block.startHour,
    end: block.endHour,
    colorKey: LEGACY_COLOR_KEYS[block.colorIndex % LEGACY_COLOR_KEYS.length],
    shifted: block.shifted,
    processColor: PROCESS_COLOR_KEYS[block.colorIndex % PROCESS_COLOR_KEYS.length],
    tooltip: block.tooltip,
    leftFraction: block.leftFraction,
    widthFraction: block.widthFraction,
  }))
}

export default function ComparePage() {
  const { backendData, loading, error } = useFactory()
  if (!backendData) {
    return <PageHeader eyebrow={loading ? 'Loading persisted factory data' : 'Factory data unavailable'} title={error ?? 'No factory selected'} />
  }

  const data = backendData
  const timeZone = data.factory.timezone
  const baseline = findStoredSchedule(data, 'baseline')
  const optimized = findStoredSchedule(data, 'optimized')
  const modeledTag = <ProvenanceTag provenance="modeled" />

  if (!baseline || !optimized) {
    return (
      <div className={styles.page}>
        <PageHeader eyebrow={`${data.factory.name} · ${timeZone}`} title="Baseline vs optimized" />
        <Card title="Persisted schedules unavailable">
          <p className={styles.note}>A persisted baseline and optimized schedule pair is required to compare factory schedules. Run optimization to create one.</p>
        </Card>
      </div>
    )
  }

  const metrics = compareMetrics(baseline, optimized, data.factory.currency)
  const comparability = scheduleComparability(baseline, optimized)
  const window = sharedWindow(baseline, optimized)
  const ticks = rulerLabels(window, timeZone, 7)
  const windowHours = (Date.parse(window.horizonEnd) - Date.parse(window.horizonStart)) / 3_600_000
  const segments = horizonSegments(
    tariffWindows(data.tariffs),
    Date.parse(window.horizonStart),
    Date.parse(window.horizonEnd),
    timeZone,
    Math.min(2016, Math.max(96, Math.ceil(windowHours * 4))),
  )
  const run = runDetails(data, optimized)
  const objective = objectiveText(requestObjective(data, optimized))
  const shifted = shiftRows(data, baseline, optimized)

  return (
    <div className={styles.page}>
      <PageHeader eyebrow={`${data.factory.name} · ${timeZone}`} title="Baseline vs optimized" />

      {!comparability.comparable && (
        <p role="note" className={styles.comparabilityNote}>
          Baseline and optimized are not directly comparable: {comparability.reasons.join('; ')}.
        </p>
      )}

      {metrics.length ? (
        <CompareCard compare={metrics} provenance={modeledTag} />
      ) : (
        <Card title="Baseline vs optimized">
          <p className={styles.note}>Stored totals are not available for both schedules, so no numeric comparison is shown.</p>
        </Card>
      )}

      <Card title="Schedule timelines" provenance={<ProvenanceTag provenance="planned" />}>
        <p className={styles.note}>{objective}</p>
        <p className={styles.note}>{run.lines[run.lines.length - 1]}</p>
        <Legend
          items={[
            { label: 'Peak price', color: 'var(--band-peak)', shape: 'square' },
            { label: 'Mid price', color: 'var(--band-mid)', shape: 'square' },
            { label: 'Start differs from baseline', color: 'var(--espresso)', shape: 'dashed' },
          ]}
        />
        <div className={styles.timelineScroller}>
          <div className={styles.timelineInner}>
            <div className={styles.stripRow}>
              <span className={styles.stripLabel}>Energy price</span>
              <div className={styles.bandStrip} role="img" aria-label="Configured tariff windows across the shown window">
                {segments.map((segment) => (
                  <span
                    key={`${segment.band}-${segment.startFraction}`}
                    className={`${styles.band} ${styles[`band_${segment.band}`] ?? ''}`}
                    style={{ left: `${segment.startFraction * 100}%`, width: `${(segment.endFraction - segment.startFraction) * 100}%` }}
                  />
                ))}
              </div>
            </div>
            <div className={styles.timeAxis} aria-hidden="true">
              {ticks.map((tick, index) => <span key={`${tick}-${index}`}>{tick}</span>)}
            </div>
            <GanttRow label="Baseline" blocks={toBlocks(timelineBlocks(data, baseline, window, undefined))} autoLanes />
            <GanttRow label="Optimized" blocks={toBlocks(timelineBlocks(data, optimized, window, baseline))} autoLanes />
          </div>
        </div>
        <p className={styles.note}>Both rows share one time axis ({timeZone}) covering the work in either schedule.</p>
      </Card>

      <Card title="Shifted processes" provenance={modeledTag}>
        <p className={styles.note}>
          Observed change compares the tariff band and recorded generation at the baseline and optimized start times. It is not a reason recorded by the optimizer. Entry cost change uses persisted per-entry cost.
        </p>
        <div className={styles.tableScroller}>
          <table className={styles.shiftTable}>
            <caption className={styles.visuallyHidden}>
              Process timing differences between the persisted baseline and optimized schedules
            </caption>
            <thead>
              <tr>
                <th scope="col">Process</th>
                <th scope="col">Machine</th>
                <th scope="col">Was</th>
                <th scope="col">Now</th>
                <th scope="col">Observed change</th>
                <th scope="col">Entry cost change</th>
              </tr>
            </thead>
            <tbody>
              {shifted.map((row) => (
                <tr key={row.id}>
                  <th scope="row">{row.process}</th>
                  <td>{row.machine}</td>
                  <td className={styles.windowCell}>{row.was}</td>
                  <td className={styles.windowCell}>{row.now}</td>
                  <td><StatusChip status={CHANGE_STATUS[row.change]}>{row.change}</StatusChip></td>
                  <td>{row.costText}</td>
                </tr>
              ))}
              {shifted.length === 0 && (
                <tr>
                  <td className={styles.noShifts} colSpan={6}>No process timing changes are present between the persisted schedules.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className={styles.note}>{comparability.notChecked}</p>
      </Card>
    </div>
  )
}
