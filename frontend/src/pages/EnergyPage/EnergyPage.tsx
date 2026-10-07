import Card from '../../components/Card/Card'
import PageHeader from '../../components/PageHeader/PageHeader'
import { useFactory } from '../../context/useFactory'
import { displayTimestamp, displayValue } from '../../data/backendView'

function rowString(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  return typeof value === 'string' || typeof value === 'number' ? String(value) : 'Not available'
}

export default function EnergyPage() {
  const { backendData, loading, error } = useFactory()
  if (!backendData) return <PageHeader eyebrow={loading ? 'Loading persisted factory data' : 'Factory data unavailable'} title={error ?? 'No factory selected'} />
  const data = backendData
  const sortedEnergy = [...data.energy].sort((a, b) => rowString(a, 'recorded_at').localeCompare(rowString(b, 'recorded_at')))

  return (
    <>
      <PageHeader eyebrow={data.factory.name} title="Energy analysis" />
      <Card title="Persisted energy readings">
        <p>{data.energy.length} records loaded from the selected factory’s Backend energy-data endpoint.</p>
        {sortedEnergy.length ? (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr><th>Timestamp</th><th>Interval</th><th>Consumption</th><th>Generation</th><th>Source</th></tr></thead>
              <tbody>{sortedEnergy.map((row, index) => {
                const timestamp = rowString(row, 'recorded_at')
                const date = new Date(timestamp)
                return (
                  <tr key={rowString(row, 'id') === 'Not available' ? `${timestamp}-${index}` : rowString(row, 'id')}>
                    <td>{Number.isFinite(date.getTime()) ? displayTimestamp(timestamp, data.factory.timezone) : 'Invalid timestamp'}</td>
                    <td>{displayValue(row.interval_minutes, ' min')}</td>
                    <td>{displayValue(row.consumption_kwh, ' kWh')}</td>
                    <td>{displayValue(row.generation_kwh, ' kWh')}</td>
                    <td>{rowString(row, 'source')}</td>
                  </tr>
                )
              })}</tbody>
            </table>
          </div>
        ) : <p>No energy readings are persisted for this factory.</p>}
      </Card>
      <Card title="Persisted electricity tariffs">
        {data.tariffs.length ? (
          <ul>{data.tariffs.map((tariff, index) => (
            <li key={rowString(tariff, 'id') === 'Not available' ? `tariff-${index}` : rowString(tariff, 'id')}>
              {rowString(tariff, 'name')} · {rowString(tariff, 'start_time')}–{rowString(tariff, 'end_time')} · {rowString(tariff, 'energy_price_per_kwh')} {rowString(tariff, 'currency')}/kWh
            </li>
          ))}</ul>
        ) : <p>No legacy electricity tariffs are persisted for this factory. Scenario APERC kVAh tariffs are isolated in the historical replay.</p>}
      </Card>
    </>
  )
}
