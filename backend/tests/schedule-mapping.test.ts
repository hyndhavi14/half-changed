import { describe, expect, it } from 'vitest'
import { UpstreamError } from '@/lib/errors'
import { buildOptimizationScheduleWrites } from '@/lib/optimizer/scheduleMapping'
import { pythonTestProblem } from './helpers/pythonProblem'
import type { OptimizationSolution } from '@/lib/optimizer/contract'

function solution(overrides: Partial<OptimizationSolution> = {}): OptimizationSolution {
  const problem = pythonTestProblem()
  const first = problem.processes[0]!
  const second = problem.processes[1]!
  return {
    objectiveValue: null,
    totalEnergyCost: 71.25,
    totalEnergyKwh: 700,
    peakDemandKw: null,
    entries: [
      {
        machineId: first.machineId,
        processId: first.id,
        productionOrderId: null,
        startsAt: '2026-03-02T00:00:00.000Z',
        endsAt: '2026-03-02T02:00:00.000Z',
        powerKw: 250,
        energyKwh: 500,
        cost: 50,
        quantity: 500,
        sequence: 0,
        metadata: { planned: true, optimizer_relative_start_hours: 0 },
      },
      {
        machineId: second.machineId,
        processId: second.id,
        productionOrderId: null,
        startsAt: '2026-03-02T02:00:00.000Z',
        endsAt: '2026-03-02T03:00:00.000Z',
        powerKw: 200,
        energyKwh: 200,
        cost: 21.25,
        quantity: 480,
        sequence: 1,
        metadata: { planned: true, optimizer_relative_start_hours: 2 },
      },
    ],
    metrics: { optimizer_status: 'OPTIMAL' },
    raw: { api_version: '2.0', untouched: true },
    ...overrides,
  }
}

describe('optimizer schedule persistence mapping', () => {
  it('preserves canonical IDs, exact UTC intervals, null order links, and both plan kinds', () => {
    const result = solution()
    const writes = buildOptimizationScheduleWrites(pythonTestProblem(), {
      ...result,
      baselineEntries: result.entries.map((entry) => ({ ...entry })),
    })

    expect(writes.map(({ kind }) => kind)).toEqual(['baseline', 'optimized'])
    expect(writes[0]?.entries[0]).toMatchObject({
      process_id: pythonTestProblem().processes[0]?.id,
      machine_id: pythonTestProblem().processes[0]?.machineId,
      production_order_id: null,
      starts_at: '2026-03-02T00:00:00.000Z',
      ends_at: '2026-03-02T02:00:00.000Z',
      energy_kwh: 500,
      cost: 50,
    })
    expect(writes[1]).toMatchObject({
      total_energy_kwh: 700,
      total_energy_cost: 71.25,
      peak_demand_kw: 250,
    })
  })

  it('creates only the optimized schedule when the optimizer returned no baseline', () => {
    const writes = buildOptimizationScheduleWrites(pythonTestProblem(), solution())
    expect(writes.map(({ kind }) => kind)).toEqual(['optimized'])
  })

  it('normalizes horizon timestamps to the same absolute UTC instants', () => {
    const problem = pythonTestProblem({
      horizon: {
        start: '2026-03-01T19:00:00-05:00',
        end: '2026-03-02T19:00:00-05:00',
      },
    })
    const [write] = buildOptimizationScheduleWrites(problem, solution())

    expect(write).toMatchObject({
      horizon_start: '2026-03-02T00:00:00.000Z',
      horizon_end: '2026-03-03T00:00:00.000Z',
    })
  })

  it('rejects duration drift rather than rounding entry timestamps', () => {
    const invalid = solution()
    invalid.entries[0]!.endsAt = '2026-03-02T01:30:00.000Z'
    expect(() => buildOptimizationScheduleWrites(pythonTestProblem(), invalid)).toThrow(UpstreamError)
  })

  it('rejects reported totals inconsistent with the schedule entries', () => {
    expect(() => buildOptimizationScheduleWrites(
      pythonTestProblem(),
      solution({ totalEnergyKwh: 701 }),
    )).toThrow(/energy does not match/)
  })

  it('keeps unknown header totals null when entry metrics are unavailable', () => {
    const result = solution({
      totalEnergyCost: null,
      totalEnergyKwh: null,
      entries: solution().entries.map((entry) => ({ ...entry, energyKwh: null, cost: null, powerKw: null })),
    })
    const [write] = buildOptimizationScheduleWrites(pythonTestProblem(), result)
    expect(write).toMatchObject({
      total_energy_cost: null,
      total_energy_kwh: null,
      peak_demand_kw: null,
    })
  })
})
