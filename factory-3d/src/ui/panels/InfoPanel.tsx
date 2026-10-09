import { useMachineStore } from '../../state/machineStore';
import { useViewStore } from '../../state/viewStore';
import { useEnergyNow } from '../../state/energyStore';
import { useScheduleStore } from '../../state/scheduleStore';
import { LAYOUT_BY_ID, LAYOUT, type MachineId } from '../../config/layout';
import { DEFAULT_MESSAGES, STATUS, statusCss } from '../../config/statusStyles';
import { MACHINE_DESCRIPTIONS } from '../../data/mock/machineDescriptions';
import type { MachineData } from '../../data/types';
import { cameraApi } from '../../three/cameras/cameraApi';
import { usePlanStore } from '../../state/planStore';
import { clockIn } from '../../data/planned';

const fmtDur = (m: number | null) => (m === null ? 'Not available' : m < 60 ? `${m} min` : `${m} min (${Math.round(m / 6) / 10} h)`);

function stateText(m: MachineData, planned: boolean) {
  if (planned) {
    if (m.status === 'running') return `${m.message ?? 'Planned run'} until ${m.end_time}.`;
    return m.start_time && m.message?.startsWith('Next') ? `${m.message} at ${m.start_time}.` : m.message ?? 'Idle.';
  }
  if (m.status === 'unknown') return 'Operational status is not reported by the backend.';
  if (m.status === 'running') return `Processing the current batch until ${m.end_time}.`;
  if (m.status === 'idle') return m.start_time ? `Waiting. The next batch starts at ${m.start_time}.` : 'Idle.';
  return m.message || DEFAULT_MESSAGES[m.status] || '';
}

function powerText(m: MachineData) {
  if (m.status === 'unknown' || m.power_kw === null) {
    const rated = m.rated_power_kw ?? m.power_kw;
    return rated === null || rated === undefined
      ? 'Current draw not reported'
      : `Current draw not reported · ${rated} kW rated`;
  }
  if (m.status === 'running' || m.status === 'warning') return `${m.power_kw} kW`;
  if (m.status === 'idle' && m.power_kw === 0) return m.rated_power_kw ? `Not running · ${m.rated_power_kw} kW rated` : 'Not running';
  if (m.status === 'idle') return `${Math.round(m.power_kw * 0.1 * 10) / 10} kW standby (${m.power_kw} kW rated)`;
  return `0 kW (${m.power_kw} kW rated)`;
}

/** Machine pop-up: right side on desktop, bottom sheet on phones. Esc closes it. */
export function InfoPanel({ readOnly = false }: { readOnly?: boolean }) {
  const selectedId = useViewStore((s) => s.selectedId);
  const set = useViewStore((s) => s.set);
  const m = useMachineStore((s) => (selectedId ? s.machines[selectedId] : undefined));
  const schedule = useScheduleStore((s) => s.schedule);
  const e = useEnergyNow();
  const planAt = usePlanStore((s) => s.at);
  const timeZone = usePlanStore((s) => s.timeZone);
  if (!m) return null;
  const planned = planAt !== null;

  const layoutId = m.layout_id ?? m.machine_id;
  const def = LAYOUT_BY_ID[layoutId as MachineId];
  const plannedEntries = schedule?.entries
    .filter((entry) => entry.machine_id === m.machine_id) ?? [];
  const draws = m.status === 'running' || m.status === 'warning';
  const source = e.load === null || e.solar === null || e.used === null
    ? 'Not reported'
    : !draws
    ? 'Not drawing power'
    : e.solar >= e.load
      ? 'Solar'
      : e.solar <= 0
        ? 'Grid'
        : `Solar and grid (${Math.round((e.used / e.load) * 100)}% solar)`;

  return (
    <aside className="panel info" aria-live="polite" aria-label="Machine details">
      <button className="close" type="button" aria-label="Close machine details" onClick={() => set({ selectedId: null })}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
      <p className="eyebrow">{def ? `Step ${def.index + 1} of ${LAYOUT.length} · ${def.stage}` : 'Machine'}</p>
      <h2>{m.name}</h2>
      {!readOnly && <p className="desc">{MACHINE_DESCRIPTIONS[layoutId] ?? ''}</p>}
      <span className="chip">
        <span className="dot" style={{ background: statusCss(m.status) }} />
        <span>{STATUS[m.status]?.label ?? m.status}</span>
      </span>
      <dl>
        {!readOnly && (
          <>
            <dt>Machine ID</dt>
            <dd>{m.machine_id}</dd>
          </>
        )}
        <dt>{planned ? 'Planned power' : 'Power'}</dt>
        <dd>{powerText(m)}</dd>
        <dt>Production</dt>
        <dd>{fmtDur(m.production_duration_minutes)}</dd>
        <dt>{planned && m.status !== 'running' ? 'Next run' : 'Schedule'}</dt>
        <dd>
          {m.start_time ? `${m.start_time} to ${m.end_time ?? '–'}` : 'No run planned'}
        </dd>
        <dt>Energy</dt>
        <dd>{source}</dd>
      </dl>
      <p className="state">{stateText(m, planned)}</p>
      {schedule && (
        <section className="planned-schedule" aria-label="Planned schedule intervals">
          <h3>Planned runs on this machine</h3>
          {plannedEntries.length === 0 ? (
            <p>No entries for this machine in the selected schedule.</p>
          ) : (
            <ol>
              {plannedEntries.map((entry) => (
                <li key={entry.id}>
                  <strong>{entry.process_name ?? 'Scheduled process'}</strong>
                  <span>
                    <time dateTime={entry.starts_at}>{clockIn(timeZone, Date.parse(entry.starts_at))}</time>
                    {' – '}
                    <time dateTime={entry.ends_at}>{clockIn(timeZone, Date.parse(entry.ends_at))}</time>
                    {entry.power_kw != null ? ` · ${entry.power_kw} kW` : ''}
                  </span>
                </li>
              ))}
            </ol>
          )}
          <p>Planned by the optimizer; not measured machine status.</p>
        </section>
      )}
      <div className="row">
        <button className="btn primary" type="button" onClick={() => cameraApi.focusMachine(layoutId)}>
          Zoom to machine
        </button>
        <button className="btn ghost" type="button" onClick={() => cameraApi.goPreset('overview')}>
          Back to overview
        </button>
      </div>
    </aside>
  );
}
