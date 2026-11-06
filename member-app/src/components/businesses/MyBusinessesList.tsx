import { Link } from 'react-router-dom'
import { businessMetaLine } from '../../lib/businesses'
import { Avatar } from '../Avatar'
import { BusinessStatusBadge } from './BusinessStatusBadge'
import type { BusinessRow } from '../../types/database'

const ROW_BUTTON =
  'rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm hover:border-[var(--color-text-muted)] disabled:opacity-60 transition-colors'

/** (10.4) The member's own listings, one card each. All editing happens on
 * /businesses/new and /businesses/:id/edit. (10.5) Each card shows where the
 * listing stands with the admins, and their note; a turned-down listing
 * can only be removed. Used by /businesses/mine. */
export function MyBusinessesList({
  businesses,
  onRemove,
}: {
  businesses: BusinessRow[]
  onRemove: (business: BusinessRow) => void
}) {
  return (
    <ul className="flex flex-col gap-2">
      {businesses.map((business) => {
        const live = business.review_status === 'approved' && !business.is_hidden
        const showNote =
          business.review_note &&
          (business.review_status === 'changes_requested' || business.review_status === 'rejected')
        return (
          <li
            key={business.id}
            className="flex flex-col gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3"
          >
            <div className="flex items-center gap-3">
              <Avatar name={business.name} photoUrl={business.logo_url} size={40} />
              <span className="flex flex-col min-w-0 flex-1">
                <span className="font-heading font-medium truncate">{business.name}</span>
                {businessMetaLine(business) && (
                  <span className="text-sm text-[var(--color-text-muted)] truncate">
                    {businessMetaLine(business)}
                  </span>
                )}
              </span>
            </div>

            {showNote && (
              <div className="rounded-lg border-l-2 border-[var(--color-accent)] bg-[var(--color-bg)] px-3 py-2 text-sm">
                <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">
                  From the admins
                </p>
                <p className="mt-1 whitespace-pre-line">{business.review_note}</p>
              </div>
            )}

            {/* (0021) Only the owner still sees a hidden listing -- say why. */}
            {business.is_hidden && (
              <div className="rounded-lg border border-[var(--color-accent)] px-3 py-2 text-sm">
                <p className="font-medium text-[var(--color-accent)]">
                  Hidden from the businesses directory by an admin
                </p>
                {business.hidden_reason && (
                  <p className="mt-1 whitespace-pre-line">{business.hidden_reason}</p>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <BusinessStatusBadge status={business.review_status} />
              <div className="ml-auto flex items-center gap-2">
                {live && (
                  <>
                    <Link to={`/business/dashboard?business=${business.id}`} className={ROW_BUTTON}>
                      Dashboard
                    </Link>
                    <Link to={`/businesses/${business.id}`} className={ROW_BUTTON}>
                      View
                    </Link>
                  </>
                )}
                {business.review_status === 'rejected' ? (
                  <button type="button" onClick={() => onRemove(business)} className={ROW_BUTTON}>
                    Remove
                  </button>
                ) : (
                  <Link to={`/businesses/${business.id}/edit`} className={ROW_BUTTON}>
                    Edit
                  </Link>
                )}
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
