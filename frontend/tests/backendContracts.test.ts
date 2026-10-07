import assert from 'node:assert/strict'
import test from 'node:test'
import { parseEnergyPage, unwrapApiEnvelope } from '../src/data/backendContracts.ts'

test('unwraps the Backend response data envelope', () => {
  assert.deepEqual(unwrapApiEnvelope({ data: [{ id: 'one' }], meta: { total: 1 } }), [{ id: 'one' }])
})

test('reads energy rows from the nested intervals collection', () => {
  const page = parseEnergyPage({
    data: { intervals: [{ id: 'energy-one', interval_minutes: 15 }], resolution: 'native' },
    meta: { total: 1, limit: 200, offset: 0 },
  })
  assert.deepEqual(page, {
    rows: [{ id: 'energy-one', interval_minutes: 15 }],
    total: 1,
  })
})

test('rejects malformed energy response shapes instead of returning empty values', () => {
  assert.throws(() => parseEnergyPage({ data: [] }), /data\.intervals/)
  assert.throws(() => parseEnergyPage({ data: { intervals: [null] } }), /invalid interval record/)
})
