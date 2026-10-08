const NOT_AVAILABLE = 'Not available'

function finite(value: number | null): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function numberFormatter(minimumFractionDigits: number, maximumFractionDigits: number): Intl.NumberFormat {
  return new Intl.NumberFormat('en-IN', { minimumFractionDigits, maximumFractionDigits })
}

function dateParts(iso: string, timeZone: string): Record<string, string> | null {
  const timestamp = Date.parse(iso)
  if (!Number.isFinite(timestamp)) return null
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(timestamp)
    return Object.fromEntries(parts.map((part) => [part.type, part.value]))
  } catch {
    return null
  }
}

function dateLabel(parts: Record<string, string>, includeYear: boolean): string {
  const date = `${parts.day} ${parts.month}${includeYear ? ` ${parts.year}` : ''}`
  return date
}

function timeLabel(parts: Record<string, string>): string {
  return `${parts.hour}:${parts.minute}`
}

export function formatCurrency(value: number | null, currency: string): string {
  if (!finite(value) || typeof currency !== 'string' || currency.length !== 3) return NOT_AVAILABLE
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      minimumFractionDigits: Math.abs(value) >= 100 ? 0 : 2,
      maximumFractionDigits: Math.abs(value) >= 100 ? 0 : 2,
    }).format(value)
  } catch {
    return NOT_AVAILABLE
  }
}

export function formatKwh(value: number | null): string {
  if (!finite(value)) return NOT_AVAILABLE
  const magnitude = Math.abs(value)
  const decimals = magnitude < 10 ? 2 : magnitude < 100 ? 1 : 0
  return `${numberFormatter(decimals, decimals).format(value)} kWh`
}

export function formatKw(value: number | null): string {
  if (!finite(value)) return NOT_AVAILABLE
  const magnitude = Math.abs(value)
  const decimals = magnitude < 10 ? 2 : magnitude < 100 ? 1 : 0
  return `${numberFormatter(decimals, decimals).format(value)} kW`
}

export function formatPercent(value: number | null, decimals = 0): string {
  if (!finite(value) || !Number.isInteger(decimals) || decimals < 0 || decimals > 20) return NOT_AVAILABLE
  try {
    return `${numberFormatter(decimals, decimals).format(value)}%`
  } catch {
    return NOT_AVAILABLE
  }
}

export function formatSignedPercent(value: number | null): string {
  if (!finite(value)) return NOT_AVAILABLE
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${numberFormatter(0, 0).format(Math.abs(value))}%`
}

export function formatSignedNumber(value: number | null, unit: string): string {
  if (!finite(value) || typeof unit !== 'string') return NOT_AVAILABLE
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${numberFormatter(0, 0).format(Math.abs(value))}${unit ? ` ${unit}` : ''}`
}

export function formatDuration(minutes: number | null): string {
  if (!finite(minutes) || minutes < 0) return NOT_AVAILABLE
  const wholeMinutes = Math.round(minutes)
  const hours = Math.floor(wholeMinutes / 60)
  const remainder = wholeMinutes % 60
  if (hours === 0) return `${remainder} min`
  return remainder === 0 ? `${hours} h` : `${hours} h ${remainder} m`
}

export function formatSignedDuration(minutes: number | null): string {
  if (!finite(minutes)) return NOT_AVAILABLE
  if (minutes === 0) return 'No change'
  const duration = formatDuration(Math.abs(minutes))
  return duration === NOT_AVAILABLE ? NOT_AVAILABLE : `${duration} ${minutes < 0 ? 'earlier' : 'later'}`
}

export function formatTime(iso: string, timeZone: string): string {
  const parts = dateParts(iso, timeZone)
  return parts ? timeLabel(parts) : NOT_AVAILABLE
}

export function formatDateTime(iso: string, timeZone: string): string {
  const parts = dateParts(iso, timeZone)
  return parts ? `${dateLabel(parts, true)}, ${timeLabel(parts)}` : NOT_AVAILABLE
}

export function formatRange(startIso: string, endIso: string, timeZone: string): string {
  const start = dateParts(startIso, timeZone)
  const end = dateParts(endIso, timeZone)
  if (!start || !end) return NOT_AVAILABLE
  if (start.year === end.year && start.month === end.month && start.day === end.day) {
    return `${dateLabel(start, false)}, ${timeLabel(start)}–${timeLabel(end)}`
  }
  return `${dateLabel(start, true)}, ${timeLabel(start)}–${dateLabel(end, true)}, ${timeLabel(end)}`
}
