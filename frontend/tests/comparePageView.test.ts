import assert from 'node:assert/strict'
import test from 'node:test'
import { objectiveText, requestObjective, sharedWindow, timelineBlocks } from '../src/pages/ComparePage/comparePageView.ts'

function entry(id: string, processId: string, startsAt: string, endsAt: string) {
  return { id, scheduleId: 's', machineId: 'm1', processId, productionOrderId: null, startsAt, endsAt, powerKw: 10, energyKwh: 10, cost: 1, quantity: null, sequence: 0, metadata: {} }
}
function schedule(kind: string, entries: ReturnType<typeof entry>[], requestId: string | null = 'r1') {
  return { id: kind, factoryId: 'f', name: kind, version: 1, status: 'published', horizonStart: '2026-01-04T00:00:00Z', horizonEnd: '2026-01-11T00:00:00Z', optimizationRequestId: requestId, optimizationResultId: null, entries, metadata: { kind }, totalEnergyCost: 1, totalEnergyKwh: 1 } as never
}
const baseline = schedule('baseline', [entry('b1', 'p1', '2026-01-05T06:00:00Z', '2026-01-05T08:00:00Z')])
const optimized = schedule('optimized', [entry('o1', 'p1', '2026-01-05T10:00:00Z', '2026-01-05T12:00:00Z')])
const data = {
  factory: { id: 'f', slug: 'f', name: 'F', timezone: 'UTC', currency: 'EUR', description: null, config: {} },
  machines: [{ id: 'm1', name: 'Drum' }],
  processes: [{ id: 'p1', name: 'Roast' }],
} as never

test('request objective follows the backend payload rules', () => {
  const requests = (objective: unknown) => ({ optimizationRequests: [{ id: 'r1', objective }] }) as never
  assert.equal(requestObjective(requests({}), optimized), 'cost')
  assert.equal(requestObjective(requests({ objective: 'cost' }), optimized), 'cost')
  assert.equal(requestObjective(requests({ cost: 1 }), optimized), 'cost')
  assert.equal(requestObjective(requests({ objective: 'solar' }), optimized), 'solar')
  assert.equal(requestObjective(requests({ weird: true }), optimized), null)
  assert.equal(requestObjective(requests({}), schedule('optimized', [], null)), null)
  assert.equal(requestObjective({ optimizationRequests: [] } as never, optimized), null)
})

test('objective text describes the optimizer objective and never invents one', () => {
  assert.match(objectiveText('cost'), /minimise modeled grid energy cost/)
  assert.match(objectiveText('solar'), /maximise the solar energy/)
  assert.equal(objectiveText(null), 'Objective: not recorded for this schedule.')
})

test('shared window covers both schedules in whole hours with one hour of padding', () => {
  const window = sharedWindow(baseline, optimized)
  assert.equal(window.horizonStart, '2026-01-05T05:00:00.000Z')
  assert.equal(window.horizonEnd, '2026-01-05T13:00:00.000Z')
})

test('timeline blocks of both schedules are positioned on the same window', () => {
  const window = sharedWindow(baseline, optimized)
  const base = timelineBlocks(data, baseline, window, undefined)
  const opt = timelineBlocks(data, optimized, window, baseline)
  assert.ok(Math.abs(base[0].leftFraction - 1 / 8) < 1e-9)
  assert.ok(Math.abs(opt[0].leftFraction - 5 / 8) < 1e-9)
  assert.equal(base[0].shifted, false)
  assert.equal(opt[0].shifted, true)
  assert.match(opt[0].tooltip, /Roast · Drum · 10:00–12:00 \(UTC\)/)
})
