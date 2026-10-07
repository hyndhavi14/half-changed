import { useEffect, useState } from 'react'
import styles from './SolarShiftHistoricalPage.module.css'

type JsonRecord = Record<string, unknown>
type ScenarioData = {
  factory: JsonRecord
  manifest: JsonRecord
  energyRows: JsonRecord[]
  hourlyProfile: JsonRecord[]
  tariffs: JsonRecord[]
  requests: JsonRecord[]
  results: JsonRecord[]
  schedules: JsonRecord[]
  entries: JsonRecord[]
  processes: JsonRecord[]
  machines: JsonRecord[]
}

const SCENARIO_SLUGS = ['solarshift-hgd-historical', 'solarshift-lgd-historical']
const API_BASE_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '')
const FACTORY_3D_URL = import.meta.env.VITE_FACTORY_3D_URL ?? 'http://localhost:5174'
const REQUIRED_LABELS = [
  'REAL EXTERNAL SOURCE — NASA POWER',
  'MODELED PV GENERATION',
  'MODELED FLAT-WITHIN-HOUR 15-MINUTE PROFILE',
  'MODELED OPTIMIZATION OUTPUT',
  'SYNTHETIC/SCENARIO DATA — Chocolate manufacturing model',
  'NOT MEASURED — plant electricity/solar telemetry',
  'APERC DEMAND CHARGE EXCLUDED',
  'APERC MINIMUM-BILLING RULES EXCLUDED',
]

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function records(value: unknown, label: string): JsonRecord[] {
  if (!Array.isArray(value) || !value.every(isRecord)) {
    throw new Error(`Supabase returned invalid ${label} data.`)
  }
  return value
}

function text(value: unknown, fallback = '—'): string {
  if (typeof value === 'string' && value.length > 0) return value
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return fallback
}

function object(value: unknown): JsonRecord {
  return isRecord(value) ? value : {}
}

function showKwh(value: unknown): string {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? `${parsed.toFixed(4)} kWh` : '—'
}

function showInr(value: unknown): string {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed)
    ? `₹${parsed.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`
    : '—'
}

function localTimestamp(value: unknown): string {
  if (typeof value !== 'string') return '—'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
    hour12: false,
  }).format(date)
}

async function loadScenario(code: string): Promise<ScenarioData> {
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
  return {
    factory: object(data.factory),
    manifest: object(data.manifest),
    energyRows: records(data.energyRows, 'modeled energy'),
    hourlyProfile: records(data.hourlyProfile, 'hourly solar profile'),
    tariffs: records(data.tariffs, 'APERC tariff'),
    requests: records(data.requests, 'optimization request'),
    results: records(data.results, 'optimization result'),
    schedules: records(data.schedules, 'schedule'),
    entries: records(data.entries, 'schedule entry'),
    processes: records(data.processes, 'process'),
    machines: records(data.machines, 'machine'),
  }
}

async function loadScenarios(): Promise<ScenarioData[]> {
  const loaded = await Promise.all(SCENARIO_SLUGS.map((slug) =>
    loadScenario(slug === SCENARIO_SLUGS[0] ? 'hgd' : 'lgd'),
  ))
  return loaded.sort((left, right) =>
    text(left.manifest.scenario_code).localeCompare(text(right.manifest.scenario_code)),
  )
}

function scheduleFor(scenario: ScenarioData, kind: 'baseline' | 'optimized'): JsonRecord | undefined {
  const expectedName = kind === 'baseline'
    ? 'SolarShift historical baseline'
    : 'SolarShift historical optimized'
  return scenario.schedules.find((schedule) => schedule.name === expectedName)
}

function scheduleEntries(scenario: ScenarioData, schedule: JsonRecord | undefined): JsonRecord[] {
  if (!schedule || typeof schedule.id !== 'string') return []
  return scenario.entries
    .filter((entry) => entry.schedule_id === schedule.id)
    .sort((left, right) => String(left.starts_at).localeCompare(String(right.starts_at)))
}

function ScheduleCard({
  scenario,
  kind,
}: {
  scenario: ScenarioData
  kind: 'baseline' | 'optimized'
}) {
  const schedule = scheduleFor(scenario, kind)
  const entries = scheduleEntries(scenario, schedule)
  const metadata = object(schedule?.metadata)
  const processNames = new Map(scenario.processes.map((process) => [process.id, text(process.name)]))
  const machineNames = new Map(scenario.machines.map((machine) => [machine.id, text(machine.name)]))
  return (
    <section className={styles.scheduleCard} aria-label={`${kind} schedule`}>
      <div className={styles.scheduleHeading}>
        <h3>{kind === 'baseline' ? 'Baseline schedule' : 'SolarShift optimized schedule'}</h3>
        <span>{entries.length} process entries</span>
      </div>
      <dl className={styles.metrics}>
        <div><dt>Completion / makespan</dt><dd>{text(metadata.makespan_minutes)} min</dd></div>
        <div><dt>Modeled solar allocation</dt><dd>{showKwh(metadata.modeled_solar_kwh)}</dd></div>
        <div><dt>Modeled grid energy</dt><dd>{showKwh(metadata.modeled_grid_kwh)}</dd></div>
        <div>
          <dt>MODELED TARIFF ENERGY COST — NOT AN ELECTRICITY BILL</dt>
          <dd>{showInr(schedule?.total_energy_cost)}</dd>
        </div>
      </dl>
      {entries.length === 0 ? (
        <p className={styles.missing}>Persisted {kind} schedule entries are unavailable.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                <th>Process</th><th>Machine</th><th>Local time</th>
                <th>Energy</th><th>Solar</th><th>Grid</th><th>Modeled cost</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const metadataEntry = object(entry.metadata)
                return (
                  <tr key={text(entry.id)}>
                    <th scope="row">{text(processNames.get(entry.process_id))}</th>
                    <td>{text(machineNames.get(entry.machine_id))}</td>
                    <td>
                      {localTimestamp(entry.starts_at)} – {localTimestamp(entry.ends_at)}
                    </td>
                    <td>{showKwh(entry.energy_kwh)}</td>
                    <td>{showKwh(Number(metadataEntry.solar_energy_units) / 600_000)}</td>
                    <td>{showKwh(Number(metadataEntry.grid_energy_units) / 600_000)}</td>
                    <td>{showInr(entry.cost)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function ScenarioCard({ scenario }: { scenario: ScenarioData }) {
  const manifest = scenario.manifest
  const code = text(manifest.scenario_code)
  const sourceStats = object(manifest.solar_statistics)
  const sourceDaily = Array.isArray(sourceStats.daily_totals_wh_m2)
    ? sourceStats.daily_totals_wh_m2.filter(isRecord)
    : []
  const request = scenario.requests[0]
  const result = scenario.results[0]
  const bySchedule = new Map(scenario.schedules.map((schedule) => [schedule.name, schedule]))
  const resultMetadata = object(result?.metrics)
  const factory3dUrl = new URL(FACTORY_3D_URL, window.location.origin)
  const factory3dLink = (schedule: 'baseline' | 'optimized') => {
    const target = new URL(factory3dUrl)
    target.searchParams.set('scenario', code.toLowerCase())
    target.searchParams.set('schedule', schedule)
    return target.toString()
  }
  return (
    <article className={styles.scenario}>
      <header className={styles.scenarioHeader}>
        <div>
          <p className={styles.eyebrow}>{code} HISTORICAL WEEK</p>
          <h2>{text(scenario.factory.name)}</h2>
        </div>
        <span className={styles.status}>{text(result?.status, 'result unavailable')}</span>
      </header>
      <div className={styles.banner}>
        <strong>REAL EXTERNAL SOURCE — NASA POWER</strong>
        <span>{text(manifest.source)} · {text(manifest.parameter)} · {text(manifest.units)}</span>
        <span>
          {text(manifest.regional_label)} · {String(object(manifest.coordinate).latitude)}°N,{' '}
          {String(object(manifest.coordinate).longitude)}°E
        </span>
      </div>
      <dl className={styles.summary}>
        <div><dt>Historical window (UTC, end exclusive)</dt><dd>{text(manifest.selected_utc_start)} – {text(manifest.selected_utc_end_exclusive)}</dd></div>
        <div><dt>Local window (Asia/Kolkata)</dt><dd>{text(manifest.local_start)} – {text(manifest.local_end_exclusive)}</dd></div>
        <div><dt>NASA observations</dt><dd>{text(manifest.hourly_observations)} hourly · {text(manifest.missing_observations)} missing · {text(manifest.fill_observations)} fill</dd></div>
        <div><dt>NASA solar resource total</dt><dd>{text(manifest.nasa_total_wh_m2)} Wh/m²</dd></div>
        <div><dt>MODELED PV GENERATION</dt><dd>{showKwh(manifest.modeled_pv_total_kwh)}</dd></div>
        <div><dt>Optimization request / result UUID</dt><dd>{text(request?.id)} / {text(result?.id)}</dd></div>
      </dl>
      <div className={styles.stats}>
        <h3>Daily NASA solar resource variation (Wh/m²)</h3>
        <ul>
          {sourceDaily.map((day) => (
            <li key={text(day.date)}><span>{text(day.date)}</span><strong>{text(day.total_wh_m2)}</strong></li>
          ))}
        </ul>
        <p>
          Hourly minimum / maximum: {text(sourceStats.minimum_hourly_wh_m2)} / {text(sourceStats.maximum_hourly_wh_m2)} Wh/m².
          {' '}Daily total range: {text(sourceStats.daily_total_range_wh_m2)} Wh/m².
          {' '}Low-solar hours below 25 Wh/m²: {text(sourceStats.low_solar_hours_below_25_wh_m2)}.
        </p>
      </div>
      <section className={styles.tariffs}>
        <h3>APERC FY2025–26 11 kV Category-III(A) tariff windows</h3>
        <div className={styles.tableWrap}>
          <table>
            <thead><tr><th>Local window</th><th>Band</th><th>Price</th><th>Basis</th></tr></thead>
            <tbody>
              {scenario.tariffs.map((tariff) => (
                <tr key={text(tariff.id)}>
                  <td>{text(tariff.start_time)} – {text(tariff.end_time)}</td>
                  <td>{text(tariff.band)}</td>
                  <td>{showInr(tariff.energy_price)}</td>
                  <td>{text(tariff.currency)} / {text(tariff.energy_basis)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className={styles.factory3dLinks}>
        <a href={factory3dLink('baseline')} target="_blank" rel="noreferrer">
          Open baseline schedule in Factory-3D
        </a>
        <a href={factory3dLink('optimized')} target="_blank" rel="noreferrer">
          Open SolarShift optimized schedule in Factory-3D
        </a>
      </div>
      <p className={styles.outputLabel}>MODELED OPTIMIZATION OUTPUT</p>
      <div className={styles.scheduleGrid}>
        <ScheduleCard scenario={scenario} kind="baseline" />
        <ScheduleCard scenario={scenario} kind="optimized" />
      </div>
      <div className={styles.assumptions}>
        <h3>Assumptions and exclusions</h3>
        <ul>
          <li>{text(object(manifest).regional_label)}</li>
          <li>Assumed scenario PV capacity: 300 kWp; not a verified factory installation.</li>
          <li>Assumed PV performance ratio: 0.80; horizontal resource proxy, no transposition.</li>
          <li>NASA hourly timestamp treated as the beginning of the represented hour.</li>
          <li>Modeled PF = 0.95 = 19/20; modeled kVAh = modeled kWh × 20/19.</li>
          <li>MODELED FLAT-WITHIN-HOUR 15-MINUTE PROFILE.</li>
          <li>APERC DEMAND CHARGE EXCLUDED.</li>
          <li>APERC MINIMUM-BILLING RULES EXCLUDED.</li>
          <li>Cost excludes demand charges and minimum-billing rules; it is not a total electricity bill.</li>
          <li>SYNTHETIC/SCENARIO DATA — Chocolate manufacturing model.</li>
          <li>NOT MEASURED — plant electricity/solar telemetry.</li>
          <li>{text(resultMetadata.solver)} · {text(resultMetadata.status)}</li>
        </ul>
        <p>
          Energy rows: {scenario.energyRows.length}; APERC tariff-window rows: {scenario.tariffs.length};
          {' '}baseline schedule UUID: {text(bySchedule.get('SolarShift historical baseline')?.id)};
          {' '}optimized schedule UUID: {text(bySchedule.get('SolarShift historical optimized')?.id)}.
        </p>
      </div>
    </article>
  )
}

export default function SolarShiftHistoricalPage() {
  const [scenarios, setScenarios] = useState<ScenarioData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    loadScenarios()
      .then((loaded) => {
        if (active) setScenarios(loaded)
      })
      .catch((failure: unknown) => {
        if (active) setError(failure instanceof Error ? failure.message : String(failure))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  return (
    <main className={styles.page}>
      <header className={styles.pageHeader}>
        <p className={styles.eyebrow}>SOLARSHIFT HISTORICAL REPLAY</p>
        <h1>One factory model. Two historical tariff regimes.</h1>
        <p>Persisted HGD and LGD replays using the same synthetic Chocolate manufacturing model.</p>
      </header>
      <div className={styles.labels} aria-label="Data classification labels">
        {REQUIRED_LABELS.map((label) => <span key={label}>{label}</span>)}
      </div>
      {loading && <p role="status" className={styles.notice}>Loading persisted scenario data from Supabase…</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {!loading && !error && scenarios.length === 2 && (
        <div className={styles.scenarios}>
          {scenarios.map((scenario) => (
            <ScenarioCard key={text(scenario.factory.id)} scenario={scenario} />
          ))}
        </div>
      )}
    </main>
  )
}
