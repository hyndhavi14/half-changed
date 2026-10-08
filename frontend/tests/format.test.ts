import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatCurrency,
  formatDateTime,
  formatDuration,
  formatKwh,
  formatKw,
  formatPercent,
  formatRange,
  formatSignedDuration,
  formatSignedNumber,
  formatSignedPercent,
  formatTime,
} from '../src/data/format.ts'

test('formats INR using magnitude-sensitive decimal precision', () => {
  assert.equal(formatCurrency(65200, 'INR'), '₹65,200')
  assert.equal(formatCurrency(65.2, 'INR'), '₹65.20')
  assert.equal(formatCurrency(null, 'INR'), 'Not available')
})

test('formats energy, power, percent, signed values, and durations', () => {
  assert.equal(formatKwh(1240), '1,240 kWh')
  assert.equal(formatKwh(9.5), '9.50 kWh')
  assert.equal(formatKw(12.34), '12.3 kW')
  assert.equal(formatPercent(12.5, 1), '12.5%')
  assert.equal(formatSignedPercent(-22), '−22%')
  assert.equal(formatSignedNumber(16, 'pts'), '+16 pts')
  assert.equal(formatDuration(45), '45 min')
  assert.equal(formatDuration(180), '3 h')
  assert.equal(formatDuration(195), '3 h 15 m')
  assert.equal(formatSignedDuration(-150), '2 h 30 m earlier')
  assert.equal(formatSignedDuration(60), '1 h later')
  assert.equal(formatSignedDuration(0), 'No change')
})

test('returns the unavailable label for non-finite values, invalid currencies, and dates', () => {
  assert.equal(formatKwh(Number.NaN), 'Not available')
  assert.equal(formatKw(Number.POSITIVE_INFINITY), 'Not available')
  assert.equal(formatPercent(Number.NaN), 'Not available')
  assert.equal(formatCurrency(1, 'not-a-currency'), 'Not available')
  assert.equal(formatDuration(Number.NaN), 'Not available')
  assert.equal(formatSignedPercent(null), 'Not available')
  assert.equal(formatTime('invalid', 'UTC'), 'Not available')
  assert.equal(formatDateTime('2026-10-08T03:00:00Z', 'Invalid/Zone'), 'Not available')
  assert.equal(formatRange('invalid', 'also-invalid', 'UTC'), 'Not available')
})

test('formats date and time in the supplied timezone with a 24-hour clock', () => {
  const timestamp = '2026-10-08T03:00:00Z'
  assert.equal(formatTime(timestamp, 'Asia/Kolkata'), '08:30')
  assert.equal(formatDateTime(timestamp, 'Asia/Kolkata'), '8 Oct 2026, 08:30')
  assert.equal(
    formatRange('2026-10-08T03:00:00Z', '2026-10-08T06:30:00Z', 'Asia/Kolkata'),
    '8 Oct, 08:30–12:00',
  )
  assert.equal(
    formatRange('2026-10-08T23:30:00Z', '2026-10-09T01:00:00Z', 'UTC'),
    '8 Oct 2026, 23:30–9 Oct 2026, 01:00',
  )
})
