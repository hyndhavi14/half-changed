import { useEnergyNow } from '../../state/energyStore';
import { STATUS, STATUS_ORDER, statusCss } from '../../config/statusStyles';
import { usePlanStore } from '../../state/planStore';
import { clockIn } from '../../data/planned';

/** Solar / grid / factory load bars, scaled to the largest value, plus the status legend. */
export function EnergyPanel() {
  const e = useEnergyNow();
  const at = usePlanStore((s) => s.at);
  const timeZone = usePlanStore((s) => s.timeZone);
  const max = Math.max(e.load ?? 0, e.solar ?? 0, 1);
  const rows: [string, number | null, string][] = [
    ['Solar', e.solar, '#E3A72F'],
    ['Grid', e.grid, '#8A6E58'],
    ['Factory', e.load, 'var(--accent)'],
  ];
  return (
    <section className="panel energy" aria-label={at === null ? 'Energy right now' : 'Planned energy'}>
      <h2>{at === null ? 'Energy right now' : `Planned energy · ${clockIn(timeZone, at, false)}`}</h2>
      {rows.map(([label, kw, color]) => (
        <div className="erow" key={label}>
          <span>{label}</span>
          <div className="ebar">
            <i style={{ background: color, width: `${((kw ?? 0) / max) * 100}%` }} />
          </div>
          <b>{kw === null ? '—' : `${Math.round(kw)} kW`}</b>
        </div>
      ))}
      {at !== null && <p className="energy-note">From the stored schedule and solar readings, not live meters.</p>}
      <ul className="legend" aria-label="Machine status colours">
        {STATUS_ORDER.map((s) => (
          <li key={s}>
            <span className="dot" style={{ background: statusCss(s) }} />
            {STATUS[s].label}
          </li>
        ))}
      </ul>
    </section>
  );
}
