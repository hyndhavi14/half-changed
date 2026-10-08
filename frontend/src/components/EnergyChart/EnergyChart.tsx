import type { HourEnergy } from '../../data/types'
import { formatKwh } from '../../data/format'
import styles from './EnergyChart.module.css'

export interface MeasuredEnergyPoint {
  hour: number
  generationKwh: number
  consumptionKwh: number
}

/** Chart input: null means "no reading" and is never drawn or labelled as 0. */
export interface EnergyChartPoint {
  hour: number
  generationKwh: number | null
  consumptionKwh: number | null
}

interface EnergyChartProps {
  energyByHour?: HourEnergy[]
  measuredEnergy?: EnergyChartPoint[]
  tariffBands?: Array<'peak' | 'mid' | 'off' | null>
  valueScale?: boolean
  firstSeriesLabel?: string
  secondSeriesLabel?: string
  height?: number
}

export default function EnergyChart({
  energyByHour = [],
  measuredEnergy,
  tariffBands,
  valueScale = false,
  firstSeriesLabel = 'Solar',
  secondSeriesLabel = 'Grid',
  height = 180,
}: EnergyChartProps) {
  const measured = measuredEnergy !== undefined
  const points: EnergyChartPoint[] = measured
    ? measuredEnergy
    : energyByHour.map((hour) => ({
        hour: hour.hour,
        generationKwh: hour.solarKwh,
        consumptionKwh: hour.gridKwh,
      }))
  const validValues = points.flatMap((hour) =>
    [hour.generationKwh, hour.consumptionKwh].filter(
      (value): value is number => typeof value === 'number' && Number.isFinite(value),
    ),
  )
  const maxValue = validValues.length > 0 ? Math.max(...validValues) : null
  const maxEnergy = measured
    ? Math.max(1, ...(maxValue === null ? [] : [maxValue]))
    : Math.max(
        1,
        ...points.map((hour) => hour.generationKwh! + hour.consumptionKwh!),
      )

  return (
    <div className={styles.energyChart}>
      <div
        className={styles.chartScroller}
        tabIndex={0}
        role="img"
        aria-label={measured
          ? `Hourly ${firstSeriesLabel.toLowerCase()} and ${secondSeriesLabel.toLowerCase()}`
          : 'Hourly solar and grid energy use'}
      >
        <div className={styles.chartInner}>
          {valueScale && maxValue !== null && (
            <p className={styles.valueScale}>Max {formatKwh(maxValue)}</p>
          )}
          <div className={styles.chartBars} style={{ height }}>
            {points.map((hour) => {
              const generation = typeof hour.generationKwh === 'number' &&
                Number.isFinite(hour.generationKwh) ? hour.generationKwh : null
              const consumption = typeof hour.consumptionKwh === 'number' &&
                Number.isFinite(hour.consumptionKwh) ? hour.consumptionKwh : null
              const noData = measured && (generation === null || consumption === null)
              const hourLabel = `${String(hour.hour).padStart(2, '0')}:00`
              return (
              <div
                className={`${styles.chartColumn}${measured ? ` ${styles.measuredColumn}` : ''}${noData ? ` ${styles.noData}` : ''}`}
                key={hour.hour}
                title={noData
                  ? `${hourLabel} — no reading`
                  : `${hourLabel} — ${firstSeriesLabel.toLowerCase()} ${generation} kWh, ${secondSeriesLabel.toLowerCase()} ${consumption} kWh`}
                aria-hidden="true"
              >
                <div
                  className={styles.solarBar}
                  style={{ height: `${((generation ?? 0) / maxEnergy) * height}px` }}
                />
                <div
                  className={`${styles.gridBar}${!measured && generation === 0 ? ` ${styles.gridBarTop}` : ''}`}
                  style={{ height: `${((consumption ?? 0) / maxEnergy) * height}px` }}
                />
              </div>
              )
            })}
          </div>
          {!measured && (
            <div className={styles.tariffStrip} aria-hidden="true">
              {energyByHour.map((hour) => (
              <div
                className={`${styles.tariffBar} ${styles[`tariff-${hour.tariff}`]}`}
                key={hour.hour}
                title={`${String(hour.hour).padStart(2, '0')}:00 · ${hour.tariff} tariff`}
              />
              ))}
            </div>
          )}
          {measured && tariffBands !== undefined && (
            <div className={styles.tariffStrip} aria-hidden="true">
              {tariffBands.map((tone, index) => (
                <div
                  className={`${styles.tariffBar} ${styles[tone === null ? 'tariff-none' : `tariff-${tone}`]}`}
                  key={index}
                  title={`${String(index).padStart(2, '0')}:00 · ${tone ?? 'no tariff'}`}
                />
              ))}
            </div>
          )}
          <div className={styles.hourLabels} aria-hidden="true">
            {points.map((hour) => (
              <span key={hour.hour}>
                {hour.hour % 3 === 0 ? String(hour.hour).padStart(2, '0') : ''}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
