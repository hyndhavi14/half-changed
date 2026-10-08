import assert from 'node:assert/strict'
import test from 'node:test'
import { beforeAfterMetrics, optimizationSummary } from '../src/data/insightView.ts'
import { scenarioBandAt, scenarioDateRange, scenarioHourly, scenarioLanes } from '../src/pages/solarShiftView.ts'

const totals = (grid: number, solar: number, cost: number, completion: number) => ({ energyKwh: grid + solar, solarKwh: solar, gridKwh: grid, cost, completionHours: completion, peakKw: null, entryCount: 3 })
const outcome = (comparable: boolean, before = totals(100, 20, 50, 10), after = totals(60, 60, 30, 12)) => ({
  baseline: before, optimized: after, comparable,
  gridSavedKwh: comparable ? before.gridKwh - after.gridKwh : null,
  solarGainKwh: comparable ? after.solarKwh - before.solarKwh : null,
  costSaved: comparable ? before.cost - after.cost : null,
  costSavedPct: comparable ? ((before.cost - after.cost) / before.cost) * 100 : null,
  gridDependencyChangePts: null,
})

test('before vs optimized rows carry tone and never appear for incomparable schedules', () => {
  const rows = beforeAfterMetrics(outcome(true), 'INR')
  assert.deepEqual(rows.map((row) => row.label), ['Grid energy', 'Solar used', 'Modeled electricity cost', 'Production', 'Completion time', 'Savings'])
  assert.equal(rows[0].changeTone, 'good')
  assert.equal(rows[4].changeTone, 'bad')
  assert.ok(rows[2].optimized.includes('₹'))
  assert.deepEqual(beforeAfterMetrics(outcome(false), 'INR'), [])
})

test('summary says when no beneficial shift exists instead of inventing one', () => {
  assert.equal(optimizationSummary(outcome(true), 0, false, 'INR', 'Pharma').title, 'No beneficial schedule shift identified')
  assert.equal(optimizationSummary(outcome(true), 2, true, 'INR', 'Pharma').tone, 'good')
  const none = { ...outcome(false), baseline: { ...totals(0, 0, 0, 0), entryCount: 0 }, optimized: { ...totals(0, 0, 0, 0), entryCount: 0 } }
  assert.equal(optimizationSummary(none, 0, false, 'INR', 'Pharma').title, 'No optimization yet')
})

test('historical helpers derive dates, bands, hourly demand and lanes from the replay payload', () => {
  assert.equal(scenarioDateRange({ local_start: '2026-03-11T16:30:00+05:30', local_end_exclusive: '2026-03-18T16:30:00+05:30' }), '11–18 Mar 2026')
  const tariffs = [{ band: 'peak', start_time: '18:00:00', end_time: '22:00:00' }, { band: 'off_peak', start_time: '10:00:00', end_time: '15:00:00' }]
  assert.equal(scenarioBandAt(tariffs, Date.parse('2026-03-11T13:30:00Z')), 'peak')
  assert.equal(scenarioBandAt(tariffs, Date.parse('2026-03-11T06:30:00Z')), 'off')
  const scenario = {
    hourlyProfile: [{ timestamp_utc: '2026-03-11T06:00:00Z', modeled_pv_kwh: '120' }, { timestamp_utc: '2026-03-11T07:00:00Z', modeled_pv_kwh: '150' }],
    schedules: [{ id: 'b', name: 'SolarShift historical baseline' }, { id: 'o', name: 'SolarShift historical optimized' }],
    entries: [
      { id: 'e1', schedule_id: 'b', process_id: 'p1', machine_id: 'm1', starts_at: '2026-03-11T06:00:00Z', ends_at: '2026-03-11T07:00:00Z', power_kw: '100' },
      { id: 'e2', schedule_id: 'o', process_id: 'p1', machine_id: 'm1', starts_at: '2026-03-11T07:00:00Z', ends_at: '2026-03-11T08:00:00Z', power_kw: '100' },
    ],
    tariffs,
    machines: [{ id: 'm1', name: 'Roasting Drum' }],
    processes: [{ id: 'p1', name: 'Roast Bean Blend' }],
  }
  const hourly = scenarioHourly(scenario)
  assert.deepEqual(hourly.map((hour) => [hour.solarKw, hour.baselineKw, hour.optimizedKw]), [[120, 100, 0], [150, 0, 100]])
  const { lanes, window } = scenarioLanes(scenario)
  assert.equal(lanes[0].name, 'Roasting Drum')
  assert.equal(lanes[0].code, 'M01')
  assert.equal(lanes[0].optimized[0].moved, true)
  assert.ok(window && window.end > window.start)
})
