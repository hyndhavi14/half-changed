import { createContext } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { BackendFactoryData } from '../data/backendApi'
import type { FrontendFactoryRef } from '../data/backendContracts'
import type { Factory } from '../data/types'

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
}

export const FactoryContext = createContext<FactoryContextValue | null>(null)
