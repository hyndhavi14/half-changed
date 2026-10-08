import type { HourEnergy } from '../../data/types'
import styles from './EnergyChart.module.css'

export interface MeasuredEnergyPoint {
  hour: number
  generationKwh: number
  consumptionKwh: number
}

interface EnergyChartProps {
  energyByHour?: HourEnergy[]
  measuredEnergy?: MeasuredEnergyPoint[]
  firstSeriesLabel?: string
  secondSeriesLabel?: string
  height?: number
  showNote?: boolean
}

export default function EnergyChart({
  energyByHour = [],
  measuredEnergy,
  firstSeriesLabel = 'Solar',
  secondSeriesLabel = 'Grid',
  height = 180,
  showNote = false,
}: EnergyChartProps) {
  const measured = measuredEnergy !== undefined
  const points = measured
    ? measuredEnergy
    : energyByHour.map((hour) => ({
        hour: hour.hour,
        generationKwh: hour.solarKwh,
        consumptionKwh: hour.gridKwh,
      }))
  const maxEnergy = Math.max(
    1,
    ...points.map((hour) => measured
      ? Math.max(hour.generationKwh, hour.consumptionKwh)
      : hour.generationKwh + hour.consumptionKwh),
  )

  return (
    <div className={styles.energyChart}>
      <div
        className={styles.chartScroller}
        role="img"
        aria-label={measured
          ? `Hourly ${firstSeriesLabel.toLowerCase()} and ${secondSeriesLabel.toLowerCase()}`
          : 'Hourly solar and grid energy use'}
      >
        <div className={styles.chartInner}>
          <div className={styles.chartBars} style={{ height }}>
            {points.map((hour) => (
              <div
                className={`${styles.chartColumn}${measured ? ` ${styles.measuredColumn}` : ''}`}
                key={hour.hour}
                title={`${String(hour.hour).padStart(2, '0')}:00 — ${firstSeriesLabel.toLowerCase()} ${hour.generationKwh} kWh, ${secondSeriesLabel.toLowerCase()} ${hour.consumptionKwh} kWh`}
                aria-hidden="true"
              >
                <div
                  className={styles.solarBar}
                  style={{ height: `${(hour.generationKwh / maxEnergy) * height}px` }}
                />
                <div
                  className={`${styles.gridBar}${!measured && hour.generationKwh === 0 ? ` ${styles.gridBarTop}` : ''}`}
                  style={{ height: `${(hour.consumptionKwh / maxEnergy) * height}px` }}
                />
              </div>
            ))}
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
          <div className={styles.hourLabels} aria-hidden="true">
            {points.map((hour) => (
              <span key={hour.hour}>
                {hour.hour % 3 === 0 ? String(hour.hour).padStart(2, '0') : ''}
              </span>
            ))}
          </div>
        </div>
      </div>
      {showNote && (
        <p className={styles.chartNote}>
          Heavy processes were moved into the 10:00–15:00 solar window and out
          of the 18:00–22:00 peak price band.
        </p>
      )}
    </div>
  )
}
