// Label placement for Gantt blocks. Pure (node:test safe).

export type Placement = 'inside' | 'right' | 'left'

/** Rough pixel width of a 12px bold label (Inter averages about 7 px per character). */
function labelWidth(label: string): number {
  return label.length * 7 + 18
}

/**
 * Puts a block's name inside the block when it fits, otherwise beside it in the free gap
 * to its right (or left), so short processes stay readable on long timelines.
 */
export function placeLabel(
  block: { start: number; end: number; label: string },
  neighbours: readonly { start: number; end: number }[],
  pxPerMs: number,
): Placement {
  if (pxPerMs <= 0) return 'inside'
  const need = labelWidth(block.label)
  if ((block.end - block.start) * pxPerMs >= need) return 'inside'
  const after = neighbours.filter((other) => other.start >= block.end - 1).map((other) => other.start)
  const before = neighbours.filter((other) => other.end <= block.start + 1).map((other) => other.end)
  const gapRight = after.length ? (Math.min(...after) - block.end) * pxPerMs : Number.POSITIVE_INFINITY
  const gapLeft = before.length ? (block.start - Math.max(...before)) * pxPerMs : Number.POSITIVE_INFINITY
  if (gapRight >= need + 4) return 'right'
  if (gapLeft >= need + 4) return 'left'
  return 'inside'
}
