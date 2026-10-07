export type MachineStatus = 'running' | 'idle' | 'maintenance' | 'offline' | 'warning' | 'unknown';

export interface MachineData {
  /** Canonical backend UUID. Mock providers may use their local fixture key. */
  machine_id: string;
  /** Stable scene-layout key; it is not a backend entity ID. */
  layout_id?: string;
  name: string;
  status: MachineStatus;
  /** Current draw, only when supplied by a telemetry source. */
  power_kw: number | null;
  /** Rated capacity, not current draw. */
  rated_power_kw?: number | null;
  production_duration_minutes: number | null;
  start_time?: string;
  end_time?: string;
  message?: string;
}

export interface MachineDataProvider {
  getMachines(): Promise<MachineData[]>;
  getMachine(id: string): Promise<MachineData | undefined>;
  getSchedule?(): Promise<ScheduleSnapshot>;
  /** Optional push updates. Returns an unsubscribe function. */
  subscribe?(cb: (machines: MachineData[]) => void): () => void;
  subscribeSchedule?(cb: (schedule: ScheduleSnapshot) => void): () => void;
}

export type ScheduleStatus =
  | 'draft'
  | 'published'
  | 'active'
  | 'completed'
  | 'superseded'
  | 'cancelled';

export interface ScheduleEntryData {
  id: string;
  schedule_id: string;
  machine_id: string;
  process_id: string;
  process_name?: string;
  machine_name?: string;
  production_order_id: string | null;
  starts_at: string;
  ends_at: string;
  sequence: number;
}

export interface ScheduleSnapshot {
  id: string;
  factory_id: string;
  name: string;
  version: number;
  status: ScheduleStatus;
  horizon_start: string;
  horizon_end: string;
  entries: ScheduleEntryData[];
}
