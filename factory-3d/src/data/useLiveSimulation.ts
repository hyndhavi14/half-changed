import { useEffect } from 'react';
import type { MachineStatus } from './types';
import { useMachineStore } from '../state/machineStore';
import { useViewStore } from '../state/viewStore';
import { useEnergyStore } from '../state/energyStore';
import { STATUS } from '../config/statusStyles';

const INTERVAL_MS = 15000;

/** One simulated plant event every 15 s while `live` is on. Keeps the demo moving. */
export function simulateStep() {
  const { machines, setStatus } = useMachineStore.getState();
  const ids = Object.keys(machines).filter((id) => machines[id]?.status !== 'unknown');
  if (!ids.length) return;
  const down = ids.filter((id) => machines[id].status !== 'running');
  let id: string;
  let s: MachineStatus;
  if (down.length && (down.length >= 2 || Math.random() < 0.55)) {
    id = down[Math.floor(Math.random() * down.length)];
    s = 'running';
  } else {
    id = ids[Math.floor(Math.random() * ids.length)];
    const r = Math.random();
    s = r < 0.4 ? 'idle' : r < 0.7 ? 'warning' : r < 0.9 ? 'maintenance' : 'offline';
    if (machines[id].status === s) return;
  }
  setStatus(id, s);
  const energy = useEnergyStore.getState();
  if (energy.solarKw !== null) {
    energy.setSolar(Math.max(30, Math.min(120, energy.solarKw + Math.round((Math.random() - 0.5) * 14))));
  }
  useViewStore.getState().showToast(`${machines[id].name} is now ${STATUS[s].label.toLowerCase()}`);
}

export function useLiveSimulation(enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => {
      if (useViewStore.getState().live) simulateStep();
    }, INTERVAL_MS);
    return () => clearInterval(t);
  }, [enabled]);
}
