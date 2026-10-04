import { Fragment, type ReactNode } from 'react'

// Phase 5a. Admin lists want a table: many short fields per row, scanned
// down a column rather than read one at a time. A real <table> is right on a
// laptop and wrong on a 360px phone, where six columns either overflow or
// squeeze to a few characters each.
//
// So this renders the same data twice and lets CSS pick: a real table from
// `md:` (768px) up, and a stacked card per row below it, where each cell
// becomes a label/value pair. Nothing is dropped on the narrow layout unless
// a column asks for it -- small screens get a taller card, not less
// information.
//
// The switch is `md:`, not `sm:`: at 640px a six-column table is already
// crushed, so tablets are better served by cards. Above it the table keeps a
// min-width and its wrapper scrolls, so a wide row scrolls within the table
// rather than dragging the whole page sideways.
//
// Both branches come from one `columns` array, so a new field can't drift
// between the two layouts.

export type Column<T> = {
  /** Stable key, also the React key for the cell. */
  key: string
  header: string
  cell: (row: T) => ReactNode
  /** 'hidden' keeps a column out of the mobile card -- use it only when
   *  `primary` already carries that value. */
  mobile?: 'inline' | 'hidden'
  align?: 'left' | 'right'
  /** Tailwind width hint for the desktop column, e.g. 'w-32'. */
  width?: string
}

type DataTableProps<T> = {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  /** Headline block for the mobile card (name + code, title + date...). On
   *  desktop it becomes the first column, so don't repeat it in `columns`. */
  primary: { header: string; cell: (row: T) => ReactNode }
  /** Buttons. Trailing cell on desktop, foot of the card on mobile. */
  actions?: (row: T) => ReactNode
  /** Full-width block under the row (an admin's note, a rejection reason).
   *  Return null to omit it for that row. */
  detail?: (row: T) => ReactNode
  empty: ReactNode
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  primary,
  actions,
  detail,
  empty,
}: DataTableProps<T>) {
  if (rows.length === 0) {
    return <p className="text-sm text-[var(--color-text-muted)]">{empty}</p>
  }

  const mobileColumns = columns.filter((column) => column.mobile !== 'hidden')

  return (
    <>
      {/* Narrow: one card per row. */}
      <ul className="flex flex-col gap-3 md:hidden">
        {rows.map((row) => {
          const extra = detail?.(row)
          return (
            <li
              key={rowKey(row)}
              className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
            >
              {primary.cell(row)}

              {mobileColumns.length > 0 && (
                <dl className="mt-3 flex flex-col gap-1.5">
                  {mobileColumns.map((column) => (
                    <div key={column.key} className="flex items-start justify-between gap-4">
                      <dt className="shrink-0 text-xs text-[var(--color-text-muted)]">
                        {column.header}
                      </dt>
                      <dd className="min-w-0 text-right text-sm break-words">{column.cell(row)}</dd>
                    </div>
                  ))}
                </dl>
              )}

              {extra && <div className="mt-3">{extra}</div>}
              {actions && <div className="mt-3 flex flex-wrap items-center gap-2">{actions(row)}</div>}
            </li>
          )
        })}
      </ul>

      {/* Wide: a real table. */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[44rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-left">
              <th scope="col" className="py-2 pr-4 text-xs font-medium tracking-wide text-[var(--color-text-muted)] uppercase">
                {primary.header}
              </th>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={`py-2 pr-4 text-xs font-medium tracking-wide text-[var(--color-text-muted)] uppercase whitespace-nowrap ${
                    column.align === 'right' ? 'text-right' : 'text-left'
                  } ${column.width ?? ''}`}
                >
                  {column.header}
                </th>
              ))}
              {actions && <th scope="col" className="py-2 text-right text-xs font-medium tracking-wide text-[var(--color-text-muted)] uppercase">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const extra = detail?.(row)
              const span = columns.length + 1 + (actions ? 1 : 0)
              return (
                <Fragment key={rowKey(row)}>
                  <tr className={`border-b border-[var(--color-border)] align-top ${extra ? 'border-b-0' : ''}`}>
                    <td className="py-3 pr-4">{primary.cell(row)}</td>
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        className={`py-3 pr-4 ${column.align === 'right' ? 'text-right' : ''}`}
                      >
                        {column.cell(row)}
                      </td>
                    ))}
                    {actions && (
                      <td className="py-3">
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          {actions(row)}
                        </div>
                      </td>
                    )}
                  </tr>
                  {extra && (
                    <tr className="border-b border-[var(--color-border)]">
                      <td colSpan={span} className="pb-3">
                        {extra}
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}
