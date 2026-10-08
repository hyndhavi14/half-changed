import { useState } from 'react'
import Button from '../../components/Button/Button'
import Card from '../../components/Card/Card'
import MoveExplanation from '../../components/MoveExplanation/MoveExplanation'
import PageHeader from '../../components/PageHeader/PageHeader'
import ProvenanceTag from '../../components/ProvenanceTag/ProvenanceTag'
import { useFactory } from '../../context/useFactory'
import type { ProcessMove } from '../../data/factoryInsight'
import { useFactoryInsight } from '../../data/useFactoryInsight'
import { energySourceLabel } from '../DashboardPage/dashboardView'
import HistoricalReplay from '../HistoricalReplay'
import { sourceTag } from '../sourceProvenance'
import styles from './SolarShiftPage.module.css'

const SHOWN = 4

function benefit(move: ProcessMove): number {
  return move.baselineGridKwh !== null && move.optimizedGridKwh !== null ? move.baselineGridKwh - move.optimizedGridKwh : 0
}

export default function SolarShiftPage() {
  const { backendData, loading, error } = useFactory()
  if (!backendData) {
    return <PageHeader eyebrow={loading ? 'Loading factory data' : 'Factory data unavailable'} title={error ?? 'No factory selected'} />
  }
  return <SolarShiftContent key={backendData.factory.id} />
}

function SolarShiftContent() {
  const { backendData } = useFactory()
  const [showAll, setShowAll] = useState(false)
  const data = backendData!
  const insight = useFactoryInsight(data)
  const explained = [...insight.moved].sort((left, right) => benefit(right) - benefit(left))
  const visible = showAll ? explained : explained.slice(0, SHOWN)
  const solar = sourceTag(energySourceLabel(data.energy))

  return (
    <div className={styles.page}>
      <PageHeader eyebrow={`${data.factory.name} · ${data.factory.timezone}`} title="SolarShift" />

      <section className={styles.equation} aria-label="How SolarShift extends the optimizer">
        <div className={styles.term}>
          <span>General optimizer</span>
          <strong>Production feasibility</strong>
          <small>Durations, machine limits, dependencies and the deadline — for any factory configuration.</small>
        </div>
        <b aria-hidden="true">+</b>
        <div className={`${styles.term} ${styles.solar}`}>
          <span>SolarShift</span>
          <strong>Solar + tariff awareness</strong>
          <small>Minimises modeled grid cost using the factory’s solar profile and time-of-use tariff.</small>
        </div>
        <b aria-hidden="true">=</b>
        <div className={`${styles.term} ${styles.result}`}>
          <span>Result</span>
          <strong>Energy-aware schedule</strong>
          <small>Same products and constraints — only when flexible work runs changes.</small>
        </div>
      </section>

      <Card
        title={`Why the schedule changed · ${data.factory.name}`}
        provenance={<ProvenanceTag provenance="modeled" label="Modeled" />}
      >
        <p className={styles.note}>
          Each card compares a process’s baseline slot with its optimized slot using this factory’s stored solar readings
          {solar ? ` (${solar.label.toLowerCase()})` : ''}, its tariff windows and the optimizer’s per-process solar, grid and cost values.
        </p>
        {explained.length > 0 ? (
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
