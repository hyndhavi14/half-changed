import assert from 'node:assert/strict'
import test from 'node:test'
import { failureHint, optimizationState } from '../src/data/optimizationState.ts'

const base = { formatTime: (iso: string) => iso.slice(0, 16), factoryName: 'Pharma' }
const ok = { status: 'succeeded', created_at: '2026-10-08T10:00:00Z' }
const bad = { status: 'failed', created_at: '2026-10-08T11:00:00Z', error_message: 'Timed out.' }

test('nothing stored and nothing run is NOT RUN', () => {
  const state = optimizationState({ ...base, run: null, hasResults: false, optimizationRequests: [] })
  assert.equal(state.kind, 'not_run')
  assert.equal(state.showResults, false)
})

test('a failed session run is FAILED and older results are labelled, never shown as this run', () => {
  const state = optimizationState({ ...base, run: { status: 'failed', message: 'HTTP 502', finishedAt: null }, hasResults: true, optimizationRequests: [ok] })
  assert.equal(state.kind, 'failed')
  assert.equal(state.title, 'Optimization failed')
  assert.match(state.detail, /did not return a new schedule/)
  assert.equal(state.showResults, true)
  assert.match(state.resultLabel ?? '', /^Last successful optimization · generated 2026-10-08T10:00/)
})

test('running keeps the last successful results labelled as such', () => {
  const state = optimizationState({ ...base, run: { status: 'running', message: null, finishedAt: null }, hasResults: true, optimizationRequests: [ok] })
  assert.equal(state.kind, 'running')
  assert.match(state.resultLabel ?? '', /^Last successful optimization/)
})

test('a successful session run is SUCCESS and labels results as this run', () => {
  const state = optimizationState({ ...base, run: { status: 'succeeded', message: null, finishedAt: null }, hasResults: true, optimizationRequests: [ok] })
  assert.equal(state.kind, 'success')
  assert.match(state.resultLabel ?? '', /^This run/)
})

test('a stored failure newer than the last success is reported, with results labelled', () => {
  const state = optimizationState({ ...base, run: null, hasResults: true, optimizationRequests: [ok, bad] })
  assert.equal(state.kind, 'failed')
  assert.equal(state.title, 'Latest optimization failed')
  assert.match(state.resultLabel ?? '', /^Last successful optimization/)
  const clean = optimizationState({ ...base, run: null, hasResults: true, optimizationRequests: [ok] })
  assert.equal(clean.kind, 'last_success')
})

test('a known failure cause gets a plain-English fix', () => {
  assert.match(failureHint('The ByteMe API returned HTTP 503 (service_unavailable): The optimizer is not configured, so no schedule was produced.') ?? '', /BYTEME_OPTIMIZER_ENABLED=true/)
  assert.match(failureHint('Optimizer request timed out after 60000 ms') ?? '', /BYTEME_OPTIMIZER_TIMEOUT_MS=300000/)
  assert.match(failureHint('The ByteMe API returned HTTP 502 (upstream_error): Python optimizer process exited unsuccessfully.') ?? '', /optimizer:check/)
  assert.match(failureHint('The ByteMe API returned 502 Bad Gateway.') ?? '', /not reachable/)
  assert.match(failureHint('Windows Application Control blocked the OR-Tools native library (error 4551).') ?? '', /Do not bypass/)
  assert.equal(failureHint('Some unexpected validation error'), null)
  assert.equal(failureHint(null), null)
})
