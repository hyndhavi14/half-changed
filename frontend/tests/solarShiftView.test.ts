import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clockText,
  dailyBars,
  entryEnergyUnits,
  overviewRow,
  scenarioCompare,
  scheduleEntries,
  scheduleFor,
  showInr,
  showKwh,
  tariffDaySegments,
  text,
} from '../src/pages/solarShiftView.ts'

const schedules = [
  { id: 'b', name: 'SolarShift historical baseline', total_energy_cost: '2000.00', metadata: { makespan_minutes: 1380, modeled_solar_kwh: '100.0', modeled_grid_kwh: '900.0' } },
  { id: 'o', name: 'SolarShift historical optimized', total_energy_cost: '1446.2376', metadata: { makespan_minutes: 1500, modeled_solar_kwh: '600.0', modeled_grid_kwh: '400.0' } },
]
const scenario = {
  factory: {}, manifest: { scenario_code: 'HGD', nasa_total_wh_m2: '37542.40', modeled_pv_total_kwh: '9010.1760', solar_statistics: { daily_totals_wh_m2: [{ date: '2026-03-11', total_wh_m2: '5000' }, { date: '2026-03-12', total_wh_m2: '2500' }, { date: 'x', total_wh_m2: 'bad' }] } },
  energyRows: [], hourlyProfile: [], tariffs: [], requests: [], results: [], processes: [], machines: [],
  schedules,
  entries: [
    { id: 'e2', schedule_id: 'o', starts_at: '2026-03-12T05:00:00Z', metadata: { solar_energy_units: '600000', grid_energy_units: '300000' } },
    { id: 'e1', schedule_id: 'o', starts_at: '2026-03-12T04:00:00Z', metadata: {} },
    { id: 'e0', schedule_id: 'b', starts_at: '2026-03-12T01:00:00Z', metadata: {} },
  ],
}

test('schedules and entries are found by their persisted names and sorted by start', () => {
  assert.equal(scheduleFor(scenario, 'baseline')?.id, 'b')
  assert.deepEqual(scheduleEntries(scenario, scheduleFor(scenario, 'optimized')).map((entry) => entry.id), ['e1', 'e2'])
  assert.deepEqual(scheduleEntries(scenario, undefined), [])
})

test('entry solar/grid energy comes from optimizer units and is never invented', () => {
  assert.equal(entryEnergyUnits(scenario.entries[0], 'solar_energy_units'), 1)
  assert.equal(entryEnergyUnits(scenario.entries[0], 'grid_energy_units'), 0.5)
  assert.equal(entryEnergyUnits(scenario.entries[1], 'solar_energy_units'), null)
  assert.equal(showKwh(null), 'Not available')
})

test('baseline vs optimized compare colours improvements green and regressions red', () => {
  const rows = scenarioCompare(scenario)
  const byLabel = Object.fromEntries(rows.map((row) => [row.label, row]))
  assert.equal(byLabel['Modeled tariff energy cost'].changeTone, 'good')
  assert.equal(byLabel['Modeled tariff energy cost'].change, '27.7% lower')
  assert.equal(byLabel['Modeled solar allocation'].changeTone, 'good')
  assert.equal(byLabel['Modeled grid energy'].changeTone, 'good')
  assert.equal(byLabel['Completion / makespan'].changeTone, 'bad')
  assert.deepEqual(scenarioCompare({ schedules: [] }), [])
})

test('overview row uses stored values and a calculated cost change', () => {
  const row = overviewRow(scenario as never)
  assert.equal(row.code, 'HGD')
  assert.equal(row.nasaTotal, '37,542.40 Wh/m²')
  assert.equal(row.modeledPv, '9010.1760 kWh')
  assert.equal(row.optimizedCost, showInr('1446.2376'))
  assert.equal(row.costChange, '−27.7%')
  const empty = overviewRow({ ...scenario, schedules: [] } as never)
  assert.equal(empty.costChange, 'Not available')
  assert.equal(empty.baselineCost, 'Not available')
})

test('daily bars are scaled to the highest day and skip invalid totals', () => {
  assert.deepEqual(dailyBars(scenario.manifest), [
    { date: '2026-03-11', value: 5000, pct: 100 },
    { date: '2026-03-12', value: 2500, pct: 50 },
  ])
  assert.deepEqual(dailyBars({}), [])
})

test('APERC day strip treats 00:00 as midnight and skips unknown bands', () => {
  const segments = tariffDaySegments([
    { band: 'normal', start_time: '22:00:00', end_time: '00:00:00' },
    { band: 'off_peak', start_time: '00:00:00', end_time: '06:00:00' },
    { band: 'demand', start_time: '00:00:00', end_time: '06:00:00' },
  ])
  assert.deepEqual(segments.map((segment) => segment.band), ['off_peak', 'normal'])
  assert.equal(segments[1].endFraction, 1)
  assert.equal(clockText('06:00:00'), '06:00')
  assert.equal(text(undefined), 'Not available')
})
