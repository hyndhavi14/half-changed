import { describe, expect, it } from 'vitest'
import { ValidationError } from '@/lib/errors'
import { buildPythonOptimizerRequest } from '@/lib/optimizer/pythonPayload'
import {
  canonicalSevenDayPythonProblem,
  pythonTestProblem,
} from './helpers/pythonProblem'
import {
  chocolateFactory,
  grindProcess,
  roastProcess,
  thermalMachine,
} from './helpers/fixtures'

describe('buildPythonOptimizerRequest', () => {
  it('maps canonical UUIDs and exact demo values into Python API v2', () => {
    const { request, integrationWarnings } = buildPythonOptimizerRequest(pythonTestProblem())

    expect(request.factory.factory_id).toBe(chocolateFactory.id)
    expect(request.factory.processes.map((process) => process.process_id)).toEqual([
      roastProcess.id,
      grindProcess.id,
    ])
    expect(request.factory.processes.map((process) => process.duration_hours)).toEqual([2, 1])
    expect(request.factory.processes[1]?.dependencies).toEqual([roastProcess.id])
    expect(request.factory.machines[0]?.machine_id).toBe(thermalMachine.id)
    expect(request.energy.solar_profile).toMatchObject({ '0': 0.2, '23': 0.2 })
    expect(request.energy.tariff_profile).toMatchObject({
      '0': 0.085,
      '6': 0.142,
      '16': 0.218,
      '21': 0.085,
    })
    expect(request.options.objective).toBe('cost')
    expect(integrationWarnings).toEqual(expect.arrayContaining([
      expect.stringContaining('availability calendars'),
      expect.stringContaining('demand charges'),
      expect.stringContaining('flexible'),
    ]))
  })

  it('rejects an incomplete generation series instead of filling missing solar with zero', () => {
    const input = pythonTestProblem()
    input.energyData.pop()

    expect(() => buildPythonOptimizerRequest(input)).toThrow(ValidationError)
    expect(() => buildPythonOptimizerRequest(input)).toThrow(/missing the 15-minute interval/)
  })

  it.each([25, 30, 35, 40, 45, 60])('preserves an exact %i-minute duration', (durationMinutes) => {
    const input = pythonTestProblem()
    input.processes[1]!.durationMinutes = durationMinutes

    const { request } = buildPythonOptimizerRequest(input)

    expect(request.factory.processes[1]?.duration_hours).toBe(durationMinutes / 60)
  })

  it.each([0, -1, 25.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid duration_minutes value %s',
    (durationMinutes) => {
      const input = pythonTestProblem()
      input.processes[1]!.durationMinutes = durationMinutes

      expect(() => buildPythonOptimizerRequest(input)).toThrow(
        /finite number|positive whole number of minutes/,
      )
    },
  )

  it('preserves duration values as exact integer-minute hours in the Python payload', () => {
    const input = pythonTestProblem()
    input.processes[1]!.durationMinutes = 25

    const { request } = buildPythonOptimizerRequest(input)

    expect(request.factory.processes[1]?.duration_hours).toBe(25 / 60)
  })

  it('rejects unsupported dependency semantics', () => {
    const input = pythonTestProblem()
    input.dependencies[0]!.lagMinutes = 15

    expect(() => buildPythonOptimizerRequest(input)).toThrow(/finish_to_start dependencies with zero lag/)
  })

  it('rejects horizons shorter than 24 hours or not aligned to whole UTC hours', () => {
    const input = pythonTestProblem()
    input.horizon.end = new Date(Date.parse(input.horizon.start ?? '') + 12 * 60 * 60 * 1000).toISOString()

    expect(() => buildPythonOptimizerRequest(input)).toThrow(/at least 24 whole hours/)
  })

  it('maps all 168 elapsed hours and preserves weekday/weekend tariffs', () => {
    const problem = canonicalSevenDayPythonProblem()
    const rawEnergy = structuredClone(problem.energyData)
    const { request } = buildPythonOptimizerRequest(problem)

    expect(request.factory.planning_horizon_hours).toBe(168)
    expect(request.factory.production_deadline).toBe(168)
    expect(Object.keys(request.energy.solar_profile)).toHaveLength(168)
    expect(Object.keys(request.energy.tariff_profile)).toHaveLength(168)
    expect(request.energy.solar_profile['0']).toBe(0.2)
    expect(request.energy.solar_profile['30']).toBe(0.4)
    expect(request.energy.solar_profile['54']).toBe(0.2)
    expect(request.energy.tariff_profile['16']).toBe(0.218)
    expect(request.energy.tariff_profile['127']).toBe(0.165)
    expect(request.factory.processes.map((process) => process.duration_hours)).toEqual(
      [120, 45, 300, 720, 60, 35, 25, 40].map((minutes) => minutes / 60),
    )
    expect(request.factory.processes.map((process) => process.process_id)).toEqual(
      problem.processes.map((process) => process.id),
    )
    expect(problem.energyData).toEqual(rawEnergy)
    expect(problem.horizon.start).toBe('2026-03-02T00:00:00.000Z')
    expect(problem.horizon.end).toBe('2026-03-09T00:00:00.000Z')
  })

  it('rejects missing, duplicate, or out-of-order full-horizon readings', () => {
    const missing = canonicalSevenDayPythonProblem()
    missing.energyData.pop()
    expect(() => buildPythonOptimizerRequest(missing)).toThrow(/missing the 15-minute interval/)

    const duplicate = canonicalSevenDayPythonProblem()
    duplicate.energyData[1] = { ...duplicate.energyData[0]! }
    expect(() => buildPythonOptimizerRequest(duplicate)).toThrow(/duplicate interval timestamps/)

    const outOfOrder = canonicalSevenDayPythonProblem()
    ;[outOfOrder.energyData[1], outOfOrder.energyData[2]] =
      [outOfOrder.energyData[2]!, outOfOrder.energyData[1]!]
    expect(() => buildPythonOptimizerRequest(outOfOrder)).toThrow(/chronological order/)

    const invalid = canonicalSevenDayPythonProblem()
    invalid.energyData[0]!.intervalMinutes = 30
    expect(() => buildPythonOptimizerRequest(invalid)).toThrow(/site-level 15-minute intervals/)
  })

  it('resolves each UTC hour through the factory timezone across a DST fallback', () => {
    const problem = canonicalSevenDayPythonProblem()
    const start = Date.parse('2026-10-24T22:00:00.000Z')
    const tariff = problem.tariffs[0]!
    problem.horizon = {
      start: new Date(start).toISOString(),
      end: new Date(start + 48 * 60 * 60 * 1000).toISOString(),
    }
    problem.energyData = Array.from({ length: 48 * 4 }, (_, index) => ({
      recordedAt: new Date(start + index * 15 * 60 * 1000).toISOString(),
      intervalMinutes: 15,
      consumptionKwh: 120,
      generationKwh: 0.05,
      machineId: null,
    }))
    problem.tariffs = [
      ...problem.tariffs,
      {
        ...tariff,
        slug: 'demo-dst-repeat-hour',
        startTime: '02:00',
        endTime: '03:00',
        daysOfWeek: [7],
        energyPricePerKwh: 0.3,
        priority: 40,
      },
    ]

    const { request } = buildPythonOptimizerRequest(problem)

    expect(request.energy.tariff_profile['2']).toBe(0.3)
    expect(request.energy.tariff_profile['3']).toBe(0.3)
  })

})
