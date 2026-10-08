export interface LatestOptimization {
  status: string
  createdAt: string
  errorMessage: string | null
}

export function latestOptimization(
  requests: readonly Record<string, unknown>[],
): LatestOptimization | null {
  const valid = requests.flatMap((request) => {
    const createdAt = request.created_at
    const timestamp = typeof createdAt === 'string' ? Date.parse(createdAt) : Number.NaN
    if (!Number.isFinite(timestamp) || typeof request.status !== 'string') return []
    return [{ request, createdAt, timestamp }]
  })
  valid.sort((left, right) => right.timestamp - left.timestamp)
  const latest = valid[0]
  if (!latest || typeof latest.createdAt !== 'string') return null
  return {
    status: latest.request.status as string,
    createdAt: latest.createdAt,
    errorMessage: typeof latest.request.error_message === 'string'
      ? latest.request.error_message
      : null,
  }
}
