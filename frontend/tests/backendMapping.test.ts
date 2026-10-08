import assert from 'node:assert/strict'
import test from 'node:test'
import { mapApiScheduleEntry, numericValue } from '../src/data/backendContracts.ts'

const validEntry = {
  id: '00000000-0000-4000-8000-000000000001',
  schedule_id: '00000000-0000-4000-8000-000000000002',
  machine_id: '00000000-0000-4000-8000-000000000003',
  process_id: '00000000-0000-4000-8000-000000000004',
  production_order_id: null,
  starts_at: '2026-10-08T09:00:00Z',
  ends_at: '2026-10-08T10:00:00+00:00',
  power_kw: null,
  energy_kwh: null,
  cost: null,
  quantity: null,
  sequence: 1,
}

test('maps missing and non-object schedule metadata to an empty object', () => {
  assert.deepEqual(mapApiScheduleEntry(validEntry).metadata, {})
  assert.deepEqual(mapApiScheduleEntry({ ...validEntry, metadata: null }).metadata, {})
  assert.deepEqual(mapApiScheduleEntry({ ...validEntry, metadata: ['invalid'] }).metadata, {})
})

test('retains a plain-object schedule entry metadata value', () => {
  const metadata = { solar_kwh: 3, grid_kwh: 7 }
  assert.deepEqual(mapApiScheduleEntry({ ...validEntry, metadata }).metadata, metadata)
})

test('parses peak-demand numeric representations without changing nulls', () => {
  assert.equal(numericValue(123.5), 123.5)
  assert.equal(numericValue('123.5'), 123.5)
  assert.equal(numericValue(null), null)
})
