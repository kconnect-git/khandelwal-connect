import { useEffect, useState } from 'react'
import { Avatar } from '../Avatar'
import { EventInviteePicker } from './EventInviteePicker'
import {
  addEventInvitee,
  listEventInvitees,
  removeEventInvitee,
  sendEventInvites,
  type EventInvitee,
} from '../../lib/events'
import type { MemberCandidate } from '../../lib/familyDetails'

type EventInviteesSectionProps = {
  eventId: string
  selfId: string
}

const EMAILED_FORMAT = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' })

/** Organiser-only block on the event page (approved events): add invitees,
 * then email them -- explicitly, per person or all-not-yet-emailed. Adding
 * never emails by itself. */
export function EventInviteesSection({ eventId, selfId }: EventInviteesSectionProps) {
  const [invitees, setInvitees] = useState<EventInvitee[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [emailingAll, setEmailingAll] = useState(false)

  async function reload() {
    setInvitees(await listEventInvitees(eventId))
  }

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    listEventInvitees(eventId)
      .then((rows) => {
        if (!cancelled) setInvitees(rows)
      })
      .catch((err) => {
        if (cancelled) return
        console.error('[EventInviteesSection] failed to load invitees', err)
        setError(err instanceof Error ? err.message : 'Could not load invitees.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [eventId])

  async function handleAdd(candidate: MemberCandidate) {
    // Errors propagate to the picker, which shows them inline.
    await addEventInvitee(eventId, candidate.id)
    setNotice(null)
    await reload()
  }

  async function handleRemove(invitee: EventInvitee) {
    if (!window.confirm(`Remove ${invitee.full_name} from the invite list?`)) return
    setBusyId(invitee.person_id)
    setError(null)
    setNotice(null)
    try {
      await removeEventInvitee(eventId, invitee.person_id)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove this invitee.')
    } finally {
      setBusyId(null)
    }
  }

  async function send(personIds: string[]) {
    setError(null)
    setNotice(null)
    const result = await sendEventInvites({ eventId, personIds })
    await reload()
    const failed = result.failed.length
    setNotice(
      failed === 0
        ? `${result.sent} email${result.sent === 1 ? '' : 's'} sent.`
        : `${result.sent} sent, ${failed} failed: ${result.failed.map((f) => f.reason).join('; ')}`,
    )
  }

  async function handleEmailOne(invitee: EventInvitee) {
    setBusyId(invitee.person_id)
    try {
      await send([invitee.person_id])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the email.')
    } finally {
      setBusyId(null)
    }
  }

  async function handleEmailAll() {
    const pending = invitees.filter((i) => i.emailed_at === null).map((i) => i.person_id)
    if (pending.length === 0) {
      setNotice('Everyone on the list has already been emailed.')
      return
    }
    setEmailingAll(true)
    try {
      await send(pending)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the emails.')
    } finally {
      setEmailingAll(false)
    }
  }

  const invitedIds = new Set(invitees.map((i) => i.person_id))
  const notEmailed = invitees.filter((i) => i.emailed_at === null).length

  return (
    <section className="w-full flex flex-col gap-3">
      <div className="flex items-end justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-[var(--color-text-muted)]">
          Invitees
        </h2>
        {invitees.length > 0 && (
          <button
            type="button"
            onClick={handleEmailAll}
            disabled={emailingAll || notEmailed === 0}
            className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-text-muted)] disabled:opacity-60 transition-colors"
          >
            {emailingAll
              ? 'Sending…'
              : notEmailed === 0
                ? 'Everyone emailed'
                : `Email all not yet emailed (${notEmailed})`}
          </button>
        )}
      </div>

      <EventInviteePicker invitedIds={invitedIds} selfId={selfId} onAdd={handleAdd} />

      {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}
      {notice && <p className="text-sm text-[var(--color-text-muted)]">{notice}</p>}

      {loading ? (
        <p className="text-sm text-[var(--color-text-muted)]">Loading invitees…</p>
      ) : invitees.length === 0 ? (
        <p className="text-sm text-[var(--color-text-muted)]">
          Nobody invited yet. Search for members above to add them.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {invitees.map((invitee) => {
            const busy = busyId === invitee.person_id
            return (
              <li
                key={invitee.person_id}
                className="flex items-center gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3"
              >
                <Avatar name={invitee.full_name} photoUrl={invitee.profile_photo_url} size={36} />
                <span className="flex-1 min-w-0 flex flex-col">
                  <span className="font-heading font-medium truncate">{invitee.full_name}</span>
                  <span className="text-xs text-[var(--color-text-muted)] truncate">
                    {invitee.member_code} ·{' '}
                    {invitee.emailed_at
                      ? `Emailed ${EMAILED_FORMAT.format(new Date(invitee.emailed_at))}`
                      : 'Not emailed'}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => handleEmailOne(invitee)}
                  disabled={busy || emailingAll}
                  className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-text-muted)] disabled:opacity-60 transition-colors"
                >
                  {busy ? '…' : invitee.emailed_at ? 'Resend' : 'Send email'}
                </button>
                <button
                  type="button"
                  onClick={() => handleRemove(invitee)}
                  disabled={busy || emailingAll}
                  aria-label={`Remove ${invitee.full_name}`}
                  className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] disabled:opacity-60 transition-colors"
                >
                  Remove
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
