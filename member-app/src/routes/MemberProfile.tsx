import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../utils/supabase'
import { getOwnPerson } from '../lib/people'
import { getMemberProfile, type MemberProfile as MemberProfileData } from '../lib/directory'
import { Avatar } from '../components/Avatar'

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-[var(--color-border)] px-3 py-1 text-sm text-[var(--color-text-muted)]">
      {children}
    </span>
  )
}

function InfoCard({
  title,
  rows,
}: {
  title: string
  rows: Array<{ label: string; value: string | null }>
}) {
  const filled = rows.filter((row) => row.value)
  if (filled.length === 0) return null

  return (
    <section className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 flex flex-col gap-3">
      <h2 className="font-heading text-sm font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
        {title}
      </h2>
      <dl className="flex flex-col gap-2">
        {filled.map((row) => (
          <div key={row.label} className="flex justify-between gap-4">
            <dt className="text-sm text-[var(--color-text-muted)]">{row.label}</dt>
            <dd className="text-sm text-right">{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

export function MemberProfile() {
  const { id } = useParams<{ id: string }>()
  const [profile, setProfile] = useState<MemberProfileData | null>(null)
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
        const [loadedProfile, own] = await Promise.all([
          getMemberProfile(id),
          session ? getOwnPerson(session.user.id) : Promise.resolve(null),
        ])
        if (cancelled) return
        setProfile(loadedProfile)
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

  return (
    <div className="flex-1 flex flex-col items-center gap-6 px-5 py-10 max-w-2xl mx-auto w-full">
      <div className="flex flex-col items-center gap-3">
        <Avatar name={profile.full_name} photoUrl={profile.profile_photo_url} size={96} />
        <h1 className="font-heading text-2xl font-bold text-center">{profile.full_name}</h1>
        <span className="rounded-full border border-[var(--color-border)] px-3 py-1 text-sm tracking-wide">
          {profile.member_code}
        </span>
        <div className="flex flex-wrap justify-center gap-2">
          {profile.gotra && <Pill>{profile.gotra} gotra</Pill>}
          {profile.native_place && <Pill>{profile.native_place}</Pill>}
        </div>
      </div>

      <InfoCard
        title="Location"
        rows={[
          { label: 'City', value: profile.current_city },
          { label: 'District', value: profile.current_district },
          { label: 'State', value: profile.current_state },
          { label: 'Native place', value: profile.native_place },
        ]}
      />

      <InfoCard
        title="Background"
        rows={[
          { label: 'Education', value: profile.education },
          { label: 'Marital status', value: profile.marital_status },
        ]}
      />

      {isSelf ? (
        <Link
          to="/profile/edit"
          className="rounded-lg bg-[var(--color-accent)] text-white font-medium px-5 py-2.5 text-sm hover:bg-[var(--color-accent-hover)] transition-colors"
        >
          Edit profile
        </Link>
      ) : (
        profile.mobile_number && (
          <div className="flex flex-col items-center gap-3">
            <p className="text-sm text-[var(--color-text-muted)]">{profile.mobile_number}</p>
            <div className="flex gap-3">
              <a
                href={`tel:${profile.mobile_number}`}
                className="rounded-lg bg-[var(--color-accent)] text-white font-medium px-5 py-2.5 text-sm hover:bg-[var(--color-accent-hover)] transition-colors"
              >
                Call
              </a>
              <a
                href={`https://wa.me/${phoneDigits}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-[var(--color-border)] px-5 py-2.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-text-muted)] transition-colors"
              >
                WhatsApp
              </a>
            </div>
          </div>
        )
      )}
    </div>
  )
}
