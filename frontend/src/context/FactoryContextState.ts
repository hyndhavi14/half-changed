import { createContext } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { BackendFactoryData } from '../data/backendApi'
import type { FrontendFactoryRef } from '../data/backendContracts'
import type { Factory } from '../data/types'

/** The outcome of an optimization started in this browser session, for one factory. */
export interface OptimizationRun {
  status: 'running' | 'succeeded' | 'failed'
  message: string | null
  finishedAt: string | null
}

export interface FactoryContextValue {
  /** Legacy sample exposed only to the unmounted KitDemo component. */
  factory: Factory
  factories: FrontendFactoryRef[]
  selectedFactoryId: string
  backendData: BackendFactoryData | null
  setFactoryId: Dispatch<SetStateAction<string>>
  loading: boolean
  error: string | null
  reloadFactories: () => Promise<void>
  runOptimization: () => Promise<void>
  optimizing: boolean
  optimizationError: string | null
  /** Session run for the selected factory only; null when none was started for it. */
  optimizationRun: OptimizationRun | null
}

export const FactoryContext = createContext<FactoryContextValue | null>(null)
