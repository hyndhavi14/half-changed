import type { MachineData, MachineDataProvider, ScheduleSnapshot } from '../types';
import type { ApiMachineDataProvider } from './ApiMachineDataProvider';
import { applyPlan } from '../planned';

/**
 * Wraps the backend provider so the scene shows the PLANNED state of every machine at the
 * selected plan time: running when a schedule entry covers that time, otherwise idle.
 * Nothing is invented: statuses, power and times all come from the stored schedule.
 */
export class PlannedMachineDataProvider implements MachineDataProvider {
  private machines: MachineData[] = [];
  private schedule: ScheduleSnapshot | null = null;
  private at: number | null = null;
  private timeZone: string | null = null;
  private names = new Map<string, string>();
  private listeners = new Set<(machines: MachineData[]) => void>();
  private scheduleListeners = new Set<(schedule: ScheduleSnapshot) => void>();
  readonly base: ApiMachineDataProvider;

  constructor(base: ApiMachineDataProvider) {
    this.base = base;
  }

  setTime(at: number | null): void {
    if (at === this.at) return;
    this.at = at;
    this.emit();
  }

  setTimeZone(timeZone: string | null): void {
    this.timeZone = timeZone;
    this.emit();
  }

  /** Process names make planned runs readable; schedules without names fall back to a generic label. */
  setProcessNames(names: Map<string, string>): void {
    this.names = names;
    if (this.schedule) {
      this.schedule = this.named(this.schedule);
      for (const listener of this.scheduleListeners) listener(this.schedule);
    }
    this.emit();
  }

  private named(schedule: ScheduleSnapshot): ScheduleSnapshot {
    return {
      ...schedule,
      entries: schedule.entries.map((entry) => ({ ...entry, process_name: entry.process_name ?? this.names.get(entry.process_id) })),
    };
  }

  private view(): MachineData[] {
    return applyPlan(this.machines, this.schedule, this.at, this.timeZone);
  }

  private emit(): void {
    const machines = this.view();
    for (const listener of this.listeners) listener(machines);
  }

  async getMachines(): Promise<MachineData[]> {
    this.machines = await this.base.getMachines();
    return this.view();
  }

  async getMachine(id: string): Promise<MachineData | undefined> {
    return (await this.getMachines()).find((machine) => machine.machine_id === id);
  }

  async getSchedule(): Promise<ScheduleSnapshot> {
    this.schedule = this.named(await this.base.getSchedule());
    this.emit();
    return this.schedule;
  }

  subscribe(cb: (machines: MachineData[]) => void): () => void {
    this.listeners.add(cb);
    const stop = this.base.subscribe((machines) => {
      this.machines = machines;
      this.emit();
    });
    return () => {
      this.listeners.delete(cb);
      stop();
    };
  }

  subscribeSchedule(cb: (schedule: ScheduleSnapshot) => void): () => void {
    this.scheduleListeners.add(cb);
    const stop = this.base.subscribeSchedule((schedule) => {
      this.schedule = this.named(schedule);
      for (const listener of this.scheduleListeners) listener(this.schedule);
      this.emit();
    });
    return () => {
      this.scheduleListeners.delete(cb);
      stop();
    };
  }
}
