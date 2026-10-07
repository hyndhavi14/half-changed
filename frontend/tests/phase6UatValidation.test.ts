import { describe, expect, it } from 'vitest'
import {
  authGateFailureState,
  canRunOptimization,
  identifyPersistedSchedulePair,
} from '../src/pages/phase6UatValidation'

const factoryId = 'f02b6ad2-d787-411e-812e-4c1f3dbc5cf2'
const requestId = 'a09610ee-1247-45be-a1cb-e95fa8b53e9e'
const resultId = '91b0f43b-e1a0-4d06-a2e1-bb51e59691d0'
const machineId = '3a4d7b7f-22ad-4b76-b313-6d2b097c7369'
const processId = '170bab8b-d1e7-4617-a167-cf35a703265b'
const horizonStart = '2026-10-04T00:00:00+00:00'
const horizonEnd = '2026-10-11T00:00:00+00:00'

const context = {
  factoryId,
  requestId,
  resultId,
  horizonStart,
  horizonEnd,
  processes: [{ id: processId, machine_id: machineId, duration_minutes: 25 }],
  machineIds: new Set([machineId]),
  orderIds: new Set<string>(),
}

function persistedSchedule(kind: 'baseline' | 'optimized', start = '2026-10-04T00:00:00+00:00') {
  const scheduleId = kind === 'baseline'
    ? '0fe67b38-8ec7-4bdf-af97-9bbceecf09f7'
    : 'f0d8f68a-b364-4dde-88fa-c42cd4b5c325'
  const entryId = kind === 'baseline'
    ? '21c21f45-55c7-47a3-ad0d-746875bdde29'
    : 'f590990a-1b7f-47e7-b962-0c9dc5b626eb'
  return {
    schedule: {
      id: scheduleId,
      factory_id: factoryId,
      optimization_request_id: requestId,
      optimization_result_id: resultId,
      status: 'draft',
      horizon_start: horizonStart,
      horizon_end: horizonEnd,
      metadata: { kind },
    },
    entries: [{
      id: entryId,
      schedule_id: scheduleId,
      machine_id: machineId,
      process_id: processId,
      production_order_id: null,
      starts_at: start,
      ends_at: new Date(Date.parse(start) + 25 * 60_000).toISOString(),
    }],
  }
}

describe('Phase 6 persisted schedule validation', () => {
  it('allows optimization only after auth passes with a snapshot and an unconsumed, idle one-shot', () => {
    expect(canRunOptimization({
      authPassed: true,
      hasSnapshot: true,
      optimizationAttempted: false,
      busy: false,
    })).toBe(true)
    expect(canRunOptimization({
      authPassed: false,
      hasSnapshot: true,
      optimizationAttempted: false,
      busy: false,
    })).toBe(false)
    expect(canRunOptimization({
      authPassed: true,
      hasSnapshot: false,
      optimizationAttempted: false,
      busy: false,
    })).toBe(false)
    expect(canRunOptimization({
      authPassed: true,
      hasSnapshot: true,
      optimizationAttempted: true,
      busy: false,
    })).toBe(false)
    expect(canRunOptimization({
      authPassed: true,
      hasSnapshot: true,
      optimizationAttempted: false,
      busy: true,
    })).toBe(false)
  })

  it('clears auth-bound snapshot, outcome, and verification events after an auth-gate failure', () => {
    expect(authGateFailureState(false)).toEqual({
      authPassed: false,
      snapshot: null,
      outcome: null,
      events: [],
      optimizationAttempted: false,
    })
  })

  it('preserves the consumed one-shot state when the auth gate fails', () => {
    expect(authGateFailureState(true).optimizationAttempted).toBe(true)
    expect(canRunOptimization({
      authPassed: false,
      hasSnapshot: false,
      optimizationAttempted: authGateFailureState(true).optimizationAttempted,
      busy: false,
    })).toBe(false)
  })

  it('accepts the canonical baseline and optimized pair and selects optimized by metadata', () => {
    const pair = identifyPersistedSchedulePair(
      [persistedSchedule('baseline'), persistedSchedule('optimized')],
      context,
    )

    expect(pair.baseline.schedule.metadata).toEqual({ kind: 'baseline' })
    expect(pair.optimized.schedule.id).toBe('f0d8f68a-b364-4dde-88fa-c42cd4b5c325')
  })

  it('rejects a missing, extra, or duplicate-identity schedule', () => {
    expect(() => identifyPersistedSchedulePair([persistedSchedule('optimized')], context))
      .toThrow(/exactly one persisted baseline and one optimized/)
    expect(() => identifyPersistedSchedulePair([
      persistedSchedule('baseline'),
      persistedSchedule('optimized'),
      persistedSchedule('optimized'),
    ], context)).toThrow(/exactly one persisted baseline and one optimized/)

    const duplicate = persistedSchedule('baseline')
    expect(() => identifyPersistedSchedulePair([
      duplicate,
      { ...persistedSchedule('optimized'), schedule: { ...persistedSchedule('optimized').schedule, metadata: { kind: 'baseline' } } },
    ], context)).toThrow(/duplicate identities/)
  })

  it('rejects non-canonical identities and timestamps without a UTC offset', () => {
    const invalidUuid = persistedSchedule('optimized')
    invalidUuid.entries[0]!.process_id = 'frontend-process'
    expect(() => identifyPersistedSchedulePair([
      persistedSchedule('baseline'),
      invalidUuid,
    ], context)).toThrow(/Invalid canonical UUID/)

    expect(() => identifyPersistedSchedulePair([
      persistedSchedule('baseline'),
      persistedSchedule('optimized', '2026-10-04T00:00:00'),
    ], context)).toThrow(/unchanged UTC timestamp/)
  })
})
