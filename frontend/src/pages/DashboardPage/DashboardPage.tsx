import { useState } from 'react'
import { Link } from 'react-router-dom'
import Button from '../../components/Button/Button'
import Card from '../../components/Card/Card'
import ConstraintsCard from '../../components/ConstraintsCard/ConstraintsCard'
import KpiCard from '../../components/KpiCard/KpiCard'
import MovedProcessList from '../../components/MovedProcessList/MovedProcessList'
import MoveExplanation from '../../components/MoveExplanation/MoveExplanation'
import OptimizationStatus from '../../components/OptimizationStatus/OptimizationStatus'
import PageHeader from '../../components/PageHeader/PageHeader'
import ProvenanceTag from '../../components/ProvenanceTag/ProvenanceTag'
import SegmentedToggle from '../../components/SegmentedToggle/SegmentedToggle'
import SolarDemandChart from '../../components/SolarDemandChart/SolarDemandChart'
import TariffChart from '../../components/TariffChart/TariffChart'
import { useFactory } from '../../context/useFactory'
import type { BackendFactoryData } from '../../data/backendApi'
import { formatCurrency, formatKw, formatPercent } from '../../data/format'
import { optimizationSummary } from '../../data/insightView'
import { solarShiftScope } from '../../data/solarShiftScope'
import { useFactoryInsight } from '../../data/useFactoryInsight'
import { useOptimizationState } from '../../data/useOptimizationState'
import { sourceTag } from '../sourceProvenance'
import { energySourceLabel } from './dashboardView'
import styles from './DashboardPage.module.css'

const PLAY_ICON = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
    <path d="M8 5v14l11-7z" />
  </svg>
)


const BAND_TEXT = { peak: 'peak tariff', mid: 'mid tariff', off: 'off-peak tariff' } as const

function clock(at: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(at))
}

export default function DashboardPage() {
  const { backendData, loading, error } = useFactory()
  if (!backendData) {
    return <PageHeader eyebrow={loading ? 'Loading factory data' : 'Factory data unavailable'} title={error ?? 'No factory selected'} />
  }
  return <Dashboard key={backendData.factory.id} data={backendData} />
}

function Dashboard({ data }: { data: BackendFactoryData }) {
  const insight = useFactoryInsight(data)
  const { outcome, series, currency, timeZone, pair } = insight
  const { state, optimizing, run } = useOptimizationState(data, pair)
  const [view, setView] = useState<'baseline' | 'optimized'>('optimized')
  const peakSolarIndex = series.reduce((best, point, index) => ((point.solarKw ?? -1) > (series[best]?.solarKw ?? -1) ? index : best), 0)
  const [hourIndex, setHourIndex] = useState(peakSolarIndex)
  const point = series[Math.min(hourIndex, Math.max(0, series.length - 1))]
  const results = state.showResults
  const scope = solarShiftScope(data.factory)
  const viewOptions = [{ value: 'baseline', label: scope.before }, { value: 'optimized', label: scope.after }]
  const solarSummary = optimizationSummary(outcome, insight.moved.length, insight.recommendation !== null, currency, data.factory.name)
  // Other factories use the general scheduler: describe the schedule and its modeled cost, never SolarShift.
  const summary = scope.enabled || solarSummary.title === 'No optimization yet' || solarSummary.title === 'Schedules not comparable'
    ? solarSummary
    : {
        tone: solarSummary.tone,
        title: insight.moved.length ? 'Optimized production schedule' : 'Feasible production schedule',
        text: `${insight.moved.length} of ${insight.moves.length} processes re-timed by the optimizer${outcome.costSaved !== null && outcome.comparable ? `; modeled energy cost ${formatCurrency(outcome.baseline.cost, currency)} → ${formatCurrency(outcome.optimized.cost, currency)}` : ''}, with every process inside the planning horizon.`,
      }
  const solarTag = sourceTag(energySourceLabel(data.energy))
  const modeled = <ProvenanceTag provenance="modeled" label="Modeled" />
  const planned = <ProvenanceTag provenance="planned" label="Optimizer output" />
  const activeProcesses = data.processes.filter((process) => process.isActive).length
  const scheduled = outcome.optimized.entryCount
  const loadKw = point ? (view === 'baseline' ? point.baselineKw : point.optimizedKw) : null
  const gridKw = point && loadKw !== null ? Math.max(0, loadKw - (point.solarKw ?? 0)) : null
  const feasible = insight.checks ? insight.checks.withinHorizon && insight.checks.machineConflicts && insight.checks.dependencies !== false : null
  // The full banner appears only when something needs attention; otherwise the hero carries the label.
  const gain = (move: (typeof insight.moved)[number]) => scope.enabled
    ? (move.baselineGridKwh ?? 0) - (move.optimizedGridKwh ?? 0)
    : (move.baselineCost ?? 0) - (move.optimizedCost ?? 0)
  const topMoves = [...insight.moved].sort((left, right) => gain(right) - gain(left)).slice(0, 4)
  const needsBanner = state.kind === 'failed' || state.kind === 'running' || state.kind === 'not_run'

  return (
    <>
      <PageHeader
        eyebrow={`${data.factory.name} · ${timeZone}`}
        title={scope.enabled ? 'Solar-aware factory dashboard' : 'Factory production dashboard'}
        actions={[
          <Button key="optimize" variant="primary" icon={optimizing ? undefined : PLAY_ICON} isLoading={optimizing} onClick={run}>
            {optimizing ? 'Optimizing…' : 'Run optimization'}
          </Button>,
        ]}
      />

      {needsBanner && <OptimizationStatus state={state} onRun={run} running={optimizing} />}

      {results && (
        <section className={`${styles.summary} ${styles[`summary_${summary.tone}`]}`} aria-label="Optimization summary">
          <div className={styles.summaryCopy}>
            <span className={styles.summaryEyebrow}>{scope.enabled ? 'Solar-aware optimization · SolarShift' : 'BYTE ME production optimization'}</span>
            <h2>{summary.title}</h2>
            <p>{summary.text}</p>
            {state.resultLabel && <small className={styles.summaryLabel}>Showing: {state.resultLabel}</small>}
          </div>
          <div className={styles.summaryFacts}>
            <span><strong>{data.machines.length}</strong> machines</span>
            <span><strong>{data.processes.length}</strong> processes</span>
            <span><strong>{feasible === null ? '—' : feasible ? 'Feasible' : 'Check plan'}</strong> production plan</span>
          </div>
        </section>
      )}

      {results && series.length > 0 ? (
        <Card
          title="At a glance"
          action={(
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
          )}
        >
          <div className={styles.kpiGrid}>
            {scope.enabled && <KpiCard label="Solar available" value={point && point.solarKw !== null ? formatKw(point.solarKw) : 'Not recorded'} note={point ? `at ${clock(point.start, timeZone)}` : ''} dotColor="var(--sun)" provenance={solarTag ? <ProvenanceTag provenance={solarTag.provenance} label={solarTag.label} /> : undefined} />}
            <KpiCard label="Factory load" value={loadKw !== null ? formatKw(loadKw) : 'Not available'} note={`planned · ${view === 'baseline' ? scope.before.toLowerCase() : scope.after.toLowerCase()} schedule`} dotColor="var(--caramel)" provenance={planned} />
            {scope.enabled ? (
              <KpiCard label="Grid import" value={gridKw !== null ? formatKw(gridKw) : 'Not available'} note={point?.price != null ? `${point.price.toLocaleString('en-GB', { maximumFractionDigits: 3 })} ${currency}/kWh · ${point.band ? BAND_TEXT[point.band] : 'tariff'}` : 'load not covered by solar'} dotColor="var(--grid-brown)" provenance={modeled} />
            ) : (
              <KpiCard label="Electricity price" value={point?.price != null ? `${point.price.toLocaleString('en-GB', { maximumFractionDigits: 3 })} ${currency}/kWh` : 'Not recorded'} note={point ? `${clock(point.start, timeZone)}${point.band ? ` · ${BAND_TEXT[point.band]}` : ''}` : ''} dotColor="var(--terracotta)" provenance={<ProvenanceTag provenance="recorded" label="Stored tariff" />} />
            )}
            <KpiCard label="Electricity cost" value={formatCurrency(outcome.optimized.cost, currency)} note={outcome.comparable ? `was ${formatCurrency(outcome.baseline.cost, currency)} in the baseline` : 'whole plan'} dotColor="var(--terracotta)" provenance={modeled} />
            <KpiCard
              label="Modeled cost savings"
              value={outcome.costSaved !== null ? formatCurrency(outcome.costSaved, currency) : 'Not available'}
              delta={outcome.costSavedPct === null ? undefined : Math.abs(outcome.costSavedPct) < 0.05 ? 'No change' : `${outcome.costSavedPct > 0 ? '−' : '+'}${formatPercent(Math.abs(outcome.costSavedPct), 1)}`}
              deltaTone={outcome.costSaved === null ? 'neutral' : outcome.costSaved > 0 ? 'good' : outcome.costSaved < 0 ? 'bad' : 'neutral'}
              note={scope.enabled ? 'vs the schedule before SolarShift' : 'vs the baseline schedule'}
              dotColor="var(--teal)"
              provenance={outcome.costSaved === null ? undefined : modeled}
            />
            <KpiCard
              label="Production target"
              value={activeProcesses > 0 && scheduled > 0 ? formatPercent(Math.min(100, (scheduled / activeProcesses) * 100)) : 'Not available'}
              note={scheduled > 0 ? `${scheduled} of ${activeProcesses} processes scheduled` : 'No optimized schedule'}
              dotColor="var(--espresso)"
              provenance={scheduled > 0 ? planned : undefined}
            />
          </div>
        </Card>
      ) : (
        <Card title="At a glance">
          <div className={styles.kpiGrid}>
            <KpiCard label="Machines" value={String(data.machines.length)} note="stored for this factory" dotColor="var(--cocoa)" />
            <KpiCard label="Processes" value={String(data.processes.length)} note={`${data.dependencies.length} dependencies`} dotColor="var(--espresso)" />
          </div>
          <p className={styles.caption}>Results appear here after a successful optimization of {data.factory.name}.</p>
        </Card>
      )}

      {results && series.length > 0 && scope.enabled && (
        <Card
          title="Sunshine vs factory demand"
          provenance={solarTag ? <ProvenanceTag provenance={solarTag.provenance} label={`Solar: ${solarTag.label}`} /> : undefined}
          action={<SegmentedToggle options={viewOptions} value={view} onChange={(value) => setView(value as 'baseline' | 'optimized')} ariaLabel="Schedule shown" />}
        >
          <p className={styles.caption}>
            Light yellow = solar power available. Gold = demand met by solar. Brown = grid import. Switch before / after: SolarShift moves work into the sunny hours.
          </p>
          <SolarDemandChart
            points={series}
            view={view}
            timeZone={timeZone}
            currency={currency}
            ariaLabel={`Solar availability and ${view} factory demand by hour`}
            selectedIndex={hourIndex}
            onSelect={setHourIndex}
            solarLabel={`Solar available${solarTag ? ` (${solarTag.label.toLowerCase()})` : ''}`}
          />
          <p className={styles.caption}>
            {clock(series[0].start, timeZone)} – {clock(series[series.length - 1].start + 3_600_000, timeZone)} ({timeZone}), hourly averages in kW.
            {' '}Solar: stored site readings{solarTag ? ` (${solarTag.label.toLowerCase()})` : ''}. Demand: process power × scheduled time from the optimizer.
          </p>
        </Card>
      )}

      {results && series.length > 0 && (
        <Card title="Electricity price per hour" provenance={<ProvenanceTag provenance="recorded" label="Tariff given to the optimizer" />}>
          <TariffChart
            points={series}
            currency={currency}
            timeZone={timeZone}
            ariaLabel="Electricity price per hour supplied to the optimizer"
            selectedIndex={hourIndex}
            onSelect={setHourIndex}
          />
          <p className={styles.caption}>Energy price only, in {currency}/kWh, from the factory’s stored tariff windows; demand charges, fixed charges and tax are not included.</p>
        </Card>
      )}

      {results && (
        <section className={styles.twoColumnGrid} aria-label="What moved and why">
          <Card
            title="Processes moved"
            provenance={planned}
            action={<Link className={styles.link} to="/schedule">Full schedule →</Link>}
          >
            {outcome.comparable ? (
              <>
                <MovedProcessList moves={[...topMoves, ...insight.moves.filter((move) => !topMoves.includes(move))]} limit={topMoves.length} dependencies={data.dependencies} timeZone={timeZone} showSolar={scope.enabled} />
                {insight.moved.length > topMoves.length && (
                  <p className={styles.caption}>+ {insight.moved.length - topMoves.length} more moved processes on the <Link to="/schedule">Schedule</Link> page.</p>
                )}
              </>
            ) : (
              <p className={styles.caption}>A comparable before/after schedule is needed to show what moved.</p>
            )}
          </Card>
          {!scope.enabled ? (
            <Card title="How the optimizer decided" provenance={modeled}>
              <p className={styles.caption}>
                The general BYTE ME scheduler builds a feasible baseline, then re-times processes to lower the modeled energy cost of the whole plan,
                using the factory’s stored energy readings and tariff. It does not claim a reason for each individual move.
              </p>
              <ul className={styles.factList}>
                <li><span>Modeled energy cost</span><strong>{outcome.comparable ? `${formatCurrency(outcome.baseline.cost, currency)} → ${formatCurrency(outcome.optimized.cost, currency)}` : formatCurrency(outcome.optimized.cost, currency)}</strong></li>
                <li><span>Processes re-timed</span><strong>{insight.moved.length} of {insight.moves.length}</strong></li>
                <li><span>Production rules</span><strong>{feasible === null ? 'Not checked' : feasible ? 'All kept' : 'Check the plan'}</strong></li>
              </ul>
            </Card>
          ) : (
          <div className={styles.recommendation}>
            <h2 className={styles.sectionTitle}>Why it moved: the biggest gain</h2>
            {insight.recommendation ? (
              <MoveExplanation move={insight.recommendation} checks={insight.checks} timeZone={timeZone} currency={currency} variant="hero" />
            ) : (
              <div className={styles.noRecommendation}>
                <strong>No beneficial schedule shift identified for this optimization.</strong>
                <span>{outcome.comparable ? 'No process moved to a slot with less grid energy or a lower modeled cost.' : 'A comparable baseline and optimized schedule are needed first.'}</span>
              </div>
            )}
          </div>
          )}
        </section>
      )}

      <ConstraintsCard checks={results ? insight.checks : null} />
    </>
  )
}
