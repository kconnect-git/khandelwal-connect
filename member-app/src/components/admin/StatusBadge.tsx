import { MEMBER_STATUS_LABELS } from '../../lib/people'
import type { MemberStatus } from '../../types/database'

// Phase 5b-1: a member's review status as a small pill. Only the two states
// that need an admin's attention are accent-coloured.

export function StatusBadge({ status }: { status: MemberStatus }) {
  const needsReview = status === 'pending'
  const tone = needsReview
    ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
    : status === 'approved'
      ? 'border-[var(--color-border)] text-[var(--color-text)]'
      : 'border-[var(--color-border)] text-[var(--color-text-muted)]'
  return (
    <span className={`inline-block rounded-full border px-2 py-0.5 text-xs whitespace-nowrap ${tone}`}>
      {MEMBER_STATUS_LABELS[status]}
    </span>
  )
}
