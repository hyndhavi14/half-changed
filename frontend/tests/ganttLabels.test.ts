import assert from 'node:assert/strict'
import test from 'node:test'
import { placeLabel } from '../src/components/ScheduleGantt/ganttLabels.ts'

const HOUR = 3_600_000
const pxPerMs = 40 / HOUR // 40 px per hour

test('a long block keeps its name inside', () => {
  assert.equal(placeLabel({ start: 0, end: 6 * HOUR, label: 'Roast' }, [], pxPerMs), 'inside')
})

test('a short block puts its name in the free gap to the right, else the left', () => {
  assert.equal(placeLabel({ start: 0, end: HOUR, label: 'Roast Bean Blend' }, [], pxPerMs), 'right')
  assert.equal(placeLabel({ start: 10 * HOUR, end: 11 * HOUR, label: 'Roast Bean Blend' }, [{ start: 11 * HOUR, end: 12 * HOUR }], pxPerMs), 'left')
})

test('with no room either side the name stays inside (truncated, full name in the tooltip)', () => {
  const neighbours = [{ start: 0, end: 10 * HOUR }, { start: 11 * HOUR, end: 20 * HOUR }]
  assert.equal(placeLabel({ start: 10 * HOUR, end: 11 * HOUR, label: 'Roast Bean Blend' }, neighbours, pxPerMs), 'inside')
  assert.equal(placeLabel({ start: 0, end: HOUR, label: 'X' }, [], 0), 'inside')
})
