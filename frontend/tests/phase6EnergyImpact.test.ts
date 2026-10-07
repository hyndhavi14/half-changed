import { describe, expect, it } from 'vitest'
import {
  compareScheduleImpact,
  projectPersistedImpactEntries,
  type ImpactEntry,
  type ImpactProcess,
  type SolarReading,
} from '../src/pages/phase6EnergyImpact'

const horizonStart = '2026-10-04T00:00:00.000Z'
const horizonEnd = '2026-10-04T02:00:00.000Z'
const processes: ImpactProcess[] = [
  { id: 'process-a', name: 'Process A', machineId: 'machine-a', durationMinutes: 25, powerKw: 60 },
  { id: 'process-b', name: 'Process B', machineId: 'machine-b', durationMinutes: 35, powerKw: 60 },
]

function entry(
  process: ImpactProcess,
  startsAt: string,
  solarKwh: number,
  gridKwh: number,
  touCost: number,
): ImpactEntry {
  const starts = Date.parse(startsAt)
  return {
    processId: process.id,
    machineId: process.machineId,
    startsAt,
    endsAt: new Date(starts + process.durationMinutes * 60_000).toISOString(),
    powerKw: process.powerKw,
    energyKwh: process.powerKw * process.durationMinutes / 60,
    solarKwh,
    gridKwh,
    touCost,
  }
}

function solarReadings(
  start = horizonStart,
  hours = 2,
  generationPerIntervalKwh = 10,
): SolarReading[] {
  const startMs = Date.parse(start)
  return Array.from({ length: hours * 4 }, (_, index) => ({
    recordedAt: new Date(startMs + index * 15 * 60_000).toISOString(),
    intervalMinutes: 15,
    generationKwh: generationPerIntervalKwh,
    machineId: null,
  }))
}

function comparisonInput() {
  return {
    processes,
    horizonStart,
    horizonEnd,
    solarReadings: solarReadings(),
    baselineEntries: [
      entry(processes[0]!, horizonStart, 10, 15, 5),
      entry(processes[1]!, horizonStart, 10, 25, 5),
    ],
    optimizedEntries: [
      entry(processes[0]!, horizonStart, 25, 0, 2),
      entry(processes[1]!, '2026-10-04T01:00:00.000Z', 25, 10, 1),
    ],
  }
}

describe('Phase 6 modeled schedule impact', () => {
  it('compares modeled energy, optimizer TOU costs, scheduled peak, and process shifts', () => {
    const impact = compareScheduleImpact(comparisonInput())

    expect(impact.baseline.totalProcessEnergyKwh).toBe(60)
    expect(impact.optimized.totalProcessEnergyKwh).toBe(60)
    expect(impact.baseline.modeledSolarAllocatedKwh).toBe(20)
    expect(impact.optimized.modeledSolarAllocatedKwh).toBe(50)
    expect(impact.baseline.modeledGridImportKwh).toBe(40)
    expect(impact.optimized.modeledGridImportKwh).toBe(10)
    expect(impact.baseline.modeledTouEnergyCost).toBe(10)
    expect(impact.optimized.modeledTouEnergyCost).toBe(3)
    expect(impact.modeledGridImportReductionKwh).toBe(30)
    expect(impact.modeledTouCostReduction).toBe(7)
    expect(impact.modeledTouCostReductionPercent).toBe(70)
    expect(impact.baseline.modeledPeakScheduledLoadKw).toBe(120)
    expect(impact.optimized.modeledPeakScheduledLoadKw).toBe(60)
    expect(impact.completionTimeChangeHours).toBeCloseTo(1)
    expect(impact.processStartShifts).toEqual([{
      processId: 'process-b',
      processName: 'Process B',
      baselineStartsAt: horizonStart,
      optimizedStartsAt: '2026-10-04T01:00:00.000Z',
      shiftMinutes: 60,
    }])
    expect(impact.processMoveComparisons).toEqual([{
      processId: 'process-b',
      processName: 'Process B',
      baselineStartsAt: horizonStart,
      optimizedStartsAt: '2026-10-04T01:00:00.000Z',
      shiftMinutes: 60,
      baselineSolarKwh: 10,
      optimizedSolarKwh: 25,
      solarDeltaKwh: 15,
      baselineTouCost: 5,
      optimizedTouCost: 1,
      touCostDelta: -4,
    }])
    expect(impact.processMoveComparisons[0]).not.toHaveProperty('modeledReason')
  })

  it('accepts complete 168-hour quarter-hour solar coverage and ignores the exclusive end boundary', () => {
    const start = '2026-10-04T00:00:00.000Z'
    const end = '2026-10-11T00:00:00.000Z'
    const readings = solarReadings(start, 168, 11116 / 672)
    readings.push({
      recordedAt: end,
      intervalMinutes: 15,
      generationKwh: 1000,
      machineId: null,
    })

    const result = compareScheduleImpact({
      ...comparisonInput(),
      horizonStart: start,
      horizonEnd: end,
      solarReadings: readings,
    })
    expect(result.baseline.solarProfileAvailableKwh).toBeCloseTo(11116, 8)
  })

  it('rejects incomplete or duplicate solar coverage', () => {
    const input = comparisonInput()
    expect(() => compareScheduleImpact({
      ...input,
      solarReadings: input.solarReadings.slice(1),
    })).toThrow(/incomplete|missing/)

    expect(() => compareScheduleImpact({
      ...input,
      solarReadings: [...input.solarReadings, input.solarReadings[0]!],
    })).toThrow(/duplicate/)
  })

  it('rejects a non-site or non-quarter-hour solar interval', () => {
    const input = comparisonInput()
    const readings = input.solarReadings.map((reading, index) => index === 0
      ? { ...reading, machineId: 'machine-a' }
      : reading)
    expect(() => compareScheduleImpact({ ...input, solarReadings: readings }))
      .toThrow(/site-level 15-minute/)
  })

  it('rejects duration rounding, changed machine assignment, and missing per-entry TOU cost', () => {
    const input = comparisonInput()
    const rounded = input.optimizedEntries.map((row, index) => index === 0
      ? { ...row, endsAt: new Date(Date.parse(row.endsAt) - 5 * 60_000).toISOString() }
      : row)
    expect(() => compareScheduleImpact({ ...input, optimizedEntries: rounded }))
      .toThrow(/exact-duration/)

    const reassigned = input.optimizedEntries.map((row, index) => index === 0
      ? { ...row, machineId: 'other-machine' }
      : row)
    expect(() => compareScheduleImpact({ ...input, optimizedEntries: reassigned }))
      .toThrow(/unknown, duplicate, or misassigned/)

    const missingCost = input.optimizedEntries.map((row, index) => index === 0
      ? { ...row, touCost: Number.NaN }
      : row)
    expect(() => compareScheduleImpact({ ...input, optimizedEntries: missingCost }))
      .toThrow(/TOU cost/)
  })

  it('rejects solar allocation beyond the supplied profile', () => {
    const input = comparisonInput()
    expect(() => compareScheduleImpact({
      ...input,
      solarReadings: solarReadings(horizonStart, 2, 5),
    }))
      .toThrow(/exceeds the supplied solar profile/)
  })

  it('uses optimizer-provided per-entry TOU costs and does not mutate canonical inputs', () => {
    const input = comparisonInput()
    const before = structuredClone(input)
    const result = compareScheduleImpact(input)

    expect(result.baseline.modeledTouEnergyCost).toBe(10)
    expect(result.optimized.modeledTouEnergyCost).toBe(3)
    expect(input).toEqual(before)
  })

  it('requires optimizer tariff-weighted cost and hourly schedule times to match persisted entries', () => {
    const baselineEntries = comparisonInput().baselineEntries
    const optimizerRows = baselineEntries.map((row) => ({
      process_id: row.processId,
      machine_id: row.machineId,
      start_time: (Date.parse(row.startsAt) - Date.parse(horizonStart)) / 3_600_000,
      end_time: (Date.parse(row.endsAt) - Date.parse(horizonStart)) / 3_600_000,
      power_kw: row.powerKw,
      solar_kwh: row.solarKwh,
      grid_kwh: row.gridKwh,
      energy_cost: row.touCost,
    }))
    const persistedEntries = baselineEntries.map((row) => ({
      process_id: row.processId,
      machine_id: row.machineId,
      starts_at: row.startsAt,
      ends_at: row.endsAt,
      power_kw: row.powerKw,
      energy_kwh: row.energyKwh,
      cost: row.touCost,
      metadata: { solar_kwh: row.solarKwh, grid_kwh: row.gridKwh },
    }))

    expect(projectPersistedImpactEntries(persistedEntries, optimizerRows, horizonStart)
      .map((row) => row.touCost)).toEqual([5, 5])
    expect(() => projectPersistedImpactEntries(
      [{ ...persistedEntries[0]!, cost: 7 }, persistedEntries[1]!],
      optimizerRows,
      horizonStart,
    )).toThrow(/TOU cost, timestamps, or IDs/)
  })
})
