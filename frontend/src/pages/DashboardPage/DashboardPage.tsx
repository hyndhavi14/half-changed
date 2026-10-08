import { useState } from 'react'
import { Link } from 'react-router-dom'
import Button from '../../components/Button/Button'
import Card from '../../components/Card/Card'
import CompareCard from '../../components/CompareCard/CompareCard'
import EnergyChart from '../../components/EnergyChart/EnergyChart'
import GanttRow from '../../components/GanttRow/GanttRow'
import KpiCard from '../../components/KpiCard/KpiCard'
import Legend from '../../components/Legend/Legend'
import PageHeader from '../../components/PageHeader/PageHeader'
import ProgressBar from '../../components/ProgressBar/ProgressBar'
import StatusChip from '../../components/StatusChip/StatusChip'
import { useFactory } from '../../context/useFactory'
import type { BackendFactoryData } from '../../data/backendApi'
import { displayTimestamp, displayValue, findStoredSchedule } from '../../data/backendView'
import { PROVENANCE_LABEL, type Provenance } from '../../data/provenance'
import { PROCESS_COLOR_KEYS, type ProcessColorKey } from '../../data/scheduleView'
import type { ScheduleBlock, ScheduleColorKey } from '../../data/types'
import { aggregateMeasuredEnergy } from '../energyChartData'
import {
  compareMetrics,
  daySegments,
  energyDays,
  energySourceLabel,
  energySourceNote,
  ganttRows,
  horizonSegments,
  horizonTicks,
  kpiViews,
  plannedLoadPct,
  recordCountsCaption,
  rowsForDay,
  tariffWindows,
  type BandSegment,
  type StoredSchedule,
} from './dashboardView'
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

const KPI_DOTS = ['var(--caramel)', 'var(--sun)', 'var(--teal)', 'var(--plum)']
const LEGACY_COLOR_KEYS: ScheduleColorKey[] = ['roast', 'grind', 'conche', 'temper', 'mould', 'pack']
const BAND_LABEL: Record<BandSegment['band'], string> = { peak: 'Peak price', mid: 'Mid price', off: 'Off-peak price' }

// Resolve a provenance key by its visible label so the page follows data/provenance.ts exactly.
function provenanceFor(label: string): Provenance | undefined {
  const match = (Object.entries(PROVENANCE_LABEL) as Array<[string, string]>)
    .find(([, text]) => text.toLowerCase() === label.toLowerCase())
  return match ? (match[0] as Provenance) : undefined
}

function BandStrip({ segments, label }: { segments: BandSegment[]; label: string }) {
  if (segments.length === 0) return null
  const summary = segments
    .filter((segment) => segment.band !== 'off')
    .map((segment) => BAND_LABEL[segment.band])
  return (
    <div className={styles.bandStrip} role="img" aria-label={`${label}${summary.length ? `: ${[...new Set(summary)].join(', ')}` : ''}`}>
      {segments.map((segment) => (
        <span
          key={`${segment.band}-${segment.startFraction}`}
          className={`${styles.band} ${styles[`band_${segment.band}`] ?? ''}`}
          style={{
            left: `${segment.startFraction * 100}%`,
            width: `${(segment.endFraction - segment.startFraction) * 100}%`,
          }}
        />
      ))}
    </div>
  )
}

function SchedulePreview({
  data,
  schedule,
  baseline,
}: {
  data: BackendFactoryData
  schedule: StoredSchedule
  baseline: StoredSchedule | undefined
}) {
  const rows = ganttRows(data, schedule, baseline)
  if (rows.length === 0) {
    return <p className={styles.emptyMessage}>No schedule entries are available for this schedule.</p>
  }
  const ticks = horizonTicks(schedule, data.factory.timezone)
  const segments = horizonSegments(
    tariffWindows(data.tariffs),
    Date.parse(schedule.horizonStart),
    Date.parse(schedule.horizonEnd),
    data.factory.timezone,
  )

  return (
    <div className={styles.ganttScroller}>
      <div className={styles.ganttInner}>
        <div className={styles.ganttBand}>
          <BandStrip segments={segments} label="Configured tariff windows across the schedule horizon" />
        </div>
        {rows.map((row) => {
          const blocks: Array<ScheduleBlock & {
            processColor: ProcessColorKey
            tooltip: string
            leftFraction: number
            widthFraction: number
          }> = row.blocks.map((block) => ({
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
          return (
            <GanttRow
              key={row.machineId}
              label={row.machineName}
              blocks={blocks}
              height={30}
              compact
            />
          )
        })}
        <div className={styles.timeAxis} aria-hidden="true">
          {ticks.map((tick, index) => <span key={`${tick}-${index}`}>{tick}</span>)}
        </div>
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const { backendData, loading, error, runOptimization, optimizing, optimizationError } = useFactory()
  const [chosenDay, setChosenDay] = useState<string | null>(null)

  if (!backendData) {
    return <PageHeader eyebrow={loading ? 'Loading persisted factory data' : 'Factory data unavailable'} title={error ?? 'No factory selected'} />
  }

  const data = backendData
  const timeZone = data.factory.timezone
  const baseline = findStoredSchedule(data, 'baseline')
  const optimized = findStoredSchedule(data, 'optimized')
  const kpis = kpiViews(baseline, optimized, data.factory.currency)
  const comparison = compareMetrics(baseline, optimized, data.factory.currency)
  const modeled = provenanceFor('Modeled')
  const planned = provenanceFor('Planned')

  const days = energyDays(data.energy, timeZone)
  const selectedDay = chosenDay !== null && days.includes(chosenDay) ? chosenDay : days[days.length - 1]
  const dayRows = selectedDay ? rowsForDay(data.energy, timeZone, selectedDay) : []
  const hourlyEnergy = aggregateMeasuredEnergy(dayRows, timeZone)
  const sourceLabel = energySourceLabel(dayRows)
  const windows = tariffWindows(data.tariffs)
  const daySegs = selectedDay ? daySegments(windows, selectedDay) : []
  const bandsShown = [...new Set(daySegs.map((segment) => segment.band))]

  return (
    <>
      <PageHeader
        eyebrow={`${data.factory.name} \u00b7 ${timeZone}`}
        title="Factory dashboard"
        actions={[
          <Button
            key="export"
            variant="secondary"
            disabled
            title="Report export is not available yet"
            aria-describedby="dashboard-export-note"
          >
            Export report
          </Button>,
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
      <p id="dashboard-export-note" className={styles.srOnly}>Report export is not available yet.</p>

      {optimizationError && (
        <Card title="Optimization failed">
          <p className={styles.optimizationError} role="alert">{optimizationError}</p>
          <Button variant="primary" isLoading={optimizing} onClick={() => void runOptimization()}>
            Try again
          </Button>
        </Card>
      )}

      <section className={styles.kpiGrid} aria-label="Factory key performance indicators">
        {kpis.map((kpi, index) => (
          <KpiCard
            key={kpi.key}
            label={kpi.label}
            value={kpi.value}
            delta={kpi.delta}
            deltaTone={kpi.deltaTone}
            note={kpi.note}
            dotColor={KPI_DOTS[index % KPI_DOTS.length]}
            provenance={kpi.value === 'Not available' ? undefined : modeled}
          />
        ))}
      </section>
      <p className={styles.recordCaption}>{recordCountsCaption(data)}</p>

      <section className={styles.twoColumnGrid} aria-label="Energy and comparison">
        <Card
          title="Energy by hour"
          provenance={provenanceFor(sourceLabel)}
          action={days.length > 1 ? (
            <label className={styles.dayPicker}>
              <span>Day</span>
              <select value={selectedDay} onChange={(event) => setChosenDay(event.target.value)}>
                {days.map((day) => <option key={day} value={day}>{day}</option>)}
              </select>
            </label>
          ) : undefined}
        >
          <Legend
            items={[
              { label: 'Generation', color: 'var(--sun)', shape: 'square' },
              { label: 'Consumption', color: 'var(--grid-brown)', shape: 'square' },
              ...bandsShown
                .filter((band) => band !== 'off')
                .map((band) => ({
                  label: BAND_LABEL[band],
                  color: band === 'peak' ? 'var(--band-peak)' : 'var(--band-mid)',
                  shape: 'square' as const,
                })),
            ]}
          />
          {hourlyEnergy.length ? (
            <>
              <EnergyChart
                measuredEnergy={hourlyEnergy}
                firstSeriesLabel="Generation"
                secondSeriesLabel="Consumption"
              />
              <BandStrip segments={daySegs} label={`Configured tariff windows on ${selectedDay}`} />
              <div className={styles.dayAxis} aria-hidden="true">
                <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span>
              </div>
            </>
          ) : (
            <p className={styles.emptyMessage}>No hourly generation and consumption readings are available for this factory.</p>
          )}
          <p className={styles.sourceNote}>
            {selectedDay ? `${selectedDay} (${timeZone}) \u00b7 ` : ''}{energySourceNote(sourceLabel)}
            {windows.length > 0 && daySegs.length === 0 ? ' Tariff windows have a single price, so no peak band is shown.' : ''}
            {windows.length === 0 ? ' No tariff windows are configured.' : ''}
          </p>
        </Card>
        {comparison.length > 0 ? (
          <CompareCard compare={comparison} provenance={modeled} />
        ) : (
          <Card title="Baseline vs optimized">
            <p className={styles.emptyMessage}>A persisted baseline and optimized schedule pair is required for comparison.</p>
          </Card>
        )}
      </section>

      <section className={styles.twoColumnGrid} aria-label="Schedule and machines">
        <Card
          title={optimized ? `Optimized schedule \u00b7 ${optimized.name}` : 'Optimized schedule'}
          provenance={optimized ? planned : undefined}
          action={<Link className={styles.timelineLink} to="/schedule">Open full timeline {'\u2192'}</Link>}
        >
          {optimized ? (
            <>
              <p className={styles.emptyMessage}>
                {displayTimestamp(optimized.horizonStart, timeZone)} {'\u2013'} {displayTimestamp(optimized.horizonEnd, timeZone)} ({timeZone})
              </p>
              <SchedulePreview data={data} schedule={optimized} baseline={baseline} />
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

        <Card title="Machines" provenance={optimized ? planned : undefined}>
          <div className={styles.machineList}>
            {data.machines.length ? data.machines.map((machine) => {
              const load = plannedLoadPct(optimized, machine.id)
              return (
                <div className={styles.machineRow} key={machine.id}>
                  <div className={styles.machineDetails}>
                    <strong>{machine.name}</strong>
                    <span>{displayValue(machine.ratedPowerKw, ' kW rated')}</span>
                  </div>
                  <StatusChip status={machine.isActive ? 'Active' : 'Inactive'} />
                  <div className={styles.plannedLoad}>
                    {load === null ? (
                      <span className={styles.mutedText}>Planned load: Not available</span>
                    ) : (
                      <>
                        <ProgressBar value={load} color="var(--teal)" ariaLabel={`${machine.name} planned load`} />
                        <strong>{Math.round(load)}%</strong>
                      </>
                    )}
                  </div>
                </div>
              )
            }) : <p className={styles.emptyMessage}>No machines are persisted for this factory.</p>}
          </div>
          {data.machines.length > 0 && (
            <p className={styles.sourceNote}>
              Planned load is the share of the optimized schedule horizon each machine is booked. It is planned, not measured machine activity.
            </p>
          )}
        </Card>
      </section>

      <section className={styles.modelSlot} aria-label="Factory floor view">
        <div className={styles.modelIcon}>{CUBE_ICON}</div>
        <div className={styles.modelCopy}>
          <h2>{data.factory.name} {'\u00b7'} Factory view</h2>
          <p>View persisted machine and process records. A physical floor layout or live machine telemetry is not available from the current Backend data.</p>
        </div>
        <Link className={styles.modelLink} to="/factory-view">
          <span className={styles.modelLinkButton}>Open factory view</span>
        </Link>
      </section>
    </>
  )
}
