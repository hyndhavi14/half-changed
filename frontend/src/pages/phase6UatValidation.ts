type JsonRecord = Record<string, unknown>

export interface ScheduleValidationContext {
  factoryId: string
  requestId: string
  resultId: string
  horizonStart: string
  horizonEnd: string
  processes: Array<{
    id: string
    machine_id: string
    duration_minutes: number
  }>
  machineIds: Set<string>
  orderIds: Set<string>
}

export interface PersistedSchedulePair {
  baseline: { schedule: JsonRecord; entries: JsonRecord[] }
  optimized: { schedule: JsonRecord; entries: JsonRecord[] }
}

export function canRunOptimization(input: {
  authPassed: boolean
  hasSnapshot: boolean
  optimizationAttempted: boolean
  busy: boolean
}): boolean {
  return input.authPassed &&
    input.hasSnapshot &&
    !input.optimizationAttempted &&
    !input.busy
}

export function authGateFailureState(optimizationAttempted: boolean) {
  return {
    authPassed: false,
    snapshot: null,
    outcome: null,
    events: [] as string[],
    optimizationAttempted,
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertUuid(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw new Error(`Invalid canonical UUID in ${label}.`)
  }
}

function assertUtcTimestamp(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== 'string' ||
    !/(Z|\+00:00)$/i.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new Error(`Expected an unchanged UTC timestamp in ${label}.`)
  }
}

function validateSchedule(
  value: unknown,
  kind: 'baseline' | 'optimized',
  context: ScheduleValidationContext,
): { schedule: JsonRecord; entries: JsonRecord[] } {
  if (!isRecord(value) || !isRecord(value.schedule) || !Array.isArray(value.entries)) {
    throw new Error(`Persisted ${kind} schedule response is invalid.`)
  }
  const { schedule } = value
  const metadata = schedule.metadata
  assertUuid(schedule.id, `${kind} schedule id`)
  assertUuid(schedule.factory_id, `${kind} factory id`)
  assertUuid(schedule.optimization_request_id, `${kind} request id`)
  assertUuid(schedule.optimization_result_id, `${kind} result id`)
  if (
    schedule.factory_id !== context.factoryId ||
    schedule.optimization_request_id !== context.requestId ||
    schedule.optimization_result_id !== context.resultId ||
    schedule.status !== 'draft' ||
    !isRecord(metadata) ||
    metadata.kind !== kind
  ) {
    throw new Error(`Persisted ${kind} schedule identity, status, or metadata is invalid.`)
  }

  assertUtcTimestamp(schedule.horizon_start, `${kind} horizon start`)
  assertUtcTimestamp(schedule.horizon_end, `${kind} horizon end`)
  if (
    Date.parse(schedule.horizon_start) !== Date.parse(context.horizonStart) ||
    Date.parse(schedule.horizon_end) !== Date.parse(context.horizonEnd)
  ) {
    throw new Error(`Persisted ${kind} schedule horizon differs from the optimizer request.`)
  }

  const processes = new Map(context.processes.map((process) => [process.id, process]))
  if (value.entries.length !== processes.size) {
    throw new Error(`Persisted ${kind} schedule does not contain every canonical process exactly once.`)
  }
  const seenEntries = new Set<string>()
  const seenProcesses = new Set<string>()
  const entries = value.entries.map((entry, index) => {
    if (!isRecord(entry)) throw new Error(`Persisted ${kind} schedule entry ${index} is invalid.`)
    assertUuid(entry.id, `${kind} schedule entry id`)
    assertUuid(entry.schedule_id, `${kind} entry schedule id`)
    assertUuid(entry.machine_id, `${kind} entry machine id`)
    assertUuid(entry.process_id, `${kind} entry process id`)
    if (
      seenEntries.has(entry.id) ||
      seenProcesses.has(entry.process_id) ||
      entry.schedule_id !== schedule.id
    ) {
      throw new Error(`Persisted ${kind} schedule has duplicate or mismatched entry identities.`)
    }
    seenEntries.add(entry.id)
    seenProcesses.add(entry.process_id)

    const process = processes.get(entry.process_id)
    if (
      !process ||
      !context.machineIds.has(entry.machine_id) ||
      entry.machine_id !== process.machine_id
    ) {
      throw new Error(`Persisted ${kind} schedule entry references a non-canonical machine or process.`)
    }
    if (
      entry.production_order_id !== null &&
      (typeof entry.production_order_id !== 'string' || !context.orderIds.has(entry.production_order_id))
    ) {
      throw new Error(`Persisted ${kind} schedule entry references a non-canonical production order.`)
    }
    assertUtcTimestamp(entry.starts_at, `${kind} entry start`)
    assertUtcTimestamp(entry.ends_at, `${kind} entry end`)
    const startsAt = Date.parse(entry.starts_at)
    const endsAt = Date.parse(entry.ends_at)
    if (
      startsAt < Date.parse(context.horizonStart) ||
      endsAt > Date.parse(context.horizonEnd) ||
      endsAt <= startsAt ||
      endsAt - startsAt !== process.duration_minutes * 60_000
    ) {
      throw new Error(`Persisted ${kind} schedule entry violates the exact-minute horizon contract.`)
    }
    return entry
  })
  if (seenProcesses.size !== processes.size) {
    throw new Error(`Persisted ${kind} schedule is missing a canonical process.`)
  }

  const byMachine = new Map<string, JsonRecord[]>()
  for (const entry of entries) {
    const machineEntries = byMachine.get(String(entry.machine_id)) ?? []
    machineEntries.push(entry)
    byMachine.set(String(entry.machine_id), machineEntries)
  }
  for (const machineEntries of byMachine.values()) {
    machineEntries.sort((left, right) => Date.parse(String(left.starts_at)) - Date.parse(String(right.starts_at)))
    for (let index = 1; index < machineEntries.length; index += 1) {
      const previous = machineEntries[index - 1]
      const current = machineEntries[index]
      if (previous && current && Date.parse(String(previous.ends_at)) > Date.parse(String(current.starts_at))) {
        throw new Error(`Persisted ${kind} schedule overlaps work on a machine.`)
      }
    }
  }

  return { schedule, entries }
}

export function identifyPersistedSchedulePair(
  schedules: unknown,
  context: ScheduleValidationContext,
): PersistedSchedulePair {
  if (!Array.isArray(schedules) || schedules.length !== 2) {
    throw new Error('Expected exactly one persisted baseline and one optimized schedule.')
  }
  const pair: Partial<PersistedSchedulePair> = {}
  const scheduleIds = new Set<string>()
  for (const candidate of schedules) {
    if (!isRecord(candidate) || !isRecord(candidate.schedule) || !isRecord(candidate.schedule.metadata)) {
      throw new Error('Persisted optimizer schedule is missing its identity metadata.')
    }
    const kind = candidate.schedule.metadata.kind
    if (kind !== 'baseline' && kind !== 'optimized') {
      throw new Error('Persisted optimizer schedule has an unexpected identity.')
    }
    const validated = validateSchedule(candidate, kind, context)
    if (scheduleIds.has(String(validated.schedule.id)) || pair[kind]) {
      throw new Error('Persisted optimizer schedule pair contains duplicate identities.')
    }
    scheduleIds.add(String(validated.schedule.id))
    pair[kind] = validated
  }
  if (!pair.baseline || !pair.optimized) {
    throw new Error('Persisted optimizer result must include baseline and optimized schedules.')
  }
  return { baseline: pair.baseline, optimized: pair.optimized }
}
