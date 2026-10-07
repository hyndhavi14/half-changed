/**
 * ByteMe <-> optimizer contract.
 *
 * ------------------------------------------------------------------------
 * READ THIS BEFORE EDITING ANYTHING IN THIS DIRECTORY
 * ------------------------------------------------------------------------
 *
 * The optimizer is a separate Python + OR-Tools library with a documented
 * public API. Backend/Python shape conversion lives in pythonPayload.ts and
 * pythonResponse.ts; process invocation lives in pythonSubprocess.ts.
 *
 * What lives here is only ByteMe's OWN side of the boundary:
 *
 *   - `OptimizationProblem`  what ByteMe knows how to describe, and
 *   - `OptimizationSolution`  the minimum shape ByteMe is willing to store.
 *
 * `lib/optimizer/payload.ts` turns database rows into an `OptimizationProblem`.
 * `lib/optimizer/client.ts` selects the explicitly configured HTTP or local
 * Python subprocess transport. Python v2 results are validated and projected
 * into an `OptimizationSolution` without changing the public Python API.
 */

/* -------------------------------------------------------------------------- */
/* Problem: what ByteMe sends                                                 */
/* -------------------------------------------------------------------------- */

export interface ProblemMachine {
  id: string
  slug: string
  name: string
  /** Free-text machine class, e.g. 'furnace'. Never an enum. */
  type: string | null
  ratedPowerKw: number | null
  minPowerKw: number | null
  maxPowerKw: number | null
  minRuntimeMinutes: number | null
  maxRuntimeMinutes: number | null
  /** Weekly calendar as stored, plus the raw availability object. */
  availability: Record<string, unknown>
  metadata: Record<string, unknown>
}

export interface ProblemProcess {
  id: string
  slug: string
  name: string
  description: string | null
  durationMinutes: number | null
  /** The machine this process runs on. */
  machineId: string
  powerRequirementKw: number | null
  productionQuantity: number | null
  unit: string | null
  metadata: Record<string, unknown>
}

export interface ProblemDependency {
  processId: string
  dependsOnProcessId: string
  dependencyType: string
  lagMinutes: number
}

export interface ProblemProductionOrder {
  id: string
  reference: string
  product: string | null
  quantity: number
  unit: string | null
  dueAt: string | null
  priority: number
  status: string
  requirements: Record<string, unknown>
}

export interface ProblemEnergyInterval {
  recordedAt: string
  intervalMinutes: number
  consumptionKwh: number
  generationKwh: number
  /** Null for site-level series. */
  machineId: string | null
}

export interface ProblemTariff {
  id: string
  slug: string
  name: string
  currency: string
  startTime: string
  endTime: string
  /** ISO weekdays, 1 = Monday. Null means every day. */
  daysOfWeek: number[] | null
  energyPricePerKwh: number
  demandChargePerKw: number | null
  fixedCharge: number | null
  taxRate: number | null
  effectiveFrom: string | null
  effectiveTo: string | null
  priority: number
}

/**
 * The complete, factory-agnostic description of one scheduling problem.
 *
 * `constraints` carries the scheduling limits merged from the factory `config`
 * and the caller. Keys are passed through to the optimizer untouched, so the
 * optimizer team decides what they mean.
 */
export interface OptimizationProblem {
  /** Schema version of this document. Bump when the shape changes. */
  schemaVersion: string
  /** ByteMe's correlation id, also stored as optimization_requests.reference. */
  requestReference: string
  factoryId: string

  factory: {
    slug: string
    name: string
    timezone: string
    currency: string
    /** Raw factory `config`, verbatim. */
    config: Record<string, unknown>
    metadata: Record<string, unknown>
  }

  horizon: {
    start: string | null
    end: string | null
  }

  machines: ProblemMachine[]
  processes: ProblemProcess[]
  dependencies: ProblemDependency[]
  productionOrders: ProblemProductionOrder[]
  energyData: ProblemEnergyInterval[]
  tariffs: ProblemTariff[]

  /** Objective weights, e.g. { cost: 1, peakDemand: 0.3 }. */
  objective: Record<string, unknown>
  /** Scheduling constraints, e.g. { maxParallelMachines: 4 }. */
  constraints: Record<string, unknown>
}

/* -------------------------------------------------------------------------- */
/* Solution: what ByteMe is willing to store                                  */
/* -------------------------------------------------------------------------- */

export interface SolutionEntry {
  machineId: string
  processId: string
  productionOrderId: string | null
  startsAt: string
  endsAt: string
  powerKw: number | null
  energyKwh: number | null
  cost: number | null
  quantity: number | null
  sequence: number
  metadata: Record<string, unknown>
}

export interface OptimizationSolution {
  /** Optimizer-reported objective value. Null when not reported. */
  objectiveValue: number | null
  totalEnergyCost: number | null
  totalEnergyKwh: number | null
  peakDemandKw: number | null
  entries: SolutionEntry[]
  /** Baseline plan when the Python API returned one; absent for other transports. */
  baselineEntries?: SolutionEntry[] | null
  /** Solver statistics: runtime, iterations, gap, solver name, ... */
  metrics: Record<string, unknown>
  /**
   * The optimizer's raw response, stored verbatim in
   * optimization_results.solution. Nothing in ByteMe reads its shape.
   */
  raw: unknown
}

/* -------------------------------------------------------------------------- */
/* Transport: the seam ByteMe calls                                           */
/* -------------------------------------------------------------------------- */

/**
 * How ByteMe reaches the optimizer.
 *
 * Two implementations are meaningful:
 *   - `HttpOptimizerTransport` in client.ts, used once the real endpoint is
 *     configured via environment variables.
 *   - a stub that throws `ServiceUnavailableError`, used until then.
 *
 * A transport that cannot reach a configured optimizer MUST throw rather than
 * return a plausible-looking solution.
 */
export interface OptimizerTransport {
  /** Human-readable identity, recorded in optimization_requests.adapter_metadata. */
  readonly name: string

  /**
   * True only when a real endpoint has been configured. When false every
   * solve attempt answers 503 and no schedule is ever fabricated.
   */
  readonly isConfigured: boolean

  /**
   * Submits a problem and returns the decoded solution.
   *
   * @throws ServiceUnavailableError when not configured.
   * @throws UpstreamError when the optimizer is unreachable or replies with
   *         something that cannot be decoded into an OptimizationSolution.
   */
  solve(problem: OptimizationProblem, signal?: AbortSignal): Promise<OptimizationSolution>
}

/* -------------------------------------------------------------------------- */
/* Summary of what is deliberately NOT specified                               */
/* -------------------------------------------------------------------------- */

/**
 * Known limitations of the initial mock integration.
 *
 *  1. Machine availability calendars are informational to Python, not enforced.
 *  2. Python defaults flexibility to true and machine capacity to one.
 *  3. Python does not model order-to-process relations, tariff demand/fixed
 *     charges, or taxes.
 *  4. The Python adapter accepts whole-hour horizons of at least 24 hours,
 *     exact whole-minute process durations, zero-lag finish-to-start edges
 *     and 0.2 kW solar precision. Energy profiles are full-horizon hourly
 *     values for this transport.
 */
export const OPEN_OPTIMIZER_QUESTIONS: readonly string[] = [
  'Set BYTEME_OPTIMIZER_TRANSPORT=python-subprocess and configure the Python executable',
  'Confirm that the complete selected horizon is covered by synthetic energy rows and applicable tariffs',
  'Review the documented optimizer limitations before treating the demo result as meaningful',
]

/** Version of the problem/solution document. Bump on breaking changes. */
export const OPTIMIZATION_SCHEMA_VERSION = '1.0.0'