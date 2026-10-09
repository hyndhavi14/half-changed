import { create } from 'zustand';

/** The instant of the stored schedule the scene is showing (planned, not live). */
interface PlanState {
  at: number | null;
  start: number | null;
  end: number | null;
  timeZone: string | null;
  factoryName: string | null;
  playing: boolean;
  /** True when the time came from the host page, so it is not echoed back. */
  fromHost: boolean;
  set(patch: Partial<Omit<PlanState, 'set'>>): void;
}

export const usePlanStore = create<PlanState>()((set) => ({
  at: null,
  start: null,
  end: null,
  timeZone: null,
  factoryName: null,
  playing: false,
  fromHost: false,
  set: (patch) => set(patch),
}));
