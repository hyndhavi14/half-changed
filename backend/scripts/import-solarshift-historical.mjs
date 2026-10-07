import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import pg from 'pg'

const { Pool } = pg
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const backendDir = path.resolve(scriptDir, '..')
const repositoryDir = path.resolve(backendDir, '..')
const migrationPath = path.join(backendDir, 'supabase', 'migrations', '0006_solarshift_scenario_tariffs.sql')
const canonicalSeedPath = path.join(backendDir, 'supabase', 'seed.sql')
const historicalSolverPath = path.join(repositoryDir, 'optimizer', 'solarshift_historical.py')
const pythonPath = process.env.SOLARSHIFT_PYTHON ?? path.join(repositoryDir, '.venv', 'Scripts', 'python.exe')

const SOURCE_FACTORY_SLUG = 'demo-chocolate-factory'
const NASA_PARAMETER = 'ALLSKY_SFC_SW_DWN'
const NASA_SOURCE = 'NASA POWER'
const NASA_POINT = { latitude: 16.5, longitude: 80.5 }
const APERC_ORDER = 'https://aperc.gov.in/upload/TariffOrderforFY202526.pdf'
const APERC_CORRIGENDUM = 'https://aperc.gov.in/upload/CorrigendumOrderonRSTforFY202526.pdf'
const APERC_SECTION = 'Section 4.3.1, Category-III(A), Industry (General) – HT, 11 kV'
const ENERGY_SCALE = 600_000
const WINDOWS = [
  {
    code: 'HGD',
    slug: 'solarshift-hgd-historical',
    name: 'SolarShift HGD Historical Scenario',
    start: '2026-03-11T11:00:00Z',
    end: '2026-03-18T11:00:00Z',
    expectedTotalCents: 3_754_240,
    peakPrice: '7.80',
    effectiveMonths: [2, 3, 4, 5, 9, 10],
  },
  {
    code: 'LGD',
    slug: 'solarshift-lgd-historical',
    name: 'SolarShift LGD Historical Scenario',
    start: '2026-01-11T12:00:00Z',
    end: '2026-01-18T12:00:00Z',
    expectedTotalCents: 3_063_408,
    peakPrice: '7.30',
    effectiveMonths: [1, 6, 7, 8, 11, 12],
  },
]
const CANONICAL_PROCESSES = {
  'roast-bean-blend': { name: 'Roast Bean Blend', duration: 120, power: 250, machine: 'roasting-drum' },
  'grind-nibs': { name: 'Grind Nibs', duration: 60, power: 200, machine: 'roasting-drum' },
  'conche-refine': { name: 'Conche Refine', duration: 300, power: 165, machine: 'refining-conche' },
  'age-maturation': { name: 'Age Maturation', duration: 720, power: 60, machine: 'refining-conche' },
  'temper-mass': { name: 'Temper Mass', duration: 60, power: 85, machine: 'tempering-unit' },
  'mould-shell': { name: 'Mould Shell', duration: 60, power: 130, machine: 'moulding-line' },
  'cool-and-demould': { name: 'Cool And Demould', duration: 30, power: 95, machine: 'cooling-tunnel' },
  'pack-retail': { name: 'Pack Retail', duration: 30, power: 38, machine: 'packing-cell' },
}
const TARIFF_WINDOWS = [
  { band: 'off_peak', start: '00:00', end: '06:00', price: '5.55' },
  { band: 'peak', start: '06:00', end: '10:00', price: null },
  { band: 'off_peak', start: '10:00', end: '15:00', price: '5.55' },
  { band: 'normal', start: '15:00', end: '18:00', price: '6.30' },
  { band: 'peak', start: '18:00', end: '22:00', price: null },
  { band: 'normal', start: '22:00', end: '00:00', price: '6.30' },
]
const APERC_METADATA = {
  source_name: 'APERC FY2025-26 Tariff Order',
  corrigendum: APERC_CORRIGENDUM,
  section: APERC_SECTION,
  energy_basis: 'kVAh',
  currency: 'INR',
  local_timezone: 'Asia/Kolkata',
  demand_charge_excluded: 'APERC demand charge excluded',
  minimum_billing_excluded: 'APERC minimum-billing rules excluded',
}
const SHARED_ASSUMPTIONS = {
  regional_point_label: 'REGIONAL SCENARIO POINT — NOT VERIFIED FACTORY LOCATION',
  latitude: NASA_POINT.latitude,
  longitude: NASA_POINT.longitude,
  pv_capacity_kwp: '300',
  pv_capacity_label: 'ASSUMED SCENARIO PV CAPACITY — NOT VERIFIED FACTORY INSTALLATION',
  performance_ratio: '0.80',
  performance_ratio_label: 'ASSUMED PV PERFORMANCE RATIO',
  geometry: 'HORIZONTAL RESOURCE PROXY — NO TRANSPOSITION',
  timestamp_assumption: 'NASA hourly timestamp treated as the beginning of the represented hour.',
  power_factor: '0.95',
  power_factor_ratio: '19/20',
  power_factor_label: 'MODELED SCENARIO ASSUMPTION — NOT MEASURED PLANT PF',
  modeled_kvah: 'modeled_kWh × 20/19',
  pv_formula: '300 × NASA Wh/m² / 1000 × 0.80',
  subhourly_profile: 'MODELED FLAT-WITHIN-HOUR 15-MINUTE PROFILE',
  generation_label: 'MODELED PV GENERATION',
  cost_label: 'MODELED TARIFF ENERGY COST — NOT AN ELECTRICITY BILL',
  demand_charge_excluded: 'APERC demand charge excluded',
  minimum_billing_excluded: 'APERC minimum-billing rules excluded',
  telemetry_label: 'NOT MEASURED — plant electricity/solar telemetry',
  manufacturing_label: 'SYNTHETIC/SCENARIO DATA — Chocolate manufacturing model',
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function json(value) {
  return JSON.stringify(value)
}

function decimalFixed(integer, scale, places) {
  const negative = integer < 0
  const absolute = BigInt(negative ? -integer : integer)
  const base = BigInt(scale)
  const whole = absolute / base
  const remainder = absolute % base
  const fractional = (remainder * 10n ** BigInt(places) / base)
    .toString()
    .padStart(places, '0')
  return `${negative ? '-' : ''}${whole}.${fractional}`
}

function centsFromSource(value, timestamp) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value === -999) {
    throw new Error(`NASA POWER value for ${timestamp} is missing, invalid, negative, or a fill value.`)
  }
  const lexical = String(value)
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(lexical)
  if (!match) throw new Error(`NASA POWER value for ${timestamp} is not exact to two decimals.`)
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'))
}

function dateKey(iso) {
  return iso.slice(0, 10).replace(/-/g, '')
}

function timestampForKey(key) {
  return new Date(
    Date.UTC(
      Number(key.slice(0, 4)),
      Number(key.slice(4, 6)) - 1,
      Number(key.slice(6, 8)),
      Number(key.slice(8, 10)),
    ),
  )
}

function dailyStatistics(observations) {
  const daily = new Map()
  let min = Infinity
  let max = -Infinity
  let lowSolarHours = 0
  for (const [index, observation] of observations.entries()) {
    const dayIndex = Math.floor(index / 24)
    const day = observations[dayIndex * 24].timestamp.slice(0, 10)
    daily.set(day, (daily.get(day) ?? 0) + observation.resource_cents)
    min = Math.min(min, observation.resource_cents)
    max = Math.max(max, observation.resource_cents)
    if (observation.resource_cents < 2_500) lowSolarHours += 1
  }
  const dailyTotals = [...daily.entries()].map(([date, cents]) => ({
    date,
    total_wh_m2: decimalFixed(cents, 100, 2),
  }))
  const dailyValues = dailyTotals.map((item) => Number(item.total_wh_m2))
  return {
    daily_totals_wh_m2: dailyTotals,
    minimum_hourly_wh_m2: decimalFixed(min, 100, 2),
    maximum_hourly_wh_m2: decimalFixed(max, 100, 2),
    daily_total_minimum_wh_m2: Math.min(...dailyValues).toFixed(2),
    daily_total_maximum_wh_m2: Math.max(...dailyValues).toFixed(2),
    daily_total_range_wh_m2: (Math.max(...dailyValues) - Math.min(...dailyValues)).toFixed(2),
    low_solar_hours_below_25_wh_m2: lowSolarHours,
  }
}

async function fetchAndValidateWindow(window) {
  const url = new URL('https://power.larc.nasa.gov/api/temporal/hourly/point')
  url.search = new URLSearchParams({
    parameters: NASA_PARAMETER,
    community: 'RE',
    longitude: String(NASA_POINT.longitude),
    latitude: String(NASA_POINT.latitude),
    start: dateKey(window.start),
    end: dateKey(window.end),
    format: 'JSON',
    'time-standard': 'UTC',
  }).toString()
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`NASA POWER returned HTTP ${response.status} for ${window.code}.`)
  const body = await response.json()
  const parameter = body?.properties?.parameter?.[NASA_PARAMETER]
  assert(parameter && typeof parameter === 'object', `NASA response is missing ${NASA_PARAMETER}.`)
  assert(body?.header?.time_standard === 'UTC', 'NASA response did not confirm UTC timestamps.')
  assert(body?.header?.fill_value === -999, 'NASA response did not report the expected -999 fill value.')
  assert(body?.header?.sources?.includes('SYN1DEG'), 'NASA response did not report SYN1DEG.')
  assert(body?.parameters?.[NASA_PARAMETER]?.units === 'Wh/m^2', 'NASA response unit is not Wh/m².')
  assert(
    body?.geometry?.coordinates?.[0] === NASA_POINT.longitude &&
      body?.geometry?.coordinates?.[1] === NASA_POINT.latitude,
    'NASA response returned a point other than the approved regional scenario point.',
  )

  const expectedStart = Date.parse(window.start)
  const expectedEnd = Date.parse(window.end)
  const observations = Object.entries(parameter)
    .map(([key, value]) => ({ key, value, timestamp: timestampForKey(key) }))
    .filter(({ timestamp }) => timestamp.getTime() >= expectedStart && timestamp.getTime() < expectedEnd)
    .sort((a, b) => a.timestamp - b.timestamp)
    .map(({ key, value, timestamp }) => ({
      timestamp: timestamp.toISOString(),
      resource_cents: centsFromSource(value, key),
      resource_wh_m2: String(value),
    }))

  assert(observations.length === 168, `${window.code} NASA window has ${observations.length}, not 168, observations.`)
  for (let index = 0; index < observations.length; index += 1) {
    const expected = expectedStart + index * 60 * 60 * 1000
    if (Date.parse(observations[index].timestamp) !== expected) {
      throw new Error(`${window.code} NASA window has a gap or duplicate near ${observations[index].timestamp}.`)
    }
  }
  const totalCents = observations.reduce((total, observation) => total + observation.resource_cents, 0)
  assert(
    totalCents === window.expectedTotalCents,
    `${window.code} NASA total ${decimalFixed(totalCents, 100, 2)} Wh/m² does not match the approved total.`,
  )
  return {
    observations,
    totalCents,
    statistics: dailyStatistics(observations),
    apiVersion: body?.header?.api?.version ?? null,
    source: body.header.sources.join(', '),
    units: body.parameters[NASA_PARAMETER].units,
    fillValue: body.header.fill_value,
  }
}

function modeledValues(resourceCents) {
  // One Wh/m² source cent maps to 24/10000 kWh for an hour and 6/10000 kWh for a quarter.
  return {
    hourlyKwh: decimalFixed(resourceCents * 24, 10_000, 4),
    quarterHourKwh: decimalFixed(resourceCents * 6, 10_000, 4),
  }
}

function expectedTariffRows(window) {
  return TARIFF_WINDOWS.map((tariff) => ({
    regime: window.code,
    band: tariff.band,
    currency: 'INR',
    energy_basis: 'kVAh',
    energy_price: tariff.price ?? window.peakPrice,
    start_time: tariff.start,
    end_time: tariff.end,
    effective_from: '2025-04-01',
    effective_to: '2026-04-01',
    effective_months: window.effectiveMonths,
  }))
}

function extractDollarQuotedBody(source) {
  return source.match(/as\s+\$[^$]*\$([\s\S]*?)\$[^$]*\$\s*;?/i)?.[1] ?? ''
}

function normalizeSqlBody(source) {
  return source.replace(/--[^\r\n]*/g, '').replace(/\s+/g, ' ').trim()
}

async function inspectMigrationHistory(client) {
  const { rows } = await client.query(
    `select version, name
       from supabase_migrations.schema_migrations
      where version in ('0005', '0006')
      order by version`,
  )
  const appliedFive = rows.find((row) => row.version === '0005')
  assert(appliedFive?.name === 'atomic_optimizer_schedules', 'Live migration 0005 does not match the local schedule migration.')
  const localFive = await readFile(path.join(backendDir, 'supabase', 'migrations', '0005_atomic_optimizer_schedules.sql'), 'utf8')
  const { rows: fnRows } = await client.query(
    `select pg_get_functiondef(
       'public.persist_optimization_schedules(uuid,uuid,uuid,text,jsonb)'::regprocedure
     ) as body`,
  )
  assert(
    normalizeSqlBody(extractDollarQuotedBody(localFive)) ===
      normalizeSqlBody(extractDollarQuotedBody(fnRows[0]?.body ?? '')),
    'Live 0005 function body differs from the local file; refusing to reconcile or write.',
  )

  const appliedSix = rows.find((row) => row.version === '0006')
  const tableExists = await client.query(`select to_regclass('public.aperc_scenario_tariffs') as name`)
  if (appliedSix) {
    assert(appliedSix.name === 'solarshift_scenario_tariffs', 'Live migration 0006 has an unexpected name.')
    assert(tableExists.rows[0].name !== null, 'Migration 0006 is recorded but its tariff table is missing.')
    return { state: 'already-applied' }
  }
  assert(tableExists.rows[0].name === null, 'Tariff table exists without migration 0006; refusing an unsafe partial migration.')
  return { state: 'pending' }
}

async function applyScenarioMigration(client, migrationSql, inspectedState) {
  if (inspectedState.state === 'already-applied') return inspectedState.state
  const connection = await client.connect()
  try {
    await connection.query('begin')
    await connection.query(migrationSql)
    await connection.query(
      `insert into supabase_migrations.schema_migrations (version, name, statements)
       values ($1, $2, $3::text[])`,
      ['0006', 'solarshift_scenario_tariffs', [migrationSql]],
    )
    await connection.query('commit')
  } catch (error) {
    await connection.query('rollback')
    throw error
  } finally {
    connection.release()
  }
  return 'applied'
}

async function loadCanonicalManufacturing(client) {
  const seed = await readFile(canonicalSeedPath, 'utf8')
  const seedLines = seed.split(/\r?\n/)
  for (const [slug, expected] of Object.entries(CANONICAL_PROCESSES)) {
    const line = seedLines.find((candidate) => candidate.includes(`('${slug}'`))
    assert(line, `Canonical process ${slug} is missing from Backend supabase/seed.sql.`)
    const rowPattern = new RegExp(
      `\\('${slug}',\\s*'${expected.name}',.*?,\\s*${expected.duration},\\s*'${expected.machine}',\\s*${expected.power}\\.0\\s*,`,
    )
    assert(rowPattern.test(line), `Backend supabase/seed.sql process ${slug} differs from the approved canonical model.`)
  }
  for (const dependency of [
    ['grind-nibs', 'roast-bean-blend'],
    ['conche-refine', 'grind-nibs'],
    ['age-maturation', 'conche-refine'],
    ['temper-mass', 'age-maturation'],
    ['mould-shell', 'temper-mass'],
    ['cool-and-demould', 'mould-shell'],
    ['pack-retail', 'cool-and-demould'],
  ]) {
    const dependencyPattern = new RegExp(
      `\\('${dependency[0]}',\\s*'${dependency[1]}',\\s*'finish_to_start',\\s*0\\.0`,
    )
    assert(
      dependencyPattern.test(seed),
      `Backend supabase/seed.sql dependency ${dependency[0]} → ${dependency[1]} is missing.`,
    )
  }
  const factory = await client.query(
    `select id, slug, name, config
       from public.factories
      where slug = $1`,
    [SOURCE_FACTORY_SLUG],
  )
  assert(factory.rowCount === 1, `Expected exactly one canonical factory with slug ${SOURCE_FACTORY_SLUG}.`)
  const sourceFactory = factory.rows[0]
  const processes = await client.query(
    `select p.*
       from public.processes p
      where p.factory_id = $1
      order by p.slug`,
    [sourceFactory.id],
  )
  assert(processes.rowCount === 8, 'Canonical Chocolate seed must contain exactly 8 processes.')
  for (const process of processes.rows) {
    const expected = CANONICAL_PROCESSES[process.slug]
    assert(expected, `Canonical process slug ${process.slug} is not in the approved model.`)
    assert(process.name === expected.name, `Canonical process ${process.slug} has an unexpected name.`)
  }
  assert(
    processes.rows.length === Object.keys(CANONICAL_PROCESSES).length,
    'Canonical process set does not exactly match the approved eight-process model.',
  )
  const machineIds = [...new Set(processes.rows.map((process) => process.machine_id))]
  assert(machineIds.length === 6, 'Canonical model must have exactly six process-assigned machines.')
  const machines = await client.query(
    `select *
       from public.machines
      where factory_id = $1
        and id = any($2::uuid[])
      order by slug`,
    [sourceFactory.id, machineIds],
  )
  assert(machines.rowCount === 6, 'Could not load all six process-assigned canonical machines.')
  const machineSlugById = new Map(machines.rows.map((machine) => [machine.id, machine.slug]))
  for (const process of processes.rows) {
    const expected = CANONICAL_PROCESSES[process.slug]
    assert(
      machineSlugById.get(process.machine_id) === expected.machine,
      `Canonical process ${process.slug} machine assignment differs from Backend supabase/seed.sql.`,
    )
  }
  const dependencies = await client.query(
    `select *
       from public.process_dependencies
      where factory_id = $1
      order by process_id, depends_on_process_id`,
    [sourceFactory.id],
  )
  assert(dependencies.rowCount === 7, 'Canonical model must have exactly seven dependencies.')
  assert(
    dependencies.rows.every((row) => row.dependency_type === 'finish_to_start' && Number(row.lag_minutes) === 0),
    'Canonical dependencies must all be zero-lag finish-to-start edges.',
  )
  const seedProcesses = processes.rows.map((process) => {
    const expected = CANONICAL_PROCESSES[process.slug]
    return {
      ...process,
      duration_minutes: expected.duration.toFixed(4),
      power_requirement_kw: expected.power.toFixed(4),
    }
  })
  return { sourceFactory, machines: machines.rows, processes: seedProcesses, dependencies: dependencies.rows }
}

function expectedManifest(window, fetched) {
  return {
    scenario_code: window.code,
    selected_utc_start: window.start,
    selected_utc_end_exclusive: window.end,
    local_timezone: 'Asia/Kolkata',
    local_start: new Date(Date.parse(window.start) + 330 * 60_000).toISOString().replace('Z', '+05:30'),
    local_end_exclusive: new Date(Date.parse(window.end) + 330 * 60_000).toISOString().replace('Z', '+05:30'),
    hourly_observations: fetched.observations.length,
    missing_observations: 0,
    fill_observations: 0,
    nasa_total_wh_m2: decimalFixed(fetched.totalCents, 100, 2),
    modeled_pv_total_kwh: decimalFixed(fetched.totalCents * 24, 10_000, 4),
    source: NASA_SOURCE,
    parameter: NASA_PARAMETER,
    units: fetched.units,
    source_product: fetched.source,
    nasa_api_version: fetched.apiVersion,
    coordinate: NASA_POINT,
    regional_label: SHARED_ASSUMPTIONS.regional_point_label,
    solar_statistics: fetched.statistics,
  }
}

async function insertEnergyRows(client, factoryId, window, fetched, manifest) {
  const intervals = []
  for (const observation of fetched.observations) {
    const resourceCents = observation.resource_cents
    const { hourlyKwh, quarterHourKwh } = modeledValues(resourceCents)
    const hourStart = Date.parse(observation.timestamp)
    for (let quarter = 0; quarter < 4; quarter += 1) {
      intervals.push({
        timestamp: new Date(hourStart + quarter * 15 * 60_000).toISOString(),
        generation: quarterHourKwh,
        metadata: {
          provenance: manifest,
          assumptions: SHARED_ASSUMPTIONS,
          nasa_observation_timestamp_utc: observation.timestamp,
          nasa_resource_wh_m2: observation.resource_wh_m2,
          modeled_hourly_pv_kwh: hourlyKwh,
          modeled_15_minute_generation_kwh: quarterHourKwh,
          transformation: SHARED_ASSUMPTIONS.subhourly_profile,
          measurement_status: SHARED_ASSUMPTIONS.telemetry_label,
        },
      })
    }
  }
  assert(intervals.length === 672, `${window.code} must produce 672 modeled quarter-hour energy rows.`)

  const values = []
  const tuples = intervals.map((interval, index) => {
    const offset = index * 8
    values.push(
      factoryId,
      interval.timestamp,
      15,
      '0',
      interval.generation,
      null,
      'modeled_nasa_power',
      json(interval.metadata),
    )
    return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}::jsonb)`
  })
  await client.query(
    `insert into public.energy_data
       (factory_id, recorded_at, interval_minutes, consumption_kwh, generation_kwh, machine_id, source, metadata)
     values ${tuples.join(',')}`,
    values,
  )
}

async function insertTariffs(client, factoryId, window, manifest) {
  const values = []
  const tuples = TARIFF_WINDOWS.map((tariff, index) => {
    const price = tariff.price ?? window.peakPrice
    const offset = index * 15
    values.push(
      factoryId,
      window.code,
      tariff.band,
      'INR',
      'kVAh',
      price,
      tariff.start,
      tariff.end,
      '2025-04-01',
      '2026-04-01',
      window.effectiveMonths,
      APERC_METADATA.source_name,
      APERC_ORDER,
      APERC_SECTION,
      json({
        ...APERC_METADATA,
        manifest,
        timestamp_basis: 'Asia/Kolkata wall-clock minute',
      }),
    )
    return `($${offset + 1},$${offset + 2},$${offset + 3},$${offset + 4},$${offset + 5},$${offset + 6},$${offset + 7},$${offset + 8},$${offset + 9},$${offset + 10},$${offset + 11}::smallint[],$${offset + 12},$${offset + 13},$${offset + 14},$${offset + 15}::jsonb)`
  })
  await client.query(
    `insert into public.aperc_scenario_tariffs
       (factory_id, regime, band, currency, energy_basis, energy_price, start_time, end_time,
        effective_from, effective_to, effective_months, source_name, source_url, source_section, metadata)
     values ${tuples.join(',')}`,
    values,
  )
}

function runHistoricalSolver(window, fetched, processes, dependencies, tariffs) {
  const solverInput = {
    regime: window.code,
    horizon_start: window.start,
    hourly_resource_wh_m2: fetched.observations.map((observation) => observation.resource_wh_m2),
    power_factor_ratio: '19/20',
    tariffs,
    processes: processes.map((process) => ({
      id: process.id,
      machine_id: process.machine_id,
      duration_minutes: Number(process.duration_minutes),
      power_kw: String(process.power_requirement_kw),
    })),
    dependencies: dependencies.map((dependency) => ({
      process_id: dependency.process_id,
      depends_on_process_id: dependency.depends_on_process_id,
      dependency_type: dependency.dependency_type,
      lag_minutes: Number(dependency.lag_minutes),
    })),
  }
  const result = spawnSync(pythonPath, [historicalSolverPath], {
    input: json(solverInput),
    encoding: 'utf8',
    timeout: 90_000,
    maxBuffer: 20 * 1024 * 1024,
    windowsHide: true,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`Historical ${window.code} CP-SAT run failed: ${(result.stderr || result.stdout).trim()}`)
  }
  try {
    const solution = JSON.parse(result.stdout)
    assert(solution.status === 'OPTIMAL' || solution.status === 'FEASIBLE', 'CP-SAT returned an unsupported solve status.')
    return { solverInput, solution }
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('Historical CP-SAT returned invalid JSON.')
    throw error
  }
}

function peakPowerKw(entries, processById) {
  const events = []
  for (const entry of entries) {
    const power = Number(processById.get(entry.process_id).power_requirement_kw)
    events.push([Date.parse(entry.starts_at), power])
    events.push([Date.parse(entry.ends_at), -power])
  }
  events.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  let current = 0
  let peak = 0
  for (const [, delta] of events) {
    current += delta
    peak = Math.max(peak, current)
  }
  return peak.toFixed(4)
}

function solveMetric(entries, metricName) {
  const total = entries.reduce((sum, entry) => sum + BigInt(entry[metricName]), 0n)
  return decimalFixed(total, ENERGY_SCALE, 6)
}

function enrichSolverEntry(entry, process, index, window) {
  return {
    machine_id: entry.machine_id,
    process_id: entry.process_id,
    production_order_id: null,
    starts_at: entry.starts_at,
    ends_at: entry.ends_at,
    power_kw: entry.power_kw,
    energy_kwh: entry.energy_kwh_display,
    cost: entry.cost_display_inr,
    quantity: null,
    sequence: index,
    metadata: {
      scenario_regime: window.code,
      cost_label: SHARED_ASSUMPTIONS.cost_label,
      energy_scale: ENERGY_SCALE,
      energy_units: entry.energy_units,
      solar_energy_units: entry.solar_energy_units,
      grid_energy_units: entry.grid_energy_units,
      cost_numerator: entry.cost_numerator,
      cost_denominator: entry.cost_denominator,
      tariff_basis: 'kVAh',
      modeled_power_factor: '0.95',
      tariff_timezone: 'Asia/Kolkata',
      demand_charge_excluded: true,
      minimum_billing_excluded: true,
    },
  }
}

async function persistSchedule(client, {
  factoryId,
  requestId,
  resultId,
  kind,
  horizonStart,
  horizonEnd,
  entries,
  processesById,
  window,
}) {
  const metrics = entries
  const energy = solveMetric(metrics, 'energy_units')
  const solar = solveMetric(metrics, 'solar_energy_units')
  const grid = solveMetric(metrics, 'grid_energy_units')
  const costNumerator = metrics.reduce((sum, entry) => sum + BigInt(entry.cost_numerator), 0n)
  const costDenominator = BigInt(metrics[0].cost_denominator)
  const cost = decimalFixed(
    (costNumerator * 1_000_000n + costDenominator / 2n) / costDenominator,
    1_000_000,
    6,
  )
  const makespanMinutes = Math.max(...metrics.map(
    (entry) => entry.start_minute + entry.duration_minutes,
  ))
  const scheduleMetadata = {
    kind,
    scenario_regime: window.code,
    cost_label: SHARED_ASSUMPTIONS.cost_label,
    modeled_solar_kwh: solar,
    modeled_grid_kwh: grid,
    exact_cost_numerator: String(costNumerator),
    exact_cost_denominator: String(costDenominator),
    energy_scale: ENERGY_SCALE,
    makespan_minutes: makespanMinutes,
    cost_basis: 'grid energy × APERC INR/kVAh × modeled 20/19 kWh-to-kVAh conversion',
    exclusions: [SHARED_ASSUMPTIONS.demand_charge_excluded, SHARED_ASSUMPTIONS.minimum_billing_excluded],
  }
  const schedule = await client.query(
    `insert into public.schedules
       (factory_id, name, version, status, horizon_start, horizon_end,
        optimization_request_id, optimization_result_id, total_energy_cost,
        total_energy_kwh, peak_demand_kw, metadata)
     values ($1,$2,1,'draft',$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
     returning id`,
    [
      factoryId,
      kind === 'baseline' ? 'SolarShift historical baseline' : 'SolarShift historical optimized',
      horizonStart,
      horizonEnd,
      requestId,
      resultId,
      cost,
      energy,
      peakPowerKw(entries, processesById),
      json(scheduleMetadata),
    ],
  )
  const scheduleId = schedule.rows[0].id
  const values = []
  const tuples = entries.map((entry, index) => {
    const row = enrichSolverEntry(entry, processesById.get(entry.process_id), index, window)
    const offset = index * 12
    values.push(
      scheduleId,
      row.machine_id,
      row.process_id,
      null,
      row.starts_at,
      row.ends_at,
      row.power_kw,
      row.energy_kwh,
      row.cost,
      null,
      row.sequence,
      json(row.metadata),
    )
    return `($${offset + 1},$${offset + 2},$${offset + 3},$${offset + 4},$${offset + 5},$${offset + 6},$${offset + 7},$${offset + 8},$${offset + 9},$${offset + 10},$${offset + 11},$${offset + 12}::jsonb)`
  })
  await client.query(
    `insert into public.schedule_entries
       (schedule_id, machine_id, process_id, production_order_id, starts_at, ends_at,
        power_kw, energy_kwh, cost, quantity, sequence, metadata)
     values ${tuples.join(',')}`,
    values,
  )
  return {
    id: scheduleId,
    kind,
    total_energy_kwh: energy,
    modeled_solar_kwh: solar,
    modeled_grid_kwh: grid,
    modeled_tariff_energy_cost_inr: cost,
    exact_cost_numerator: String(costNumerator),
    exact_cost_denominator: String(costDenominator),
    makespan_minutes: makespanMinutes,
    peak_demand_kw: peakPowerKw(entries, processesById),
    entries: entries.length,
  }
}

async function existingScenario(client, window) {
  const factory = await client.query(
    `select id, metadata
       from public.factories
      where slug = $1`,
    [window.slug],
  )
  if (factory.rowCount === 0) return null
  assert(factory.rowCount === 1, `${window.slug} resolves to duplicate factory rows.`)
  const factoryId = factory.rows[0].id
  const [energy, tariffs, requests, results, schedules] = await Promise.all([
    client.query('select count(*)::int as count from public.energy_data where factory_id=$1', [factoryId]),
    client.query('select count(*)::int as count from public.aperc_scenario_tariffs where factory_id=$1', [factoryId]),
    client.query('select count(*)::int as count from public.optimization_requests where factory_id=$1', [factoryId]),
    client.query('select count(*)::int as count from public.optimization_results where factory_id=$1', [factoryId]),
    client.query('select id, name from public.schedules where factory_id=$1', [factoryId]),
  ])
  assert(factory.rows[0].metadata?.solarshift_historical?.scenario_code === window.code, `${window.slug} exists but is not a matching SolarShift scenario.`)
  assert(Number(energy.rows[0].count) === 672, `${window.slug} already exists with incomplete energy data.`)
  assert(Number(tariffs.rows[0].count) === 6, `${window.slug} already exists with incomplete tariff data.`)
  assert(Number(requests.rows[0].count) === 1, `${window.slug} already exists with an unexpected request count.`)
  assert(Number(results.rows[0].count) === 1, `${window.slug} already exists with an unexpected result count.`)
  assert(schedules.rowCount === 2, `${window.slug} already exists without exactly two schedules.`)
  const entries = await client.query(
    `select s.name, count(e.id)::int as entries
       from public.schedules s
       left join public.schedule_entries e on e.schedule_id = s.id
      where s.factory_id = $1
      group by s.id, s.name`,
    [factoryId],
  )
  assert(entries.rowCount === 2 && entries.rows.every((row) => row.entries === 8), `${window.slug} existing schedule entries are incomplete.`)
  return {
    factory_id: factoryId,
    energy_rows: Number(energy.rows[0].count),
    tariff_rows: Number(tariffs.rows[0].count),
    request_count: Number(requests.rows[0].count),
    result_count: Number(results.rows[0].count),
    schedules: schedules.rows.map((row) => ({ id: row.id, name: row.name })),
    reused_existing: true,
  }
}

async function importScenario(database, canonical, window, fetched) {
  const manifest = expectedManifest(window, fetched)
  const alreadyPresent = await existingScenario(database, window)
  if (alreadyPresent) return alreadyPresent

  const client = await database.connect()
  try {
    await client.query('begin')

    const factoryMetadata = {
      solarshift_historical: {
        ...manifest,
        assumptions: SHARED_ASSUMPTIONS,
        aperc: {
          ...APERC_METADATA,
          regime: window.code,
          peak_price_inr_per_kvah: window.peakPrice,
          normal_price_inr_per_kvah: '6.30',
          off_peak_price_inr_per_kvah: '5.55',
          effective_months: window.effectiveMonths,
        },
        source_manufacturing_factory_slug: canonical.sourceFactory.slug,
        source_manufacturing_factory_id: canonical.sourceFactory.id,
        manufacturing_process_values_source: 'backend/supabase/seed.sql',
        manufacturing_model: SHARED_ASSUMPTIONS.manufacturing_label,
        persisted_data: {
          energy_intervals: 672,
          tariff_windows: 6,
          production_orders_cloned: false,
        },
      },
    }
    const factoryRow = await client.query(
      `insert into public.factories
         (slug, name, description, timezone, currency, config, metadata, is_active)
       values ($1,$2,$3,'Asia/Kolkata','INR',$4::jsonb,$5::jsonb,true)
       returning id`,
      [
        window.slug,
        window.name,
        `${SHARED_ASSUMPTIONS.manufacturing_label}. Historical ${window.code} SolarShift replay.`,
        json({
          historical_replay: true,
          optimizer_model: 'SolarShift exact minute-local APERC scenario path',
        }),
        json(factoryMetadata),
      ],
    )
    const factoryId = factoryRow.rows[0].id

    const machineIds = new Map()
    for (const machine of canonical.machines) {
      const inserted = await client.query(
        `insert into public.machines
           (factory_id, slug, name, type, rated_power_kw, min_power_kw, max_power_kw,
            min_runtime_minutes, max_runtime_minutes, availability, metadata, is_active)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12)
         returning id`,
        [
          factoryId,
          machine.slug,
          machine.name,
          machine.type,
          machine.rated_power_kw,
          machine.min_power_kw,
          machine.max_power_kw,
          machine.min_runtime_minutes,
          machine.max_runtime_minutes,
          json(machine.availability),
          json(machine.metadata),
          machine.is_active,
        ],
      )
      machineIds.set(machine.id, inserted.rows[0].id)
    }
    assert(machineIds.size === 6, 'Exactly six scenario-owned process-assigned machines must be created.')

    const processIds = new Map()
    for (const process of canonical.processes) {
      const inserted = await client.query(
        `insert into public.processes
           (factory_id, slug, name, description, duration_minutes, machine_id,
            power_requirement_kw, production_quantity, unit, metadata, is_active)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)
         returning id`,
        [
          factoryId,
          process.slug,
          process.name,
          process.description,
          process.duration_minutes,
          machineIds.get(process.machine_id),
          process.power_requirement_kw,
          process.production_quantity,
          process.unit,
          json(process.metadata),
          process.is_active,
        ],
      )
      processIds.set(process.id, inserted.rows[0].id)
    }

    for (const dependency of canonical.dependencies) {
      await client.query(
        `insert into public.process_dependencies
           (factory_id, process_id, depends_on_process_id, dependency_type, lag_minutes, metadata)
         values ($1,$2,$3,$4,$5,$6::jsonb)`,
        [
          factoryId,
          processIds.get(dependency.process_id),
          processIds.get(dependency.depends_on_process_id),
          dependency.dependency_type,
          dependency.lag_minutes,
          json(dependency.metadata),
        ],
      )
    }
    assert(processIds.size === 8 && canonical.dependencies.length === 7, 'Scenario manufacturing clone is incomplete.')

    const scenarioProcesses = canonical.processes.map((process) => ({
      ...process,
      id: processIds.get(process.id),
      machine_id: machineIds.get(process.machine_id),
    }))
    const scenarioDependencies = canonical.dependencies.map((dependency) => ({
      ...dependency,
      process_id: processIds.get(dependency.process_id),
      depends_on_process_id: processIds.get(dependency.depends_on_process_id),
    }))

    await insertEnergyRows(client, factoryId, window, fetched, manifest)
    await insertTariffs(client, factoryId, window, manifest)
    const persistedTariffs = await client.query(
      `select regime, band, currency, energy_basis, energy_price::text,
              start_time::text, end_time::text, effective_from::text, effective_to::text,
              effective_months
         from public.aperc_scenario_tariffs
        where factory_id = $1
        order by start_time, band`,
      [factoryId],
    )
    assert(persistedTariffs.rowCount === 6, 'The six scenario tariff windows were not persisted before optimization.')

    const { solverInput, solution } = runHistoricalSolver(
      window,
      fetched,
      scenarioProcesses,
      scenarioDependencies,
      persistedTariffs.rows,
    )
    const requestPayload = {
      schema: 'solarshift-historical-scenario-v1',
      scenario: manifest,
      assumptions: SHARED_ASSUMPTIONS,
      manufacturing: {
        source_factory_slug: canonical.sourceFactory.slug,
        processes: solverInput.processes,
        dependencies: solverInput.dependencies,
        machine_ids: [...machineIds.values()],
        production_orders_cloned: false,
      },
      solar_resource: fetched.observations.map((observation) => ({
        timestamp_utc: observation.timestamp,
        resource_wh_m2: observation.resource_wh_m2,
      })),
      tariff_objective: {
        basis: 'kVAh',
        currency: 'INR',
        power_factor: '19/20',
        local_timezone: 'Asia/Kolkata',
        windows: persistedTariffs.rows,
        demand_charge_excluded: true,
        minimum_billing_excluded: true,
      },
      solver_input: solverInput,
    }
    const request = await client.query(
      `insert into public.optimization_requests
         (factory_id, reference, status, horizon_start, horizon_end, objective, constraints,
          request_payload, adapter_metadata, created_by)
       values ($1,$2,'running',$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,'solarshift-historical-import')
       returning id`,
      [
        factoryId,
        `solarshift-${window.code.toLowerCase()}-historical-2026`,
        window.start,
        window.end,
        json({ objective: 'minimize_modeled_aperc_energy_cost' }),
        json({ machine_non_overlap: true, dependencies: 'zero_lag_finish_to_start' }),
        json(requestPayload),
        json({ adapter: 'solarshift-historical-cp-sat', schema: 'solarshift-historical-scenario-v1' }),
      ],
    )
    const requestId = request.rows[0].id
    const processById = new Map(scenarioProcesses.map((process) => [process.id, process]))
    const baselineEntries = solution.baseline.entries.map((entry, index) =>
      enrichSolverEntry(entry, processById.get(entry.process_id), index, window))
    const optimizedEntries = solution.optimized.entries.map((entry, index) =>
      enrichSolverEntry(entry, processById.get(entry.process_id), index, window))
    const optimizedTotals = solution.optimized.metrics
    const optimizedCost = decimalFixed(
      (BigInt(optimizedTotals.cost_numerator) * 1_000_000n +
        BigInt(optimizedTotals.cost_denominator) / 2n) /
        BigInt(optimizedTotals.cost_denominator),
      1_000_000,
      6,
    )
    const resultPayload = {
      ...solution,
      scenario: manifest,
      assumptions: SHARED_ASSUMPTIONS,
      objective_definition: 'minimize grid-energy cost with minute-local APERC kVAh rates and modeled PF=0.95',
      cost_label: SHARED_ASSUMPTIONS.cost_label,
      cost_exact: {
        numerator: optimizedTotals.cost_numerator,
        denominator: optimizedTotals.cost_denominator,
        display_scale: 6,
      },
      baseline: { ...solution.baseline, entries: baselineEntries },
      optimized: { ...solution.optimized, entries: optimizedEntries },
    }
    const result = await client.query(
      `insert into public.optimization_results
         (factory_id, optimization_request_id, status, objective_value, total_energy_cost,
          total_energy_kwh, peak_demand_kw, solution, metrics)
       values ($1,$2,'succeeded',$3,$3,$4,$5,$6::jsonb,$7::jsonb)
       returning id`,
      [
        factoryId,
        requestId,
        optimizedCost,
        optimizedTotals.total_energy_units
          ? decimalFixed(BigInt(optimizedTotals.total_energy_units), ENERGY_SCALE, 6)
          : '0.000000',
        peakPowerKw(solution.optimized.entries, processById),
        json(resultPayload),
        json({
          solver: 'OR-Tools CP-SAT',
          status: solution.status,
          regime: window.code,
          energy_scale: ENERGY_SCALE,
          cost_denominator: optimizedTotals.cost_denominator,
          maximum_cost_units_checked: solution.maximum_cost_units_checked,
          baseline: solution.baseline.metrics,
          optimized: solution.optimized.metrics,
          total_tariff_energy_cost_label: SHARED_ASSUMPTIONS.cost_label,
        }),
      ],
    )
    const resultId = result.rows[0].id
    const baselineSchedule = await persistSchedule(client, {
      factoryId,
      requestId,
      resultId,
      kind: 'baseline',
      horizonStart: window.start,
      horizonEnd: window.end,
      entries: solution.baseline.entries,
      processesById: processById,
      window,
    })
    const optimizedSchedule = await persistSchedule(client, {
      factoryId,
      requestId,
      resultId,
      kind: 'optimized',
      horizonStart: window.start,
      horizonEnd: window.end,
      entries: solution.optimized.entries,
      processesById: processById,
      window,
    })
    await client.query(
      `update public.optimization_requests
          set status='succeeded',
              adapter_metadata = adapter_metadata || $3::jsonb
        where id=$1 and factory_id=$2`,
      [
        requestId,
        factoryId,
        json({
          result_id: resultId,
          schedule_ids: [baselineSchedule.id, optimizedSchedule.id],
          solver_status: solution.status,
          persistence_status: 'succeeded',
        }),
      ],
    )
    const factoryCounts = await client.query(
      `select
         (select count(*)::int from public.machines where factory_id=$1) as machines,
         (select count(*)::int from public.processes where factory_id=$1) as processes,
         (select count(*)::int from public.process_dependencies where factory_id=$1) as dependencies,
         (select count(*)::int from public.energy_data where factory_id=$1) as energy_rows,
         (select count(*)::int from public.aperc_scenario_tariffs where factory_id=$1) as tariff_rows,
         (select count(*)::int from public.optimization_requests where factory_id=$1) as requests,
         (select count(*)::int from public.optimization_results where factory_id=$1) as results,
         (select count(*)::int from public.schedules where factory_id=$1) as schedules,
         (select count(*)::int from public.schedule_entries e join public.schedules s on s.id=e.schedule_id where s.factory_id=$1) as schedule_entries`,
      [factoryId],
    )
    const counts = factoryCounts.rows[0]
    assert(
      counts.machines === 6 &&
        counts.processes === 8 &&
        counts.dependencies === 7 &&
        counts.energy_rows === 672 &&
        counts.tariff_rows === 6 &&
        counts.requests === 1 &&
        counts.results === 1 &&
        counts.schedules === 2 &&
        counts.schedule_entries === 16,
      'Persisted scenario row counts failed their in-transaction completeness check.',
    )
    await client.query('commit')
    return {
      factory_id: factoryId,
      request_id: requestId,
      result_id: resultId,
      baseline_schedule: baselineSchedule,
      optimized_schedule: optimizedSchedule,
      persisted_counts: counts,
      solver_status: solution.status,
      source_total_wh_m2: manifest.nasa_total_wh_m2,
    }
  } catch (error) {
    await client.query('rollback')
    throw error
  } finally {
    client.release()
  }
}

async function main() {
  assert(process.env.SUPABASE_DB_URL, 'SUPABASE_DB_URL is required; no credentials are printed by this script.')
  const migrationSql = await readFile(migrationPath, 'utf8')
  const sourceData = await Promise.all(WINDOWS.map(async (window) => ({
    window,
    fetched: await fetchAndValidateWindow(window),
  })))
  const database = new Pool({
    connectionString: process.env.SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15_000,
    query_timeout: 120_000,
  })
  try {
    const migrationState = await inspectMigrationHistory(database)
    const canonical = await loadCanonicalManufacturing(database)
    if (process.argv.includes('--dry-run')) {
      for (const { window, fetched } of sourceData) {
        const { solution } = runHistoricalSolver(
          window,
          fetched,
          canonical.processes,
          canonical.dependencies,
          expectedTariffRows(window),
        )
        console.log(JSON.stringify({
          mode: 'dry-run; no Supabase writes performed',
          migration_state: migrationState.state,
          scenario: window.code,
          manifest: expectedManifest(window, fetched),
          solver_status: solution.status,
          baseline: solution.baseline.metrics,
          optimized: solution.optimized.metrics,
          integer_bounds: {
            energy_scale: solution.energy_scale,
            cost_denominator: solution.cost_scale,
            maximum_cost_units_checked: solution.maximum_cost_units_checked,
            signed_64_bit_limit: String((1n << 63n) - 1n),
          },
        }))
      }
      return
    }
    const appliedMigrationState = await applyScenarioMigration(database, migrationSql, migrationState)
    for (const { window, fetched } of sourceData) {
      const outcome = await importScenario(database, canonical, window, fetched)
      console.log(JSON.stringify({
        migration_state: appliedMigrationState,
        scenario: window.code,
        manifest: expectedManifest(window, fetched),
        ...outcome,
      }))
    }
  } finally {
    await database.end()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
