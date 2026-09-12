import { EVENT_STATUS_LABELS } from '../../lib/events'
import type { EventStatus } from '../../types/database'

/** Muted pill. Deliberately never the accent colour -- the one vermilion
 * element per screen is reserved for the primary action. */
export function EventStatusBadge({ status }: { status: EventStatus }) {
  return (
    <span className="inline-flex items-center rounded-full border border-[var(--color-border)] px-2.5 py-0.5 text-xs text-[var(--color-text-muted)] whitespace-nowrap">
      {EVENT_STATUS_LABELS[status]}
    </span>
  )
}
