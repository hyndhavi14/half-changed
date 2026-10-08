import { useState } from 'react'
import Button from '../../components/Button/Button'
import Card from '../../components/Card/Card'
import GanttRow from '../../components/GanttRow/GanttRow'
import Legend from '../../components/Legend/Legend'
import PageHeader from '../../components/PageHeader/PageHeader'
import ProvenanceTag from '../../components/ProvenanceTag/ProvenanceTag'
import SegmentedToggle from '../../components/SegmentedToggle/SegmentedToggle'
import StatTile from '../../components/StatTile/StatTile'
import StatusChip from '../../components/StatusChip/StatusChip'
import { useFactory } from '../../context/useFactory'
import type { BackendFactoryData } from '../../data/backendApi'
import { scheduleKind, type StoredSchedule } from '../../data/backendView'
import { PROVENANCE_LABEL, type Provenance } from '../../data/provenance'
import { PROCESS_COLOR_KEYS } from '../../data/scheduleView'
import type { ScheduleColorKey } from '../../data/types'
import {
  NOT_AVAILABLE,
  horizonSegments,
  tariffWindows,
  type BandSegment,
} from '../DashboardPage/dashboardView'
import styles from './SchedulePage.module.css'
import {
  allEntriesPlanned,
  generationSegments,
  machineRows,
  rulerLabels,
  runDetails,
  scheduleComparability,
  shiftRows,
  summaryTiles,
  tariffCurrencyNote,
  tariffSampleCount,
} from './schedulePageView'

const VERSION_OPTIONS = [
  { value: 'baseline', label: 'Baseline' },
  { value: 'optimized', label: 'Optimized' },
]

const LEGACY_COLOR_KEYS: ScheduleColorKey[] = ['roast', 'grind', 'conche', 'temper', 'mould', 'pack']
const CHANGE_STATUS = {
  'Moved out of peak price': 'Saved',
  'Moved into peak price': 'Peak',
  'Moved into generation hours': 'Solar',
  Retimed: 'Idle',
} as const

function provenanceFor(label: string): Provenance | undefined {
  const match = (Object.entries(PROVENANCE_LABEL) as Array<[string, string]>)
    .find(([, text]) => text.toLowerCase() === label.toLowerCase())
  return match ? (match[0] as Provenance) : undefined
}

function displayHorizonTime(value: string, timeZone: string): string {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return NOT_AVAILABLE
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone,
      dateStyle: 'medium',
      timeStyle: 'short',
      hourCycle: 'h23',
    }).format(new Date(timestamp))
  } catch {
    return NOT_AVAILABLE
  }
}

function BandStrip({ segments, label }: { segments: BandSegment[]; label: string }) {
  if (segments.length === 0) return null
  return (
    <div className={styles.bandStrip} role="img" aria-label={label}>
      {segments.map((segment) => (
        <span
          key={`${segment.band}-${segment.startFraction}`}
          className={`${styles.band} ${styles[`band_${segment.band}`]}`}
          style={{
            left: `${segment.startFraction * 100}%`,
            width: `${(segment.endFraction - segment.startFraction) * 100}%`,
          }}
        />
      ))}
    </div>
  )
}

function Timeline({
  data,
  schedule,
  baseline,
}: {
  data: BackendFactoryData
  schedule: StoredSchedule
  baseline: StoredSchedule | undefined
}) {
  const start = Date.parse(schedule.horizonStart)
  const end = Date.parse(schedule.horizonEnd)
  const validHorizon = Number.isFinite(start) && Number.isFinite(end) && end > start
  const segments = validHorizon
    ? horizonSegments(
      tariffWindows(data.tariffs),
      start,
      end,
      data.factory.timezone,
      tariffSampleCount(schedule),
    )
    : []
  const generation = generationSegments(data.energy, schedule, data.factory.timezone)
  const rows = machineRows(data, schedule, baseline)
  const details = runDetails(data, schedule)
  const noValidEntries = rows.every((row) => row.blocks.length === 0)
  const hasMid = segments.some((segment) => segment.band === 'mid')
  const tariffCurrency = tariffCurrencyNote(data)
  const changes = [
    { label: 'Peak price', color: 'var(--band-peak)', shape: 'square' as const },
    ...(hasMid ? [{ label: 'Mid price', color: 'var(--band-mid)', shape: 'square' as const }] : []),
    ...(generation.segments.length > 0
      ? [{ label: `Generation recorded (${generation.source})`, color: 'var(--process-sun)', shape: 'square' as const }]
      : []),
    { label: 'Start differs from baseline', color: 'var(--espresso)', shape: 'dashed' as const },
  ]
  const displayBlocks = (blocks: ReturnType<typeof machineRows>[number]['blocks']) =>
    blocks.map((block) => ({
      id: block.id,
      processName: block.processName,
      machineId: block.machineId,
      start: block.startHour,
      end: block.endHour,
      colorKey: LEGACY_COLOR_KEYS[block.colorIndex % LEGACY_COLOR_KEYS.length],
      processColor: PROCESS_COLOR_KEYS[block.colorIndex % PROCESS_COLOR_KEYS.length],
      shifted: block.shifted,
      tooltip: block.tooltip,
      leftFraction: block.leftFraction,
      widthFraction: block.widthFraction,
    }))

  return (
    <>
      <p className={styles.horizon}>
        {validHorizon
          ? `${displayHorizonTime(schedule.horizonStart, data.factory.timezone)} – ${displayHorizonTime(schedule.horizonEnd, data.factory.timezone)} (${data.factory.timezone})`
          : `Not available (${data.factory.timezone})`}
      </p>
      <p className={styles.runMeta}>
        {details.lines.join(' · ')}
      </p>
      {details.warnings.length > 0 && (
        <details className={styles.warnings}>
          <summary>Optimizer warnings ({details.warnings.length})</summary>
          <ul>
            {details.warnings.map((warning) => <li key={warning}>{warning}</li>)}
          </ul>
        </details>
      )}
      <Legend items={changes} />
      {tariffCurrency && <p className={styles.mutedNote}>{tariffCurrency}</p>}
      {generation.segments.length === 0 && (
        <p className={styles.mutedNote}>No generation readings fall inside this schedule horizon.</p>
      )}
      <div className={styles.timelineScroller}>
        <div className={styles.timelineInner}>
          <div className={styles.stripRow}>
            <strong className={styles.stripLabel}>Energy price</strong>
            <div className={styles.stripTrack}>
              <BandStrip
                segments={segments}
                label="Configured tariff windows across the schedule horizon"
              />
            </div>
          </div>
          {generation.segments.length > 0 && (
            <div className={styles.stripRow}>
              <strong className={styles.stripLabel}>Generation</strong>
              <div className={`${styles.stripTrack} ${styles.genTrack}`} role="img" aria-label={`Hours with recorded generation (${generation.source})`}>
                {generation.segments.map((segment) => (
                  <span
                    key={`generation-${segment.startFraction}`}
                    className={styles.genSegment}
                    style={{
                      left: `${segment.startFraction * 100}%`,
                      width: `${(segment.endFraction - segment.startFraction) * 100}%`,
                    }}
                  />
                ))}
              </div>
            </div>
          )}
          <div className={styles.ruler} aria-hidden="true">
            {rulerLabels(schedule, data.factory.timezone, 7).map((label, index) => (
              <span key={index}>{label}</span>
            ))}
          </div>
          <div className={styles.machineRows}>
            {rows.map((row) => (
              <GanttRow
                key={row.machineId}
                label={row.name}
                sublabel={row.sublabel}
                blocks={displayBlocks(row.blocks)}
                height={44}
                autoLanes
              />
            ))}
            {noValidEntries && <p>No valid persisted schedule entries are available.</p>}
          </div>
        </div>
      </div>
    </>
  )
}

export default function SchedulePage() {
  const { backendData, loading, error, runOptimization, optimizing, optimizationError } = useFactory()
  const [scheduleId, setScheduleId] = useState('')
  if (!backendData) {
    return <PageHeader eyebrow={loading ? 'Loading persisted factory data' : 'Factory data unavailable'} title={error ?? 'No factory selected'} />
  }

  const data = backendData
  const schedules = data.schedules
  const initial = schedules.find((schedule) => scheduleKind(schedule) === 'optimized') ?? schedules[0]
  const selected = schedules.find((schedule) => schedule.id === scheduleId) ?? initial
  const baseline = schedules.find((schedule) => scheduleKind(schedule) === 'baseline')
  const optimized = schedules.find((schedule) => scheduleKind(schedule) === 'optimized')
  const shifted = baseline && optimized ? shiftRows(data, baseline, optimized) : []
  const comparable = baseline && optimized
    ? scheduleComparability(baseline, optimized)
    : null
  const tiles = selected ? summaryTiles(data, selected, baseline, optimized) : []
  const modeled = provenanceFor('Modeled')
  const planned = provenanceFor('Planned')

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow={`${data.factory.name} · ${data.factory.timezone}`}
        title="Production schedule"
        actions={
          <SegmentedToggle
            options={VERSION_OPTIONS}
            value={selected ? scheduleKind(selected) ?? 'optimized' : 'optimized'}
            onChange={(value) => {
              const next = schedules.find((schedule) => scheduleKind(schedule) === value)
              if (next) setScheduleId(next.id)
            }}
            ariaLabel="Schedule version"
          />
        }
      />

      {(schedules.length > 2 || schedules.some((schedule) => scheduleKind(schedule) === null)) && (
        <Card title="Select a persisted schedule">
          <label className={styles.scheduleSelect} htmlFor="persisted-schedule">
            Schedule
            <select
              id="persisted-schedule"
              value={selected?.id ?? ''}
              onChange={(event) => setScheduleId(event.currentTarget.value)}
            >
              {schedules.map((schedule) => (
                <option key={schedule.id} value={schedule.id}>
                  {scheduleKind(schedule) === 'optimized' ? 'Optimized' : scheduleKind(schedule) === 'baseline' ? 'Baseline' : schedule.name}
                  {' '}· {schedule.name}
                </option>
              ))}
            </select>
          </label>
        </Card>
      )}

      <section className={styles.summaryGrid} aria-label="Persisted schedule summary">
        {tiles.map((item) => {
          const provenance = item.key === 'shifted'
            ? planned
            : item.value !== NOT_AVAILABLE
              ? modeled
              : undefined
          return (
            <StatTile
              key={item.key}
              label={item.label}
              value={item.value}
              sub={item.sub}
              provenance={provenance ? <ProvenanceTag provenance={provenance} /> : undefined}
            />
          )
        })}
      </section>

      {comparable && !comparable.comparable && (
        <p role="note" className={styles.comparabilityNote}>
          Baseline and optimized are not directly comparable: {comparable.reasons.join('; ')}.
        </p>
      )}

      <Card
        title={selected
          ? `${scheduleKind(selected) === 'optimized' ? 'Optimized' : scheduleKind(selected) === 'baseline' ? 'Baseline' : selected.name} timeline`
          : 'Persisted schedule timeline'}
        provenance={selected && planned && allEntriesPlanned(selected) === true
          ? <ProvenanceTag provenance={planned} />
          : undefined}
      >
        {selected ? (
          <Timeline data={data} schedule={selected} baseline={baseline} />
        ) : (
          <div className={styles.emptySchedule}>
            <p>No persisted schedules are available for this factory.</p>
            <Button variant="primary" isLoading={optimizing} onClick={() => void runOptimization()}>
              Run optimization
            </Button>
          </div>
        )}
      </Card>

      {optimizationError && (
        <Card title="Optimization failed">
          <p className={styles.optimizationError} role="alert">{optimizationError}</p>
          <Button variant="primary" isLoading={optimizing} onClick={() => void runOptimization()}>
            Try again
          </Button>
        </Card>
      )}

      <Card
        title="Shifted processes"
        provenance={modeled ? <ProvenanceTag provenance={modeled} /> : undefined}
      >
        {shifted.length ? (
          <>
            <p className={styles.mutedNote}>
              Observed change compares the tariff band and recorded generation at the baseline and optimized start times. It is not a reason recorded by the optimizer. Entry cost change uses persisted per-entry cost.
            </p>
            <div className={styles.tableScroller}>
              <table className={styles.shiftTable}>
                <thead>
                  <tr>
                    <th scope="col">Process</th>
                    <th scope="col">Machine</th>
                    <th scope="col">Baseline window</th>
                    <th scope="col">Optimized window</th>
                    <th scope="col">Observed change</th>
                    <th scope="col">Entry cost change</th>
                  </tr>
                </thead>
                <tbody>
                  {shifted.map((row) => (
                    <tr key={row.id}>
                      <th scope="row">{row.process}</th>
                      <td>{row.machine}</td>
                      <td className={styles.was}>{row.was}</td>
                      <td className={styles.now}>{row.now}</td>
                      <td>
                        <StatusChip status={CHANGE_STATUS[row.change]}>{row.change}</StatusChip>
                      </td>
                      <td>{row.costText}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : baseline && optimized ? (
          <p>No process timing changes are present between the persisted schedules.</p>
        ) : (
          <p>{data.schedules.length >= 2
            ? 'No process timing changes are present between the persisted schedules.'
            : 'A persisted baseline and optimized schedule pair is required to compare process timings.'}</p>
        )}
        {baseline && optimized && comparable && (
          <p className={styles.mutedNote}>{comparable.notChecked}</p>
        )}
      </Card>
    </div>
  )
}
