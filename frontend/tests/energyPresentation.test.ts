import assert from 'node:assert/strict'
import test from 'node:test'
import { aggregateMeasuredEnergy } from '../src/pages/energyChartData.ts'

test('aggregates only persisted generation and consumption by factory-local hour', () => {
  const result = aggregateMeasuredEnergy([
    {
      recorded_at: '2026-10-07T10:15:00Z',
      generation_kwh: '1.5',
      consumption_kwh: 3,
    },
    {
      recorded_at: '2026-10-07T10:45:00Z',
      generation_kwh: 0.5,
      consumption_kwh: '2',
    },
    {
      recorded_at: 'invalid',
      generation_kwh: 9,
      consumption_kwh: 9,
    },
    {
      recorded_at: '2026-10-07T11:00:00Z',
      generation_kwh: null,
      consumption_kwh: 1,
    },
  ], 'UTC')

  assert.deepEqual(result, [
    { hour: 10, generationKwh: 2, consumptionKwh: 5 },
  ])
})
