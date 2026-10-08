import { useState } from 'react'
import Card from '../../components/Card/Card'
import DataTable from '../../components/DataTable/DataTable'
import EnergyChart from '../../components/EnergyChart/EnergyChart'
import Legend from '../../components/Legend/Legend'
import PageHeader from '../../components/PageHeader/PageHeader'
import ProgressBar from '../../components/ProgressBar/ProgressBar'
import ProvenanceTag from '../../components/ProvenanceTag/ProvenanceTag'
import ImpactTile from '../../components/ImpactTile/ImpactTile'
import StatTile from '../../components/StatTile/StatTile'
import { useFactory } from '../../context/useFactory'
import { displayTimestamp, displayValue, findStoredSchedule } from '../../data/backendView'
import { optimizationOutcome, schedulePair, solarAvailableKwh, type ScheduleTotals } from '../../data/factoryInsight'
import { formatCurrency, formatKwh, formatPercent } from '../../data/format'
import {
  NOT_AVAILABLE,
  energyDays,
  energySourceLabel,
  energySourceNote,
  rowsForDay,
  tariffWindows,
} from '../DashboardPage/dashboardView'
import { sourceTag } from '../sourceProvenance'
import {
  bandAllocation,
  dayTariffBands,
  defaultEnergyDay,
  excludedChargesNote,
  formatEnergy,
  formatMoney,
  formatNumber,
  fullDayPoints,
  plannedTotals,
  readingsSummary,
  readingsSummaryText,
  tariffWindowLines,
  type BandKey,
} from './energyPageView'
import styles from './EnergyPage.module.css'

const BAND_COLORS: Record<BandKey, string> = {
  peak: 'var(--terracotta)',
  mid: 'var(--tariff-mid)',
  off: 'var(--tariff-off)',
  none: 'var(--tan)',
}

function gridShare(totals: ScheduleTotals): number | null {
  return totals.gridKwh !== null && totals.energyKwh !== null && totals.energyKwh > 0 ? (totals.gridKwh / totals.energyKwh) * 100 : null
}

function rowText(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  return typeof value === 'string' || typeof value === 'number' ? String(value) : NOT_AVAILABLE
}

export default function EnergyPage() {
  const { backendData, loading, error } = useFactory()
  const [chosenDay, setChosenDay] = useState<string | null>(null)

  if (!backendData) {
    return <PageHeader eyebrow={loading ? 'Loading persisted factory data' : 'Factory data unavailable'} title={error ?? 'No factory selected'} />
  }

  const data = backendData
  const timeZone = data.factory.timezone
  const currency = data.factory.currency
  const optimized = findStoredSchedule(data, 'optimized')
  const totals = plannedTotals(optimized)
  const modeledTag = <ProvenanceTag provenance="modeled" />
  const tileSub = optimized ? 'Optimized schedule' : 'No optimized schedule yet'
  const outcome = optimizationOutcome(schedulePair(data))
  const solarAvailable = solarAvailableKwh(data, optimized)
  const utilization = solarAvailable && outcome.optimized.solarKwh !== null ? (outcome.optimized.solarKwh / solarAvailable) * 100 : null
  const utilizationBaseline = solarAvailable && outcome.baseline.solarKwh !== null && outcome.comparable ? (outcome.baseline.solarKwh / solarAvailable) * 100 : null

  const days = energyDays(data.energy, timeZone)
  const fallbackDay = defaultEnergyDay(data.energy, timeZone)
  const selectedDay = chosenDay !== null && days.includes(chosenDay) ? chosenDay : fallbackDay
  const dayRows = selectedDay ? rowsForDay(data.energy, timeZone, selectedDay) : []
  const points = selectedDay ? fullDayPoints(data.energy, timeZone, selectedDay) : []
  const hasPoints = points.some((point) => point.generationKwh !== null)
  const windows = tariffWindows(data.tariffs)
  const bands = selectedDay && windows.length ? dayTariffBands(windows, selectedDay) : undefined
  const daySource = energySourceLabel(dayRows)
  const dayTag = sourceTag(daySource)
  const summary = readingsSummary(data.energy, timeZone)

  const allocation = bandAllocation(data, optimized)
  const windowLines = tariffWindowLines(data)
  const chargesNote = excludedChargesNote(data)
  const bandShown = (band: BandKey) => bands?.includes(band === 'none' ? null : band)

  const readingRows = [...dayRows]
    .sort((left, right) => rowText(left, 'recorded_at').localeCompare(rowText(right, 'recorded_at')))
    .map((row, index) => ({
      key: `${rowText(row, 'id')}-${index}`,
      cells: {
        time: typeof row.recorded_at === 'string' ? displayTimestamp(row.recorded_at, timeZone) : NOT_AVAILABLE,
        interval: displayValue(row.interval_minutes, ' min'),
        consumption: displayValue(row.consumption_kwh, ' kWh'),
        generation: displayValue(row.generation_kwh, ' kWh'),
        source: rowText(row, 'source'),
      },
    }))

  return (
    <div className={styles.page}>
      <PageHeader eyebrow={`${data.factory.name} · ${timeZone}`} title="Energy, solar & savings" />

      <section className={styles.impact} aria-label="What SolarShift achieved">
        <div className={styles.impactHead}>
          <h2>What SolarShift achieved</h2>
          <p>
            {outcome.comparable
              ? 'Optimized schedule compared with the baseline schedule for the same processes and horizon. All values are modeled by the optimizer, not metered savings.'
              : 'A comparable baseline and optimized schedule pair is needed before savings can be shown. Run the optimizer from the dashboard.'}
          </p>
        </div>
        <div className={styles.impactGrid}>
          <ImpactTile
            label="Grid energy saved"
            value={outcome.gridSavedKwh === null ? NOT_AVAILABLE : formatKwh(outcome.gridSavedKwh)}
            sub={outcome.gridSavedKwh === null ? undefined : `${formatKwh(outcome.baseline.gridKwh)} → ${formatKwh(outcome.optimized.gridKwh)}`}
            tone={outcome.gridSavedKwh === null ? 'neutral' : outcome.gridSavedKwh > 0 ? 'good' : outcome.gridSavedKwh < 0 ? 'bad' : 'neutral'}
            provenance={outcome.gridSavedKwh === null ? undefined : modeledTag}
          />
          <ImpactTile
            label="Modeled cost saved"
            value={outcome.costSaved === null ? NOT_AVAILABLE : formatCurrency(outcome.costSaved, currency)}
            sub={outcome.costSaved === null ? undefined : `${formatCurrency(outcome.baseline.cost, currency)} → ${formatCurrency(outcome.optimized.cost, currency)}${outcome.costSavedPct === null ? '' : ` · ${formatPercent(outcome.costSavedPct, 1)} lower`}`}
            tone={outcome.costSaved === null ? 'neutral' : outcome.costSaved > 0 ? 'good' : outcome.costSaved < 0 ? 'bad' : 'neutral'}
            provenance={outcome.costSaved === null ? undefined : modeledTag}
          />
          <ImpactTile
            label="Solar used"
            value={formatKwh(outcome.optimized.solarKwh)}
            sub={outcome.solarGainKwh === null ? 'Optimized schedule' : `${outcome.solarGainKwh >= 0 ? '+' : '−'}${formatKwh(Math.abs(outcome.solarGainKwh))} vs baseline`}
            tone="solar"
            provenance={outcome.optimized.solarKwh === null ? undefined : modeledTag}
          />
          <ImpactTile
            label="Grid dependency"
            value={gridShare(outcome.optimized) === null ? NOT_AVAILABLE : formatPercent(gridShare(outcome.optimized), 1)}
            sub={outcome.gridDependencyChangePts === null ? 'Share of planned energy from the grid' : `was ${formatPercent(gridShare(outcome.baseline), 1)} · ${outcome.gridDependencyChangePts <= 0 ? '−' : '+'}${formatNumber(Math.abs(outcome.gridDependencyChangePts))} points`}
            tone={outcome.gridDependencyChangePts === null ? 'neutral' : outcome.gridDependencyChangePts < 0 ? 'good' : outcome.gridDependencyChangePts > 0 ? 'bad' : 'neutral'}
            provenance={gridShare(outcome.optimized) === null ? undefined : modeledTag}
          />
        </div>
        <div className={styles.stats}>
          <StatTile
            label="Solar available"
            value={solarAvailable === null ? NOT_AVAILABLE : formatKwh(solarAvailable)}
            sub={solarAvailable === null ? 'Solar data not available for this factory’s horizon' : 'Across the planning horizon'}
            provenance={solarAvailable === null || !dayTag ? undefined : <ProvenanceTag provenance={dayTag.provenance} label={dayTag.label} />}
          />
          <StatTile
            label="Solar utilization"
            value={utilization === null ? NOT_AVAILABLE : formatPercent(utilization, 1)}
            sub={utilizationBaseline === null ? 'Solar used ÷ solar available' : `was ${formatPercent(utilizationBaseline, 1)} in the baseline`}
            provenance={utilization === null ? undefined : modeledTag}
          />
          <StatTile
            label="Grid energy"
            value={formatKwh(outcome.optimized.gridKwh)}
            sub={tileSub}
            provenance={outcome.optimized.gridKwh === null ? undefined : modeledTag}
          />
          <StatTile
            label="Modeled cost"
            value={formatMoney(totals.cost, currency)}
            sub={chargesNote ? 'Energy only, excludes other charges' : tileSub}
            provenance={totals.cost === null ? undefined : modeledTag}
          />
        </div>
        {currency !== 'INR' && (
          <p className={styles.currencyNote}>Costs for {data.factory.name} are stored in {currency} and shown as stored. They are not converted to ₹.</p>
        )}
      </section>

      <Card
        title="Hourly energy use"
        provenance={dayTag ? <ProvenanceTag provenance={dayTag.provenance} label={dayTag.label} /> : undefined}
        action={days.length > 1 ? (
          <label className={styles.dayPicker}>
            <span>Day</span>
            <select value={selectedDay} onChange={(event) => setChosenDay(event.target.value)}>
              {days.map((day) => <option key={day} value={day}>{day}</option>)}
            </select>
          </label>
        ) : undefined}
      >
        <Legend
          items={[
            { label: 'Generation', color: 'var(--sun)', shape: 'square' },
            { label: 'Consumption', color: 'var(--grid-brown)', shape: 'square' },
            ...(['peak', 'mid'] as const)
              .filter((band) => bandShown(band))
              .map((band) => ({ label: band === 'peak' ? 'Peak price' : 'Mid price', color: BAND_COLORS[band], shape: 'square' as const })),
          ]}
        />
        {hasPoints ? (
          <EnergyChart
            measuredEnergy={points}
            tariffBands={bands}
            firstSeriesLabel="Generation"
            secondSeriesLabel="Consumption"
            height={260}
            valueScale
          />
        ) : null}
        {hasPoints && (
          <p className={styles.allocationNote}>
            {selectedDay ? `${selectedDay} (${timeZone}) · ` : ''}{energySourceNote(daySource)}
          </p>
        )}
        <p className={styles.allocationNote}>
          {readingsSummaryText(summary)}
          {windows.length === 0 ? ' No tariff windows are configured.' : ''}
        </p>
        {readingRows.length > 0 && (
          <details className={styles.readings}>
            <summary>Stored readings for {selectedDay} ({readingRows.length})</summary>
            <DataTable
              caption={`Stored energy readings for ${selectedDay}`}
              columns={[
                { key: 'time', header: 'Recorded at', rowHeader: true },
                { key: 'interval', header: 'Interval', align: 'right' },
                { key: 'consumption', header: 'Consumption', align: 'right' },
                { key: 'generation', header: 'Generation', align: 'right' },
                { key: 'source', header: 'Source' },
              ]}
              rows={readingRows}
              emptyMessage="No readings for this day."
              pageSize={24}
            />
          </details>
        )}
      </Card>

      <Card title="Cost by tariff band" provenance={optimized ? modeledTag : undefined}>
        {!optimized ? (
          <p className={styles.allocationNote}>Run optimization to see planned energy and modeled cost by tariff band.</p>
        ) : (
          <div className={styles.tariffList}>
            {allocation.rows.map((row) => (
              <div className={styles.tariffRow} key={row.band}>
                <div className={styles.tariffHeading}>
                  <strong>{row.label}</strong>
                  <span>{formatEnergy(row.kwh)}</span>
                  <strong>{formatMoney(row.cost, currency)}</strong>
                </div>
                <ProgressBar
                  value={row.sharePct}
                  color={BAND_COLORS[row.band]}
                  ariaLabel={`${row.label} share of planned energy`}
                />
                {windowLines.filter((line) => line.band === row.band).length > 0 && (
                  <ul className={styles.windowList}>
                    {windowLines.filter((line) => line.band === row.band).map((line) => <li key={line.text}>{line.text}</li>)}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
        <p className={styles.allocationNote}>
          {optimized
            ? `Planned energy of the optimized schedule, assigned to the tariff band in force at each moment. Entry costs come from the optimizer and are split by time; ${allocation.spanningEntries === 0 ? 'no entry spans two bands, so the split is exact.' : `${allocation.spanningEntries} ${allocation.spanningEntries === 1 ? 'entry spans' : 'entries span'} two bands, so ${allocation.spanningEntries === 1 ? 'its' : 'their'} split is approximate.`}`
            : ''}
          {windows.length === 0 ? ' No electricity tariffs are configured for this factory.' : ''}
        </p>
        {chargesNote && <p className={styles.allocationNote}>{chargesNote}</p>}
      </Card>
    </div>
  )
}
