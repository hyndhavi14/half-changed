import Card from '../../components/Card/Card'
import EnergyChart from '../../components/EnergyChart/EnergyChart'
import Legend from '../../components/Legend/Legend'
import PageHeader from '../../components/PageHeader/PageHeader'
import StatTile from '../../components/StatTile/StatTile'
import { useFactory } from '../../context/useFactory'
import { displayTimestamp, displayValue, findStoredSchedule } from '../../data/backendView'
import { aggregateMeasuredEnergy } from '../energyChartData'
import styles from './EnergyPage.module.css'

function rowString(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  return typeof value === 'string' || typeof value === 'number' ? String(value) : 'Not available'
}

function rowNumber(row: Record<string, unknown>, key: string): number | null {
  const value = row[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function sumKnown(rows: Record<string, unknown>[], key: string): number | null {
  const values = rows.map((row) => rowNumber(row, key)).filter((value): value is number => value !== null)
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null
}

function formatEnergy(value: number | null): string {
  return value === null
    ? 'Not available'
    : `${value.toLocaleString('en-IN', { maximumFractionDigits: 2 })} kWh`
}

export default function EnergyPage() {
  const { backendData, loading, error } = useFactory()
  if (!backendData) {
    return <PageHeader eyebrow={loading ? 'Loading persisted factory data' : 'Factory data unavailable'} title={error ?? 'No factory selected'} />
  }

  const data = backendData
  const sortedEnergy = [...data.energy].sort((left, right) =>
    rowString(left, 'recorded_at').localeCompare(rowString(right, 'recorded_at')),
  )
  const optimized = findStoredSchedule(data, 'optimized')
  const consumption = sumKnown(data.energy, 'consumption_kwh')
  const generation = sumKnown(data.energy, 'generation_kwh')
  const cost = optimized?.totalEnergyCost ?? null
  const hourlyEnergy = aggregateMeasuredEnergy(data.energy, data.factory.timezone)
  const tariffs = [...data.tariffs].sort((left, right) =>
    rowString(left, 'start_time').localeCompare(rowString(right, 'start_time')),
  )

  return (
    <div className={styles.page}>
      <PageHeader eyebrow={data.factory.name} title="Energy analysis" />

      <div className={styles.stats}>
        <StatTile label="Recorded consumption" value={formatEnergy(consumption)} />
        <StatTile label="Recorded generation" value={formatEnergy(generation)} />
        <StatTile label="Persisted readings" value={data.energy.length} />
        <StatTile
          label="Optimized schedule cost"
          value={displayValue(cost, ` ${data.factory.currency}`)}
        />
      </div>

      <Card title="Recorded energy by hour of day">
        <Legend
          items={[
            { label: 'Generation', color: 'var(--sun)', shape: 'square' },
            { label: 'Consumption', color: 'var(--grid-brown)', shape: 'square' },
          ]}
        />
        {hourlyEnergy.length ? (
          <EnergyChart
            measuredEnergy={hourlyEnergy}
            firstSeriesLabel="Generation"
            secondSeriesLabel="Consumption"
            height={260}
          />
        ) : (
          <p className={styles.allocationNote}>No hourly generation and consumption readings are available for this factory.</p>
        )}
        {hourlyEnergy.length > 0 && (
          <p className={styles.allocationNote}>
            Intervals with the same local hour are aggregated across the persisted reading history.
          </p>
        )}
        {sortedEnergy.length ? (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr><th scope="col">Timestamp</th><th scope="col">Interval</th><th scope="col">Consumption</th><th scope="col">Generation</th><th scope="col">Source</th></tr>
              </thead>
              <tbody>
                {sortedEnergy.map((row, index) => {
                  const timestamp = rowString(row, 'recorded_at')
                  const date = new Date(timestamp)
                  const id = rowString(row, 'id')
                  return (
                    <tr key={id === 'Not available' ? `${timestamp}-${index}` : id}>
                      <th scope="row">
                        {Number.isFinite(date.getTime())
                          ? displayTimestamp(timestamp, data.factory.timezone)
                          : 'Invalid timestamp'}
                      </th>
                      <td>{displayValue(row.interval_minutes, ' min')}</td>
                      <td>{displayValue(rowNumber(row, 'consumption_kwh'), ' kWh')}</td>
                      <td>{displayValue(rowNumber(row, 'generation_kwh'), ' kWh')}</td>
                      <td>{rowString(row, 'source')}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={styles.allocationNote}>No energy readings are persisted for this factory.</p>
        )}
      </Card>

      <Card title="Cost by tariff band">
        {tariffs.length ? (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr><th scope="col">Tariff</th><th scope="col">Window</th><th scope="col">Rate</th></tr>
              </thead>
              <tbody>
                {tariffs.map((tariff, index) => {
                  const id = rowString(tariff, 'id')
                  return (
                    <tr key={id === 'Not available' ? `tariff-${index}` : id}>
                      <th scope="row">{rowString(tariff, 'name')}</th>
                      <td>{rowString(tariff, 'start_time')}–{rowString(tariff, 'end_time')}</td>
                      <td>{rowString(tariff, 'energy_price_per_kwh')} {rowString(tariff, 'currency')}/kWh</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <p className={styles.allocationNote}>
              Persisted tariff windows and rates are shown as stored. Per-band costs are not inferred from readings.
            </p>
          </div>
        ) : (
          <p className={styles.allocationNote}>
            No electricity tariffs are persisted for this factory. Historical SolarShift tariff assumptions are shown only in the public replay.
          </p>
        )}
      </Card>
    </div>
  )
}
