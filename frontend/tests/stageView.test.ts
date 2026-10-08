import assert from 'node:assert/strict'
import test from 'node:test'
import type { FrontendDependencyRef, FrontendMachineRef, FrontendProcessRef } from '../src/data/backendContracts.ts'
import { machineStages, processStages } from '../src/data/stageView.ts'

const factoryId = 'factory'
const machineId = 'machine'
const process = (id: string, targetMachine = machineId): FrontendProcessRef => ({
  id,
  factoryId,
  slug: id,
  name: id,
  durationMinutes: 10,
  machineId: targetMachine,
  powerRequirementKw: null,
  quantity: null,
  unit: null,
  isActive: true,
})
const machine = (id: string): FrontendMachineRef => ({
  id,
  factoryId,
  slug: id,
  name: id,
  type: null,
  ratedPowerKw: null,
  isActive: true,
})
const dependency = (processId: string, dependsOnProcessId: string): FrontendDependencyRef => ({
  id: `${processId}-${dependsOnProcessId}`,
  factoryId,
  processId,
  dependsOnProcessId,
  type: 'finish_to_start',
  lagMinutes: 0,
})

test('assigns stages from dependency depth and groups machines at their earliest stage', () => {
  const processes = [process('a'), process('b'), process('c', 'other-machine')]
  const result = processStages(processes, [dependency('b', 'a'), dependency('c', 'b')])
  assert.deepEqual(result.stages.map((stage) => stage.index), [0, 1, 2])
  const grouped = machineStages([machine(machineId), machine('other-machine'), machine('empty')], processes, result.stages)
  assert.deepEqual(grouped.stages.map((stage) => stage.index), [0, 2])
  assert.deepEqual(grouped.stages[0]?.machines.map((item) => item.id), [machineId])
  assert.deepEqual(grouped.stages[1]?.machines.map((item) => item.id), ['other-machine'])
  assert.deepEqual(grouped.unassigned.map((item) => item.id), ['empty'])
})

test('returns all processes together and marks cyclic dependency graphs', () => {
  const processes = [process('a'), process('b')]
  const result = processStages(processes, [dependency('a', 'b'), dependency('b', 'a')])
  assert.equal(result.cyclic, true)
  assert.deepEqual(result.stages, [{ index: 0, processes }])
})
