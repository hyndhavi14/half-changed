export type Provenance =
  | 'recorded'
  | 'measured'
  | 'modeled'
  | 'planned'
  | 'assumption'
  | 'unavailable'
  | 'unclassified'

export const PROVENANCE_LABEL: Record<Provenance, string> = {
  recorded: 'Recorded',
  measured: 'Measured',
  modeled: 'Modeled',
  planned: 'Planned',
  assumption: 'Assumption',
  unavailable: 'Not available',
  unclassified: 'Not classified',
}

export function energySourceProvenance(source: unknown): Provenance {
  if (typeof source !== 'string') return 'unclassified'
  const normalized = source.toLowerCase()
  if (normalized === 'measured') return 'measured'
  if (normalized === 'simulated' || normalized.startsWith('modeled')) return 'modeled'
  return 'unclassified'
}
