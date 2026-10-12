// Phase 5b-1: client-side CSV for the admin members export. The RPC returns
// plain rows; turning them into a file here keeps the database out of the
// formatting business.

export type CsvColumn<T> = { header: string; value: (row: T) => string | number | null | undefined }

function escapeCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  let text = String(value)
  // Formula injection: names are member-typed, and Excel would run a cell
  // like `=HYPERLINK(...)`. A leading apostrophe makes it plain text (Excel
  // hides the apostrophe) -- it also keeps +91 mobiles from becoming numbers.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  // Quote anything that would break the row, and double embedded quotes.
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const lines = [
    columns.map((column) => escapeCell(column.header)).join(','),
    ...rows.map((row) => columns.map((column) => escapeCell(column.value(row))).join(',')),
  ]
  // CRLF per RFC 4180. The BOM is what makes Excel read the file as UTF-8 --
  // without it Hindi names open as mojibake.
  return '﻿' + lines.join('\r\n')
}

export function downloadCsv(filename: string, csv: string): void {
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
