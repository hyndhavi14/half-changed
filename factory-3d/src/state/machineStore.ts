import { create } from 'zustand';
import type { MachineData, MachineStatus } from '../data/types';
import { DEFAULT_MESSAGES } from '../config/statusStyles';

interface MachineState {
  machines: Record<string, MachineData>;
  loaded: boolean;
  error: string | null;
  replaceMachines(list: MachineData[]): void;
  setError(error: string | null): void;
  reset(): void;
  /** Sets a status and the default message for it. */
  setStatus(id: string, status: MachineStatus): void;
}

export const useMachineStore = create<MachineState>()((set) => ({
  machines: {},
  loaded: false,
  error: null,
  replaceMachines: (list) => set({
    machines: Object.fromEntries(list.map((machine) => [
      machine.layout_id ?? machine.machine_id,
      machine,
    ])),
    loaded: true,
    error: null,
  }),
  setError: (error) => set({ error }),
  reset: () => set({ machines: {}, loaded: false, error: null }),
  setStatus: (id, status) =>
    set((s) => {
      const m = s.machines[id];
      if (!m) return s;
      return { machines: { ...s.machines, [id]: { ...m, status, message: DEFAULT_MESSAGES[status] } } };
    }),
}));
