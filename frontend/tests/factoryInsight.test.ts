import assert from 'node:assert/strict'
import test from 'node:test'
import {
  averageSolarKw,
  factoryHourlySeries,
  ganttLanes,
  machineLabels,
  optimizationOutcome,
  planChecks,
  processMoves,
  recommendation,
  schedulePair,
  solarSamples,
  tariffPriceAt,
} from '../src/data/factoryInsight.ts'
import { tariffWindows } from '../src/pages/DashboardPage/dashboardView.ts'

function makeFactory(name: string, machineNames: string[], processNames: string[]) {
  const machines = machineNames.map((machineName, index) => ({ id: `${name}-m${index}`, factoryId: name, slug: `m${index}`, name: machineName, type: null, ratedPowerKw: 10, isActive: true }))
  const processes = processNames.map((processName, index) => ({ id: `${name}-p${index}`, factoryId: name, slug: `p${index}`, name: processName, durationMinutes: 60, machineId: machines[index].id, powerRequirementKw: 10, quantity: null, unit: null, isActive: true }))
  const dependencies = processes.slice(1).map((process, index) => ({ id: `${name}-d${index}`, factoryId: name, processId: process.id, dependsOnProcessId: processes[index].id, type: 'finish_to_start', lagMinutes: 0 }))
  const entry = (scheduleId: string, index: number, startHour: number, solar: number, grid: number, cost: number) => ({
    id: `${scheduleId}-${index}`, scheduleId, machineId: machines[index].id, processId: processes[index].id, productionOrderId: null,
    startsAt: `2026-01-05T${String(startHour).padStart(2, '0')}:00:00Z`, endsAt: `2026-01-05T${String(startHour + 1).padStart(2, '0')}:00:00Z`,
    powerKw: 10, energyKwh: 10, cost, quantity: null, sequence: index, metadata: { solar_kwh: solar, grid_kwh: grid },
  })
  const schedule = (id: string, kind: string, entries: ReturnType<typeof entry>[]) => ({
    id, factoryId: name, name: `${kind} schedule`, version: 1, status: 'published', horizonStart: '2026-01-05T00:00:00Z', horizonEnd: '2026-01-06T00:00:00Z',
    optimizationRequestId: null, optimizationResultId: null, entries, metadata: { kind }, totalEnergyCost: entries.reduce((t, e) => t + e.cost, 0), totalEnergyKwh: entries.length * 10, peakDemandKw: null,
  })
  const baseline = schedule(`${name}-b`, 'baseline', [entry(`${name}-b`, 0, 6, 0, 10, 5), entry(`${name}-b`, 1, 7, 2, 8, 4)])
  const optimized = schedule(`${name}-o`, 'optimized', [entry(`${name}-o`, 0, 6, 0, 10, 5), entry(`${name}-o`, 1, 11, 9, 1, 0.5)])
  const energy = Array.from({ length: 24 }, (_, hour) => ({ recorded_at: `2026-01-05T${String(hour).padStart(2, '0')}:00:00Z`, interval_minutes: 60, generation_kwh: hour >= 9 && hour < 15 ? 12 : 0, consumption_kwh: 1, machine_id: null }))
  const tariffs = [
    { start_time: '00:00', end_time: '10:00', energy_price_per_kwh: 0.3, priority: 1 },
    { start_time: '10:00', end_time: '16:00', energy_price_per_kwh: 0.1, priority: 1 },
    { start_time: '16:00', end_time: '00:00', energy_price_per_kwh: 0.4, priority: 1 },
  ]
  return {
    factory: { id: name, slug: name, name, timezone: 'UTC', currency: 'INR', description: null, config: {} },
    machines, processes, dependencies, orders: [], energy, tariffs, schedules: [baseline, optimized], optimizationRequests: [], optimizationResults: [],
  } as never
}

const chocolate = makeFactory('choc', ['Cocoa Roaster', 'Five-Roll Refiner'], ['Roasting', 'Refining'])
const pharma = makeFactory('pharma', ['Granulator', 'Tablet Press'], ['Granulation', 'Compression'])

test('machine labels use the selected factory names in flow order with codes', () => {
  assert.deepEqual(machineLabels(chocolate).map((label) => label.label), ['M01 — Cocoa Roaster', 'M02 — Five-Roll Refiner'])
  const pharmaLabels = machineLabels(pharma).map((label) => label.label)
  assert.deepEqual(pharmaLabels, ['M01 — Granulator', 'M02 — Tablet Press'])
  assert.ok(pharmaLabels.every((label) => !label.includes('Cocoa')))
})

test('outcome reports grid energy and cost saved only from stored schedule values', () => {
  const outcome = optimizationOutcome(schedulePair(chocolate))
  assert.equal(outcome.comparable, true)
  assert.equal(outcome.baseline.gridKwh, 18)
  assert.equal(outcome.optimized.gridKwh, 11)
  assert.equal(outcome.gridSavedKwh, 7)
  assert.equal(outcome.solarGainKwh, 7)
  assert.equal(outcome.costSaved, 3.5)
  assert.ok(Math.abs((outcome.costSavedPct ?? 0) - (3.5 / 9) * 100) < 1e-9)
  const empty = optimizationOutcome({ baseline: undefined, optimized: undefined })
  assert.equal(empty.comparable, false)
  assert.equal(empty.costSaved, null)
})

test('moves, checks and recommendation explain the shift with solar and tariff evidence', () => {
  const pair = schedulePair(chocolate)
  const moves = processMoves(chocolate, pair)
  assert.equal(moves.length, 2)
  const refining = moves.find((move) => move.processName === 'Refining')
  assert.ok(refining)
  assert.equal(refining.moved, true)
  assert.equal(refining.shiftMinutes, 240)
  assert.equal(refining.machineLabel, 'M02 — Five-Roll Refiner')
  assert.equal(refining.baselineSolarKw, 0)
  assert.equal(refining.optimizedSolarKw, 12)
  assert.ok(Math.abs((refining.baselinePrice ?? 0) - 0.3) < 1e-9)
  assert.ok(Math.abs((refining.optimizedPrice ?? 0) - 0.1) < 1e-9)
  assert.equal(moves.find((move) => move.processName === 'Roasting')?.moved, false)
  assert.equal(recommendation(moves)?.processName, 'Refining')
  assert.deepEqual(planChecks(chocolate, pair.optimized), { dependencies: true, machineConflicts: true, withinHorizon: true })
})

test('no recommendation is invented when nothing moved', () => {
  const unchanged = schedulePair(chocolate)
  const same = { baseline: unchanged.baseline, optimized: unchanged.baseline }
  assert.equal(recommendation(processMoves(chocolate, same)), null)
})

test('solar averages need full coverage and tariff resolves the active window', () => {
  const samples = solarSamples((chocolate as { energy: Record<string, unknown>[] }).energy)
  assert.equal(averageSolarKw(samples, Date.parse('2026-01-05T09:00:00Z'), Date.parse('2026-01-05T11:00:00Z')), 12)
  assert.equal(averageSolarKw(samples, Date.parse('2026-01-06T09:00:00Z'), Date.parse('2026-01-06T10:00:00Z')), null)
  const windows = tariffWindows((chocolate as { tariffs: Record<string, unknown>[] }).tariffs)
  assert.equal(tariffPriceAt(windows, Date.parse('2026-01-05T12:00:00Z'), 'UTC'), 0.1)
  assert.equal(tariffPriceAt(windows, Date.parse('2026-01-05T20:00:00Z'), 'UTC'), 0.4)
})

test('hourly series and Gantt lanes follow the selected factory only', () => {
  const series = factoryHourlySeries(pharma, schedulePair(pharma))
  assert.equal(series.length, 8)
  const eleven = series.find((point) => new Date(point.start).getUTCHours() === 11)
  assert.equal(eleven?.optimizedKw, 10)
  assert.equal(eleven?.baselineKw, 0)
  assert.equal(eleven?.solarKw, 12)
  const lanes = ganttLanes(pharma, schedulePair(pharma))
  assert.deepEqual(lanes.map((lane) => lane.name), ['Granulator', 'Tablet Press'])
  assert.equal(lanes[1].optimized[0].moved, true)
  assert.equal(lanes[1].optimized[0].label, 'Compression')
})

test('move reasons come only from solar, tariff and dependency evidence', async () => {
  const { moveReasons } = await import('../src/data/factoryInsight.ts')
  const pair = schedulePair(chocolate)
  const moves = processMoves(chocolate, pair)
  const refining = moves.find((move) => move.processName === 'Refining')!
  assert.deepEqual(moveReasons(refining, moves, (chocolate as { dependencies: never }).dependencies), ['More solar', 'Lower tariff'])
  const roasting = moves.find((move) => move.processName === 'Roasting')!
  assert.deepEqual(moveReasons(roasting, moves, (chocolate as { dependencies: never }).dependencies), [])
})
