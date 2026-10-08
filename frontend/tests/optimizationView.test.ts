import assert from 'node:assert/strict'
import test from 'node:test'
import { latestOptimization } from '../src/data/optimizationView.ts'

test('returns the newest optimization request with its status and error message', () => {
  assert.deepEqual(latestOptimization([
    { status: 'pending', created_at: '2026-10-01T00:00:00Z', error_message: null },
    { status: 'failed', created_at: '2026-10-02T00:00:00Z', error_message: 'No feasible plan' },
  ]), {
    status: 'failed',
    createdAt: '2026-10-02T00:00:00Z',
    errorMessage: 'No feasible plan',
  })
  assert.equal(latestOptimization([]), null)
})
