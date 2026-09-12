import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { EventCard } from '../components/events/EventCard'
import { useIsAdmin } from '../hooks/useIsAdmin'
import { adminListEvents, adminSetEventStatus, type AdminEventRow } from '../lib/admin'

const RECENT_LIMIT = 10

/** Phase 4's bare admin surface: the approval queue. Client-side gate only
 * for the UI -- every RPC re-checks is_admin() on the server. Phase 5
 * replaces this with the real console. */
export function AdminEvents() {
  const admin = useIsAdmin(true)
  const [pending, setPending] = useState<AdminEventRow[]>([])
  const [approved, setApproved] = useState<AdminEventRow[]>([])
  const [rejected, setRejected] = useState<AdminEventRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

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
    if (admin !== true) return
    let cancelled = false
    setLoading(true)
    reload()
      .catch((err) => {
        if (cancelled) return
        console.error('[AdminEvents] failed to load', err)
        setError(err instanceof Error ? err.message : 'Something went wrong loading events.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [admin, reload])

  async function act(
    event: AdminEventRow,
    status: 'approved' | 'rejected' | 'cancelled',
    reason?: string,
  ) {
    setBusyId(event.id)
    setError(null)
    try {
      await adminSetEventStatus(event.id, status, reason)
      await reload()
    } catch (err) {
      console.error('[AdminEvents] action failed', err)
      setError(err instanceof Error ? err.message : 'Could not update the event.')
    } finally {
      setBusyId(null)
    }
  }

  function handleReject(event: AdminEventRow) {
    const reason = window.prompt(`Why is "${event.title}" being rejected? The organiser will see this.`)
    if (reason === null) return
    if (reason.trim().length === 0) {
      setError('Please give a reason for rejecting.')
      return
    }
    act(event, 'rejected', reason)
  }

  function handleCancel(event: AdminEventRow) {
    if (!window.confirm(`Cancel "${event.title}"? Guests will see it as cancelled.`)) return
    act(event, 'cancelled')
  }

  if (admin === null) {
    return (
      <div className="flex-1 flex flex-col px-5 py-10 max-w-2xl mx-auto w-full">
        <p className="text-sm text-[var(--color-text-muted)]">Checking access…</p>
      </div>
    )
  }

  if (!admin) {
    return (
      <div className="flex-1 flex flex-col items-start gap-4 px-5 py-10 max-w-2xl mx-auto w-full">
        <h1 className="font-heading text-2xl font-semibold">Not authorised</h1>
        <p className="text-[var(--color-text-muted)]">This page is for admins only.</p>
        <Link
          to="/events"
          className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-text-muted)] transition-colors"
        >
          Back to events
        </Link>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col gap-6 px-5 py-8 max-w-2xl mx-auto w-full">
      <div className="flex items-end justify-between">
        <h1 className="font-heading text-2xl font-semibold">Event approvals</h1>
        <p className="text-right">
          <span className="font-heading text-2xl font-bold leading-none">{pending.length}</span>{' '}
          <span className="text-sm text-[var(--color-text-muted)]">pending</span>
        </p>
      </div>

      {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}

      {loading ? (
        <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>
      ) : (
        <>
          <section className="flex flex-col gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)]">
              Pending
            </h2>
            {pending.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)]">Nothing waiting for review.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {pending.map((event) => {
                  const busy = busyId === event.id
                  return (
                    <li key={event.id} className="flex flex-col gap-2">
                      <EventCard
                        event={event}
                        note={`Organiser: ${event.creator_name} · ${event.creator_member_code}`}
                      />
                      <div className="flex flex-wrap items-center gap-2 px-1">
                        <button
                          type="button"
                          onClick={() => act(event, 'approved')}
                          disabled={busy}
                          className="rounded-lg bg-[var(--color-accent)] text-white font-medium px-4 py-1.5 text-sm hover:bg-[var(--color-accent-hover)] disabled:opacity-60 transition-colors"
                        >
                          {busy ? '…' : 'Approve'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleReject(event)}
                          disabled={busy}
                          className="rounded-lg border border-[var(--color-border)] px-4 py-1.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-text-muted)] disabled:opacity-60 transition-colors"
                        >
                          Reject
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCancel(event)}
                          disabled={busy}
                          className="text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-60 transition-colors px-1"
                        >
                          Cancel event
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)]">
              Recently approved
            </h2>
            {approved.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)]">None yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {approved.map((event) => (
                  <li key={event.id} className="flex flex-col gap-1">
                    <EventCard event={event} showStatus />
                    <button
                      type="button"
                      onClick={() => handleCancel(event)}
                      disabled={busyId === event.id}
                      className="self-start text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-60 transition-colors px-1"
                    >
                      Cancel event
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)]">
              Recently rejected
            </h2>
            {rejected.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)]">None yet.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {rejected.map((event) => (
                  <li key={event.id}>
                    <EventCard
                      event={event}
                      showStatus
                      note={event.rejection_reason ? `Reason: ${event.rejection_reason}` : null}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  )
}
