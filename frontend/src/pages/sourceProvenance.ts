// Shared mapping from an energy-source label (see DashboardPage/dashboardView.ts energySourceLabel)
// to the provenance tag shown in the UI. Pure function: no React, no value imports.
import type { Provenance } from '../data/provenance'

export interface SourceTag {
  provenance: Provenance
  label: string
}

export function sourceTag(label: string): SourceTag | null {
  switch (label) {
    case 'Measured': return { provenance: 'measured', label: 'Measured' }
    case 'Simulated': return { provenance: 'modeled', label: 'Simulated' }
    case 'Modeled': return { provenance: 'modeled', label: 'Modeled' }
    case 'Recorded': return { provenance: 'recorded', label: 'Recorded' }
    case 'Mixed sources': return { provenance: 'unclassified', label: 'Mixed sources' }
    default: return null
  }
}
