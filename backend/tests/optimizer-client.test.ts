/**
 * Verifies the optimizer adapter's central promise: until a real interface is
 * configured, it refuses to produce anything.
 *
 * This is the most important test file in the project. If any of these
 * expectations change, ByteMe would start inventing optimization output.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfigurationError, ServiceUnavailableError, UpstreamError } from '@/lib/errors'
import { resetEnvCache, serverEnv } from '@/lib/env'
import {
  createOptimizerTransport,
  decodeSolution,
  HttpOptimizerTransport,
  isOptimizerConfigured,
  optimizerUnavailableReason,
  readOptimizerConfig,
  UnconfiguredOptimizerTransport,
} from '@/lib/optimizer/client'
import type { OptimizationProblem } from '@/lib/optimizer/contract'

const BASE_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
}

const MACHINE_ID = '33333333-3333-4333-8333-333333333333'
const PROCESS_ID = '55555555-5555-4555-8555-555555555555'

function setEnv(overrides: Record<string, string | undefined>) {
  const merged: Record<string, string | undefined> = { ...BASE_ENV, ...overrides }
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('BYTEME_OPTIMIZER_')) delete process.env[key]
  }
  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  resetEnvCache()
}

const problem: OptimizationProblem = {
  schemaVersion: '1.0.0',
  requestReference: 'req-test',
  factoryId: '11111111-1111-4111-8111-111111111111',
  factory: {
    slug: 'demo',
    name: 'Demo',
    timezone: 'UTC',
    currency: 'EUR',
    config: {},
    metadata: {},
  },
  horizon: { start: '2026-03-02T08:00:00.000Z', end: '2026-03-02T20:00:00.000Z' },
  machines: [{
    id: MACHINE_ID,
    slug: 'asset-a',
    name: 'Asset A',
    type: 'production_asset',
    ratedPowerKw: 250,
    minPowerKw: 90,
    maxPowerKw: 250,
    minRuntimeMinutes: 30,
    maxRuntimeMinutes: 480,
    availability: {},
    metadata: {},
  }],
  processes: [{
    id: PROCESS_ID,
    slug: 'operation-a',
    name: 'Operation A',
    description: null,
    durationMinutes: 120,
    machineId: MACHINE_ID,
    powerRequirementKw: 250,
    productionQuantity: 500,
    unit: 'units',
    metadata: {},
  }],
  dependencies: [],
  productionOrders: [],
  energyData: [],
  tariffs: [],
  objective: {},
  constraints: {},
}

describe('optimizer adapter — unconfigured by default', () => {
  beforeEach(() => setEnv({ BYTEME_OPTIMIZER_ENABLED: 'false' }))
  afterEach(() => resetEnvCache())

  it('reports itself unconfigured and yields the refusing transport', () => {
    expect(isOptimizerConfigured()).toBe(false)
    expect(createOptimizerTransport()).toBeInstanceOf(UnconfiguredOptimizerTransport)
  })

  it('throws 503 rather than returning a solution', async () => {
    const transport = createOptimizerTransport()

    await expect(transport.solve(problem)).rejects.toBeInstanceOf(ServiceUnavailableError)
  })

  it('returns no schedule entries in the error details', async () => {
    const transport = createOptimizerTransport()

    await expect(transport.solve(problem)).rejects.toMatchObject({
      status: 503,
      code: 'service_unavailable',
    })
  })

  it('lists the configuration still required', async () => {
    const transport = createOptimizerTransport()

    try {
      await transport.solve(problem)
      expect.unreachable('solve should have thrown')
    } catch (error) {
      const details = (error as ServiceUnavailableError).details as Record<string, unknown>
      expect(details.requiredConfiguration).toEqual([
        'BYTEME_OPTIMIZER_ENABLED=true',
        'BYTEME_OPTIMIZER_BASE_URL',
        'BYTEME_OPTIMIZER_SOLVE_PATH',
        'BYTEME_OPTIMIZER_SOLVE_METHOD',
        'BYTEME_OPTIMIZER_DECODER',
      ])
    }
  })
})

describe('optimizer adapter — refuses to guess a partial configuration', () => {
  afterEach(() => resetEnvCache())

  it('refuses when enabled but no base URL is given', () => {
    setEnv({ BYTEME_OPTIMIZER_ENABLED: 'true' })
    expect(isOptimizerConfigured()).toBe(false)
    expect(optimizerUnavailableReason()).toMatch(/BASE_URL/)
  })

  describe('optimizer adapter — explicit local Python transport', () => {
    afterEach(() => resetEnvCache())

    it('selects the Python subprocess only when enabled and its executable is configured', () => {
      setEnv({
        BYTEME_OPTIMIZER_ENABLED: 'true',
        BYTEME_OPTIMIZER_TRANSPORT: 'python-subprocess',
        BYTEME_OPTIMIZER_PYTHON_EXECUTABLE: 'C:\\Python\\python.exe',
      })

      expect(isOptimizerConfigured()).toBe(true)
      expect(createOptimizerTransport().name).toBe('python-subprocess')
    })

    it('refuses Python mode when no interpreter is configured', () => {
      setEnv({
        BYTEME_OPTIMIZER_ENABLED: 'true',
        BYTEME_OPTIMIZER_TRANSPORT: 'python-subprocess',
      })

      expect(isOptimizerConfigured()).toBe(false)
      expect(optimizerUnavailableReason()).toMatch(/PYTHON_EXECUTABLE/)
    })

    it('reports Python configuration requirements when the local transport is unavailable', async () => {
      setEnv({
        BYTEME_OPTIMIZER_ENABLED: 'true',
        BYTEME_OPTIMIZER_TRANSPORT: 'python-subprocess',
      })

      await expect(createOptimizerTransport().solve(problem)).rejects.toMatchObject({
        details: {
          requiredConfiguration: [
            'BYTEME_OPTIMIZER_ENABLED=true',
            'BYTEME_OPTIMIZER_PYTHON_EXECUTABLE',
            'BYTEME_OPTIMIZER_PYTHON_WORKING_DIRECTORY',
          ],
        },
      })
    })
  })

  it('refuses when the solve path is missing, rather than assuming /solve', () => {
    setEnv({
      BYTEME_OPTIMIZER_ENABLED: 'true',
      BYTEME_OPTIMIZER_BASE_URL: 'https://optimizer.internal',
    })
    expect(optimizerUnavailableReason()).toMatch(/SOLVE_PATH/)
  })

  it('refuses when the HTTP method is missing, rather than defaulting to POST', () => {
    setEnv({
      BYTEME_OPTIMIZER_ENABLED: 'true',
      BYTEME_OPTIMIZER_BASE_URL: 'https://optimizer.internal',
      BYTEME_OPTIMIZER_SOLVE_PATH: '/v1/solve',
    })
    expect(optimizerUnavailableReason()).toMatch(/SOLVE_METHOD/)
  })

  it('refuses when the decoder is missing, rather than guessing the response', () => {
    setEnv({
      BYTEME_OPTIMIZER_ENABLED: 'true',
      BYTEME_OPTIMIZER_BASE_URL: 'https://optimizer.internal',
      BYTEME_OPTIMIZER_SOLVE_PATH: '/v1/solve',
      BYTEME_OPTIMIZER_SOLVE_METHOD: 'POST',
    })
    expect(optimizerUnavailableReason()).toMatch(/DECODER/)
  })

  it('is configured only once every part of the interface is supplied', () => {
    setEnv({
      BYTEME_OPTIMIZER_ENABLED: 'true',
      BYTEME_OPTIMIZER_BASE_URL: 'https://optimizer.internal',
      BYTEME_OPTIMIZER_SOLVE_PATH: '/v1/solve',
      BYTEME_OPTIMIZER_SOLVE_METHOD: 'POST',
      BYTEME_OPTIMIZER_DECODER: 'byteme-envelope',
    })

    expect(isOptimizerConfigured()).toBe(true)
    expect(createOptimizerTransport()).toBeInstanceOf(HttpOptimizerTransport)
  })
})

describe('optimizer adapter — HTTP transport', () => {
  const config = {
    enabled: true,
    baseUrl: 'https://optimizer.internal',
    solvePath: '/v1/solve',
    method: 'POST',
    decoder: 'byteme-envelope',
    apiKey: '',
    timeoutMs: 5000,
  }

  const validEnvelope = {
    objectiveValue: 1234.5,
    totalEnergyCost: 900.25,
    totalEnergyKwh: 4100,
    peakDemandKw: 780,
    entries: [
      {
        machineId: MACHINE_ID,
        processId: PROCESS_ID,
        productionOrderId: null,
        startsAt: '2026-03-02T09:00:00.000Z',
        endsAt: '2026-03-02T11:00:00.000Z',
        powerKw: 250,
        energyKwh: 500,
        cost: 109,
        quantity: 500,
        sequence: 0,
        metadata: {},
      },
    ],
    metrics: { solver: 'ortools', runtimeSeconds: 1.2 },
  }

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
    resetEnvCache()
  })

  it('posts the problem document and decodes a valid envelope', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(validEnvelope), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const solution = await new HttpOptimizerTransport(config).solve(problem)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const call = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(call[0].toString()).toBe('https://optimizer.internal/v1/solve')
    expect(call[1].method).toBe('POST')
    expect(JSON.parse(String(call[1].body))).toEqual(problem)

    expect(solution.totalEnergyCost).toBe(900.25)
    expect(solution.entries).toHaveLength(1)
    expect(solution.entries[0]?.startsAt).toBe('2026-03-02T09:00:00.000Z')
  })

  it('rejects malformed problem input before calling the configured endpoint', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(validEnvelope), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(new HttpOptimizerTransport(config).solve({ ...problem, factoryId: 'not-a-uuid' }))
      .rejects.toMatchObject({ status: 400, code: 'validation_error' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps the raw response for auditability', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(validEnvelope), { status: 200 })),
    )

    const solution = await new HttpOptimizerTransport(config).solve(problem)
    expect(solution.raw).toEqual(validEnvelope)
  })

  it('sends a bearer token only when one is configured', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(validEnvelope), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await new HttpOptimizerTransport({ ...config, apiKey: 'secret-token' }).solve(problem)

    const call = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect((call[1].headers as Record<string, string>).authorization).toBe('Bearer secret-token')
  })

  it('throws a 502 when the optimizer is unreachable', async () => {
    const internalFailure = 'ECONNREFUSED https://optimizer.private/internal Authorization: Bearer private-key'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error(internalFailure)
      }),
    )

    let caught: unknown
    try {
      await new HttpOptimizerTransport(config).solve(problem)
    } catch (error) {
      caught = error
    }
    expect(caught).toMatchObject({
      status: 502,
      code: 'upstream_error',
      details: { reason: 'unavailable' },
    })
    expect(JSON.stringify(caught)).not.toContain(internalFailure)
  })

  it('throws a 502 on a non-2xx reply instead of inventing a result', async () => {
    const privateBody = 'optimizer stack trace with private credentials'
    vi.stubGlobal('fetch', vi.fn(async () => new Response(privateBody, { status: 500 })))

    let caught: unknown
    try {
      await new HttpOptimizerTransport(config).solve(problem)
    } catch (error) {
      caught = error
    }
    expect(caught).toMatchObject({
      status: 502,
      details: { status: 500 },
    })
    expect(JSON.stringify(caught)).not.toContain(privateBody)
  })

  it('keeps the configured deadline active while reading the optimizer response body', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn(async (_url: URL, init: RequestInit) => new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          init.signal?.addEventListener('abort', () => controller.error(new Error('private body read error')), {
            once: true,
          })
        },
      }),
    ))
    vi.stubGlobal('fetch', fetchMock)

    const pending = new HttpOptimizerTransport({ ...config, timeoutMs: 100 }).solve(problem)
    let caught: unknown
    const observed = pending.catch((error: unknown) => {
      caught = error
    })
    await vi.advanceTimersByTimeAsync(100)
    await observed
    expect(caught).toBeInstanceOf(UpstreamError)
    expect(caught).toMatchObject({
      status: 502,
      code: 'upstream_error',
      message: 'Optimizer request timed out.',
      details: { reason: 'timeout' },
    })
    expect(JSON.stringify(caught)).not.toContain('private body read error')
  })

  it('throws a 502 when the response shape does not match the decoder', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ unexpected: true }), { status: 200 })),
    )

    await expect(new HttpOptimizerTransport(config).solve(problem)).rejects.toMatchObject({
      status: 502,
      code: 'upstream_error',
    })
  })

  it('rejects a response with a missing contract-required statistic', async () => {
    const { objectiveValue: _omitted, ...missingObjective } = validEnvelope
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(missingObjective), { status: 200 })))

    await expect(new HttpOptimizerTransport(config).solve(problem)).rejects.toMatchObject({
      status: 502,
      code: 'upstream_error',
    })
  })

  it('rejects output entries that do not reference submitted factory resources', async () => {
    const invalidReference = {
      ...validEnvelope,
      entries: [{ ...validEnvelope.entries[0], machineId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }],
    }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(invalidReference), { status: 200 })))

    await expect(new HttpOptimizerTransport(config).solve(problem)).rejects.toMatchObject({
      status: 502,
      code: 'upstream_error',
      message: 'Optimizer response contains entries inconsistent with the submitted problem.',
    })
  })

  it('rejects overlapping optimizer entries on the same machine', async () => {
    const overlapping = {
      ...validEnvelope,
      entries: [
        validEnvelope.entries[0],
        { ...validEnvelope.entries[0], startsAt: '2026-03-02T10:00:00.000Z', endsAt: '2026-03-02T12:00:00.000Z' },
      ],
    }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(overlapping), { status: 200 })))

    await expect(new HttpOptimizerTransport(config).solve(problem)).rejects.toMatchObject({
      status: 502,
      code: 'upstream_error',
      message: 'Optimizer response contains entries inconsistent with the submitted problem.',
    })
  })
})

describe('decodeSolution', () => {
  it('rejects a response that claims success but carries no entries field', () => {
    expect(() => decodeSolution({ totalEnergyCost: 100 })).toThrow()
  })

  it('rejects entries whose machine id is not a UUID', () => {
    expect(() =>
      decodeSolution({
        entries: [
          {
            machineId: 'machine-1',
            processId: 'process-1',
            startsAt: '2026-03-02T09:00:00.000Z',
            endsAt: '2026-03-02T10:00:00.000Z',
          },
        ],
      }),
    ).toThrow()
  })

  it('accepts an empty entry list, which is a legitimate infeasible answer', () => {
    const solution = decodeSolution({
      objectiveValue: null,
      totalEnergyCost: null,
      totalEnergyKwh: null,
      peakDemandKw: null,
      entries: [],
      metrics: {},
    })

    expect(solution.entries).toEqual([])
    expect(solution.totalEnergyCost).toBeNull()
  })

  it('accepts a complete externally supplied response without inventing omitted values', () => {
    const solution = decodeSolution({
      objectiveValue: null,
      totalEnergyCost: null,
      totalEnergyKwh: null,
      peakDemandKw: null,
      entries: [{
        machineId: MACHINE_ID,
        processId: PROCESS_ID,
        productionOrderId: null,
        startsAt: '2026-03-02T09:00:00.000Z',
        endsAt: '2026-03-02T11:00:00.000Z',
        powerKw: null,
        energyKwh: null,
        cost: null,
        quantity: null,
        sequence: 0,
        metadata: {},
      }],
      metrics: {},
    }, problem)

    expect(solution.entries[0]).toMatchObject({
      machineId: MACHINE_ID,
      processId: PROCESS_ID,
      productionOrderId: null,
      powerKw: null,
      sequence: 0,
      metadata: {},
    })
    expect(solution.raw).toMatchObject({ objectiveValue: null, metrics: {} })
  })
})

describe('environment safety', () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY
    resetEnvCache()
  })

  it('refuses to read a secret that was duplicated into NEXT_PUBLIC_', () => {
    setEnv({
      NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: 'leaked-value',
    })

    expect(() => serverEnv()).toThrow(/Security violation/)
  })

  it('rejects a missing service role key', () => {
    setEnv({ SUPABASE_SERVICE_ROLE_KEY: undefined })

    expect(() => serverEnv()).toThrow()
  })

  it('exposes no optimizer secret through a NEXT_PUBLIC_ variable', () => {
    setEnv({ BYTEME_OPTIMIZER_ENABLED: 'false' })

    expect(process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY).toBeUndefined()
    expect(process.env.NEXT_PUBLIC_BYTEME_OPTIMIZER_API_KEY).toBeUndefined()
  })
})

describe('optimizer configuration reading', () => {
  afterEach(() => resetEnvCache())

  it('returns a disabled config when nothing is set', () => {
    setEnv({ BYTEME_OPTIMIZER_ENABLED: 'false' })
    const config = readOptimizerConfig()

    expect(config.enabled).toBe(false)
    expect(config.baseUrl).toBe('')
    expect(config.solvePath).toBe('')
  })

  it('defaults the timeout to 180 seconds (two solver runs of up to 60 seconds each)', () => {
    setEnv({ BYTEME_OPTIMIZER_ENABLED: 'false' })
    expect(readOptimizerConfig().timeoutMs).toBe(180_000)
  })

  it('refuses an optimizer timeout above the five-minute ceiling', () => {
    setEnv({
      BYTEME_OPTIMIZER_ENABLED: 'true',
      BYTEME_OPTIMIZER_BASE_URL: 'https://optimizer.internal',
      BYTEME_OPTIMIZER_SOLVE_PATH: '/confirmed-path',
      BYTEME_OPTIMIZER_SOLVE_METHOD: 'POST',
      BYTEME_OPTIMIZER_DECODER: 'byteme-envelope',
      BYTEME_OPTIMIZER_TIMEOUT_MS: '300001',
    })

    expect(isOptimizerConfigured()).toBe(false)
    expect(optimizerUnavailableReason()).toMatch(/BYTEME_OPTIMIZER_TIMEOUT_MS/)
    expect(() => serverEnv()).toThrow(ConfigurationError)
  })
})