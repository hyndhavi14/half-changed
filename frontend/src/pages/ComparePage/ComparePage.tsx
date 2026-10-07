import Card from '../../components/Card/Card'
import PageHeader from '../../components/PageHeader/PageHeader'
import { useFactory } from '../../context/useFactory'
import { displayValue, findStoredSchedule } from '../../data/backendView'

export default function ComparePage() {
  const { backendData, loading, error } = useFactory()
  if (!backendData) return <PageHeader eyebrow={loading ? 'Loading persisted factory data' : 'Factory data unavailable'} title={error ?? 'No factory selected'} />
  const baseline = findStoredSchedule(backendData, 'baseline')
  const optimized = findStoredSchedule(backendData, 'optimized')

  return (
    <>
      <PageHeader eyebrow={backendData.factory.name} title="Baseline vs optimized" />
      {baseline && optimized ? (
        <Card title="Persisted schedule comparison">
          <p>Both schedules are persisted Backend outputs. Costs exclude any charges not represented by their stored schedule totals.</p>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr><th>Metric</th><th>Baseline schedule</th><th>Optimized schedule</th></tr></thead>
              <tbody>
                <tr><th>Schedule UUID</th><td><code>{baseline.id}</code></td><td><code>{optimized.id}</code></td></tr>
                <tr><th>Status</th><td>{baseline.status}</td><td>{optimized.status}</td></tr>
                <tr><th>Total energy</th><td>{displayValue(baseline.totalEnergyKwh, ' kWh')}</td><td>{displayValue(optimized.totalEnergyKwh, ' kWh')}</td></tr>
                <tr><th>Total stored energy cost</th><td>{displayValue(baseline.totalEnergyCost, ` ${backendData.factory.currency}`)}</td><td>{displayValue(optimized.totalEnergyCost, ` ${backendData.factory.currency}`)}</td></tr>
                <tr><th>Schedule entries</th><td>{baseline.entries.length}</td><td>{optimized.entries.length}</td></tr>
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <Card title="Persisted schedules unavailable">
          <p>A baseline and optimized schedule pair was not found by its stored name or metadata. No comparison values are generated.</p>
        </Card>
      )}
    </>
  )
}
