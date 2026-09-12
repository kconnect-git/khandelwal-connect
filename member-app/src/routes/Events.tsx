import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { TabStrip } from '../components/TabStrip'
import { EventCard } from '../components/events/EventCard'
import {
  DEFAULT_EVENT_TAB,
  EVENT_TABS,
  isEventListMode,
  listEvents,
  type EventListMode,
  type EventListPage,
} from '../lib/events'

const PAGE_SIZE = 20

const EMPTY_MESSAGES: Record<EventListMode, string> = {
  upcoming: 'No upcoming events yet. Create one and it will appear here once an admin approves it.',
  registered: "You haven't joined any upcoming events.",
  past: 'No past events.',
}

/** Approved, members-visible events. Invite-only events never show here --
 * invitees find those on My events. */
export function Events() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const mode: EventListMode = isEventListMode(tabParam) ? tabParam : DEFAULT_EVENT_TAB

  const [entries, setEntries] = useState<EventListPage[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    listEvents({ mode, limit: PAGE_SIZE, offset: 0 })
      .then((page) => {
        if (cancelled) return
        setEntries(page)
        setTotal(page.length > 0 ? page[0].total_count : 0)
      })
      .catch((err) => {
        if (cancelled) return
        console.error('[Events] failed to load events', err)
        setError(err instanceof Error ? err.message : 'Something went wrong loading events.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [mode])

  function selectTab(next: EventListMode) {
    setSearchParams(next === DEFAULT_EVENT_TAB ? {} : { tab: next }, { replace: true })
  }

  async function handleLoadMore() {
    setLoadingMore(true)
    try {
      const page = await listEvents({ mode, limit: PAGE_SIZE, offset: entries.length })
      setEntries((prev) => [...prev, ...page])
      if (page.length > 0) setTotal(page[0].total_count)
    } catch (err) {
      console.error('[Events] failed to load more', err)
      setError(err instanceof Error ? err.message : 'Something went wrong loading more events.')
    } finally {
      setLoadingMore(false)
    }
  }

  const hasMore = total !== null && entries.length < total

  return (
    <div className="flex-1 flex flex-col gap-5 px-5 py-8 max-w-2xl mx-auto w-full">
      <div className="flex items-end justify-between">
        <h1 className="font-heading text-2xl font-semibold">Events</h1>
        {total !== null && (
          <p className="text-right">
            <span className="font-heading text-2xl font-bold leading-none">{total}</span>{' '}
            <span className="text-sm text-[var(--color-text-muted)]">
              {mode === 'past' ? 'past' : mode === 'registered' ? 'joined' : 'upcoming'}
            </span>
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Link
          to="/events/new"
          className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-text-muted)] transition-colors"
        >
          Create event
        </Link>
        <Link
          to="/events/mine"
          className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-text-muted)] transition-colors"
        >
          My events
        </Link>
      </div>

      <TabStrip tabs={EVENT_TABS} active={mode} onChange={selectTab} label="Event lists" />

      {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}

      {loading ? (
        <p className="text-sm text-[var(--color-text-muted)]">Loading events…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">{EMPTY_MESSAGES[mode]}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map((entry) => (
            <li key={entry.id}>
              <EventCard event={entry} />
            </li>
          ))}
        </ul>
      )}

      {hasMore && !loading && (
        <button
          type="button"
          onClick={handleLoadMore}
          disabled={loadingMore}
          className="self-center rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-text-muted)] disabled:opacity-60 transition-colors"
        >
          {loadingMore ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  )
}
