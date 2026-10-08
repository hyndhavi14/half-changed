import { useMemo } from 'react'
import type { BackendFactoryData } from './backendApi'
import {
  factoryHourlySeries,
  ganttLanes,
  machineLabels,
  optimizationOutcome,
  planChecks,
  processMoves,
  recommendation,
  schedulePair,
  workWindow,
} from './factoryInsight'
import { horizonSegments, tariffWindows } from '../pages/DashboardPage/dashboardView'

/** Everything the factory-aware pages derive from the selected factory, computed once per data load. */
export function useFactoryInsight(data: BackendFactoryData) {
  return useMemo(() => {
    const pair = schedulePair(data)
    const moves = processMoves(data, pair)
    const window = workWindow(pair)
    const windows = tariffWindows(data.tariffs)
    return {
      pair,
      labels: machineLabels(data),
      outcome: optimizationOutcome(pair),
      moves,
      moved: moves.filter((move) => move.moved),
      recommendation: recommendation(moves),
      checks: planChecks(data, pair.optimized),
      window,
      series: factoryHourlySeries(data, pair),
      lanes: ganttLanes(data, pair),
      bands: window && windows.length ? horizonSegments(windows, window.start, window.end, data.factory.timezone, Math.round((window.end - window.start) / 900_000)) : [],
      currency: data.factory.currency,
      timeZone: data.factory.timezone,
    }
  }, [data])
}

export type FactoryInsight = ReturnType<typeof useFactoryInsight>
