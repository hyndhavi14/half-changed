import { useEffect, useState } from 'react'
import Card from '../components/Card/Card'
import CompareCard from '../components/CompareCard/CompareCard'
import PageHeader from '../components/PageHeader/PageHeader'
import ProgressBar from '../components/ProgressBar/ProgressBar'
import ProvenanceTag from '../components/ProvenanceTag/ProvenanceTag'
import StatTile from '../components/StatTile/StatTile'
import StatusChip from '../components/StatusChip/StatusChip'
import {
  BAND_LABEL,
  clockText,
  dailyBars,
  entryEnergyUnits,
  isRecord,
  localTimestamp,
  object,
  overviewRow,
  scenarioCompare,
  scheduleEntries,
  scheduleFor,
  showInr,
  showKwh,
  tariffDaySegments,
  text,
  type JsonRecord,
  type ScenarioData,
} from './solarShiftView'
import styles from './SolarShiftHistoricalPage.module.css'

const SCENARIO_SLUGS = ['solarshift-hgd-historical', 'solarshift-lgd-historical']
const API_BASE_URL = (import.meta.env.VITE_API_URL ?? '').replace(/\/+$/, '')
const FACTORY_3D_URL = import.meta.env.VITE_FACTORY_3D_URL ?? 'http://localhost:5174'
const REQUIRED_LABELS = [
  'REAL EXTERNAL SOURCE \u2014 NASA POWER',
  'MODELED PV GENERATION',
  'MODELED FLAT-WITHIN-HOUR 15-MINUTE PROFILE',
  'MODELED OPTIMIZATION OUTPUT',
  'SYNTHETIC/SCENARIO DATA \u2014 Chocolate manufacturing model',
  'NOT MEASURED \u2014 plant electricity/solar telemetry',
  'APERC DEMAND CHARGE EXCLUDED',
  'APERC MINIMUM-BILLING RULES EXCLUDED',
]

function records(value: unknown, label: string): JsonRecord[] {
  if (!Array.isArray(value) || !value.every(isRecord)) {
    throw new Error(`Supabase returned invalid ${label} data.`)
  }
  return value
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


function ScheduleTable({ scenario, kind }: { scenario: ScenarioData; kind: 'baseline' | 'optimized' }) {
  const schedule = scheduleFor(scenario, kind)
  const entries = scheduleEntries(scenario, schedule)
  const processNames = new Map(scenario.processes.map((process) => [process.id, text(process.name)]))
  const machineNames = new Map(scenario.machines.map((machine) => [machine.id, text(machine.name)]))
  return (
    <section className={styles.scheduleCard} aria-label={`${kind} schedule`}>
      <div className={styles.scheduleHeading}>
        <h3>{kind === 'baseline' ? 'Baseline schedule' : 'SolarShift optimized schedule'}</h3>
        <span>{entries.length} process entries</span>
      </div>
      {entries.length === 0 ? (
        <p className={styles.missing}>Persisted {kind} schedule entries are unavailable.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Process</th><th scope="col">Machine</th><th scope="col">Local time</th>
                <th scope="col">Energy</th><th scope="col">Solar</th><th scope="col">Grid</th><th scope="col">Modeled cost</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={text(entry.id)}>
                  <th scope="row">{text(processNames.get(entry.process_id))}</th>
                  <td>{text(machineNames.get(entry.machine_id))}</td>
                  <td className={styles.wrap}>{localTimestamp(entry.starts_at)} {'–'} {localTimestamp(entry.ends_at)}</td>
                  <td>{showKwh(entry.energy_kwh)}</td>
                  <td>{showKwh(entryEnergyUnits(entry, 'solar_energy_units'))}</td>
                  <td>{showKwh(entryEnergyUnits(entry, 'grid_energy_units'))}</td>
                  <td>{showInr(entry.cost)}</td>
                </tr>
              ))}
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
  const bars = dailyBars(manifest)
  const segments = tariffDaySegments(scenario.tariffs)
  const request = scenario.requests[0]
  const result = scenario.results[0]
  const bySchedule = new Map(scenario.schedules.map((schedule) => [schedule.name, schedule]))
  const resultMetadata = object(result?.metrics)
  const compare = scenarioCompare(scenario)
  const factory3dUrl = new URL(FACTORY_3D_URL, window.location.origin)
  const factory3dLink = (schedule: 'baseline' | 'optimized') => {
    const target = new URL(factory3dUrl)
    target.searchParams.set('scenario', code.toLowerCase())
    target.searchParams.set('schedule', schedule)
    return target.toString()
  }
  const coordinate = object(manifest.coordinate)
  return (
    <Card
      title={`${code} historical week · ${text(scenario.factory.name)}`}
      action={<StatusChip status={result?.status === 'succeeded' ? 'Saved' : 'Idle'}>{text(result?.status, 'result unavailable')}</StatusChip>}
    >
      <div className={styles.scenarioBody}>
        <div className={styles.banner}>
          <ProvenanceTag provenance="recorded" label={'REAL EXTERNAL SOURCE — NASA POWER'} />
          <span>{text(manifest.source)} {'·'} {text(manifest.parameter)} {'·'} {text(manifest.units)}</span>
          <span>{text(manifest.regional_label)} {'·'} {String(coordinate.latitude)}{'°'}N, {String(coordinate.longitude)}{'°'}E</span>
        </div>

        <div className={styles.summary}>
          <StatTile label="NASA solar resource total" value={`${text(manifest.nasa_total_wh_m2)} Wh/m²`} provenance={<ProvenanceTag provenance="recorded" label="NASA POWER" />} />
          <StatTile label="Modeled PV generation" value={showKwh(manifest.modeled_pv_total_kwh)} provenance={<ProvenanceTag provenance="modeled" />} />
          <StatTile label="NASA observations" value={`${text(manifest.hourly_observations)} hourly`} sub={`${text(manifest.missing_observations)} missing · ${text(manifest.fill_observations)} fill`} />
          <StatTile label="Optimizer result" value={text(resultMetadata.status, text(result?.status))} sub={text(resultMetadata.solver, 'Solver not recorded')} />
        </div>

        <dl className={styles.facts}>
          <div><dt>Historical window (UTC, end exclusive)</dt><dd>{text(manifest.selected_utc_start)} {'–'} {text(manifest.selected_utc_end_exclusive)}</dd></div>
          <div><dt>Local window (Asia/Kolkata)</dt><dd>{text(manifest.local_start)} {'–'} {text(manifest.local_end_exclusive)}</dd></div>
          <div><dt>Optimization request / result UUID</dt><dd>{text(request?.id)} / {text(result?.id)}</dd></div>
        </dl>

        <section className={styles.section} aria-label="Daily NASA solar resource variation">
          <h3>Daily NASA solar resource variation (Wh/m{'²'})</h3>
          <div className={styles.dailyList}>
            {bars.map((day) => (
              <div className={styles.dailyRow} key={day.date}>
                <span>{day.date}</span>
                <ProgressBar value={day.pct} color="var(--sun)" ariaLabel={`${day.date} solar resource`} />
                <strong>{day.value.toLocaleString('en-IN')}</strong>
              </div>
            ))}
          </div>
          <p className={styles.note}>
            Hourly minimum / maximum: {text(sourceStats.minimum_hourly_wh_m2)} / {text(sourceStats.maximum_hourly_wh_m2)} Wh/m{'²'}.
            {' '}Daily total range: {text(sourceStats.daily_total_range_wh_m2)} Wh/m{'²'}.
            {' '}Low-solar hours below 25 Wh/m{'²'}: {text(sourceStats.low_solar_hours_below_25_wh_m2)}.
          </p>
        </section>

        <section className={styles.section} aria-label="APERC tariff windows">
          <h3>APERC FY2025{'–'}26 11 kV Category-III(A) tariff windows</h3>
          <div className={styles.bandStrip} role="img" aria-label="APERC tariff bands across the local day">
            {segments.map((segment) => (
              <span
                key={`${segment.band}-${segment.startFraction}`}
                className={`${styles.band} ${styles[`band_${segment.band}`] ?? ''}`}
                style={{ left: `${segment.startFraction * 100}%`, width: `${(segment.endFraction - segment.startFraction) * 100}%` }}
                title={BAND_LABEL[segment.band]}
              />
            ))}
          </div>
          <div className={styles.bandAxis} aria-hidden="true"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead><tr><th scope="col">Local window</th><th scope="col">Band</th><th scope="col">Price</th><th scope="col">Basis</th></tr></thead>
              <tbody>
                {scenario.tariffs.map((tariff) => (
                  <tr key={text(tariff.id)}>
                    <th scope="row">{clockText(tariff.start_time)} {'–'} {clockText(tariff.end_time)}</th>
                    <td>{tariff.band === 'peak' || tariff.band === 'normal' || tariff.band === 'off_peak' ? BAND_LABEL[tariff.band] : text(tariff.band)}</td>
                    <td>{showInr(tariff.energy_price)}</td>
                    <td>{text(tariff.currency)} / {text(tariff.energy_basis)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <p className={styles.outputLabel}>MODELED OPTIMIZATION OUTPUT</p>
        {compare.length > 0 && (
          <CompareCard
            title="Baseline vs SolarShift optimized"
            compare={compare}
            provenance={<ProvenanceTag provenance="modeled" />}
          />
        )}
        <p className={styles.note}>MODELED TARIFF ENERGY COST {'—'} NOT AN ELECTRICITY BILL.</p>

        <div className={styles.factory3dLinks}>
          <a href={factory3dLink('baseline')} target="_blank" rel="noreferrer">Open baseline schedule in Factory-3D</a>
          <a href={factory3dLink('optimized')} target="_blank" rel="noreferrer">Open SolarShift optimized schedule in Factory-3D</a>
        </div>

        <div className={styles.scheduleGrid}>
          <ScheduleTable scenario={scenario} kind="baseline" />
          <ScheduleTable scenario={scenario} kind="optimized" />
        </div>

        <section className={styles.assumptions} aria-label="Assumptions and exclusions">
          <h3>Assumptions and exclusions</h3>
          <ul>
            <li>{text(manifest.regional_label)}</li>
            <li>Assumed scenario PV capacity: 300 kWp; not a verified factory installation.</li>
            <li>Assumed PV performance ratio: 0.80; horizontal resource proxy, no transposition.</li>
            <li>NASA hourly timestamp treated as the beginning of the represented hour.</li>
            <li>Modeled PF = 0.95 = 19/20; modeled kVAh = modeled kWh {'×'} 20/19.</li>
            <li>MODELED FLAT-WITHIN-HOUR 15-MINUTE PROFILE.</li>
            <li>APERC DEMAND CHARGE EXCLUDED.</li>
            <li>APERC MINIMUM-BILLING RULES EXCLUDED.</li>
            <li>Cost excludes demand charges and minimum-billing rules; it is not a total electricity bill.</li>
            <li>SYNTHETIC/SCENARIO DATA {'—'} Chocolate manufacturing model.</li>
            <li>NOT MEASURED {'—'} plant electricity/solar telemetry.</li>
            <li>{text(resultMetadata.solver)} {'·'} {text(resultMetadata.status)}</li>
          </ul>
          <p className={styles.note}>
            Energy rows: {scenario.energyRows.length}; APERC tariff-window rows: {scenario.tariffs.length};
            {' '}baseline schedule UUID: {text(bySchedule.get('SolarShift historical baseline')?.id)};
            {' '}optimized schedule UUID: {text(bySchedule.get('SolarShift historical optimized')?.id)}.
          </p>
        </section>
      </div>
    </Card>
  )
}

function Overview({ scenarios }: { scenarios: ScenarioData[] }) {
  const rows = scenarios.map(overviewRow)
  return (
    <Card title="HGD and LGD at a glance" provenance={<ProvenanceTag provenance="modeled" />}>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <caption className={styles.visuallyHidden}>Solar resource, modeled PV and modeled energy cost for each historical week</caption>
          <thead>
            <tr>
              <th scope="col">Scenario</th>
              <th scope="col">NASA solar resource</th>
              <th scope="col">Modeled PV</th>
              <th scope="col">Baseline modeled cost</th>
              <th scope="col">Optimized modeled cost</th>
              <th scope="col">Change</th>
              <th scope="col">Optimized solar allocation</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.code}>
                <th scope="row">{row.code}</th>
                <td>{row.nasaTotal}</td>
                <td>{row.modeledPv}</td>
                <td>{row.baselineCost}</td>
                <td><strong>{row.optimizedCost}</strong></td>
                <td>{row.costChange}</td>
                <td>{row.optimizedSolar}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.note}>
        Same synthetic factory model in both weeks; only the historical solar resource and the APERC tariff regime differ. Costs are modeled tariff energy costs, not electricity bills; the change is calculated from the two stored costs.
      </p>
    </Card>
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
    <div className={styles.page}>
      <PageHeader eyebrow={'SolarShift historical replay · public'} title="One factory model. Two historical tariff regimes." />
      <p className={styles.lead}>Persisted HGD and LGD replays using the same synthetic Chocolate manufacturing model.</p>
      <div className={styles.labels} aria-label="Data classification labels">
        {REQUIRED_LABELS.map((label) => <span key={label}>{label}</span>)}
      </div>
      {loading && <p role="status" className={styles.notice}>Loading persisted scenario data from Supabase{'…'}</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {!loading && !error && scenarios.length === 2 && (
        <>
          <Overview scenarios={scenarios} />
          {scenarios.map((scenario) => (
            <ScenarioCard key={text(scenario.factory.id)} scenario={scenario} />
          ))}
        </>
      )}
    </div>
  )
}
