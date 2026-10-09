import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { runOptimization as requestOptimization } from '../data/api'
import { listBackendFactories, loadBackendFactory } from '../data/backendApi'
import type { BackendFactoryData } from '../data/backendApi'
import type { FrontendFactoryRef } from '../data/backendContracts'
import factories from '../data/factories'
import { FactoryContext, type OptimizationRun } from './FactoryContextState'

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true'

export function FactoryProvider({ children }: { children: ReactNode }) {
  const [factoryId, setFactoryId] = useState('')
  const [apiFactories, setApiFactories] = useState<FrontendFactoryRef[]>([])
  const [backendData, setBackendData] = useState<BackendFactoryData | null>(null)
  const factory = factories[0]
  const [loading, setLoading] = useState(!USE_MOCK)
  const [error, setError] = useState<string | null>(null)
  // Optimization runs are tracked per factory so a run (or its failure) never shows under another factory.
  const [runs, setRuns] = useState<Record<string, OptimizationRun>>({})
  const selectedRef = useRef('')
  useEffect(() => {
    selectedRef.current = factoryId
  }, [factoryId])
  const allFactories = apiFactories
  const loadFactories = useCallback(
    async () => {
      if (USE_MOCK) {
        setError('Explicit mock mode does not provide canonical Backend factory data.')
        setLoading(false)
        return
      }
      try {
        const loadedFactories = await listBackendFactories()
        setApiFactories(loadedFactories)
        setFactoryId((current) =>
          loadedFactories.some((item) => item.id === current)
            ? current
            : loadedFactories[0]?.id ?? '',
        )
        if (loadedFactories.length === 0) {
          setBackendData(null)
          setError(null)
        }
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Factory data could not be loaded.')
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  const reloadFactories = useCallback(() => {
    setLoading(true)
    setError(null)
    return loadFactories()
  }, [loadFactories])

  useEffect(() => {
    void loadFactories()
  }, [loadFactories])

  useEffect(() => {
    if (!factoryId || !apiFactories.some((item) => item.id === factoryId)) return
    let active = true
    setLoading(true)
    setError(null)
    // Never keep showing the previous factory's data while the newly selected one loads.
    setBackendData((current) => (current && current.factory.id === factoryId ? current : null))
    void loadBackendFactory(factoryId)
      .then((loaded) => {
        if (active) setBackendData(loaded)
      })
      .catch((loadError: unknown) => {
        if (active) {
          setBackendData(null)
          setError(loadError instanceof Error ? loadError.message : 'Factory data could not be loaded.')
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [factoryId, apiFactories])

  const optimizeFactory = useCallback(async () => {
    const selectedId = factoryId
    if (!selectedId) return
    setRuns((current) => ({ ...current, [selectedId]: { status: 'running', message: null, finishedAt: null } }))
    try {
      await requestOptimization(selectedId)
      const loaded = await loadBackendFactory(selectedId)
      // Only apply the result if the same factory is still selected; otherwise it is reloaded on return.
      if (selectedRef.current === selectedId) setBackendData(loaded)
      setRuns((current) => ({ ...current, [selectedId]: { status: 'succeeded', message: null, finishedAt: new Date().toISOString() } }))
    } catch (optimizationFailure) {
      const message =
        optimizationFailure instanceof Error
          ? optimizationFailure.message
          : 'Optimization could not be completed.'
      setRuns((current) => ({ ...current, [selectedId]: { status: 'failed', message, finishedAt: new Date().toISOString() } }))
    }
  }, [factoryId])

  const optimizationRun = runs[factoryId] ?? null
  const optimizing = optimizationRun?.status === 'running'
  const optimizationError = optimizationRun?.status === 'failed' ? optimizationRun.message : null
  const visibleData = backendData && backendData.factory.id === factoryId ? backendData : null

  const value = useMemo(
    () => ({
      factory,
      factories: allFactories,
      selectedFactoryId: factoryId,
      backendData: visibleData,
      setFactoryId,
      loading,
      error,
      reloadFactories,
      runOptimization: optimizeFactory,
      optimizing,
      optimizationError,
      optimizationRun,
    }),
    [
      factory,
      allFactories,
      factoryId,
      visibleData,
      loading,
      error,
      reloadFactories,
      optimizeFactory,
      optimizing,
      optimizationError,
      optimizationRun,
    ],
  )

  return (
    <FactoryContext.Provider value={value}>
      {children}
    </FactoryContext.Provider>
  )
}
