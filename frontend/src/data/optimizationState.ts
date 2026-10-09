// Optimization state for the selected factory. Pure (node:test safe).
// Separates the run started in this session from results already stored in the database,
// so a failed run is never presented as a success and older results are always labelled.

export type OptimizationKind = 'not_run' | 'running' | 'success' | 'failed' | 'last_success'

export interface SessionRun {
  status: 'running' | 'succeeded' | 'failed'
  message: string | null
  finishedAt: string | null
}

export interface OptimizationState {
  kind: OptimizationKind
  /** Short status title, e.g. "Optimization failed". */
  title: string
  detail: string
  /** True when stored baseline/optimized results can be shown below the status. */
  showResults: boolean
  /** Label for the results shown, e.g. "Last successful optimization · 8 Oct 2026, 11:00". */
  resultLabel: string | null
  /** Plain-English next step for a known failure cause, or null. */
  hint: string | null
}

/** Maps well-known failure messages to the setting or action that fixes them. */
export function failureHint(message: string | null | undefined): string | null {
  if (!message) return null
  if (/optimizer is not configured/i.test(message)) {
    return 'The optimizer is switched off on the backend. Add BYTEME_OPTIMIZER_ENABLED=true and BYTEME_OPTIMIZER_TRANSPORT=python-subprocess to backend/.env.local, then restart the backend.'
  }
  if (/timed? ?out|timeout|deadline/i.test(message)) {
    return 'The optimizer ran out of time. Set BYTEME_OPTIMIZER_TIMEOUT_MS=300000 in backend/.env.local and restart the backend.'
  }
  if (/Application Control|4551/i.test(message)) {
    return 'Windows security (Application Control) is blocking OR-Tools on this computer. Do not bypass it: run the backend on a computer or environment where OR-Tools is allowed, or ask the administrator. npm run optimizer:check in the backend folder confirms the cause.'
  }
  if (/python|executable|ENOENT|or-?tools|optimizer package/i.test(message)) {
    return 'The backend’s Python setup has a problem. In the backend folder run: npm run optimizer:check — it lists exactly what to fix (Python path, OR-Tools, working directory). Then restart the backend.'
  }
  if (/\b50[24]\b|Bad Gateway|non-JSON|Failed to fetch|NetworkError|ECONNREFUSED/i.test(message)) {
    return 'The backend is not reachable. Start it with npm run dev in the backend folder and check http://localhost:3000/api/v1/health.'
  }
  return null
}

interface RequestRow {
  status: string
  createdAt: string
  errorMessage: string | null
}

function requests(rows: readonly Record<string, unknown>[]): RequestRow[] {
  return rows.flatMap((row) => {
    const createdAt = typeof row.created_at === 'string' && Number.isFinite(Date.parse(row.created_at)) ? row.created_at : null
    if (!createdAt || typeof row.status !== 'string') return []
    return [{ status: row.status, createdAt, errorMessage: typeof row.error_message === 'string' ? row.error_message : null }]
  }).sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
}

export function optimizationState(input: {
  run: SessionRun | null
  hasResults: boolean
  optimizationRequests: readonly Record<string, unknown>[]
  formatTime: (iso: string) => string
  factoryName: string
}): OptimizationState {
  const history = requests(input.optimizationRequests)
  const lastSuccess = history.find((row) => row.status === 'succeeded') ?? null
  const latest = history[0] ?? null
  const generated = lastSuccess ? ` · generated ${input.formatTime(lastSuccess.createdAt)}` : ''
  const lastLabel = input.hasResults ? `Last successful optimization${generated}` : null

  if (input.run?.status === 'running') {
    return {
      kind: 'running',
      title: 'Optimization in progress…',
      detail: `The optimizer is building a new baseline and optimized schedule for ${input.factoryName}.`,
      showResults: input.hasResults,
      resultLabel: lastLabel,
      hint: null,
    }
  }
  if (input.run?.status === 'failed') {
    return {
      kind: 'failed',
      title: 'Optimization failed',
      detail: `The optimizer did not return a new schedule.${input.run.message ? ` ${input.run.message}` : ''}`,
      showResults: input.hasResults,
      resultLabel: lastLabel,
      hint: failureHint(input.run.message),
    }
  }
  if (input.run?.status === 'succeeded' && input.hasResults) {
    return {
      kind: 'success',
      title: 'Optimization successful',
      detail: 'The schedules and metrics below come from this run.',
      showResults: true,
      resultLabel: `This run${generated}`,
      hint: null,
    }
  }
  if (!input.hasResults) {
    const failedBefore = latest && latest.status === 'failed'
    return {
      kind: failedBefore ? 'failed' : 'not_run',
      title: failedBefore ? 'Latest optimization failed' : 'No optimization yet',
      detail: failedBefore
        ? `The run on ${input.formatTime(latest.createdAt)} did not return a schedule.${latest.errorMessage ? ` ${latest.errorMessage}` : ''}`
        : `Run the optimizer to create a baseline and an energy-aware schedule for ${input.factoryName}.`,
      showResults: false,
      resultLabel: null,
      hint: failedBefore ? failureHint(latest.errorMessage) : null,
    }
  }
  if (latest && latest.status === 'failed' && lastSuccess && Date.parse(latest.createdAt) > Date.parse(lastSuccess.createdAt)) {
    return {
      kind: 'failed',
      title: 'Latest optimization failed',
      detail: `The run on ${input.formatTime(latest.createdAt)} did not return a new schedule. The results below are from the last successful run.`,
      showResults: true,
      resultLabel: lastLabel,
      hint: failureHint(latest.errorMessage),
    }
  }
  return {
    kind: 'last_success',
    title: 'Last successful optimization',
    detail: lastSuccess ? `Generated ${input.formatTime(lastSuccess.createdAt)}.` : 'Stored baseline and optimized schedules.',
    showResults: true,
    resultLabel: lastLabel,
    hint: null,
  }
}
