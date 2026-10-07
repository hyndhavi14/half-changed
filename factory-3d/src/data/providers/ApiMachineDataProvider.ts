import type {
  MachineData,
  MachineDataProvider,
  MachineStatus,
  ScheduleEntryData,
  ScheduleSnapshot,
  ScheduleStatus,
} from '../types';

export interface ApiMachineDataProviderOptions {
  /** API base URL, e.g. "http://localhost:3000/api/v1". */
  baseUrl: string;
  /** Canonical backend factory UUID. */
  factoryId: string;
  /** Exact stored backend schedule UUID selected by the frontend. */
  scheduleId: string;
  /** Poll interval for subscribe(); 0 disables polling. Default 10 s. */
  pollMs?: number;
  fetchImpl?: typeof fetch;
  headers?: Record<string, string>;
  onError?: (error: Error, resource: ApiDataResource) => void;
  onRecovery?: (resource: ApiDataResource) => void;
}

const STATUSES: MachineStatus[] = ['running', 'idle', 'maintenance', 'offline', 'warning', 'unknown'];
const SCHEDULE_STATUSES: ScheduleStatus[] = [
  'draft',
  'published',
  'active',
  'completed',
  'superseded',
  'cancelled',
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type ApiDataResource = 'machines' | 'schedule';

type Json = Record<string, unknown>;
const stringValue = (value: unknown) => (value == null ? undefined : String(value));
const numberValue = (value: unknown, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};
const clockValue = (value: unknown) => {
  const text = stringValue(value);
  if (!text) return undefined;
  if (/^\d{1,2}:\d{2}$/.test(text)) return text.padStart(5, '0');
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toTimeString().slice(0, 5);
};

function record(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function backendString(raw: Json, key: string): string {
  const value = raw[key];
  if (typeof value !== 'string' || !value) throw new Error(`Backend record has invalid ${key}.`);
  return value;
}

function backendUuid(raw: Json, key: string): string {
  const value = backendString(raw, key);
  if (!UUID.test(value)) throw new Error(`Backend record has invalid UUID ${key}.`);
  return value;
}

function backendTimestamp(raw: Json, key: string): string {
  const value = backendString(raw, key);
  if (!/(Z|[+-]\d{2}:\d{2})$/i.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(`Backend record has invalid offset-aware timestamp ${key}.`);
  }
  return value;
}

function backendNullableNumber(raw: Json, key: string): number | null {
  const value = raw[key];
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Backend machine has invalid ${key}.`);
  }
  return value;
}

const MACHINE_LAYOUT: Record<string, string> = {
  'roasting-drum': 'roaster',
  'refining-conche': 'conche',
  'tempering-unit': 'tempering',
  'moulding-line': 'moulding',
  'cooling-tunnel': 'cooling',
  'packing-cell': 'packaging',
};

/** Maps a backend machine row without inventing operational telemetry. */
export function mapBackendMachine(raw: Json, expectedFactoryId?: string): MachineData {
  const id = backendUuid(raw, 'id');
  const factoryId = backendUuid(raw, 'factory_id');
  if (expectedFactoryId && factoryId !== expectedFactoryId) {
    throw new Error('Backend returned a machine outside the selected factory.');
  }
  const slug = backendString(raw, 'slug');
  return {
    machine_id: id,
    layout_id: MACHINE_LAYOUT[slug],
    name: backendString(raw, 'name'),
    status: 'unknown',
    power_kw: null,
    rated_power_kw: backendNullableNumber(raw, 'rated_power_kw'),
    production_duration_minutes: null,
  };
}

function mapScheduleEntry(value: unknown, scheduleId: string): ScheduleEntryData {
  if (!record(value)) throw new Error('Backend schedule contains an invalid entry.');
  const id = backendUuid(value, 'id');
  const entryScheduleId = backendUuid(value, 'schedule_id');
  if (entryScheduleId !== scheduleId) {
    throw new Error('Backend schedule entry refers to a different schedule.');
  }
  const startsAt = backendTimestamp(value, 'starts_at');
  const endsAt = backendTimestamp(value, 'ends_at');
  if (Date.parse(startsAt) >= Date.parse(endsAt)) {
    throw new Error('Backend schedule entry has a non-positive interval.');
  }
  const productionOrderId = value.production_order_id;
  if (productionOrderId !== null &&
      (typeof productionOrderId !== 'string' || !UUID.test(productionOrderId))) {
    throw new Error('Backend schedule entry has an invalid production_order_id.');
  }
  if (typeof value.sequence !== 'number' || !Number.isSafeInteger(value.sequence)) {
    throw new Error('Backend schedule entry has an invalid sequence.');
  }
  return {
    id,
    schedule_id: entryScheduleId,
    machine_id: backendUuid(value, 'machine_id'),
    process_id: backendUuid(value, 'process_id'),
    ...(typeof value.process_name === 'string' ? { process_name: value.process_name } : {}),
    ...(typeof value.machine_name === 'string' ? { machine_name: value.machine_name } : {}),
    production_order_id: productionOrderId,
    starts_at: startsAt,
    ends_at: endsAt,
    sequence: value.sequence,
  };
}

export function mapBackendSchedule(
  value: unknown,
  expectedFactoryId: string,
  expectedScheduleId: string,
): ScheduleSnapshot {
  if (!record(value) || !Array.isArray(value.entries)) {
    throw new Error('Backend selected schedule has an invalid shape.');
  }
  const id = backendUuid(value, 'id');
  const factoryId = backendUuid(value, 'factory_id');
  if (id !== expectedScheduleId || factoryId !== expectedFactoryId) {
    throw new Error('Backend returned a schedule outside the selected factory or schedule.');
  }
  const status = backendString(value, 'status');
  if (!SCHEDULE_STATUSES.includes(status as ScheduleStatus)) {
    throw new Error('Backend schedule has an unsupported status.');
  }
  if (typeof value.version !== 'number' ||
      !Number.isSafeInteger(value.version) ||
      value.version < 1) {
    throw new Error('Backend schedule has an invalid version.');
  }
  const horizonStart = backendTimestamp(value, 'horizon_start');
  const horizonEnd = backendTimestamp(value, 'horizon_end');
  if (Date.parse(horizonStart) >= Date.parse(horizonEnd)) {
    throw new Error('Backend schedule has an invalid horizon.');
  }
  const entries = value.entries.map((entry) => mapScheduleEntry(entry, id));
  if (entries.some((entry) =>
    Date.parse(entry.starts_at) < Date.parse(horizonStart) ||
    Date.parse(entry.ends_at) > Date.parse(horizonEnd)
  )) {
    throw new Error('Backend schedule contains an entry outside its horizon.');
  }
  return {
    id,
    factory_id: factoryId,
    name: backendString(value, 'name'),
    version: value.version,
    status: status as ScheduleStatus,
    horizon_start: horizonStart,
    horizon_end: horizonEnd,
    entries,
  };
}

export function mapMachine(raw: Json): MachineData {
  const statusRaw = String(raw.status ?? raw.state ?? 'offline').toLowerCase();
  const status = (STATUSES as string[]).includes(statusRaw) ? (statusRaw as MachineStatus) : 'offline';
  return {
    machine_id: String(raw.machine_id ?? raw.id ?? ''),
    layout_id: stringValue(raw.layout_id),
    name: String(raw.name ?? raw.machine_name ?? raw.machine_id ?? raw.id ?? 'Machine'),
    status,
    power_kw: raw.power_kw == null && raw.power == null && raw.powerKw == null
      ? null
      : numberValue(raw.power_kw ?? raw.power ?? raw.powerKw),
    rated_power_kw: raw.rated_power_kw == null ? null : numberValue(raw.rated_power_kw),
    production_duration_minutes: raw.production_duration_minutes == null &&
      raw.duration_minutes == null && raw.duration == null
      ? null
      : numberValue(raw.production_duration_minutes ?? raw.duration_minutes ?? raw.duration),
    start_time: clockValue(raw.start_time ?? raw.start),
    end_time: clockValue(raw.end_time ?? raw.end),
    message: stringValue(raw.message ?? raw.note),
  };
}

export class ApiMachineDataProvider implements MachineDataProvider {
  private opts: ApiMachineDataProviderOptions & { pollMs: number; fetchImpl: typeof fetch };

  constructor(opts: ApiMachineDataProviderOptions) {
    if (!UUID.test(opts.factoryId) || !UUID.test(opts.scheduleId)) {
      throw new Error('Factory-3D requires canonical backend factory and schedule UUIDs.');
    }
    this.opts = { pollMs: 10000, fetchImpl: fetch.bind(globalThis), ...opts };
  }

  async getMachines(signal?: AbortSignal): Promise<MachineData[]> {
    const rows: MachineData[] = [];
    const limit = 200;
    for (let offset = 0; ; offset += limit) {
      const payload = await this.requestJson(
        this.url(
          `/factories/${encodeURIComponent(this.opts.factoryId)}/machines?limit=${limit}&offset=${offset}`,
        ),
        signal,
      );
      if (!record(payload) || !Array.isArray(payload.data)) {
        throw new Error('Backend machines response has an invalid data envelope.');
      }
      if (!payload.data.every(record)) {
        throw new Error('Backend machines response contains an invalid row.');
      }
      rows.push(...payload.data.map((row) => mapBackendMachine(row, this.opts.factoryId)));

      const meta = record(payload.meta) ? payload.meta : null;
      const total = meta && typeof meta.total === 'number' &&
        Number.isSafeInteger(meta.total) && meta.total >= 0
        ? meta.total
        : null;
      if (total !== null ? rows.length >= total : payload.data.length < limit) break;
      if (payload.data.length === 0) {
        throw new Error('Backend machine pagination did not make progress.');
      }
    }
    const ids = new Set<string>();
    const layoutIds = new Set<string>();
    for (const machine of rows) {
      if (ids.has(machine.machine_id)) {
        throw new Error('Backend returned a duplicate machine UUID.');
      }
      ids.add(machine.machine_id);
      if (machine.layout_id) {
        if (layoutIds.has(machine.layout_id)) {
          throw new Error('Backend machine slugs map to duplicate scene layout IDs.');
        }
        layoutIds.add(machine.layout_id);
      }
    }
    return rows;
  }

  async getSchedule(signal?: AbortSignal): Promise<ScheduleSnapshot> {
    const payload = await this.requestJson(
      this.url(
        `/factories/${encodeURIComponent(this.opts.factoryId)}/schedules/${encodeURIComponent(this.opts.scheduleId)}`,
      ),
      signal,
    );
    if (!record(payload) || !('data' in payload)) {
      throw new Error('Backend schedule response has an invalid data envelope.');
    }
    return mapBackendSchedule(payload.data, this.opts.factoryId, this.opts.scheduleId);
  }

  async getMachine(id: string): Promise<MachineData | undefined> {
    return (await this.getMachines()).find((machine) => machine.machine_id === id);
  }

  subscribe(cb: (machines: MachineData[]) => void): () => void {
    if (!this.opts.pollMs) return () => {};
    return this.poll(
      'machines',
      async (signal) => {
        const machines = await this.getMachines(signal);
        if (!signal.aborted) cb(machines);
      },
      'Backend machine refresh failed.',
    );
  }

  subscribeSchedule(cb: (schedule: ScheduleSnapshot) => void): () => void {
    if (!this.opts.pollMs) return () => {};
    return this.poll(
      'schedule',
      async (signal) => {
        const schedule = await this.getSchedule(signal);
        if (!signal.aborted) cb(schedule);
      },
      'Backend schedule refresh failed.',
    );
  }

  private url(path: string): URL {
    const baseUrl = this.opts.baseUrl.replace(/\/+$/, '');
    return new URL(
      `${baseUrl}${path}`,
      globalThis.location?.origin ?? 'http://localhost',
    );
  }

  private async requestJson(url: URL, signal?: AbortSignal): Promise<unknown> {
    let response: Response;
    try {
      response = await this.opts.fetchImpl(url, {
        headers: { Accept: 'application/json', ...this.opts.headers },
        signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw error;
      throw new Error(
        error instanceof Error
          ? `Could not connect to the ByteMe API: ${error.message}`
          : 'Could not connect to the ByteMe API.',
        { cause: error },
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw new Error('The ByteMe API returned invalid JSON.', { cause: error });
    }
    if (!response.ok) {
      const message =
        record(payload) &&
        record(payload.error) &&
        typeof payload.error.message === 'string'
          ? payload.error.message
          : `The ByteMe API returned ${response.status} ${response.statusText}.`;
      throw new Error(message);
    }
    return payload;
  }

  private poll(
    resource: ApiDataResource,
    run: (signal: AbortSignal) => Promise<void>,
    fallback: string,
  ): () => void {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | undefined;

    const poll = async () => {
      controller = new AbortController();
      try {
        await run(controller.signal);
        if (!stopped) this.opts.onRecovery?.(resource);
      } catch (error) {
        if (!stopped && !(error instanceof Error && error.name === 'AbortError')) {
          const failure = error instanceof Error ? error : new Error(fallback);
          if (this.opts.onError) this.opts.onError(failure, resource);
          else console.error('[FactoryTwin] backend refresh failed', failure);
        }
      } finally {
        if (!stopped) timer = setTimeout(poll, this.opts.pollMs);
      }
    };

    timer = setTimeout(poll, this.opts.pollMs);
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
    };
  }
}
