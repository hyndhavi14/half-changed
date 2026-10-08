import assert from 'node:assert/strict'
import test from 'node:test'
import {
  compareMetrics,
  daySegments,
  deltaTone,
  energyDays,
  energySourceLabel,
  ganttRows,
  horizonSegments,
  kpiViews,
  makespanHours,
  metricPair,
  plannedLoadPct,
  plannedPeakKw,
  recordCountsCaption,
  rowsForDay,
  solarSharePct,
  tariffWindows,
  type StoredSchedule,
} from '../src/pages/DashboardPage/dashboardView.ts'

const M1 = '11111111-1111-4111-8111-111111111111'
const M2 = '22222222-2222-4222-8222-222222222222'
const P1 = '33333333-3333-4333-8333-333333333333'
const P2 = '44444444-4444-4444-8444-444444444444'

function entry(id: string, machineId: string, processId: string, startsAt: string, endsAt: string, powerKw: number | null, metadata?: Record<string, unknown>) {
  return { id, scheduleId: 's', machineId, processId, productionOrderId: null, startsAt, endsAt, powerKw, energyKwh: null, cost: null, quantity: null, sequence: 0, metadata }
}

function schedule(name: string, entries: ReturnType<typeof entry>[], cost: number | null, kwh: number | null): StoredSchedule {
  return {
    id: name, factoryId: 'f', name, version: 1, status: 'draft',
    horizonStart: '2026-01-05T00:00:00Z', horizonEnd: '2026-01-06T00:00:00Z',
    optimizationRequestId: null, optimizationResultId: null,
    entries, metadata: { kind: name }, totalEnergyCost: cost, totalEnergyKwh: kwh,
  } as unknown as StoredSchedule
}

const baseline = schedule('baseline', [
  entry('b1', M1, P1, '2026-01-05T18:00:00Z', '2026-01-05T20:00:00Z', 50, { solar_kwh: 0, grid_kwh: 100 }),
  entry('b2', M2, P2, '2026-01-05T19:00:00Z', '2026-01-05T21:00:00Z', 30, { solar_kwh: 0, grid_kwh: 60 }),
], 200, 160)

const optimized = schedule('optimized', [
  entry('o1', M1, P1, '2026-01-05T10:00:00Z', '2026-01-05T12:00:00Z', 50, { solar_kwh: 80, grid_kwh: 20 }),
  entry('o2', M2, P2, '2026-01-05T12:00:00Z', '2026-01-05T14:00:00Z', 30, { solar_kwh: 30, grid_kwh: 30 }),
], 120, 160)

const data = {
  factory: { id: 'f', slug: 'f', name: 'Test', timezone: 'UTC', currency: 'INR', description: null, config: {} },
  machines: [{ id: M1, name: 'Roaster' }, { id: M2, name: 'Grinder' }],
  processes: [{ id: P1, name: 'Roast' }, { id: P2, name: 'Grind' }],
  schedules: [baseline, optimized],
  energy: [],
} as never

test('makespan and planned peak come from schedule entries', () => {
  assert.equal(makespanHours(baseline), 3)
  assert.equal(makespanHours(optimized), 4)
  assert.equal(plannedPeakKw(baseline), 80)
  assert.equal(plannedPeakKw(optimized), 50)
  assert.equal(makespanHours(undefined), null)
})

test('solar share uses entry metadata and is null without it', () => {
  assert.equal(solarSharePct(baseline), 0)
  assert.ok(Math.abs((solarSharePct(optimized) ?? 0) - (110 / 160) * 100) < 1e-9)
  assert.equal(solarSharePct(schedule('x', [entry('x', M1, P1, '2026-01-05T01:00:00Z', '2026-01-05T02:00:00Z', 1)], null, null)), null)
})

test('delta tone follows the better direction', () => {
  assert.equal(deltaTone(metricPair('cost', baseline, optimized)), 'good')
  assert.equal(deltaTone(metricPair('makespan', baseline, optimized)), 'bad')
  assert.equal(deltaTone(metricPair('solar', baseline, optimized)), 'good')
  assert.equal(deltaTone(metricPair('energy', baseline, optimized)), 'neutral')
  assert.equal(deltaTone(metricPair('cost', undefined, optimized)), 'neutral')
})

test('KPIs show Not available instead of inventing values', () => {
  const none = kpiViews(undefined, undefined, 'INR')
  assert.equal(none.length, 4)
  for (const kpi of none) {
    assert.equal(kpi.value, 'Not available')
    assert.equal(kpi.delta, undefined)
  }
  const full = kpiViews(baseline, optimized, 'INR')
  assert.deepEqual(full.map((kpi) => kpi.key), ['cost', 'solar', 'makespan', 'peak'])
  assert.equal(full[0].value, 'INR 120')
  assert.equal(full[0].delta, '\u221240% vs baseline')
  assert.match(full[1].delta ?? '', /pp vs baseline$/)
  for (const kpi of full) assert.ok(!/utili[sz]ation/i.test(`${kpi.label} ${kpi.note}`))
})

test('compare metrics require both schedules', () => {
  assert.deepEqual(compareMetrics(undefined, optimized, 'INR'), [])
  const metrics = compareMetrics(baseline, optimized, 'INR')
  const cost = metrics.find((metric) => metric.label === 'Energy cost')
  assert.equal(cost?.change, '40% lower')
  assert.equal(cost?.optimizedPct, 60)
  assert.equal(metrics.find((metric) => metric.label === 'Planned energy')?.change, 'No change')
})

test('energy days and rows are split by factory-local day', () => {
  const rows = [
    { recorded_at: '2026-01-04T23:30:00Z', source: 'simulated' },
    { recorded_at: '2026-01-05T01:00:00Z', source: 'simulated' },
    { recorded_at: 'bad' },
  ]
  assert.deepEqual(energyDays(rows, 'UTC'), ['2026-01-04', '2026-01-05'])
  assert.deepEqual(energyDays(rows, 'Asia/Kolkata'), ['2026-01-05'])
  assert.equal(rowsForDay(rows, 'UTC', '2026-01-05').length, 1)
  assert.equal(energySourceLabel(rows.slice(0, 2)), 'Simulated')
  assert.equal(energySourceLabel([{ source: 'modeled_nasa_power' }, { source: 'measured' }]), 'Mixed sources')
  assert.equal(energySourceLabel([]), 'Not available')
})

test('tariff bands follow configured windows and priority', () => {
  const windows = tariffWindows([
    { start_time: '00:00:00', end_time: '18:00:00', energy_price_per_kwh: '5', priority: 20 },
    { start_time: '18:00:00', end_time: '22:00:00', energy_price_per_kwh: '9', priority: 10 },
    { start_time: '22:00:00', end_time: '23:59:00', energy_price_per_kwh: '5', priority: 20 },
  ])
  assert.equal(windows.length, 3)
  const segments = daySegments(windows, '2026-01-05')
  const peak = segments.filter((segment) => segment.band === 'peak')
  assert.equal(peak.length, 1)
  assert.ok(Math.abs(peak[0].startFraction - 18 / 24) < 1e-9)
  assert.ok(Math.abs(peak[0].endFraction - 22 / 24) < 1e-9)
  const horizon = horizonSegments(windows, Date.parse('2026-01-05T00:00:00Z'), Date.parse('2026-01-06T00:00:00Z'), 'UTC')
  assert.ok(Math.abs((horizon.find((segment) => segment.band === 'peak')?.startFraction ?? 0) - 0.75) < 1e-9)
  assert.deepEqual(daySegments(tariffWindows([{ start_time: '00:00', end_time: '00:00', energy_price_per_kwh: 4 }]), '2026-01-05'), [])
})

test('gantt rows use fractions, process colour index and absolute-time tooltips', () => {
  const rows = ganttRows(data, optimized, baseline)
  assert.deepEqual(rows.map((row) => row.machineName), ['Roaster', 'Grinder'])
  const block = rows[0].blocks[0]
  assert.ok(Math.abs(block.leftFraction - 10 / 24) < 1e-9)
  assert.ok(Math.abs(block.widthFraction - 2 / 24) < 1e-9)
  assert.equal(block.colorIndex, 0)
  assert.equal(rows[1].blocks[0].colorIndex, 1)
  assert.equal(block.shifted, true)
  assert.match(block.tooltip, /Roast \u00b7 Roaster \u00b7 10:00\u201312:00 \(UTC\)/)
})

test('planned load is booked share of the horizon, never above 100', () => {
  assert.ok(Math.abs((plannedLoadPct(optimized, M1) ?? 0) - (2 / 24) * 100) < 1e-9)
  assert.equal(plannedLoadPct(optimized, 'missing'), 0)
  assert.equal(plannedLoadPct(undefined, M1), null)
})

test('record counts caption is labelled as persisted records', () => {
  assert.equal(
    recordCountsCaption({ machines: [1, 2], processes: [1], schedules: [], energy: [1, 2, 3] } as never),
    'Persisted records: 2 machines \u00b7 1 processes \u00b7 0 schedules \u00b7 3 energy readings',
  )
})

const SEED_TARIFFS = [
  { start_time: '22:00:00', end_time: '07:00:00', days_of_week: null, energy_price_per_kwh: '0.0850', demand_charge_per_kw: '0', fixed_charge: '0', priority: 10, metadata: { band: 'off_peak' } },
  { start_time: '07:00:00', end_time: '22:00:00', days_of_week: null, energy_price_per_kwh: '0.1420', demand_charge_per_kw: '0', fixed_charge: '0', priority: 10, metadata: { band: 'shoulder' } },
  { start_time: '17:00:00', end_time: '22:00:00', days_of_week: [1, 2, 3, 4, 5], energy_price_per_kwh: '0.2180', demand_charge_per_kw: '0', fixed_charge: '0', priority: 20, metadata: { band: 'peak' } },
  { start_time: '08:00:00', end_time: '20:00:00', days_of_week: [6], energy_price_per_kwh: '0.1650', demand_charge_per_kw: '0', fixed_charge: '0', priority: 20, metadata: { band: 'peak' } },
  { start_time: '00:00:00', end_time: '23:59:00', days_of_week: null, energy_price_per_kwh: '0.0000', demand_charge_per_kw: '18.50', fixed_charge: '145.00', priority: 30, metadata: { band: 'demand' } },
]

function near(a: number | undefined, b: number) { return a !== undefined && Math.abs(a - b) < 1e-9 }

test('tariff resolution matches backend: demand-only rows excluded, highest priority wins', () => {
  const windows = tariffWindows(SEED_TARIFFS)
  assert.equal(windows.length, 4)
  const weekday = daySegments(windows, '2026-01-05') // Monday
  assert.deepEqual(weekday.map((segment) => segment.band), ['off', 'mid', 'peak', 'off'])
  assert.ok(near(weekday[1].startFraction, 7 / 24) && near(weekday[1].endFraction, 17 / 24))
  assert.ok(near(weekday[2].startFraction, 17 / 24) && near(weekday[2].endFraction, 22 / 24))
})

test('weekday-limited windows apply only on their ISO days', () => {
  const windows = tariffWindows(SEED_TARIFFS)
  const saturday = daySegments(windows, '2026-01-10')
  assert.deepEqual(saturday.map((segment) => segment.band), ['off', 'mid', 'peak', 'mid', 'off'])
  assert.ok(near(saturday[2].startFraction, 8 / 24) && near(saturday[2].endFraction, 20 / 24))
  const sunday = daySegments(windows, '2026-01-11')
  assert.deepEqual(sunday.map((segment) => segment.band), ['off', 'mid', 'off'])
})

test('equal top priority is ambiguous and price rank is used without metadata', () => {
  const tie = tariffWindows([
    { start_time: '00:00', end_time: '12:00', energy_price_per_kwh: 1, priority: 5 },
    { start_time: '00:00', end_time: '12:00', energy_price_per_kwh: 2, priority: 5 },
    { start_time: '12:00', end_time: '00:00', energy_price_per_kwh: 3, priority: 5 },
  ])
  const segments = daySegments(tie, '2026-01-05')
  assert.deepEqual(segments.map((segment) => segment.band), ['peak'])
  assert.ok(near(segments[0].startFraction, 0.5))
})
