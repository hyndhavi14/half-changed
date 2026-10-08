import { useState } from 'react'
import { Link } from 'react-router-dom'
import Button from '../../components/Button/Button'
import Card from '../../components/Card/Card'
import PageHeader from '../../components/PageHeader/PageHeader'
import ProgressBar from '../../components/ProgressBar/ProgressBar'
import ProvenanceTag from '../../components/ProvenanceTag/ProvenanceTag'
import SegmentedToggle from '../../components/SegmentedToggle/SegmentedToggle'
import StatTile from '../../components/StatTile/StatTile'
import StatusChip from '../../components/StatusChip/StatusChip'
import { useFactory } from '../../context/useFactory'
import type { BackendFactoryData } from '../../data/backendApi'
import { displayValue, findStoredSchedule } from '../../data/backendView'
import { NOT_AVAILABLE } from '../DashboardPage/dashboardView'
import { formatEnergy, formatNumber, plannedTotals } from '../EnergyPage/energyPageView'
import { factory3dUrl, flowPlan, glyphKind, machinePlan, type GlyphKind } from './factoryViewModel'
import styles from './FactoryViewPage.module.css'

type ViewType = '2d' | '3d'
type Machine = BackendFactoryData['machines'][number]

const FACTORY_3D_URL = import.meta.env.VITE_FACTORY_3D_URL ?? 'http://localhost:5174'

function MachineGlyph({ kind }: { kind: GlyphKind }) {
  return (
    <svg className={styles.machineGlyph} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      {kind === 'conveyor' ? (
        <>
          <path d="M4 20h24M7 24h18M9 10h14v8H9z" />
          <circle cx="9" cy="23" r="2" />
          <circle cx="23" cy="23" r="2" />
        </>
      ) : kind === 'oven' ? (
        <>
          <path d="M7 5h18v22H7zM11 10h10v8H11zM11 22h2M17 22h4" />
          <path d="M14 15c-2-2 2-3 0-5M18 15c-2-2 2-3 0-5" />
        </>
      ) : kind === 'tank' || kind === 'mixer' ? (
        <>
          <path d="M8 8h16v16H8zM6 8h20M11 24v3m10-3v3M16 3v10m-4-3 4 3 4-3" />
          {kind === 'mixer' && <path d="M12 18h8" />}
        </>
      ) : kind === 'generator' ? (
        <>
          <path d="M5 22h22L23 12H9zM9 17h14M16 12v10" />
          <path d="M16 4v3M9 6l2 2M23 6l-2 2" />
        </>
      ) : (
        <>
          <path d="M6 8h20v16H6zM10 12h12M10 16h12M10 20h8" />
          <circle cx="24" cy="24" r="3" />
        </>
      )}
    </svg>
  )
}

function MachineTile({
  machine,
  selected,
  plannedSolar,
  onSelect,
}: {
  machine: Machine
  selected: boolean
  plannedSolar: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      className={`${styles.machineTile} ${machine.isActive ? styles.running : styles.idle}${selected ? ` ${styles.selectedMachine}` : ''}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <span className={styles.machineTileTop}>
        <MachineGlyph kind={glyphKind(machine.type)} />
        <span className={styles.machineStatusDot} aria-hidden="true" />
      </span>
      <span className={styles.machineName}>{machine.name}</span>
      <span className={styles.machinePower}>{displayValue(machine.ratedPowerKw, ' kW')}</span>
      <span className={styles.machineStatusText}>{machine.isActive ? 'Active' : 'Inactive'}</span>
      {plannedSolar && (
        <span className={styles.solarMark} aria-label="Planned solar use">
          {'☀'}
        </span>
      )}
    </button>
  )
}

export function FactoryFloorPlan({
  data,
  selectedMachineId,
  onSelectMachine,
}: {
  data: BackendFactoryData
  selectedMachineId: string
  onSelectMachine: (machineId: string) => void
}) {
  const optimized = findStoredSchedule(data, 'optimized')
  const totals = plannedTotals(optimized)
  const plan = flowPlan(data)
  const machineById = new Map(data.machines.map((machine) => [machine.id, machine]))
  const zoneOf = new Map<string, string>()
  for (const zone of plan.zones) for (const id of zone.machineIds) zoneOf.set(id, zone.title)
  const zones = [
    ...plan.zones,
    ...(plan.unassignedMachineIds.length
      ? [{ number: plan.zones.length + 1, title: 'No assigned process', machineIds: plan.unassignedMachineIds }]
      : []),
  ]
  const selected = machineById.get(selectedMachineId) ?? data.machines[0]
  const selectedPlan = selected ? machinePlan(data, optimized, selected.id) : null
  const solarPct = totals.solarKwh !== null && totals.totalKwh ? (totals.solarKwh / totals.totalKwh) * 100 : null
  const gridPct = totals.gridKwh !== null && totals.totalKwh ? (totals.gridKwh / totals.totalKwh) * 100 : null
  const plannedSolarFor = (id: string) => {
    const machine = machinePlan(data, optimized, id)
    return machine.solarKwh !== null && machine.solarKwh > 0
  }

  return (
    <>
      <div className={styles.energySummary}>
        <div className={styles.solarEnergy}>
          <div className={styles.energyHeading}>
            <span>Planned solar (modeled)</span>
            <strong>{formatEnergy(totals.solarKwh)}</strong>
          </div>
          <ProgressBar value={solarPct ?? 0} color="var(--sun)" ariaLabel="Planned solar share of the optimized schedule" />
        </div>
        <div className={styles.gridEnergy}>
          <div className={styles.energyHeading}>
            <span>Planned grid supply (modeled)</span>
            <strong>{formatEnergy(totals.gridKwh)}</strong>
          </div>
          <ProgressBar value={gridPct ?? 0} color="var(--grid-brown)" ariaLabel="Planned grid share of the optimized schedule" />
        </div>
      </div>

      <div className={styles.floorLayout}>
        <Card title="Floor plan · production flow">
          <div
            className={styles.floorScroller}
            tabIndex={0}
            aria-label={`${data.factory.name} production flow, horizontally scrollable`}
          >
            <div className={styles.floorFlow}>
              {zones.map((zone, index) => (
                <div className={styles.stageGroup} key={`${zone.number}-${zone.title}`}>
                  <section className={styles.stageZone} aria-label={`Stage ${zone.number}: ${zone.title}`}>
                    <div className={styles.zoneHeader}>
                      <span className={styles.zoneNumber}>{zone.number}</span>
                      <h3>{zone.title}</h3>
                    </div>
                    <div className={styles.zoneMachines}>
                      {zone.machineIds.map((id) => {
                        const machine = machineById.get(id)
                        return machine ? (
                          <MachineTile
                            key={id}
                            machine={machine}
                            selected={id === selected?.id}
                            plannedSolar={plannedSolarFor(id)}
                            onSelect={() => onSelectMachine(id)}
                          />
                        ) : null
                      })}
                    </div>
                  </section>
                  {index < zones.length - 1 && <span className={styles.stageArrow} aria-hidden="true">{'→'}</span>}
                </div>
              ))}
              {zones.length === 0 && <p className={styles.emptyStage}>No machines are stored for this factory.</p>}
            </div>
          </div>
          <div className={styles.legend} aria-label="Floor plan legend">
            <span className={styles.legendItem}><span className={`${styles.legendDot} ${styles.running}`} />Active</span>
            <span className={styles.legendItem}><span className={`${styles.legendDot} ${styles.idle}`} />Inactive</span>
            <span className={styles.legendItem}><span className={`${styles.legendDot} ${styles.solarLegend}`} />Planned solar use</span>
          </div>
          <p className={styles.flowNote}>
            Stages follow the stored process dependencies{plan.cyclic ? ' (they contain a cycle, so one stage is shown)' : ''}. Machine positions are not stored, so this is a flow view, not a physical layout.
          </p>
        </Card>

        <Card title="Machine details" className={styles.detailsCard}>
          {selected && selectedPlan ? (
            <>
              <p className={styles.selectedMachineName}>{selected.name}</p>
              <div className={styles.machineStatusRow}>
                <StatusChip status={selected.isActive ? 'Active' : 'Inactive'} />
                {selectedPlan.solarKwh !== null && selectedPlan.solarKwh > 0 && <StatusChip status="Solar">Planned solar</StatusChip>}
              </div>
              <dl className={styles.machineFacts}>
                <div><dt>Stage</dt><dd>{zoneOf.get(selected.id) ?? 'No assigned process'}</dd></div>
                <div><dt>Rated power</dt><dd>{displayValue(selected.ratedPowerKw, ' kW')}</dd></div>
                <div>
                  <dt>Planned energy</dt>
                  <dd>
                    {selectedPlan.solarKwh === null || selectedPlan.gridKwh === null
                      ? NOT_AVAILABLE
                      : `Solar ${formatNumber(selectedPlan.solarKwh)} · Grid ${formatNumber(selectedPlan.gridKwh)} kWh`}
                  </dd>
                </div>
                <div><dt>Next slot</dt><dd>{selectedPlan.nextSlot ?? 'No scheduled slot'}</dd></div>
              </dl>
              <div className={styles.utilization}>
                <div className={styles.utilizationHeading}>
                  <span>Planned load (optimized horizon)</span>
                  <strong>{selectedPlan.loadPct === null ? NOT_AVAILABLE : `${Math.round(selectedPlan.loadPct)}%`}</strong>
                </div>
                <ProgressBar value={selectedPlan.loadPct ?? 0} ariaLabel={`${selected.name} planned load`} />
              </div>
              <p className={styles.flowNote}>
                Processes: {selectedPlan.processNames.length ? selectedPlan.processNames.join(', ') : 'none assigned'}.
              </p>
              <Link className={styles.scheduleLink} to="/schedule">
                See in schedule <span aria-hidden="true">{'→'}</span>
              </Link>
            </>
          ) : (
            <p className={styles.emptySelection}>No machines are available to display. Add machines in Factory Builder.</p>
          )}
        </Card>
      </div>
    </>
  )
}

export default function FactoryViewPage() {
  const { backendData, loading, error } = useFactory()
  const [view, setView] = useState<ViewType>('3d')
  const [selectedMachineId, setSelectedMachineId] = useState('')
  if (!backendData) {
    return <PageHeader eyebrow={loading ? 'Loading persisted factory data' : 'Factory data unavailable'} title={error ?? 'No factory selected'} />
  }

  const data = backendData
  const optimized = findStoredSchedule(data, 'optimized')
  const baseline = findStoredSchedule(data, 'baseline')
  const plan = flowPlan(data)
  const totals = plannedTotals(optimized)
  const scheduledMachines = new Set(optimized?.entries.map((entry) => entry.machineId) ?? []).size

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow={`${data.factory.name} · ${view === '3d' ? 'Factory-3D replay' : '2D production flow'}`}
        title="3D factory"
        actions={
          <div className={styles.viewActions}>
            <span className={styles.viewLabel}>View type</span>
            <SegmentedToggle
              ariaLabel="View type"
              value={view}
              onChange={(value) => setView(value === '3d' ? '3d' : '2d')}
              options={[
                { value: '2d', label: '2D floor plan' },
                { value: '3d', label: '3D model' },
              ]}
            />
          </div>
        }
      />

      <div className={styles.viewNotice} role="status">
        {view === '3d'
          ? `${data.factory.name} · Factory-3D opens in its own window and replays a stored schedule; the 3D scene is illustrative.`
          : `${data.factory.name} · flow view from stored processes and dependencies; machine positions are not stored.`}
      </div>

      <div className={styles.stats} aria-label="Factory summary">
        <StatTile label="Stages" value={plan.zones.length} />
        <StatTile label="Machines" value={data.machines.length} />
        <StatTile label="Scheduled machines" value={optimized ? `${scheduledMachines} of ${data.machines.length}` : NOT_AVAILABLE} sub={optimized ? 'Optimized schedule' : 'No optimized schedule yet'} />
        <StatTile
          label="Solar share"
          value={totals.solarSharePct === null ? NOT_AVAILABLE : `${formatNumber(totals.solarSharePct)}%`}
          provenance={totals.solarSharePct === null ? undefined : <ProvenanceTag provenance="modeled" />}
        />
      </div>

      {view === '3d' ? (
        <section className={styles.threeDSlot} aria-label="Factory-3D model">
          <div className={styles.threeDContent}>
            <svg className={styles.modelIcon} viewBox="0 0 72 72" fill="none" aria-hidden="true">
              <path d="m36 7 25 14v30L36 65 11 51V21L36 7Z" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
              <path d="m11 21 25 15 25-15M36 36v29m0-29L21 27m15 9 15-9" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
            </svg>
            <h2>{data.factory.name} {'·'} 3D model</h2>
            <p>
              Factory-3D replays a stored schedule in an illustrative 3D scene. It is not a live view of machines and does not show telemetry.
            </p>
            <p>
              3D visualization is currently available for selected factory configurations: the scene is modelled on the chocolate plant layout. Machines of {data.factory.name} without a scene position are listed as unplaced, so the 2D floor plan is the reliable layout view for other factories.
            </p>
            <div className={styles.threeDActions}>
              {optimized && (
                <Button variant="primary" onClick={() => window.open(factory3dUrl(FACTORY_3D_URL, data.factory.id, optimized.id), '_blank', 'noopener,noreferrer')}>
                  Open optimized schedule in 3D
                </Button>
              )}
              {baseline && (
                <Button variant="secondary" onClick={() => window.open(factory3dUrl(FACTORY_3D_URL, data.factory.id, baseline.id), '_blank', 'noopener,noreferrer')}>
                  Open baseline in 3D
                </Button>
              )}
              <Button variant="secondary" onClick={() => setView('2d')}>Show 2D floor plan instead</Button>
            </div>
            {!optimized && !baseline && <p>No stored schedule is available to replay yet. Run optimization first.</p>}
          </div>
        </section>
      ) : (
        <FactoryFloorPlan data={data} selectedMachineId={selectedMachineId} onSelectMachine={setSelectedMachineId} />
      )}
    </div>
  )
}
