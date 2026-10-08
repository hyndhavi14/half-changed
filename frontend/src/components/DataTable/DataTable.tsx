import { useState, type ReactNode } from 'react'
import Button from '../Button/Button'
import styles from './DataTable.module.css'

export interface DataTableColumn {
  key: string
  header: string
  align?: 'left' | 'right'
  rowHeader?: boolean
}

export interface DataTableRow {
  key: string
  cells: Record<string, ReactNode>
}

interface DataTableProps {
  caption: string
  captionVisible?: boolean
  columns: DataTableColumn[]
  rows: DataTableRow[]
  emptyMessage: string
  pageSize?: number
}

export default function DataTable({
  caption,
  captionVisible = false,
  columns,
  rows,
  emptyMessage,
  pageSize,
}: DataTableProps) {
  const [page, setPage] = useState(1)
  const pagingSize = typeof pageSize === 'number' && Number.isFinite(pageSize) && pageSize > 0
    ? Math.floor(pageSize)
    : 0
  const visibleRows = pagingSize > 0 ? rows.slice(0, page * pagingSize) : rows
  const remaining = rows.length - visibleRows.length

  return (
    <>
      <div className={styles.scroller}>
        <table className={styles.table}>
          <caption className={captionVisible ? undefined : 'visually-hidden'}>{caption}</caption>
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={column.align === 'right' ? styles.right : undefined}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className={styles.empty} colSpan={Math.max(1, columns.length)}>
                  {emptyMessage}
                </td>
              </tr>
            ) : visibleRows.map((row) => (
              <tr key={row.key}>
                {columns.map((column) => {
                  const cell = row.cells[column.key] ?? null
                  const className = column.align === 'right' ? styles.right : undefined
                  return column.rowHeader ? (
                    <th
                      key={column.key}
                      scope="row"
                      className={className}
                      data-label={column.header}
                    >
                      {cell}
                    </th>
                  ) : (
                    <td
                      key={column.key}
                      className={className}
                      data-label={column.header}
                    >
                      {cell}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {remaining > 0 && pagingSize > 0 && (
        <Button
          className={styles.showMore}
          variant="secondary"
          onClick={() => setPage((current) => current + 1)}
        >
          Show more ({remaining} remaining)
        </Button>
      )}
    </>
  )
}
