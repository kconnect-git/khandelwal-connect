import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { EventCard } from '../components/events/EventCard'
import { listMyEvents, type MyEvent, type MyEventRelation } from '../lib/events'

const GROUPS: { relation: MyEventRelation; title: string; empty: string }[] = [
  { relation: 'created', title: 'Created by you', empty: "You haven't created any events." },
  { relation: 'invited', title: 'Invited', empty: 'No invitations yet.' },
  { relation: 'joined', title: 'Joined', empty: "You haven't joined any events." },
]

/** Everything that's "mine": what I created (any status, with the admin's
 * rejection reason), invite-only events I'm on the list for, and public
 * events I've joined. */
export function MyEvents() {
  const [events, setEvents] = useState<MyEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    listMyEvents()
      .then((rows) => {
        if (!cancelled) setEvents(rows)
      })
      .catch((err) => {
        if (cancelled) return
        console.error('[MyEvents] failed to load', err)
        setError(err instanceof Error ? err.message : 'Something went wrong loading your events.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="flex-1 flex flex-col gap-6 px-5 py-8 max-w-2xl mx-auto w-full">
      <Link
        to="/events"
        className="text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
      >
        ‹ Events
      </Link>

      <div className="flex items-end justify-between">
        <h1 className="font-heading text-2xl font-semibold">My events</h1>
        <Link
          to="/events/new"
          className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-text-muted)] transition-colors"
        >
          Create event
        </Link>
      </div>

      {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}

      {loading ? (
        <p className="text-sm text-[var(--color-text-muted)]">Loading your events…</p>
      ) : (
        GROUPS.map((group) => {
          const rows = events.filter((e) => e.relation === group.relation)
          return (
            <section key={group.relation} className="flex flex-col gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)]">
                {group.title}
              </h2>
              {rows.length === 0 ? (
                <p className="text-sm text-[var(--color-text-muted)]">{group.empty}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {rows.map((event) => (
                    <li key={event.id}>
                      <EventCard
                        event={event}
                        showStatus={group.relation === 'created' || event.status !== 'approved'}
                        note={
                          event.status === 'rejected' && event.rejection_reason
                            ? `Reason: ${event.rejection_reason}`
                            : null
                        }
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )
        })
      )}
    </div>
  )
}
