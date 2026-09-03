import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../utils/supabase'
import { getOwnPerson } from '../lib/people'
import { getMemberProfile, type MemberProfile as MemberProfileData } from '../lib/directory'
import { businessMetaLine, listMemberBusinesses, type MemberBusiness } from '../lib/businesses'
import { Avatar } from '../components/Avatar'

// Flat section in the design doc's member-profile style: small uppercase
// muted header, then label-left / value-right rows separated by hairlines.
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

export function MemberProfile() {
  const { id } = useParams<{ id: string }>()
  const [profile, setProfile] = useState<MemberProfileData | null>(null)
  const [businesses, setBusinesses] = useState<MemberBusiness[]>([])
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
        const [loadedProfile, own, loadedBusinesses] = await Promise.all([
          getMemberProfile(id),
          session ? getOwnPerson(session.user.id) : Promise.resolve(null),
          // Best-effort: a failed businesses fetch shouldn't blank the profile.
          listMemberBusinesses(id).catch((err) => {
            console.error('[MemberProfile] failed to load businesses', err)
            return [] as MemberBusiness[]
          }),
        ])
        if (cancelled) return
        setProfile(loadedProfile)
        setBusinesses(loadedBusinesses)
        setOwnId(own?.id ?? null)
      } catch (err) {
        if (cancelled) return
        console.error('[MemberProfile] failed to load member', err)
        setError(err instanceof Error ? err.message : 'Something went wrong loading this member.')
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
        <p className="text-sm text-[var(--color-text-muted)]">Loading member…</p>
      </div>
    )
  }

  if (error || !profile) {
    return (
      <div className="flex-1 flex flex-col items-start gap-4 px-5 py-10 max-w-2xl mx-auto w-full">
        <h1 className="font-heading text-2xl font-semibold">Member not found</h1>
        <p className="text-[var(--color-text-muted)]">
          {error ?? 'This member does not exist or has not completed onboarding yet.'}
        </p>
        <Link
          to="/directory"
          className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-text-muted)] transition-colors"
        >
          Back to directory
        </Link>
      </div>
    )
  }

  const isSelf = ownId !== null && ownId === profile.id
  const phoneDigits = (profile.mobile_number ?? '').replace(/\D/g, '')
  const subtitle = [
    profile.gotra ? `Gotra ${profile.gotra}` : null,
    profile.current_city,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="flex-1 flex flex-col gap-6 px-5 py-6 max-w-2xl mx-auto w-full">
      <Link
        to="/directory"
        className="text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
      >
        ‹ Directory
      </Link>

      <div className="flex items-center gap-4">
        <Avatar name={profile.full_name} photoUrl={profile.profile_photo_url} size={72} />
        <div className="min-w-0">
          <h1 className="font-heading text-2xl font-bold uppercase leading-tight">
            {profile.full_name}
          </h1>
          {subtitle && <p className="text-sm text-[var(--color-text-muted)] mt-1">{subtitle}</p>}
          <p className="text-xs tracking-wide text-[var(--color-text-muted)] mt-0.5">
            {profile.member_code}
          </p>
        </div>
      </div>

      {isSelf ? (
        <Link
          to="/profile/edit"
          className="self-start rounded-full bg-[var(--color-accent)] text-white font-semibold px-6 py-2.5 text-sm hover:bg-[var(--color-accent-hover)] transition-colors"
        >
          Edit profile
        </Link>
      ) : (
        profile.mobile_number && (
          <div className="flex gap-2">
            <a
              href={`https://wa.me/${phoneDigits}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-full bg-[var(--color-accent)] text-white font-semibold px-6 py-2.5 text-sm hover:bg-[var(--color-accent-hover)] transition-colors"
            >
              WhatsApp
            </a>
            <a
              href={`tel:${profile.mobile_number}`}
              className="rounded-full border border-[var(--color-border)] px-6 py-2.5 text-sm font-semibold hover:border-[var(--color-text-muted)] transition-colors"
            >
              Call
            </a>
          </div>
        )
      )}

      <Section
        title="Location"
        rows={[
          { label: 'City', value: profile.current_city },
          { label: 'District', value: profile.current_district },
          { label: 'State', value: profile.current_state },
          { label: 'Native place', value: profile.native_place },
        ]}
      />

      <Section
        title="Work"
        rows={[
          { label: 'Occupation', value: profile.occupation_type },
          { label: 'Job title', value: profile.job_title },
          { label: 'Company', value: profile.company_name },
          { label: 'Work location', value: profile.job_location },
        ]}
      />

      {businesses.length > 0 && (
        <section className="w-full flex flex-col gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)]">
            Businesses
          </h2>
          <ul className="flex flex-col gap-2">
            {businesses.map((b) => (
              <li key={b.id}>
                <Link
                  to={`/businesses/${b.id}`}
                  className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 hover:bg-[var(--color-surface-hover)] transition-colors"
                >
                  <Avatar name={b.name} photoUrl={b.logo_url} size={40} />
                  <span className="flex flex-col min-w-0">
                    <span className="font-heading font-medium truncate">{b.name}</span>
                    {businessMetaLine(b) && (
                      <span className="text-sm text-[var(--color-text-muted)] truncate">
                        {businessMetaLine(b)}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Section
        title="Background"
        rows={[
          { label: 'Education', value: profile.education },
          { label: 'Marital status', value: profile.marital_status },
        ]}
      />

      {!isSelf && (
        <Section title="Contact" rows={[{ label: 'Mobile', value: profile.mobile_number }]} />
      )}
    </div>
  )
}
