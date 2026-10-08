import assert from 'node:assert/strict'
import test from 'node:test'
import type { BackendFactoryData } from '../src/data/backendApi.ts'
import {
  horizonSegments,
  tariffWindows as normalizeTariffWindows,
} from '../src/pages/DashboardPage/dashboardView.ts'
import type { StoredSchedule } from '../src/pages/DashboardPage/dashboardView.ts'
import {
  allEntriesPlanned,
  entryDetail,
  generationHourKeys,
  generationSegments,
  machineRows,
  pairEntries,
  rulerLabels,
  runDetails,
  scheduleComparability,
  shiftRows,
  summaryTiles,
  tariffCurrencyNote,
  tariffSampleCount,
} from '../src/pages/SchedulePage/schedulePageView.ts'

type Entry = StoredSchedule['entries'][number]

const entry = (overrides: Record<string, unknown> = {}): Entry => ({
  id: 'entry-1',
  scheduleId: 'schedule-1',
  machineId: 'machine-1',
  processId: 'process-1',
  productionOrderId: null,
  startsAt: '2026-10-08T08:00:00Z',
  endsAt: '2026-10-08T10:00:00Z',
  powerKw: 4,
  energyKwh: 8,
  cost: 12,
  quantity: 5,
  sequence: 1,
  metadata: {},
  ...overrides,
} as unknown as Entry)

const schedule = (
  id: string,
  entries: Entry[],
  overrides: Record<string, unknown> = {},
): StoredSchedule => ({
  id,
  factoryId: 'factory-1',
  name: id,
  version: 1,
  status: 'draft',
  horizonStart: '2026-10-08T00:00:00Z',
  horizonEnd: '2026-10-09T00:00:00Z',
  optimizationRequestId: null,
  optimizationResultId: null,
  entries,
  metadata: {},
  totalEnergyCost: 100,
  totalEnergyKwh: 10,
  peakDemandKw: null,
  ...overrides,
} as unknown as StoredSchedule)

const factoryData = (overrides: Record<string, unknown> = {}): BackendFactoryData => ({
  factory: {
    id: 'factory-1',
    slug: 'factory',
    name: 'Factory',
    timezone: 'UTC',
    currency: 'EUR',
    description: null,
    config: {},
  },
  machines: [
    {
      id: 'machine-1',
      factoryId: 'factory-1',
      slug: 'machine',
      name: 'Machine One',
      type: 'line',
      ratedPowerKw: 12,
      isActive: true,
    },
  ],
  processes: [
    {
      id: 'process-1',
      factoryId: 'factory-1',
      slug: 'process',
      name: 'Process One',
      durationMinutes: 120,
      machineId: 'machine-1',
      powerRequirementKw: 4,
      quantity: 5,
      unit: 'kg',
      isActive: true,
    },
  ],
  dependencies: [],
  orders: [],
  energy: [],
  tariffs: [],
  schedules: [],
  optimizationRequests: [],
  optimizationResults: [],
  ...overrides,
} as unknown as BackendFactoryData)

const tariffWindows = [
  { start_time: '00:00', end_time: '18:00', energy_price_per_kwh: 5, priority: 20 },
  { start_time: '18:00', end_time: '22:00', energy_price_per_kwh: 9, priority: 10 },
  { start_time: '22:00', end_time: '23:59', energy_price_per_kwh: 5, priority: 20 },
]

test('pairs repeated process-machine entries by sequence occurrence and returns unmatched entries', () => {
  const baseline = schedule('base', [
    entry({ id: 'b-2', sequence: 2, startsAt: '2026-10-08T12:00:00Z' }),
    entry({ id: 'b-1', sequence: 1 }),
    entry({ id: 'b-only', processId: 'process-2', sequence: 3 }),
  ])
  const optimized = schedule('opt', [
    entry({ id: 'o-1', sequence: 1 }),
    entry({ id: 'o-2', sequence: 2, startsAt: '2026-10-08T12:00:00Z' }),
    entry({ id: 'o-only', machineId: 'machine-2', sequence: 3 }),
  ])
  const result = pairEntries(baseline, optimized)
  assert.deepEqual(result.pairs.map((pair) => [pair.key, pair.baseline.id, pair.optimized.id]), [
    ['process-1|machine-1|0', 'b-1', 'o-1'],
    ['process-1|machine-1|1', 'b-2', 'o-2'],
  ])
  assert.deepEqual(result.unmatchedBaseline.map((item) => item.id), ['b-only'])
  assert.deepEqual(result.unmatchedOptimized.map((item) => item.id), ['o-only'])
})

test('identical schedule inputs are comparable', () => {
  const base = schedule('base', [entry()])
  const result = scheduleComparability(base, schedule('opt', [entry()]))
  assert.equal(result.comparable, true)
  assert.deepEqual(result.reasons, [])
  assert.match(result.notChecked, /not stored per schedule/)
})

test('reports machine assignment differences as unmatched entries', () => {
  const result = scheduleComparability(
    schedule('base', [entry()]),
    schedule('opt', [entry({ machineId: 'machine-2' })]),
  )
  assert.equal(result.comparable, false)
  assert.ok(result.reasons.includes(
    'Process/machine assignments differ (1 baseline-only, 1 optimized-only entries)',
  ))
})

test('reports paired duration differences above one minute', () => {
  const result = scheduleComparability(
    schedule('base', [entry()]),
    schedule('opt', [entry({ endsAt: '2026-10-08T10:02:00Z' })]),
  )
  assert.ok(result.reasons.includes('Process durations differ for 1 entries'))
})

test('reports horizon length and factory differences', () => {
  const result = scheduleComparability(
    schedule('base', [entry()], { horizonEnd: '2026-10-09T00:00:00Z' }),
    schedule('opt', [entry()], {
      factoryId: 'factory-2',
      horizonEnd: '2026-10-10T00:00:00Z',
    }),
  )
  assert.ok(result.reasons.includes('Different factory'))
  assert.ok(result.reasons.includes('Planning horizon length differs'))
})

test('shift rows omit paired entries whose windows did not move', () => {
  const base = schedule('base', [entry()])
  assert.deepEqual(shiftRows(factoryData(), base, schedule('opt', [entry()])), [])
})

test('classifies a move out of peak price', () => {
  const base = schedule('base', [entry({ startsAt: '2026-10-08T18:00:00Z', endsAt: '2026-10-08T19:00:00Z' })])
  const opt = schedule('opt', [entry({ startsAt: '2026-10-08T10:00:00Z', endsAt: '2026-10-08T11:00:00Z' })])
  const rows = shiftRows(factoryData({ tariffs: tariffWindows }), base, opt)
  assert.equal(rows[0].change, 'Moved out of peak price')
  assert.equal(rows[0].was, '08 Oct 18:00–19:00')
  assert.equal(rows[0].now, '08 Oct 10:00–11:00')
})

test('classifies a move into peak price', () => {
  const base = schedule('base', [entry({ startsAt: '2026-10-08T10:00:00Z', endsAt: '2026-10-08T11:00:00Z' })])
  const opt = schedule('opt', [entry({ startsAt: '2026-10-08T18:00:00Z', endsAt: '2026-10-08T19:00:00Z' })])
  assert.equal(shiftRows(factoryData({ tariffs: tariffWindows }), base, opt)[0].change, 'Moved into peak price')
})

test('classifies movement into recorded generation hours and otherwise calls it retimed', () => {
  const energy = [{ recorded_at: '2026-10-08T10:15:00Z', generation_kwh: 2, source: 'measured' }]
  const data = factoryData({ energy })
  const base = schedule('base', [entry({ startsAt: '2026-10-08T08:00:00Z' })])
  const movedInto = schedule('into', [entry({ startsAt: '2026-10-08T10:00:00Z' })])
  const withinSameGenerationHour = schedule('retimed', [entry({ startsAt: '2026-10-08T10:30:00Z' })])
  assert.equal(shiftRows(data, base, movedInto)[0].change, 'Moved into generation hours')
  assert.equal(shiftRows(data, movedInto, withinSameGenerationHour)[0].change, 'Retimed')
})

test('cost change text covers lower, higher, zero, and unavailable values', () => {
  const data = factoryData()
  const baselineEntry = entry({ cost: 10 })
  const base = schedule('base', [baselineEntry])
  const lower = schedule('lower', [entry({ startsAt: '2026-10-08T09:00:00Z', cost: 8 })])
  const higher = schedule('higher', [entry({ startsAt: '2026-10-08T09:00:00Z', cost: 12 })])
  const same = schedule('same', [entry({ startsAt: '2026-10-08T09:00:00Z', cost: 10 })])
  const missing = schedule('missing', [entry({ startsAt: '2026-10-08T09:00:00Z', cost: null })])
  assert.equal(shiftRows(data, base, lower)[0].costText, 'EUR 2 lower')
  assert.equal(shiftRows(data, base, higher)[0].costText, 'EUR 2 higher')
  assert.equal(shiftRows(data, base, same)[0].costText, 'No change')
  assert.equal(shiftRows(data, base, missing)[0].costText, 'Not available')
})

test('summary tiles show missing values, baseline not-applicable, and optimized deltas', () => {
  const data = factoryData()
  const base = schedule('base', [
    entry({ id: 'base-entry', metadata: { solar_kwh: 2, grid_kwh: 8 } }),
  ], { totalEnergyCost: null, totalEnergyKwh: null })
  const optimized = schedule('optimized', [
    entry({ id: 'opt-entry', startsAt: '2026-10-08T09:00:00Z', metadata: { solar_kwh: 4, grid_kwh: 6 } }),
  ], { totalEnergyCost: 80, totalEnergyKwh: 9 })
  const baseTiles = summaryTiles(data, base, base, optimized)
  assert.equal(baseTiles[1].value, 'Not available')
  assert.equal(baseTiles[3].value, 'Not applicable')
  assert.equal(baseTiles[3].sub, 'Baseline is the reference')
  const optimizedTiles = summaryTiles(data, optimized, base, optimized)
  assert.equal(optimizedTiles.length, 4)
  assert.ok(optimizedTiles[0].sub)
  assert.ok(optimizedTiles[2].sub)
})

test('generation segmentation omits non-overlap and machine rows include empty and unknown machines', () => {
  const selected = schedule('selected', [
    entry({
      machineId: 'unmapped-machine',
      processId: 'unmapped-process',
      metadata: { solar_kwh: 2, grid_kwh: 6, planned: true },
    }),
  ])
  const generation = generationSegments(
    [{ recorded_at: '2026-10-10T00:00:00Z', generation_kwh: 3, source: 'measured' }],
    selected,
    'UTC',
  )
  assert.deepEqual(generation, { segments: [], source: 'Not available' })
  const rows = machineRows(factoryData(), selected, undefined)
  assert.equal(rows[0].name, 'Machine One')
  assert.equal(rows[0].sublabel, '12 kW rated')
  assert.deepEqual(rows[0].blocks, [])
  assert.equal(rows[1].name, 'Unknown machine (unmapped-machine)')
  assert.equal(rows[1].blocks.length, 1)
})

test('run details include linked optimizer metrics and deduplicate warnings', () => {
  const selected = schedule('selected', [entry()], { optimizationResultId: 'result-1' })
  const result = runDetails(factoryData({
    factory: { ...factoryData().factory, timezone: 'Asia/Kolkata' },
    optimizationResults: [{
      id: 'result-1',
      status: 'succeeded',
      created_at: '2026-10-08T03:30:00Z',
      objective_value: 123,
      metrics: {
        optimizer_status: 'succeeded',
        solve_time_seconds: 2.345,
        optimization_scope: 'factory',
        warnings: ['warning A', 'warning A'],
        integration_warnings: ['warning A', 'warning B'],
      },
    }],
  }), selected)
  assert.match(result.lines[3], /Optimizer succeeded/)
  assert.match(result.lines[3], /solved in 2\.35 s/)
  assert.match(result.lines[3], /scope factory/)
  assert.match(result.lines[3], /result recorded 8 Oct 2026, 09:00/)
  assert.deepEqual(result.warnings, ['warning A', 'warning B'])
  assert.equal(result.lines.join(' ').includes('123'), false)
})

test('run details describe an unlinked result without warnings', () => {
  const result = runDetails(factoryData(), schedule('selected', [entry()]))
  assert.ok(result.lines.includes('No optimization result is linked to this schedule'))
  assert.deepEqual(result.warnings, [])
})

test('run details prefer persisted peak, calculate a fallback, then report unavailable', () => {
  const data = factoryData()
  const selected = schedule('selected', [entry({ powerKw: 4 })])
  assert.match(runDetails(data, schedule('persisted', [entry()], { peakDemandKw: 7.5 })).lines[2], /Peak demand 7\.5 kW \(persisted\)/)
  assert.match(runDetails(data, selected).lines[2], /Peak planned load 4 kW \(calculated from entries\)/)
  assert.equal(runDetails(data, schedule('none', [entry({ powerKw: null })])).lines[2], 'Peak demand Not available')
})

test('entry details include every available value and return empty when none exist', () => {
  const full = entry({
    powerKw: 4,
    energyKwh: 12.5,
    cost: 3.456,
    quantity: 2,
    metadata: { solar_kwh: 5, grid_kwh: 7.5 },
  })
  assert.equal(
    entryDetail(full, 'EUR'),
    '4 kW · 12.5 kWh (solar 5 / grid 7.5) · EUR 3.46 · qty 2',
  )
  assert.equal(entryDetail(entry({ powerKw: null, energyKwh: null, cost: 3.456, quantity: null }), 'EUR'), 'EUR 3.46')
  assert.equal(entryDetail(entry({ powerKw: null, energyKwh: null, cost: null, quantity: null }), 'EUR'), '')
})

test('machine rows append inactive status and block detail, and tariff currency note is conditional', () => {
  const data = factoryData({
    machines: [{
      ...factoryData().machines[0],
      isActive: false,
    }],
    tariffs: [{ currency: 'USD' }, { currency: 'USD' }],
  })
  const rows = machineRows(data, schedule('selected', [entry()]), undefined)
  assert.equal(rows[0].sublabel, '12 kW rated · Inactive')
  assert.match(rows[0].blocks[0].tooltip, /4 kW/)
  assert.match(rows[0].blocks[0].tooltip, /8 kWh/)
  assert.match(rows[0].blocks[0].tooltip, /EUR 12\.00/)
  assert.equal(tariffCurrencyNote(factoryData({ tariffs: [{ currency: 'EUR' }] })), null)
  assert.equal(
    tariffCurrencyNote(data),
    'Tariff currency differs from factory currency (USD)',
  )
})

test('allEntriesPlanned reports complete, mixed, absent, and empty metadata clearly', () => {
  assert.equal(allEntriesPlanned(schedule('all-planned', [
    entry({ metadata: { planned: true } }),
    entry({ id: 'planned-2', metadata: { planned: true } }),
  ])), true)
  assert.equal(allEntriesPlanned(schedule('mixed-planned', [
    entry({ metadata: { planned: true } }),
    entry({ id: 'not-planned', metadata: { planned: false } }),
  ])), false)
  assert.equal(allEntriesPlanned(schedule('without-metadata', [
    entry({ metadata: undefined }),
  ])), null)
  assert.equal(allEntriesPlanned(schedule('empty', [])), null)
})

test('generation hour keys sum numeric values in factory-local hours', () => {
  const keys = generationHourKeys([
    { recorded_at: '2026-10-08T03:00:00Z', generation_kwh: 1 },
    { recorded_at: '2026-10-08T02:45:00Z', generation_kwh: 2 },
    { recorded_at: 'invalid', generation_kwh: 100 },
    { recorded_at: '2026-10-08T04:00:00Z', generation_kwh: '5' },
  ], 'Asia/Kolkata')
  assert.deepEqual([...keys], ['2026-10-08|8'])
})

test('generation segments merge adjacent positive slots and retain the recorded source', () => {
  const selected = schedule('selected', [], {
    horizonStart: '2026-10-08T00:00:00Z',
    horizonEnd: '2026-10-08T03:00:00Z',
  })
  const result = generationSegments([
    { recorded_at: '2026-10-08T00:30:00Z', generation_kwh: 1, source: 'measured' },
    { recorded_at: '2026-10-08T01:30:00Z', generation_kwh: 2, source: 'measured' },
  ], selected, 'UTC')
  assert.equal(result.source, 'Measured')
  assert.equal(result.segments.length, 1)
  assert.ok(Math.abs(result.segments[0].startFraction - 0) < 1e-9)
  assert.ok(Math.abs(result.segments[0].endFraction - 2 / 3) < 1e-9)
})

test('returned helper text contains no invented reason or invalid-value markers', () => {
  const data = factoryData()
  const base = schedule('base', [entry()])
  const optimized = schedule('optimized', [entry({ startsAt: '2026-10-08T09:00:00Z' })])
  const values: unknown[] = [
    pairEntries(base, optimized),
    scheduleComparability(base, optimized),
    [...generationHourKeys([], 'UTC')],
    shiftRows(data, base, optimized),
    summaryTiles(data, optimized, base, optimized),
    generationSegments([], optimized, 'UTC'),
    machineRows(data, optimized, base),
    runDetails(data, optimized),
    entryDetail(entry(), 'EUR'),
    tariffCurrencyNote(data),
  ]
  const collectStrings = (value: unknown): string[] => {
    if (typeof value === 'string') return [value]
    if (Array.isArray(value)) return value.flatMap(collectStrings)
    if (typeof value === 'object' && value !== null) {
      return Object.values(value).flatMap(collectStrings)
    }
    return []
  }
  for (const text of collectStrings(values)) {
    assert.doesNotMatch(text, /Use solar|Avoid peak|utilization|live|telemetry|objective|NaN|undefined|null/i)
  }
})

test('ruler labels retain the original clock-only format for a 24-hour horizon', () => {
  const selected = schedule('24-hour', [], {
    horizonStart: '2026-01-05T00:00:00Z',
    horizonEnd: '2026-01-06T00:00:00Z',
  })
  assert.deepEqual(rulerLabels(selected, 'UTC'), [
    '00:00', '04:00', '08:00', '12:00', '16:00', '20:00', '00:00',
  ])
})

test('ruler labels include weekday and date for a multi-day horizon', () => {
  const selected = schedule('seven-day', [], {
    horizonStart: '2026-10-04T00:00:00Z',
    horizonEnd: '2026-10-11T00:00:00Z',
  })
  const labels = rulerLabels(selected, 'UTC')
  assert.equal(labels.length, 7)
  assert.equal(labels[0], 'Sun 04 00:00')
  assert.equal(labels[6], 'Sun 11 00:00')
  assert.ok(labels.every((label) => !label.includes(',')))
})

test('ruler labels omit ticks for an invalid horizon', () => {
  const selected = schedule('invalid', [], {
    horizonStart: 'invalid',
    horizonEnd: '2026-10-11T00:00:00Z',
  })
  assert.deepEqual(rulerLabels(selected, 'UTC'), [])
})

test('tariff sample count tracks quarter-hour resolution and clamps invalid or long horizons', () => {
  const day = schedule('24-hour', [], {
    horizonStart: '2026-01-05T00:00:00Z',
    horizonEnd: '2026-01-06T00:00:00Z',
  })
  const week = schedule('seven-day', [], {
    horizonStart: '2026-10-04T00:00:00Z',
    horizonEnd: '2026-10-11T00:00:00Z',
  })
  const sixtyDays = schedule('sixty-day', [], {
    horizonStart: '2026-01-01T00:00:00Z',
    horizonEnd: '2026-03-02T00:00:00Z',
  })
  const invalid = schedule('invalid', [], {
    horizonStart: 'invalid',
    horizonEnd: '2026-10-11T00:00:00Z',
  })
  assert.equal(tariffSampleCount(day), 96)
  assert.equal(tariffSampleCount(week), 672)
  assert.equal(tariffSampleCount(sixtyDays), 2016)
  assert.equal(tariffSampleCount(invalid), 96)
})

test('quarter-hour tariff samples locate the Monday 17:00 peak boundary', () => {
  const phaseFiveTariffs = [
    { start_time: '22:00:00', end_time: '07:00:00', days_of_week: null, energy_price_per_kwh: '0.0850', demand_charge_per_kw: '0', fixed_charge: '0', priority: 10, metadata: { band: 'off_peak' } },
    { start_time: '07:00:00', end_time: '22:00:00', days_of_week: null, energy_price_per_kwh: '0.1420', demand_charge_per_kw: '0', fixed_charge: '0', priority: 10, metadata: { band: 'shoulder' } },
    { start_time: '17:00:00', end_time: '22:00:00', days_of_week: [1, 2, 3, 4, 5], energy_price_per_kwh: '0.2180', demand_charge_per_kw: '0', fixed_charge: '0', priority: 20, metadata: { band: 'peak' } },
    { start_time: '08:00:00', end_time: '20:00:00', days_of_week: [6], energy_price_per_kwh: '0.1650', demand_charge_per_kw: '0', fixed_charge: '0', priority: 20, metadata: { band: 'peak' } },
    { start_time: '00:00:00', end_time: '23:59:00', days_of_week: null, energy_price_per_kwh: '0.0000', demand_charge_per_kw: '18.50', fixed_charge: '145.00', priority: 30, metadata: { band: 'demand' } },
  ]
  const selected = schedule('seven-day', [], {
    horizonStart: '2026-10-04T00:00:00Z',
    horizonEnd: '2026-10-11T00:00:00Z',
  })
  const segments = horizonSegments(
    normalizeTariffWindows(phaseFiveTariffs),
    Date.parse(selected.horizonStart),
    Date.parse(selected.horizonEnd),
    'Europe/Paris',
    tariffSampleCount(selected),
  )
  const mondayPeak = segments.find(
    (segment) => segment.band === 'peak' &&
      Math.abs(segment.startFraction * 168 - 39) <= 0.25,
  )
  assert.ok(mondayPeak)
  assert.ok(Math.abs(mondayPeak.startFraction * 168 - 39) <= 0.25)
})
