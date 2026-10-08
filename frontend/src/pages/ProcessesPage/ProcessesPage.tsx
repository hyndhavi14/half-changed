import { useState } from 'react'
import Card from '../../components/Card/Card'
import PageHeader from '../../components/PageHeader/PageHeader'
import ProgressBar from '../../components/ProgressBar/ProgressBar'
import ProvenanceTag from '../../components/ProvenanceTag/ProvenanceTag'
import StatusChip from '../../components/StatusChip/StatusChip'
import { useFactory } from '../../context/useFactory'
import { displayTimestamp, displayValue, findStoredSchedule, machineName, processName } from '../../data/backendView'
import { NOT_AVAILABLE, plannedLoadPct } from '../DashboardPage/dashboardView'
import { FactoryFloorPlan } from '../FactoryViewPage/FactoryViewPage'
import { flowPlan } from '../FactoryViewPage/factoryViewModel'
import styles from './ProcessesPage.module.css'

function dependencyText(type: string, lag: number): string {
  const kind = type.replaceAll('_', ' ')
  return lag ? `${kind}, lag ${lag} min` : kind
}

export default function ProcessesPage() {
  const { backendData, loading, error } = useFactory()
  const [selectedMachineId, setSelectedMachineId] = useState('')
  if (!backendData) {
    return <PageHeader eyebrow={loading ? 'Loading persisted factory data' : 'Factory data unavailable'} title={error ?? 'No factory selected'} />
  }

  const data = backendData
  const optimized = findStoredSchedule(data, 'optimized')
  const plan = flowPlan(data)
  const stageOf = new Map<string, string>()
  for (const zone of plan.zones) for (const id of zone.machineIds) stageOf.set(id, `${zone.number}. ${zone.title}`)
  const parents = (processId: string) => data.dependencies.filter((edge) => edge.processId === processId)

  return (
    <div className={styles.page}>
      <PageHeader eyebrow={`${data.factory.name} · ${data.factory.timezone}`} title="Processes & machines" />

      <FactoryFloorPlan data={data} selectedMachineId={selectedMachineId} onSelectMachine={setSelectedMachineId} />

      <Card title="All machines" className={styles.machineCard} provenance={optimized ? <ProvenanceTag provenance="planned" /> : undefined}>
        <div className={styles.tableScroller} tabIndex={0} role="region" aria-label="All machines table, scrollable">
          <table className={styles.machineTable}>
            <caption className={styles.visuallyHidden}>
              Machines, flow stages, types, rated power, configuration state and planned load
            </caption>
            <thead>
              <tr>
                <th scope="col">Machine</th>
                <th scope="col">Stage</th>
                <th scope="col">Type</th>
                <th scope="col">Rated power</th>
                <th scope="col">Status</th>
                <th scope="col">Planned load</th>
              </tr>
            </thead>
            <tbody>
              {data.machines.map((machine) => {
                const load = optimized ? plannedLoadPct(optimized, machine.id) : null
                return (
                  <tr key={machine.id}>
                    <th scope="row">{machine.name}</th>
                    <td>{stageOf.get(machine.id) ?? 'No assigned process'}</td>
                    <td>{machine.type ? machine.type.replaceAll('_', ' ') : NOT_AVAILABLE}</td>
                    <td>{displayValue(machine.ratedPowerKw, ' kW')}</td>
                    <td><StatusChip status={machine.isActive ? 'Active' : 'Inactive'} /></td>
                    <td>
                      {load === null ? NOT_AVAILABLE : (
                        <div className={styles.utilization}>
                          <ProgressBar value={load} ariaLabel={`${machine.name} planned load`} />
                          <span>{Math.round(load)}%</span>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
              {data.machines.length === 0 && (
                <tr><td colSpan={6}>No machines are stored for this factory.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className={styles.note}>
          Planned load is the share of the optimized schedule horizon each machine is booked. It is planned, not measured machine activity. Each machine runs one process at a time.
        </p>
      </Card>

      <Card title="All processes" className={styles.machineCard}>
        <div className={styles.tableScroller} tabIndex={0} role="region" aria-label="All processes table, scrollable">
          <table className={styles.machineTable}>
            <caption className={styles.visuallyHidden}>
              Processes with machine, duration, power, quantity, dependencies and configuration state
            </caption>
            <thead>
              <tr>
                <th scope="col">Process</th>
                <th scope="col">Machine</th>
                <th scope="col">Duration</th>
                <th scope="col">Power</th>
                <th scope="col">Quantity</th>
                <th scope="col">Runs after</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.processes.map((process) => {
                const after = parents(process.id)
                return (
                  <tr key={process.id}>
                    <th scope="row">{process.name}</th>
                    <td>{machineName(data, process.machineId)}</td>
                    <td>{displayValue(process.durationMinutes, ' min')}</td>
                    <td>{displayValue(process.powerRequirementKw, ' kW')}</td>
                    <td>{process.quantity === null ? NOT_AVAILABLE : `${process.quantity}${process.unit ? ` ${process.unit}` : ''}`}</td>
                    <td className={styles.wrapCell}>
                      {after.length
                        ? after.map((edge) => `${processName(data, edge.dependsOnProcessId)} (${dependencyText(edge.type, edge.lagMinutes)})`).join(', ')
                        : 'No dependency'}
                    </td>
                    <td><StatusChip status={process.isActive ? 'Active' : 'Inactive'} /></td>
                  </tr>
                )
              })}
              {data.processes.length === 0 && (
                <tr><td colSpan={7}>No processes are stored for this factory.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className={styles.note}>
          The optimizer enforces durations, machine assignment, one process per machine at a time and finish-to-start dependencies with zero lag.
        </p>
      </Card>

      <Card title="Production orders" className={styles.machineCard}>
        <div className={styles.tableScroller} tabIndex={0} role="region" aria-label="Production orders table, scrollable">
          <table className={styles.machineTable}>
            <caption className={styles.visuallyHidden}>Stored production orders</caption>
            <thead>
              <tr>
                <th scope="col">Order</th>
                <th scope="col">Product</th>
                <th scope="col">Quantity</th>
                <th scope="col">Due</th>
                <th scope="col">Priority</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.orders.map((order) => (
                <tr key={order.id}>
                  <th scope="row">{order.reference}</th>
                  <td className={styles.wrapCell}>{order.product ?? NOT_AVAILABLE}</td>
                  <td>{order.quantity}{order.unit ? ` ${order.unit}` : ''}</td>
                  <td>{order.dueAt ? displayTimestamp(order.dueAt, data.factory.timezone) : NOT_AVAILABLE}</td>
                  <td>{order.priority}</td>
                  <td>{order.status.replaceAll('_', ' ')}</td>
                </tr>
              ))}
              {data.orders.length === 0 && (
                <tr><td colSpan={6}>No production orders are stored for this factory.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className={styles.note}>
          Stored orders are not linked to processes, so the optimizer does not schedule them; they are shown as recorded.
        </p>
      </Card>
    </div>
  )
}
