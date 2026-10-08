// Phase 7 - Compare page view helpers. Pure functions, no React.
import type { BackendFactoryData } from '../../data/backendApi'
import { activeWindow, ganttRows, type GanttBlockView, type StoredSchedule } from '../DashboardPage/dashboardView.ts'

function plainRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
}

export type ObjectiveKind = 'cost' | 'solar'

/**
 * The objective stored on the optimization request that produced the schedule.
 * Mirrors backend/lib/optimizer/pythonPayload.ts: an empty objective, { objective: "cost" } or
 * { cost: 1 } means cost; { objective: "solar" } means solar. Anything else is reported as unknown.
 */
export function requestObjective(
  data: Pick<BackendFactoryData, 'optimizationRequests'>,
  schedule: StoredSchedule | undefined,
): ObjectiveKind | null {
  if (!schedule || typeof schedule.optimizationRequestId !== 'string') return null
  const request = data.optimizationRequests.find((item) => item.id === schedule.optimizationRequestId)
  if (!request) return null
  const objective = plainRecord(request.objective)
  if (!objective) return null
  const keys = Object.keys(objective)
  if (keys.length === 0) return 'cost'
  if (keys.length === 1 && objective.objective === 'solar') return 'solar'
  if (keys.length === 1 && objective.objective === 'cost') return 'cost'
  if (keys.length === 1 && objective.cost === 1) return 'cost'
  return null
}

/** Plain-language description of what the optimizer objective minimises or maximises (from optimizer.py V2/V3). */
export function objectiveText(kind: ObjectiveKind | null): string {
  if (kind === 'cost') return 'Objective: minimise modeled grid energy cost, using the available solar first; shorter makespan breaks ties.'
  if (kind === 'solar') return 'Objective: maximise the solar energy allocated to processes; shorter makespan breaks ties.'
  return 'Objective: not recorded for this schedule.'
}

/** One window, in whole hours, that contains the work of both schedules so the two rows share a time axis. */
export function sharedWindow(baseline: StoredSchedule, optimized: StoredSchedule): StoredSchedule {
  const merged: StoredSchedule = { ...optimized, entries: [...baseline.entries, ...optimized.entries] }
  const window = activeWindow(merged)
  return { ...optimized, horizonStart: window.horizonStart, horizonEnd: window.horizonEnd }
}

/** All blocks of one schedule positioned on the shared window (one Gantt row per schedule, like the original page). */
export function timelineBlocks(
  data: Pick<BackendFactoryData, 'machines' | 'processes' | 'factory'>,
  schedule: StoredSchedule,
  window: StoredSchedule,
  baseline: StoredSchedule | undefined,
): GanttBlockView[] {
  const positioned: StoredSchedule = { ...schedule, horizonStart: window.horizonStart, horizonEnd: window.horizonEnd }
  return ganttRows(data, positioned, baseline).flatMap((row) => row.blocks)
}
