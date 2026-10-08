import styles from './StatusChip.module.css'

export type StatusKind =
  | 'Running'
  | 'Idle'
  | 'Maintenance'
  | 'Saved'
  | 'Solar'
  | 'Peak'
  | 'Active'
  | 'Inactive'
  | 'Planned'
  | 'Not available'

interface StatusChipProps {
  status: StatusKind
  children?: React.ReactNode
}

const CLASSES: Record<StatusKind, string> = {
  Running: styles.running,
  Saved: styles.running,
  Idle: styles.idle,
  Maintenance: styles.terra,
  Peak: styles.terra,
  Solar: styles.solar,
  Active: styles.running,
  Inactive: styles.idle,
  Planned: styles.planned,
  'Not available': styles.unavailable,
}

export default function StatusChip({ status, children }: StatusChipProps) {
  return (
    <span
      className={`${styles.chip} ${CLASSES[status]}`}
    >
      {children ?? status}
    </span>
  )
}
