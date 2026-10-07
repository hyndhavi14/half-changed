import Button from '../../components/Button/Button'
import Card from '../../components/Card/Card'
import PageHeader from '../../components/PageHeader/PageHeader'
import StatTile from '../../components/StatTile/StatTile'
import { useFactory } from '../../context/useFactory'
import { displayTimestamp, displayValue, findStoredSchedule, machineName, processName } from '../../data/backendView'

export default function DashboardPage() {
  const { backendData, loading, error, runOptimization, optimizing, optimizationError } = useFactory()
  if (!backendData) {
    return <PageHeader eyebrow={loading ? 'Loading persisted factory data' : 'Factory data unavailable'} title={error ?? 'No factory selected'} />
  }

  const data = backendData
  const optimized = findStoredSchedule(data, 'optimized')
  const entries = optimized?.entries ?? []

  return (
    <>
      <PageHeader
        eyebrow="Persisted Backend / Supabase data"
        title={`${data.factory.name} dashboard`}
        actions={<Button variant="primary" isLoading={optimizing} onClick={() => void runOptimization()}>Run optimization</Button>}
      />
      {optimizationError && <Card title="Optimization failed"><p role="alert">{optimizationError}</p></Card>}
      <section aria-label="Persisted factory counts" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 12 }}>
        <StatTile label="Machines" value={data.machines.length} />
        <StatTile label="Processes" value={data.processes.length} />
        <StatTile label="Dependencies" value={data.dependencies.length} />
        <StatTile label="Stored schedules" value={data.schedules.length} />
        <StatTile label="Energy records" value={data.energy.length} />
      </section>
      <Card title={optimized ? `Persisted optimized schedule · ${optimized.name}` : 'No persisted optimized schedule'}>
        {optimized ? (
          <>
            <p>Schedule UUID: <code>{optimized.id}</code></p>
            <p>Horizon: {displayTimestamp(optimized.horizonStart, data.factory.timezone)} – {displayTimestamp(optimized.horizonEnd, data.factory.timezone)}</p>
            <p>Persisted energy: {displayValue(optimized.totalEnergyKwh, ' kWh')} · Persisted cost: {displayValue(optimized.totalEnergyCost, ` ${data.factory.currency}`)}</p>
            <ul>
              {entries.map((entry) => (
                <li key={entry.id}>
                  {processName(data, entry.processId)} · {machineName(data, entry.machineId)} ·
                  {' '}{displayTimestamp(entry.startsAt, data.factory.timezone)} – {displayTimestamp(entry.endsAt, data.factory.timezone)}
                </li>
              ))}
            </ul>
          </>
        ) : <p>No optimized schedule is persisted for this factory.</p>}
      </Card>
      <Card title="Machine inventory">
        {data.machines.length ? (
          <ul>{data.machines.map((machine) => <li key={machine.id}>{machine.name} · rated power {displayValue(machine.ratedPowerKw, ' kW')} · status not reported</li>)}</ul>
        ) : <p>No machines are persisted for this factory.</p>}
      </Card>
    </>
  )
}
