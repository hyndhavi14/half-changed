import { useEffect, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import type { MachineDataProvider } from '../data/types';
import { useDataSync } from '../data/useDataSync';
import { useLiveSimulation } from '../data/useLiveSimulation';
import { useViewStore } from '../state/viewStore';
import { useMachineStore } from '../state/machineStore';
import { useEnergyStore } from '../state/energyStore';
import { useScheduleStore } from '../state/scheduleStore';
import { CAMERA, PRESETS, type PresetKey } from '../config/cameraPresets';
import { LAYOUT_BY_ID, type MachineId } from '../config/layout';
import { FactoryScene } from '../three/scene/FactoryScene';
import { Toolbar } from '../ui/panels/Toolbar';
import { InfoPanel } from '../ui/panels/InfoPanel';
import { EnergyPanel } from '../ui/panels/EnergyPanel';
import { Minimap } from '../ui/panels/Minimap';
import { Labels } from '../ui/panels/Labels';
import { Toast } from '../ui/panels/Toast';
import { WalkOverlay } from '../ui/panels/WalkOverlay';
import { DebugPanel } from '../ui/debug/DebugPanel';
import '../ui/styles.css';

export interface FactoryTwinProps {
  /** Where machine data comes from. Keep the instance stable (create it once). */
  provider: MachineDataProvider;
  /** Called whenever the selected machine changes (null when cleared). */
  onMachineSelect?: (id: string | null) => void;
  /** Camera preset on load. */
  initialView?: PresetKey;
  /** 'auto' follows the OS / host page; 'light' or 'dark' forces a theme. */
  theme?: 'auto' | 'light' | 'dark';
  /** Run the 15 s live simulation (demo only). Default true. */
  simulate?: boolean;
  /** Hide controls that can fabricate machine state. */
  readOnly?: boolean;
  /** Data source label shown in the toolbar. */
  dataLabel?: string;
  /** Optional scenario-specific, read-only overlay content. */
  children?: ReactNode;
  className?: string;
}

function useDarkTheme(root: React.RefObject<HTMLElement | null>, theme: 'auto' | 'light' | 'dark') {
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const compute = () => {
      const host = document.documentElement.getAttribute('data-theme');
      const dark = theme === 'dark' || (theme === 'auto' && (host === 'dark' || (host !== 'light' && mq.matches)));
      useViewStore.getState().set({ dark });
      root.current?.setAttribute('data-theme', dark ? 'dark' : 'light');
    };
    compute();
    mq.addEventListener('change', compute);
    const mo = new MutationObserver(compute);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      mq.removeEventListener('change', compute);
      mo.disconnect();
    };
  }, [root, theme]);
}

/** The ByteMe 3D chocolate factory. Fills its parent element. */
export function FactoryTwin({
  provider,
  onMachineSelect,
  initialView = 'reset',
  theme = 'auto',
  simulate = true,
  readOnly = false,
  dataLabel = 'sample data',
  children,
  className,
}: FactoryTwinProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  useDataSync(provider);
  useLiveSimulation(simulate);
  useDarkTheme(rootRef, theme);

  const ready = useViewStore((s) => s.ready);
  const hasInfo = useViewStore((s) => !!s.selectedId);
  const machineError = useMachineStore((s) => s.error);
  const machines = useMachineStore((s) => s.machines);
  const selectedSchedule = useScheduleStore((s) => s.schedule);
  const scheduleError = useScheduleStore((s) => s.error);
  const unplaced = Object.values(machines).filter((machine) => {
    const layoutId = machine.layout_id ?? machine.machine_id;
    return !Object.prototype.hasOwnProperty.call(LAYOUT_BY_ID, layoutId as MachineId);
  });
  const knownMachineIds = new Set(Object.values(machines).map((machine) => machine.machine_id));
  const orphanedScheduleEntries = selectedSchedule?.entries.filter(
    (entry) => !knownMachineIds.has(entry.machine_id),
  ) ?? [];

  // Selection callback for the host app.
  const cb = useRef(onMachineSelect);
  cb.current = onMachineSelect;
  useEffect(() => useViewStore.subscribe((s, prev) => {
    if (s.selectedId === prev.selectedId) return;
    const selected = s.selectedId
      ? Object.values(useMachineStore.getState().machines).find(
          (machine) => (machine.layout_id ?? machine.machine_id) === s.selectedId,
        )
      : undefined;
    cb.current?.(selected?.machine_id ?? null);
  }), []);

  // Console access in dev: __byteme.machineStore.getState() etc.
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__byteme = { machineStore: useMachineStore, viewStore: useViewStore, energyStore: useEnergyStore };
  }, []);

  // Keep --bar-h in sync with the toolbar's height so side panels sit below it.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const bar = root?.querySelector('.bm-bar');
    if (!root || !bar) return;
    const ro = new ResizeObserver(() => {
      const r = root.getBoundingClientRect(),
        b = bar.getBoundingClientRect();
      root.style.setProperty('--bar-h', `${Math.round(b.bottom - r.top + 10)}px`);
    });
    ro.observe(bar);
    ro.observe(root);
    return () => ro.disconnect();
  }, []);

  const lowQ = /[?&]q=low/.test(location.search);
  const start = PRESETS[initialView];

  return (
    <div ref={rootRef} className={`bm-twin${hasInfo ? ' has-info' : ''}${className ? ' ' + className : ''}`}>
      <Canvas
        className="bm-canvas"
        shadows="soft"
        dpr={lowQ ? 1 : [1, 2]}
        camera={{ fov: CAMERA.fov, near: CAMERA.near, far: CAMERA.far, position: start.pos }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 0.86;
          gl.outputColorSpace = THREE.SRGBColorSpace;
          gl.domElement.setAttribute('role', 'img');
          gl.domElement.setAttribute(
            'aria-label',
            '3D model of the ByteMe chocolate factory. Use the toolbar and the machine menu to move the camera and inspect machines.',
          );
        }}
      >
        <FactoryScene
          initialView={initialView}
          showDemoProducts={!readOnly}
          hideUnmappedMachines={readOnly}
        />
      </Canvas>
      <Labels />
      <Toolbar readOnly={readOnly} dataLabel={dataLabel} />
      <InfoPanel readOnly={readOnly} />
      {!readOnly && <DebugPanel />}
      <EnergyPanel />
      <Minimap />
      <WalkOverlay />
      <Toast />
      {(machineError || scheduleError || selectedSchedule || unplaced.length > 0 || orphanedScheduleEntries.length > 0) && (
        <div className="bm-data-state" role={machineError || scheduleError ? 'alert' : 'status'}>
          {machineError && <p>Machine data refresh failed: {machineError}</p>}
          {scheduleError && <p>Selected schedule could not be loaded: {scheduleError}</p>}
          {selectedSchedule && (
            <p>
              Planned schedule v{selectedSchedule.version} · {selectedSchedule.status} ·{' '}
              {selectedSchedule.horizon_start} to {selectedSchedule.horizon_end}
            </p>
          )}
          {unplaced.length > 0 && (
            <p>
              {unplaced.length} backend machine(s) have no scene placement and are not shown:{' '}
              {unplaced.map((machine) => `${machine.name} (${machine.machine_id})`).join(', ')}
            </p>
          )}
          {orphanedScheduleEntries.length > 0 && (
            <p>
              {orphanedScheduleEntries.length} selected-schedule entry/entries reference machine UUIDs
              absent from this factory response:{' '}
              {Array.from(new Set(orphanedScheduleEntries.map((entry) => entry.machine_id))).join(', ')}
            </p>
          )}
        </div>
      )}
      {children}
      {!ready && <div className="bm-loading">Building the factory…</div>}
    </div>
  );
}
