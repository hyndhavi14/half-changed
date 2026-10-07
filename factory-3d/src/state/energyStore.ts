import { create } from 'zustand';
import type { MachineData } from '../data/types';
import { useMachineStore } from './machineStore';

interface EnergyState {
  solarKw: number | null;
  setSolar(kw: number | null): void;
}

export const useEnergyStore = create<EnergyState>()((set) => ({
  solarKw: 95,
  setSolar: (kw) => set({
    solarKw: kw === null ? null : Math.max(0, Math.min(120, Math.round(kw))),
  }),
}));

export interface EnergyNow {
  load: number | null;
  solar: number | null;
  grid: number | null;
  used: number | null;
}

/** Returns unknown totals rather than estimating from machines without telemetry. */
export function computeEnergy(machines: Record<string, MachineData>, solar: number | null): EnergyNow {
  let load = 0;
  for (const id in machines) {
    const m = machines[id];
    if (m.status === 'unknown') return { load: null, solar: null, grid: null, used: null };
    if (m.status === 'running' || m.status === 'warning') {
      if (m.power_kw === null) return { load: null, solar: null, grid: null, used: null };
      load += m.power_kw;
    } else if (m.status === 'idle') {
      if (m.power_kw === null) return { load: null, solar: null, grid: null, used: null };
      load += m.power_kw * 0.1;
    }
  }
  load = Math.round(load);
  if (solar === null) return { load, solar: null, grid: null, used: null };
  return { load, solar, grid: Math.max(0, load - solar), used: Math.min(solar, load) };
}

/** Non-reactive snapshot, safe inside useFrame. */
export function energyNow(): EnergyNow {
  return computeEnergy(useMachineStore.getState().machines, useEnergyStore.getState().solarKw);
}

/** Reactive version for UI panels. */
export function useEnergyNow(): EnergyNow {
  const machines = useMachineStore((s) => s.machines);
  const solar = useEnergyStore((s) => s.solarKw);
  return computeEnergy(machines, solar);
}
