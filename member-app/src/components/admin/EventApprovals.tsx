import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ConfirmDialog } from '../ConfirmDialog'
import { DataTable, type Column } from './DataTable'
import { formatEventWhen, eventPlaceLine } from '../../lib/events'
import { adminListEvents, adminSetEventStatus, type AdminEventRow } from '../../lib/admin'

const RECENT_LIMIT = 10

// One column set for all three sections -- they differ only in their actions
// and in whether a rejection reason hangs under the row.
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

/** Phase 4's event queue, now one panel of the Approvals section (5a).
 * AdminApprovals does the is_admin() UI gate for both panels; every RPC
 * re-checks it on the server. Phase 5b gives this status tabs, search and
 * pagination past 50 pending. */
export function EventApprovals({ onChanged }: { onChanged?: () => void }) {
  const [pending, setPending] = useState<AdminEventRow[]>([])
  const [approved, setApproved] = useState<AdminEventRow[]>([])
  const [rejected, setRejected] = useState<AdminEventRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [action, setAction] = useState<PendingAction | null>(null)

  const reload = useCallback(async () => {
    const [p, a, r] = await Promise.all([
      adminListEvents({ status: 'pending', limit: 50 }),
      adminListEvents({ status: 'approved', limit: RECENT_LIMIT }),
      adminListEvents({ status: 'rejected', limit: RECENT_LIMIT }),
    ])
    setPending(p)
    setApproved(a)
    setRejected(r)
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    reload()
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
  }, [reload])

  async function act(
    event: AdminEventRow,
    status: 'approved' | 'rejected' | 'cancelled',
    reason?: string,
  ) {
    setBusyId(event.id)
    setError(null)
    try {
      await adminSetEventStatus(event.id, status, reason)
      setAction(null)
      await reload()
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

  return (
    <div className="flex flex-col gap-6">
      {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}

      {loading ? (
        <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>
      ) : (
        <>
          <section className="flex flex-col gap-2">
            <h2 className="text-xs font-semibold tracking-widest text-[var(--color-text-muted)] uppercase">
              Pending
            </h2>
            <DataTable
              rows={pending}
              rowKey={(event) => event.id}
              primary={EVENT_PRIMARY}
              columns={EVENT_COLUMNS}
              empty="Nothing waiting for review."
              actions={(event) => {
                const busy = busyId === event.id
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
              }}
            />
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-xs font-semibold tracking-widest text-[var(--color-text-muted)] uppercase">
              Recently approved
            </h2>
            <DataTable
              rows={approved}
              rowKey={(event) => event.id}
              primary={EVENT_PRIMARY}
              columns={EVENT_COLUMNS}
              empty="None yet."
              actions={(event) => (
                <button
                  type="button"
                  onClick={() => cancel(event)}
                  disabled={busyId === event.id}
                  className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm whitespace-nowrap transition-colors hover:bg-[var(--color-surface-hover)] disabled:opacity-60"
                >
                  Cancel event
                </button>
              )}
            />
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-xs font-semibold tracking-widest text-[var(--color-text-muted)] uppercase">
              Recently rejected
            </h2>
            <DataTable
              rows={rejected}
              rowKey={(event) => event.id}
              primary={EVENT_PRIMARY}
              columns={EVENT_COLUMNS}
              empty="None yet."
              detail={(event) =>
                event.rejection_reason ? (
                  <p className="rounded-lg border-l-2 border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm whitespace-pre-line">
                    Reason: {event.rejection_reason}
                  </p>
                ) : null
              }
            />
          </section>
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
