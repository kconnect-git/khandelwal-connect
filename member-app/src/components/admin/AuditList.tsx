import { Link } from 'react-router-dom'
import { auditActionLabel, auditTargetHref, formatAdminDateTime } from '../../lib/admin'
import type { AuditLogRow } from '../../types/database'

// Phase 5b-1: a compact list of admin_audit_log rows -- the Overview's
// "Recent activity" and a member's history on the detail screen. 5b-2's
// full audit page will put a filter bar and paging around the same list.

type AuditListProps = {
  rows: AuditLogRow[]
  /** Off on a single record's history, where the target is the page itself. */
  showTarget?: boolean
  empty: string
}

/** members_export notes are the JSON the RPC wrote; show them as "rows: 42,
 *  state: Rajasthan" rather than raw braces. Anything else is the admin's
 *  own note and shown as written. */
function formatNotes(row: AuditLogRow): string | null {
  if (!row.notes) return null
  if (row.action !== 'members_export') return row.notes
  try {
    const parsed = JSON.parse(row.notes) as Record<string, unknown>
    return Object.entries(parsed)
      .map(([key, value]) => `${key}: ${String(value)}`)
      .join(', ')
  } catch {
    return row.notes
  }
}

export function AuditList({ rows, showTarget = true, empty }: AuditListProps) {
  if (rows.length === 0) {
    return <p className="text-sm text-[var(--color-text-muted)]">{empty}</p>
  }

  return (
    <ul className="flex flex-col divide-y divide-[var(--color-border)] rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
      {rows.map((row) => {
        const href = auditTargetHref(row)
        const notes = formatNotes(row)
        return (
          <li key={row.id} className="flex flex-col gap-1 px-4 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p className="text-sm">
                <span className="font-medium">{auditActionLabel(row.action)}</span>
                {showTarget && row.target_id && (
                  <>
                    {' · '}
                    {href ? (
                      <Link to={href} className="underline-offset-2 hover:underline">
                        {row.target_label ?? 'deleted record'}
                      </Link>
                    ) : (
                      (row.target_label ?? 'deleted record')
                    )}
                  </>
                )}
              </p>
              <span className="text-xs text-[var(--color-text-muted)] whitespace-nowrap">
                {formatAdminDateTime(row.created_at)}
              </span>
            </div>
            <p className="text-xs text-[var(--color-text-muted)]">
              by {row.admin_name ?? 'an admin without a member profile'}
            </p>
            {notes && <p className="text-sm whitespace-pre-line break-words">{notes}</p>}
          </li>
        )
      })}
    </ul>
  )
}
