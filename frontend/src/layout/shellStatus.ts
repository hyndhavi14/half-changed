import { formatDateTime } from '../data/format.ts'
import type { LatestOptimization } from '../data/optimizationView.ts'

export function isAuthRequiredError(message: string | null | undefined): boolean {
  if (!message) return false
  return message.includes('Authentication required') || /\bHTTP 401\b/.test(message)
}

export interface OptimizerCardText {
  title: string
  detail: string
}

export function optimizerCardText(input: {
  latest: LatestOptimization | null
  timeZone: string | null
  optimizing: boolean
  hasData: boolean
  /** The run started in this session for the selected factory failed. */
  sessionFailed?: boolean
}): OptimizerCardText {
  if (input.optimizing) {
    return { title: 'Optimization running', detail: 'Waiting for the optimizer result' }
  }
  if (input.sessionFailed) {
    return { title: 'Optimization failed', detail: 'The last run did not return a new schedule' }
  }
  if (!input.hasData) {
    return { title: 'Optimizer', detail: 'Status not available' }
  }
  if (input.latest === null) {
    return { title: 'Optimizer', detail: 'No optimization runs yet' }
  }

  const statusLabels: Record<string, string> = {
    succeeded: 'Succeeded',
    failed: 'Failed',
    cancelled: 'Cancelled',
    pending: 'In progress',
    queued: 'In progress',
    running: 'In progress',
    not_configured: 'Optimizer not configured',
  }
  const statusLabel = statusLabels[input.latest.status] ??
    `${input.latest.status.charAt(0).toUpperCase()}${input.latest.status.slice(1)}`
  return {
    title: 'Last optimization',
    detail: `${statusLabel} · ${formatDateTime(input.latest.createdAt, input.timeZone ?? 'UTC')}`,
  }
}
