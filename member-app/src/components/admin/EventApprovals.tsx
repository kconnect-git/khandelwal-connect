import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ConfirmDialog } from '../ConfirmDialog'
import { TabStrip } from '../TabStrip'
import { DataTable, type Column } from './DataTable'
import { formatEventWhen, eventPlaceLine } from '../../lib/events'
import { adminListEvents, adminSetEventStatus, type AdminEventRow } from '../../lib/admin'
import type { EventStatus } from '../../types/database'

const PAGE_SIZE = 20

const TABS: { key: EventStatus; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'cancelled', label: 'Cancelled' },
]

const EMPTY_MESSAGES: Record<EventStatus, string> = {
  pending: 'Nothing waiting for review.',
  approved: 'No approved events.',
  rejected: 'No rejected events.',
  cancelled: 'No cancelled events.',
}

function isEventStatus(value: string | null): value is EventStatus {
  return TABS.some((tab) => tab.key === value)
}

// One column set for every tab -- they differ only in their actions and in
// whether a rejection reason hangs under the row.
const EVENT_COLUMNS: Column<AdminEventRow>[] = [
  {
    key: 'when',
    header: 'When',
    cell: (event) => formatEventWhen(event) || '—',
  },
  {
    key: 'where',
    header: 'Where',
    cell: (event) => eventPlaceLine(event) || '—',
  },
  {
    key: 'organiser',
    header: 'Organiser',
    cell: (event) => (
      <div className="flex flex-col">
        <span>{event.creator_name}</span>
        <span className="text-xs tracking-wide text-[var(--color-text-muted)]">
          {event.creator_member_code}
        </span>
      </div>
    ),
  },
  {
    key: 'going',
    header: 'Going',
    align: 'right',
    cell: (event) => (
      <span>
        {event.going_count}
        {event.capacity ? (
          <span className="text-[var(--color-text-muted)]"> / {event.capacity}</span>
        ) : null}
      </span>
    ),
  },
]

const EVENT_PRIMARY = {
  header: 'Event',
  cell: (event: AdminEventRow) => (
    <div className="min-w-0">
      <Link to={`/events/${event.id}`} className="font-medium hover:text-[var(--color-accent)]">
        {event.title}
      </Link>
      {event.visibility === 'invite_only' && (
        <span className="ml-2 rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] tracking-wide text-[var(--color-text-muted)] uppercase">
          Invite only
        </span>
      )}
    </div>
  ),
}

type PendingAction = {
  event: AdminEventRow
  status: 'rejected' | 'cancelled'
  title: string
  description?: string
  prompt?: { label: string; placeholder: string; required: true }
  confirmLabel: string
}

/** Phase 4's event queue, one panel of the Approvals section (5a). (5b-2)
 * Rebuilt in MemberApprovals' shape: status tabs (`?status=`, merged into
 * the parent's query string), search, and Load more instead of three stacked
 * sections capped at 50. AdminLayout does the UI admin gate; every RPC
 * re-checks it on the server. */
export function EventApprovals({ onChanged }: { onChanged?: () => void }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const statusParam = searchParams.get('status')
  const status: EventStatus = isEventStatus(statusParam) ? statusParam : 'pending'

  const [rows, setRows] = useState<AdminEventRow[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [action, setAction] = useState<PendingAction | null>(null)

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(handle)
  }, [search])

  const load = useCallback(async () => {
    const page = await adminListEvents({ status, search: debouncedSearch, limit: PAGE_SIZE })
    setRows(page)
    setTotal(page.length > 0 ? Number(page[0].total_count) : 0)
  }, [status, debouncedSearch])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    load()
      .catch((err) => {
        if (cancelled) return
        console.error('[EventApprovals] failed to load', err)
        setError(err instanceof Error ? err.message : 'Something went wrong loading events.')
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
      const page = await adminListEvents({
        status,
        search: debouncedSearch,
        limit: PAGE_SIZE,
        offset: rows.length,
      })
      setRows((current) => [...current, ...page])
    } catch (err) {
      console.error('[EventApprovals] failed to load more', err)
      setError(err instanceof Error ? err.message : 'Could not load more events.')
    } finally {
      setLoadingMore(false)
    }
  }

  async function act(
    event: AdminEventRow,
    nextStatus: 'approved' | 'rejected' | 'cancelled',
    reason?: string,
  ) {
    setBusyId(event.id)
    setError(null)
    try {
      await adminSetEventStatus(event.id, nextStatus, reason)
      setAction(null)
      await load()
      onChanged?.()
    } catch (err) {
      console.error('[EventApprovals] action failed', err)
      setError(err instanceof Error ? err.message : 'Could not update the event.')
    } finally {
      setBusyId(null)
    }
  }

  function reject(event: AdminEventRow) {
    setAction({
      event,
      status: 'rejected',
      title: `Reject "${event.title}"?`,
      prompt: {
        label: 'Reason',
        placeholder: 'The organiser sees this, so say what needs to change.',
        required: true,
      },
      confirmLabel: 'Reject',
    })
  }

  function cancel(event: AdminEventRow) {
    setAction({
      event,
      status: 'cancelled',
      title: `Cancel "${event.title}"?`,
      description: 'Guests who joined will see it as cancelled.',
      confirmLabel: 'Cancel event',
    })
  }

  // Only pending and approved events have anything left to decide;
  // admin_set_event_status refuses the rest regardless.
  const hasActions = status === 'pending' || status === 'approved'
  const hasMore = total !== null && rows.length < total

  return (
    <div className="flex flex-col gap-5">
      <TabStrip
        tabs={TABS}
        active={status}
        onChange={(key) => {
          // Merge rather than replace: the parent's ?tab= lives in the same
          // query string and must survive a status change.
          const next = new URLSearchParams(searchParams)
          if (key === 'pending') next.delete('status')
          else next.set('status', key)
          setSearchParams(next, { replace: true })
        }}
        label="Event review queue"
      />

      <input
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search title, organiser or city"
        className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
      />

      {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}

      {loading ? (
        <p className="text-sm text-[var(--color-text-muted)]">Loading events…</p>
      ) : (
        <>
          {rows.length > 0 && (
            <p className="text-sm text-[var(--color-text-muted)]">
              {total} {total === 1 ? 'event' : 'events'}
            </p>
          )}
          <DataTable
            rows={rows}
            rowKey={(event) => event.id}
            primary={EVENT_PRIMARY}
            columns={EVENT_COLUMNS}
            empty={debouncedSearch ? 'No events match your search.' : EMPTY_MESSAGES[status]}
            detail={(event) =>
              status === 'rejected' && event.rejection_reason ? (
                <p className="rounded-lg border-l-2 border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm whitespace-pre-line">
                  Reason: {event.rejection_reason}
                </p>
              ) : null
            }
            actions={
              hasActions
                ? (event) => {
                    const busy = busyId === event.id
                    if (status === 'approved') {
                      return (
                        <button
                          type="button"
                          onClick={() => cancel(event)}
                          disabled={busy}
                          className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm whitespace-nowrap transition-colors hover:bg-[var(--color-surface-hover)] disabled:opacity-60"
                        >
                          Cancel event
                        </button>
                      )
                    }
                    return (
                      <>
                        <button
                          type="button"
                          onClick={() => act(event, 'approved')}
                          disabled={busy}
                          className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-[var(--color-accent-hover)] disabled:opacity-60"
                        >
                          {busy ? '…' : 'Approve'}
                        </button>
                        <button
                          type="button"
                          onClick={() => reject(event)}
                          disabled={busy}
                          className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm transition-colors hover:bg-[var(--color-surface-hover)] disabled:opacity-60"
                        >
                          Reject
                        </button>
                        <button
                          type="button"
                          onClick={() => cancel(event)}
                          disabled={busy}
                          className="px-1 text-sm whitespace-nowrap text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)] disabled:opacity-60"
                        >
                          Cancel
                        </button>
                      </>
                    )
                  }
                : undefined
            }
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
        title={action?.title ?? ''}
        description={action?.description}
        prompt={action?.prompt}
        confirmLabel={action?.confirmLabel ?? 'Confirm'}
        busy={busyId !== null}
        onConfirm={(value) => {
          if (action) act(action.event, action.status, value || undefined)
        }}
        onCancel={() => setAction(null)}
      />
    </div>
  )
}
