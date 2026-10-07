import Card from '../../components/Card/Card'
import PageHeader from '../../components/PageHeader/PageHeader'
import { useFactory } from '../../context/useFactory'
import { displayValue, machineName, processName } from '../../data/backendView'

export default function ProcessesPage() {
  const { backendData, loading, error } = useFactory()
  if (!backendData) return <PageHeader eyebrow={loading ? 'Loading persisted factory data' : 'Factory data unavailable'} title={error ?? 'No factory selected'} />
  const data = backendData

  return (
    <>
      <PageHeader eyebrow={data.factory.name} title="Processes & machines" />
      <Card title="Persisted processes and machine assignments">
        {data.processes.length ? (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr><th>Process</th><th>Assigned machine</th><th>Duration</th><th>Power requirement</th></tr></thead>
              <tbody>{data.processes.map((process) => (
                <tr key={process.id}>
                  <th>{process.name}</th><td>{machineName(data, process.machineId)}</td>
                  <td>{displayValue(process.durationMinutes, ' min')}</td>
                  <td>{displayValue(process.powerRequirementKw, ' kW')}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <p>No processes are persisted for this factory.</p>}
      </Card>
      <Card title="Persisted machine inventory">
        {data.machines.length ? (
          <ul>{data.machines.map((machine) => <li key={machine.id}>{machine.name} · {machine.type ?? 'Type not specified'} · rated power {displayValue(machine.ratedPowerKw, ' kW')} · live status and utilization not reported</li>)}</ul>
        ) : <p>No machines are persisted for this factory.</p>}
      </Card>
      <Card title="Process dependencies">
        {data.dependencies.length ? (
          <ul>{data.dependencies.map((edge) => (
            <li key={edge.id}>{processName(data, edge.processId)} depends on {processName(data, edge.dependsOnProcessId)} · {edge.type}, lag {edge.lagMinutes} min</li>
          ))}</ul>
        ) : <p>No process dependencies are persisted for this factory.</p>}
      </Card>
    </>
  )
}
