import { useFactory } from '../context/useFactory'
import type { BackendFactoryData } from './backendApi'
import { formatDateTime } from './format'
import { optimizationState } from './optimizationState'
import type { SchedulePair } from './factoryInsight'

/** Optimization state for the selected factory, shared by every page. */
export function useOptimizationState(data: BackendFactoryData, pair: SchedulePair) {
  const { optimizationRun, optimizing, runOptimization } = useFactory()
  const state = optimizationState({
    run: optimizationRun,
    hasResults: Boolean(pair.optimized),
    optimizationRequests: data.optimizationRequests,
    formatTime: (iso) => formatDateTime(iso, data.factory.timezone),
    factoryName: data.factory.name,
  })
  return { state, optimizing, run: () => void runOptimization() }
}
