import type { CSSProperties } from 'react'
import type { ScheduleBlock } from '../../data/types'
import type { ProcessColorKey } from '../../data/scheduleView'
import styles from './GanttRow.module.css'

export type GanttBlock = ScheduleBlock & {
  processColor?: ProcessColorKey
  tooltip?: string
  leftFraction?: number
  widthFraction?: number
}

type TariffBand = {
  leftFraction: number
  widthFraction: number
  tone: 'peak' | 'mid' | 'off'
  label: string
}

const BLOCK_CLASSES: Record<ScheduleBlock['colorKey'], string> = {
  roast: styles.roast,
  grind: styles.grind,
  conche: styles.conche,
  temper: styles.temper,
  mould: styles.mould,
  pack: styles.pack,
}

function formatTime(hour: number) {
  return `${Math.floor(hour)}:${hour % 1 === 0 ? '00' : '30'}`
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max)

function hasFractions(block: GanttBlock): boolean {
  return Number.isFinite(block.leftFraction) && Number.isFinite(block.widthFraction)
}

interface GanttRowProps {
  label: string
  sublabel?: string
  blocks: GanttBlock[]
  height?: number
  trackStyle?: CSSProperties
  compact?: boolean
  autoLanes?: boolean
  bands?: TariffBand[]
}

export default function GanttRow({
  label,
  sublabel,
  blocks,
  height = 44,
  trackStyle,
  compact = false,
  autoLanes = false,
  bands,
}: GanttRowProps) {
  const laneByBlockId = new Map<string, number>()
  let laneCount = 1
  if (autoLanes) {
    const laneEnds: number[] = []
    for (const block of [...blocks].sort((left, right) => {
      const leftStart = hasFractions(left) ? left.leftFraction! : left.start
      const rightStart = hasFractions(right) ? right.leftFraction! : right.start
      return leftStart - rightStart
    })) {
      const blockStart = hasFractions(block) ? block.leftFraction! : block.start
      const blockEnd = hasFractions(block)
        ? block.leftFraction! + block.widthFraction!
        : block.end
      let lane = laneEnds.findIndex((end) => end <= blockStart)
      if (lane === -1) lane = laneEnds.length
      laneEnds[lane] = blockEnd
      laneByBlockId.set(block.id, lane)
    }
    laneCount = Math.max(1, laneEnds.length)
  }
  const trackHeight = autoLanes ? laneCount * 32 + 8 : height

  return (
    <div
      className={`${styles.row}${compact ? ` ${styles.compactRow}` : ''}`}
      role="group"
      aria-label={`${label} schedule`}
    >
      <div className={styles.label}>
        <strong>{label}</strong>
        {sublabel && <span>{sublabel}</span>}
      </div>
      <div className={styles.track} style={{ height: trackHeight, ...trackStyle }}>
        {bands?.map((band, index) => (
          <span
            aria-hidden="true"
            className={`${styles.band} ${styles[`band-${band.tone}`]}`}
            key={`${band.tone}-${band.leftFraction}-${index}`}
            title={band.label}
            style={{
              left: `${clamp(band.leftFraction, 0, 1) * 100}%`,
              width: `${Math.max(clamp(band.widthFraction, 0, 1) * 100, 0.2)}%`,
            }}
          />
        ))}
        {blocks.map((block) => (
          <span
            className={`${styles.block} ${block.processColor ? styles[block.processColor] : BLOCK_CLASSES[block.colorKey]}${compact ? ` ${styles.compact}` : ''}${autoLanes ? ` ${styles.lanedBlock}` : ''}${block.shifted ? ` ${styles.shifted}` : ''}`}
            key={block.id}
            style={{
              left: hasFractions(block)
                ? `${clamp(block.leftFraction!, 0, 1) * 100}%`
                : `${(block.start / 24) * 100}%`,
              width: hasFractions(block)
                ? `${Math.max(clamp(block.widthFraction!, 0, 1) * 100, 0.2)}%`
                : `${((block.end - block.start) / 24) * 100}%`,
              ...(autoLanes
                ? {
                    top: `${4 + (laneByBlockId.get(block.id) ?? 0) * 32}px`,
                    bottom: 'auto',
                    height: '28px',
                  }
                : {}),
            }}
            title={block.tooltip ?? `${block.processName} · ${formatTime(block.start)}–${formatTime(block.end)}`}
          >
            {block.processName}
          </span>
        ))}
      </div>
    </div>
  )
}
