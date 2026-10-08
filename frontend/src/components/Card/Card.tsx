import styles from './Card.module.css'

interface CardProps {
  title?: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
  provenance?: React.ReactNode
}

export default function Card({ title, action, children, className, provenance }: CardProps) {
  return (
    <section
      className={`${styles.card}${className ? ` ${className}` : ''}`}
      aria-label={typeof title === 'string' ? title : undefined}
    >
      {title && (
        <div className={styles.headerRow}>
          {provenance !== undefined ? (
            <span className={styles.titleGroup}>
              <h2 className={styles.title}>{title}</h2>
              {provenance}
            </span>
          ) : (
            <h2 className={styles.title}>{title}</h2>
          )}
          {action}
        </div>
      )}
      <div className={styles.body}>{children}</div>
    </section>
  )
}
