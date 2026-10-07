import { useEffect, useState } from 'react';
import { useMachineStore } from '../../state/machineStore';
import { useViewStore } from '../../state/viewStore';
import { useEnergyStore } from '../../state/energyStore';
import { STATUS, STATUS_ORDER, statusCss } from '../../config/statusStyles';
import { registry } from '../../three/registry';

function Stats() {
  const [s, setS] = useState(registry.stats);
  useEffect(() => {
    const t = setInterval(() => setS({ ...registry.stats }), 500);
    return () => clearInterval(t);
  }, []);
  return (
    <>
      <div className="stat">
        <span>Frame rate</span>
        <b>{s.fps ? `${s.fps} fps` : '–'}</b>
      </div>
      <div className="stat">
        <span>Draw calls</span>
        <b>{s.calls || '–'}</b>
      </div>
      <div className="stat">
        <span>Camera</span>
        <b>{s.cam || '–'}</b>
      </div>
    </>
  );
}

/** FPS, draw calls, camera, toggles, solar slider and status buttons for the selected machine. */
export function DebugPanel() {
  const show = useViewStore((s) => s.showDebug);
  const showIds = useViewStore((s) => s.showIds);
  const live = useViewStore((s) => s.live);
  const selectedId = useViewStore((s) => s.selectedId);
  const set = useViewStore((s) => s.set);
  const solar = useEnergyStore((s) => s.solarKw);
  const setSolar = useEnergyStore((s) => s.setSolar);
  const m = useMachineStore((s) => (selectedId ? s.machines[selectedId] : undefined));
  const setStatus = useMachineStore((s) => s.setStatus);
  if (!show) return null;

  return (
    <aside className="panel debug" aria-label="Debug tools">
      <h2>Debug</h2>
      <Stats />
      <hr />
      <label>
        <input type="checkbox" checked={showIds} onChange={(e) => set({ showIds: e.target.checked })} /> Show machine IDs on labels
      </label>
      <label>
        <input type="checkbox" checked={live} onChange={(e) => set({ live: e.target.checked })} /> Live simulation (changes every 15 s)
      </label>
      <hr />
      <label htmlFor="bm-solar" style={{ minHeight: 0 }}>
        Solar output: <b style={{ marginLeft: 4 }}>{solar === null ? 'Not reported' : `${solar} kW`}</b>
      </label>
      <input id="bm-solar" type="range" min={0} max={120} step={1} value={solar ?? 0} onChange={(e) => setSolar(+e.target.value)} />
      <hr />
      <div>{m ? `Set status of ${m.name}:` : 'Select a machine to change its status.'}</div>
      <div className="sbtns">
        {STATUS_ORDER.map((s) => (
          <button
            key={s}
            type="button"
            className="btn ghost"
            disabled={!m}
            aria-pressed={!!m && m.status === s}
            onClick={() => m && setStatus(m.machine_id, s)}
          >
            <span className="dot" style={{ background: statusCss(s) }} />
            {STATUS[s].label}
          </button>
        ))}
      </div>
    </aside>
  );
}
