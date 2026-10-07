import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { runOptimization as requestOptimization } from '../data/api'
import { listBackendFactories, loadBackendFactory } from '../data/backendApi'
import type { BackendFactoryData } from '../data/backendApi'
import type { FrontendFactoryRef } from '../data/backendContracts'
import factories from '../data/factories'
import { FactoryContext } from './FactoryContextState'

const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true'

export function FactoryProvider({ children }: { children: ReactNode }) {
  const [factoryId, setFactoryId] = useState('')
  const [apiFactories, setApiFactories] = useState<FrontendFactoryRef[]>([])
  const [backendData, setBackendData] = useState<BackendFactoryData | null>(null)
  const factory = factories[0]
  const [loading, setLoading] = useState(!USE_MOCK)
  const [error, setError] = useState<string | null>(null)
  const [optimizing, setOptimizing] = useState(false)
  const [optimizationError, setOptimizationError] = useState<string | null>(null)
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
    if (!selectedId) {
      setOptimizationError('Select a persisted factory before running optimization.')
      return
    }
    setOptimizing(true)
    setOptimizationError(null)
    try {
      await requestOptimization(selectedId)
      setBackendData(await loadBackendFactory(selectedId))
    } catch (optimizationFailure) {
      const message =
        optimizationFailure instanceof Error
          ? optimizationFailure.message
          : 'Optimization could not be completed.'
      setOptimizationError(message)
    } finally {
      setOptimizing(false)
    }
  }, [factoryId])

  const value = useMemo(
    () => ({
      factory,
      factories: allFactories,
      selectedFactoryId: factoryId,
      backendData,
      setFactoryId,
      loading,
      error,
      reloadFactories,
      runOptimization: optimizeFactory,
      optimizing,
      optimizationError,
    }),
    [
      factory,
      allFactories,
      factoryId,
      backendData,
      loading,
      error,
      reloadFactories,
      optimizeFactory,
      optimizing,
      optimizationError,
    ],
  )

  return (
    <FactoryContext.Provider value={value}>
      {children}
    </FactoryContext.Provider>
  )
}
