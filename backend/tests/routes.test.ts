/**
 * Phase 4 — exercise the actual Next.js API route handlers over HTTP objects.
 *
 * These tests import the production handlers and run them with real
 * NextRequest instances against the shared repository seam in offline SQLite.
 * Only the optimizer's documented unconfigured state is used; no route,
 * repository, or optimizer response is mocked.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SignJWT } from 'jose'
import { NextRequest } from 'next/server'

import { closeDb, getDb } from '@/lib/offline/db'
import { client } from '@/lib/repositories/base'
import { initOfflineSchema } from '@/lib/offline/init'
import { seedOfflineDatabase } from '@/lib/offline/seed'
import { resetEnvCache } from '@/lib/env'
import { MAX_JSON_BODY_BYTES } from '@/lib/http'

import { GET as factoriesGET, POST as factoriesPOST } from '@/app/api/v1/factories/route'
import { POST as factoryBuilderPOST } from '@/app/api/v1/factory-builder/route'
import { DELETE as factoryDELETE, GET as factoryGET, PATCH as factoryPATCH } from '@/app/api/v1/factories/[factoryId]/route'
import { GET as configGET, PATCH as configPATCH, PUT as configPUT } from '@/app/api/v1/factories/[factoryId]/config/route'
import { GET as factorySummaryGET } from '@/app/api/v1/factories/[factoryId]/summary/route'
import { GET as payloadGET } from '@/app/api/v1/factories/[factoryId]/payload/route'
import { GET as machinesGET, POST as machinesPOST } from '@/app/api/v1/factories/[factoryId]/machines/route'
import {
  DELETE as machineDELETE,
  GET as machineGET,
  PATCH as machinePATCH,
} from '@/app/api/v1/factories/[factoryId]/machines/[machineId]/route'
import { GET as processesGET, POST as processesPOST } from '@/app/api/v1/factories/[factoryId]/processes/route'
import {
  DELETE as processDELETE,
  GET as processGET,
  PATCH as processPATCH,
} from '@/app/api/v1/factories/[factoryId]/processes/[processId]/route'
import { GET as dependenciesGET, POST as dependenciesPOST } from '@/app/api/v1/factories/[factoryId]/process-dependencies/route'
import {
  DELETE as dependencyDELETE,
  GET as dependencyGET,
  PATCH as dependencyPATCH,
} from '@/app/api/v1/factories/[factoryId]/process-dependencies/[dependencyId]/route'
import { GET as ordersGET, POST as ordersPOST } from '@/app/api/v1/factories/[factoryId]/production-orders/route'
import {
  DELETE as orderDELETE,
  GET as orderGET,
  PATCH as orderPATCH,
} from '@/app/api/v1/factories/[factoryId]/production-orders/[orderId]/route'
import { GET as tariffsGET, POST as tariffsPOST } from '@/app/api/v1/factories/[factoryId]/tariffs/route'
import {
  DELETE as tariffDELETE,
  GET as tariffGET,
  PATCH as tariffPATCH,
} from '@/app/api/v1/factories/[factoryId]/tariffs/[tariffId]/route'
import { GET as energyGET, POST as energyPOST } from '@/app/api/v1/factories/[factoryId]/energy-data/route'
import {
  DELETE as energyDELETE,
  GET as energyGETById,
  PATCH as energyPATCH,
} from '@/app/api/v1/factories/[factoryId]/energy-data/[energyId]/route'
import { GET as energySummaryGET } from '@/app/api/v1/factories/[factoryId]/energy-data/summary/route'
import { GET as schedulesGET, POST as schedulesPOST } from '@/app/api/v1/factories/[factoryId]/schedules/route'
import {
  DELETE as scheduleDELETE,
  GET as scheduleGET,
  PATCH as schedulePATCH,
} from '@/app/api/v1/factories/[factoryId]/schedules/[scheduleId]/route'
import {
  GET as entriesGET,
  POST as entriesPOST,
  PUT as entriesPUT,
} from '@/app/api/v1/factories/[factoryId]/schedules/[scheduleId]/entries/route'
import {
  DELETE as entryDELETE,
  GET as entryGET,
  PATCH as entryPATCH,
} from '@/app/api/v1/factories/[factoryId]/schedules/[scheduleId]/entries/[entryId]/route'
import { GET as healthGET } from '@/app/api/v1/health/route'
import {
  GET as optimizationRequestsGET,
  POST as optimizationPOST,
} from '@/app/api/v1/factories/[factoryId]/optimization-requests/route'
import {
  DELETE as optimizationRequestDELETE,
  GET as optimizationRequestGET,
  PATCH as optimizationRequestPATCH,
} from '@/app/api/v1/factories/[factoryId]/optimization-requests/[requestId]/route'
import {
  GET as optimizationResultsGET,
  POST as optimizationResultsPOST,
} from '@/app/api/v1/factories/[factoryId]/optimization-results/route'
import {
  DELETE as optimizationResultDELETE,
  GET as optimizationResultGET,
  PATCH as optimizationResultPATCH,
} from '@/app/api/v1/factories/[factoryId]/optimization-results/[resultId]/route'

const BASE = 'http://localhost:3000'
const SECRET = 'phase-four-route-tests-signing-secret-0123456789'
const OTHER_FACTORY = '00000000-0000-4000-8000-0000000000ee'
const MISSING_ID = '00000000-0000-4000-8000-0000000000dd'
const START = '2042-08-01T08:00:00.000Z'
const MIDDLE = '2042-08-01T09:00:00.000Z'
const END = '2042-08-01T10:00:00.000Z'

const savedEnv = {
  mode: process.env.BYTEME_OFFLINE_MODE,
  path: process.env.BYTEME_OFFLINE_DB_PATH,
  secret: process.env.BYTEME_OFFLINE_JWT_SECRET,
  optimizer: process.env.BYTEME_OPTIMIZER_ENABLED,
}

let factoryId = ''
let machineId = ''
let secondMachineId = ''
let processId = ''
let secondProcessId = ''
let dependencyProcessId = ''
let dependencyId = ''
let energyId = ''
let scheduleId = ''
let orderId = ''
let tariffId = ''
let serial = 0

beforeAll(async () => {
  process.env.BYTEME_OFFLINE_MODE = 'true'
  process.env.BYTEME_OFFLINE_DB_PATH = ':memory:'
  process.env.BYTEME_OFFLINE_JWT_SECRET = SECRET
  process.env.BYTEME_OPTIMIZER_ENABLED = 'false'
  resetEnvCache()

  const db = getDb()
  initOfflineSchema(db)
  const seeded = await seedOfflineDatabase(db)
  factoryId = seeded.factoryId
  machineId = seeded.machineIds['press-line'] ?? ''
  secondMachineId = seeded.machineIds['cure-oven'] ?? ''
  processId = seeded.processIds['form-panel'] ?? ''
  secondProcessId = seeded.processIds['cure-cycle'] ?? ''
  dependencyProcessId = seeded.processIds['machine-feature'] ?? ''
})

afterAll(() => {
  closeDb()
  for (const [key, value] of [
    ['BYTEME_OFFLINE_MODE', savedEnv.mode],
    ['BYTEME_OFFLINE_DB_PATH', savedEnv.path],
    ['BYTEME_OFFLINE_JWT_SECRET', savedEnv.secret],
    ['BYTEME_OPTIMIZER_ENABLED', savedEnv.optimizer],
  ] as const) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  resetEnvCache()
})

async function token(appMetadata: Record<string, unknown>): Promise<string> {
  return new SignJWT({ app_metadata: appMetadata })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject('00000000-0000-4000-8000-000000000001')
    .setIssuedAt(Math.floor(Date.now() / 1000))
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(SECRET))
}

const ownerToken = () => token({ factory_ids: [factoryId] })
const adminToken = () => token({ byteme_admin: true })

function makeRequest(
  path: string,
  options: { token?: string; authorization?: string; method?: string; body?: unknown } = {},
): NextRequest {
  const headers = new Headers()
  if (options.token) headers.set('authorization', `Bearer ${options.token}`)
  if (options.authorization) headers.set('authorization', options.authorization)
  if (options.body !== undefined) headers.set('content-type', 'application/json')
  return new NextRequest(new URL(path, BASE), {
    method: options.method ?? 'GET',
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  })
}

type Route<P extends object> = (request: NextRequest, context: { params: P }) => Promise<Response>

function invoke<P extends object>(
  handler: Route<P>,
  path: string,
  params: P,
  options: { token?: string; method?: string; body?: unknown } = {},
): Promise<Response> {
  return handler(makeRequest(path, options), { params })
}

async function json(response: Response): Promise<Record<string, any>> {
  return (await response.clone().json()) as Record<string, any>
}

function factoryPath(suffix = ''): string {
  return `/api/v1/factories/${factoryId}${suffix}`
}

function unique(prefix: string): string {
  serial += 1
  return `${prefix}-${serial}`
}

function newScheduleBody(name = unique('route-schedule')) {
  return {
    name,
    version: 1,
    status: 'draft',
    horizon_start: START,
    horizon_end: END,
  }
}

function entryBody(overrides: Record<string, unknown> = {}) {
  return {
    machine_id: machineId,
    process_id: processId,
    starts_at: START,
    ends_at: MIDDLE,
    power_kw: 80,
    energy_kwh: 40,
    cost: 5,
    sequence: 1,
    ...overrides,
  }
}

describe('real route authentication and public health behavior', () => {
  it('returns 401 with the centralized envelope for a malformed Authorization header', async () => {
    const response = await factoryGET(
      makeRequest(factoryPath(), { authorization: 'Basic dXNlcjpwYXNz' }),
      { params: { factoryId } },
    )
    expect(response.status).toBe(401)
    expect((await json(response)).error).toMatchObject({
      code: 'unauthorized',
      message: 'Authentication required',
    })
  })

  it('keeps the health route public and returns the success envelope', async () => {
    const response = await healthGET()
    expect(response.status).toBe(200)
    expect((await json(response)).data.status).toBe('ok')
  })

  it('keeps optimization and factory-data mutations protected from anonymous callers', async () => {
    const params = { factoryId }
    const optimization = await invoke(
      optimizationPOST,
      factoryPath('/optimization-requests'),
      params,
      { method: 'POST', body: {} },
    )
    const energy = await invoke(
      energyPOST,
      factoryPath('/energy-data'),
      params,
      { method: 'POST', body: {} },
    )
    const tariff = await invoke(
      tariffsPOST,
      factoryPath('/tariffs'),
      params,
      { method: 'POST', body: {} },
    )
    const schedules = await invoke(
      schedulesPOST,
      factoryPath('/schedules'),
      params,
      { method: 'POST', body: {} },
    )
    const scheduleUpdate = await invoke(
      schedulePATCH,
      factoryPath('/schedules/not-real'),
      { factoryId, scheduleId: 'not-real' },
      { method: 'PATCH', body: {} },
    )
    const energyUpdate = await invoke(
      energyPATCH,
      factoryPath('/energy-data/not-real'),
      { factoryId, energyId: 'not-real' },
      { method: 'PATCH', body: {} },
    )
    const tariffUpdate = await invoke(
      tariffPATCH,
      factoryPath('/tariffs/not-real'),
      { factoryId, tariffId: 'not-real' },
      { method: 'PATCH', body: {} },
    )

    expect(optimization.status).toBe(401)
    expect(energy.status).toBe(401)
    expect(tariff.status).toBe(401)
    expect(schedules.status).toBe(401)
    expect(scheduleUpdate.status).toBe(401)
    expect(energyUpdate.status).toBe(401)
    expect(tariffUpdate.status).toBe(401)
  })
})

describe('factory and configuration routes', () => {
  it('lists authorized factories and reports pagination metadata', async () => {
    const response = await factoriesGET(makeRequest('/api/v1/factories', { token: await ownerToken() }))
    const body = await json(response)
    expect(response.status).toBe(200)
    expect(body.data.map((row: { id: string }) => row.id)).toContain(factoryId)
    expect(body.meta).toMatchObject({ limit: 50, offset: 0 })
  })

  it('returns the intentional 404 for an authorized request to an unknown factory', async () => {
    const response = await invoke(factoryGET, `/api/v1/factories/${OTHER_FACTORY}`, { factoryId: OTHER_FACTORY }, {
      token: await adminToken(),
    })
    expect(response.status).toBe(404)
    expect((await json(response)).error.code).toBe('not_found')
  })

  it('reads, merges and replaces factory configuration using actual handlers', async () => {
    const params = { factoryId }
    const auth = await ownerToken()
    const before = await invoke(configGET, factoryPath('/config'), params, { token: auth })
    expect(before.status).toBe(200)
    const original = (await json(before)).data.config

    const patched = await invoke(configPATCH, factoryPath('/config'), params, {
      token: auth,
      method: 'PATCH',
      body: { config: { 'route-test-marker': 'merged' } },
    })
    expect(patched.status).toBe(200)
    expect((await json(patched)).data.config['route-test-marker']).toBe('merged')
    expect((await json(patched)).data.config.grid).toEqual(original.grid)

    const replaced = await invoke(configPUT, factoryPath('/config'), params, {
      token: auth,
      method: 'PUT',
      body: { config: { platform: 'generic' } },
    })
    expect(replaced.status).toBe(200)
    expect((await json(replaced)).data.config).toEqual({ platform: 'generic' })
  })

  it('maps malformed factory UUID and invalid config body to 400', async () => {
    const admin = await adminToken()
    const malformed = await invoke(factoryGET, '/api/v1/factories/not-a-uuid', { factoryId: 'not-a-uuid' }, {
      token: admin,
    })
    expect(malformed.status).toBe(400)
    expect((await json(malformed)).error.code).toBe('validation_error')

    const badConfig = await invoke(configPATCH, factoryPath('/config'), { factoryId }, {
      token: await ownerToken(),
      method: 'PATCH',
      body: { nope: true },
    })
    expect(badConfig.status).toBe(400)
    expect((await json(badConfig)).error).toMatchObject({ code: 'validation_error', message: 'Request validation failed' })
  })

  it('rejects an oversized JSON body at the actual factory collection handler', async () => {
    const auth = await adminToken()
    const response = await factoriesPOST(new NextRequest(new URL('/api/v1/factories', BASE), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${auth}`,
        'content-type': 'application/json',
        'content-length': String(MAX_JSON_BODY_BYTES + 1),
      },
      body: '{}',
    }))

    expect(response.status).toBe(400)
    expect((await json(response)).error).toMatchObject({
      code: 'validation_error',
      message: 'Request body exceeds the maximum allowed size',
      details: { max_bytes: MAX_JSON_BODY_BYTES },
    })
  })

  it('serves the factory summary and generic optimizer payload preview', async () => {
    const params = { factoryId }
    const auth = await ownerToken()
    const summary = await invoke(factorySummaryGET, factoryPath('/summary'), params, { token: auth })
    expect(summary.status).toBe(200)
    expect((await json(summary)).data).toMatchObject({
      factory: { id: factoryId },
      counts: { machines: 7, processes: 6, process_dependencies: 5 },
      optimizer: { configured: false },
    })

    const preview = await invoke(
      payloadGET,
      `${factoryPath('/payload')}?horizon_start=${encodeURIComponent(START)}&horizon_end=${encodeURIComponent(END)}&include_energy_data=false`,
      params,
      { token: auth },
    )
    expect(preview.status).toBe(200)
    expect((await json(preview)).data).toMatchObject({
      factoryId,
      factory: { slug: 'offline-demo-plant' },
      machines: expect.any(Array),
      processes: expect.any(Array),
      energyData: [],
    })
  })
})

describe('machine, process, dependency and order routes', () => {
  it('paginates machine results and rejects invalid pagination', async () => {
    const auth = await ownerToken()
    const params = { factoryId }
    const page = await invoke(machinesGET, `${factoryPath('/machines')}?limit=2&offset=1`, params, { token: auth })
    const body = await json(page)
    expect(page.status).toBe(200)
    expect(body.data).toHaveLength(2)
    expect(body.meta).toMatchObject({ total: 7, limit: 2, offset: 1 })

    const invalid = await invoke(machinesGET, `${factoryPath('/machines')}?limit=0`, params, { token: auth })
    expect(invalid.status).toBe(400)
    expect((await json(invalid)).error.code).toBe('validation_error')

    const tooDeep = await invoke(machinesGET, `${factoryPath('/machines')}?offset=1000001`, params, { token: auth })
    expect(tooDeep.status).toBe(400)
    expect((await json(tooDeep)).error.code).toBe('validation_error')

    const excessiveFilters = Array.from({ length: 65 }, (_, index) => `filter${index}=x`).join('&')
    const tooManyParameters = await invoke(machinesGET, `${factoryPath('/machines')}?${excessiveFilters}`, params, {
      token: auth,
    })
    expect(tooManyParameters.status).toBe(400)
    expect((await json(tooManyParameters)).error.code).toBe('validation_error')
  })

  it('creates a machine with 201, then maps its duplicate key to 409', async () => {
    const params = { factoryId }
    const body = { slug: unique('route-machine'), name: 'Flexible Cell', type: 'assembly_cell', is_active: true }
    const first = await invoke(machinesPOST, factoryPath('/machines'), params, {
      token: await ownerToken(), method: 'POST', body,
    })
    const firstBody = await json(first)
    expect(first.status).toBe(201)
    expect(firstBody.data.slug).toBe(body.slug)
    expect(first.headers.get('location')).toContain(`/machines/${firstBody.data.id}`)

    const duplicate = await invoke(machinesPOST, factoryPath('/machines'), params, {
      token: await ownerToken(), method: 'POST', body,
    })
    expect(duplicate.status).toBe(409)
    expect((await json(duplicate)).error.code).toBe('conflict')
  })

  it('returns 404 for a missing machine and 400 for an invalid process body', async () => {
    const params = { factoryId, machineId: MISSING_ID }
    const missing = await invoke(machineGET, `${factoryPath('/machines')}/${MISSING_ID}`, params, { token: await ownerToken() })
    expect(missing.status).toBe(404)
    expect((await json(missing)).error.code).toBe('not_found')

    const invalid = await invoke(processesPOST, factoryPath('/processes'), { factoryId }, {
      token: await ownerToken(), method: 'POST', body: { slug: 'missing-machine-process', name: 'Missing machine' },
    })
    expect(invalid.status).toBe(400)
    expect((await json(invalid)).error.code).toBe('validation_error')
  })

  it('returns 404 for a missing process resource', async () => {
    const response = await invoke(processGET, `${factoryPath('/processes')}/${MISSING_ID}`, {
      factoryId, processId: MISSING_ID,
    }, { token: await ownerToken() })
    expect(response.status).toBe(404)
    expect((await json(response)).error.code).toBe('not_found')
  })

  it('creates and retrieves a process and rejects a cross-factory machine reference', async () => {
    const params = { factoryId }
    const created = await invoke(processesPOST, factoryPath('/processes'), params, {
      token: await ownerToken(),
      method: 'POST',
      body: { slug: unique('route-process'), name: 'Generic inspection', machine_id: machineId, duration_minutes: 25 },
    })
    expect(created.status).toBe(201)
    const createdRow = (await json(created)).data
    expect(createdRow.factory_id).toBe(factoryId)

    const fetched = await invoke(processGET, `${factoryPath('/processes')}/${createdRow.id}`, {
      factoryId, processId: createdRow.id,
    }, { token: await ownerToken() })
    expect(fetched.status).toBe(200)
    expect((await json(fetched)).data.id).toBe(createdRow.id)

    const listed = await invoke(processesGET, `${factoryPath('/processes')}?include_dependencies=true`, params, {
      token: await ownerToken(),
    })
    expect(listed.status).toBe(200)
    expect((await json(listed)).data.length).toBeGreaterThan(0)
    expect((await json(listed)).data[0].depends_on).toEqual(expect.any(Array))

    const foreignMachine = await invoke(processesPOST, factoryPath('/processes'), params, {
      token: await ownerToken(), method: 'POST',
      body: { slug: unique('route-bad-process'), name: 'Bad reference', machine_id: MISSING_ID },
    })
    expect(foreignMachine.status).toBe(404)
    expect((await json(foreignMachine)).error.code).toBe('not_found')
  })

  it('returns 400 for invalid dependency enum and 409 for a duplicate edge', async () => {
    const params = { factoryId }
    const auth = await ownerToken()
    const invalid = await invoke(dependenciesPOST, factoryPath('/process-dependencies'), params, {
      token: auth, method: 'POST',
      body: { process_id: processId, depends_on_process_id: dependencyProcessId, dependency_type: 'whenever' },
    })
    expect(invalid.status).toBe(400)
    expect((await json(invalid)).error.code).toBe('validation_error')

    const edge = { process_id: processId, depends_on_process_id: dependencyProcessId, dependency_type: 'finish_to_start' }
    const first = await invoke(dependenciesPOST, factoryPath('/process-dependencies'), params, {
      token: auth, method: 'POST', body: edge,
    })
    expect(first.status).toBe(201)
    const createdEdge = (await json(first)).data
    dependencyId = createdEdge.id
    expect(createdEdge.process_id).toBe(processId)

    const detail = await invoke(dependencyGET, `${factoryPath('/process-dependencies')}/${createdEdge.id}`, {
      factoryId, dependencyId: createdEdge.id,
    }, { token: auth })
    expect(detail.status).toBe(200)
    expect((await json(detail)).data.id).toBe(createdEdge.id)

    const duplicate = await invoke(dependenciesPOST, factoryPath('/process-dependencies'), params, {
      token: auth, method: 'POST', body: edge,
    })
    expect(duplicate.status).toBe(409)
    expect((await json(duplicate)).error.code).toBe('conflict')

    const listed = await invoke(dependenciesGET, factoryPath('/process-dependencies'), params, { token: auth })
    expect(listed.status).toBe(200)
    expect((await json(listed)).data.some((row: { id: string }) => row.id === createdEdge.id)).toBe(true)
  })

  it('creates a production order and validates its enum and not-found behavior', async () => {
    const params = { factoryId }
    const auth = await ownerToken()
    const invalid = await invoke(ordersPOST, factoryPath('/production-orders'), params, {
      token: auth, method: 'POST', body: { reference: unique('route-invalid-order'), quantity: 5, status: 'paused' },
    })
    expect(invalid.status).toBe(400)

    const created = await invoke(ordersPOST, factoryPath('/production-orders'), params, {
      token: auth,
      method: 'POST',
      body: { reference: unique('route-order'), product: 'Assembly batch', quantity: 12, due_at: END, status: 'planned' },
    })
    expect(created.status).toBe(201)
    const createdOrder = (await json(created)).data
    orderId = createdOrder.id
    expect(createdOrder.quantity).toBe(12)

    const listed = await invoke(ordersGET, `${factoryPath('/production-orders')}?limit=1`, params, { token: auth })
    expect(listed.status).toBe(200)
    expect((await json(listed)).meta.limit).toBe(1)

    const missing = await invoke(orderGET, `${factoryPath('/production-orders')}/${MISSING_ID}`, {
      factoryId, orderId: MISSING_ID,
    }, { token: auth })
    expect(missing.status).toBe(404)
    expect((await json(missing)).error.code).toBe('not_found')
  })
})

describe('tariff and energy-data routes', () => {
  it('lists and creates tariffs, preserving 201 and the Location header', async () => {
    const params = { factoryId }
    const auth = await ownerToken()
    const listed = await invoke(tariffsGET, `${factoryPath('/tariffs')}?limit=2`, params, { token: auth })
    expect(listed.status).toBe(200)
    expect((await json(listed)).data).toHaveLength(2)
    expect((await json(listed)).meta.total).toBe(4)

    const body = {
      slug: unique('route-tariff'), name: 'Flexible tariff', currency: 'eur',
      start_time: '00:00', end_time: '23:59', energy_price_per_kwh: 0.17,
      effective_from: START,
    }
    const created = await invoke(tariffsPOST, factoryPath('/tariffs'), params, {
      token: auth, method: 'POST', body,
    })
    expect(created.status).toBe(201)
    const createdTariff = (await json(created)).data
    tariffId = createdTariff.id
    expect(createdTariff.currency).toBe('EUR')
    expect(created.headers.get('location')).toContain(`/tariffs/${tariffId}`)

    const detail = await invoke(tariffGET, `${factoryPath('/tariffs')}/${tariffId}`, {
      factoryId, tariffId,
    }, { token: auth })
    expect(detail.status).toBe(200)
    expect((await json(detail)).data.id).toBe(tariffId)
  })

  it('rejects invalid energy filters and ingests/retrieves a real interval', async () => {
    const params = { factoryId }
    const auth = await ownerToken()
    const invalidQuery = await invoke(energyGET, `${factoryPath('/energy-data')}?from=not-a-date`, params, { token: auth })
    expect(invalidQuery.status).toBe(400)
    expect((await json(invalidQuery)).error.code).toBe('validation_error')

    const invalidBody = await invoke(energyPOST, factoryPath('/energy-data'), params, {
      token: auth, method: 'POST', body: { consumption_kwh: -1 },
    })
    expect(invalidBody.status).toBe(400)
    expect((await json(invalidBody)).error.code).toBe('validation_error')

    const tooMany = await invoke(energyPOST, factoryPath('/energy-data'), params, {
      token: auth,
      method: 'POST',
      body: {
        intervals: Array.from({ length: 5_001 }, () => ({ recorded_at: '2042-08-01T07:30:00.000Z' })),
      },
    })
    expect(tooMany.status).toBe(400)
    expect((await json(tooMany)).error.code).toBe('validation_error')

    const created = await invoke(energyPOST, factoryPath('/energy-data'), params, {
      token: auth,
      method: 'POST',
      body: {
        recorded_at: '2042-08-01T07:45:00.000Z', interval_minutes: 15,
        consumption_kwh: 14.5, generation_kwh: 1.5, machine_id: machineId, source: 'route-test',
      },
    })
    expect(created.status).toBe(201)
    energyId = (await json(created)).data.id

    const page = await invoke(energyGET, `${factoryPath('/energy-data')}?limit=2&offset=0`, params, { token: auth })
    expect(page.status).toBe(200)
    expect((await json(page)).data.intervals).toHaveLength(2)
    expect((await json(page)).meta).toMatchObject({ limit: 2, offset: 0 })

    const detail = await invoke(energyGETById, `${factoryPath('/energy-data')}/${energyId}`, {
      factoryId, energyId,
    }, { token: auth })
    expect(detail.status).toBe(200)
    expect((await json(detail)).data.id).toBe(energyId)
  })

  it('returns aggregate summary for both populated and empty windows', async () => {
    const params = { factoryId }
    const auth = await ownerToken()
    const normal = await invoke(energySummaryGET, factoryPath('/energy-data/summary'), params, { token: auth })
    expect(normal.status).toBe(200)
    expect((await json(normal)).data).toMatchObject({ source: 'measured_energy_data' })
    expect((await json(normal)).data.intervals).toBeGreaterThan(0)

    const empty = await invoke(
      energySummaryGET,
      `${factoryPath('/energy-data/summary')}?from=2000-01-01T00%3A00%3A00.000Z&to=2000-01-02T00%3A00%3A00.000Z`,
      params,
      { token: auth },
    )
    expect(empty.status).toBe(200)
    expect((await json(empty)).data).toMatchObject({ intervals: 0, consumption_kwh: 0, generation_kwh: 0, from: null, to: null })
  })
})

describe('schedule and entry routes', () => {
  it('creates schedules, appends entries, replaces entries, and returns actual envelopes', async () => {
    const params = { factoryId }
    const auth = await ownerToken()
    const createdSchedule = await invoke(schedulesPOST, factoryPath('/schedules'), params, {
      token: auth, method: 'POST', body: newScheduleBody(),
    })
    expect(createdSchedule.status).toBe(201)
    const createdBody = await json(createdSchedule)
    scheduleId = createdBody.data.id
    expect(createdBody.data.status).toBe('draft')
    expect(createdSchedule.headers.get('location')).toContain(`/schedules/${scheduleId}`)

    const scheduleList = await invoke(schedulesGET, factoryPath('/schedules'), params, { token: auth })
    expect(scheduleList.status).toBe(200)
    expect((await json(scheduleList)).data.some((row: { id: string }) => row.id === scheduleId)).toBe(true)

    const appended = await invoke(entriesPOST, `${factoryPath(`/schedules/${scheduleId}/entries`)}`, {
      factoryId, scheduleId,
    }, {
      token: auth, method: 'POST',
      body: { entries: [entryBody(), entryBody({ machine_id: secondMachineId, process_id: secondProcessId, starts_at: MIDDLE, ends_at: END, sequence: 2 })] },
    })
    expect(appended.status).toBe(201)
    const appendedBody = await json(appended)
    expect(appendedBody.data).toHaveLength(2)
    expect(appendedBody.meta.created).toBe(2)
    const page = await invoke(entriesGET, `${factoryPath(`/schedules/${scheduleId}/entries`)}?limit=1`, {
      factoryId, scheduleId,
    }, { token: auth })
    expect(page.status).toBe(200)
    expect((await json(page)).data).toHaveLength(1)
    expect((await json(page)).meta.total).toBe(2)

    const replaced = await invoke(entriesPUT, factoryPath(`/schedules/${scheduleId}/entries`), {
      factoryId, scheduleId,
    }, {
      token: auth, method: 'PUT',
      body: { entries: [entryBody({ machine_id: secondMachineId, process_id: secondProcessId, starts_at: START, ends_at: END })], schedule: { status: 'published' } },
    })
    expect(replaced.status).toBe(200)
    expect((await json(replaced)).data).toHaveLength(1)
    expect((await json(replaced))).toMatchObject({
      meta: {
        meta: {
          replaced: 1,
          totals: { total_energy_kwh: 40, total_energy_cost: 5, peak_demand_kw: 80 },
        },
      },
    })

    const detail = await invoke(scheduleGET, factoryPath(`/schedules/${scheduleId}`), {
      factoryId, scheduleId,
    }, { token: auth })
    expect(detail.status).toBe(200)
    expect((await json(detail)).data).toMatchObject({ status: 'published', entry_count: 1 })
    expect((await json(detail)).data.computed_totals.total_energy_kwh).toBe(40)
  })

  it('returns 400 for a malformed schedule UUID and 404 for an unknown schedule', async () => {
    const auth = await ownerToken()
    const malformed = await invoke(scheduleGET, factoryPath('/schedules/not-a-uuid'), {
      factoryId, scheduleId: 'not-a-uuid',
    }, { token: auth })
    expect(malformed.status).toBe(400)
    expect((await json(malformed)).error.code).toBe('validation_error')

    const missing = await invoke(scheduleGET, factoryPath(`/schedules/${MISSING_ID}`), {
      factoryId, scheduleId: MISSING_ID,
    }, { token: auth })
    expect(missing.status).toBe(404)
    expect((await json(missing)).error.code).toBe('not_found')
  })

  it('rejects a schedule horizon whose end is not after its start', async () => {
    const response = await invoke(schedulesPOST, factoryPath('/schedules'), { factoryId }, {
      token: await ownerToken(),
      method: 'POST',
      body: { ...newScheduleBody(), horizon_end: START },
    })
    expect(response.status).toBe(400)
    expect((await json(response)).error.code).toBe('validation_error')
  })

  it('maps overlapping append to 409 and preserves existing rows after failed replacement', async () => {
    const params = { factoryId, scheduleId }
    const auth = await ownerToken()
    const overlap = await invoke(entriesPOST, factoryPath(`/schedules/${scheduleId}/entries`), params, {
      token: auth, method: 'POST',
      body: entryBody({ machine_id: secondMachineId, process_id: secondProcessId, starts_at: START, ends_at: MIDDLE }),
    })
    expect(overlap.status).toBe(409)
    expect((await json(overlap)).error.code).toBe('conflict')

    const before = await invoke(scheduleGET, factoryPath(`/schedules/${scheduleId}`), {
      factoryId, scheduleId,
    }, { token: auth })
    const beforeRows = (await json(before)).data.entries

    const failure = await invoke(entriesPUT, factoryPath(`/schedules/${scheduleId}/entries`), params, {
      token: auth,
      method: 'PUT',
      body: { entries: [entryBody({ production_order_id: MISSING_ID })] },
    })
    expect(failure.status).toBe(400)
    expect((await json(failure)).error.code).toBe('validation_error')

    const after = await invoke(scheduleGET, factoryPath(`/schedules/${scheduleId}`), {
      factoryId, scheduleId,
    }, { token: auth })
    expect((await json(after)).data.entries).toEqual(beforeRows)
  })

  it('returns 404 when entry operations target a missing schedule', async () => {
    const missingSchedule = MISSING_ID
    const response = await invoke(entriesPOST, factoryPath(`/schedules/${missingSchedule}/entries`), {
      factoryId, scheduleId: missingSchedule,
    }, {
      token: await ownerToken(), method: 'POST', body: entryBody(),
    })
    expect(response.status).toBe(404)
    expect((await json(response)).error.code).toBe('not_found')
  })
})

describe('optimizer HTTP boundary', () => {
  it('returns the real 503 envelope when unconfigured and includes no solution', async () => {
    const response = await invoke(optimizationPOST, factoryPath('/optimization-requests'), { factoryId }, {
      token: await ownerToken(),
      method: 'POST',
      body: { horizon_start: START, horizon_end: END },
    })

    expect(response.status).toBe(503)
    const body = await json(response)
    expect(body.error.code).toBe('service_unavailable')
    expect(body.error.details.payload_would_be_sent).toBeDefined()
    expect(body.error.details.solution).toBeUndefined()
  })
})

describe('schedule-entry detail routes', () => {
  it('gets, patches and deletes entries, including missing, invalid, overlapping and unauthorized cases', async () => {
    const auth = await ownerToken()
    const createdSchedule = await invoke(schedulesPOST, factoryPath('/schedules'), { factoryId }, {
      token: auth,
      method: 'POST',
      body: newScheduleBody(),
    })
    expect(createdSchedule.status).toBe(201)
    const newScheduleId = (await json(createdSchedule)).data.id as string

    const replaced = await invoke(entriesPUT, factoryPath(`/schedules/${newScheduleId}/entries`), {
      factoryId, scheduleId: newScheduleId,
    }, {
      token: auth,
      method: 'PUT',
      body: {
        entries: [
          entryBody({ sequence: 1 }),
          entryBody({ starts_at: MIDDLE, ends_at: END, sequence: 2 }),
        ],
      },
    })
    expect(replaced.status).toBe(200)
    const [first, second] = (await json(replaced)).data as Array<{ id: string }>
    expect(first?.id).toBeDefined()
    expect(second?.id).toBeDefined()

    const params = { factoryId, scheduleId: newScheduleId, entryId: first?.id as string }
    const fetched = await invoke(entryGET, factoryPath(`/schedules/${newScheduleId}/entries/${params.entryId}`), params, {
      token: auth,
    })
    expect(fetched.status).toBe(200)
    expect((await json(fetched)).data.id).toBe(params.entryId)

    const missing = await invoke(entryGET, factoryPath(`/schedules/${newScheduleId}/entries/${MISSING_ID}`), {
      factoryId, scheduleId: newScheduleId, entryId: MISSING_ID,
    }, { token: auth })
    expect(missing.status).toBe(404)
    expect((await json(missing)).error.code).toBe('not_found')

    const unauthorized = await invoke(entryPATCH, factoryPath(`/schedules/${newScheduleId}/entries/${params.entryId}`), params, {
      method: 'PATCH', body: { energy_kwh: 41 },
    })
    expect(unauthorized.status).toBe(401)

    const patched = await invoke(entryPATCH, factoryPath(`/schedules/${newScheduleId}/entries/${params.entryId}`), params, {
      token: auth, method: 'PATCH', body: { energy_kwh: 42 },
    })
    expect(patched.status).toBe(200)
    expect((await json(patched)).data.energy_kwh).toBe(42)

    const invalid = await invoke(entryPATCH, factoryPath(`/schedules/${newScheduleId}/entries/${params.entryId}`), params, {
      token: auth, method: 'PATCH', body: { energy_kwh: -1 },
    })
    expect(invalid.status).toBe(400)
    expect((await json(invalid)).error.code).toBe('validation_error')

    const overlap = await invoke(entryPATCH, factoryPath(`/schedules/${newScheduleId}/entries/${second?.id}`), {
      factoryId, scheduleId: newScheduleId, entryId: second?.id as string,
    }, {
      token: auth, method: 'PATCH', body: { starts_at: START, ends_at: MIDDLE },
    })
    expect(overlap.status).toBe(409)
    expect((await json(overlap)).error.code).toBe('conflict')

    const deleted = await invoke(entryDELETE, factoryPath(`/schedules/${newScheduleId}/entries/${params.entryId}`), params, {
      token: auth, method: 'DELETE',
    })
    expect(deleted.status).toBe(200)
    expect((await json(deleted)).data).toMatchObject({ id: params.entryId, deleted: true })

    const missingAfterDelete = await invoke(entryGET, factoryPath(`/schedules/${newScheduleId}/entries/${params.entryId}`), params, {
      token: auth,
    })
    expect(missingAfterDelete.status).toBe(404)
    const deleteMissing = await invoke(entryDELETE, factoryPath(`/schedules/${newScheduleId}/entries/${params.entryId}`), params, {
      token: auth, method: 'DELETE',
    })
    expect(deleteMissing.status).toBe(404)
  })
})

describe('optimization-result routes', () => {
  it('lists an empty collection, rejects invalid input, and stores only an explicit failure record', async () => {
    const auth = await ownerToken()
    const params = { factoryId }
    const empty = await invoke(optimizationResultsGET, factoryPath('/optimization-results'), params, { token: auth })
    expect(empty.status).toBe(200)
    expect((await json(empty)).data).toEqual([])

    const missing = await invoke(optimizationResultGET, factoryPath(`/optimization-results/${MISSING_ID}`), {
      factoryId, resultId: MISSING_ID,
    }, { token: auth })
    expect(missing.status).toBe(404)
    expect((await json(missing)).error.code).toBe('not_found')

    const invalid = await invoke(optimizationResultsPOST, factoryPath('/optimization-results'), params, {
      token: auth, method: 'POST', body: { status: 'invented-status' },
    })
    expect(invalid.status).toBe(400)
    expect((await json(invalid)).error.code).toBe('validation_error')

    // This records only the caller-supplied failure and null solution. No
    // optimizer is called and no solution/metrics format is invented here.
    const created = await invoke(optimizationResultsPOST, factoryPath('/optimization-results'), params, {
      token: auth,
      method: 'POST',
      body: { status: 'failed', solution: null, metrics: {} },
    })
    expect(created.status).toBe(201)
    const result = (await json(created)).data
    expect(result).toMatchObject({ factory_id: factoryId, status: 'failed', solution: null, metrics: {} })
    expect(created.headers.get('location')).toContain(`/optimization-results/${result.id}`)

    const fetched = await invoke(optimizationResultGET, factoryPath(`/optimization-results/${result.id}`), {
      factoryId, resultId: result.id,
    }, { token: auth })
    expect(fetched.status).toBe(200)
    expect((await json(fetched)).data.id).toBe(result.id)

    const patched = await invoke(optimizationResultPATCH, factoryPath(`/optimization-results/${result.id}`), {
      factoryId, resultId: result.id,
    }, { token: auth, method: 'PATCH', body: { metrics: { reviewed: true } } })
    expect(patched.status).toBe(200)
    expect((await json(patched)).data).toMatchObject({ status: 'failed', solution: null, metrics: { reviewed: true } })

    const deleted = await invoke(optimizationResultDELETE, factoryPath(`/optimization-results/${result.id}`), {
      factoryId, resultId: result.id,
    }, { token: auth, method: 'DELETE' })
    expect(deleted.status).toBe(200)
    expect((await json(deleted)).data.deleted).toBe(true)
    const missingAfterDelete = await invoke(optimizationResultGET, factoryPath(`/optimization-results/${result.id}`), {
      factoryId, resultId: result.id,
    }, { token: auth })
    expect(missingAfterDelete.status).toBe(404)
  })
})

describe('resource PATCH and DELETE route behavior', () => {
  it('allows an authorized factory deletion and verifies the factory is gone', async () => {
    const auth = await adminToken()
    const created = await factoriesPOST(makeRequest('/api/v1/factories', {
      token: auth,
      method: 'POST',
      body: { slug: unique('route-delete-factory'), name: 'Temporary Factory', timezone: 'UTC', currency: 'EUR' },
    }))
    expect(created.status).toBe(201)
    const id = (await json(created)).data.id as string

    const deleted = await invoke(factoryDELETE, `/api/v1/factories/${id}`, { factoryId: id }, {
      token: auth, method: 'DELETE',
    })

    expect(deleted.status).toBe(200)
    expect((await json(deleted)).data).toMatchObject({ id, deleted: true })

    const missing = await invoke(factoryGET, `/api/v1/factories/${id}`, { factoryId: id }, { token: auth })
    expect(missing.status).toBe(404)
  })

  it('patches and deletes machines, mapping bad, missing and referenced resources correctly', async () => {
    const auth = await ownerToken()
    const created = await invoke(machinesPOST, factoryPath('/machines'), { factoryId }, {
      token: auth, method: 'POST', body: { slug: unique('route-mutation-machine'), name: 'Mutation Cell' },
    })
    expect(created.status).toBe(201)
    const id = (await json(created)).data.id as string
    const params = { factoryId, machineId: id }

    const patched = await invoke(machinePATCH, factoryPath(`/machines/${id}`), params, {
      token: auth, method: 'PATCH', body: { name: 'Renamed Mutation Cell' },
    })
    expect(patched.status).toBe(200)
    expect((await json(patched)).data.name).toBe('Renamed Mutation Cell')

    const invalid = await invoke(machinePATCH, factoryPath(`/machines/${id}`), params, {
      token: auth, method: 'PATCH', body: { rated_power_kw: -1 },
    })
    expect(invalid.status).toBe(400)

    const referencedDelete = await invoke(machineDELETE, factoryPath(`/machines/${machineId}`), {
      factoryId, machineId,
    }, { token: auth, method: 'DELETE' })
    expect(referencedDelete.status).toBe(400)
    expect((await json(referencedDelete)).error.code).toBe('validation_error')

    const deleted = await invoke(machineDELETE, factoryPath(`/machines/${id}`), params, {
      token: auth, method: 'DELETE',
    })
    expect(deleted.status).toBe(200)
    const missingPatch = await invoke(machinePATCH, factoryPath(`/machines/${id}`), params, {
      token: auth, method: 'PATCH', body: { name: 'No longer here' },
    })
    expect(missingPatch.status).toBe(404)
    const missingDelete = await invoke(machineDELETE, factoryPath(`/machines/${id}`), params, {
      token: auth, method: 'DELETE',
    })
    expect(missingDelete.status).toBe(404)
  })

  it('patches and deletes processes, with invalid and missing resource responses', async () => {
    const auth = await ownerToken()
    const created = await invoke(processesPOST, factoryPath('/processes'), { factoryId }, {
      token: auth,
      method: 'POST',
      body: { slug: unique('route-mutation-process'), name: 'Mutation Process', machine_id: machineId },
    })
    expect(created.status).toBe(201)
    const id = (await json(created)).data.id as string
    const params = { factoryId, processId: id }

    const patched = await invoke(processPATCH, factoryPath(`/processes/${id}`), params, {
      token: auth, method: 'PATCH', body: { name: 'Updated Process' },
    })
    expect(patched.status).toBe(200)
    expect((await json(patched)).data.name).toBe('Updated Process')
    const invalid = await invoke(processPATCH, factoryPath(`/processes/${id}`), params, {
      token: auth, method: 'PATCH', body: { duration_minutes: -1 },
    })
    expect(invalid.status).toBe(400)
    const missingPatch = await invoke(processPATCH, factoryPath(`/processes/${MISSING_ID}`), {
      factoryId, processId: MISSING_ID,
    }, { token: auth, method: 'PATCH', body: { name: 'Missing' } })
    expect(missingPatch.status).toBe(404)

    const deleted = await invoke(processDELETE, factoryPath(`/processes/${id}`), params, {
      token: auth, method: 'DELETE',
    })
    expect(deleted.status).toBe(200)
    const missingDelete = await invoke(processDELETE, factoryPath(`/processes/${id}`), params, {
      token: auth, method: 'DELETE',
    })
    expect(missingDelete.status).toBe(404)
  })

  it('patches and deletes dependencies with validation and missing-resource mapping', async () => {
    const auth = await ownerToken()
    const params = { factoryId, dependencyId }
    const patched = await invoke(dependencyPATCH, factoryPath(`/process-dependencies/${dependencyId}`), params, {
      token: auth, method: 'PATCH', body: { dependency_type: 'start_to_start', lag_minutes: 15 },
    })
    expect(patched.status).toBe(200)
    expect((await json(patched)).data).toMatchObject({ dependency_type: 'start_to_start', lag_minutes: 15 })

    const invalid = await invoke(dependencyPATCH, factoryPath(`/process-dependencies/${dependencyId}`), params, {
      token: auth, method: 'PATCH', body: { dependency_type: 'not-a-dependency' },
    })
    expect(invalid.status).toBe(400)
    const missingPatch = await invoke(dependencyPATCH, factoryPath(`/process-dependencies/${MISSING_ID}`), {
      factoryId, dependencyId: MISSING_ID,
    }, { token: auth, method: 'PATCH', body: { lag_minutes: 1 } })
    expect(missingPatch.status).toBe(404)

    const deleted = await invoke(dependencyDELETE, factoryPath(`/process-dependencies/${dependencyId}`), params, {
      token: auth, method: 'DELETE',
    })
    expect(deleted.status).toBe(200)
    const missingDelete = await invoke(dependencyDELETE, factoryPath(`/process-dependencies/${dependencyId}`), params, {
      token: auth, method: 'DELETE',
    })
    expect(missingDelete.status).toBe(404)
  })

  it('patches and deletes production orders with enum validation and 404 handling', async () => {
    const auth = await ownerToken()
    const params = { factoryId, orderId }
    const patched = await invoke(orderPATCH, factoryPath(`/production-orders/${orderId}`), params, {
      token: auth, method: 'PATCH', body: { status: 'on_hold', priority: 20 },
    })
    expect(patched.status).toBe(200)
    expect((await json(patched)).data).toMatchObject({ status: 'on_hold', priority: 20 })

    const invalid = await invoke(orderPATCH, factoryPath(`/production-orders/${orderId}`), params, {
      token: auth, method: 'PATCH', body: { status: 'paused' },
    })
    expect(invalid.status).toBe(400)
    const missingPatch = await invoke(orderPATCH, factoryPath(`/production-orders/${MISSING_ID}`), {
      factoryId, orderId: MISSING_ID,
    }, { token: auth, method: 'PATCH', body: { status: 'planned' } })
    expect(missingPatch.status).toBe(404)

    const deleted = await invoke(orderDELETE, factoryPath(`/production-orders/${orderId}`), params, {
      token: auth, method: 'DELETE',
    })
    expect(deleted.status).toBe(200)
    const missingDelete = await invoke(orderDELETE, factoryPath(`/production-orders/${orderId}`), params, {
      token: auth, method: 'DELETE',
    })
    expect(missingDelete.status).toBe(404)
  })

  it('patches and deletes tariffs and validates updates', async () => {
    const auth = await ownerToken()
    const params = { factoryId, tariffId }
    const patched = await invoke(tariffPATCH, factoryPath(`/tariffs/${tariffId}`), params, {
      token: auth, method: 'PATCH', body: { energy_price_per_kwh: 0.19 },
    })
    expect(patched.status).toBe(200)
    expect((await json(patched)).data.energy_price_per_kwh).toBe(0.19)

    const invalid = await invoke(tariffPATCH, factoryPath(`/tariffs/${tariffId}`), params, {
      token: auth, method: 'PATCH', body: { tax_rate: 2 },
    })
    expect(invalid.status).toBe(400)
    const missingPatch = await invoke(tariffPATCH, factoryPath(`/tariffs/${MISSING_ID}`), {
      factoryId, tariffId: MISSING_ID,
    }, { token: auth, method: 'PATCH', body: { energy_price_per_kwh: 0.1 } })
    expect(missingPatch.status).toBe(404)

    const deleted = await invoke(tariffDELETE, factoryPath(`/tariffs/${tariffId}`), params, {
      token: auth, method: 'DELETE',
    })
    expect(deleted.status).toBe(200)
    const missingDelete = await invoke(tariffDELETE, factoryPath(`/tariffs/${tariffId}`), params, {
      token: auth, method: 'DELETE',
    })
    expect(missingDelete.status).toBe(404)
  })

  it('patches and deletes energy intervals, preserving immutable timestamps and 404 behavior', async () => {
    const auth = await ownerToken()
    const params = { factoryId, energyId }
    const patched = await invoke(energyPATCH, factoryPath(`/energy-data/${energyId}`), params, {
      token: auth, method: 'PATCH', body: { consumption_kwh: 18, source: 'route-updated' },
    })
    expect(patched.status).toBe(200)
    expect((await json(patched)).data).toMatchObject({ consumption_kwh: 18, source: 'route-updated' })

    const invalid = await invoke(energyPATCH, factoryPath(`/energy-data/${energyId}`), params, {
      token: auth, method: 'PATCH', body: { consumption_kwh: -1 },
    })
    expect(invalid.status).toBe(400)
    const missingPatch = await invoke(energyPATCH, factoryPath(`/energy-data/${MISSING_ID}`), {
      factoryId, energyId: MISSING_ID,
    }, { token: auth, method: 'PATCH', body: { source: 'missing' } })
    expect(missingPatch.status).toBe(404)

    const deleted = await invoke(energyDELETE, factoryPath(`/energy-data/${energyId}`), params, {
      token: auth, method: 'DELETE',
    })
    expect(deleted.status).toBe(200)
    const missingGet = await invoke(energyGETById, factoryPath(`/energy-data/${energyId}`), params, { token: auth })
    expect(missingGet.status).toBe(404)
    const missingDelete = await invoke(energyDELETE, factoryPath(`/energy-data/${energyId}`), params, {
      token: auth, method: 'DELETE',
    })
    expect(missingDelete.status).toBe(404)
  })

  it('patches and deletes schedules with validation and missing-resource mapping', async () => {
    const auth = await ownerToken()
    const created = await invoke(schedulesPOST, factoryPath('/schedules'), { factoryId }, {
      token: auth, method: 'POST', body: newScheduleBody(),
    })
    expect(created.status).toBe(201)
    const id = (await json(created)).data.id as string
    const params = { factoryId, scheduleId: id }

    const patched = await invoke(schedulePATCH, factoryPath(`/schedules/${id}`), params, {
      token: auth, method: 'PATCH', body: { name: 'Updated route schedule', status: 'active' },
    })
    expect(patched.status).toBe(200)
    expect((await json(patched)).data).toMatchObject({ name: 'Updated route schedule', status: 'active' })

    const invalid = await invoke(schedulePATCH, factoryPath(`/schedules/${id}`), params, {
      token: auth, method: 'PATCH', body: { status: 'paused' },
    })
    expect(invalid.status).toBe(400)
    const missingPatch = await invoke(schedulePATCH, factoryPath(`/schedules/${MISSING_ID}`), {
      factoryId, scheduleId: MISSING_ID,
    }, { token: auth, method: 'PATCH', body: { name: 'Missing schedule' } })
    expect(missingPatch.status).toBe(404)

    const deleted = await invoke(scheduleDELETE, factoryPath(`/schedules/${id}`), params, {
      token: auth, method: 'DELETE',
    })
    expect(deleted.status).toBe(200)
    const missingDelete = await invoke(scheduleDELETE, factoryPath(`/schedules/${id}`), params, {
      token: auth, method: 'DELETE',
    })
    expect(missingDelete.status).toBe(404)
  })

  it('runs documented dry-run requests and exercises request GET/PATCH/DELETE without optimizer output', async () => {
    const auth = await ownerToken()
    const params = { factoryId }
    const created = await invoke(optimizationPOST, factoryPath('/optimization-requests'), params, {
      token: auth,
      method: 'POST',
      body: { reference: unique('route-dry-run'), horizon_start: START, horizon_end: END, dry_run: true },
    })
    expect(created.status).toBe(201)
    const responseData = (await json(created)).data
    const requestId = responseData.request.id as string
    expect(responseData.solution).toBeNull()
    expect(responseData.request.request_payload).toBeDefined()

    const list = await invoke(optimizationRequestsGET, factoryPath('/optimization-requests'), params, { token: auth })
    expect(list.status).toBe(200)
    expect((await json(list)).data.some((row: { id: string }) => row.id === requestId)).toBe(true)

    const detailParams = { factoryId, requestId }
    const detailPath = factoryPath(`/optimization-requests/${requestId}`)
    const fetched = await invoke(optimizationRequestGET, detailPath, detailParams, { token: auth })
    expect(fetched.status).toBe(200)
    expect((await json(fetched)).data).toMatchObject({ id: requestId, result: null })

    const invalid = await invoke(optimizationRequestPATCH, detailPath, detailParams, {
      token: auth, method: 'PATCH', body: { status: 'invented-status' },
    })
    expect(invalid.status).toBe(400)
    const missingPatch = await invoke(optimizationRequestPATCH, factoryPath(`/optimization-requests/${MISSING_ID}`), {
      factoryId, requestId: MISSING_ID,
    }, { token: auth, method: 'PATCH', body: { status: 'cancelled' } })
    expect(missingPatch.status).toBe(404)

    const patched = await invoke(optimizationRequestPATCH, detailPath, detailParams, {
      token: auth, method: 'PATCH', body: { status: 'cancelled', error_message: 'recorded by test harness' },
    })
    expect(patched.status).toBe(200)
    expect((await json(patched)).data.status).toBe('cancelled')

    const deleted = await invoke(optimizationRequestDELETE, detailPath, detailParams, {
      token: auth, method: 'DELETE',
    })
    expect(deleted.status).toBe(200)
    const missingGet = await invoke(optimizationRequestGET, detailPath, detailParams, { token: auth })
    expect(missingGet.status).toBe(404)
    const missingDelete = await invoke(optimizationRequestDELETE, detailPath, detailParams, {
      token: auth, method: 'DELETE',
    })
    expect(missingDelete.status).toBe(404)
  })
})

describe('transactional Factory Builder persistence', () => {
  const payload = {
    factory: {
      slug: 'builder-transactional-test',
      name: 'Builder Transactional Test',
      industry: 'Food processing',
      currency: 'INR',
      working_hours_per_day: 8,
      solar_capacity_kw: 40,
      peak_tariff: 12,
      off_peak_tariff: 6,
    },
    machines: [{
      slug: 'builder-mixer',
      name: 'Builder mixer',
      type: 'mixer',
      rated_power_kw: 40,
      is_active: true,
    }],
    processes: [{
      slug: 'builder-mixing',
      name: 'Builder mixing',
      machine_slug: 'builder-mixer',
      duration_minutes: 40,
      is_active: true,
    }],
  }

  it('restricts create to admins and persists all Builder rows in one operation', async () => {
    const denied = await factoryBuilderPOST(makeRequest('/api/v1/factory-builder', {
      token: await ownerToken(),
      method: 'POST',
      body: payload,
    }))
    expect(denied.status).toBe(403)

    const created = await factoryBuilderPOST(makeRequest('/api/v1/factory-builder', {
      token: await adminToken(),
      method: 'POST',
      body: payload,
    }))
    expect(created.status).toBe(201)
    const savedId = ((await json(created)).data as { factory_id: string }).factory_id
    const db = getDb()
    expect(db.prepare('SELECT id FROM factories WHERE id = ?').get(savedId)).toBeDefined()
    expect(db.prepare('SELECT id FROM machines WHERE factory_id = ?').all(savedId)).toHaveLength(1)
    expect(db.prepare('SELECT id FROM processes WHERE factory_id = ?').all(savedId)).toHaveLength(1)
    expect(db.prepare('SELECT id FROM electricity_tariffs WHERE factory_id = ?').all(savedId)).toHaveLength(3)
  })

  it('allows only granted-factory edits and preserves the factory UUID', async () => {
    const created = await factoryBuilderPOST(makeRequest('/api/v1/factory-builder', {
      token: await adminToken(),
      method: 'POST',
      body: { ...payload, factory: { ...payload.factory, slug: unique('builder-edit') } },
    }))
    expect(created.status).toBe(201)
    const savedId = ((await json(created)).data as { factory_id: string }).factory_id
    const updated = await factoryBuilderPOST(makeRequest('/api/v1/factory-builder', {
      token: await token({ factory_ids: [savedId] }),
      method: 'POST',
      body: {
        ...payload,
        factory_id: savedId,
        factory: { ...payload.factory, slug: 'unchanged-on-edit', name: 'Updated Builder Test' },
      },
    }))
    expect(updated.status).toBe(200)
    expect((await json(updated)).data.factory_id).toBe(savedId)
    expect(getDb().prepare('SELECT name FROM factories WHERE id = ?').get(savedId)).toMatchObject({
      name: 'Updated Builder Test',
    })

    const denied = await factoryBuilderPOST(makeRequest('/api/v1/factory-builder', {
      token: await ownerToken(),
      method: 'POST',
      body: { ...payload, factory_id: savedId },
    }))
    expect(denied.status).toBe(404)
  })

  it('rolls back the transaction if a child reference fails', async () => {
    const attemptedSlug = unique('builder-rollback')
    const result = await client().rpc('save_factory_builder', {
      p_factory_id: null,
      p_factory: { ...payload.factory, slug: attemptedSlug },
      p_machines: payload.machines,
      p_processes: [{ ...payload.processes[0], machine_slug: 'missing-machine' }],
    })
    expect(result.error).not.toBeNull()
    expect(getDb().prepare('SELECT id FROM factories WHERE slug = ?').get(attemptedSlug)).toBeUndefined()
  })
})
