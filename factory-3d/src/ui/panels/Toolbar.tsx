import { useMachineStore } from '../../state/machineStore';
import { useShallow } from 'zustand/react/shallow';
import { useViewStore } from '../../state/viewStore';
import { LAYOUT } from '../../config/layout';
import { cameraApi } from '../../three/cameras/cameraApi';
import { BrandLogo } from './BrandLogo';

export function Toolbar({
  readOnly = false,
  dataLabel = 'sample data',
}: {
  readOnly?: boolean;
  dataLabel?: string;
}) {
  const machines = useMachineStore((s) => s.machines);
  const { activeView, selectedId, showLabels, showEnergy, showDebug, mode, set } = useViewStore(
    useShallow((s) => ({ activeView: s.activeView, selectedId: s.selectedId, showLabels: s.showLabels, showEnergy: s.showEnergy, showDebug: s.showDebug, mode: s.mode, set: s.set })),
  );

  return (
    <header className="bm-bar">
      <div className="panel brand">
        <BrandLogo size={34} />
        <div>
          <h1>Chocolate Factory</h1>
          <p>ByteMe digital twin, {dataLabel}</p>
        </div>
      </div>
      <div className="panel tools">
        <div className="seg" role="group" aria-label="Camera">
          <button className="btn" type="button" aria-pressed={activeView === 'overview'} onClick={() => cameraApi.goPreset('overview')}>
            Overview
          </button>
          <button className="btn" type="button" aria-pressed={activeView === 'close'} onClick={() => cameraApi.goPreset('close')}>
            Close-up
          </button>
          <button
            className="btn walk-only"
            type="button"
            aria-pressed={activeView === 'walk'}
            onClick={() => (mode === 'walk' ? cameraApi.exitWalk() : cameraApi.enterWalk())}
          >
            Walk through
          </button>
        </div>
        <button className="btn ghost" type="button" title="Reset camera" onClick={() => cameraApi.goPreset('reset')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 12a9 9 0 1 0 3-6.7" />
            <path d="M3 4v5h5" />
          </svg>
          Reset
        </button>
        <label htmlFor="bm-goto" className="sr-only">
          Go to machine
        </label>
        <select
          id="bm-goto"
          className="sel"
          value={selectedId ?? ''}
          onChange={(e) => {
            const id = e.target.value || null;
            set({ selectedId: id });
            if (id) cameraApi.focusMachine(id);
          }}
        >
          <option value="">Go to machine…</option>
          {LAYOUT.filter((d) => !readOnly || machines[d.id]).map((d) => (
            <option key={d.id} value={d.id}>
              {d.stage} · {machines[d.id]?.name ?? d.id}
            </option>
          ))}
        </select>
        <span className="divider" aria-hidden="true" />
        <button className="btn ghost" type="button" aria-pressed={showLabels} onClick={() => set({ showLabels: !showLabels })}>
          Labels
        </button>
        <button className="btn ghost" type="button" aria-pressed={showEnergy} onClick={() => set({ showEnergy: !showEnergy })}>
          Energy flow
        </button>
        {!readOnly && (
          <button className="btn ghost" type="button" aria-pressed={showDebug} onClick={() => set({ showDebug: !showDebug })}>
            Debug
          </button>
        )}
      </div>
    </header>
  );
}
