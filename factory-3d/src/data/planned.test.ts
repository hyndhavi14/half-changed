import { describe, expect, it } from 'vitest';
import { applyPlan, hourlySolarKw, planBounds, plannedLoadKw, solarAt } from './planned';
import type { MachineData, ScheduleSnapshot } from './types';

const machine = (id: string, rated: number | null): MachineData => ({
  machine_id: id, name: id, status: 'unknown', power_kw: null, rated_power_kw: rated, production_duration_minutes: null,
});
const schedule: ScheduleSnapshot = {
  id: 's', factory_id: 'f', name: 'Optimized', version: 1, status: 'draft',
  horizon_start: '2026-10-08T00:00:00Z', horizon_end: '2026-10-09T00:00:00Z',
  entries: [
    { id: 'e1', schedule_id: 's', machine_id: 'm1', process_id: 'p1', process_name: 'Roast', production_order_id: null, starts_at: '2026-10-08T10:00:00Z', ends_at: '2026-10-08T12:00:00Z', sequence: 0, power_kw: 250 },
    { id: 'e2', schedule_id: 's', machine_id: 'm2', process_id: 'p2', process_name: 'Conche', production_order_id: null, starts_at: '2026-10-08T13:00:00Z', ends_at: '2026-10-08T15:30:00Z', sequence: 1, power_kw: null },
  ],
};

describe('planned machine state', () => {
  it('marks machines running only inside their planned runs, with planned power', () => {
    const at = Date.parse('2026-10-08T11:00:00Z');
    const [m1, m2, m3] = applyPlan([machine('m1', 300), machine('m2', 180), machine('pv', null)], schedule, at, 'UTC');
    expect(m1.status).toBe('running');
    expect(m1.power_kw).toBe(250);
    expect(m1.message).toBe('Planned: Roast');
    expect(m2.status).toBe('idle');
    expect(m2.power_kw).toBe(0);
    expect(m2.start_time).toBe('Thu 13:00');
    expect(m3.message).toMatch(/No run planned/);
    expect(plannedLoadKw([m1, m2, m3])).toBe(250);
  });

  it('falls back to rated power when the run stores none and leaves data untouched without a plan time', () => {
    const at = Date.parse('2026-10-08T14:00:00Z');
    expect(applyPlan([machine('m2', 180)], schedule, at, 'UTC')[0].power_kw).toBe(180);
    expect(applyPlan([machine('m2', 180)], schedule, null, 'UTC')[0].status).toBe('unknown');
  });

  it('bounds the plan to whole hours around the entries', () => {
    expect(planBounds(schedule)).toEqual({ start: Date.parse('2026-10-08T10:00:00Z'), end: Date.parse('2026-10-08T16:00:00Z') });
    expect(planBounds(null)).toBeNull();
  });

  it('turns 15-minute site generation into hourly average kW and ignores machine-level rows', () => {
    const profile = hourlySolarKw([
      { recorded_at: '2026-10-08T12:00:00Z', generation_kwh: 10, interval_minutes: 15, machine_id: null },
      { recorded_at: '2026-10-08T12:15:00Z', generation_kwh: 20, interval_minutes: 15, machine_id: null },
      { recorded_at: '2026-10-08T12:30:00Z', generation_kwh: 30, interval_minutes: 15, machine_id: null },
      { recorded_at: '2026-10-08T12:45:00Z', generation_kwh: 40, interval_minutes: 15, machine_id: null },
      { recorded_at: '2026-10-08T12:45:00Z', generation_kwh: 999, interval_minutes: 15, machine_id: 'm1' },
    ]);
    expect(solarAt(profile, Date.parse('2026-10-08T12:40:00Z'))).toBe(100);
    expect(solarAt(profile, Date.parse('2026-10-08T13:10:00Z'))).toBeNull();
  });
});
