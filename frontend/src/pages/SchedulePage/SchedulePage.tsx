import { useMemo, useState } from 'react'
import Button from '../../components/Button/Button'
import Card from '../../components/Card/Card'
import PageHeader from '../../components/PageHeader/PageHeader'
import { useFactory } from '../../context/useFactory'
import { displayTimestamp, displayValue, machineName, processName, scheduleKind } from '../../data/backendView'

export default function SchedulePage() {
  const { backendData, loading, error, runOptimization, optimizing, optimizationError } = useFactory()
  const schedules = backendData?.schedules ?? []
  const initial = schedules.find((schedule) => scheduleKind(schedule) === 'optimized') ?? schedules[0]
  const [scheduleId, setScheduleId] = useState('')
  const selected = schedules.find((schedule) => schedule.id === scheduleId) ?? initial
  const selectedEntries = useMemo(() => selected?.entries ?? [], [selected])
  if (!backendData) return <PageHeader eyebrow={loading ? 'Loading persisted factory data' : 'Factory data unavailable'} title={error ?? 'No factory selected'} />
  const data = backendData

  return (
    <>
      <PageHeader eyebrow={data.factory.name} title="Production schedule" />
      <Card title="Select a persisted schedule">
        {schedules.length ? (
          <label>
            Schedule
            <select value={selected?.id ?? ''} onChange={(event) => setScheduleId(event.currentTarget.value)}>
              {schedules.map((schedule) => {
                const kind = scheduleKind(schedule)
                const label = kind === 'optimized' ? 'SolarShift optimized schedule' : kind === 'baseline' ? 'Baseline schedule' : schedule.name
                return <option key={schedule.id} value={schedule.id}>{label} · {schedule.name}</option>
              })}
            </select>
          </label>
        ) : <p>No persisted schedules are available.</p>}
      </Card>
      {selected && (
        <Card title={scheduleKind(selected) === 'optimized' ? 'SolarShift optimized schedule' : scheduleKind(selected) === 'baseline' ? 'Baseline schedule' : selected.name}>
          <p>Schedule UUID: <code>{selected.id}</code> · Status: {selected.status}</p>
          <p>Horizon: {displayTimestamp(selected.horizonStart, data.factory.timezone)} – {displayTimestamp(selected.horizonEnd, data.factory.timezone)}</p>
          <p>Persisted energy: {displayValue(selected.totalEnergyKwh, ' kWh')} · Persisted cost: {displayValue(selected.totalEnergyCost, ` ${data.factory.currency}`)}</p>
          {selectedEntries.length ? (
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead><tr><th>Process</th><th>Machine</th><th>Starts</th><th>Ends</th><th>Power</th><th>Energy</th><th>Cost</th></tr></thead>
                <tbody>{selectedEntries.map((entry) => (
                  <tr key={entry.id}>
                    <th>{processName(data, entry.processId)}</th><td>{machineName(data, entry.machineId)}</td>
                    <td>{displayTimestamp(entry.startsAt, data.factory.timezone)}</td><td>{displayTimestamp(entry.endsAt, data.factory.timezone)}</td>
                    <td>{displayValue(entry.powerKw, ' kW')}</td><td>{displayValue(entry.energyKwh, ' kWh')}</td><td>{displayValue(entry.cost, ` ${data.factory.currency}`)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <p>This persisted schedule has no entries.</p>}
        </Card>
      )}
      {optimizationError && <Card title="Optimization failed"><p role="alert">{optimizationError}</p></Card>}
      <Button variant="primary" isLoading={optimizing} onClick={() => void runOptimization()}>Run protected Backend optimization</Button>
    </>
  )
}
