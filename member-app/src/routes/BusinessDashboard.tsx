import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../utils/supabase'
import { getOwnPerson } from '../lib/people'
import { getMyBusinesses } from '../lib/businesses'
import {
  getBusinessDashboard,
  listBusinessEnquiries,
  listingCompleteness,
  setBusinessEnquiryDone,
} from '../lib/businessDashboard'
import { whatsAppLink } from '../lib/businessPosts'
import { Avatar } from '../components/Avatar'
import { StatCounter } from '../components/StatCounter'
import { SelectField } from '../components/form/SelectField'
import type { BusinessDashboardStats, BusinessEnquiryRow, BusinessRow } from '../types/database'

// Phase 10.8: My Business Dashboard -- one live listing at a time
// (?business=<id>): how complete it is, this month's numbers, open
// enquiries, referrals and Buy & Sell requirements in its industry.

const MONTH_FORMAT = new Intl.DateTimeFormat('en-IN', { month: 'long' })
const DATE_FORMAT = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' })

const SECTION_HEADING = 'text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)]'
const SMALL_BUTTON =
  'rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm hover:border-[var(--color-text-muted)] disabled:opacity-60 transition-colors'

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`
}

export function BusinessDashboard() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [listings, setListings] = useState<BusinessRow[] | null>(null)
  const [hasPending, setHasPending] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  // The member's live listings; the dashboard only covers those.
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const { data } = await supabase.auth.getSession()
        const session = data.session
        if (!session) throw new Error('Please sign in again.')
        const person = await getOwnPerson(session.user.id)
        if (!person) throw new Error('Could not load your profile.')
        const mine = await getMyBusinesses(person.id)
        if (cancelled) return
        setListings(mine.filter((b) => b.review_status === 'approved' && !b.is_hidden))
        setHasPending(mine.some((b) => b.review_status !== 'approved'))
      } catch (err) {
        if (cancelled) return
        console.error('[BusinessDashboard] failed to load', err)
        setLoadError(err instanceof Error ? err.message : 'Something went wrong loading your listings.')
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const requestedId = searchParams.get('business')
  const selected =
    listings?.find((b) => b.id === requestedId) ?? (requestedId ? null : (listings?.[0] ?? null))

  const header = (
    <>
      <Link
        to="/business"
        className="text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
      >
        ‹ Business
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-semibold">My Business Dashboard</h1>
        <p className="text-sm text-[var(--color-text-muted)]">My leads and opportunities</p>
      </div>
    </>
  )

  if (loadError || listings === null) {
    return (
      <div className="flex-1 flex flex-col gap-5 px-5 py-8 max-w-2xl mx-auto w-full">
        {header}
        {loadError ? (
          <p className="text-sm text-[var(--color-accent)]">{loadError}</p>
        ) : (
          <p className="text-sm text-[var(--color-text-muted)]">Loading…</p>
        )}
      </div>
    )
  }

  if (listings.length === 0) {
    return (
      <div className="flex-1 flex flex-col gap-5 px-5 py-8 max-w-2xl mx-auto w-full">
        {header}
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-[var(--color-border)] px-4 py-8 text-center">
          <p className="text-sm text-[var(--color-text-muted)]">
            {hasPending
              ? 'Your listing is waiting for an admin to approve it. Its dashboard opens once it’s live.'
              : 'List a business to see your dashboard.'}
          </p>
          <Link
            to={hasPending ? '/businesses/mine' : '/businesses/new'}
            className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-accent-hover)] transition-colors"
          >
            {hasPending ? 'My businesses' : 'List a business'}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col gap-5 px-5 py-8 max-w-2xl mx-auto w-full">
      {header}
      {listings.length > 1 && (
        <SelectField
          label="Business"
          value={selected?.id ?? ''}
          onChange={(id) => setSearchParams({ business: id }, { replace: true })}
          options={listings.map((b) => ({ value: b.id, label: b.name }))}
        />
      )}
      {selected ? (
        <ListingDashboard key={selected.id} listing={selected} />
      ) : (
        <p className="text-sm text-[var(--color-accent)]">
          That listing isn’t one of your live listings.
        </p>
      )}
    </div>
  )
}

function ListingDashboard({ listing }: { listing: BusinessRow }) {
  const [stats, setStats] = useState<BusinessDashboardStats | null>(null)
  const [enquiries, setEnquiries] = useState<BusinessEnquiryRow[]>([])
  const [handled, setHandled] = useState<BusinessEnquiryRow[] | null>(null)
  const [showHandled, setShowHandled] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const completeness = listingCompleteness(listing)

  const load = useCallback(async () => {
    const [loadedStats, open] = await Promise.all([
      getBusinessDashboard(listing.id),
      listBusinessEnquiries({ businessId: listing.id, status: 'new' }),
    ])
    setStats(loadedStats)
    setEnquiries(open)
  }, [listing.id])

  useEffect(() => {
    load().catch((err) => {
      console.error('[BusinessDashboard] failed to load stats', err)
      setError(err instanceof Error ? err.message : 'Something went wrong loading the dashboard.')
    })
  }, [load])

  async function loadHandled() {
    setHandled(await listBusinessEnquiries({ businessId: listing.id, status: 'done' }))
  }

  async function toggleHandled() {
    const next = !showHandled
    setShowHandled(next)
    if (next && handled === null) {
      loadHandled().catch((err) => {
        setError(err instanceof Error ? err.message : 'Could not load handled enquiries.')
      })
    }
  }

  async function setDone(enquiry: BusinessEnquiryRow, done: boolean) {
    setBusyId(enquiry.id)
    setError(null)
    try {
      await setBusinessEnquiryDone(enquiry.id, done)
      await load()
      if (showHandled || handled !== null) await loadHandled()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update this enquiry.')
    } finally {
      setBusyId(null)
    }
  }

  // month_start is a plain date; read it at midday so no timezone can push
  // it into the previous month.
  const month = stats ? MONTH_FORMAT.format(new Date(`${stats.month_start}T12:00:00`)) : 'This month'

  return (
    <>
      {/* Completeness */}
      <section className="flex flex-col gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-semibold">Listing {completeness.percent}% complete</span>
          <span className="text-xs text-[var(--color-text-muted)]">
            {completeness.filled}/{completeness.total} fields
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-border)]">
          <div
            className="h-full rounded-full bg-[var(--color-accent)]"
            style={{ width: `${completeness.percent}%` }}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-[var(--color-text-muted)]">
            {completeness.nudge ?? 'Your listing has everything members look for.'}
          </p>
          <Link
            to={`/businesses/${listing.id}/edit`}
            className="shrink-0 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            Edit listing
          </Link>
        </div>
      </section>

      {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}

      {/* This month */}
      <section className="flex flex-col gap-2">
        <h2 className={SECTION_HEADING}>{month}</h2>
        <div className="grid grid-cols-2 gap-2">
          <StatCounter value={stats?.views ?? null} label="Profile views" />
          <StatCounter value={stats?.calls ?? null} label="Calls" />
          <StatCounter value={stats?.whatsapp ?? null} label="WhatsApp taps" />
          <StatCounter value={stats?.enquiries ?? null} label="Enquiries" />
        </div>
      </section>

      {/* Enquiries */}
      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className={SECTION_HEADING}>New enquiries</h2>
          <button
            type="button"
            onClick={toggleHandled}
            className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            {showHandled ? 'Hide handled' : 'Show handled'}
          </button>
        </div>
        {enquiries.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">No new enquiries.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {enquiries.map((enquiry) => (
              <EnquiryItem
                key={enquiry.id}
                enquiry={enquiry}
                businessName={listing.name}
                busy={busyId === enquiry.id}
                onDone={() => setDone(enquiry, true)}
              />
            ))}
          </ul>
        )}
        {showHandled && handled && (
          <>
            <h3 className="pt-2 text-xs text-[var(--color-text-muted)]">Handled</h3>
            {handled.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)]">Nothing handled yet.</p>
            ) : (
              <ul className="flex flex-col gap-2 opacity-80">
                {handled.map((enquiry) => (
                  <EnquiryItem
                    key={enquiry.id}
                    enquiry={enquiry}
                    businessName={listing.name}
                    busy={busyId === enquiry.id}
                    onUndo={() => setDone(enquiry, false)}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      {/* Leads */}
      {stats && (stats.referrals_new > 0 || stats.referrals_in_talks > 0 || stats.post_responses > 0) && (
        <section className="flex flex-col gap-1 text-sm">
          <h2 className={SECTION_HEADING}>Leads</h2>
          {(stats.referrals_new > 0 || stats.referrals_in_talks > 0) && (
            <Link to="/business/referrals" className="underline-offset-2 hover:underline">
              {plural(stats.referrals_new, 'new referral', 'new referrals')} ·{' '}
              {stats.referrals_in_talks} in talks
            </Link>
          )}
          {stats.post_responses > 0 && (
            <Link to="/business/market?tab=mine" className="underline-offset-2 hover:underline">
              {plural(stats.post_responses, 'Buy & Sell response', 'Buy & Sell responses')} this
              month
            </Link>
          )}
        </section>
      )}

      {/* Requirements in this industry */}
      {stats && stats.matching_requirements > 0 && listing.category && (
        <section className="flex flex-col gap-2 rounded-xl border border-[var(--color-accent)] bg-[var(--color-chip-warm-bg)] p-4">
          <p className="font-semibold">
            {stats.matching_requirements}{' '}
            {stats.matching_requirements === 1
              ? 'requirement matches your category'
              : 'requirements match your category'}
          </p>
          <p className="text-sm text-[var(--color-text-muted)]">
            Members are looking for what you offer in Buy & Sell.
          </p>
          <Link
            to={`/business/market?category=${encodeURIComponent(listing.category)}`}
            className="self-start rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-accent-hover)] transition-colors"
          >
            View requirements
          </Link>
        </section>
      )}
    </>
  )
}

function EnquiryItem({
  enquiry,
  businessName,
  busy,
  onDone,
  onUndo,
}: {
  enquiry: BusinessEnquiryRow
  businessName: string
  busy: boolean
  onDone?: () => void
  onUndo?: () => void
}) {
  const about = enquiry.about ?? 'General'
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div className="flex items-start gap-3">
        <Avatar name={enquiry.from_name} photoUrl={enquiry.from_photo_url} size={36} />
        <div className="flex flex-col min-w-0 flex-1">
          <span className="font-medium truncate">{enquiry.from_name}</span>
          <span className="text-xs text-[var(--color-text-muted)]">
            Asked about {about} · {DATE_FORMAT.format(new Date(enquiry.created_at))}
          </span>
        </div>
      </div>
      <p className="text-sm whitespace-pre-line">{enquiry.message}</p>
      <div className="flex flex-wrap items-center gap-2">
        {enquiry.from_phone ? (
          <a
            href={whatsAppLink(
              enquiry.from_phone,
              `Hi ${enquiry.from_name}, thanks for your enquiry about ${
                enquiry.about ?? businessName
              } on KITE.`,
            )}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[var(--color-accent-hover)] transition-colors"
          >
            Reply
          </a>
        ) : (
          <Link to={`/members/${enquiry.from_person_id}`} className={SMALL_BUTTON}>
            View profile
          </Link>
        )}
        {onDone && (
          <button type="button" onClick={onDone} disabled={busy} className={SMALL_BUTTON}>
            Mark done
          </button>
        )}
        {onUndo && (
          <button type="button" onClick={onUndo} disabled={busy} className={SMALL_BUTTON}>
            Undo
          </button>
        )}
      </div>
    </li>
  )
}
