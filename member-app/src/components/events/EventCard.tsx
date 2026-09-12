import { Link } from 'react-router-dom'
import { eventPlaceLine, formatEventWhen, type EventCard as EventCardData } from '../../lib/events'
import { EventStatusBadge } from './EventStatusBadge'

type EventCardProps = {
  event: EventCardData
  /** Show the status pill (My events / admin lists). The public list only
   * ever contains approved events, so it leaves this off. */
  showStatus?: boolean
  /** Extra line under the meta (e.g. a rejection reason). */
  note?: string | null
}

export function EventCard({ event, showStatus = false, note }: EventCardProps) {
  const place = eventPlaceLine(event)
  const going = event.my_rsvp_status === 'going'

  return (
    <Link
      to={`/events/${event.id}`}
      className="flex flex-col gap-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 hover:bg-[var(--color-surface-hover)] transition-colors"
    >
      <span className="flex items-start justify-between gap-3">
        <span className="font-heading font-medium leading-snug">{event.title}</span>
        {showStatus && <EventStatusBadge status={event.status} />}
      </span>
      <span className="text-sm text-[var(--color-text-muted)]">{formatEventWhen(event)}</span>
      {place && <span className="text-sm text-[var(--color-text-muted)] truncate">{place}</span>}
      <span className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
        <span>
          {event.going_count} going{event.capacity !== null ? ` of ${event.capacity}` : ''}
        </span>
        {event.visibility === 'invite_only' && <span>· Invite only</span>}
        {going && <span className="font-medium text-[var(--color-text)]">· You're going</span>}
      </span>
      {note && <span className="text-xs text-[var(--color-text-muted)] whitespace-pre-line">{note}</span>}
    </Link>
  )
}
