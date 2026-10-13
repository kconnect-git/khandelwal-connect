import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ConfirmDialog } from '../ConfirmDialog'
import { TabStrip } from '../TabStrip'
import { DataTable } from './DataTable'
import { formatAdminDate } from '../../lib/admin'
import {
  MATRIMONY_STATUS_LABELS,
  adminListMatrimonyReports,
  adminResolveMatrimonyReport,
  adminSetMatrimonyHidden,
} from '../../lib/matrimony'
import type { AdminMatrimonyReportRow } from '../../types/database'

// Phase 6c: member reports about matrimony profiles, the Reports tab of
// /admin/matrimony. Admins see who reported; the reported member never
// does. Hiding the profile and resolving the report are separate steps, so
// a report can be closed with "no action" too.

const PAGE_SIZE = 25

type View = 'open' | 'resolved'
type PendingAction = { report: AdminMatrimonyReportRow; kind: 'hide' | 'resolve' }

export function MatrimonyReports() {
  const [view, setView] = useState<View>('open')
  const [rows, setRows] = useState<AdminMatrimonyReportRow[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [action, setAction] = useState<PendingAction | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const page = await adminListMatrimonyReports({ status: view, limit: PAGE_SIZE })
    setRows(page)
    setTotal(page.length > 0 ? Number(page[0].total_count) : 0)
  }, [view])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    load()
      .catch((err) => {
        if (cancelled) return
        console.error('[MatrimonyReports] failed to load', err)
        setError(err instanceof Error ? err.message : 'Something went wrong loading reports.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [load])

  async function loadMore() {
    setLoadingMore(true)
    try {
      const page = await adminListMatrimonyReports({
        status: view,
        limit: PAGE_SIZE,
        offset: rows.length,
      })
      setRows((current) => [...current, ...page])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load more reports.')
    } finally {
      setLoadingMore(false)
    }
  }

  async function run(pending: PendingAction, value: string) {
    setBusy(true)
    setError(null)
    try {
      if (pending.kind === 'hide') {
        if (pending.report.reported_profile_id) {
          await adminSetMatrimonyHidden(pending.report.reported_profile_id, true, value)
        }
      } else {
        await adminResolveMatrimonyReport(pending.report.id, value)
      }
      setAction(null)
      await load()
    } catch (err) {
      setAction(null)
      setError(err instanceof Error ? err.message : 'Could not update this report.')
    } finally {
      setBusy(false)
    }
  }

  const hasMore = total !== null && rows.length < total

  return (
    <div className="flex flex-col gap-4">
      <TabStrip
        tabs={[
          { key: 'open' as const, label: 'Open' },
          { key: 'resolved' as const, label: 'Resolved' },
        ]}
        active={view}
        onChange={setView}
        label="Report status"
      />

      {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}

      {loading ? (
        <p className="text-sm text-[var(--color-text-muted)]">Loading reports…</p>
      ) : (
        <>
          {rows.length > 0 && (
            <p className="text-sm text-[var(--color-text-muted)]">
              {total} {total === 1 ? 'report' : 'reports'}
            </p>
          )}
          <DataTable
            rows={rows}
            rowKey={(row) => row.id}
            empty={view === 'open' ? 'No open reports.' : 'No resolved reports yet.'}
            primary={{
              header: 'Reported member',
              cell: (row) => (
                <div className="min-w-0">
                  <Link
                    to={`/admin/members/${row.reported_person_id}`}
                    className="font-medium underline-offset-2 hover:underline"
                  >
                    {row.reported_name}
                  </Link>
                  {row.reported_member_code && (
                    <p className="text-xs tracking-wide text-[var(--color-text-muted)]">
                      {row.reported_member_code}
                    </p>
                  )}
                  {row.open_against > 1 && (
                    <p className="mt-1 text-xs text-[var(--color-accent)]">
                      {row.open_against} open reports
                    </p>
                  )}
                </div>
              ),
            }}
            columns={[
              { key: 'reason', header: 'Reason', cell: (row) => row.reason },
              {
                key: 'reporter',
                header: 'Reported by',
                cell: (row) => (
                  <Link
                    to={`/admin/members/${row.reporter_person_id}`}
                    className="underline-offset-2 hover:underline"
                  >
                    {row.reporter_name}
                  </Link>
                ),
              },
              {
                key: 'profile',
                header: 'Profile',
                cell: (row) =>
                  row.reported_profile_status
                    ? MATRIMONY_STATUS_LABELS[row.reported_profile_status]
                    : 'Deleted',
              },
              {
                key: 'when',
                header: view === 'open' ? 'Reported' : 'Resolved',
                align: 'right',
                cell: (row) =>
                  formatAdminDate(view === 'open' ? row.created_at : row.resolved_at) ?? '—',
              },
            ]}
            detail={(row) =>
              row.details || row.resolution_note ? (
                <div className="flex flex-col gap-2">
                  {row.details && (
                    <p className="rounded-lg border-l-2 border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm whitespace-pre-line">
                      {row.details}
                    </p>
                  )}
                  {row.resolution_note && (
                    <p className="text-sm text-[var(--color-text-muted)] whitespace-pre-line">
                      {row.resolved_by_name ? `${row.resolved_by_name}: ` : ''}
                      {row.resolution_note}
                    </p>
                  )}
                </div>
              ) : null
            }
            actions={(row) => (
              <>
                {row.reported_profile_id && (
                  <Link
                    to={`/admin/matrimony/${row.reported_profile_id}`}
                    className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm whitespace-nowrap hover:bg-[var(--color-surface-hover)]"
                  >
                    View profile
                  </Link>
                )}
                {row.status === 'open' &&
                  (row.reported_profile_status === 'approved' ||
                    row.reported_profile_status === 'paused') && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setAction({ report: row, kind: 'hide' })}
                      className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm whitespace-nowrap hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
                    >
                      Hide profile
                    </button>
                  )}
                {row.status === 'open' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setAction({ report: row, kind: 'resolve' })}
                    className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm whitespace-nowrap hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
                  >
                    Resolve
                  </button>
                )}
              </>
            )}
          />

          {hasMore && (
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="self-center rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}
        </>
      )}

      <ConfirmDialog
        open={action !== null}
        title={
          action?.kind === 'hide'
            ? `Hide ${action.report.reported_name}’s profile?`
            : 'Resolve this report?'
        }
        description={
          action?.kind === 'hide'
            ? 'It disappears from browsing, and their matches lose access to it (and they to theirs) until you unhide it. They see your reason. The report stays open until you resolve it.'
            : 'It moves to Resolved. The reporter isn’t notified.'
        }
        prompt={
          action?.kind === 'hide'
            ? { label: 'Reason', placeholder: 'The member sees this.', required: true }
            : {
                label: 'Note (optional)',
                placeholder: 'What you did, for other admins.',
                hint: 'Only admins see this.',
              }
        }
        confirmLabel={action?.kind === 'hide' ? 'Hide profile' : 'Resolve'}
        busy={busy}
        onConfirm={(value) => {
          if (action) run(action, value)
        }}
        onCancel={() => setAction(null)}
      />
    </div>
  )
}
