import { useState } from 'react'
import Card from '../../components/Card/Card'
import PageHeader from '../../components/PageHeader/PageHeader'
import SegmentedToggle from '../../components/SegmentedToggle/SegmentedToggle'
import StatTile from '../../components/StatTile/StatTile'
import { useFactory } from '../../context/useFactory'
import { displayTimestamp, displayValue, findStoredSchedule, machineName } from '../../data/backendView'
import styles from './FactoryViewPage.module.css'

type ViewType = '2d' | '3d'

function MachineGlyph() {
  return (
    <svg className={styles.machineGlyph} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path d="M6 7h20v18H6zM10 12h12M10 17h12M10 22h7" />
    </svg>
  )
}

export default function FactoryViewPage() {
  const { backendData, loading, error } = useFactory()
  const [view, setView] = useState<ViewType>('2d')
  const [selectedMachineId, setSelectedMachineId] = useState('')
  if (!backendData) {
    return <PageHeader eyebrow={loading ? 'Loading persisted factory data' : 'Factory data unavailable'} title={error ?? 'No factory selected'} />
  }

  const data = backendData
  const selectedMachine = data.machines.find((machine) => machine.id === selectedMachineId) ?? data.machines[0]
  const assignedProcesses = selectedMachine
    ? data.processes.filter((process) => process.machineId === selectedMachine.id)
    : []
  const optimized = findStoredSchedule(data, 'optimized')
  const selectedSlots = optimized?.entries.filter((entry) => entry.machineId === selectedMachine?.id) ?? []

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow={`${data.factory.name} · persisted factory records`}
        title="Factory view"
        actions={
          <div className={styles.viewActions}>
            <span className={styles.viewLabel}>View type</span>
            <SegmentedToggle
              ariaLabel="View type"
              value={view}
              onChange={(value) => setView(value === '3d' ? '3d' : '2d')}
              options={[
                { value: '2d', label: '2D inventory' },
                { value: '3d', label: 'Factory-3D' },
              ]}
            />
          </div>
        }
      />

      <div className={styles.stats} aria-label="Persisted factory summary">
        <StatTile label="Machines" value={data.machines.length} />
        <StatTile label="Processes" value={data.processes.length} />
        <StatTile label="Schedules" value={data.schedules.length} />
        <StatTile label="Energy readings" value={data.energy.length} />
      </div>

      {view === '3d' ? (
        <section className={styles.threeDSlot} aria-label="Factory-3D handoff">
          <div className={styles.threeDContent}>
            <svg className={styles.modelIcon} viewBox="0 0 72 72" fill="none" aria-hidden="true">
              <path d="m36 7 25 14v30L36 65 11 51V21L36 7Z" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
              <path d="m11 21 25 15 25-15M36 36v29m0-29L21 27m15 9 15-9" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
            </svg>
            <h2>{data.factory.name} · Factory-3D</h2>
            <p>
              The authenticated Factory-3D launcher is available in the sidebar. It loads authorized factories and persisted schedules using the signed-in session.
            </p>
            <p>
              This page does not contain a verified physical floor layout or live machine telemetry.
            </p>
            <button type="button" onClick={() => setView('2d')}>Show persisted 2D inventory</button>
          </div>
        </section>
      ) : (
        <>
          <div className={styles.viewNotice} role="status">
            Physical machine positions are not stored; this view shows persisted inventory and assignments only.
          </div>

          <div className={styles.floorLayout}>
            <Card title="Machine inventory · physical layout not stored">
              <div
                className={styles.floorScroller}
                aria-label={`${data.factory.name} persisted machine inventory`}
              >
                <div className={styles.floorFlow}>
                  <section className={styles.stageZone} aria-label="Persisted machines">
                    <div className={styles.zoneHeader}>
                      <span className={styles.zoneNumber}>{data.machines.length}</span>
                      <h3>Machines</h3>
                    </div>
                    <div className={styles.zoneMachines}>
                      {data.machines.map((machine) => (
                        <button
                          className={`${styles.machineTile}${machine.id === selectedMachine?.id ? ` ${styles.selectedMachine}` : ''}`}
                          key={machine.id}
                          type="button"
                          aria-pressed={machine.id === selectedMachine?.id}
                          onClick={() => setSelectedMachineId(machine.id)}
                        >
                          <span className={styles.machineTileTop}>
                            <MachineGlyph />
                          </span>
                          <span className={styles.machineName}>{machine.name}</span>
                          <span className={styles.machinePower}>{displayValue(machine.ratedPowerKw, ' kW rated')}</span>
                          <span className={styles.machineStatusText}>
                            {machine.isActive ? 'Active configuration' : 'Inactive configuration'}
                          </span>
                        </button>
                      ))}
                      {data.machines.length === 0 && (
                        <p className={styles.emptyStage}>No machines are persisted for this factory.</p>
                      )}
                    </div>
                  </section>
                </div>
              </div>
            </Card>

            <Card title="Machine details" className={styles.detailsCard}>
              {selectedMachine ? (
                <>
                  <p className={styles.selectedMachineName}>{selectedMachine.name}</p>
                  <dl className={styles.machineFacts}>
                    <div><dt>Type</dt><dd>{selectedMachine.type ?? 'Not reported'}</dd></div>
                    <div><dt>Rated power</dt><dd>{displayValue(selectedMachine.ratedPowerKw, ' kW')}</dd></div>
                    <div><dt>Configuration</dt><dd>{selectedMachine.isActive ? 'Active' : 'Inactive'}</dd></div>
                    <div>
                      <dt>Assigned processes</dt>
                      <dd>{assignedProcesses.map((process) => process.name).join(', ') || 'None persisted'}</dd>
                    </div>
                    <div>
                      <dt>Optimized schedule entries</dt>
                      <dd>{selectedSlots.length}</dd>
                    </div>
                  </dl>
                  {selectedSlots.length > 0 && (
                    <ul>
                      {selectedSlots.map((entry) => (
                        <li key={entry.id}>
                          {displayTimestamp(entry.startsAt, data.factory.timezone)}–{displayTimestamp(entry.endsAt, data.factory.timezone)}
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <p className={styles.emptySelection}>No persisted machine is available to display.</p>
              )}
            </Card>
          </div>

          <Card title="Process assignments">
            {data.processes.length ? (
              <div className={styles.floorScroller}>
                <ol>
                  {data.processes.map((process) => (
                    <li key={process.id}>
                      {process.name} · {machineName(data, process.machineId)} ·
                      {' '}{displayValue(process.durationMinutes, ' min')} ·
                      {' '}{displayValue(process.powerRequirementKw, ' kW required')}
                    </li>
                  ))}
                </ol>
              </div>
            ) : <p>No process assignments are persisted for this factory.</p>}
          </Card>
        </>
      )}
    </div>
  )
}
