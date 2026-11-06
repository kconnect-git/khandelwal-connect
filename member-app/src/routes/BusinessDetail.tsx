import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../utils/supabase'
import { getOwnPerson } from '../lib/people'
import {
  BUSINESS_REPORT_REASON_OPTIONS,
  businessMetaLine,
  getBusiness,
  logBusinessActivity,
  reportBusiness,
  setBusinessSaved,
  type BusinessListing,
} from '../lib/businesses'
import { Avatar } from '../components/Avatar'
import { ReportDialog } from '../components/ReportDialog'
import { VerifiedTag } from '../components/businesses/VerifiedTag'
import { EnquiryDialog } from '../components/businesses/EnquiryDialog'
import { sendBusinessEnquiry } from '../lib/businessDashboard'

const ACTION_BUTTON =
  'rounded-lg border border-[var(--color-border)] py-2.5 text-sm font-semibold hover:border-[var(--color-text-muted)] disabled:opacity-60 transition-colors'

function Section({
  title,
  rows,
}: {
  title: string
  rows: Array<{ label: string; value: string | null }>
}) {
  const filled = rows.filter((row) => row.value)
  if (filled.length === 0) return null

  return (
    <section className="w-full flex flex-col gap-1">
      <h2 className="text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)]">
        {title}
      </h2>
      <dl className="flex flex-col divide-y divide-[var(--color-border)]">
        {filled.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-4 py-2.5">
            <dt className="text-sm text-[var(--color-text-muted)]">{row.label}</dt>
            <dd className="text-sm font-medium text-right">{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//i, '').replace(/\/$/, '')
}

export function BusinessDetail() {
  const { id } = useParams<{ id: string }>()
  const [business, setBusiness] = useState<BusinessListing | null>(null)
  const [ownId, setOwnId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // (10.3) Share / Save / Report.
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [reportBusy, setReportBusy] = useState(false)
  const [reported, setReported] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  // (10.8) Enquire: undefined = closed; null = General; a string = that product.
  const [enquiryAbout, setEnquiryAbout] = useState<string | null | undefined>(undefined)
  const [enquiryBusy, setEnquiryBusy] = useState(false)
  const [enquirySent, setEnquirySent] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function load() {
      if (!id) return
      setLoading(true)
      setError(null)
      try {
        const { data: sessionData } = await supabase.auth.getSession()
        const session = sessionData.session
        const [loaded, own] = await Promise.all([
          getBusiness(id),
          session ? getOwnPerson(session.user.id) : Promise.resolve(null),
        ])
        if (cancelled) return
        setBusiness(loaded)
        setOwnId(own?.id ?? null)
        setSaved(loaded?.is_saved ?? false)
        // (10.3) Count the view for the owner's dashboard. The RPC also
        // skips the owner and same-day repeats.
        if (loaded && loaded.owner_id !== own?.id) logBusinessActivity(loaded.id, 'view')
      } catch (err) {
        if (cancelled) return
        console.error('[BusinessDetail] failed to load', err)
        setError(err instanceof Error ? err.message : 'Something went wrong loading this business.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [id])

  if (loading) {
    return (
      <div className="flex-1 flex flex-col px-5 py-10 max-w-2xl mx-auto w-full">
        <p className="text-sm text-[var(--color-text-muted)]">Loading business…</p>
      </div>
    )
  }

  if (error || !business) {
    return (
      <div className="flex-1 flex flex-col items-start gap-4 px-5 py-10 max-w-2xl mx-auto w-full">
        <h1 className="font-heading text-2xl font-semibold">Business not found</h1>
        <p className="text-[var(--color-text-muted)]">
          {error ?? 'This listing does not exist or has been removed.'}
        </p>
        <Link
          to="/businesses"
          className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-text-muted)] transition-colors"
        >
          Back to businesses
        </Link>
      </div>
    )
  }

  const isOwner = ownId !== null && ownId === business.owner_id
  const phoneDigits = (business.contact_phone ?? '').replace(/\D/g, '')
  const subtitle = businessMetaLine(business)
  const officeAddress =
    [business.address_line1, business.address_line2].filter(Boolean).join(', ') || null
  const socialLinks = [
    { label: 'Facebook', url: business.facebook_url },
    { label: 'Instagram', url: business.instagram_url },
    { label: 'LinkedIn', url: business.linkedin_url },
    { label: 'YouTube', url: business.youtube_url },
  ].filter((link): link is { label: string; url: string } => Boolean(link.url))
  const listing = business

  async function handleShare() {
    setActionError(null)
    // The link still needs a login to open, like every page in the app.
    const url = `${window.location.origin}/businesses/${listing.id}`
    try {
      if (navigator.share) {
        await navigator.share({ title: listing.name, url })
      } else {
        await navigator.clipboard.writeText(url)
        setLinkCopied(true)
        setTimeout(() => setLinkCopied(false), 2000)
      }
    } catch (err) {
      // Closing the share sheet rejects with AbortError -- not a failure.
      if (err instanceof Error && err.name === 'AbortError') return
      console.error('[BusinessDetail] failed to share', err)
      setActionError('Could not share this listing.')
    }
  }

  async function handleToggleSaved() {
    const next = !saved
    setSaved(next)
    setSaving(true)
    setActionError(null)
    try {
      await setBusinessSaved(listing.id, next)
    } catch (err) {
      console.error('[BusinessDetail] failed to save', err)
      setSaved(!next)
      setActionError(err instanceof Error ? err.message : 'Could not update your saved list.')
    } finally {
      setSaving(false)
    }
  }

  async function handleEnquiry(about: string | null, message: string) {
    setEnquiryBusy(true)
    setActionError(null)
    try {
      await sendBusinessEnquiry(listing.id, about, message)
      setEnquirySent(true)
    } catch (err) {
      console.error('[BusinessDetail] failed to send enquiry', err)
      setActionError(err instanceof Error ? err.message : 'Could not send your enquiry.')
    } finally {
      setEnquiryAbout(undefined)
      setEnquiryBusy(false)
    }
  }

  async function handleReport(reason: string, details: string) {
    setReportBusy(true)
    setActionError(null)
    try {
      await reportBusiness(listing.id, reason, details)
      setReported(true)
      setReportOpen(false)
    } catch (err) {
      console.error('[BusinessDetail] failed to report', err)
      setReportOpen(false)
      setActionError(err instanceof Error ? err.message : 'Could not send your report.')
    } finally {
      setReportBusy(false)
    }
  }

  return (
    <div className="flex-1 flex flex-col gap-6 px-5 py-6 max-w-2xl mx-auto w-full">
      <Link
        to="/businesses"
        className="text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
      >
        ‹ Businesses
      </Link>

      <div className="flex items-center gap-4">
        <Avatar name={business.name} photoUrl={business.logo_url} size={72} />
        <div className="min-w-0">
          <h1 className="font-heading text-2xl font-bold uppercase leading-tight">
            {business.name}
          </h1>
          {subtitle && <p className="text-sm text-[var(--color-text-muted)] mt-1">{subtitle}</p>}
          {business.is_verified && (
            <p className="mt-1">
              <VerifiedTag />
            </p>
          )}
        </div>
      </div>

      {isOwner ? (
        <Link
          to={`/businesses/${business.id}/edit`}
          className="self-start rounded-full bg-[var(--color-accent)] text-white font-semibold px-6 py-2.5 text-sm hover:bg-[var(--color-accent-hover)] transition-colors"
        >
          Edit listing
        </Link>
      ) : (
        // (10.8) Always shown to other members: Enquire works even when the
        // owner hides their number.
        (
          <div className="flex flex-wrap gap-2">
            {business.contact_phone && (
              <>
                <a
                  href={`https://wa.me/${phoneDigits}`}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => logBusinessActivity(business.id, 'whatsapp')}
                  className="rounded-full bg-[var(--color-accent)] text-white font-semibold px-6 py-2.5 text-sm hover:bg-[var(--color-accent-hover)] transition-colors"
                >
                  WhatsApp
                </a>
                <a
                  href={`tel:${business.contact_phone}`}
                  onClick={() => logBusinessActivity(business.id, 'call')}
                  className="rounded-full border border-[var(--color-border)] px-6 py-2.5 text-sm font-semibold hover:border-[var(--color-text-muted)] transition-colors"
                >
                  Call
                </a>
              </>
            )}
            {business.website && (
              <a
                href={business.website}
                target="_blank"
                rel="noreferrer"
                className="rounded-full border border-[var(--color-border)] px-6 py-2.5 text-sm font-semibold hover:border-[var(--color-text-muted)] transition-colors"
              >
                Website
              </a>
            )}
            <button
              type="button"
              onClick={() => setEnquiryAbout(null)}
              disabled={enquirySent}
              className="rounded-full border border-[var(--color-border)] px-6 py-2.5 text-sm font-semibold hover:border-[var(--color-text-muted)] disabled:opacity-60 transition-colors"
            >
              {enquirySent ? 'Enquiry sent' : 'Enquire'}
            </button>
          </div>
        )
      )}
      {enquirySent && (
        <p className="text-sm text-[var(--color-text-muted)]">
          Sent — {business.owner_name} will see it on their dashboard.
        </p>
      )}

      {business.description && (
        <section className="w-full flex flex-col gap-1">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)]">
            About
          </h2>
          <p className="text-sm whitespace-pre-line">{business.description}</p>
        </section>
      )}

      {business.products.length > 0 && (
        <section className="w-full flex flex-col gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)]">
            Products & services
          </h2>
          <ul className="flex flex-wrap gap-2">
            {business.products.map((product) => (
              <li key={product}>
                {/* (10.8) Tap a product to ask about it. */}
                {isOwner || enquirySent ? (
                  <span className="block rounded-full border border-[var(--color-border)] px-4 py-1.5 text-sm">
                    {product}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setEnquiryAbout(product)}
                    className="rounded-full border border-[var(--color-border)] px-4 py-1.5 text-sm hover:border-[var(--color-text-muted)] transition-colors"
                  >
                    {product}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <Section
        title="Details"
        rows={[
          { label: 'Brand', value: business.brand_name },
          { label: 'Industry', value: business.category },
          { label: 'Business type', value: business.business_type },
          { label: 'Office address', value: officeAddress },
          { label: 'City', value: business.city },
          { label: 'State', value: business.state },
          { label: 'Contact', value: business.contact_phone },
          { label: 'Email', value: business.business_email },
          { label: 'Website', value: business.website ? displayUrl(business.website) : null },
        ]}
      />

      {socialLinks.length > 0 && (
        <section className="w-full flex flex-col gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)]">
            Links
          </h2>
          <div className="flex flex-wrap gap-2">
            {socialLinks.map((link) => (
              <a
                key={link.label}
                href={link.url}
                target="_blank"
                rel="noreferrer"
                className="rounded-full border border-[var(--color-border)] px-4 py-1.5 text-sm hover:border-[var(--color-text-muted)] transition-colors"
              >
                {link.label}
              </a>
            ))}
          </div>
        </section>
      )}

      {/* (10.3) The owner gets Share only. */}
      <section className="w-full flex flex-col gap-2">
        <div className={`grid gap-2 ${isOwner ? 'grid-cols-1' : 'grid-cols-3'}`}>
          <button type="button" onClick={handleShare} className={ACTION_BUTTON}>
            {linkCopied ? 'Link copied' : 'Share'}
          </button>
          {!isOwner && (
            <>
              <button
                type="button"
                onClick={handleToggleSaved}
                disabled={saving}
                aria-pressed={saved}
                className={ACTION_BUTTON}
              >
                {saved ? 'Saved' : 'Save'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setActionError(null)
                  setReportOpen(true)
                }}
                disabled={reported}
                className={ACTION_BUTTON}
              >
                {reported ? 'Reported' : 'Report'}
              </button>
            </>
          )}
        </div>
        {/* (10.7) Pass someone who needs this business to its owner. */}
        {!isOwner && (
          <Link
            to={`/business/referrals/new?business=${business.id}`}
            className={`${ACTION_BUTTON} text-center`}
          >
            Refer someone
          </Link>
        )}
        {reported && (
          <p className="text-sm text-[var(--color-text-muted)]">
            Thanks — the admins will take a look.
          </p>
        )}
        {actionError && <p className="text-sm text-[var(--color-accent)]">{actionError}</p>}
      </section>

      <section className="w-full flex flex-col gap-1">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)]">
          Owner
        </h2>
        <Link
          to={`/members/${business.owner_id}`}
          className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 hover:bg-[var(--color-surface-hover)] transition-colors"
        >
          <Avatar name={business.owner_name} photoUrl={business.owner_photo_url} size={40} />
          <span className="flex flex-col min-w-0">
            <span className="font-heading font-medium truncate">{business.owner_name}</span>
            <span className="text-xs tracking-wide text-[var(--color-text-muted)]">
              {[business.owner_role, business.owner_member_code].filter(Boolean).join(' · ')}
            </span>
          </span>
        </Link>
      </section>

      <EnquiryDialog
        open={enquiryAbout !== undefined}
        businessName={business.name}
        products={business.products}
        initialAbout={enquiryAbout ?? null}
        busy={enquiryBusy}
        onSubmit={({ about, message }) => handleEnquiry(about, message)}
        onCancel={() => setEnquiryAbout(undefined)}
      />
      <ReportDialog
        open={reportOpen}
        name={business.name}
        busy={reportBusy}
        reasons={BUSINESS_REPORT_REASON_OPTIONS}
        note="Only the admins see reports. The owner won’t be told who reported this listing."
        onSubmit={({ reason, details }) => handleReport(reason, details)}
        onCancel={() => setReportOpen(false)}
      />
    </div>
  )
}
