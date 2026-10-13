import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Avatar } from '../../components/Avatar'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { InterestStatePill } from '../../components/matrimony/MatrimonyCard'
import { MatrimonyDetails } from '../../components/matrimony/MatrimonyDetails'
import { ReportDialog } from '../../components/matrimony/ReportDialog'
import { useMatrimony } from '../../context/MatrimonyContext'
import {
  INTEREST_MESSAGE_MAX,
  SHARE_ON_ACCEPT,
  blockMatrimonyProfile,
  endMatrimonyMatch,
  expressInterest,
  getMatrimonyProfile,
  reportMatrimonyProfile,
  respondInterest,
  shortName,
  signedPhotoUrls,
  withdrawInterest,
} from '../../lib/matrimony'
import type { MatrimonyProfileView } from '../../types/database'

// Phase 6b: one matrimony profile as another member sees it. Before a match:
// first name + initial and the profile's own fields, no photos or contact.
// After a mutual match the server adds a `contact` block (full name, family,
// email, mobile unless hidden, photo paths) and the storage policy lets the
// photos be signed.

type Dialog = 'express' | 'withdraw' | 'accept' | 'decline' | 'unmatch' | 'block' | 'report' | null

const ACCENT_BUTTON =
  'rounded-lg bg-[var(--color-accent)] text-white font-medium py-2.5 px-5 hover:bg-[var(--color-accent-hover)] disabled:opacity-60 transition-colors'
const BUTTON =
  'rounded-lg border border-[var(--color-border)] py-2.5 px-5 font-medium hover:bg-[var(--color-surface-hover)] disabled:opacity-60 transition-colors'

function ContactRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-sm text-[var(--color-text-muted)]">{label}</dt>
      <dd className="text-right break-words">{value ?? '—'}</dd>
    </div>
  )
}

export function MatrimonyProfilePage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { refresh: refreshBadge } = useMatrimony()
  const [profile, setProfile] = useState<MatrimonyProfileView | null | undefined>(undefined)
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    const next = await getMatrimonyProfile(id)
    setProfile(next)
    setUrls(next?.contact ? await signedPhotoUrls(next.contact.photo_paths) : {})
  }, [id])

  useEffect(() => {
    load().catch((err) => {
      console.error('[MatrimonyProfilePage] failed to load', err)
      setError(err instanceof Error ? err.message : 'Could not load this profile.')
      setProfile(null)
    })
  }, [load])

  async function act(action: () => Promise<string | null>) {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const message = await action()
      setDialog(null)
      await load()
      refreshBadge()
      setNotice(message)
    } catch (err) {
      setDialog(null)
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  const backLink = (
    <Link
      to="/matrimony"
      className="text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
    >
      ‹ Matrimony
    </Link>
  )

  if (profile === undefined) {
    return (
      <div className="flex-1 flex flex-col gap-6 px-5 py-8 max-w-2xl mx-auto w-full">
        {backLink}
        <p className="text-sm text-[var(--color-text-muted)]">Loading profile…</p>
      </div>
    )
  }
  if (profile === null) {
    return (
      <div className="flex-1 flex flex-col gap-6 px-5 py-8 max-w-2xl mx-auto w-full">
        {backLink}
        <p className="text-sm text-[var(--color-text-muted)]">
          {error ?? 'This profile isn’t available.'}
        </p>
      </div>
    )
  }

  const contact = profile.contact
  const name = contact?.full_name ?? shortName(profile)
  const mainPhoto = contact?.photo_paths[0] ? urls[contact.photo_paths[0]] : null
  const facts = [
    profile.age !== null ? `${profile.age} years` : null,
    [profile.current_city, profile.current_state].filter(Boolean).join(', ') || null,
    profile.gotra ? `${profile.gotra} gotra` : null,
  ].filter(Boolean)
  const work = [profile.education, profile.occupation_type].filter(Boolean).join(' · ')
  const incoming = profile.incoming_interest

  return (
    <div className="flex-1 flex flex-col gap-6 px-5 py-8 max-w-2xl mx-auto w-full">
      {backLink}

      <div className="flex items-start gap-4">
        <Avatar name={name || '?'} photoUrl={mainPhoto} size={72} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-heading text-2xl font-semibold">{name}</h1>
            <InterestStatePill state={profile.interest_state} />
          </div>
          {facts.length > 0 && (
            <p className="text-[var(--color-text-muted)]">{facts.join(' · ')}</p>
          )}
          {work && <p className="text-[var(--color-text-muted)]">{work}</p>}
        </div>
      </div>

      {/* What the member can do from here. */}
      <section className="flex flex-col gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        {profile.interest_state === 'none' && (
          <>
            <p className="text-sm text-[var(--color-text-muted)]">
              Photos and contact details are shared only if you both say yes.
            </p>
            <button
              type="button"
              className={`${ACCENT_BUTTON} self-start`}
              disabled={busy}
              onClick={() => setDialog('express')}
            >
              Express interest
            </button>
          </>
        )}
        {profile.interest_state === 'sent' && (
          <>
            <p className="text-sm">You’ve expressed interest. Waiting for a reply.</p>
            {profile.outgoing_interest_id && (
              <button
                type="button"
                className={`${BUTTON} self-start`}
                disabled={busy}
                onClick={() => setDialog('withdraw')}
              >
                Withdraw interest
              </button>
            )}
          </>
        )}
        {profile.interest_state === 'no_response' && (
          <p className="text-sm text-[var(--color-text-muted)]">
            You expressed interest. There’s been no response.
          </p>
        )}
        {profile.interest_state === 'received' && incoming && (
          <>
            <p className="text-sm">{shortName(profile)} is interested in you.</p>
            {incoming.message && (
              <p className="border-l-2 border-[var(--color-border)] pl-3 whitespace-pre-line">
                {incoming.message}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={ACCENT_BUTTON}
                disabled={busy}
                onClick={() => setDialog('accept')}
              >
                Accept
              </button>
              <button
                type="button"
                className={BUTTON}
                disabled={busy}
                onClick={() => setDialog('decline')}
              >
                Decline
              </button>
            </div>
          </>
        )}
        {profile.interest_state === 'matched' && (
          <p className="text-sm">You’re matched. Your contact details are shared with each other.</p>
        )}
        {notice && <p className="text-sm text-[var(--color-text-muted)]">{notice}</p>}
        {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}
      </section>

      {contact && (
        <section className="flex flex-col gap-4">
          {contact.photo_paths.length > 0 && (
            <ul className="grid grid-cols-3 gap-3">
              {contact.photo_paths.map((path, index) => (
                <li
                  key={path}
                  className="aspect-[3/4] overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]"
                >
                  {urls[path] && (
                    <img src={urls[path]} alt={`Photo ${index + 1}`} className="h-full w-full object-cover" />
                  )}
                </li>
              ))}
            </ul>
          )}
          <dl className="flex flex-col gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
            <ContactRow
              label="Mobile"
              value={
                contact.mobile_hidden ? (
                  <span className="text-[var(--color-text-muted)]">Hidden by member</span>
                ) : contact.mobile_number ? (
                  <a href={`tel:${contact.mobile_number}`} className="underline underline-offset-2">
                    {contact.mobile_number}
                  </a>
                ) : null
              }
            />
            <ContactRow
              label="Email"
              value={
                contact.email ? (
                  <a href={`mailto:${contact.email}`} className="underline underline-offset-2">
                    {contact.email}
                  </a>
                ) : null
              }
            />
            <ContactRow label="Father" value={contact.father_name} />
            <ContactRow label="Mother" value={contact.mother_name} />
            <ContactRow label="Native place" value={contact.native_place} />
          </dl>
        </section>
      )}

      <MatrimonyDetails profile={profile} />

      {/* (6c) Safety actions, kept quiet at the foot of the page. */}
      <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-[var(--color-border)] pt-4 text-sm">
        {profile.match_interest_id && (
          <button
            type="button"
            disabled={busy}
            onClick={() => setDialog('unmatch')}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-60"
          >
            Un-match
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() => setDialog('block')}
          className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-60"
        >
          Block
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setDialog('report')}
          className="text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-60"
        >
          Report
        </button>
      </div>

      <ConfirmDialog
        open={dialog === 'express'}
        title={`Express interest in ${shortName(profile)}?`}
        description="They’ll see your profile and can accept or decline. If they accept, you’ll both see each other’s photos and contact details."
        prompt={{
          label: 'Message (optional)',
          placeholder: 'A short note to introduce yourself.',
          maxLength: INTEREST_MESSAGE_MAX,
          hint: 'Don’t include contact details here; they’re shared automatically if you match.',
        }}
        confirmLabel="Send"
        confirmAccent
        busy={busy}
        onConfirm={(message) =>
          act(async () =>
            (await expressInterest(profile.id, message)) === 'matched'
              ? 'They had already expressed interest in you. You’re matched!'
              : 'Interest sent.',
          )
        }
        onCancel={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === 'withdraw'}
        title="Withdraw your interest?"
        description="They won’t see it any more. You can express interest again later."
        confirmLabel="Withdraw"
        busy={busy}
        onConfirm={() =>
          act(async () => {
            if (profile.outgoing_interest_id) await withdrawInterest(profile.outgoing_interest_id)
            return 'Interest withdrawn.'
          })
        }
        onCancel={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === 'accept'}
        title={`Accept ${shortName(profile)}’s interest?`}
        description={SHARE_ON_ACCEPT}
        confirmLabel="Accept"
        confirmAccent
        busy={busy}
        onConfirm={() =>
          act(async () => {
            if (incoming) await respondInterest(incoming.id, true)
            return 'You’re matched.'
          })
        }
        onCancel={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === 'unmatch'}
        title={`Un-match ${name}?`}
        description="You’ll both lose access to each other’s photos and contact details, and neither of you can express interest again."
        confirmLabel="Un-match"
        busy={busy}
        onConfirm={() =>
          act(async () => {
            if (profile.match_interest_id) await endMatrimonyMatch(profile.match_interest_id)
            navigate('/matrimony/interests?box=matches', { replace: true })
            return null
          })
        }
        onCancel={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === 'block'}
        title={`Block ${name}?`}
        description="You won’t see each other anywhere in matrimony. Any match or pending interest between you ends. You can unblock later from your matrimony profile."
        confirmLabel="Block"
        busy={busy}
        onConfirm={() =>
          act(async () => {
            await blockMatrimonyProfile(profile.id)
            navigate('/matrimony', { replace: true })
            return null
          })
        }
        onCancel={() => setDialog(null)}
      />
      <ReportDialog
        open={dialog === 'report'}
        name={shortName(profile)}
        busy={busy}
        onSubmit={({ reason, details, alsoBlock }) =>
          act(async () => {
            await reportMatrimonyProfile(profile.id, reason, details)
            if (alsoBlock) {
              await blockMatrimonyProfile(profile.id)
              navigate('/matrimony', { replace: true })
            }
            return 'Thanks. The admins will look into it.'
          })
        }
        onCancel={() => setDialog(null)}
      />
      <ConfirmDialog
        open={dialog === 'decline'}
        title="Decline this interest?"
        description="They won’t be told you declined. Their interest will just show as having no response."
        confirmLabel="Decline"
        busy={busy}
        onConfirm={() =>
          act(async () => {
            if (incoming) await respondInterest(incoming.id, false)
            return 'Declined.'
          })
        }
        onCancel={() => setDialog(null)}
      />
    </div>
  )
}
