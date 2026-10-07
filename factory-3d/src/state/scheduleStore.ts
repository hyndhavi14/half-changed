import { create } from 'zustand';
import type { ScheduleSnapshot } from '../data/types';

interface ScheduleState {
  schedule: ScheduleSnapshot | null;
  loading: boolean;
  error: string | null;
  setSchedule(schedule: ScheduleSnapshot): void;
  setLoading(loading: boolean): void;
  setError(error: string | null): void;
  reset(): void;
}

export const useScheduleStore = create<ScheduleState>()((set) => ({
  schedule: null,
  loading: false,
  error: null,
  setSchedule: (schedule) => set({ schedule, loading: false, error: null }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ schedule: null, loading: false, error }),
  reset: () => set({ schedule: null, loading: false, error: null }),
}));
