// SolarShift is the solar-aware hackathon demonstration on the Demo Chocolate Factory.
// Other factories use the general BYTE ME scheduler, so their pages never claim SolarShift.
// Pure (node:test safe).

export const SOLARSHIFT_DEMO_SLUG = 'demo-chocolate-factory'
export const SOLARSHIFT_DEMO_NAME = 'Demo Chocolate Factory'

export interface SolarShiftScope {
  /** True only for the SolarShift demonstration factory. */
  enabled: boolean
  /** Who moved the work, for labels such as "Moved by …". */
  mover: 'SolarShift' | 'the optimizer'
  /** Labels for the before/after toggle. */
  before: string
  after: string
}

export function solarShiftScope(factory: { slug?: string | null }): SolarShiftScope {
  const enabled = factory.slug === SOLARSHIFT_DEMO_SLUG
  return enabled
    ? { enabled, mover: 'SolarShift', before: 'Before', after: 'After SolarShift' }
    : { enabled, mover: 'the optimizer', before: 'Baseline', after: 'Optimized' }
}
