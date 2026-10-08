import { useState } from 'react'
import Card from '../../components/Card/Card'
import PageHeader from '../../components/PageHeader/PageHeader'
import { useFactory } from '../../context/useFactory'
import { displayValue, machineName, processName } from '../../data/backendView'
import styles from './ProcessesPage.module.css'
import factoryViewStyles from '../FactoryViewPage/FactoryViewPage.module.css'

export default function ProcessesPage() {
  const { backendData, loading, error } = useFactory()
  const [selectedMachineId, setSelectedMachineId] = useState('')
  if (!backendData) {
    return <PageHeader eyebrow={loading ? 'Loading persisted factory data' : 'Factory data unavailable'} title={error ?? 'No factory selected'} />
  }

  const data = backendData
  const selectedMachine = data.machines.find((machine) => machine.id === selectedMachineId) ?? data.machines[0]
  const assignedProcesses = selectedMachine
    ? data.processes.filter((process) => process.machineId === selectedMachine.id)
    : []

  return (
    <div className={styles.page}>
      <PageHeader eyebrow={data.factory.name} title="Processes & machines" />

      <div className={factoryViewStyles.floorLayout}>
        <Card title="Machine inventory · physical layout not stored">
          <div
            className={factoryViewStyles.floorScroller}
            aria-label={`${data.factory.name} persisted machine inventory`}
          >
            <div className={factoryViewStyles.floorFlow}>
              <section className={factoryViewStyles.stageZone} aria-label="Persisted machines">
                <div className={factoryViewStyles.zoneHeader}>
                  <span className={factoryViewStyles.zoneNumber}>{data.machines.length}</span>
                  <h3>Machines</h3>
                </div>
                <div className={factoryViewStyles.zoneMachines}>
                  {data.machines.map((machine) => (
                    <button
                      className={`${factoryViewStyles.machineTile}${machine.id === selectedMachine?.id ? ` ${factoryViewStyles.selectedMachine}` : ''}`}
                      key={machine.id}
                      type="button"
                      aria-pressed={machine.id === selectedMachine?.id}
                      onClick={() => setSelectedMachineId(machine.id)}
                    >
                      <span className={factoryViewStyles.machineTileTop} aria-hidden="true">
                        <svg className={factoryViewStyles.machineGlyph} viewBox="0 0 32 32" fill="none">
                          <path d="M6 7h20v18H6zM10 12h12M10 17h12M10 22h7" />
                        </svg>
                      </span>
                      <span className={factoryViewStyles.machineName}>{machine.name}</span>
                      <span className={factoryViewStyles.machinePower}>
                        {displayValue(machine.ratedPowerKw, ' kW')}
                      </span>
                      <span className={factoryViewStyles.machineStatusText}>
                        {machine.isActive ? 'Active configuration' : 'Inactive configuration'}
                      </span>
                    </button>
                  ))}
                  {data.machines.length === 0 && (
                    <p className={factoryViewStyles.emptyStage}>No machines are persisted for this factory.</p>
                  )}
                </div>
              </section>
            </div>
          </div>
        </Card>

        <Card title="Machine details" className={factoryViewStyles.detailsCard}>
          {selectedMachine ? (
            <>
              <p className={factoryViewStyles.selectedMachineName}>{selectedMachine.name}</p>
              <dl className={factoryViewStyles.machineFacts}>
                <div><dt>Type</dt><dd>{selectedMachine.type ?? 'Not reported'}</dd></div>
                <div><dt>Rated power</dt><dd>{displayValue(selectedMachine.ratedPowerKw, ' kW')}</dd></div>
                <div><dt>Configuration</dt><dd>{selectedMachine.isActive ? 'Active' : 'Inactive'}</dd></div>
                <div>
                  <dt>Assigned processes</dt>
                  <dd>{assignedProcesses.length ? assignedProcesses.map((process) => process.name).join(', ') : 'None persisted'}</dd>
                </div>
              </dl>
            </>
          ) : (
            <p className={factoryViewStyles.emptySelection}>No persisted machine is available to display.</p>
          )}
        </Card>
      </div>

      <Card title="All machines" className={styles.machineCard}>
        <div className={styles.tableScroller}>
          <table className={styles.machineTable}>
            <caption className={styles.visuallyHidden}>
              Persisted machines, types, rated power, and assigned processes
            </caption>
            <thead>
              <tr>
                <th scope="col">Machine</th>
                <th scope="col">Type</th>
                <th scope="col">Rated power</th>
                <th scope="col">Configuration</th>
                <th scope="col">Processes</th>
              </tr>
            </thead>
            <tbody>
              {data.machines.map((machine) => (
                <tr key={machine.id}>
                  <th scope="row">{machine.name}</th>
                  <td>{machine.type ?? 'Not reported'}</td>
                  <td>{displayValue(machine.ratedPowerKw, ' kW')}</td>
                  <td>{machine.isActive ? 'Active' : 'Inactive'}</td>
                  <td>
                    {data.processes.filter((process) => process.machineId === machine.id)
                      .map((process) => process.name).join(', ') || 'None'}
                  </td>
                </tr>
              ))}
              {data.machines.length === 0 && (
                <tr><td className={factoryViewStyles.emptyStage} colSpan={5}>No machines are persisted for this factory.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="All processes" className={styles.machineCard}>
        <div className={styles.tableScroller}>
          <table className={styles.machineTable}>
            <caption className={styles.visuallyHidden}>
              Persisted processes, machine assignments, durations, and power requirements
            </caption>
            <thead>
              <tr>
                <th scope="col">Process</th>
                <th scope="col">Assigned machine</th>
                <th scope="col">Duration</th>
                <th scope="col">Power requirement</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.processes.map((process) => (
                <tr key={process.id}>
                  <th scope="row">{process.name}</th>
                  <td>{machineName(data, process.machineId)}</td>
                  <td>{displayValue(process.durationMinutes, ' min')}</td>
                  <td>{displayValue(process.powerRequirementKw, ' kW')}</td>
                  <td>{process.isActive ? 'Active configuration' : 'Inactive configuration'}</td>
                </tr>
              ))}
              {data.processes.length === 0 && (
                <tr><td colSpan={5}>No processes are persisted for this factory.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Process dependencies">
        {data.dependencies.length ? (
          <ul>{data.dependencies.map((edge) => (
            <li key={edge.id}>
              {processName(data, edge.processId)} depends on {processName(data, edge.dependsOnProcessId)}
              {' '}· {edge.type.replaceAll('_', ' ')} · lag {displayValue(edge.lagMinutes, ' min')}
            </li>
          ))}</ul>
        ) : <p>No process dependencies are persisted for this factory.</p>}
      </Card>
    </div>
  )
}
