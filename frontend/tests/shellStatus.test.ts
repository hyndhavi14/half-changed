import assert from 'node:assert/strict'
import test from 'node:test'
import { formatDateTime } from '../src/data/format.ts'
import type { LatestOptimization } from '../src/data/optimizationView.ts'
import { isAuthRequiredError, optimizerCardText } from '../src/layout/shellStatus.ts'

test('identifies missing authentication but does not mistake authorization failures for sign-in', () => {
  assert.equal(isAuthRequiredError('Authentication required. Sign in to access factory data.'), true)
  assert.equal(isAuthRequiredError('The ByteMe API returned HTTP 401 (unauthorized): x'), true)
  assert.equal(isAuthRequiredError('The ByteMe API returned HTTP 403 (forbidden): x'), false)
  assert.equal(isAuthRequiredError('HTTP 4010'), false)
  assert.equal(isAuthRequiredError(null), false)
  assert.equal(isAuthRequiredError(''), false)
})

const latest = (
  status: string,
  createdAt = '2026-10-08T03:30:00Z',
): LatestOptimization => ({ status, createdAt, errorMessage: null })

const input = (overrides: Partial<{
  latest: LatestOptimization | null
  timeZone: string | null
  optimizing: boolean
  hasData: boolean
}> = {}) => ({
  latest: latest('succeeded'),
  timeZone: 'Asia/Kolkata',
  optimizing: false,
  hasData: true,
  ...overrides,
})

test('optimization-in-progress takes precedence over all other states', () => {
  assert.deepEqual(optimizerCardText(input({
    latest: null,
    hasData: false,
    optimizing: true,
  })), {
    title: 'Optimization running',
    detail: 'Waiting for the optimizer result',
  })
})

test('reports unavailable data and an empty optimization history honestly', () => {
  assert.deepEqual(optimizerCardText(input({ hasData: false })), {
    title: 'Optimizer',
    detail: 'Status not available',
  })
  assert.deepEqual(optimizerCardText(input({ latest: null })), {
    title: 'Optimizer',
    detail: 'No optimization runs yet',
  })
})

test('formats the latest successful request in the factory timezone using its actual timestamp', () => {
  const result = optimizerCardText(input())
  assert.equal(result.title, 'Last optimization')
  assert.ok(result.detail.startsWith('Succeeded · '))
  assert.ok(result.detail.includes(formatDateTime('2026-10-08T03:30:00Z', 'Asia/Kolkata')))
  assert.equal(result.detail.includes('09:40'), false)
  assert.ok(optimizerCardText(input({
    latest: latest('succeeded', '2026-10-08T04:10:00Z'),
  })).detail.includes('09:40'))
})

test('maps failure, queued, unconfigured, and unknown statuses', () => {
  assert.match(optimizerCardText(input({ latest: latest('failed') })).detail, /^Failed · /)
  assert.match(optimizerCardText(input({ latest: latest('queued') })).detail, /^In progress · /)
  assert.match(optimizerCardText(input({ latest: latest('not_configured') })).detail, /^Optimizer not configured · /)
  assert.match(optimizerCardText(input({ latest: latest('paused') })).detail, /^Paused · /)
})

test('uses UTC when the factory timezone is unavailable', () => {
  const result = optimizerCardText(input({
    latest: latest('succeeded', '2026-10-08T03:30:00Z'),
    timeZone: null,
  }))
  assert.ok(result.detail.includes(formatDateTime('2026-10-08T03:30:00Z', 'UTC')))
})
