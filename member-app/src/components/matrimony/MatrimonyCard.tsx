import { Link } from 'react-router-dom'
import { Avatar } from '../Avatar'
import { formatHeight, shortName } from '../../lib/matrimony'
import type { MatrimonyCardRow, MatrimonyInterestState } from '../../types/database'

// Phase 6b: one browsable profile. Initials only -- photos stay locked
// until a mutual match.

const INTEREST_STATE_LABELS: Record<MatrimonyInterestState, string | null> = {
  none: null,
  sent: 'Interest sent',
  received: 'Interested in you',
  matched: 'Matched',
  no_response: 'No response',
}

export function InterestStatePill({ state }: { state: MatrimonyInterestState }) {
  const label = INTEREST_STATE_LABELS[state]
  if (!label) return null
  // One accent pill per screen at most (design system §4): only the states
  // that ask something of the member get it.
  const accent = state === 'received' || state === 'matched'
  return (
    <span
      className={`inline-block shrink-0 rounded-full border px-2 py-0.5 text-xs whitespace-nowrap ${
        accent
          ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
          : 'border-[var(--color-border)] text-[var(--color-text-muted)]'
      }`}
    >
      {label}
    </span>
  )
}

export function MatrimonyCard({ row }: { row: MatrimonyCardRow }) {
  const name = shortName(row)
  const place = [row.current_city, row.current_state].filter(Boolean).join(', ')
  const work = [row.education, row.occupation_type].filter(Boolean).join(' · ')
  return (
    <Link
      to={`/matrimony/${row.id}`}
      className="flex gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 hover:bg-[var(--color-surface-hover)] transition-colors"
    >
      <Avatar name={name || '?'} photoUrl={null} size={48} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="font-medium">
            {name}
            {row.age !== null && <span className="text-[var(--color-text-muted)]">, {row.age}</span>}
          </p>
          <InterestStatePill state={row.interest_state} />
        </div>
        <p className="text-sm text-[var(--color-text-muted)]">
          {[place, row.gotra, formatHeight(row.height_cm)?.split(' (')[0]]
            .filter(Boolean)
            .join(' · ')}
        </p>
        {work && <p className="text-sm text-[var(--color-text-muted)]">{work}</p>}
        {row.about_me && <p className="mt-1 text-sm line-clamp-2">{row.about_me}</p>}
      </div>
    </Link>
  )
}
