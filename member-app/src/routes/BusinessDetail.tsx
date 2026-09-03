import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../utils/supabase'
import { getOwnPerson } from '../lib/people'
import { businessMetaLine, getBusiness, type BusinessListing } from '../lib/businesses'
import { Avatar } from '../components/Avatar'

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
        </div>
      </div>

      {isOwner ? (
        <Link
          to="/businesses/mine"
          className="self-start rounded-full bg-[var(--color-accent)] text-white font-semibold px-6 py-2.5 text-sm hover:bg-[var(--color-accent-hover)] transition-colors"
        >
          Edit listing
        </Link>
      ) : (
        (business.contact_phone || business.website) && (
          <div className="flex flex-wrap gap-2">
            {business.contact_phone && (
              <>
                <a
                  href={`https://wa.me/${phoneDigits}`}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full bg-[var(--color-accent)] text-white font-semibold px-6 py-2.5 text-sm hover:bg-[var(--color-accent-hover)] transition-colors"
                >
                  WhatsApp
                </a>
                <a
                  href={`tel:${business.contact_phone}`}
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
          </div>
        )
      )}

      {business.description && (
        <section className="w-full flex flex-col gap-1">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)]">
            About
          </h2>
          <p className="text-sm whitespace-pre-line">{business.description}</p>
        </section>
      )}

      <Section
        title="Details"
        rows={[
          { label: 'Category', value: business.category },
          { label: 'City', value: business.city },
          { label: 'State', value: business.state },
          { label: 'Contact', value: business.contact_phone },
          { label: 'Website', value: business.website ? displayUrl(business.website) : null },
        ]}
      />

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
              {business.owner_member_code}
            </span>
          </span>
        </Link>
      </section>
    </div>
  )
}
