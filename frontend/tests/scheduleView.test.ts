import assert from 'node:assert/strict'
import test from 'node:test'
import type { BackendFactoryData } from '../src/data/backendApi.ts'
import {
  comparisonMetrics,
  entryGridKwh,
  entrySolarKwh,
  makespanMinutes,
  plannedLoad,
  processColorKey,
  processShifts,
  scheduleBlocks,
  scheduleEnergySplit,
  tariffBandAt,
} from '../src/data/scheduleView.ts'

const factoryId = '00000000-0000-4000-8000-000000000001'
const machineId = '00000000-0000-4000-8000-000000000002'

function entry(processId: string, start: string, end: string, options: {
  cost?: number | null
  metadata?: Record<string, unknown>
} = {}) {
  return {
    id: `entry-${processId}-${start}`,
    scheduleId: 'schedule',
    machineId,
    processId,
    productionOrderId: null,
    startsAt: start,
    endsAt: end,
    powerKw: 4,
    energyKwh: 2,
    cost: options.cost ?? 10,
    quantity: null,
    sequence: 1,
    metadata: options.metadata ?? { solar_kwh: 1, grid_kwh: 1 },
  }
}

function fixture(): BackendFactoryData {
  const baseline = {
    id: 'baseline',
    factoryId,
    name: 'Baseline',
    version: 1,
    status: 'draft' as const,
    horizonStart: '2026-10-01T00:00:00Z',
    horizonEnd: '2026-10-04T00:00:00Z',
    optimizationRequestId: null,
    optimizationResultId: null,
    entries: [
      entry('p1', '2026-10-01T08:00:00Z', '2026-10-01T09:00:00Z'),
      entry('p2', '2026-10-01T09:00:00Z', '2026-10-01T10:00:00Z'),
      entry('p3', '2026-10-01T10:00:00Z', '2026-10-01T11:00:00Z'),
    ],
    metadata: { kind: 'baseline' },
    totalEnergyCost: 30,
    totalEnergyKwh: 6,
    peakDemandKw: 12,
  }
  const optimized = {
    ...baseline,
    id: 'optimized',
    name: 'Optimized',
    entries: [
      entry('p1', '2026-10-01T07:00:00Z', '2026-10-01T08:00:00Z', { cost: 8 }),
      entry('p2', '2026-10-01T09:00:00Z', '2026-10-01T10:00:00Z'),
      entry('p3', '2026-10-01T11:00:00Z', '2026-10-01T12:00:00Z', { cost: 12 }),
    ],
    metadata: { kind: 'optimized' },
    totalEnergyCost: 28,
    totalEnergyKwh: 6,
    peakDemandKw: 10,
  }
  return {
    factory: {
      id: factoryId,
      slug: 'sample',
      name: 'Sample',
      timezone: 'UTC',
      currency: 'INR',
      description: null,
      config: {},
    },
    machines: [{ id: machineId, factoryId, slug: 'machine', name: 'Machine A', type: null, ratedPowerKw: 10, isActive: true }],
    processes: ['p1', 'p2', 'p3'].map((id) => ({
      id,
      factoryId,
      slug: id,
      name: `Process ${id}`,
      durationMinutes: 60,
      machineId,
      powerRequirementKw: 4,
      quantity: null,
      unit: null,
      isActive: true,
    })),
    dependencies: [],
    orders: [],
    energy: [],
    tariffs: [
      { name: 'Night', start_time: '00:00:00', end_time: '08:00:00', energy_price_per_kwh: 2 },
      { name: 'Day', start_time: '08:00', end_time: '17:00', energy_price_per_kwh: '5' },
    ],
    schedules: [baseline, optimized],
    optimizationRequests: [],
    optimizationResults: [],
  } as unknown as BackendFactoryData
}

test('positions blocks against the full 72-hour schedule horizon and keeps tooltip times', () => {
  const data = fixture()
  const blocks = scheduleBlocks(data, data.schedules[0]!)
  assert.equal(blocks[0]?.startFraction, 8 / 72)
  assert.equal(blocks[0]?.endFraction, 9 / 72)
  assert.equal(blocks[0]?.startMs, Date.parse('2026-10-01T08:00:00Z'))
  assert.equal(blocks[0]?.tooltip, '1 Oct, 08:00–09:00')
})

test('uses a stable process color index independent of which schedule is rendered', () => {
  const ordered = ['p1', 'p2', 'p3']
  assert.equal(processColorKey('p2', ordered), processColorKey('p2', ordered))
  assert.equal(processColorKey('p2', ordered), 'process-1')
  assert.match(processColorKey('unknown', ordered), /^process-[0-7]$/)
})

test('calculates makespan and all-or-nothing schedule energy split', () => {
  const data = fixture()
  const schedule = data.schedules[0]!
  assert.equal(makespanMinutes(schedule), 180)
  assert.deepEqual(scheduleEnergySplit(schedule), { solarKwh: 3, gridKwh: 3 })
  const incomplete = { ...schedule, entries: [schedule.entries[0]!, { ...schedule.entries[1]!, metadata: {} }] }
  assert.deepEqual(scheduleEnergySplit(incomplete), { solarKwh: null, gridKwh: null })
  assert.equal(entrySolarKwh({ metadata: { solar_kwh: Number.NaN } }), null)
  assert.equal(entryGridKwh({ metadata: { grid_kwh: 4 } }), 4)
})

test('omits metrics with a missing side and requires complete solar metadata', () => {
  const data = fixture()
  const optimized = data.schedules[1]!
  optimized.entries[1]!.metadata = { solar_kwh: 1 }
  const metrics = comparisonMetrics({
    ...data,
    schedules: [{ ...data.schedules[0]!, totalEnergyCost: null }, optimized],
  } as BackendFactoryData)
  assert.equal(metrics.some((metric) => metric.key === 'cost'), false)
  assert.equal(metrics.some((metric) => metric.key === 'solar-share'), false)
  assert.equal(metrics.some((metric) => metric.key === 'grid-import'), false)
  assert.equal(metrics.every((metric) => metric.provenance === 'modeled'), true)
})

test('reports signed process shifts and tariff boundary bands', () => {
  const data = fixture()
  const shifts = processShifts(data)
  assert.deepEqual(shifts.map((shift) => shift.shiftMinutes), [-60, 60])
  assert.equal(shifts[0]?.costDelta, -2)
  assert.equal(shifts[0]?.baselineBand?.name, 'Day')
  assert.equal(shifts[0]?.optimizedBand?.name, 'Night')
  assert.equal(
    tariffBandAt(data.tariffs, '2026-10-01T08:00:00Z', 'UTC')?.name,
    'Day',
  )
  assert.equal(
    tariffBandAt(data.tariffs, '2026-10-01T17:00:00Z', 'UTC'),
    null,
  )
})

test('reports planned machine load without presenting it as utilization', () => {
  const data = fixture()
  assert.deepEqual(plannedLoad(data, data.schedules[0]!, machineId), {
    scheduledMinutes: 180,
    horizonMinutes: 4320,
    percent: 180 / 4320 * 100,
    provenance: 'planned',
  })
})
