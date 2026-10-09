import { describe, expect, it } from 'vitest'
import { UpstreamError } from '@/lib/errors'
import { decodePythonResponse } from '@/lib/optimizer/pythonResponse'
import type { OptimizationProblem } from '@/lib/optimizer/contract'

const FACTORY_ID = '11111111-1111-4111-8111-111111111111'
const MACHINE_ID = '33333333-3333-4333-8333-333333333333'
const PROCESS_ID = '55555555-5555-4555-8555-555555555555'
const HORIZON_START = '2026-03-02T08:00:00.000Z'
const HORIZON_END = '2026-03-03T08:00:00.000Z'

const problem: OptimizationProblem = {
  schemaVersion: '1.0.0',
  requestReference: 'req-test',
  factoryId: FACTORY_ID,
  factory: {
    slug: 'demo-chocolate-factory',
    name: 'Demo Chocolate Factory',
    timezone: 'Europe/Amsterdam',
    currency: 'EUR',
    config: {},
    metadata: {},
  },
  horizon: { start: HORIZON_START, end: HORIZON_END },
  machines: [{
    id: MACHINE_ID,
    slug: 'roasting-drum',
    name: 'Roasting Drum',
    type: 'thermal_asset',
    ratedPowerKw: 250,
    minPowerKw: 90,
    maxPowerKw: 250,
    minRuntimeMinutes: 30,
    maxRuntimeMinutes: 480,
    availability: {},
    metadata: {},
  }],
  processes: [{
    id: PROCESS_ID,
    slug: 'roast-bean-blend',
    name: 'Roast Bean Blend',
    description: null,
    durationMinutes: 120,
    machineId: MACHINE_ID,
    powerRequirementKw: 250,
    productionQuantity: 500,
    unit: 'kg',
    metadata: {},
  }],
  dependencies: [],
  productionOrders: [],
  energyData: [],
  tariffs: [],
  objective: {},
  constraints: {},
}

function response(overrides: Record<string, unknown> = {}) {
  return {
    api_version: '2.0',
    status: 'OPTIMAL',
    result: {
      status: 'OPTIMAL',
      optimization_scope: 'FULL_DECLARED_CONSTRAINTS',
      baseline: null,
      optimized: {
        status: 'OPTIMAL',
        makespan_hours: 3,
        solve_time_seconds: 0.5,
        solver_diagnostics: {
          status: 'OPTIMAL',
          best_objective: 10,
          best_bound: 10,
          optimality_gap: 0,
        },
        processes: [{
          process_id: PROCESS_ID,
          process_name: 'Roast Bean Blend',
          start_time: 1,
          end_time: 3,
          duration_hours: 2,
          power_kw: 250,
          is_flexible: true,
          machine_id: MACHINE_ID,
          capacity_units: 1,
          machine_capacity: 1,
          quantity: 500,
          solar_kwh: 100,
          grid_kwh: 400,
          energy_cost: 50,
          tariff: 0.125,
        }],
        energy: { total_kwh: 500, solar_kwh: 100, grid_kwh: 400 },
      },
      comparison: {
        cost_optimized: 50,
      },
      warnings: [],
    },
    errors: null,
    warnings: [],
    error_category: null,
    ...overrides,
  }
}

describe('decodePythonResponse', () => {
  it('maps public API v2 output into absolute backend entries with canonical UUIDs', () => {
    const raw = response()
    const solution = decodePythonResponse(raw, problem, ['availability is informational'])

    expect(solution.entries).toEqual([{
      machineId: MACHINE_ID,
      processId: PROCESS_ID,
      productionOrderId: null,
      startsAt: '2026-03-02T09:00:00.000Z',
      endsAt: '2026-03-02T11:00:00.000Z',
      powerKw: 250,
      energyKwh: 500,
      cost: 50,
      quantity: 500,
      sequence: 0,
      metadata: {
        planned: true,
        solar_kwh: 100,
        grid_kwh: 400,
        optimizer_relative_start_hours: 1,
        optimizer_relative_end_hours: 3,
      },
    }])
    expect(solution.totalEnergyCost).toBe(50)
    expect(solution.totalEnergyKwh).toBe(500)
    expect(solution.peakDemandKw).toBeNull()
    expect(solution.raw).toBe(raw)
    expect(solution.metrics.integration_warnings).toEqual(['availability is informational'])
  })

  it('validates and maps an available baseline using the same absolute-time contract', () => {
    const raw = response()
    const result = raw.result as {
      baseline: unknown
      optimized: Record<string, unknown>
    }
    result.baseline = structuredClone(result.optimized)

    const solution = decodePythonResponse(raw, problem, [])

    expect(solution.baselineEntries).toEqual(solution.entries)
    expect(solution.baselineEntries?.[0]).toMatchObject({
      processId: PROCESS_ID,
      machineId: MACHINE_ID,
      startsAt: '2026-03-02T09:00:00.000Z',
      endsAt: '2026-03-02T11:00:00.000Z',
    })
  })

  it('accepts and maps exact-minute relative times for a 25-minute process', () => {
    const raw = response()
    const result = raw.result as {
      optimized: { processes: Array<Record<string, unknown>> }
    }
    const input = structuredClone(problem)
    input.processes[0]!.durationMinutes = 25
    const entry = result.optimized.processes[0]!
    entry.start_time = 15 / 60
    entry.end_time = 40 / 60
    entry.duration_hours = 25 / 60

    const solution = decodePythonResponse(raw, input, [])

    expect(solution.entries[0]).toMatchObject({
      startsAt: '2026-03-02T08:15:00.000Z',
      endsAt: '2026-03-02T08:40:00.000Z',
    })
    expect(Date.parse(solution.entries[0]!.endsAt) - Date.parse(solution.entries[0]!.startsAt))
      .toBe(25 * 60 * 1000)
  })

  it('maps late 168-hour schedule times to absolute timestamps without truncation', () => {
    const raw = response()
    const input = structuredClone(problem)
    input.horizon.end = '2026-03-09T08:00:00.000Z'
    input.processes[0]!.durationMinutes = 25

    const result = raw.result as {
      optimized: {
        makespan_hours: number
        processes: Array<Record<string, unknown>>
      }
    }
    result.optimized.makespan_hours = 160 + 25 / 60
    result.optimized.processes[0]!.start_time = 9600 / 60
    result.optimized.processes[0]!.end_time = 9625 / 60
    result.optimized.processes[0]!.duration_hours = 25 / 60

    const solution = decodePythonResponse(raw, input, [])

    expect(solution.entries[0]).toMatchObject({
      startsAt: '2026-03-09T00:00:00.000Z',
      endsAt: '2026-03-09T00:25:00.000Z',
    })
  })

  it('accepts every whole minute of a day despite floating-point noise in hours', () => {
    const input = structuredClone(problem)
    input.horizon.end = '2026-03-03T08:00:00.000Z'
    input.processes[0]!.durationMinutes = 1
    for (let minute = 0; minute < 24 * 60; minute += 1) {
      const raw = response()
      const result = raw.result as {
        optimized: { makespan_hours: number; processes: Array<Record<string, unknown>> }
      }
      result.optimized.makespan_hours = (minute + 1) / 60
      result.optimized.processes[0]!.start_time = minute / 60
      result.optimized.processes[0]!.end_time = (minute + 1) / 60
      result.optimized.processes[0]!.duration_hours = 1 / 60
      const solution = decodePythonResponse(raw, input, [])
      expect(Date.parse(solution.entries[0]!.startsAt)).toBe(Date.parse('2026-03-02T08:00:00.000Z') + minute * 60_000)
    }
  })

  it('rejects a non-minute relative start rather than rounding it', () => {
    const raw = response()
    const result = raw.result as {
      baseline: null | { processes: Array<Record<string, unknown>> }
      optimized: unknown
    }
    result.baseline = structuredClone(result.optimized) as typeof result.baseline
    result.baseline!.processes[0]!.start_time = 0.01
    result.baseline!.processes[0]!.end_time = 2.01

    expect(() => decodePythonResponse(raw, problem, [])).toThrow(/baseline schedule interval/)
  })

  it.each(['INFEASIBLE', 'UNKNOWN', 'INVALID INPUT', 'ERROR'])(
    'surfaces non-schedule status %s and does not return a solution',
    (status) => {
      const raw = response({
        status,
        result: { status, optimized: null, baseline: null },
        error_category: status === 'INFEASIBLE' ? 'INFEASIBLE' : null,
      })

      expect(() => decodePythonResponse(raw, problem, [])).toThrow(UpstreamError)
      expect(() => decodePythonResponse(raw, problem, [])).toThrow(status)
    },
  )

  it('rejects schedules with non-canonical IDs', () => {
    const raw = response()
    const result = raw.result as { optimized: { processes: Array<Record<string, unknown>> } }
    result.optimized.processes[0]!.process_id = '00000000-0000-4000-8000-000000000000'

    expect(() => decodePythonResponse(raw, problem, [])).toThrow(/unknown or duplicate process UUID/)
  })
})
