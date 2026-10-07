import { NotFoundError, InternalError } from '../errors'
import { getServiceClient } from '../supabase'

const SCENARIOS = {
  hgd: {
    factoryId: 'd73e31ea-8ed7-440f-870f-5bd9ea6ab0e1',
    slug: 'solarshift-hgd-historical',
    code: 'HGD',
    start: '2026-03-11T11:00:00Z',
    end: '2026-03-18T11:00:00Z',
    peakPrice: '7.80',
  },
  lgd: {
    factoryId: 'eabac903-8d02-4e90-b236-5bbbc557eea5',
    slug: 'solarshift-lgd-historical',
    code: 'LGD',
    start: '2026-01-11T12:00:00Z',
    end: '2026-01-18T12:00:00Z',
    peakPrice: '7.30',
  },
} as const

export type PublicSolarShiftCode = keyof typeof SCENARIOS

function isPublicSolarShiftCode(code: string): code is PublicSolarShiftCode {
  return code === 'hgd' || code === 'lgd'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function rows(value: unknown, label: string): Record<string, unknown>[] {
  if (!Array.isArray(value) || !value.every(isRecord)) {
    throw new InternalError(`Persisted SolarShift ${label} data is invalid.`)
  }
  return value
}

function throwQueryError(error: { message: string } | null, label: string): void {
  if (error) throw new InternalError(`Could not load persisted SolarShift ${label}.`)
}

interface ExactDecimal {
  coefficient: bigint
  scale: number
}

function exactDecimal(value: unknown, label: string): ExactDecimal {
  if (typeof value !== 'string') {
    throw new InternalError(`Persisted SolarShift ${label} must be transported as a decimal string.`)
  }
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value)
  if (!match) throw new InternalError(`Persisted SolarShift ${label} is not a plain decimal value.`)
  const fraction = match[3] ?? ''
  return {
    coefficient: BigInt(`${match[1]}${match[2]}${fraction}`),
    scale: fraction.length,
  }
}

function equalDecimal(left: ExactDecimal, right: ExactDecimal): boolean {
  const scale = Math.max(left.scale, right.scale)
  return left.coefficient * 10n ** BigInt(scale - left.scale) ===
    right.coefficient * 10n ** BigInt(scale - right.scale)
}

function sumDecimals(values: ExactDecimal[]): ExactDecimal {
  const scale = Math.max(0, ...values.map((value) => value.scale))
  return {
    scale,
    coefficient: values.reduce(
      (sum, value) => sum + value.coefficient * 10n ** BigInt(scale - value.scale),
      0n,
    ),
  }
}

function decimalString(value: ExactDecimal): string {
  const negative = value.coefficient < 0n
  const digits = (negative ? -value.coefficient : value.coefficient).toString()
  const padded = digits.padStart(value.scale + 1, '0')
  const whole = value.scale ? padded.slice(0, -value.scale) : padded
  const fraction = value.scale ? `.${padded.slice(-value.scale)}` : ''
  return `${negative ? '-' : ''}${whole}${fraction}`
}

function equalsSolarFormula(resource: ExactDecimal, modeledPv: ExactDecimal): boolean {
  return resource.coefficient * 6n * 10n ** BigInt(modeledPv.scale) ===
    modeledPv.coefficient * 25n * 10n ** BigInt(resource.scale)
}

function timestampMillis(value: unknown, label: string): number {
  if (typeof value !== 'string') throw new InternalError(`Persisted SolarShift ${label} is invalid.`)
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new InternalError(`Persisted SolarShift ${label} is invalid.`)
  return parsed
}

function validateManifest(manifest: Record<string, unknown>, code: PublicSolarShiftCode): void {
  const expected = SCENARIOS[code]
  const coordinate = isRecord(manifest.coordinate) ? manifest.coordinate : {}
  const assumptions = isRecord(manifest.assumptions) ? manifest.assumptions : {}
  if (
    manifest.scenario_code !== expected.code ||
    manifest.selected_utc_start !== expected.start ||
    manifest.selected_utc_end_exclusive !== expected.end ||
    manifest.source !== 'NASA POWER' ||
    manifest.parameter !== 'ALLSKY_SFC_SW_DWN' ||
    manifest.units !== 'Wh/m^2' ||
    typeof manifest.source_product !== 'string' || !manifest.source_product.includes('SYN1DEG') ||
    coordinate.latitude !== 16.5 || coordinate.longitude !== 80.5 ||
    manifest.hourly_observations !== 168 ||
    manifest.missing_observations !== 0 ||
    manifest.fill_observations !== 0 ||
    assumptions.pv_capacity_kwp !== '300' ||
    assumptions.performance_ratio !== '0.80' ||
    assumptions.geometry !== 'HORIZONTAL RESOURCE PROXY — NO TRANSPOSITION' ||
    assumptions.timestamp_assumption !== 'NASA hourly timestamp treated as the beginning of the represented hour.' ||
    assumptions.power_factor !== '0.95' ||
    assumptions.power_factor_ratio !== '19/20' ||
    assumptions.subhourly_profile !== 'MODELED FLAT-WITHIN-HOUR 15-MINUTE PROFILE'
  ) {
    throw new InternalError('Persisted SolarShift provenance or approved scenario assumptions are invalid.')
  }
}

function validateTariffs(tariffs: Record<string, unknown>[], code: PublicSolarShiftCode): void {
  const expected = [
    ['off_peak', '00:00', '06:00', '5.55'],
    ['peak', '06:00', '10:00', SCENARIOS[code].peakPrice],
    ['off_peak', '10:00', '15:00', '5.55'],
    ['normal', '15:00', '18:00', '6.30'],
    ['peak', '18:00', '22:00', SCENARIOS[code].peakPrice],
    ['normal', '22:00', '00:00', '6.30'],
  ] as const
  const remaining = [...tariffs]
  for (const [band, start, end, price] of expected) {
    const index = remaining.findIndex((tariff) =>
      tariff.regime === SCENARIOS[code].code &&
      tariff.band === band &&
      String(tariff.start_time).slice(0, 5) === start &&
      String(tariff.end_time).slice(0, 5) === end &&
      tariff.currency === 'INR' &&
      tariff.energy_basis === 'kVAh' &&
      equalDecimal(exactDecimal(tariff.energy_price, 'APERC tariff rate'), exactDecimal(price, 'approved tariff rate')),
    )
    if (index === -1) throw new InternalError('Persisted SolarShift APERC tariff windows do not match the approved regime.')
    remaining.splice(index, 1)
  }
  if (remaining.length) throw new InternalError('Persisted SolarShift APERC tariff rows contain unexpected windows.')
}

export async function getPublicSolarShiftScenario(code: string) {
  if (!isPublicSolarShiftCode(code)) throw new NotFoundError('SolarShift scenario', code)
  const scenarioCode = code
  const allowed = SCENARIOS[scenarioCode]
  const client = getServiceClient()

  const [factoryResult, machineResult, processResult, tariffResult, energyResult, resultResult, scheduleResult] =
    await Promise.all([
      client.from('factories')
        .select('id, slug, name, timezone, metadata')
        .eq('id', allowed.factoryId)
        .eq('slug', allowed.slug)
        .eq('is_active', true)
        .maybeSingle(),
      client.from('machines')
        .select('id, factory_id, slug, name, rated_power_kw')
        .eq('factory_id', allowed.factoryId)
        .order('slug'),
      client.from('processes')
        .select('id, factory_id, slug, name, duration_minutes, machine_id, power_requirement_kw')
        .eq('factory_id', allowed.factoryId)
        .order('slug'),
      client.from('aperc_scenario_tariffs')
        .select('id, regime, band, currency, energy_basis, energy_price::text, start_time, end_time, effective_from, effective_to, effective_months')
        .eq('factory_id', allowed.factoryId)
        .order('start_time'),
      client.from('energy_data')
        .select('id, recorded_at, interval_minutes, generation_kwh::text, source, metadata')
        .eq('factory_id', allowed.factoryId)
        .order('recorded_at'),
      client.from('optimization_results')
        .select('id, status, total_energy_cost, total_energy_kwh, metrics')
        .eq('factory_id', allowed.factoryId)
        .order('created_at'),
      client.from('schedules')
        .select('id, factory_id, name, version, status, horizon_start, horizon_end, optimization_request_id, optimization_result_id, total_energy_cost, total_energy_kwh, metadata')
        .eq('factory_id', allowed.factoryId)
        .in('name', ['SolarShift historical baseline', 'SolarShift historical optimized'])
        .order('name'),
    ])

  throwQueryError(factoryResult.error, 'factory')
  throwQueryError(machineResult.error, 'machine')
  throwQueryError(processResult.error, 'process')
  throwQueryError(tariffResult.error, 'tariff')
  throwQueryError(energyResult.error, 'energy')
  throwQueryError(resultResult.error, 'optimization result')
  throwQueryError(scheduleResult.error, 'schedule')

  const factory = factoryResult.data
  if (!isRecord(factory) || factory.id !== allowed.factoryId || factory.slug !== allowed.slug) {
    throw new NotFoundError('SolarShift scenario', scenarioCode)
  }
  const metadata = isRecord(factory.metadata) ? factory.metadata : {}
  const manifest = isRecord(metadata.solarshift_historical) ? metadata.solarshift_historical : null
  if (!manifest) {
    throw new InternalError('Persisted SolarShift scenario provenance does not match its allowlisted identity.')
  }
  validateManifest(manifest, scenarioCode)

  const machines = rows(machineResult.data, 'machine')
  const processes = rows(processResult.data, 'process')
  const tariffs = rows(tariffResult.data, 'tariff')
  const storedEnergy = rows(energyResult.data, 'energy')
  const results = rows(resultResult.data, 'optimization result')
  const schedules = rows(scheduleResult.data, 'schedule')

  if (
    machines.length !== 6 || processes.length !== 8 || tariffs.length !== 6 ||
    storedEnergy.length !== 672 || results.length !== 1 || schedules.length !== 2
  ) {
    throw new InternalError('Persisted SolarShift scenario is incomplete; public data was not served.')
  }
  if (
    results[0]?.status !== 'succeeded' ||
    !schedules.some((schedule) => schedule.name === 'SolarShift historical baseline') ||
    !schedules.some((schedule) => schedule.name === 'SolarShift historical optimized')
  ) {
    throw new InternalError('Persisted SolarShift optimization result or schedule identity is invalid.')
  }
  validateTariffs(tariffs, scenarioCode)
  if (machines.some((machine) => machine.factory_id !== allowed.factoryId) ||
      processes.some((process) => process.factory_id !== allowed.factoryId) ||
      schedules.some((schedule) => schedule.factory_id !== allowed.factoryId)) {
    throw new InternalError('Persisted SolarShift scenario contains records outside its allowlisted factory.')
  }

  const scheduleIds = schedules.map((schedule) => schedule.id)
  const entryResult = await client.from('schedule_entries')
    .select('id, schedule_id, machine_id, process_id, production_order_id, starts_at, ends_at, power_kw, energy_kwh, cost, sequence, metadata')
    .in('schedule_id', scheduleIds)
    .order('starts_at')
  throwQueryError(entryResult.error, 'schedule entry')
  const entries = rows(entryResult.data, 'schedule entry')
  if (entries.length !== 16 || schedules.some((schedule) =>
    entries.filter((entry) => entry.schedule_id === schedule.id).length !== 8,
  )) {
    throw new InternalError('Persisted SolarShift scenario does not contain its expected schedule entries.')
  }
  const processNames = new Map(processes.map((process) => [process.id, process.name]))
  const machineNames = new Map(machines.map((machine) => [machine.id, machine.name]))
  const enrichedEntries = entries.map((entry) => {
    if (entry.production_order_id !== null ||
        !processNames.has(entry.process_id) ||
        !machineNames.has(entry.machine_id) ||
        !scheduleIds.includes(entry.schedule_id)) {
      throw new InternalError('Persisted SolarShift schedule entry is outside its allowlisted scenario.')
    }
    return {
      ...entry,
      process_name: processNames.get(entry.process_id),
      machine_name: machineNames.get(entry.machine_id),
    }
  })

  const startMs = timestampMillis(manifest.selected_utc_start, 'scenario start')
  const endMs = timestampMillis(manifest.selected_utc_end_exclusive, 'scenario end')
  if (endMs - startMs !== 168 * 60 * 60_000) {
    throw new InternalError('Persisted SolarShift UTC window is not exactly 168 hours.')
  }
  const hourlyByTimestamp = new Map<string, {
    timestamp_utc: string
    resource_wh_m2: string
    expected_modeled_pv_kwh: string
    quarter_values: ExactDecimal[]
    quarter_timestamps: number[]
  }>()
  const resourceValues: ExactDecimal[] = []
  const energyRows = storedEnergy.map((energy, index) => {
    const rowMetadata = isRecord(energy.metadata) ? energy.metadata : {}
    const resource = rowMetadata.nasa_resource_wh_m2
    const hourTimestamp = rowMetadata.nasa_observation_timestamp_utc
    const modeledHourly = rowMetadata.modeled_hourly_pv_kwh
    const assumptions = isRecord(rowMetadata.assumptions) ? rowMetadata.assumptions : {}
    const provenance = isRecord(rowMetadata.provenance) ? rowMetadata.provenance : {}
    const expectedRecordedAt = startMs + index * 15 * 60_000
    const expectedHourAt = startMs + Math.floor(index / 4) * 60 * 60_000
    if (
      energy.source !== 'modeled_nasa_power' ||
      Number(energy.interval_minutes) !== 15 ||
      timestampMillis(energy.recorded_at, 'energy interval timestamp') !== expectedRecordedAt ||
      typeof hourTimestamp !== 'string' ||
      timestampMillis(hourTimestamp, 'NASA observation timestamp') !== expectedHourAt ||
      typeof resource !== 'string' ||
      typeof modeledHourly !== 'string' ||
      rowMetadata.transformation !== 'MODELED FLAT-WITHIN-HOUR 15-MINUTE PROFILE' ||
      assumptions.pv_capacity_kwp !== '300' ||
      assumptions.performance_ratio !== '0.80' ||
      assumptions.latitude !== 16.5 ||
      assumptions.longitude !== 80.5 ||
      provenance.source !== 'NASA POWER' ||
      provenance.parameter !== 'ALLSKY_SFC_SW_DWN'
    ) {
      throw new InternalError('Persisted SolarShift energy row lacks its source or modeled provenance.')
    }
    const resourceDecimal = exactDecimal(resource, 'NASA resource value')
    const modeledDecimal = exactDecimal(modeledHourly, 'modeled hourly PV value')
    const generationDecimal = exactDecimal(energy.generation_kwh, '15-minute modeled PV value')
    if (
      !equalsSolarFormula(resourceDecimal, modeledDecimal) ||
      !equalDecimal(generationDecimal, exactDecimal(rowMetadata.modeled_15_minute_generation_kwh, 'modeled 15-minute PV provenance'))
    ) {
      throw new InternalError('Persisted SolarShift PV values do not match their exact scenario provenance.')
    }
    let hourly = hourlyByTimestamp.get(hourTimestamp)
    if (!hourly) {
      resourceValues.push(resourceDecimal)
      hourly = {
        timestamp_utc: hourTimestamp,
        resource_wh_m2: resource,
        expected_modeled_pv_kwh: modeledHourly,
        quarter_values: [],
        quarter_timestamps: [],
      }
    }
    if (hourly.resource_wh_m2 !== resource || hourly.expected_modeled_pv_kwh !== modeledHourly) {
      throw new InternalError('Persisted SolarShift hourly energy provenance is inconsistent.')
    }
    hourly.quarter_values.push(generationDecimal)
    hourly.quarter_timestamps.push(expectedRecordedAt)
    hourlyByTimestamp.set(hourTimestamp, hourly)
    return {
      id: energy.id,
      recorded_at: energy.recorded_at,
      interval_minutes: energy.interval_minutes,
      generation_kwh: energy.generation_kwh,
      source: energy.source,
    }
  })
  const hourlyProfile = [...hourlyByTimestamp.values()].sort((left, right) =>
    left.timestamp_utc.localeCompare(right.timestamp_utc),
  )
  const invalidHour = hourlyProfile.some((hour) => {
    const total = sumDecimals(hour.quarter_values)
    const hourTimestamp = timestampMillis(hour.timestamp_utc, 'NASA observation timestamp')
    return hour.quarter_values.length !== 4 ||
      !equalDecimal(total, exactDecimal(hour.expected_modeled_pv_kwh, 'modeled hourly PV value')) ||
      hour.quarter_timestamps.some((at, index) => at !== hourTimestamp + index * 15 * 60_000)
  })
  if (
    hourlyProfile.length !== 168 ||
    invalidHour ||
    !equalDecimal(sumDecimals(resourceValues), exactDecimal(manifest.nasa_total_wh_m2, 'NASA resource total')) ||
    !equalDecimal(
      sumDecimals(hourlyProfile.map((hour) => exactDecimal(hour.expected_modeled_pv_kwh, 'modeled PV total'))),
      exactDecimal(manifest.modeled_pv_total_kwh, 'modeled PV total'),
    )
  ) {
    throw new InternalError('Persisted SolarShift energy rows do not form 168 complete modeled hourly profiles.')
  }

  const requestResult = await client.from('optimization_requests')
    .select('id, factory_id')
    .eq('factory_id', allowed.factoryId)
    .order('created_at')
  throwQueryError(requestResult.error, 'optimization request')
  const requests = rows(requestResult.data, 'optimization request')
  if (requests.length !== 1 || requests[0]?.factory_id !== allowed.factoryId ||
      schedules.some((schedule) => schedule.optimization_request_id !== requests[0]?.id ||
        schedule.optimization_result_id !== results[0]?.id)) {
    throw new InternalError('Persisted SolarShift scenario does not contain its expected optimization request.')
  }

  return {
    factory: {
      id: factory.id,
      slug: factory.slug,
      name: factory.name,
      timezone: factory.timezone,
    },
    manifest,
    energyRows,
    hourlyProfile: hourlyProfile.map(({
      quarter_values,
      quarter_timestamps: _quarterTimestamps,
      expected_modeled_pv_kwh: _expectedModeledPv,
      ...hour
    }) => ({
      ...hour,
      modeled_pv_kwh: decimalString(sumDecimals(quarter_values)),
    })),
    tariffs,
    requests,
    results,
    schedules,
    entries: enrichedEntries,
    processes: processes.map((process) => ({
      id: process.id,
      name: process.name,
      slug: process.slug,
      duration_minutes: process.duration_minutes,
      machine_id: process.machine_id,
      power_requirement_kw: process.power_requirement_kw,
    })),
    machines: machines.map((machine) => ({
      id: machine.id,
      factory_id: allowed.factoryId,
      name: machine.name,
      slug: machine.slug,
      rated_power_kw: machine.rated_power_kw,
    })),
  }
}
