import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Avatar } from '../Avatar'
import { ConfirmDialog } from '../ConfirmDialog'
import { DataTable } from './DataTable'
import { adminListBusinesses, adminSetBusinessReview, formatAdminDate } from '../../lib/admin'
import type { AdminBusinessRow } from '../../types/database'

// Phase 10.5: new business listings waiting for an admin, the Businesses
// tab of /admin/approvals. Oldest submitted first. A pending listing has no
// public page yet, so what it says is shown inline. A note from an earlier
// "ask for changes" means this is a resubmission.

const PAGE_SIZE = 20

type Decision = 'approved' | 'changes_requested' | 'rejected'

type PendingAction = {
  business: AdminBusinessRow
  decision: Exclude<Decision, 'approved'>
}

const ROW_BUTTON =
  'rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm whitespace-nowrap transition-colors hover:bg-[var(--color-surface-hover)] disabled:opacity-60'

export function BusinessApprovals({ onChanged }: { onChanged?: () => void }) {
  const [rows, setRows] = useState<AdminBusinessRow[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [action, setAction] = useState<PendingAction | null>(null)

  const load = useCallback(async () => {
    const page = await adminListBusinesses({ reviewStatus: 'pending', limit: PAGE_SIZE })
    setRows(page)
    setTotal(page.length > 0 ? Number(page[0].total_count) : 0)
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    load()
      .catch((err) => {
        if (cancelled) return
        console.error('[BusinessApprovals] failed to load', err)
        setError(err instanceof Error ? err.message : 'Something went wrong loading listings.')
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
      const page = await adminListBusinesses({
        reviewStatus: 'pending',
        limit: PAGE_SIZE,
        offset: rows.length,
      })
      setRows((current) => [...current, ...page])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load more listings.')
    } finally {
      setLoadingMore(false)
    }
  }

  async function decide(business: AdminBusinessRow, decision: Decision, note = '') {
    setBusyId(business.id)
    setError(null)
    try {
      await adminSetBusinessReview(business.id, decision, note)
      setAction(null)
      await load()
      onChanged?.()
    } catch (err) {
      console.error('[BusinessApprovals] decision failed', err)
      setAction(null)
      setError(err instanceof Error ? err.message : 'Could not update this listing.')
    } finally {
      setBusyId(null)
    }
  }

  const hasMore = total !== null && rows.length < total

  return (
    <div className="flex flex-col gap-5">
      {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}

      {loading ? (
        <p className="text-sm text-[var(--color-text-muted)]">Loading listings…</p>
      ) : (
        <>
          {rows.length > 0 && (
            <p className="text-sm text-[var(--color-text-muted)]">
              {total} {total === 1 ? 'listing' : 'listings'} waiting
            </p>
          )}
          <DataTable
            rows={rows}
            rowKey={(business) => business.id}
            empty="No listings waiting for review."
            primary={{
              header: 'Listing',
              cell: (business) => (
                <div className="flex items-start gap-2.5">
                  <Avatar name={business.name} photoUrl={business.logo_url} size={32} />
                  <div className="min-w-0">
                    <p className="font-medium">{business.name}</p>
                    {business.brand_name && (
                      <p className="text-xs text-[var(--color-text-muted)]">{business.brand_name}</p>
                    )}
                    {business.review_note && (
                      <p className="mt-1 text-xs text-[var(--color-accent)]">Resubmitted</p>
                    )}
                  </div>
                </div>
              ),
            }}
            columns={[
              {
                key: 'owner',
                header: 'Owner',
                cell: (business) => (
                  <Link
                    to={`/admin/members/${business.owner_id}`}
                    className="flex flex-col underline-offset-2 hover:underline"
                  >
                    <span>{business.owner_name}</span>
                    {business.owner_member_code && (
                      <span className="text-xs tracking-wide text-[var(--color-text-muted)]">
                        {business.owner_member_code}
                      </span>
                    )}
                  </Link>
                ),
              },
              { key: 'category', header: 'Industry', cell: (business) => business.category ?? '—' },
              {
                key: 'place',
                header: 'Location',
                cell: (business) =>
                  [business.city, business.state].filter(Boolean).join(', ') || '—',
              },
              {
                key: 'when',
                header: 'Submitted',
                align: 'right',
                cell: (business) => formatAdminDate(business.submitted_at) ?? '—',
              },
            ]}
            detail={(business) => (
              <div className="flex flex-col gap-2 text-sm">
                {business.description && (
                  <p className="whitespace-pre-line">{business.description}</p>
                )}
                {business.products.length > 0 && (
                  <p className="text-[var(--color-text-muted)]">
                    Products & services: {business.products.join(', ')}
                  </p>
                )}
                {business.contact_phone && (
                  <p className="text-[var(--color-text-muted)]">Phone: {business.contact_phone}</p>
                )}
                {business.review_note && (
                  <p className="rounded-lg border-l-2 border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 whitespace-pre-line">
                    Earlier note: {business.review_note}
                  </p>
                )}
              </div>
            )}
            actions={(business) => {
              const busy = busyId === business.id
              return (
                <>
                  <button
                    type="button"
                    onClick={() => decide(business, 'approved')}
                    disabled={busy}
                    className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-[var(--color-accent-hover)] disabled:opacity-60"
                  >
                    {busy ? '…' : 'Approve'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setAction({ business, decision: 'changes_requested' })}
                    disabled={busy}
                    className={ROW_BUTTON}
                  >
                    Ask for changes
                  </button>
                  <button
                    type="button"
                    onClick={() => setAction({ business, decision: 'rejected' })}
                    disabled={busy}
                    className={ROW_BUTTON}
                  >
                    Turn down
                  </button>
                </>
              )
            }}
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
          action
            ? action.decision === 'changes_requested'
              ? `Ask for changes to "${action.business.name}"?`
              : `Turn down "${action.business.name}"?`
            : ''
        }
        description={
          action?.decision === 'changes_requested'
            ? 'The owner sees your note. Saving their listing sends it back here.'
            : 'This is final for this listing. The owner sees your note and can only remove it.'
        }
        prompt={{
          label: 'Note to the owner',
          placeholder:
            action?.decision === 'changes_requested'
              ? 'What needs to change before it can go live?'
              : 'Why it can’t be listed.',
          required: true,
        }}
        confirmLabel={action?.decision === 'changes_requested' ? 'Ask for changes' : 'Turn down'}
        busy={busyId !== null}
        onConfirm={(value) => {
          if (action) decide(action.business, action.decision, value)
        }}
        onCancel={() => setAction(null)}
      />
    </div>
  )
}
