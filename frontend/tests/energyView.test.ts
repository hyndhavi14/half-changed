import assert from 'node:assert/strict'
import test from 'node:test'
import { availableDays, averageDayHourly, dayHourly, dayTotals } from '../src/data/energyView.ts'

test('buckets reading dates and totals in the factory timezone', () => {
  const rows = [
    { recorded_at: '2026-10-07T19:00:00Z', generation_kwh: 1, consumption_kwh: 3, source: 'measured' },
    { recorded_at: '2026-10-08T00:30:00Z', generation_kwh: 2, consumption_kwh: 4, source: 'measured' },
  ]
  assert.deepEqual(availableDays(rows, 'Asia/Kolkata'), ['2026-10-08'])
  assert.deepEqual(dayTotals(rows, 'Asia/Kolkata', '2026-10-08'), {
    consumptionKwh: 7,
    generationKwh: 3,
    readingCount: 2,
    provenance: 'measured',
  })
})

test('leaves empty hours null rather than converting them to zero', () => {
  const rows = [
    { recorded_at: '2026-10-08T04:15:00Z', generation_kwh: 1, consumption_kwh: 2, source: 'measured' },
  ]
  const points = dayHourly(rows, 'UTC', '2026-10-08')
  assert.equal(points.length, 24)
  assert.deepEqual(points[0], { hour: 0, generationKwh: null, consumptionKwh: null })
  assert.deepEqual(points[4], { hour: 4, generationKwh: 1, consumptionKwh: 2 })
})

test('handles both occurrences of the repeated London DST hour on the last Sunday of October', () => {
  const rows = [
    { recorded_at: '2026-10-25T00:30:00Z', generation_kwh: 1, consumption_kwh: 2, source: 'measured' },
    { recorded_at: '2026-10-25T01:30:00Z', generation_kwh: 3, consumption_kwh: 4, source: 'measured' },
  ]
  assert.deepEqual(availableDays(rows, 'Europe/London'), ['2026-10-25'])
  assert.deepEqual(dayHourly(rows, 'Europe/London', '2026-10-25')[1], {
    hour: 1,
    generationKwh: 4,
    consumptionKwh: 6,
  })
})

test('averages hourly values across available days and marks mixed sources unclassified', () => {
  const rows = [
    { recorded_at: '2026-10-08T04:00:00Z', generation_kwh: 2, consumption_kwh: 4, source: 'measured' },
    { recorded_at: '2026-10-09T04:00:00Z', generation_kwh: 4, consumption_kwh: 8, source: 'simulated' },
  ]
  const average = averageDayHourly(rows, 'UTC')
  assert.equal(average.dayCount, 2)
  assert.deepEqual(average.points[4], { hour: 4, generationKwh: 3, consumptionKwh: 6 })
  assert.equal(dayTotals(rows, 'UTC', '2026-10-08').provenance, 'measured')
})
