// Text and comparison rows built from the factory insight model. Pure (node:test safe).
import type { CompareMetric } from './types'
import type { OptimizationOutcome } from './factoryInsight'
import { formatCurrency, formatKwh, formatPercent } from './format.ts'

export type Tone = 'good' | 'bad' | 'neutral'
export type InsightMetric = CompareMetric & { changeTone: Tone }

function hours(value: number): string {
  const minutes = Math.round(value * 60)
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

function row(label: string, before: number | null, after: number | null, format: (value: number) => string, better: 'lower' | 'higher'): InsightMetric | null {
  if (before === null || after === null || before < 0 || after < 0) return null
  const largest = Math.max(before, after)
  const diff = after - before
  let change = 'No change'
  let changeTone: Tone = 'neutral'
  if (Math.abs(diff) > 1e-9) {
    change = before === 0
      ? `${diff > 0 ? '+' : '−'}${format(Math.abs(diff))}`
      : `${diff < 0 ? '−' : '+'}${formatPercent(Math.abs(diff / before) * 100, 1)}`
    changeTone = (better === 'lower' ? diff < 0 : diff > 0) ? 'good' : 'bad'
  }
  return {
    label,
    baseline: format(before),
    optimized: format(after),
    baselinePct: largest === 0 ? 100 : (before / largest) * 100,
    optimizedPct: largest === 0 ? 100 : (after / largest) * 100,
    change,
    changeTone,
  }
}

/** Baseline vs optimized rows. Rows whose values are missing on either side are left out. */
export function beforeAfterMetrics(outcome: OptimizationOutcome, currency: string): InsightMetric[] {
  if (!outcome.comparable) return []
  const { baseline, optimized } = outcome
  const rows = [
    row('Grid energy', baseline.gridKwh, optimized.gridKwh, formatKwh, 'lower'),
    row('Solar used', baseline.solarKwh, optimized.solarKwh, formatKwh, 'higher'),
    row('Modeled electricity cost', baseline.cost, optimized.cost, (value) => formatCurrency(value, currency), 'lower'),
    {
      label: 'Production',
      baseline: `${baseline.entryCount} processes`,
      optimized: `${optimized.entryCount} processes`,
      baselinePct: 100,
      optimizedPct: optimized.entryCount === baseline.entryCount ? 100 : (optimized.entryCount / Math.max(1, baseline.entryCount)) * 100,
      change: optimized.entryCount === baseline.entryCount ? 'Same output' : 'Different output',
      changeTone: (optimized.entryCount === baseline.entryCount ? 'neutral' : 'bad') as Tone,
    },
    row('Completion time', baseline.completionHours, optimized.completionHours, hours, 'lower'),
  ]
  const result = rows.filter((value): value is InsightMetric => value !== null)
  if (outcome.costSaved !== null && baseline.cost !== null) {
    const saved = outcome.costSaved
    result.push({
      label: 'Savings',
      baseline: formatCurrency(0, currency),
      optimized: formatCurrency(saved, currency),
      baselinePct: 0,
      optimizedPct: saved > 0 ? 100 : 0,
      change: Math.abs(saved) < 1e-9 ? 'No change' : outcome.costSavedPct === null ? 'Not available' : `${saved > 0 ? '−' : '+'}${formatPercent(Math.abs(outcome.costSavedPct), 1)} cost`,
      changeTone: saved > 1e-9 ? 'good' : saved < -1e-9 ? 'bad' : 'neutral',
    })
  }
  return result
}

export interface Summary {
  tone: Tone
  title: string
  text: string
}

/** One short summary of what the optimization changed, for the dashboard. */
export function optimizationSummary(outcome: OptimizationOutcome, movedCount: number, hasRecommendation: boolean, currency: string, factoryName: string): Summary {
  if (!outcome.baseline.entryCount || !outcome.optimized.entryCount) {
    return { tone: 'neutral', title: 'No optimization yet', text: `${factoryName} has no stored baseline and optimized schedule pair. Run the optimizer to see what SolarShift changes.` }
  }
  if (!outcome.comparable) {
    return { tone: 'neutral', title: 'Schedules not comparable', text: 'The stored baseline and optimized schedules cover different processes or horizons, so no savings are claimed.' }
  }
  if (movedCount === 0 || !hasRecommendation) {
    return { tone: 'neutral', title: 'No beneficial schedule shift identified', text: 'The optimizer kept the baseline timing for this run: it found no cheaper feasible timing for the flexible work.' }
  }
  const parts: string[] = []
  if (outcome.gridSavedKwh !== null) parts.push(`${formatKwh(outcome.gridSavedKwh)} less grid energy`)
  if (outcome.costSaved !== null) parts.push(`${formatCurrency(outcome.costSaved, currency)} lower modeled cost${outcome.costSavedPct !== null ? ` (−${formatPercent(outcome.costSavedPct, 1)})` : ''}`)
  return {
    tone: (outcome.costSaved ?? 0) > 0 || (outcome.gridSavedKwh ?? 0) > 0 ? 'good' : 'neutral',
    title: 'Flexible work re-timed toward sunnier, cheaper hours',
    text: parts.length ? `${parts.join(' and ')}, with every process still scheduled inside the horizon.` : 'Solar and cost totals are not stored for these schedules.',
  }
}
