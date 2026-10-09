import { useState } from 'react'
import Button from '../../components/Button/Button'
import Card from '../../components/Card/Card'
import MoveExplanation from '../../components/MoveExplanation/MoveExplanation'
import OptimizationStatus from '../../components/OptimizationStatus/OptimizationStatus'
import PageHeader from '../../components/PageHeader/PageHeader'
import ProvenanceTag from '../../components/ProvenanceTag/ProvenanceTag'
import { useFactory } from '../../context/useFactory'
import type { ProcessMove } from '../../data/factoryInsight'
import { formatCurrency, formatKwh } from '../../data/format'
import { useFactoryInsight } from '../../data/useFactoryInsight'
import { SOLARSHIFT_DEMO_NAME, SOLARSHIFT_DEMO_SLUG, solarShiftScope } from '../../data/solarShiftScope'
import { useOptimizationState } from '../../data/useOptimizationState'
import { energySourceLabel } from '../DashboardPage/dashboardView'
import HistoricalReplay from '../HistoricalReplay'
import { sourceTag } from '../sourceProvenance'
import styles from './SolarShiftPage.module.css'

const SHOWN = 3

function benefit(move: ProcessMove): number {
  return move.baselineGridKwh !== null && move.optimizedGridKwh !== null ? move.baselineGridKwh - move.optimizedGridKwh : 0
}

export default function SolarShiftPage() {
  const { backendData, loading, error } = useFactory()
  if (!backendData) {
    return <PageHeader eyebrow={loading ? 'Loading factory data' : 'Factory data unavailable'} title={error ?? 'No factory selected'} />
  }
  if (!solarShiftScope(backendData.factory).enabled) return <NotTheDemo factoryName={backendData.factory.name} />
  return <SolarShiftContent key={backendData.factory.id} />
}

/** SolarShift is the Chocolate Factory demonstration; other factories use the general scheduler. */
function NotTheDemo({ factoryName }: { factoryName: string }) {
  const { factories, setFactoryId } = useFactory()
  const demo = factories.find((factory) => factory.slug === SOLARSHIFT_DEMO_SLUG)
  return (
    <div className={styles.page}>
      <PageHeader eyebrow={`${factoryName} · general BYTE ME scheduling`} title="SolarShift" />
      <Card title="SolarShift is demonstrated on the Demo Chocolate Factory">
        <p className={styles.note}>
          SolarShift — solar-aware production scheduling — is our hackathon demonstration on the {SOLARSHIFT_DEMO_NAME}.
          {` ${factoryName}`} uses the general BYTE ME scheduler: a feasible schedule that respects durations, machine assignment,
          one process per machine and process order, with modeled energy cost from its stored tariff. See it on the Dashboard and Schedule pages.
        </p>
        {demo ? (
          <Button variant="primary" onClick={() => setFactoryId(demo.id)}>Switch to the {SOLARSHIFT_DEMO_NAME}</Button>
        ) : (
          <p className={styles.note}>The {SOLARSHIFT_DEMO_NAME} is not available to your account.</p>
        )}
      </Card>
    </div>
  )
}

function SolarShiftContent() {
  const { backendData } = useFactory()
  const [showAll, setShowAll] = useState(false)
  const data = backendData!
  const insight = useFactoryInsight(data)
  const { state, optimizing, run } = useOptimizationState(data, insight.pair)
  const { outcome } = insight
  const signed = (value: number | null, format: (v: number) => string) => (value === null ? 'Not available' : `${value > 0 ? '+' : value < 0 ? '−' : ''}${format(Math.abs(value))}`)
  const explained = [...insight.moved].sort((left, right) => benefit(right) - benefit(left))
  const visible = showAll ? explained : explained.slice(0, SHOWN)
  const solar = sourceTag(energySourceLabel(data.energy))

  return (
    <div className={styles.page}>
      <PageHeader eyebrow={`${data.factory.name} · ${data.factory.timezone}`} title="SolarShift" />
      <OptimizationStatus state={state} onRun={run} running={optimizing} compact />

      <ol className={styles.steps} aria-label="How SolarShift works">
        <li className={styles.solar}>
          <span className={styles.stepNo}>1</span>
          <strong>Find the sunny hours</strong>
          <small>When the factory’s solar panels produce the most power{solar ? ` (${solar.label.toLowerCase()} data)` : ''}.</small>
        </li>
        <li>
          <span className={styles.stepNo}>2</span>
          <strong>Find the cheap hours</strong>
          <small>When grid electricity costs less (off-peak tariff).</small>
        </li>
        <li className={styles.result}>
          <span className={styles.stepNo}>3</span>
          <strong>Move flexible work there</strong>
          <small>Same products, same machines, same order and deadline — only the start times change.</small>
        </li>
      </ol>

      {state.showResults && outcome.comparable && (
        <dl className={styles.impact} aria-label="Modeled change from baseline to optimized">
          <div><dt>Extra solar used</dt><dd>{signed(outcome.solarGainKwh, formatKwh)}</dd></div>
          <div><dt>Grid energy</dt><dd>{signed(outcome.gridSavedKwh === null ? null : -outcome.gridSavedKwh, formatKwh)}</dd></div>
          <div><dt>Modeled cost</dt><dd>{signed(outcome.costSaved === null ? null : -outcome.costSaved, (v) => formatCurrency(v, insight.currency))}</dd></div>
          <div><dt>Processes moved</dt><dd>{insight.moved.length} of {insight.moves.length}</dd></div>
        </dl>
      )}

      <Card
        title="Why each process moved"
        provenance={<ProvenanceTag provenance="modeled" label="Modeled" />}
      >
        <p className={styles.note}>The biggest savings first. Before → after time, the reasons, and the modeled saving.</p>
        {!state.showResults ? (
          <div className={styles.empty}>
            <strong>No optimized schedule yet.</strong>
            <span>Run the optimizer to see which processes SolarShift moves for {data.factory.name}.</span>
          </div>
        ) : explained.length > 0 ? (
          <div className={styles.list}>
            {visible.map((move) => (
              <MoveExplanation key={move.processId} move={move} checks={insight.checks} timeZone={insight.timeZone} currency={insight.currency} variant="row" />
            ))}
            {explained.length > SHOWN && (
              <Button variant="secondary" onClick={() => setShowAll(!showAll)}>
                {showAll ? 'Show fewer' : `Show all ${explained.length}`}
              </Button>
            )}
          </div>
        ) : (
          <div className={styles.empty}>
            <strong>No beneficial schedule shift identified for the current optimization.</strong>
            <span>
              {insight.outcome.comparable
                ? 'The optimized schedule keeps the baseline timing for every process.'
                : 'A stored baseline and optimized schedule pair is needed. Run the optimizer from the dashboard.'}
            </span>
          </div>
        )}
      </Card>

      <HistoricalReplay selectedFactoryName={data.factory.name} />
    </div>
  )
}
