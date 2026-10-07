import { describe, expect, it, vi } from 'vitest';
import {
  ApiMachineDataProvider,
  mapBackendMachine,
} from './ApiMachineDataProvider';

const factoryId = '11111111-1111-4111-8111-111111111111';
const machineId = '22222222-2222-4222-8222-222222222222';
const scheduleId = '33333333-3333-4333-8333-333333333333';
const entryId = '44444444-4444-4444-8444-444444444444';
const processId = '55555555-5555-4555-8555-555555555555';
const startsAt = '2042-08-01T09:00:00+05:30';
const endsAt = '2042-08-01T09:30:00+05:30';

function provider(fetchImpl: typeof fetch, options: { pollMs?: number } = {}) {
  return new ApiMachineDataProvider({
    baseUrl: 'http://localhost:3000/api/v1',
    factoryId,
    scheduleId,
    headers: { Authorization: 'Bearer local-demo-token' },
    fetchImpl,
    ...(options.pollMs === undefined ? {} : { pollMs: options.pollMs }),
  });
}

function machineRow() {
  return {
    id: machineId,
    factory_id: factoryId,
    slug: 'roasting-drum',
    name: 'Roasting Drum',
    rated_power_kw: 12.5,
  };
}

function scheduleRow() {
  return {
    id: scheduleId,
    factory_id: factoryId,
    name: 'Demo optimized draft',
    version: 2,
    status: 'draft',
    horizon_start: '2042-08-01T08:00:00+05:30',
    horizon_end: '2042-08-01T10:00:00+05:30',
    entries: [
      {
        id: entryId,
        schedule_id: scheduleId,
        machine_id: machineId,
        process_id: processId,
        production_order_id: null,
        starts_at: startsAt,
        ends_at: endsAt,
        sequence: 1,
      },
    ],
  };
}

describe('ApiMachineDataProvider', () => {
  it('keeps backend machine UUIDs canonical and does not infer telemetry', () => {
    const machine = mapBackendMachine(machineRow(), factoryId);

    expect(machine).toEqual({
      machine_id: machineId,
      layout_id: 'roaster',
      name: 'Roasting Drum',
      status: 'unknown',
      power_kw: null,
      rated_power_kw: 12.5,
      production_duration_minutes: null,
    });
  });

  it('retains unknown-slug machines instead of assigning a made-up layout', () => {
    const machine = mapBackendMachine(
      { ...machineRow(), slug: 'solar-pv' },
      factoryId,
    );

    expect(machine.machine_id).toBe(machineId);
    expect(machine.layout_id).toBeUndefined();
    expect(machine.status).toBe('unknown');
    expect(machine.power_kw).toBeNull();
  });

  it('reads the selected factory machines with bearer auth and UUID identity', async () => {
    let requestedUrl = '';
    let authorization: string | null = null;
    const fetchImpl: typeof fetch = async (input, init) => {
      requestedUrl = String(input);
      authorization = new Headers(init?.headers).get('Authorization');
      return Response.json({ data: [machineRow()], meta: { total: 1 } });
    };

    const machines = await provider(fetchImpl).getMachines();

    expect(requestedUrl).toBe(
      `http://localhost:3000/api/v1/factories/${factoryId}/machines?limit=200&offset=0`,
    );
    expect(authorization).toBe('Bearer local-demo-token');
    expect(machines).toHaveLength(1);
    expect(machines[0]?.machine_id).toBe(machineId);
  });

  it('loads the selected stored schedule and preserves exact offset timestamps', async () => {
    let authorization: string | null = null;
    const fetchImpl: typeof fetch = async (_input, init) => {
      authorization = new Headers(init?.headers).get('Authorization');
      return Response.json({ data: scheduleRow() });
    };

    const schedule = await provider(fetchImpl).getSchedule();

    expect(authorization).toBe('Bearer local-demo-token');
    expect(schedule.id).toBe(scheduleId);
    expect(schedule.factory_id).toBe(factoryId);
    expect(schedule.status).toBe('draft');
    expect(schedule.entries[0]).toMatchObject({
      id: entryId,
      machine_id: machineId,
      process_id: processId,
      starts_at: startsAt,
      ends_at: endsAt,
    });
  });

  it('rejects a schedule from another factory instead of mapping it', async () => {
    const fetchImpl: typeof fetch = async () =>
      Response.json({
        data: { ...scheduleRow(), factory_id: '66666666-6666-4666-8666-666666666666' },
      });

    await expect(provider(fetchImpl).getSchedule()).rejects.toThrow(
      'outside the selected factory or schedule',
    );
  });

  it('surfaces backend auth errors and unsubscribes polling', async () => {
    const deniedFetch: typeof fetch = async () =>
      Response.json(
        { error: { code: 'unauthorized', message: 'Token expired.' } },
        { status: 401 },
      );
    await expect(provider(deniedFetch).getMachines()).rejects.toThrow('Token expired.');

    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn<typeof fetch>();
      const callback = vi.fn();
      const stop = provider(fetchImpl, { pollMs: 100 }).subscribe(callback);
      stop();
      await vi.advanceTimersByTimeAsync(500);
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(callback).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
