import Card from '../../components/Card/Card'
import CompareCard from '../../components/CompareCard/CompareCard'
import GanttRow from '../../components/GanttRow/GanttRow'
import PageHeader from '../../components/PageHeader/PageHeader'
import { useFactory } from '../../context/useFactory'
import type { BackendFactoryData } from '../../data/backendApi'
import { displayTimestamp, displayValue, findStoredSchedule, machineName, processName } from '../../data/backendView'
import type { CompareMetric, ScheduleBlock } from '../../data/types'
import styles from './ComparePage.module.css'

function blocksForSchedule(data: BackendFactoryData, scheduleId: string): ScheduleBlock[] {
  const schedule = data.schedules.find((item) => item.id === scheduleId)
  if (!schedule) return []
  const horizonStart = Date.parse(schedule.horizonStart)
  const horizonEnd = Date.parse(schedule.horizonEnd)
  const duration = horizonEnd - horizonStart
  if (!Number.isFinite(duration) || duration <= 0) return []
  const baseline = findStoredSchedule(data, 'baseline')
  const baselineStarts = new Map(
    baseline?.entries.map((entry) => [entry.processId, Date.parse(entry.startsAt)]) ?? [],
  )
  const colorKeys: ScheduleBlock['colorKey'][] = ['roast', 'grind', 'conche', 'temper', 'mould', 'pack']

  return schedule.entries.flatMap((entry, index) => {
    const start = Date.parse(entry.startsAt)
    const end = Date.parse(entry.endsAt)
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return []
    const left = ((start - horizonStart) / duration) * 24
    const right = ((end - horizonStart) / duration) * 24
    if (right <= 0 || left >= 24) return []
    return [{
      id: entry.id,
      processName: processName(data, entry.processId),
      machineId: entry.machineId,
      start: Math.max(0, left),
      end: Math.min(24, right),
      colorKey: colorKeys[index % colorKeys.length],
      shifted: baselineStarts.has(entry.processId) && baselineStarts.get(entry.processId) !== start,
    }]
  })
}

function comparisonMetrics(data: BackendFactoryData): CompareMetric[] {
  const baseline = findStoredSchedule(data, 'baseline')
  const optimized = findStoredSchedule(data, 'optimized')
  if (!baseline || !optimized) return []

  const metrics: CompareMetric[] = []
  const append = (label: string, baselineValue: number | null, optimizedValue: number | null, unit: string) => {
    if (baselineValue === null || optimizedValue === null || baselineValue < 0 || optimizedValue < 0) return
    const largest = Math.max(baselineValue, optimizedValue)
    const baselinePct = largest === 0 ? 100 : (baselineValue / largest) * 100
    const optimizedPct = largest === 0 ? 100 : (optimizedValue / largest) * 100
    const change = baselineValue === 0
      ? (optimizedValue === 0 ? 'No change' : 'Baseline is zero')
      : `${((optimizedValue - baselineValue) / baselineValue * 100).toFixed(1)}%`
    metrics.push({
      label,
      baseline: `${displayValue(baselineValue)}${unit}`,
      optimized: `${displayValue(optimizedValue)}${unit}`,
      baselinePct,
      optimizedPct,
      change,
    })
  }
  append('Total energy', baseline.totalEnergyKwh, optimized.totalEnergyKwh, ' kWh')
  append(`Energy cost (${data.factory.currency})`, baseline.totalEnergyCost, optimized.totalEnergyCost, '')
  return metrics
}

function changedRows(data: BackendFactoryData) {
  const baseline = findStoredSchedule(data, 'baseline')
  const optimized = findStoredSchedule(data, 'optimized')
  if (!baseline || !optimized) return []
  const baselineEntries = new Map(baseline.entries.map((entry) => [entry.processId, entry]))
  return optimized.entries.flatMap((entry) => {
    const previous = baselineEntries.get(entry.processId)
    if (!previous || (previous.startsAt === entry.startsAt && previous.endsAt === entry.endsAt)) return []
    return [{
      id: entry.id,
      process: processName(data, entry.processId),
      machine: machineName(data, entry.machineId),
      was: `${displayTimestamp(previous.startsAt, data.factory.timezone)}–${displayTimestamp(previous.endsAt, data.factory.timezone)}`,
      now: `${displayTimestamp(entry.startsAt, data.factory.timezone)}–${displayTimestamp(entry.endsAt, data.factory.timezone)}`,
    }]
  })
}

export default function ComparePage() {
  const { backendData, loading, error } = useFactory()
  if (!backendData) {
    return <PageHeader eyebrow={loading ? 'Loading persisted factory data' : 'Factory data unavailable'} title={error ?? 'No factory selected'} />
  }

  const data = backendData
  const baseline = findStoredSchedule(data, 'baseline')
  const optimized = findStoredSchedule(data, 'optimized')
  const metrics = comparisonMetrics(data)
  const changed = changedRows(data)

  return (
    <div className={styles.page}>
      <PageHeader eyebrow={data.factory.name} title="Baseline vs optimized" />

      {baseline && optimized ? (
        <>
          {metrics.length ? (
            <CompareCard compare={metrics} />
          ) : (
            <Card title="Persisted schedule comparison">
              <p>Stored totals are not available for both schedules, so no numeric comparison is shown.</p>
            </Card>
          )}

          <Card title="Schedule timelines">
            <p>Each timeline is scaled to its persisted schedule horizon.</p>
            <div className={styles.timelineScroller}>
              <div className={styles.timelineInner}>
                <div className={styles.timeAxis} aria-hidden="true">
                  {['0%', '12.5%', '25%', '37.5%', '50%', '62.5%', '75%', '87.5%', '100%'].map((time) => (
                    <span key={time}>{time}</span>
                  ))}
                </div>
                <GanttRow
                  label="Baseline"
                  blocks={blocksForSchedule(data, baseline.id)}
                  autoLanes
                />
                <GanttRow
                  label="Optimized"
                  blocks={blocksForSchedule(data, optimized.id)}
                  autoLanes
                />
              </div>
            </div>
          </Card>

          <Card title="Changed process timings">
            <div className={styles.tableScroller}>
              <table className={styles.shiftTable}>
                <caption className={styles.visuallyHidden}>
                  Process timing differences between persisted baseline and optimized schedules
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Process</th>
                    <th scope="col">Machine</th>
                    <th scope="col">Baseline window</th>
                    <th scope="col">Optimized window</th>
                    <th scope="col">Difference</th>
                  </tr>
                </thead>
                <tbody>
                  {changed.map((row) => (
                    <tr key={row.id}>
                      <th scope="row">{row.process}</th>
                      <td>{row.machine}</td>
                      <td className={styles.was}>{row.was}</td>
                      <td className={styles.now}>{row.now}</td>
                      <td>Timing changed</td>
                    </tr>
                  ))}
                  {changed.length === 0 && (
                    <tr><td className={styles.noShifts} colSpan={5}>No process timing changes are present.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : (
        <Card title="Persisted schedules unavailable">
          <p>A persisted baseline and optimized schedule pair is required to compare factory schedules.</p>
        </Card>
      )}
    </div>
  )
}
