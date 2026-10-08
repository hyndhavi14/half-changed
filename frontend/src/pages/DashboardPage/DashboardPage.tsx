import Button from '../../components/Button/Button'
import Card from '../../components/Card/Card'
import CompareCard from '../../components/CompareCard/CompareCard'
import EnergyChart from '../../components/EnergyChart/EnergyChart'
import GanttRow from '../../components/GanttRow/GanttRow'
import KpiCard from '../../components/KpiCard/KpiCard'
import Legend from '../../components/Legend/Legend'
import PageHeader from '../../components/PageHeader/PageHeader'
import { useFactory } from '../../context/useFactory'
import type { BackendFactoryData } from '../../data/backendApi'
import type { CompareMetric, ScheduleBlock } from '../../data/types'
import { displayTimestamp, displayValue, findStoredSchedule, machineName, processName } from '../../data/backendView'
import { aggregateMeasuredEnergy } from '../energyChartData'
import { Link } from 'react-router-dom'
import styles from './DashboardPage.module.css'

const PLAY_ICON = (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M8 5.14v13.72L19 12 8 5.14Z"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)

const CUBE_ICON = (
  <svg width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true">
    <path
      d="m20 4 14 8v16l-14 8-14-8V12l14-8Z"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
    />
    <path d="m6 12 14 8 14-8M20 20v16M13 8l14 8" stroke="currentColor" strokeWidth="2" />
  </svg>
)

function scheduleBlocks(data: BackendFactoryData, scheduleId: string): ScheduleBlock[] {
  const schedule = data.schedules.find((item) => item.id === scheduleId)
  if (!schedule) return []
  const start = Date.parse(schedule.horizonStart)
  const end = Date.parse(schedule.horizonEnd)
  const duration = end - start
  if (!Number.isFinite(duration) || duration <= 0) return []

  const baseline = findStoredSchedule(data, 'baseline')
  const baselineStarts = new Map(
    baseline?.entries.map((entry) => [entry.processId, Date.parse(entry.startsAt)]) ?? [],
  )

  return schedule.entries.flatMap((entry, index) => {
    const entryStart = Date.parse(entry.startsAt)
    const entryEnd = Date.parse(entry.endsAt)
    if (!Number.isFinite(entryStart) || !Number.isFinite(entryEnd) || entryEnd <= entryStart) return []
    const startHour = ((entryStart - start) / duration) * 24
    const endHour = ((entryEnd - start) / duration) * 24
    if (endHour <= 0 || startHour >= 24) return []
    const colorKeys: ScheduleBlock['colorKey'][] = ['roast', 'grind', 'conche', 'temper', 'mould', 'pack']
    const baselineStart = baselineStarts.get(entry.processId)
    return [{
      id: entry.id,
      processName: processName(data, entry.processId),
      machineId: entry.machineId,
      start: Math.max(0, startHour),
      end: Math.min(24, endHour),
      colorKey: colorKeys[index % colorKeys.length],
      shifted: baselineStart !== undefined && baselineStart !== entryStart,
    }]
  })
}

function SchedulePreview({
  data,
  schedule,
}: {
  data: BackendFactoryData
  schedule: NonNullable<ReturnType<typeof findStoredSchedule>>
}) {
  const blocks = scheduleBlocks(data, schedule.id)
  const grouped = new Map<string, ScheduleBlock[]>()
  for (const block of blocks) {
    const machineBlocks = grouped.get(block.machineId) ?? []
    machineBlocks.push(block)
    grouped.set(block.machineId, machineBlocks)
  }

  if (blocks.length === 0) {
    return <p className={styles.emptyMessage}>No schedule entries are available for this schedule.</p>
  }
  const horizonStart = Date.parse(schedule.horizonStart)
  const horizonEnd = Date.parse(schedule.horizonEnd)
  const timeFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: data.factory.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

  return (
    <div className={styles.ganttScroller}>
      <div className={styles.ganttInner}>
        {[...grouped].map(([machineId, machineBlocks]) => (
          <GanttRow
            key={machineId}
            label={machineName(data, machineId)}
            blocks={machineBlocks}
            height={30}
            compact
          />
        ))}
        <div className={styles.timeAxis} aria-hidden="true">
          {[0, 0.25, 0.5, 0.75, 1].map((fraction) => (
            <span key={fraction}>{timeFormatter.format(new Date(horizonStart + (horizonEnd - horizonStart) * fraction))}</span>
          ))}
        </div>
      </div>
    </div>
  )
}

function scheduleComparisons(data: BackendFactoryData): CompareMetric[] {
  const baseline = findStoredSchedule(data, 'baseline')
  const optimized = findStoredSchedule(data, 'optimized')
  if (!baseline || !optimized) return []

  const metrics: CompareMetric[] = []
  const addMetric = (label: string, base: number | null, current: number | null, unit: string) => {
    if (base === null || current === null || base < 0 || current < 0) return
    const largest = Math.max(base, current)
    const baselinePct = largest === 0 ? 100 : (base / largest) * 100
    const optimizedPct = largest === 0 ? 100 : (current / largest) * 100
    const change = base === 0
      ? (current === 0 ? 'No change' : 'Baseline is zero')
      : `${((current - base) / base * 100).toFixed(1)}%`
    metrics.push({
      label,
      baseline: `${displayValue(base)}${unit}`,
      optimized: `${displayValue(current)}${unit}`,
      baselinePct,
      optimizedPct,
      change,
    })
  }

  addMetric('Energy', baseline.totalEnergyKwh, optimized.totalEnergyKwh, ' kWh')
  addMetric(`Energy cost (${data.factory.currency})`, baseline.totalEnergyCost, optimized.totalEnergyCost, '')
  return metrics
}

export default function DashboardPage() {
  const { backendData, loading, error, runOptimization, optimizing, optimizationError } = useFactory()
  if (!backendData) {
    return <PageHeader eyebrow={loading ? 'Loading persisted factory data' : 'Factory data unavailable'} title={error ?? 'No factory selected'} />
  }

  const data = backendData
  const optimized = findStoredSchedule(data, 'optimized')
  const comparison = scheduleComparisons(data)
  const hourlyEnergy = aggregateMeasuredEnergy(data.energy, data.factory.timezone)
  const latestEnergy = [...data.energy].filter((row) =>
    typeof row.recorded_at === 'string' && Number.isFinite(Date.parse(row.recorded_at)),
  ).sort((left, right) => {
    const leftTime = typeof left.recorded_at === 'string' ? Date.parse(left.recorded_at) : 0
    const rightTime = typeof right.recorded_at === 'string' ? Date.parse(right.recorded_at) : 0
    return rightTime - leftTime
  })[0]

  return (
    <>
      <PageHeader
        eyebrow={data.factory.name}
        title="Factory dashboard"
        actions={[
          <Button key="export" variant="secondary">Export report</Button>,
          <Button
            key="optimize"
            variant="primary"
            icon={optimizing ? undefined : PLAY_ICON}
            isLoading={optimizing}
            onClick={() => void runOptimization()}
          >
            Run optimization
          </Button>,
        ]}
      />

      {optimizationError && (
        <Card title="Optimization failed">
          <p className={styles.optimizationError} role="alert">{optimizationError}</p>
          <Button variant="primary" isLoading={optimizing} onClick={() => void runOptimization()}>
            Try again
          </Button>
        </Card>
      )}

      <section className={styles.kpiGrid} aria-label="Factory key performance indicators">
        <KpiCard label="Machines" value={data.machines.length} note="Persisted inventory" dotColor="var(--caramel)" />
        <KpiCard label="Processes" value={data.processes.length} note="Persisted process records" dotColor="var(--teal)" />
        <KpiCard label="Schedules" value={data.schedules.length} note="Persisted schedules" dotColor="var(--sun)" />
        <KpiCard label="Energy readings" value={data.energy.length} note="Persisted intervals" dotColor="var(--plum)" />
      </section>

      <section className={styles.twoColumnGrid} aria-label="Energy and comparison">
        <Card title="Recorded energy by hour">
          <Legend
            items={[
              { label: 'Generation', color: 'var(--sun)', shape: 'square' },
              { label: 'Consumption', color: 'var(--grid-brown)', shape: 'square' },
            ]}
          />
          {hourlyEnergy.length ? (
            <EnergyChart
              measuredEnergy={hourlyEnergy}
              firstSeriesLabel="Generation"
              secondSeriesLabel="Consumption"
            />
          ) : (
            <p className={styles.emptyMessage}>No hourly generation and consumption readings are available for this factory.</p>
          )}
          {latestEnergy && (
            <p className={styles.emptyMessage}>
              Latest consumption: {displayValue(latestEnergy.consumption_kwh, ' kWh')} ·
              {' '}generation: {displayValue(latestEnergy.generation_kwh, ' kWh')} ·
              {' '}source: {displayValue(latestEnergy.source)}
            </p>
          )}
        </Card>
        {comparison.length > 0 ? (
          <CompareCard compare={comparison} />
        ) : (
          <Card title="Baseline vs optimized">
            <p className={styles.emptyMessage}>A persisted baseline and optimized schedule pair is required for comparison.</p>
          </Card>
        )}
      </section>

      <section className={styles.twoColumnGrid} aria-label="Schedule and machines">
        <Card
          title={optimized ? `Optimized schedule · ${optimized.name}` : 'Optimized schedule'}
          action={<Link className={styles.timelineLink} to="/schedule">Open full timeline →</Link>}
        >
          {optimized ? (
            <>
              <p className={styles.emptyMessage}>
                {displayTimestamp(optimized.horizonStart, data.factory.timezone)} – {displayTimestamp(optimized.horizonEnd, data.factory.timezone)}
              </p>
              <SchedulePreview data={data} schedule={optimized} />
            </>
          ) : (
            <div className={styles.emptySchedule}>
              <p>No persisted optimized schedule yet.</p>
              <Button variant="primary" isLoading={optimizing} onClick={() => void runOptimization()}>
                Run optimization
              </Button>
            </div>
          )}
        </Card>

        <Card title="Machines">
          <div className={styles.machineList}>
            {data.machines.length ? data.machines.map((machine) => (
              <div className={styles.machineRow} key={machine.id}>
                <div className={styles.machineDetails}>
                  <strong>{machine.name}</strong>
                  <span>{displayValue(machine.ratedPowerKw, ' kW rated')}</span>
                </div>
                <span>{machine.isActive ? 'Active configuration' : 'Inactive configuration'}</span>
              </div>
            )) : <p className={styles.emptyMessage}>No machines are persisted for this factory.</p>}
          </div>
        </Card>
      </section>

      <section className={styles.modelSlot} aria-label="Factory floor view">
        <div className={styles.modelIcon}>{CUBE_ICON}</div>
        <div className={styles.modelCopy}>
          <h2>{data.factory.name} · Factory view</h2>
          <p>View persisted machine and process records. A physical floor layout or live machine telemetry is not available from the current Backend data.</p>
        </div>
        <Link className={styles.modelLink} to="/factory-view">
          <span className={styles.modelLinkButton}>Open factory view</span>
        </Link>
      </section>
    </>
  )
}
