import { useEffect, useState } from 'react'
import Card from '../components/Card/Card'
import CompareCard from '../components/CompareCard/CompareCard'
import ImpactTile from '../components/ImpactTile/ImpactTile'
import ProgressBar from '../components/ProgressBar/ProgressBar'
import ProvenanceTag from '../components/ProvenanceTag/ProvenanceTag'
import ScheduleGantt from '../components/ScheduleGantt/ScheduleGantt'
import SegmentedToggle from '../components/SegmentedToggle/SegmentedToggle'
import SolarDemandChart from '../components/SolarDemandChart/SolarDemandChart'
import StatTile from '../components/StatTile/StatTile'
import StatusChip from '../components/StatusChip/StatusChip'
import { formatCurrency, formatKwh } from '../data/format'
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
  scenarioDateRange,
  scenarioHourly,
  scenarioLanes,
  scheduleEntries,
  scheduleFor,
  showInr,
  showKwh,
  tariffDaySegments,
  text,
  toNumber,
  type JsonRecord,
  type ScenarioData,
} from './solarShiftView'
import styles from './SolarShiftHistoricalPage.module.css'

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
const SCENARIO_TZ = 'Asia/Kolkata'
const VIEW_OPTIONS = [
  { value: 'baseline', label: 'Baseline demand' },
  { value: 'optimized', label: 'Optimized demand' },
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
        <div className={styles.tableWrap} tabIndex={0} role="region" aria-label={`${kind} schedule entries table, scrollable`}>
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
                  <td className={styles.wrap}>{localTimestamp(entry.starts_at)} – {localTimestamp(entry.ends_at)}</td>
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

const kwh = (value: number | null) => formatKwh(value)
const inr = (value: number | null) => formatCurrency(value, 'INR')

function percentChange(before: number | null, after: number | null): string | null {
  if (before === null || after === null || before === 0) return null
  const change = ((after - before) / before) * 100
  return `${change <= 0 ? '−' : '+'}${Math.abs(change).toLocaleString('en-IN', { maximumFractionDigits: 1 })}%`
}

function Scenario({ scenario }: { scenario: ScenarioData }) {
  const [view, setView] = useState<'baseline' | 'optimized'>('optimized')
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
  const hourly = scenarioHourly(scenario)
  const timeline = scenarioLanes(scenario)
  const baseline = scheduleFor(scenario, 'baseline')
  const optimized = scheduleFor(scenario, 'optimized')
  const solarBefore = toNumber(object(baseline?.metadata).modeled_solar_kwh)
  const solarAfter = toNumber(object(optimized?.metadata).modeled_solar_kwh)
  const gridBefore = toNumber(object(baseline?.metadata).modeled_grid_kwh)
  const gridAfter = toNumber(object(optimized?.metadata).modeled_grid_kwh)
  const costBefore = toNumber(baseline?.total_energy_cost)
  const costAfter = toNumber(optimized?.total_energy_cost)
  const coordinate = object(manifest.coordinate)
  const factory3dLink = (schedule: 'baseline' | 'optimized') => {
    const target = new URL(FACTORY_3D_URL, window.location.origin)
    target.searchParams.set('scenario', code.toLowerCase())
    target.searchParams.set('schedule', schedule)
    return target.toString()
  }

  return (
    <div className={styles.scenarioBody}>
      <div className={styles.impactGrid}>
        <ImpactTile
          label="Solar used"
          value={kwh(solarAfter)}
          sub={solarBefore === null ? 'Optimized schedule' : `baseline ${kwh(solarBefore)}${percentChange(solarBefore, solarAfter) ? ` · ${percentChange(solarBefore, solarAfter)}` : ''}`}
          tone="solar"
          provenance={<ProvenanceTag provenance="modeled" label="Modeled" />}
        />
        <ImpactTile
          label="Grid energy"
          value={kwh(gridAfter)}
          sub={gridBefore === null ? 'Optimized schedule' : `baseline ${kwh(gridBefore)}${percentChange(gridBefore, gridAfter) ? ` · ${percentChange(gridBefore, gridAfter)}` : ''}`}
          tone={gridBefore !== null && gridAfter !== null && gridAfter < gridBefore ? 'good' : 'neutral'}
          provenance={<ProvenanceTag provenance="modeled" label="Modeled" />}
        />
        <ImpactTile
          label="Modeled energy cost"
          value={inr(costAfter)}
          sub={costBefore === null ? 'Optimized schedule' : `baseline ${inr(costBefore)}${percentChange(costBefore, costAfter) ? ` · ${percentChange(costBefore, costAfter)}` : ''}`}
          tone={costBefore !== null && costAfter !== null && costAfter < costBefore ? 'good' : 'neutral'}
          provenance={<ProvenanceTag provenance="modeled" label="Modeled" />}
        />
        <ImpactTile
          label="Production"
          value={`${scheduleEntries(scenario, optimized).length} of ${scenario.processes.length}`}
          sub="processes scheduled · dependencies and machine limits checked by the solver"
          tone="neutral"
          provenance={<ProvenanceTag provenance="planned" label="Optimizer output" />}
        />
      </div>

      <Card
        title="Historical solar vs factory demand"
        provenance={<ProvenanceTag provenance="modeled" label="PV modeled from NASA POWER" />}
        action={<SegmentedToggle options={VIEW_OPTIONS} value={view} onChange={(value) => setView(value as 'baseline' | 'optimized')} ariaLabel="Demand shown" />}
      >
        <p className={styles.note}>
          Every hour of the replay week. Gold is PV output modeled from the real NASA POWER sunlight record; brown is the factory’s demand that solar could not cover. Switch between baseline and optimized to see the demand move into sunlit hours.
        </p>
        {hourly.length > 0 ? (
          <SolarDemandChart
            points={hourly}
            view={view}
            timeZone={SCENARIO_TZ}
            ariaLabel={`${code} hourly modeled PV and ${view} factory demand`}
            solarLabel="Modeled PV (from NASA POWER)"
            minColumn={7}
          />
        ) : (
          <p className={styles.missing}>The hourly PV profile is not available for this scenario.</p>
        )}
      </Card>

      <Card title="The factory schedule SolarShift optimized" provenance={<ProvenanceTag provenance="planned" label="Optimizer output" />}>
        <p className={styles.note}>Teal blocks = when each process runs after SolarShift. Dashed outlines = where it ran before.</p>
        {timeline.window && timeline.lanes.length ? (
          <ScheduleGantt
            lanes={timeline.lanes}
            window={timeline.window}
            timeZone={SCENARIO_TZ}
            mode="compare"
            ariaLabel={`${code} baseline and optimized schedule`}
          />
        ) : (
          <p className={styles.missing}>Persisted schedule entries are unavailable.</p>
        )}
      </Card>

      <details className={styles.details}>
        <summary>More detail: before/after numbers, data sources, tariffs and assumptions</summary>
        <div className={styles.detailsBody}>
      {compare.length > 0 && (
            <CompareCard title="Before vs after SolarShift" compare={compare} provenance={<ProvenanceTag provenance="modeled" />} />
          )}
          <p className={styles.note}>MODELED TARIFF ENERGY COST — NOT AN ELECTRICITY BILL. Costs are in ₹ (INR) as stored by the replay.</p>

          <div className={styles.factory3dLinks}>
            <a href={factory3dLink('baseline')} target="_blank" rel="noreferrer">Open baseline schedule in Factory-3D</a>
            <a href={factory3dLink('optimized')} target="_blank" rel="noreferrer">Open SolarShift optimized schedule in Factory-3D</a>
          </div>

          <div className={styles.banner}>
            <ProvenanceTag provenance="recorded" label="REAL EXTERNAL SOURCE — NASA POWER" />
            <span>{text(manifest.source)} · {text(manifest.parameter)} · {text(manifest.units)}</span>
            <span>{text(manifest.regional_label)} · {String(coordinate.latitude)}°N, {String(coordinate.longitude)}°E</span>
          </div>
          <div className={styles.summary}>
            <StatTile label="NASA solar resource total" value={`${text(manifest.nasa_total_wh_m2)} Wh/m²`} provenance={<ProvenanceTag provenance="recorded" label="NASA POWER" />} />
            <StatTile label="Modeled PV generation" value={showKwh(manifest.modeled_pv_total_kwh)} provenance={<ProvenanceTag provenance="modeled" />} />
            <StatTile label="NASA observations" value={`${text(manifest.hourly_observations)} hourly`} sub={`${text(manifest.missing_observations)} missing · ${text(manifest.fill_observations)} fill`} />
            <StatTile label="Optimizer result" value={text(resultMetadata.status, text(result?.status))} sub={text(resultMetadata.solver, 'Solver not recorded')} />
          </div>
          <dl className={styles.facts}>
            <div><dt>Historical window (UTC, end exclusive)</dt><dd>{text(manifest.selected_utc_start)} – {text(manifest.selected_utc_end_exclusive)}</dd></div>
            <div><dt>Local window (Asia/Kolkata)</dt><dd>{text(manifest.local_start)} – {text(manifest.local_end_exclusive)}</dd></div>
            <div><dt>Optimization request / result UUID</dt><dd>{text(request?.id)} / {text(result?.id)}</dd></div>
          </dl>
          <section className={styles.section} aria-label="Daily NASA solar resource variation">
            <h3>Daily NASA solar resource (Wh/m²)</h3>
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
              Hourly minimum / maximum: {text(sourceStats.minimum_hourly_wh_m2)} / {text(sourceStats.maximum_hourly_wh_m2)} Wh/m².
              {' '}Daily total range: {text(sourceStats.daily_total_range_wh_m2)} Wh/m².
              {' '}Low-solar hours below 25 Wh/m²: {text(sourceStats.low_solar_hours_below_25_wh_m2)}.
            </p>
          </section>
          <section className={styles.section} aria-label="APERC tariff windows">
            <h3>APERC FY2025–26 11 kV Category-III(A) tariff windows</h3>
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
            <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="APERC tariff windows table, scrollable">
              <table className={styles.table}>
                <thead><tr><th scope="col">Local window</th><th scope="col">Band</th><th scope="col">Price</th><th scope="col">Basis</th></tr></thead>
                <tbody>
                  {scenario.tariffs.map((tariff) => (
                    <tr key={text(tariff.id)}>
                      <th scope="row">{clockText(tariff.start_time)} – {clockText(tariff.end_time)}</th>
                      <td>{tariff.band === 'peak' || tariff.band === 'normal' || tariff.band === 'off_peak' ? BAND_LABEL[tariff.band] : text(tariff.band)}</td>
                      <td>{showInr(tariff.energy_price)}</td>
                      <td>{text(tariff.currency)} / {text(tariff.energy_basis)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
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
              <li>Modeled PF = 0.95 = 19/20; modeled kVAh = modeled kWh × 20/19.</li>
              <li>MODELED FLAT-WITHIN-HOUR 15-MINUTE PROFILE.</li>
              <li>APERC DEMAND CHARGE EXCLUDED.</li>
              <li>APERC MINIMUM-BILLING RULES EXCLUDED.</li>
              <li>Cost excludes demand charges and minimum-billing rules; it is not a total electricity bill.</li>
              <li>SYNTHETIC/SCENARIO DATA — Chocolate manufacturing model.</li>
              <li>NOT MEASURED — plant electricity/solar telemetry.</li>
              <li>{text(resultMetadata.solver)} · {text(resultMetadata.status)}</li>
            </ul>
            <p className={styles.note}>
              Energy rows: {scenario.energyRows.length}; APERC tariff-window rows: {scenario.tariffs.length};
              {' '}baseline schedule UUID: {text(bySchedule.get('SolarShift historical baseline')?.id)};
              {' '}optimized schedule UUID: {text(bySchedule.get('SolarShift historical optimized')?.id)}.
            </p>
          </section>
        </div>
      </details>
    </div>
  )
}

function Overview({ scenarios }: { scenarios: ScenarioData[] }) {
  const rows = scenarios.map(overviewRow)
  return (
    <Card title="HGD and LGD at a glance" provenance={<ProvenanceTag provenance="modeled" />}>
      <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="HGD and LGD overview table, scrollable">
        <table className={styles.table}>
          <caption className={styles.visuallyHidden}>Solar resource, modeled PV and modeled energy cost for each historical week</caption>
          <thead>
            <tr>
              <th scope="col">Scenario</th>
              <th scope="col">Week</th>
              <th scope="col">NASA solar resource</th>
              <th scope="col">Modeled PV</th>
              <th scope="col">Baseline modeled cost</th>
              <th scope="col">Optimized modeled cost</th>
              <th scope="col">Change</th>
              <th scope="col">Optimized solar allocation</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.code}>
                <th scope="row">{row.code}</th>
                <td>{scenarioDateRange(scenarios[index].manifest)}</td>
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
        Same synthetic factory model in both weeks; only the historical solar resource and the APERC tariff regime differ. Costs are modeled tariff energy costs, not electricity bills.
      </p>
    </Card>
  )
}

interface HistoricalReplayProps {
  /** Name of the factory selected in the app, so the page can say the replay is a separate model. */
  selectedFactoryName?: string
}

/** Historical SolarShift: real NASA POWER sunlight + APERC tariffs replayed through the optimizer. */
export default function HistoricalReplay({ selectedFactoryName }: HistoricalReplayProps) {
  const [scenarios, setScenarios] = useState<ScenarioData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState('')

  useEffect(() => {
    let active = true
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

  const current = scenarios.find((scenario) => text(scenario.manifest.scenario_code) === selected) ?? scenarios[0]
  const result = current?.results[0]

  return (
    <div className={styles.page}>
      <section className={styles.hero} aria-label="Historical SolarShift">
        <span className={styles.heroEyebrow}>Historical SolarShift · historical / modelled scenario — not live telemetry</span>
        <h2>Does SolarShift work with real sunshine and real tariffs?</h2>
        <p>
          We took one real week of NASA sunlight data and the Andhra Pradesh electricity tariff, and let the optimizer schedule a model factory around them.
          {current ? ` Scenario factory: ${text(current.factory.name)} — a synthetic chocolate manufacturing model · ${scenarioDateRange(current.manifest)}.` : ''}
        </p>
        {selectedFactoryName && (
          <p className={styles.heroNote}>This replay uses its own scenario model and solver. It does not represent {selectedFactoryName}.</p>
        )}
      </section>

      {loading && <p role="status" className={styles.notice}>Loading historical scenario data…</p>}
      {error && <p role="alert" className={styles.error}>Historical SolarShift analysis is not available right now: {error}</p>}
      {!loading && !error && scenarios.length === 0 && (
        <p className={styles.notice}>Historical SolarShift analysis is not available for this configuration.</p>
      )}

      {current && (
        <>
          <div className={styles.scenarioBar}>
            <SegmentedToggle
              options={scenarios.map((scenario) => ({ value: text(scenario.manifest.scenario_code), label: `${text(scenario.manifest.scenario_code)} · ${scenarioDateRange(scenario.manifest)}` }))}
              value={text(current.manifest.scenario_code)}
              onChange={setSelected}
              ariaLabel="Historical scenario"
            />
            <StatusChip status={result?.status === 'succeeded' ? 'Saved' : 'Idle'}>{text(result?.status, 'result unavailable')}</StatusChip>
          </div>
          <Scenario key={text(current.factory.id)} scenario={current} />
          <details className={styles.details}>
            <summary>Compare both weeks and data labels</summary>
            <div className={styles.detailsBody}>
              {scenarios.length > 1 && <Overview scenarios={scenarios} />}
              <div className={styles.labels} aria-label="Data classification labels">
                {REQUIRED_LABELS.map((label) => <span key={label}>{label}</span>)}
              </div>
            </div>
          </details>
        </>
      )}
    </div>
  )
}
