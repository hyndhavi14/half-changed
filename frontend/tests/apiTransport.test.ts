import assert from 'node:assert/strict'
import test from 'node:test'
import { ApiTransportError, requestApiJson, resolveApiUrl } from '../src/data/apiTransport.ts'

test('resolves relative and absolute API bases to the versioned API', () => {
  assert.equal(resolveApiUrl('', 'factories'), '/api/v1/factories')
  assert.equal(resolveApiUrl('http://localhost:3000/', '/factories'), 'http://localhost:3000/api/v1/factories')
  assert.equal(resolveApiUrl('https://api.example.test/api/v1', 'factories'), 'https://api.example.test/api/v1/factories')
})

test('sends the Supabase bearer token and decodes Backend JSON', async () => {
  let requestUrl = ''
  let requestHeaders: Headers | null = null
  const response = await requestApiJson(
    '',
    'factories',
    'access-token',
    {},
    async (input, init) => {
      requestUrl = String(input)
      requestHeaders = new Headers(init?.headers)
      return Response.json({ data: [{ id: 'factory-id' }], meta: { total: 1 } })
    },
  )

  assert.equal(requestUrl, '/api/v1/factories')
  assert.equal(requestHeaders?.get('Authorization'), 'Bearer access-token')
  assert.deepEqual(response, { data: [{ id: 'factory-id' }], meta: { total: 1 } })
})

test('does not send protected requests without a session token', async () => {
  await assert.rejects(
    requestApiJson('', 'factories', null, {}, async () => {
      throw new Error('fetch must not be called')
    }),
    (error: unknown) => error instanceof ApiTransportError && /Authentication required/.test(error.message),
  )
})

test('surfaces unauthorized Backend errors without fallback data', async () => {
  await assert.rejects(
    requestApiJson('', 'factories', 'expired-token', {}, async () =>
      Response.json({ error: { code: 'unauthorized', message: 'Authentication required' } }, { status: 401 }),
    ),
    (error: unknown) =>
      error instanceof ApiTransportError &&
      error.status === 401 &&
      error.code === 'unauthorized' &&
      error.message.includes('Authentication required'),
  )
})

test('reports proxy HTML with its HTTP status and content type instead of hiding it as invalid JSON', async () => {
  await assert.rejects(
    requestApiJson('', 'factories', 'access-token', {}, async () =>
      new Response('<!doctype html><title>Proxy error</title>', {
        status: 502,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      }),
    ),
    (error: unknown) =>
      error instanceof ApiTransportError &&
      error.status === 502 &&
      error.contentType === 'text/html; charset=utf-8' &&
      error.message.includes('HTTP 502') &&
      error.message.includes('text/html'),
  )
})
