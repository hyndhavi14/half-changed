import assert from 'node:assert/strict'
import test from 'node:test'
import {
  bandAllocation,
  dayTariffBands,
  daysText,
  defaultEnergyDay,
  excludedChargesNote,
  formatMoney,
  fullDayPoints,
  plannedTotals,
  readingsSummary,
  readingsSummaryText,
  tariffWindowLines,
} from '../src/pages/EnergyPage/energyPageView.ts'
import { tariffWindows } from '../src/pages/DashboardPage/dashboardView.ts'
import { sourceTag } from '../src/pages/sourceProvenance.ts'

const SEED_TARIFFS = [
  { name: 'Off-peak', currency: 'EUR', start_time: '22:00:00', end_time: '07:00:00', days_of_week: null, energy_price_per_kwh: '0.0850', demand_charge_per_kw: '0', fixed_charge: '0', tax_rate: '0.21', priority: 10, metadata: { band: 'off_peak' } },
  { name: 'Shoulder', currency: 'EUR', start_time: '07:00:00', end_time: '22:00:00', days_of_week: null, energy_price_per_kwh: '0.1420', demand_charge_per_kw: '0', fixed_charge: '0', tax_rate: '0.21', priority: 10, metadata: { band: 'shoulder' } },
  { name: 'Peak', currency: 'EUR', start_time: '17:00:00', end_time: '22:00:00', days_of_week: [1, 2, 3, 4, 5], energy_price_per_kwh: '0.2180', demand_charge_per_kw: '0', fixed_charge: '0', tax_rate: '0.21', priority: 20, metadata: { band: 'peak' } },
  { name: 'Demand', currency: 'EUR', start_time: '00:00:00', end_time: '23:59:00', days_of_week: null, energy_price_per_kwh: '0.0000', demand_charge_per_kw: '18.50', fixed_charge: '145.00', tax_rate: '0.21', priority: 30, metadata: { band: 'demand' } },
]
const factory = { id: 'f', slug: 'f', name: 'F', timezone: 'UTC', currency: 'EUR', description: null, config: {} }

function entry(id: string, startsAt: string, endsAt: string, powerKw: number | null, energyKwh: number | null, cost: number | null, metadata: Record<string, unknown> = {}) {
  return { id, scheduleId: 's', machineId: 'm', processId: 'p', productionOrderId: null, startsAt, endsAt, powerKw, energyKwh, cost, quantity: null, sequence: 0, metadata }
}
function schedule(entries: ReturnType<typeof entry>[], cost: number | null = 10, kwh: number | null = 100) {
  return { id: 's', factoryId: 'f', name: 'Optimized', version: 1, status: 'published', horizonStart: '2026-01-05T00:00:00Z', horizonEnd: '2026-01-06T00:00:00Z', optimizationRequestId: null, optimizationResultId: null, entries, metadata: { kind: 'optimized' }, totalEnergyCost: cost, totalEnergyKwh: kwh } as never
}
function reading(at: string, consumption: unknown, generation: unknown, source = 'simulated') {
  return { recorded_at: at, interval_minutes: 15, consumption_kwh: consumption, generation_kwh: generation, source }
}

test('default day is the day with the most readings, not a partial last day', () => {
  const rows = [
    reading('2026-01-05T10:00:00Z', 1, 1), reading('2026-01-05T11:00:00Z', 1, 1),
    reading('2026-01-06T00:15:00Z', 1, 0),
  ]
  assert.equal(defaultEnergyDay(rows, 'UTC'), '2026-01-05')
  assert.equal(defaultEnergyDay([], 'UTC'), undefined)
})

test('full-day points keep missing hours as null and sum readings per local hour', () => {
  const rows = [reading('2026-01-05T10:00:00Z', '2.5', '1'), reading('2026-01-05T10:15:00Z', 2.5, 1), reading('2026-01-05T11:00:00Z', 'x', 1)]
  const points = fullDayPoints(rows, 'UTC', '2026-01-05')
  assert.equal(points.length, 24)
  assert.deepEqual(points[10], { hour: 10, generationKwh: 2, consumptionKwh: 5 })
  assert.deepEqual(points[11], { hour: 11, generationKwh: null, consumptionKwh: null })
  assert.equal(points[0].generationKwh, null)
})

test('day tariff bands follow backend priority and ignore demand-only rows', () => {
  const bands = dayTariffBands(tariffWindows(SEED_TARIFFS), '2026-01-05') // Monday
  assert.equal(bands.length, 24)
  assert.equal(bands[3], 'off')
  assert.equal(bands[10], 'mid')
  assert.equal(bands[18], 'peak')
  assert.equal(bands[22], 'off')
  const sunday = dayTariffBands(tariffWindows(SEED_TARIFFS), '2026-01-11')
  assert.ok(!sunday.includes('peak'))
})

test('planned totals report solar/grid only when every entry has both values', () => {
  const full = plannedTotals(schedule([
    entry('a', '2026-01-05T10:00:00Z', '2026-01-05T11:00:00Z', 10, 10, 1, { solar_kwh: 6, grid_kwh: 4 }),
    entry('b', '2026-01-05T11:00:00Z', '2026-01-05T12:00:00Z', 10, 10, 1, { solar_kwh: 2, grid_kwh: 8 }),
  ]))
  assert.equal(full.solarKwh, 8)
  assert.equal(full.gridKwh, 12)
  assert.equal(full.solarSharePct, 40)
  assert.equal(full.cost, 10)
  const partial = plannedTotals(schedule([
    entry('a', '2026-01-05T10:00:00Z', '2026-01-05T11:00:00Z', 10, 10, 1, { solar_kwh: 6, grid_kwh: 4 }),
    entry('b', '2026-01-05T11:00:00Z', '2026-01-05T12:00:00Z', 10, 10, 1),
  ], null, null))
  assert.equal(partial.solarKwh, null)
  assert.equal(partial.gridKwh, null)
  assert.equal(partial.cost, null)
  assert.equal(partial.totalKwh, null)
  assert.deepEqual(plannedTotals(undefined), { totalKwh: null, solarKwh: null, gridKwh: null, cost: null, solarSharePct: null })
})

test('band allocation splits planned energy and entry cost by time in each band', () => {
  const sched = schedule([
    entry('inside', '2026-01-05T10:00:00Z', '2026-01-05T12:00:00Z', 10, 20, 2), // all mid
    entry('span', '2026-01-05T16:00:00Z', '2026-01-05T18:00:00Z', 10, 20, 4), // 1 h mid, 1 h peak
  ])
  const result = bandAllocation({ tariffs: SEED_TARIFFS, factory }, sched)
  const byBand = Object.fromEntries(result.rows.map((row) => [row.band, row]))
  assert.equal(byBand.mid.kwh, 30)
  assert.equal(byBand.peak.kwh, 10)
  assert.equal(byBand.off.kwh, 0)
  assert.equal(byBand.mid.cost, 4)
  assert.equal(byBand.peak.cost, 2)
  assert.equal(result.spanningEntries, 1)
  assert.equal(result.totalKwh, 40)
  assert.ok(Math.abs(byBand.mid.sharePct - 75) < 1e-9)
  assert.equal(byBand.none, undefined)
})

test('band allocation without tariffs puts all energy in "No tariff window" and keeps unknown cost unknown', () => {
  const result = bandAllocation({ tariffs: [], factory }, schedule([entry('a', '2026-01-05T10:00:00Z', '2026-01-05T11:00:00Z', 10, null, null)]))
  assert.deepEqual(result.rows.map((row) => row.band), ['none'])
  assert.equal(result.rows[0].kwh, 10)
  assert.equal(result.rows[0].cost, null)
  assert.equal(formatMoney(result.rows[0].cost, 'EUR'), 'Not available')
})

test('tariff window lines group configured windows by band and skip demand-only rows', () => {
  const lines = tariffWindowLines({ tariffs: SEED_TARIFFS, factory })
  assert.equal(lines.length, 3)
  assert.deepEqual(lines.map((line) => line.band), ['off', 'mid', 'peak'])
  assert.match(lines[2].text, /^Peak: Mon–Fri 17:00–22:00 · 0\.218 EUR\/kWh$/)
  assert.equal(daysText(null), 'Every day')
  assert.equal(daysText([6]), 'Sat')
  assert.equal(daysText([6, 7]), 'Sat, Sun')
})

test('excluded charges note names demand, fixed and tax charges, or is null', () => {
  const note = excludedChargesNote({ tariffs: SEED_TARIFFS, factory })
  assert.match(note ?? '', /demand charge 18\.5 EUR\/kW/)
  assert.match(note ?? '', /fixed charge 145 EUR/)
  assert.match(note ?? '', /tax 21%/)
  assert.match(note ?? '', /not an electricity bill/)
  assert.equal(excludedChargesNote({ tariffs: [{ energy_price_per_kwh: 1 }], factory }), null)
})

test('readings summary counts readings and never invents totals', () => {
  const summary = readingsSummary([reading('2026-01-05T10:00:00Z', 2, 1), reading('2026-01-06T10:00:00Z', 3, null)], 'UTC')
  assert.equal(summary.count, 2)
  assert.equal(summary.consumptionKwh, 5)
  assert.equal(summary.generationKwh, 1)
  assert.match(readingsSummaryText(summary), /2 stored readings, 15-minute intervals, 2026-01-05 to 2026-01-06/)
  assert.equal(readingsSummaryText(readingsSummary([], 'UTC')), 'No energy readings are stored for this factory.')
})

test('source tags label simulated data as simulated, never measured', () => {
  assert.deepEqual(sourceTag('Simulated'), { provenance: 'modeled', label: 'Simulated' })
  assert.deepEqual(sourceTag('Measured'), { provenance: 'measured', label: 'Measured' })
  assert.equal(sourceTag('Not available'), null)
})
