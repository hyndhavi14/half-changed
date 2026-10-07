import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { FactoryTwin } from '../twin'
import { mapBackendMachine, mapBackendSchedule } from '../data/providers/ApiMachineDataProvider'
import type { MachineDataProvider, ScheduleSnapshot } from '../data/types'
import { useEnergyStore } from '../state/energyStore'

const API_BASE_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '')
const FACTORIES = {
  hgd: {
    id: 'd73e31ea-8ed7-440f-870f-5bd9ea6ab0e1',
    slug: 'solarshift-hgd-historical',
    code: 'HGD',
  },
  lgd: {
    id: 'eabac903-8d02-4e90-b236-5bbbc557eea5',
    slug: 'solarshift-lgd-historical',
    code: 'LGD',
  },
} as const

type ScenarioCode = keyof typeof FACTORIES
type RecordValue = Record<string, unknown>
type ScheduleKind = 'baseline' | 'optimized'

interface PublicScenario {
  factory: RecordValue
  manifest: RecordValue
  hourlyProfile: RecordValue[]
  schedules: RecordValue[]
  entries: RecordValue[]
  machines: RecordValue[]
}

function isRecord(value: unknown): value is RecordValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function object(value: unknown): RecordValue {
  return isRecord(value) ? value : {}
}

function arrayOfRecords(value: unknown, field: string): RecordValue[] {
  if (!Array.isArray(value) || !value.every(isRecord)) {
    throw new Error(`Public SolarShift response has invalid ${field}.`)
  }
  return value
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Public SolarShift response has invalid ${field}.`)
  }
  return value
}

async function fetchScenario(code: ScenarioCode): Promise<PublicScenario> {
  const response = await fetch(`${API_BASE_URL}/api/v1/public/solarshift/historical/${code}`, {
    headers: { Accept: 'application/json' },
  })
  let payload: unknown
  try {
    payload = await response.json()
  } catch (failure) {
    throw new Error('The public SolarShift API returned invalid JSON.', { cause: failure })
  }
  if (!response.ok) {
    const message = isRecord(payload) && isRecord(payload.error) &&
      typeof payload.error.message === 'string'
      ? payload.error.message
      : `The public SolarShift API returned ${response.status}.`
    throw new Error(message)
  }
  if (!isRecord(payload) || !isRecord(payload.data)) {
    throw new Error('The public SolarShift API returned an invalid scenario envelope.')
  }
  const data = payload.data
  const expected = FACTORIES[code]
  const factory = object(data.factory)
  const manifest = object(data.manifest)
  if (factory.id !== expected.id || factory.slug !== expected.slug ||
      manifest.scenario_code !== expected.code) {
    throw new Error('The public API returned a scenario outside the approved SolarShift allowlist.')
  }
  return {
    factory,
    manifest,
    hourlyProfile: arrayOfRecords(data.hourlyProfile, 'hourly solar profile'),
    schedules: arrayOfRecords(data.schedules, 'schedules'),
    entries: arrayOfRecords(data.entries, 'schedule entries'),
    machines: arrayOfRecords(data.machines, 'machines'),
  }
}

class PublicSolarShiftProvider implements MachineDataProvider {
  constructor(
    private readonly scenario: PublicScenario,
    private readonly scheduleKind: ScheduleKind,
  ) {}

  async getMachines() {
    const factoryId = requiredText(this.scenario.factory.id, 'factory UUID')
    return this.scenario.machines.map((machine) =>
      mapBackendMachine(machine, factoryId),
    )
  }

  async getMachine(id: string) {
    return (await this.getMachines()).find((machine) => machine.machine_id === id)
  }

  async getSchedule(): Promise<ScheduleSnapshot> {
    const expectedName = this.scheduleKind === 'optimized'
      ? 'SolarShift historical optimized'
      : 'SolarShift historical baseline'
    const stored = this.scenario.schedules.find((schedule) => schedule.name === expectedName)
    if (!stored) throw new Error(`Persisted ${expectedName} is unavailable.`)
    const scheduleId = requiredText(stored.id, 'schedule UUID')
    const schedule = {
      ...stored,
      entries: this.scenario.entries.filter((entry) => entry.schedule_id === scheduleId),
    }
    return mapBackendSchedule(
      schedule,
      requiredText(this.scenario.factory.id, 'factory UUID'),
      scheduleId,
    )
  }
}

function display(value: unknown, fallback = '—'): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

function kwh(value: unknown): string {
  const number = Number(value)
  return Number.isFinite(number) ? `${number.toFixed(4)} kWh` : '—'
}

function HistoricalReplayPanel({
  code,
  scenario,
  scheduleKind,
}: {
  code: ScenarioCode
  scenario: PublicScenario
  scheduleKind: ScheduleKind
}) {
  const factory = FACTORIES[code]
  const scheduleName = scheduleKind === 'optimized'
    ? 'SolarShift historical optimized'
    : 'SolarShift historical baseline'
  const schedule = scenario.schedules.find((row) => row.name === scheduleName)
  const scheduleMetadata = object(schedule?.metadata)
  const manifest = scenario.manifest
  const values = scenario.hourlyProfile.map((hour) => Number(hour.resource_wh_m2))
  const maximum = Math.max(...values, 1)

  return (
    <aside className="bm-historical-replay" aria-label={`${factory.code} historical replay data`}>
      <p className="bm-historical-replay__eyebrow">HISTORICAL REPLAY · MODELED OUTPUTS</p>
      <h2>{factory.code} historical replay</h2>
      <p className="bm-historical-replay__schedule">{scheduleName}</p>
      <dl>
        <div>
          <dt>REAL EXTERNAL SOURCE</dt>
          <dd>NASA POWER · ALLSKY_SFC_SW_DWN · {display(manifest.hourly_observations)} hourly observations</dd>
        </div>
        <div>
          <dt>Regional scenario point, not verified factory location</dt>
          <dd>{display(manifest.selected_utc_start)} – {display(manifest.selected_utc_end_exclusive)} UTC</dd>
        </div>
        <div>
          <dt>Historical NASA solar resource</dt>
          <dd>{display(manifest.nasa_total_wh_m2)} Wh/m²</dd>
        </div>
        <div>
          <dt>MODELED PV GENERATION</dt>
          <dd>{kwh(manifest.modeled_pv_total_kwh)} · not measured plant generation</dd>
        </div>
        <div>
          <dt>MODELED SOLAR ALLOCATION</dt>
          <dd>{kwh(scheduleMetadata.modeled_solar_kwh)}</dd>
        </div>
        <div>
          <dt>MODELED GRID ENERGY</dt>
          <dd>{kwh(scheduleMetadata.modeled_grid_kwh)}</dd>
        </div>
      </dl>
      <div
        className="bm-historical-replay__profile"
        role="img"
        aria-label="168 hourly NASA POWER solar resource values; each bar represents one UTC hour"
      >
        {scenario.hourlyProfile.map((hour, index) => {
          const resource = Number(hour.resource_wh_m2)
          const height = Number.isFinite(resource) ? Math.max(2, (resource / maximum) * 100) : 2
          const style = { '--solar-resource-height': `${height}%` } as CSSProperties
          return (
            <span
              key={String(hour.timestamp_utc ?? index)}
              style={style}
              title={`${String(hour.timestamp_utc)} · ${String(hour.resource_wh_m2)} Wh/m² · ${String(hour.modeled_pv_kwh)} modeled kWh`}
            />
          )
        })}
      </div>
      <p className="bm-historical-replay__note">
        NASA solar resource and modeled PV are historical scenario inputs. The schedule is planned,
        and the 3D factory layout is illustrative—not a verified physical plant. Machine status and
        current electrical telemetry are not reported.
      </p>
    </aside>
  )
}

function PublicReplayError({ message }: { message: string }): ReactNode {
  return <main className="bm-public-replay-error" role="alert">{message}</main>
}

export function PublicSolarShiftReplay({
  code,
  scheduleKind,
}: {
  code: ScenarioCode
  scheduleKind: ScheduleKind
}) {
  const [scenario, setScenario] = useState<PublicScenario | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    useEnergyStore.getState().setSolar(null)
    void fetchScenario(code)
      .then((loaded) => {
        if (active) setScenario(loaded)
      })
      .catch((failure: unknown) => {
        if (active) setError(failure instanceof Error ? failure.message : String(failure))
      })
    return () => {
      active = false
    }
  }, [code])

  const provider = useMemo(
    () => scenario ? new PublicSolarShiftProvider(scenario, scheduleKind) : null,
    [scenario, scheduleKind],
  )

  if (error) return <PublicReplayError message={error} />
  if (!scenario || !provider) {
    return <main className="bm-public-replay-error" role="status">Loading persisted SolarShift historical data…</main>
  }

  return (
    <div className="bm-public-replay">
      <FactoryTwin
        provider={provider}
        initialView="reset"
        simulate={false}
        readOnly
        dataLabel="MODELED HISTORICAL REPLAY · NOT LIVE TELEMETRY"
      >
        <HistoricalReplayPanel code={code} scenario={scenario} scheduleKind={scheduleKind} />
      </FactoryTwin>
    </div>
  )
}

export function isPublicSolarShiftCode(value: string): value is ScenarioCode {
  return Object.hasOwn(FACTORIES, value)
}

export function isPublicSolarShiftSchedule(value: string): value is ScheduleKind {
  return value === 'baseline' || value === 'optimized'
}
