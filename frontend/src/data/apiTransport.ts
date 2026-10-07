export class ApiTransportError extends Error {
  constructor(
    message: string,
    options?: ErrorOptions & {
      status?: number
      code?: string
      contentType?: string
    },
  ) {
    super(message, options)
    this.name = 'ApiTransportError'
    this.status = options?.status
    this.code = options?.code
    this.contentType = options?.contentType
  }

  status?: number
  code?: string
  contentType?: string
}

export function resolveApiUrl(configuredBase: string, path: string): string {
  const base = configuredBase.replace(/\/+$/, '')
  const versionedBase = base.endsWith('/api/v1') ? base : `${base}/api/v1`
  const relativePath = path.replace(/^\/+/, '')
  return `${versionedBase}/${relativePath}`
}

export async function requestApiJson(
  configuredBase: string,
  path: string,
  token: string | null,
  init: RequestInit = {},
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  if (!token) throw new ApiTransportError('Authentication required. Sign in to access factory data.')

  let response: Response
  try {
    response = await fetchImpl(resolveApiUrl(configuredBase, path), {
      ...init,
      headers: {
        Accept: 'application/json',
        ...init.headers,
        Authorization: `Bearer ${token}`,
      },
    })
  } catch (error) {
    throw new ApiTransportError(
      error instanceof Error
        ? `Could not connect to the ByteMe API: ${error.message}`
        : 'Could not connect to the ByteMe API.',
      { cause: error },
    )
  }

  let responseText: string
  try {
    responseText = await response.text()
  } catch (error) {
    throw new ApiTransportError(
      `Could not read the ByteMe API response (HTTP ${response.status}).`,
      { cause: error, status: response.status },
    )
  }

  let payload: unknown
  try {
    payload = JSON.parse(responseText) as unknown
  } catch (error) {
    const contentType = response.headers.get('content-type') ?? 'missing'
    throw new ApiTransportError(
      `The ByteMe API returned a non-JSON response (HTTP ${response.status}; Content-Type ${contentType}).`,
      { cause: error, status: response.status, contentType },
    )
  }

  if (!response.ok) {
    const apiError = isRecord(payload) && isRecord(payload.error) ? payload.error : null
    const code = apiError && typeof apiError.code === 'string' ? apiError.code : undefined
    const message = apiError && typeof apiError.message === 'string'
      ? apiError.message
      : response.statusText
    throw new ApiTransportError(
      `The ByteMe API returned HTTP ${response.status}${code ? ` (${code})` : ''}: ${message}`,
      { status: response.status, code, contentType: response.headers.get('content-type') ?? undefined },
    )
  }

  return payload
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
