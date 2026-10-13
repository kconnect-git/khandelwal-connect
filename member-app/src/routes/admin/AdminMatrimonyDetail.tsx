import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { AuditList } from '../../components/admin/AuditList'
import { MatrimonyDetails } from '../../components/matrimony/MatrimonyDetails'
import { adminListAuditLog, formatAdminDateTime } from '../../lib/admin'
import {
  MATRIMONY_STATUS_LABELS,
  adminGetMatrimony,
  adminSetMatrimonyHidden,
  adminSetMatrimonyStatus,
  signedPhotoUrls,
  type AdminMatrimonyDecision,
} from '../../lib/matrimony'
import { ageFromDob } from '../../lib/people'
import type { AdminMatrimonyDetail as Detail, AuditLogRow } from '../../types/database'

// Phase 6a: review one matrimony profile. Loading it shows private photos,
// so admin_get_matrimony_profile records an audited view.

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs font-medium tracking-wide text-[var(--color-text-muted)] uppercase">
        {title}
      </h2>
      <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        {children}
      </div>
    </section>
  )
}

const BUTTON =
  'rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm whitespace-nowrap hover:bg-[var(--color-surface-hover)] disabled:opacity-50'
const ACCENT_BUTTON =
  'rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50'

// (6c) Hide / unhide sit alongside the review decisions.
type Action = AdminMatrimonyDecision | 'hide' | 'unhide'

const DIALOGS: Record<
  Action,
  { title: string; description: string; confirm: string; needsNote: boolean }
> = {
  approved: {
    title: 'Approve this profile?',
    description: 'It becomes visible to approved members once browsing is live.',
    confirm: 'Approve',
    needsNote: false,
  },
  changes_requested: {
    title: 'Ask for changes?',
    description: 'The profile goes back to the member with your note. They can edit and resubmit.',
    confirm: 'Send back',
    needsNote: true,
  },
  rejected: {
    title: 'Turn this profile down?',
    description: 'The member sees your reason and can no longer edit or resubmit this profile.',
    confirm: 'Turn down',
    needsNote: true,
  },
  hide: {
    title: 'Hide this profile?',
    description:
      'It disappears from browsing, and the member’s matches are suspended until you unhide it. The member sees your reason and can keep editing.',
    confirm: 'Hide',
    needsNote: true,
  },
  unhide: {
    title: 'Unhide this profile?',
    description: 'It goes live again, and any matches it had come back.',
    confirm: 'Unhide',
    needsNote: false,
  },
}

export function AdminMatrimonyDetail() {
  const { id } = useParams<{ id: string }>()
  const [profile, setProfile] = useState<Detail | null | undefined>(undefined)
  const [history, setHistory] = useState<AuditLogRow[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [decision, setDecision] = useState<Action | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    const [next, nextHistory] = await Promise.all([
      adminGetMatrimony(id),
      adminListAuditLog({ targetId: id, limit: 50 }),
    ])
    setProfile(next)
    setHistory(nextHistory)
    setUrls(next ? await signedPhotoUrls(next.photos.map((photo) => photo.storage_path)) : {})
  }, [id])

  useEffect(() => {
    let cancelled = false
    load().catch((err) => {
      console.error('[AdminMatrimonyDetail] failed to load', err)
      if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load this profile.')
    })
    return () => {
      cancelled = true
    }
  }, [load])

  async function decide(action: Action, note: string) {
    if (!profile) return
    setBusy(true)
    setError(null)
    try {
      if (action === 'hide' || action === 'unhide') {
        await adminSetMatrimonyHidden(profile.id, action === 'hide', note)
      } else {
        await adminSetMatrimonyStatus(profile.id, action, note)
      }
      setDecision(null)
      await load()
    } catch (err) {
      console.error('[AdminMatrimonyDetail] decision failed', err)
      setError(err instanceof Error ? err.message : 'Could not update this profile.')
      setDecision(null)
    } finally {
      setBusy(false)
    }
  }

  const backLink = (
    <Link
      to="/admin/matrimony"
      className="text-sm text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)]"
    >
      ← Matrimony
    </Link>
  )

  if (profile === undefined && !error) {
    return <p className="text-sm text-[var(--color-text-muted)]">Loading profile…</p>
  }
  if (!profile) {
    return (
      <div className="flex flex-col gap-4">
        {backLink}
        <p className="text-sm text-[var(--color-text-muted)]">{error ?? 'No profile with this ID.'}</p>
      </div>
    )
  }

  const age = ageFromDob(profile.dob ?? '')
  const canApprove = profile.status === 'pending'
  const canSendBack =
    profile.status === 'pending' || profile.status === 'approved' || profile.status === 'paused'
  const canHide = profile.status === 'approved' || profile.status === 'paused'
  const canUnhide = profile.status === 'hidden'
  const dialog = decision ? DIALOGS[decision] : null
  const basics: [string, string | null][] = [
    ['Gender', profile.gender],
    ['Age', age === null ? null : `${age}`],
    ['Marital status', profile.marital_status],
    ['Gotra', profile.gotra],
    ['Lives in', [profile.current_city, profile.current_state].filter(Boolean).join(', ') || null],
    ['Education', profile.education],
    ['Occupation', profile.occupation_type],
  ]

  return (
    <div className="flex flex-col gap-6">
      {backLink}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-xl font-semibold">{profile.full_name}</h2>
          <p className="text-sm text-[var(--color-text-muted)]">
            {MATRIMONY_STATUS_LABELS[profile.status]}
            {profile.member_code ? ` · ${profile.member_code}` : ''}
            {profile.submitted_at ? ` · submitted ${formatAdminDateTime(profile.submitted_at)}` : ''}
          </p>
          <Link
            to={`/admin/members/${profile.person_id}`}
            className="text-sm underline underline-offset-2 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            Member record
          </Link>
        </div>
        {(canApprove || canSendBack || canUnhide) && (
          <div className="flex flex-wrap gap-2">
            {canApprove && (
              <button
                type="button"
                className={ACCENT_BUTTON}
                disabled={busy || Boolean(profile.ineligible_reason)}
                onClick={() => setDecision('approved')}
              >
                Approve
              </button>
            )}
            {canUnhide && (
              <button
                type="button"
                className={BUTTON}
                disabled={busy}
                onClick={() => setDecision('unhide')}
              >
                Unhide
              </button>
            )}
            {canHide && (
              <button
                type="button"
                className={BUTTON}
                disabled={busy}
                onClick={() => setDecision('hide')}
              >
                Hide
              </button>
            )}
            {canSendBack && (
              <>
                <button
                  type="button"
                  className={BUTTON}
                  disabled={busy}
                  onClick={() => setDecision('changes_requested')}
                >
                  Request changes
                </button>
                <button
                  type="button"
                  className={BUTTON}
                  disabled={busy}
                  onClick={() => setDecision('rejected')}
                >
                  Turn down
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}
      {profile.ineligible_reason && (
        <p className="rounded-xl border border-[var(--color-accent)] px-4 py-3 text-sm">
          Not eligible right now: {profile.ineligible_reason}
        </p>
      )}
      {profile.review_note && (
        <p className="rounded-lg border-l-2 border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm whitespace-pre-line">
          {profile.reviewed_by_name ? `${profile.reviewed_by_name}: ` : ''}
          {profile.review_note}
        </p>
      )}

      <Section title={`Photos (${profile.photos.length})`}>
        {profile.photos.length === 0 ? (
          <p className="text-sm text-[var(--color-text-muted)]">No photos.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {profile.photos.map((photo) => (
              <li
                key={photo.id}
                className="aspect-[3/4] overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)]"
              >
                {urls[photo.storage_path] && (
                  <a href={urls[photo.storage_path]} target="_blank" rel="noreferrer">
                    <img
                      src={urls[photo.storage_path]}
                      alt={`Photo ${photo.position}`}
                      className="h-full w-full object-cover"
                    />
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Basics (from the member's profile)">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2">
          {basics.map(([label, value]) => (
            <div key={label} className="flex flex-col">
              <dt className="text-xs text-[var(--color-text-muted)]">{label}</dt>
              <dd className="text-sm break-words">{value || '—'}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <Section title="Matrimony profile">
        <MatrimonyDetails profile={profile} />
      </Section>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs font-medium tracking-wide text-[var(--color-text-muted)] uppercase">
          History
        </h2>
        <AuditList rows={history} empty="No admin actions yet." />
      </section>

      <ConfirmDialog
        open={dialog !== null}
        title={dialog?.title ?? ''}
        description={dialog?.description}
        prompt={
          dialog?.needsNote
            ? {
                label: decision === 'changes_requested' ? 'What needs to change' : 'Reason',
                placeholder: 'The member sees this.',
                required: true,
              }
            : undefined
        }
        confirmLabel={dialog?.confirm ?? ''}
        confirmAccent={decision === 'approved'}
        busy={busy}
        onConfirm={(value) => {
          if (decision) decide(decision, value)
        }}
        onCancel={() => setDecision(null)}
      />
    </div>
  )
}
