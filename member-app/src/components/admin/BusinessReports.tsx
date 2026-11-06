import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ConfirmDialog } from '../ConfirmDialog'
import { TabStrip } from '../TabStrip'
import { DataTable } from './DataTable'
import {
  adminListBusinessReports,
  adminResolveBusinessReport,
  adminSetBusinessHidden,
  adminSetBusinessPostHidden,
  formatAdminDate,
} from '../../lib/admin'
import type { AdminBusinessReportRow } from '../../types/database'

// Phase 10.3: member reports about business listings, the Reports tab of
// /admin/businesses. Same shape as MatrimonyReports: admins see who
// reported, the owner never does, and hiding the listing and resolving the
// report are separate steps. (10.6) Reports on Buy & Sell posts land here
// too: same row shape, with the poster in the owner columns.

const PAGE_SIZE = 25

type View = 'open' | 'resolved'
type PendingAction = { report: AdminBusinessReportRow; kind: 'hide' | 'resolve' }

/** What the report is about, and whether it's currently hidden. */
function target(row: AdminBusinessReportRow): { label: string; hidden: boolean; isPost: boolean } {
  if (row.post_id) {
    return {
      label: `Buy & Sell: ${row.post_title ?? 'post'}`,
      hidden: row.post_is_hidden === true,
      isPost: true,
    }
  }
  return { label: row.business_name ?? 'Listing', hidden: row.business_is_hidden === true, isPost: false }
}

const ROW_BUTTON =
  'rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm whitespace-nowrap hover:bg-[var(--color-surface-hover)] disabled:opacity-50'

export function BusinessReports() {
  const [view, setView] = useState<View>('open')
  const [rows, setRows] = useState<AdminBusinessReportRow[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [action, setAction] = useState<PendingAction | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const page = await adminListBusinessReports({ status: view, limit: PAGE_SIZE })
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
        console.error('[BusinessReports] failed to load', err)
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
      const page = await adminListBusinessReports({
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
        if (pending.report.post_id) {
          await adminSetBusinessPostHidden(pending.report.post_id, true, value)
        } else if (pending.report.business_id) {
          await adminSetBusinessHidden(pending.report.business_id, true, value)
        }
      } else {
        await adminResolveBusinessReport(pending.report.id, value)
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
              header: 'Reported',
              cell: (row) => (
                <div className="min-w-0">
                  <p className="font-medium">{target(row).label}</p>
                  <Link
                    to={`/admin/members/${row.owner_id}`}
                    className="text-xs text-[var(--color-text-muted)] underline-offset-2 hover:underline"
                  >
                    {row.owner_name}
                    {row.owner_member_code ? ` · ${row.owner_member_code}` : ''}
                  </Link>
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
                key: 'visibility',
                header: 'Now',
                cell: (row) => (target(row).hidden ? 'Hidden' : 'Visible'),
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
                {/* The member-facing page only resolves for a visible
                    listing, so don't offer a link that would come up empty. */}
                {row.business_id && !target(row).hidden && (
                  <Link to={`/businesses/${row.business_id}`} className={ROW_BUTTON}>
                    View listing
                  </Link>
                )}
                {row.status === 'open' && !target(row).hidden && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setAction({ report: row, kind: 'hide' })}
                    className={ROW_BUTTON}
                  >
                    {target(row).isPost ? 'Hide post' : 'Hide listing'}
                  </button>
                )}
                {row.status === 'open' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setAction({ report: row, kind: 'resolve' })}
                    className={ROW_BUTTON}
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
            ? `Hide "${action.report.post_title ?? action.report.business_name}"?`
            : 'Resolve this report?'
        }
        description={
          action?.kind === 'hide'
            ? action.report.post_id
              ? 'It disappears from Buy & Sell. The poster still sees it, with your reason. The report stays open until you resolve it.'
              : 'It disappears from the businesses directory and the owner’s member profile. The owner still sees it, with your reason. The report stays open until you resolve it.'
            : 'It moves to Resolved. The reporter isn’t notified.'
        }
        prompt={
          action?.kind === 'hide'
            ? {
                label: 'Reason',
                placeholder: 'The owner sees this, so say what needs to change.',
                required: true,
              }
            : {
                label: 'Note (optional)',
                placeholder: 'What you did, for other admins.',
                hint: 'Only admins see this.',
              }
        }
        confirmLabel={action?.kind === 'hide' ? 'Hide listing' : 'Resolve'}
        busy={busy}
        onConfirm={(value) => {
          if (action) run(action, value)
        }}
        onCancel={() => setAction(null)}
      />
    </div>
  )
}
