import Card from '../Card/Card'
import styles from './StateCard.module.css'

interface StateCardProps {
  kind: 'loading' | 'empty' | 'error'
  title: string
  message?: string
  action?: React.ReactNode
}

export default function StateCard({ kind, title, message, action }: StateCardProps) {
  const content = (
    <>
      {message && (
        <p className={styles.message} role={kind === 'error' ? 'alert' : undefined}>
          {message}
        </p>
      )}
      {action}
    </>
  )

  return (
    <Card title={title}>
      {kind === 'loading'
        ? <div role="status" aria-live="polite">{content}</div>
        : content}
    </Card>
  )
}
