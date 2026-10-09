import type { MachineData, ScheduleEntryData, ScheduleSnapshot } from './types';

/**
 * Planned machine state at one instant of a stored schedule.
 * This is what the optimizer PLANNED, not telemetry: a machine is "running" when a
 * schedule entry covers the instant, otherwise "idle". Power while running is the
 * entry's planned power (or the machine's rated power when the entry has none).
 */

const HOUR = 3_600_000;

export function clockIn(timeZone: string | null, at: number, withDay = true): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timeZone ?? undefined,
      ...(withDay ? { weekday: 'short' as const } : {}),
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(at));
  } catch {
    return new Date(at).toISOString().slice(11, 16);
  }
}

/** "Thu 8 Oct, 02:00" in the factory's time zone. */
export function dateIn(timeZone: string | null, at: number): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: timeZone ?? undefined, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).format(new Date(at));
  } catch {
    return new Date(at).toISOString().slice(0, 16).replace('T', ' ');
  }
}

/** First and last instant covered by entries, rounded out to whole hours. */
export function planBounds(schedule: ScheduleSnapshot | null): { start: number; end: number } | null {
  if (!schedule || schedule.entries.length === 0) return null;
  const starts = schedule.entries.map((entry) => Date.parse(entry.starts_at));
  const ends = schedule.entries.map((entry) => Date.parse(entry.ends_at));
  const start = Math.floor(Math.min(...starts) / HOUR) * HOUR;
  const end = Math.ceil(Math.max(...ends) / HOUR) * HOUR;
  return end > start ? { start, end } : null;
}

function entriesFor(schedule: ScheduleSnapshot | null, machineId: string): ScheduleEntryData[] {
  return (schedule?.entries ?? [])
    .filter((entry) => entry.machine_id === machineId)
    .sort((left, right) => Date.parse(left.starts_at) - Date.parse(right.starts_at));
}

export function applyPlan(
  machines: readonly MachineData[],
  schedule: ScheduleSnapshot | null,
  at: number | null,
  timeZone: string | null,
): MachineData[] {
  if (!schedule || at === null) return [...machines];
  return machines.map((machine) => {
    const entries = entriesFor(schedule, machine.machine_id);
    const current = entries.find((entry) => at >= Date.parse(entry.starts_at) && at < Date.parse(entry.ends_at));
    const next = entries.find((entry) => Date.parse(entry.starts_at) > at);
    const shown = current ?? next ?? null;
    const minutes = shown ? Math.round((Date.parse(shown.ends_at) - Date.parse(shown.starts_at)) / 60_000) : null;
    const name = shown?.process_name ?? 'scheduled process';
    return {
      ...machine,
      status: current ? 'running' : 'idle',
      power_kw: current ? current.power_kw ?? machine.rated_power_kw ?? null : 0,
      production_duration_minutes: minutes,
      start_time: shown ? clockIn(timeZone, Date.parse(shown.starts_at)) : undefined,
      end_time: shown ? clockIn(timeZone, Date.parse(shown.ends_at)) : undefined,
      message: current
        ? `Planned: ${name}`
        : next
          ? `Next planned run: ${name}`
          : entries.length
            ? 'All planned runs for this machine are finished.'
            : 'No run planned for this machine in this schedule.',
    };
  });
}

/** Planned factory load at an instant: sum of the running entries' planned power. */
export function plannedLoadKw(machines: readonly MachineData[]): number {
  return machines.reduce((sum, machine) => sum + (machine.status === 'running' ? machine.power_kw ?? 0 : 0), 0);
}

/** Hourly average solar power (kW) from 15-minute generation readings in kWh. */
export function hourlySolarKw(rows: readonly { recorded_at: string; generation_kwh: number | null; interval_minutes: number; machine_id: string | null }[]): Map<number, number> {
  const sums = new Map<number, { kwh: number; minutes: number }>();
  for (const row of rows) {
    if (row.machine_id !== null || row.generation_kwh === null) continue;
    const at = Date.parse(row.recorded_at);
    if (!Number.isFinite(at)) continue;
    const hour = Math.floor(at / HOUR) * HOUR;
    const sum = sums.get(hour) ?? { kwh: 0, minutes: 0 };
    sum.kwh += row.generation_kwh;
    sum.minutes += row.interval_minutes;
    sums.set(hour, sum);
  }
  const result = new Map<number, number>();
  for (const [hour, sum] of sums) {
    if (sum.minutes > 0) result.set(hour, (sum.kwh * 60) / sum.minutes);
  }
  return result;
}

export function solarAt(profile: ReadonlyMap<number, number> | null, at: number | null): number | null {
  if (!profile || at === null) return null;
  return profile.get(Math.floor(at / HOUR) * HOUR) ?? null;
}
