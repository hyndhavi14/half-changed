import assert from 'node:assert/strict'
import test from 'node:test'
import { factory3dUrl, flowPlan, glyphKind, machinePlan } from '../src/pages/FactoryViewPage/factoryViewModel.ts'

const machines = [
  { id: 'm1', name: 'Drum', type: 'thermal_asset', ratedPowerKw: 250, isActive: true },
  { id: 'm2', name: 'Conche', type: 'rotational_asset', ratedPowerKw: 180, isActive: true },
  { id: 'm3', name: 'PV', type: 'generator', ratedPowerKw: null, isActive: true },
]
const processes = [
  { id: 'p1', name: 'Roast', machineId: 'm1' },
  { id: 'p2', name: 'Grind', machineId: 'm1' },
  { id: 'p3', name: 'Conche', machineId: 'm2' },
]
const dependencies = [
  { id: 'd1', processId: 'p2', dependsOnProcessId: 'p1', type: 'finish_to_start', lagMinutes: 0 },
  { id: 'd2', processId: 'p3', dependsOnProcessId: 'p2', type: 'finish_to_start', lagMinutes: 0 },
]
const data = { machines, processes, dependencies, factory: { timezone: 'UTC' } } as never

function entry(machineId: string, startsAt: string, endsAt: string, metadata: Record<string, unknown>) {
  return { id: `${machineId}-${startsAt}`, machineId, processId: 'p', startsAt, endsAt, metadata }
}
const schedule = {
  horizonStart: '2026-01-05T00:00:00Z', horizonEnd: '2026-01-06T00:00:00Z',
  entries: [
    entry('m1', '2026-01-05T12:00:00Z', '2026-01-05T13:00:00Z', { solar_kwh: 1, grid_kwh: 2 }),
    entry('m1', '2026-01-05T09:00:00Z', '2026-01-05T11:00:00Z', { solar_kwh: 3, grid_kwh: 4 }),
    entry('m2', '2026-01-05T14:00:00Z', '2026-01-05T15:00:00Z', {}),
  ],
} as never

test('flow plan derives ordered zones from dependencies and keeps unassigned machines apart', () => {
  const plan = flowPlan(data)
  assert.equal(plan.cyclic, false)
  assert.deepEqual(plan.zones.map((zone) => zone.machineIds), [['m1'], ['m2']])
  assert.equal(plan.zones[0].title, 'Roast · Grind')
  assert.equal(plan.zones[1].number, 2)
  assert.deepEqual(plan.unassignedMachineIds, ['m3'])
})

test('glyph kind maps stored machine types to the original tile glyphs', () => {
  assert.equal(glyphKind('thermal_asset'), 'oven')
  assert.equal(glyphKind('rotational_asset'), 'mixer')
  assert.equal(glyphKind('conveyor'), 'conveyor')
  assert.equal(glyphKind('generator'), 'generator')
  assert.equal(glyphKind(null), 'generic')
})

test('machine plan sums planned solar/grid, picks the first slot and never invents values', () => {
  const plan = machinePlan(data, schedule, 'm1')
  assert.equal(plan.entryCount, 2)
  assert.equal(plan.solarKwh, 4)
  assert.equal(plan.gridKwh, 6)
  assert.equal(plan.nextSlot, 'Mon 05 09:00–11:00')
  assert.ok(Math.abs((plan.loadPct ?? 0) - 12.5) < 1e-9)
  assert.deepEqual(plan.processNames, ['Roast', 'Grind'])
  const missing = machinePlan(data, schedule, 'm2')
  assert.equal(missing.solarKwh, null)
  assert.equal(missing.gridKwh, null)
  const none = machinePlan(data, undefined, 'm3')
  assert.equal(none.entryCount, 0)
  assert.equal(none.nextSlot, null)
  assert.equal(none.loadPct, null)
})

test('Factory-3D link carries factoryId and scheduleId only', () => {
  const url = new URL(factory3dUrl('http://localhost:5174', 'f1', 's1'))
  assert.equal(url.origin, 'http://localhost:5174')
  assert.equal(url.searchParams.get('factoryId'), 'f1')
  assert.equal(url.searchParams.get('scheduleId'), 's1')
  assert.equal([...url.searchParams.keys()].length, 2)
})
