import { useState } from 'react'
import { Link } from 'react-router-dom'
import Button from '../../components/Button/Button'
import Card from '../../components/Card/Card'
import CompareCard from '../../components/CompareCard/CompareCard'
import ConstraintsCard from '../../components/ConstraintsCard/ConstraintsCard'
import KpiCard from '../../components/KpiCard/KpiCard'
import MoveExplanation from '../../components/MoveExplanation/MoveExplanation'
import PageHeader from '../../components/PageHeader/PageHeader'
import ProgressBar from '../../components/ProgressBar/ProgressBar'
import ProvenanceTag from '../../components/ProvenanceTag/ProvenanceTag'
import ScheduleGantt from '../../components/ScheduleGantt/ScheduleGantt'
import SegmentedToggle from '../../components/SegmentedToggle/SegmentedToggle'
import SolarDemandChart from '../../components/SolarDemandChart/SolarDemandChart'
import { useFactory } from '../../context/useFactory'
import { solarAvailableKwh } from '../../data/factoryInsight'
import { formatCurrency, formatKw, formatKwh, formatPercent } from '../../data/format'
import { beforeAfterMetrics, optimizationSummary } from '../../data/insightView'
import { useFactoryInsight } from '../../data/useFactoryInsight'
import { sourceTag } from '../sourceProvenance'
import { energySourceLabel } from './dashboardView'
import styles from './DashboardPage.module.css'

const PLAY_ICON = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
    <path d="M8 5v14l11-7z" />
  </svg>
)

const VIEW_OPTIONS = [
  { value: 'baseline', label: 'Baseline' },
  { value: 'optimized', label: 'Optimized' },
]

function clock(at: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(at))
}

export default function DashboardPage() {
  const { backendData, loading, error, runOptimization, optimizing, optimizationError } = useFactory()
  if (!backendData) {
    return <PageHeader eyebrow={loading ? 'Loading factory data' : 'Factory data unavailable'} title={error ?? 'No factory selected'} />
  }
  return (
    <Dashboard
      key={backendData.factory.id}
      data={backendData}
      runOptimization={runOptimization}
      optimizing={optimizing}
      optimizationError={optimizationError}
    />
  )
}

interface DashboardProps {
  data: NonNullable<ReturnType<typeof useFactory>['backendData']>
  runOptimization: () => Promise<void>
  optimizing: boolean
  optimizationError: string | null
}

function Dashboard({ data, runOptimization, optimizing, optimizationError }: DashboardProps) {
  const insight = useFactoryInsight(data)
  const { outcome, series, currency, timeZone, pair } = insight
  const [view, setView] = useState<'baseline' | 'optimized'>('optimized')
  const peakSolarIndex = series.reduce((best, point, index) => ((point.solarKw ?? -1) > (series[best]?.solarKw ?? -1) ? index : best), 0)
  const [hourIndex, setHourIndex] = useState(peakSolarIndex)
  const point = series[Math.min(hourIndex, Math.max(0, series.length - 1))]
  const summary = optimizationSummary(outcome, insight.moved.length, insight.recommendation !== null, currency, data.factory.name)
  const metrics = beforeAfterMetrics(outcome, currency)
  const solarTag = sourceTag(energySourceLabel(data.energy))
  const modeled = <ProvenanceTag provenance="modeled" label="Modeled" />
  const planned = <ProvenanceTag provenance="planned" label="Optimizer output" />
  const activeProcesses = data.processes.filter((process) => process.isActive).length
  const scheduled = outcome.optimized.entryCount
  const available = solarAvailableKwh(data, pair.optimized)
  const utilization = (solar: number | null) => (solar !== null && available !== null && available > 0 ? (solar / available) * 100 : null)
  const loadKw = point ? (view === 'baseline' ? point.baselineKw : point.optimizedKw) : null
  const gridKw = point && loadKw !== null ? Math.max(0, loadKw - (point.solarKw ?? 0)) : null

  return (
    <>
      <PageHeader
        eyebrow={`${data.factory.name} · ${timeZone}`}
        title="Solar-aware factory dashboard"
        actions={[
          <Button key="optimize" variant="primary" icon={optimizing ? undefined : PLAY_ICON} isLoading={optimizing} onClick={() => void runOptimization()}>
            Run optimization
          </Button>,
        ]}
      />

      {optimizationError && (
        <Card title="Optimization failed">
          <p className={styles.optimizationError} role="alert">{optimizationError}</p>
          <Button variant="primary" isLoading={optimizing} onClick={() => void runOptimization()}>Try again</Button>
        </Card>
      )}

      <section className={`${styles.summary} ${styles[`summary_${summary.tone}`]}`} aria-label="Solar-aware optimization summary">
        <div className={styles.summaryCopy}>
          <span className={styles.summaryEyebrow}>Solar-aware optimization</span>
          <h2>{summary.title}</h2>
          <p>{summary.text}</p>
        </div>
        <div className={styles.summaryFacts}>
          <span><strong>{data.machines.length}</strong> machines</span>
          <span><strong>{data.processes.length}</strong> processes</span>
          <span><strong>{insight.checks ? (insight.checks.withinHorizon && insight.checks.machineConflicts && insight.checks.dependencies !== false ? 'Feasible' : 'Check plan') : '—'}</strong> production plan</span>
        </div>
      </section>

      <Card
        title="At a glance"
        action={series.length > 0 ? (
          <label className={styles.hourPicker}>
            <span>Hour</span>
            <input
              type="range"
              min={0}
              max={series.length - 1}
              value={Math.min(hourIndex, series.length - 1)}
              onChange={(event) => setHourIndex(Number(event.target.value))}
              aria-valuetext={point ? clock(point.start, timeZone) : undefined}
            />
            <strong>{point ? clock(point.start, timeZone) : '—'}</strong>
          </label>
        ) : undefined}
      >
        <div className={styles.kpiGrid}>
          <KpiCard label="Solar available" value={point && point.solarKw !== null ? formatKw(point.solarKw) : 'Not available'} note={point ? `at ${clock(point.start, timeZone)}` : 'No schedule window'} dotColor="var(--sun)" provenance={solarTag ? <ProvenanceTag provenance={solarTag.provenance} label={solarTag.label} /> : undefined} />
          <KpiCard label="Factory load" value={loadKw !== null ? formatKw(loadKw) : 'Not available'} note={`planned · ${view} schedule`} dotColor="var(--caramel)" provenance={planned} />
          <KpiCard label="Grid demand" value={gridKw !== null ? formatKw(gridKw) : 'Not available'} note="load not covered by solar" dotColor="var(--grid-brown)" provenance={modeled} />
          <KpiCard label="Electricity cost" value={formatCurrency(outcome.optimized.cost, currency)} note="optimized schedule, whole plan" dotColor="var(--terracotta)" provenance={modeled} />
          <KpiCard
            label="Modeled cost savings"
            value={outcome.costSaved !== null ? formatCurrency(outcome.costSaved, currency) : 'Not available'}
            delta={outcome.costSavedPct === null ? undefined : Math.abs(outcome.costSavedPct) < 0.05 ? 'No change' : `${outcome.costSavedPct > 0 ? '−' : '+'}${formatPercent(Math.abs(outcome.costSavedPct), 1)}`}
            deltaTone={outcome.costSaved === null ? 'neutral' : outcome.costSaved > 0 ? 'good' : outcome.costSaved < 0 ? 'bad' : 'neutral'}
            note="vs baseline schedule"
            dotColor="var(--teal)"
            provenance={modeled}
          />
          <KpiCard
            label="Production target"
            value={activeProcesses > 0 && scheduled > 0 ? formatPercent(Math.min(100, (scheduled / activeProcesses) * 100)) : 'Not available'}
            note={scheduled > 0 ? `${scheduled} of ${activeProcesses} active processes scheduled` : 'No optimized schedule'}
            dotColor="var(--espresso)"
            provenance={scheduled > 0 ? planned : undefined}
          />
        </div>
      </Card>

      <Card
        title="Solar vs factory demand"
        provenance={solarTag ? <ProvenanceTag provenance={solarTag.provenance} label={`Solar: ${solarTag.label}`} /> : undefined}
        action={<SegmentedToggle options={VIEW_OPTIONS} value={view} onChange={(value) => setView(value as 'baseline' | 'optimized')} ariaLabel="Schedule shown" />}
      >
        {series.length > 0 ? (
          <>
            <p className={styles.caption}>Each column is one hour of the plan. Shaded columns have more solar than the factory draws — that is where flexible work can go. Select a column to inspect it.</p>
            <SolarDemandChart
              points={series}
              view={view}
              timeZone={timeZone}
              ariaLabel={`Solar availability and ${view} factory demand by hour`}
              selectedIndex={hourIndex}
              onSelect={setHourIndex}
              solarLabel={`Solar available${solarTag ? ` (${solarTag.label.toLowerCase()})` : ''}`}
            />
          </>
        ) : (
          <EmptySchedule factoryName={data.factory.name} optimizing={optimizing} runOptimization={runOptimization} />
        )}
      </Card>

      <Card
        title="Machine schedule"
        provenance={insight.lanes.length ? planned : undefined}
        action={<Link className={styles.link} to="/schedule">Open schedule →</Link>}
      >
        {insight.window && insight.lanes.length > 0 ? (
          <ScheduleGantt
            lanes={insight.lanes}
            window={insight.window}
            timeZone={timeZone}
            mode={pair.baseline && pair.optimized ? 'compare' : pair.optimized ? 'optimized' : 'baseline'}
            bands={insight.bands}
            ariaLabel={`${data.factory.name} machine schedule`}
            compact
          />
        ) : (
          <EmptySchedule factoryName={data.factory.name} optimizing={optimizing} runOptimization={runOptimization} />
        )}
      </Card>

      <section className={styles.twoColumnGrid} aria-label="Recommendation and comparison">
        <div className={styles.recommendation}>
          <h2 className={styles.sectionTitle}>Solar-aware recommendation</h2>
          {insight.recommendation ? (
            <MoveExplanation move={insight.recommendation} checks={insight.checks} timeZone={timeZone} currency={currency} variant="hero" />
          ) : (
            <div className={styles.noRecommendation}>
              <strong>No beneficial schedule shift identified for the current optimization.</strong>
              <span>{outcome.comparable ? 'No process moved to a slot with less grid energy or lower modeled cost.' : 'A comparable baseline and optimized schedule are needed first.'}</span>
            </div>
          )}
        </div>
        {metrics.length > 0 ? (
          <CompareCard title="Before vs optimized" compare={metrics} provenance={modeled} />
        ) : (
          <Card title="Before vs optimized">
            <p className={styles.caption}>A comparable baseline and optimized schedule pair is needed for this comparison.</p>
          </Card>
        )}
      </section>

      <section className={styles.twoColumnGrid} aria-label="Constraints and solar utilization">
        <ConstraintsCard checks={insight.checks} />
        <Card title="Solar utilization" provenance={modeled}>
          {available !== null ? (
            <div className={styles.utilization}>
              <p className={styles.caption}>Share of the solar energy available over the planning horizon ({formatKwh(available)}) that each schedule uses.</p>
              {[
                { label: 'Baseline', value: utilization(outcome.baseline.solarKwh), kwh: outcome.baseline.solarKwh, color: 'var(--tan)' },
                { label: 'Optimized', value: utilization(outcome.optimized.solarKwh), kwh: outcome.optimized.solarKwh, color: 'var(--teal)' },
              ].map((item) => (
                <div className={styles.utilRow} key={item.label}>
                  <span>{item.label}</span>
                  <ProgressBar value={item.value ?? 0} color={item.color} height={14} ariaLabel={`${item.label} solar utilization`} />
                  <strong>{item.value !== null ? formatPercent(item.value, 1) : 'Not available'}</strong>
                  <small>{formatKwh(item.kwh)} used</small>
                </div>
              ))}
            </div>
          ) : (
            <p className={styles.caption}>Solar data not available for this factory’s planning horizon.</p>
          )}
        </Card>
      </section>
    </>
  )
}

function EmptySchedule({ factoryName, optimizing, runOptimization }: { factoryName: string; optimizing: boolean; runOptimization: () => Promise<void> }) {
  return (
    <div className={styles.emptySchedule}>
      <p>{factoryName} has no stored schedule yet.</p>
      <Button variant="primary" isLoading={optimizing} onClick={() => void runOptimization()}>Run optimization</Button>
    </div>
  )
}
