import assert from 'node:assert/strict'
import test from 'node:test'
import { factory3dEmbedUrl, factory3dUrl, flowPlan, machineActivity } from '../src/pages/FactoryViewPage/factoryViewModel.ts'

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


test('flow plan derives ordered zones from dependencies and keeps unassigned machines apart', () => {
  const plan = flowPlan(data)
  assert.equal(plan.cyclic, false)
  assert.deepEqual(plan.zones.map((zone) => zone.machineIds), [['m1'], ['m2']])
  assert.equal(plan.zones[0].title, 'Roast · Grind')
  assert.equal(plan.zones[1].number, 2)
  assert.deepEqual(plan.unassignedMachineIds, ['m3'])
})



test('Factory-3D link carries factoryId and scheduleId only', () => {
  const url = new URL(factory3dUrl('http://localhost:5174', 'f1', 's1'))
  assert.equal(url.origin, 'http://localhost:5174')
  assert.equal(url.searchParams.get('factoryId'), 'f1')
  assert.equal(url.searchParams.get('scheduleId'), 's1')
  assert.equal([...url.searchParams.keys()].length, 2)
})

test('machine activity reports running, waiting, done and unused at an instant', () => {
  const blocks = [
    { label: 'Roast', start: 100, end: 200, moved: true, powerKw: 250 },
    { label: 'Grind', start: 300, end: 400, moved: false, powerKw: 200 },
  ]
  assert.equal(machineActivity(blocks, 150).state, 'running')
  assert.equal(machineActivity(blocks, 150).current?.label, 'Roast')
  assert.equal(machineActivity(blocks, 150).next?.label, 'Grind')
  assert.equal(machineActivity(blocks, 200).state, 'waiting')
  assert.equal(machineActivity(blocks, 50).next?.label, 'Roast')
  assert.equal(machineActivity(blocks, 400).state, 'done')
  assert.equal(machineActivity([], 150).state, 'unused')
})

test('embed link keeps the factory and schedule and adds embed=1', () => {
  const url = new URL(factory3dEmbedUrl('http://localhost:5174', 'f-1', 's-1'))
  assert.equal(url.searchParams.get('factoryId'), 'f-1')
  assert.equal(url.searchParams.get('scheduleId'), 's-1')
  assert.equal(url.searchParams.get('embed'), '1')
})
