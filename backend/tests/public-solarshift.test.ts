import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const serviceClientMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase', () => ({
  getServiceClient: serviceClientMock,
}))

import { GET as publicScenarioGET } from '@/app/api/v1/public/solarshift/historical/[scenario]/route'
import { getPublicSolarShiftScenario } from '@/lib/services/public-solarshift'

const HGD_ID = 'd73e31ea-8ed7-440f-870f-5bd9ea6ab0e1'
const LGD_ID = 'eabac903-8d02-4e90-b236-5bbbc557eea5'
const BASE = 'http://localhost:3000'

type Row = Record<string, unknown>

class Query {
  private filters: Array<(row: Row) => boolean> = []
  private orderColumn: string | null = null
  private orderAscending = true

  constructor(private readonly table: string, private readonly source: Record<string, Row[]>) {}

  select(_columns: string): this {
    return this
  }

  eq(column: string, value: unknown): this {
    this.filters.push((row) => row[column] === value)
    return this
  }

  in(column: string, values: unknown[]): this {
    this.filters.push((row) => values.includes(row[column]))
    return this
  }

  order(column: string, options: { ascending?: boolean } = {}): this {
    this.orderColumn = column
    this.orderAscending = options.ascending ?? true
    return this
  }

  maybeSingle(): Promise<{ data: Row | null; error: null }> {
    return Promise.resolve({ data: this.result()[0] ?? null, error: null })
  }

  then<TResult1 = { data: Row[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve({ data: this.result(), error: null }).then(onfulfilled, onrejected)
  }

  private result(): Row[] {
    const matching = (this.source[this.table] ?? []).filter((row) =>
      this.filters.every((filter) => filter(row)),
    )
    if (this.orderColumn) {
      const column = this.orderColumn
      const direction = this.orderAscending ? 1 : -1
      matching.sort((left, right) =>
        String(left[column]).localeCompare(String(right[column])) * direction,
      )
    }
    return matching
  }
}

function fixtureRows(factoryId: string, code: 'HGD' | 'LGD'): Record<string, Row[]> {
  const slug = `solarshift-${code.toLowerCase()}-historical`
  const start = code === 'HGD' ? '2026-03-11T11:00:00Z' : '2026-01-11T12:00:00Z'
  const end = code === 'HGD' ? '2026-03-18T11:00:00Z' : '2026-01-18T12:00:00Z'
  const manifest = {
    scenario_code: code,
    selected_utc_start: start,
    selected_utc_end_exclusive: end,
    hourly_observations: 168,
    missing_observations: 0,
    fill_observations: 0,
    nasa_total_wh_m2: '349.44',
    modeled_pv_total_kwh: '83.8656',
    source: 'NASA POWER',
    parameter: 'ALLSKY_SFC_SW_DWN',
    units: 'Wh/m^2',
    source_product: 'SYN1DEG',
    coordinate: { latitude: 16.5, longitude: 80.5 },
    assumptions: {
      pv_capacity_kwp: '300',
      performance_ratio: '0.80',
      geometry: 'HORIZONTAL RESOURCE PROXY — NO TRANSPOSITION',
      timestamp_assumption: 'NASA hourly timestamp treated as the beginning of the represented hour.',
      power_factor: '0.95',
      power_factor_ratio: '19/20',
      subhourly_profile: 'MODELED FLAT-WITHIN-HOUR 15-MINUTE PROFILE',
      latitude: 16.5,
      longitude: 80.5,
    },
  }
  const processes = Array.from({ length: 8 }, (_, index) => ({
    id: `process-${code}-${index}`,
    factory_id: factoryId,
    slug: `process-${index}`,
    name: `Process ${index}`,
    duration_minutes: 30,
    machine_id: `machine-${code}-${index % 6}`,
    power_requirement_kw: 40,
    sensitive_private_field: 'not selected',
  }))
  const machines = Array.from({ length: 6 }, (_, index) => ({
    id: `machine-${code}-${index}`,
    factory_id: factoryId,
    slug: ['roasting-drum', 'refining-conche', 'tempering-unit', 'moulding-line', 'cooling-tunnel', 'packing-cell'][index],
    name: `Machine ${index}`,
    rated_power_kw: 100,
    sensitive_private_field: 'not selected',
  }))
  const schedules = [
    { id: `baseline-${code}`, factory_id: factoryId, name: 'SolarShift historical baseline', version: 1, status: 'draft', horizon_start: start, horizon_end: end, optimization_request_id: `request-${code}`, optimization_result_id: `result-${code}`, total_energy_cost: '10', total_energy_kwh: '20', metadata: { kind: 'baseline', modeled_solar_kwh: '5', modeled_grid_kwh: '15', makespan_minutes: 1380 } },
    { id: `optimized-${code}`, factory_id: factoryId, name: 'SolarShift historical optimized', version: 1, status: 'draft', horizon_start: start, horizon_end: end, optimization_request_id: `request-${code}`, optimization_result_id: `result-${code}`, total_energy_cost: '2', total_energy_kwh: '20', metadata: { kind: 'optimized', modeled_solar_kwh: '18', modeled_grid_kwh: '2', makespan_minutes: 6900 } },
  ]
  const entries = schedules.flatMap((schedule) =>
    processes.map((process, index) => ({
      id: `${schedule.id}-entry-${index}`,
      schedule_id: schedule.id,
      machine_id: process.machine_id,
      process_id: process.id,
      production_order_id: null,
      starts_at: new Date(Date.parse(start) + 18 * 60 * 60_000).toISOString(),
      ends_at: new Date(Date.parse(start) + 18.5 * 60 * 60_000).toISOString(),
      power_kw: '40',
      energy_kwh: '20',
      cost: '0.20',
      sequence: index,
      metadata: { solar_energy_units: '1', grid_energy_units: '2' },
    })),
  )
  const energy = Array.from({ length: 168 * 4 }, (_, index) => {
    const hour = Math.floor(index / 4)
    const observationTimestamp = new Date(Date.parse(start) + hour * 60 * 60_000).toISOString()
    const resourceWhM2 = '2.08'
    return {
      id: `energy-${code}-${index}`,
      factory_id: factoryId,
      recorded_at: new Date(Date.parse(start) + index * 15 * 60_000).toISOString(),
      interval_minutes: 15,
      generation_kwh: '0.1248',
      source: 'modeled_nasa_power',
      metadata: {
        provenance: manifest,
        assumptions: manifest.assumptions,
        transformation: 'MODELED FLAT-WITHIN-HOUR 15-MINUTE PROFILE',
        modeled_15_minute_generation_kwh: '0.1248',
        nasa_resource_wh_m2: resourceWhM2,
        nasa_observation_timestamp_utc: observationTimestamp,
        modeled_hourly_pv_kwh: '0.4992',
      },
    }
  })
  return {
    factories: [{
      id: factoryId,
      slug,
      name: `SolarShift ${code} Historical Scenario`,
      timezone: 'Asia/Kolkata',
      is_active: true,
      metadata: { solarshift_historical: manifest },
      private_config: { secret: 'must not be returned' },
    }],
    machines,
    processes,
    aperc_scenario_tariffs: [
      ['off_peak', '00:00:00', '06:00:00', '5.55'],
      ['peak', '06:00:00', '10:00:00', code === 'HGD' ? '7.80' : '7.30'],
      ['off_peak', '10:00:00', '15:00:00', '5.55'],
      ['normal', '15:00:00', '18:00:00', '6.30'],
      ['peak', '18:00:00', '22:00:00', code === 'HGD' ? '7.80' : '7.30'],
      ['normal', '22:00:00', '00:00:00', '6.30'],
    ].map(([band, start_time, end_time, energy_price], index) => ({
      id: `tariff-${code}-${index}`,
      factory_id: factoryId,
      regime: code,
      band,
      currency: 'INR',
      energy_basis: 'kVAh',
      energy_price,
      start_time,
      end_time,
      effective_from: '2025-04-01',
      effective_to: '2026-04-01',
      effective_months: [3],
    })),
    energy_data: energy,
    optimization_results: [{
      id: `result-${code}`,
      factory_id: factoryId,
      status: 'succeeded',
      total_energy_cost: '2',
      total_energy_kwh: '20',
      metrics: { solver: 'OR-Tools CP-SAT', baseline: {}, optimized: {} },
      private_payload: { do_not_return: true },
    }],
    schedules,
    schedule_entries: entries,
    optimization_requests: [{ id: `request-${code}`, factory_id: factoryId }],
  }
}

function installFixture() {
  const hgd = fixtureRows(HGD_ID, 'HGD')
  const lgd = fixtureRows(LGD_ID, 'LGD')
  const source: Record<string, Row[]> = Object.fromEntries(
    Object.keys(hgd).map((table) => [table, [...(hgd[table] ?? []), ...(lgd[table] ?? [])]]),
  )
  const queryLog: Array<{ table: string; filters: string[]; columns: string | null }> = []
  serviceClientMock.mockReturnValue({
    from(table: string) {
      const query = new Query(table, source)
      queryLog.push({ table, filters: [], columns: null })
      const originalSelect = query.select.bind(query)
      query.select = ((columns: string) => {
        queryLog.at(-1)!.columns = columns
        return originalSelect(columns)
      }) as Query['select']
      const originalEq = query.eq.bind(query)
      query.eq = ((column: string, value: unknown) => {
        queryLog.at(-1)?.filters.push(`eq:${column}:${String(value)}`)
        return originalEq(column, value)
      }) as Query['eq']
      const originalIn = query.in.bind(query)
      query.in = ((column: string, values: unknown[]) => {
        queryLog.at(-1)?.filters.push(`in:${column}:${values.join(',')}`)
        return originalIn(column, values)
      }) as Query['in']
      return query
    },
  })
  return { queryLog, source }
}

describe('public SolarShift historical endpoint', () => {
  beforeEach(() => {
    serviceClientMock.mockReset()
  })

  it.each([
    ['hgd', HGD_ID],
    ['lgd', LGD_ID],
  ] as const)('serves only the approved %s persisted replay without authentication', async (code, factoryId) => {
    const { queryLog } = installFixture()
    const request = new NextRequest(`${BASE}/api/v1/public/solarshift/historical/${code}`)
    const response = await publicScenarioGET(request, { params: { scenario: code } })
    const body = await response.json() as { data: Record<string, unknown> }
    const data = body.data

    expect(response.status, JSON.stringify(body)).toBe(200)
    expect(data.factory).toMatchObject({ id: factoryId, slug: `solarshift-${code}-historical` })
    expect((data.energyRows as unknown[])).toHaveLength(672)
    expect((data.hourlyProfile as unknown[])).toHaveLength(168)
    expect((data.tariffs as unknown[])).toHaveLength(6)
    expect((data.schedules as unknown[])).toHaveLength(2)
    expect((data.entries as unknown[])).toHaveLength(16)
    expect(data).not.toHaveProperty('private_config')
    expect(data).not.toHaveProperty('private_payload')
    expect(queryLog.every((query) => query.table !== 'factories' ||
      query.filters.includes(`eq:id:${factoryId}`))).toBe(true)
    expect(queryLog.some((query) => query.table === 'schedule_entries' &&
      query.filters.some((filter) => filter.startsWith('in:schedule_id:')))).toBe(true)
    expect(queryLog.find((query) => query.table === 'energy_data')?.columns)
      .toContain('generation_kwh::text')
    expect(queryLog.find((query) => query.table === 'aperc_scenario_tariffs')?.columns)
      .toContain('energy_price::text')
  })

  it('rejects arbitrary scenario names before accessing Supabase', async () => {
    const request = new NextRequest(`${BASE}/api/v1/public/solarshift/historical/private-factory`)
    const response = await publicScenarioGET(request, { params: { scenario: 'private-factory' } })
    expect(response.status).toBe(404)
    expect(serviceClientMock).not.toHaveBeenCalled()
  })

  it('does not accept inherited object properties as scenario selectors', async () => {
    await expect(getPublicSolarShiftScenario('toString')).rejects.toMatchObject({ status: 404 })
    expect(serviceClientMock).not.toHaveBeenCalled()
  })

  it('rejects a missing quarter-hour timestamp', async () => {
    const { source } = installFixture()
    const energy = source.energy_data?.[8]
    if (!energy) throw new Error('SolarShift fixture energy row is missing.')
    energy.recorded_at = '2026-03-11T13:15:00Z'

    await expect(getPublicSolarShiftScenario('hgd')).rejects.toMatchObject({ status: 500 })
  })

  it('rejects a modeled PV value that differs from its persisted provenance', async () => {
    const { source } = installFixture()
    const energy = source.energy_data?.[0]
    if (!energy) throw new Error('SolarShift fixture energy row is missing.')
    energy.generation_kwh = '0.1249'

    await expect(getPublicSolarShiftScenario('hgd')).rejects.toMatchObject({ status: 500 })
  })

  it('rejects an altered APERC rate or tariff window', async () => {
    const { source } = installFixture()
    const tariff = source.aperc_scenario_tariffs?.find((row) =>
      row.factory_id === LGD_ID && row.band === 'peak',
    )
    if (!tariff) throw new Error('SolarShift fixture tariff row is missing.')
    tariff.energy_price = '7.31'

    await expect(getPublicSolarShiftScenario('lgd')).rejects.toMatchObject({ status: 500 })
  })
})
