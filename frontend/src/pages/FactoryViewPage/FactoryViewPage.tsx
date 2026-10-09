import { useEffect, useState } from 'react'
import Button from '../../components/Button/Button'
import Card from '../../components/Card/Card'
import OptimizationStatus from '../../components/OptimizationStatus/OptimizationStatus'
import PageHeader from '../../components/PageHeader/PageHeader'
import ProvenanceTag from '../../components/ProvenanceTag/ProvenanceTag'
import SegmentedToggle from '../../components/SegmentedToggle/SegmentedToggle'
import StatTile from '../../components/StatTile/StatTile'
import { useFactory } from '../../context/useFactory'
import type { BackendFactoryData } from '../../data/backendApi'
import { moveReasons } from '../../data/factoryInsight'
import { solarShiftScope } from '../../data/solarShiftScope'
import { formatCurrency, formatDuration, formatKw, formatKwh } from '../../data/format'
import { useFactoryInsight } from '../../data/useFactoryInsight'
import { useOptimizationState } from '../../data/useOptimizationState'
import { sourceTag } from '../sourceProvenance'
import { energySourceLabel } from '../DashboardPage/dashboardView'
import Factory3DEmbed from './Factory3DEmbed'
import { flowPlan, machineActivity } from './factoryViewModel'
import styles from './FactoryViewPage.module.css'

const FACTORY_3D_URL = import.meta.env.VITE_FACTORY_3D_URL ?? 'http://localhost:5174'

/**
 * Machine slugs the separate Factory-3D app can place in its scene.
 * Mirrors MACHINE_LAYOUT in factory-3d/src/data/providers/ApiMachineDataProvider.ts.
 */
const FACTORY_3D_SLUGS = new Set(['roasting-drum', 'refining-conche', 'tempering-unit', 'moulding-line', 'cooling-tunnel', 'packing-cell'])


const HOUR = 3_600_000

function clock(at: number, timeZone: string, withDay = true): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, ...(withDay ? { weekday: 'short' as const } : {}), hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(at))
}

function metadataNumber(metadata: unknown, key: string): number | null {
  if (typeof metadata !== 'object' || metadata === null) return null
  const value = (metadata as Record<string, unknown>)[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export default function FactoryViewPage() {
  const { backendData, loading, error } = useFactory()
  if (!backendData) {
    return <PageHeader eyebrow={loading ? 'Loading factory data' : 'Factory data unavailable'} title={error ?? 'No factory selected'} />
  }
  return <FactoryScene key={backendData.factory.id} data={backendData} />
}

function FactoryScene({ data }: { data: BackendFactoryData }) {
  const insight = useFactoryInsight(data)
  const { pair, outcome, series, timeZone, currency } = insight
  const { state, optimizing, run } = useOptimizationState(data, pair)
  const [view, setView] = useState<'baseline' | 'optimized'>('optimized')
  // SolarShift demo: start at the sunniest hour. Other factories: start at the first hour with work.
  const peakSolarIndex = series.reduce((best, point, index) => ((point.solarKw ?? -1) > (series[best]?.solarKw ?? -1) ? index : best), 0)
  const firstWork = Math.max(0, series.findIndex((point) => point.optimizedKw > 0))
  const [hourIndex, setHourIndex] = useState(solarShiftScope(data.factory).enabled ? peakSolarIndex : firstWork)
  const [playing, setPlaying] = useState(false)
  const [selectedMachine, setSelectedMachine] = useState('')
  const lastIndex = Math.max(0, series.length - 1)
  const index = Math.min(hourIndex, lastIndex)
  const point = series[index]
  const at = point ? point.start + 30 * 60_000 : null
  const labels = new Map(insight.labels.map((label) => [label.id, label]))
  const lanes = new Map(insight.lanes.map((lane) => [lane.id, lane]))
  const plan = flowPlan(data)
  const scope = solarShiftScope(data.factory)
  const viewOptions = [{ value: 'baseline', label: scope.before }, { value: 'optimized', label: scope.after }]
  const movedLabel = `Moved by ${scope.mover === 'SolarShift' ? 'SolarShift' : 'the optimizer'}`
  const solarTag = sourceTag(energySourceLabel(data.energy))
  const modeled = <ProvenanceTag provenance="modeled" label="Modeled" />
  const results = state.showResults
  const demand = point ? (view === 'baseline' ? point.baselineKw : point.optimizedKw) : null
  const solarKw = point?.solarKw ?? null
  const gridKw = demand !== null ? Math.max(0, demand - (solarKw ?? 0)) : null
  const scale = Math.max(demand ?? 0, solarKw ?? 0, 1)
  const placed = data.machines.filter((machine) => FACTORY_3D_SLUGS.has(machine.slug)).length
  const shownSchedule = view === 'baseline' ? pair.baseline : pair.optimized
  const entriesByProcess = (schedule: typeof pair.optimized) => new Map((schedule?.entries ?? []).map((entry) => [entry.processId, entry]))
  const baselineEntries = entriesByProcess(pair.baseline)
  const optimizedEntries = entriesByProcess(pair.optimized)
  const selected = selectedMachine ? labels.get(selectedMachine) : undefined
  const selectedMoves = insight.moves.filter((move) => move.machineId === selectedMachine)

  // Play steps through the plan one hour at a time and stops at the end.
  useEffect(() => {
    if (!playing) return
    const timer = window.setInterval(() => {
      setHourIndex((current) => {
        if (current >= lastIndex) {
          setPlaying(false)
          return current
        }
        return current + 1
      })
    }, 700)
    return () => window.clearInterval(timer)
  }, [playing, lastIndex])

  const syncFrom3d = (time: number) => {
    const found = series.findIndex((candidate) => time >= candidate.start && time < candidate.start + HOUR)
    if (found >= 0) setHourIndex(found)
  }

  const activity = (machineId: string) => {
    const lane = lanes.get(machineId)
    return machineActivity(lane ? (view === 'baseline' ? lane.baseline : lane.optimized) : [], at ?? 0)
  }

  return (
    <div className={styles.page}>
      <PageHeader eyebrow={`${data.factory.name} · planned schedule, not live telemetry`} title="Factory in action" />
      <OptimizationStatus state={state} onRun={run} running={optimizing} compact />

      {results && (
        <section className={styles.stats} aria-label="Energy summary">
          {scope.enabled && <StatTile label="Solar used" value={formatKwh(outcome.optimized.solarKwh)} sub={outcome.comparable ? `before: ${formatKwh(outcome.baseline.solarKwh)}` : 'after SolarShift'} provenance={modeled} />}
          {scope.enabled && <StatTile label="Grid energy" value={formatKwh(outcome.optimized.gridKwh)} sub={outcome.comparable ? `before: ${formatKwh(outcome.baseline.gridKwh)}` : 'after SolarShift'} provenance={modeled} />}
          {scope.enabled && <StatTile label="Grid energy saved" value={outcome.gridSavedKwh === null ? 'Not available' : formatKwh(outcome.gridSavedKwh)} sub="vs before" provenance={outcome.gridSavedKwh === null ? undefined : modeled} />}
          {!scope.enabled && <StatTile label="Processes re-timed" value={`${insight.moved.length} of ${insight.moves.length}`} sub="by the optimizer" provenance={<ProvenanceTag provenance="planned" label="Optimizer output" />} />}
          <StatTile label="Modeled cost saved" value={outcome.costSaved === null ? 'Not available' : formatCurrency(outcome.costSaved, currency)} sub={`now ${formatCurrency(outcome.optimized.cost, currency)} (energy charge only)`} provenance={outcome.costSaved === null ? undefined : modeled} />
        </section>
      )}

      {results && series.length > 0 && point && at !== null ? (
        <>
          <div className={styles.player} role="group" aria-label="Plan time">
            <Button variant="primary" onClick={() => {
              if (!playing && index >= lastIndex) setHourIndex(0)
              setPlaying(!playing)
            }}>
              {playing ? '❚❚ Pause' : '▶ Play the day'}
            </Button>
            <label className={styles.timePicker}>
              <span className="visually-hidden">Plan time</span>
              <input type="range" min={0} max={lastIndex} value={index} onChange={(event) => { setPlaying(false); setHourIndex(Number(event.target.value)) }} aria-valuetext={clock(point.start, timeZone)} />
              <strong>{clock(point.start, timeZone)}–{clock(point.start + HOUR, timeZone, false)}</strong>
            </label>
            <SegmentedToggle options={viewOptions} value={view} onChange={(value) => setView(value as 'baseline' | 'optimized')} ariaLabel="Schedule shown" />
          </div>

          <Card title={`Power at ${clock(point.start, timeZone)}`} provenance={scope.enabled && solarTag ? <ProvenanceTag provenance={solarTag.provenance} label={`Solar: ${solarTag.label}`} /> : undefined}>
            <div className={styles.power}>
              {(scope.enabled
                ? [
                    { label: 'Solar available', value: solarKw, className: styles.barSolar },
                    { label: 'Factory demand', value: demand, className: styles.barLoad },
                    { label: 'From the grid', value: gridKw, className: styles.barGrid },
                  ]
                : [{ label: 'Factory demand', value: demand, className: styles.barLoad }]
              ).map((row) => (
                <div key={row.label} className={styles.powerRow}>
                  <span>{row.label}</span>
                  <span className={styles.powerTrack}><span className={row.className} style={{ width: `${((row.value ?? 0) / scale) * 100}%` }} /></span>
                  <strong>{row.value === null ? 'Not available' : formatKw(row.value)}</strong>
                </div>
              ))}
            </div>
            <p className={styles.note}>
              {!demand ? 'No machine is scheduled in this hour.' : !scope.enabled ? `Planned factory demand ${formatKw(demand)}.` : gridKw === 0 ? 'All of this hour’s demand is covered by solar.' : solarKw ? `Solar covers ${Math.round(Math.min(1, solarKw / demand) * 100)}% of demand; the rest comes from the grid.` : 'No solar in this hour, so all demand comes from the grid.'}
              {point.price !== null ? ` Electricity price: ${point.price.toLocaleString('en-GB', { maximumFractionDigits: 3 })} ${currency}/kWh.` : ''}
            </p>
          </Card>

          <Card title="2D process view" provenance={<ProvenanceTag provenance="planned" label="Optimizer output" />}>
            <p className={styles.note}>Production flows left to right, top to bottom. Highlighted machines are running at {clock(point.start, timeZone, false)} in the {view === 'baseline' ? `${scope.before.toLowerCase()} schedule` : scope.enabled ? 'SolarShift schedule' : 'optimized schedule'}. Select a machine for details.</p>
            <ol className={styles.flow}>
              {plan.zones.map((zone) => (
                <li key={zone.number} className={styles.zone}>
                  <span className={styles.zoneTitle}><b>{zone.number}</b> {zone.title}</span>
                  {zone.machineIds.map((machineId) => {
                    const label = labels.get(machineId)
                    const now = activity(machineId)
                    const moved = now.current?.moved && view === 'optimized'
                    return (
                      <button
                        key={machineId}
                        type="button"
                        className={`${styles.machine} ${now.state === 'running' ? (moved ? styles.movedRunning : styles.running) : now.state === 'done' ? styles.done : ''} ${selectedMachine === machineId ? styles.selected : ''}`}
                        aria-pressed={selectedMachine === machineId}
                        onClick={() => setSelectedMachine((current) => (current === machineId ? '' : machineId))}
                      >
                        <span className={styles.machineTop}>
                          <span className={styles.machineCode}>{label?.code}</span>
                          <span className={styles.machineState}>{now.state === 'running' ? 'Running' : now.state === 'done' ? 'Finished' : now.state === 'waiting' ? 'Waiting' : 'Not used'}</span>
                        </span>
                        <strong>{label?.name ?? 'Unknown machine'}</strong>
                        {now.current ? (
                          <span className={styles.machineJob}>{now.current.label}{now.current.powerKw !== null ? ` · ${formatKw(now.current.powerKw)}` : ''}</span>
                        ) : now.next ? (
                          <span className={styles.machineNext}>Next: {now.next.label} at {clock(now.next.start, timeZone)}</span>
                        ) : null}
                        {moved && <span className={styles.movedTag}>{movedLabel}</span>}
                      </button>
                    )
                  })}
                </li>
              ))}
            </ol>
            <ul className={styles.legend} aria-label="Legend">
              <li><i className={styles.keyRunning} />Running</li>
              <li><i className={styles.keyMoved} />Running · {movedLabel.toLowerCase()}</li>
              <li><i className={styles.keyIdle} />Waiting / not used</li>
              <li><i className={styles.keyDone} />Finished</li>
            </ul>
          </Card>
        </>
      ) : (
        <Card title="2D process view">
          <p className={styles.note}>Machine activity appears once {data.factory.name} has an optimized schedule.</p>
        </Card>
      )}

      {selected && (
        <Card title={selected.label} action={<Button variant="secondary" onClick={() => setSelectedMachine('')}>Close</Button>}>
          {selectedMoves.length === 0 ? (
            <p className={styles.note}>No scheduled process runs on this machine.</p>
          ) : (
            <ul className={styles.machineProcesses}>
              {selectedMoves.map((move) => {
                const entry = optimizedEntries.get(move.processId)
                const before = baselineEntries.get(move.processId)
                const energy = entry && typeof entry.energyKwh === 'number' ? entry.energyKwh : null
                const reasons = moveReasons(move, insight.moves, data.dependencies).filter((reason) => scope.enabled || reason !== 'More solar')
                return (
                  <li key={move.processId}>
                    <strong>{move.processName}</strong>
                    <span className={styles.badge}>{move.moved ? movedLabel : 'Unchanged'}</span>
                    <dl>
                      <div><dt>Before</dt><dd>{clock(move.baselineStart, timeZone)}</dd></div>
                      <div><dt>After</dt><dd>{clock(move.optimizedStart, timeZone)}</dd></div>
                      <div><dt>Duration</dt><dd>{formatDuration((move.optimizedEnd - move.optimizedStart) / 60_000)}</dd></div>
                      <div><dt>Energy</dt><dd>{energy === null ? 'Not available' : formatKwh(energy)}</dd></div>
                      {scope.enabled && <div><dt>Solar / grid</dt><dd>{metadataNumber(entry?.metadata, 'solar_kwh') === null ? 'Not available' : `${formatKwh(metadataNumber(entry?.metadata, 'solar_kwh'))} / ${formatKwh(metadataNumber(entry?.metadata, 'grid_kwh'))}`}{before && metadataNumber(before.metadata, 'solar_kwh') !== null ? ` (before: ${formatKwh(metadataNumber(before.metadata, 'solar_kwh'))} solar)` : ''}</dd></div>}
                      {move.moved && <div><dt>Reason</dt><dd>{reasons.length ? reasons.join(' · ') : 'Re-timed by the optimizer'}</dd></div>}
                    </dl>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      )}

      <Card title="3D factory">
        {placed > 0 && shownSchedule ? (
          <>
            <p className={styles.note}>
              The 3D scene shows the same {view === 'baseline' ? 'before' : 'SolarShift'} schedule and follows the time above.
              {` ${placed} of ${data.machines.length} machines have a place in the chocolate-plant scene.`} It is a visualization of the plan, not a live view.
            </p>
            <Factory3DEmbed key={shownSchedule.id} baseUrl={FACTORY_3D_URL} factoryId={data.factory.id} scheduleId={shownSchedule.id} at={at} onTimeChange={syncFrom3d} />
          </>
        ) : placed > 0 ? (
          <p className={styles.note}>Run the optimizer first; the 3D scene replays the optimized schedule.</p>
        ) : (
          <p className={styles.note}>
            The 3D scene is built for the chocolate-plant layout, so it is available for the Demo Chocolate Factory only. For {data.factory.name}, the 2D process view above shows the same schedule.
          </p>
        )}
      </Card>
    </div>
  )
}
