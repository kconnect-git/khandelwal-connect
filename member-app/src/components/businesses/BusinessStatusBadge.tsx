import { BUSINESS_REVIEW_LABELS } from '../../lib/businesses'
import type { BusinessReviewStatus } from '../../types/database'

const CLASSES: Record<BusinessReviewStatus, string> = {
  approved: 'bg-[var(--color-badge-live-bg)] text-[var(--color-badge-live-fg)]',
  pending: 'bg-[var(--color-badge-soon-bg)] text-[var(--color-badge-soon-fg)]',
  changes_requested: 'bg-[var(--color-badge-soon-bg)] text-[var(--color-badge-soon-fg)]',
  rejected: 'border border-[var(--color-accent)] text-[var(--color-accent)]',
}

/** (10.5) Where one of the owner's listings stands with the admins. */
export function BusinessStatusBadge({ status }: { status: BusinessReviewStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${CLASSES[status]}`}
    >
      {BUSINESS_REVIEW_LABELS[status]}
    </span>
  )
}
