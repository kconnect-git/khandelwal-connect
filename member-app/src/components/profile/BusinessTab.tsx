import { Link } from 'react-router-dom'
import { OccupationFields } from '../form/OccupationFields'
import { TabSaveBar } from './TabSaveBar'
import type { PersonTabProps } from './tabTypes'
import type { BusinessRow } from '../../types/database'

type BusinessTabProps = PersonTabProps & {
  businesses: BusinessRow[]
}

/** "2 listings · 1 pending review" */
function listingsSummary(businesses: BusinessRow[]): string {
  if (businesses.length === 0) return 'No listings yet.'
  const parts = [`${businesses.length} ${businesses.length === 1 ? 'listing' : 'listings'}`]
  const pending = businesses.filter((b) => b.review_status === 'pending').length
  const changes = businesses.filter((b) => b.review_status === 'changes_requested').length
  if (pending > 0) parts.push(`${pending} pending review`)
  if (changes > 0) parts.push(`${changes} need${changes === 1 ? 's' : ''} changes`)
  return parts.join(' · ')
}

/** Occupation (person fields, saved with the tab's Save) followed by a
 * pointer to the member's business listings. (10.4) Listings are edited on
 * their own pages; (10.5) they're listed on /businesses/mine. */
export function BusinessTab({ value, onChange, saveState, onSave, businesses }: BusinessTabProps) {
  return (
    <div className="w-full flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <h2 className="font-heading text-lg font-semibold">Occupation</h2>
        <OccupationFields value={value} onChange={onChange} />
        <TabSaveBar state={saveState} onSave={onSave} />
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="font-heading text-lg font-semibold">My businesses</h2>
        <p className="text-sm text-[var(--color-text-muted)]">{listingsSummary(businesses)}</p>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/businesses/mine"
            className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm hover:border-[var(--color-text-muted)] transition-colors"
          >
            My businesses ›
          </Link>
          <Link
            to="/businesses/new"
            className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-accent-hover)] transition-colors"
          >
            + List a business
          </Link>
        </div>
      </div>
    </div>
  )
}
