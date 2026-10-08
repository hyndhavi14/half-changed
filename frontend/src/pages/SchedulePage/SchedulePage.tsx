import { useMemo, useState } from 'react'
import Button from '../../components/Button/Button'
import Card from '../../components/Card/Card'
import GanttRow from '../../components/GanttRow/GanttRow'
import Legend from '../../components/Legend/Legend'
import PageHeader from '../../components/PageHeader/PageHeader'
import SegmentedToggle from '../../components/SegmentedToggle/SegmentedToggle'
import StatTile from '../../components/StatTile/StatTile'
import { useFactory } from '../../context/useFactory'
import type { BackendFactoryData } from '../../data/backendApi'
import { displayTimestamp, displayValue, machineName, processName, scheduleKind, type StoredSchedule } from '../../data/backendView'
import type { ScheduleBlock } from '../../data/types'
import styles from './SchedulePage.module.css'

const VERSION_OPTIONS = [
  { value: 'baseline', label: 'Baseline' },
  { value: 'optimized', label: 'Optimized' },
]

function clockAtFraction(schedule: StoredSchedule, fraction: number, timeZone: string) {
  const start = Date.parse(schedule.horizonStart)
  const end = Date.parse(schedule.horizonEnd)
  const date = new Date(start + (end - start) * fraction)
  if (!Number.isFinite(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

function blocksForSchedule(data: BackendFactoryData, schedule: StoredSchedule): ScheduleBlock[] {
  const horizonStart = Date.parse(schedule.horizonStart)
  const horizonEnd = Date.parse(schedule.horizonEnd)
  const horizonDuration = horizonEnd - horizonStart
  if (!Number.isFinite(horizonDuration) || horizonDuration <= 0) return []

  const baseline = data.schedules.find((item) => scheduleKind(item) === 'baseline')
  const baselineStartByProcess = new Map(
    baseline?.entries.map((entry) => [entry.processId, Date.parse(entry.startsAt)]) ?? [],
  )
  const colorKeys: ScheduleBlock['colorKey'][] = ['roast', 'grind', 'conche', 'temper', 'mould', 'pack']

  return schedule.entries.flatMap((entry, index) => {
    const start = Date.parse(entry.startsAt)
    const end = Date.parse(entry.endsAt)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return []
    const left = ((start - horizonStart) / horizonDuration) * 24
    const right = ((end - horizonStart) / horizonDuration) * 24
    if (right <= 0 || left >= 24) return []
    const baselineStart = baselineStartByProcess.get(entry.processId)
    return [{
      id: entry.id,
      processName: processName(data, entry.processId),
      machineId: entry.machineId,
      start: Math.max(0, left),
      end: Math.min(24, right),
      colorKey: colorKeys[index % colorKeys.length],
      shifted: baselineStart !== undefined && baselineStart !== start,
    }]
  })
}

function Timeline({
  data,
  schedule,
}: {
  data: BackendFactoryData
  schedule: StoredSchedule
}) {
  const blocksByMachine = useMemo(() => {
    const grouped = new Map<string, ScheduleBlock[]>()
    for (const block of blocksForSchedule(data, schedule)) {
      grouped.set(block.machineId, [...(grouped.get(block.machineId) ?? []), block])
    }
    return grouped
  }, [data, schedule])

  return (
    <div className={styles.timelineScroller}>
      <div className={styles.timelineInner}>
        <div className={styles.ruler} aria-hidden="true">
          {[0, 1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6].map((fraction) => (
            <span key={fraction}>{clockAtFraction(schedule, fraction, data.factory.timezone)}</span>
          ))}
          <span>{clockAtFraction(schedule, 1, data.factory.timezone)}</span>
        </div>
        <div className={styles.machineRows}>
          {[...blocksByMachine].map(([machineId, blocks]) => (
            <GanttRow
              key={machineId}
              label={machineName(data, machineId)}
              sublabel={`${blocks.length} scheduled ${blocks.length === 1 ? 'process' : 'processes'}`}
              blocks={blocks}
              height={44}
              autoLanes
            />
          ))}
          {blocksByMachine.size === 0 && <p>No valid persisted schedule entries are available.</p>}
        </div>
      </div>
    </div>
  )
}

function changedProcessRows(data: BackendFactoryData) {
  const baseline = data.schedules.find((schedule) => scheduleKind(schedule) === 'baseline')
  const optimized = data.schedules.find((schedule) => scheduleKind(schedule) === 'optimized')
  if (!baseline || !optimized) return []

  const baselineEntries = new Map(baseline.entries.map((entry) => [entry.processId, entry]))
  return optimized.entries.flatMap((entry) => {
    const previous = baselineEntries.get(entry.processId)
    if (!previous || previous.startsAt === entry.startsAt && previous.endsAt === entry.endsAt) return []
    return [{
      id: entry.id,
      process: processName(data, entry.processId),
      machine: machineName(data, entry.machineId),
      was: `${displayTimestamp(previous.startsAt, data.factory.timezone)}–${displayTimestamp(previous.endsAt, data.factory.timezone)}`,
      now: `${displayTimestamp(entry.startsAt, data.factory.timezone)}–${displayTimestamp(entry.endsAt, data.factory.timezone)}`,
    }]
  })
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
  const selectedEntries = selected?.entries ?? []
  const shifted = changedProcessRows(data)
  const summary = selected ? [
    { label: 'Schedule status', value: selected.status },
    { label: 'Energy', value: displayValue(selected.totalEnergyKwh, ' kWh') },
    { label: 'Energy cost', value: displayValue(selected.totalEnergyCost, ` ${data.factory.currency}`) },
    { label: 'Scheduled processes', value: selectedEntries.length },
  ] : []

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow={data.factory.name}
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
        {summary.map((item) => <StatTile key={item.label} label={item.label} value={item.value} />)}
      </section>

      <Card title={selected ? `${scheduleKind(selected) === 'optimized' ? 'Optimized' : scheduleKind(selected) === 'baseline' ? 'Baseline' : selected.name} timeline` : 'Persisted schedule timeline'}>
        {selected ? (
          <>
            <p>
              {displayTimestamp(selected.horizonStart, data.factory.timezone)} – {displayTimestamp(selected.horizonEnd, data.factory.timezone)}
            </p>
            <Legend
              items={[
                { label: 'Persisted schedule entry', color: 'var(--caramel)', shape: 'square' },
                { label: 'Start differs from baseline', color: 'var(--teal)', shape: 'dashed' },
              ]}
            />
            <Timeline data={data} schedule={selected} />
          </>
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

      <Card title="Changed process timings">
        {shifted.length ? (
          <div className={styles.tableScroller}>
            <table className={styles.shiftTable}>
              <thead><tr><th scope="col">Process</th><th scope="col">Machine</th><th scope="col">Baseline window</th><th scope="col">Optimized window</th></tr></thead>
              <tbody>{shifted.map((row) => (
                <tr key={row.id}>
                  <th scope="row">{row.process}</th><td>{row.machine}</td><td className={styles.was}>{row.was}</td><td className={styles.now}>{row.now}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <p>{data.schedules.length >= 2 ? 'No process timing changes are present between the persisted schedules.' : 'A persisted baseline and optimized schedule pair is required to compare process timings.'}</p>}
      </Card>
    </div>
  )
}
