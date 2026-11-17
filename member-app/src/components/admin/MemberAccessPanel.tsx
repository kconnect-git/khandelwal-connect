import { useCallback, useEffect, useState } from 'react'
import { useAccessActions } from '../../hooks/useAccessActions'
import { formatAdminDate } from '../../lib/admin'
import {
  PAID_SERVICE_LABELS,
  accessMonthsLabel,
  adminMemberAccess,
  adminMemberAccessHistory,
} from '../../lib/serviceAccess'
import type { AdminAccessGrantRow, AdminMemberAccessRow } from '../../types/database'

// Phase 11.2: one member's paid-service access on /admin/members/:id. A row
// per service (access until / requested / none) with Give / Extend / Remove,
// and every grant they've had underneath. Grants need an approved member
// (the RPC refuses otherwise), so other states just say so.

const BUTTON =
  'rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm whitespace-nowrap hover:bg-[var(--color-surface-hover)] disabled:opacity-50'
const ACCENT_BUTTON =
  'rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm font-semibold whitespace-nowrap text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50'

export function MemberAccessPanel({
  personId,
  fullName,
  approved,
  onChanged,
}: {
  personId: string
  fullName: string
  approved: boolean
  /** Lets the page refresh its audit history. */
  onChanged: () => Promise<void> | void
}) {
  const [rows, setRows] = useState<AdminMemberAccessRow[] | null>(null)
  const [history, setHistory] = useState<AdminAccessGrantRow[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [nextRows, nextHistory] = await Promise.all([
      adminMemberAccess(personId),
      adminMemberAccessHistory(personId),
    ])
    setRows(nextRows)
    setHistory(nextHistory)
  }, [personId])

  useEffect(() => {
    let cancelled = false
    load().catch((err) => {
      console.error('[MemberAccessPanel] failed to load', err)
      if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load access.')
    })
    return () => {
      cancelled = true
    }
  }, [load])

  const actions = useAccessActions({
    onChanged: async () => {
      await Promise.all([load(), onChanged()])
    },
  })

  if (error) return <p className="text-sm text-[var(--color-accent)]">{error}</p>
  if (!rows) return <p className="text-sm text-[var(--color-text-muted)]">Loading access…</p>

  return (
    <div className="flex flex-col gap-4">
      {!approved && (
        <p className="text-sm text-[var(--color-text-muted)]">
          Only approved members can be given access.
        </p>
      )}

      <ul className="flex flex-col divide-y divide-[var(--color-border)]">
        {rows.map((row) => {
          const target = {
            personId,
            fullName,
            service: row.service,
            currentEndsAt: row.ends_at,
          }
          // Grants chain end-to-start, so ends_at set means "has access now".
          const status = row.ends_at
            ? `Until ${formatAdminDate(row.ends_at)}`
            : row.open_request_at
              ? `Requested ${formatAdminDate(row.open_request_at)}`
              : 'No access'
          return (
            <li key={row.service} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
              <div className="flex min-w-0 flex-col">
                <span className="text-sm font-medium">
                  {PAID_SERVICE_LABELS[row.service]}
                  {!row.enforced && (
                    <span className="ml-2 text-xs font-normal text-[var(--color-text-muted)]">
                      paywall off
                    </span>
                  )}
                </span>
                <span
                  className={`text-sm ${
                    row.open_request_at && !row.ends_at
                      ? 'text-[var(--color-accent)]'
                      : 'text-[var(--color-text-muted)]'
                  }`}
                >
                  {status}
                  {row.ends_at && row.open_request_at && ' · renewal requested'}
                </span>
                {row.open_request_message && (
                  <span className="mt-1 text-xs text-[var(--color-text-muted)] whitespace-pre-line">
                    “{row.open_request_message}”
                  </span>
                )}
              </div>
              {approved && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={actions.busy}
                    onClick={() => actions.grant(target)}
                    className={row.ends_at ? BUTTON : ACCENT_BUTTON}
                  >
                    {row.ends_at ? 'Extend' : 'Give access'}
                  </button>
                  {row.ends_at && (
                    <button
                      type="button"
                      disabled={actions.busy}
                      onClick={() => actions.revoke(target)}
                      className={BUTTON}
                    >
                      Remove
                    </button>
                  )}
                  {row.open_request_id && (
                    <button
                      type="button"
                      disabled={actions.busy}
                      onClick={() => actions.dismiss(row.open_request_id as string, target)}
                      className={BUTTON}
                    >
                      Dismiss request
                    </button>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {actions.feedback}

      {history.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
            {history.length} {history.length === 1 ? 'grant' : 'grants'} so far
          </summary>
          <ul className="mt-2 flex flex-col gap-2">
            {history.map((grant) => (
              <li key={grant.id} className={grant.revoked_at ? 'text-[var(--color-text-muted)]' : ''}>
                <span className="font-medium">{PAID_SERVICE_LABELS[grant.service]}</span>
                {' · '}
                {accessMonthsLabel(grant.months)} · {formatAdminDate(grant.starts_at)} –{' '}
                {formatAdminDate(grant.ends_at)}
                {grant.granted_by_name && ` · by ${grant.granted_by_name}`}
                {grant.note && <span className="block text-xs">{grant.note}</span>}
                {grant.revoked_at && (
                  <span className="block text-xs">
                    Removed {formatAdminDate(grant.revoked_at)}
                    {grant.revoked_by_name && ` by ${grant.revoked_by_name}`}
                    {grant.revoke_note && ` · ${grant.revoke_note}`}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {actions.dialog}
    </div>
  )
}
