import { useState } from 'react'
import Button from '../../components/Button/Button'
import Card from '../../components/Card/Card'
import PageHeader from '../../components/PageHeader/PageHeader'
import ProvenanceTag from '../../components/ProvenanceTag/ProvenanceTag'
import ScheduleGantt, { type GanttMode } from '../../components/ScheduleGantt/ScheduleGantt'
import SegmentedToggle from '../../components/SegmentedToggle/SegmentedToggle'
import StatusChip from '../../components/StatusChip/StatusChip'
import { useFactory } from '../../context/useFactory'
import { formatDuration } from '../../data/format'
import { useFactoryInsight } from '../../data/useFactoryInsight'
import { runDetails, scheduleComparability } from './schedulePageView'
import styles from './SchedulePage.module.css'

const MODE_OPTIONS = [
  { value: 'compare', label: 'Baseline vs optimized' },
  { value: 'baseline', label: 'Baseline' },
  { value: 'optimized', label: 'Optimized' },
]

function clock(at: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(at))
}

function power(value: number | null): string {
  return value === null ? 'Not available' : `${value.toLocaleString('en-IN', { maximumFractionDigits: 1 })} kW`
}

export default function SchedulePage() {
  const { backendData, loading, error } = useFactory()
  if (!backendData) {
    return <PageHeader eyebrow={loading ? 'Loading factory data' : 'Factory data unavailable'} title={error ?? 'No factory selected'} />
  }
  return <ScheduleWorkspace key={backendData.factory.id} />
}

function ScheduleWorkspace() {
  const { backendData, runOptimization, optimizing, optimizationError } = useFactory()
  const data = backendData!
  const insight = useFactoryInsight(data)
  const { pair, timeZone } = insight
  const both = Boolean(pair.baseline && pair.optimized)
  const [mode, setMode] = useState<GanttMode>(both ? 'compare' : pair.optimized ? 'optimized' : 'baseline')
  const comparability = pair.baseline && pair.optimized ? scheduleComparability(pair.baseline, pair.optimized) : null
  const run = pair.optimized ? runDetails(data, pair.optimized) : null
  const horizonEnd = pair.optimized ? Date.parse(pair.optimized.horizonEnd) : pair.baseline ? Date.parse(pair.baseline.horizonEnd) : NaN
  const names = new Map(data.processes.map((process) => [process.id, process.name]))
  const labels = new Map(insight.labels.map((label) => [label.id, label.label]))
  const single = !both ? (pair.optimized ?? pair.baseline) : undefined

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow={`${data.factory.name} · ${timeZone}`}
        title="Production schedule"
        actions={both ? (
          <SegmentedToggle options={MODE_OPTIONS} value={mode} onChange={(value) => setMode(value as GanttMode)} ariaLabel="Schedule shown" />
        ) : undefined}
      />

      {optimizationError && (
        <Card title="Optimization failed">
          <p className={styles.optimizationError} role="alert">{optimizationError}</p>
          <Button variant="primary" isLoading={optimizing} onClick={() => void runOptimization()}>Try again</Button>
        </Card>
      )}

      <Card
        title={mode === 'compare' ? 'Baseline vs optimized timeline' : mode === 'baseline' ? 'Baseline timeline' : 'Optimized timeline'}
        provenance={insight.lanes.length ? <ProvenanceTag provenance="planned" label="Optimizer output" /> : undefined}
      >
        {insight.window && insight.lanes.length ? (
          <>
            <p className={styles.mutedNote}>
              {mode === 'compare'
                ? 'Solid blocks are the optimized plan. A dashed outline marks where a process ran in the baseline. Machine names come from this factory’s stored data.'
                : 'Machine names come from this factory’s stored data. Hover a block for its exact times and power.'}
            </p>
            <ScheduleGantt
              lanes={insight.lanes}
              window={insight.window}
              timeZone={timeZone}
              mode={both ? mode : pair.optimized ? 'optimized' : 'baseline'}
              bands={insight.bands}
              marker={Number.isFinite(horizonEnd) ? { at: horizonEnd, label: `Planning horizon ends ${clock(horizonEnd, timeZone)} (deadline)` } : undefined}
              ariaLabel={`${data.factory.name} schedule timeline`}
            />
          </>
        ) : (
          <div className={styles.emptySchedule}>
            <p>{data.factory.name} has no stored schedule yet.</p>
            <Button variant="primary" isLoading={optimizing} onClick={() => void runOptimization()}>Run optimization</Button>
          </div>
        )}
      </Card>

      {comparability && !comparability.comparable && (
        <p role="note" className={styles.comparabilityNote}>
          Baseline and optimized are not directly comparable: {comparability.reasons.join('; ')}.
        </p>
      )}

      {(both || single) && (
        <Card title="Schedule detail" provenance={<ProvenanceTag provenance="planned" label="Optimizer output" />}>
          <div className={styles.tableScroller} tabIndex={0} role="region" aria-label="Schedule detail table, scrollable">
            <table className={styles.shiftTable}>
              <caption className={styles.visuallyHidden}>Every scheduled process with machine, timing, duration, power and change</caption>
              <thead>
                <tr>
                  <th scope="col">Process</th>
                  <th scope="col">Machine</th>
                  {both && <th scope="col">Baseline</th>}
                  <th scope="col">{both ? 'Optimized' : 'Start – end'}</th>
                  <th scope="col">Duration</th>
                  <th scope="col">Power</th>
                  {both && <th scope="col">Change</th>}
                </tr>
              </thead>
              <tbody>
                {both && insight.moves.map((move) => (
                  <tr key={move.processId}>
                    <th scope="row">{move.processName}</th>
                    <td>{move.machineLabel}</td>
                    <td className={move.moved ? styles.was : undefined}>{clock(move.baselineStart, timeZone)} – {clock(move.baselineEnd, timeZone).replace(/^\w+ /, '')}</td>
                    <td className={styles.now}>{clock(move.optimizedStart, timeZone)} – {clock(move.optimizedEnd, timeZone).replace(/^\w+ /, '')}</td>
                    <td>{formatDuration((move.optimizedEnd - move.optimizedStart) / 60_000)}</td>
                    <td>{power(move.powerKw)}</td>
                    <td>
                      {move.moved
                        ? <StatusChip status="Running">{formatDuration(Math.abs(move.shiftMinutes))} {move.shiftMinutes > 0 ? 'later' : 'earlier'}</StatusChip>
                        : <StatusChip status="Idle">Unchanged</StatusChip>}
                    </td>
                  </tr>
                ))}
                {single && [...single.entries]
                  .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt))
                  .map((entry) => (
                    <tr key={entry.id}>
                      <th scope="row">{names.get(entry.processId) ?? 'Unknown process'}</th>
                      <td>{labels.get(entry.machineId) ?? 'Unknown machine'}</td>
                      <td className={styles.now}>{clock(Date.parse(entry.startsAt), timeZone)} – {clock(Date.parse(entry.endsAt), timeZone).replace(/^\w+ /, '')}</td>
                      <td>{formatDuration((Date.parse(entry.endsAt) - Date.parse(entry.startsAt)) / 60_000)}</td>
                      <td>{power(entry.powerKw)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {!both && <p className={styles.mutedNote}>Only one stored schedule exists, so there is nothing to compare yet.</p>}
        </Card>
      )}

      {run && (
        <details className={styles.runDetails}>
          <summary>Optimization run details</summary>
          <ul>
            {run.lines.map((line) => <li key={line}>{line}</li>)}
          </ul>
          {run.warnings.length > 0 && (
            <>
              <strong>Optimizer and integration notes</strong>
              <ul>
                {run.warnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            </>
          )}
          {comparability && <p>{comparability.notChecked}</p>}
        </details>
      )}
    </div>
  )
}
