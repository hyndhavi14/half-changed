import Card from '../../components/Card/Card'
import PageHeader from '../../components/PageHeader/PageHeader'
import { useFactory } from '../../context/useFactory'
import { displayValue, machineName, processName } from '../../data/backendView'

export default function FactoryViewPage() {
  const { backendData, loading, error } = useFactory()
  if (!backendData) return <PageHeader eyebrow={loading ? 'Loading persisted factory data' : 'Factory data unavailable'} title={error ?? 'No factory selected'} />
  const data = backendData

  return (
    <>
      <PageHeader eyebrow={`${data.factory.name} · persisted factory records`} title="Factory view" />
      <Card title="Illustrative 2D process flow">
        <p>Machine identities and process assignments are loaded from Backend. This is not a verified physical floor layout; machine telemetry is not reported.</p>
        {data.processes.length ? (
          <ol>{data.processes.map((process) => (
            <li key={process.id}>
              {process.name} → {machineName(data, process.machineId)} · {displayValue(process.durationMinutes, ' min')} · {displayValue(process.powerRequirementKw, ' kW required')}
            </li>
          ))}</ol>
        ) : <p>No process flow is persisted for this factory.</p>}
      </Card>
      <Card title="Machine inventory">
        {data.machines.length ? (
          <ul>{data.machines.map((machine) => <li key={machine.id}>{machine.name} · {machine.type ?? 'Type not specified'} · rated {displayValue(machine.ratedPowerKw, ' kW')} · status and current power not reported</li>)}</ul>
        ) : <p>No machines are persisted for this factory.</p>}
      </Card>
      <Card title="Factory-3D">
        <p>The 3D scene is illustrative. Use the separate authenticated Factory-3D launcher after selecting a persisted schedule; this view does not simulate machine telemetry.</p>
        <p>Persisted processes: {data.processes.map((process) => processName(data, process.id)).join(', ') || 'none'}.</p>
      </Card>
    </>
  )
}
