import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  REFERRAL_OUTCOME_LABELS,
  REFERRAL_STATUS_LABELS,
  closeBusinessReferral,
  respondBusinessReferral,
  withdrawBusinessReferral,
} from '../../lib/businessReferrals'
import { whatsAppLink } from '../../lib/businessPosts'
import { ConfirmDialog } from '../ConfirmDialog'
import type { BusinessReferralRow, ReferralOutcome, ReferralStatus } from '../../types/database'

// Phase 10.7: one referral, from either side. Received (the business owner):
// Accept / Decline a new one, close an accepted one as business done or not.
// Given (the referrer): follow it, withdraw it while it's still new.

const DATE_FORMAT = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' })

const STATUS_PILL: Record<ReferralStatus, string> = {
  new: 'bg-[var(--color-accent)] text-white',
  in_talks: 'bg-[var(--color-badge-soon-bg)] text-[var(--color-badge-soon-fg)]',
  closed: 'bg-[var(--color-badge-live-bg)] text-[var(--color-badge-live-fg)]',
  declined: 'border border-[var(--color-border)] text-[var(--color-text-muted)]',
}

const PRIMARY =
  'rounded-lg bg-[var(--color-accent)] py-2 text-sm font-semibold text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-60 transition-colors'
const OUTLINE =
  'rounded-lg border border-[var(--color-border)] py-2 text-sm font-semibold hover:border-[var(--color-text-muted)] disabled:opacity-60 transition-colors'

type Pending = 'decline' | 'withdraw' | ReferralOutcome | null

export function ReferralCard({
  referral,
  direction,
  onChanged,
}: {
  referral: BusinessReferralRow
  direction: 'received' | 'given'
  /** Reload the list and counters. */
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [closing, setClosing] = useState(false)
  const [pending, setPending] = useState<Pending>(null)

  const received = direction === 'received'
  const open = referral.status === 'new' || referral.status === 'in_talks'
  const statusLabel =
    referral.status === 'closed' && referral.outcome
      ? `${REFERRAL_STATUS_LABELS.closed} · ${REFERRAL_OUTCOME_LABELS[referral.outcome]}`
      : REFERRAL_STATUS_LABELS[referral.status]

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      setPending(null)
      setClosing(false)
      onChanged()
    } catch (err) {
      setPending(null)
      setError(err instanceof Error ? err.message : 'Could not update this referral.')
    } finally {
      setBusy(false)
    }
  }

  function handleConfirm(reason: string) {
    if (pending === 'decline') {
      run(() => respondBusinessReferral(referral.id, false, reason))
    } else if (pending === 'withdraw') {
      run(() => withdrawBusinessReferral(referral.id))
    } else if (pending) {
      const outcome = pending
      run(() => closeBusinessReferral(referral.id, outcome))
    }
  }

  return (
    <article className="flex flex-col gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="flex items-center justify-between gap-2">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_PILL[referral.status]}`}>
          {statusLabel}
        </span>
        <span className="text-xs text-[var(--color-text-muted)]">
          {DATE_FORMAT.format(new Date(referral.created_at))}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <h2 className="font-heading font-semibold leading-snug">
          {received ? referral.lead_name : `To ${referral.business_name}`}
        </h2>
        <p className="text-sm whitespace-pre-line">{referral.note}</p>
        <p className="text-xs text-[var(--color-text-muted)]">
          {received
            ? `Referred by ${referral.referrer_name} · for ${referral.business_name}`
            : `Lead: ${referral.lead_name}`}
        </p>
      </div>

      {/* The lead's details, only while it's open (the server clears the
          phone once it's declined or closed). */}
      {open && (referral.lead_phone || referral.lead_person_id) && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {referral.lead_phone && (
            <>
              <a
                href={`tel:${referral.lead_phone}`}
                className="underline-offset-2 hover:underline"
              >
                Call {referral.lead_phone.replace(/^\+91/, '')}
              </a>
              <a
                href={whatsAppLink(referral.lead_phone, `Hi ${referral.lead_name}, ${referral.referrer_name} from the Khandelwal community passed on your details.`)}
                target="_blank"
                rel="noreferrer"
                className="underline-offset-2 hover:underline"
              >
                WhatsApp
              </a>
            </>
          )}
          {referral.lead_person_id && (
            <Link
              to={`/members/${referral.lead_person_id}`}
              className="underline-offset-2 hover:underline"
            >
              View profile{referral.lead_member_code ? ` · ${referral.lead_member_code}` : ''}
            </Link>
          )}
        </div>
      )}

      {referral.status === 'declined' && referral.decline_reason && (
        <p className="rounded-lg border-l-2 border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm whitespace-pre-line">
          {referral.decline_reason}
        </p>
      )}

      {received && referral.status === 'new' && (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => run(() => respondBusinessReferral(referral.id, true))}
            disabled={busy}
            className={PRIMARY}
          >
            Accept
          </button>
          <button type="button" onClick={() => setPending('decline')} disabled={busy} className={OUTLINE}>
            Decline
          </button>
        </div>
      )}

      {received && referral.status === 'in_talks' &&
        (closing ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-[var(--color-text-muted)]">How did it turn out?</p>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setPending('won')} disabled={busy} className={PRIMARY}>
                {REFERRAL_OUTCOME_LABELS.won}
              </button>
              <button type="button" onClick={() => setPending('lost')} disabled={busy} className={OUTLINE}>
                {REFERRAL_OUTCOME_LABELS.lost}
              </button>
            </div>
            <button
              type="button"
              onClick={() => setClosing(false)}
              className="self-start text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              Not yet
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setClosing(true)} disabled={busy} className={OUTLINE}>
            Update status
          </button>
        ))}

      {!received && referral.status === 'new' && (
        <button
          type="button"
          onClick={() => setPending('withdraw')}
          disabled={busy}
          className="self-end text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
        >
          Withdraw
        </button>
      )}

      {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}

      <ConfirmDialog
        open={pending !== null}
        title={
          pending === 'decline'
            ? `Decline the referral of ${referral.lead_name}?`
            : pending === 'withdraw'
              ? 'Withdraw this referral?'
              : 'Close this referral?'
        }
        description={
          pending === 'decline'
            ? `${referral.referrer_name} sees that you declined, and your reason if you give one. The lead’s number is removed.`
            : pending === 'withdraw'
              ? 'It’s removed before the business answers.'
              : pending
                ? `Mark it as “${REFERRAL_OUTCOME_LABELS[pending]}”. ${referral.referrer_name} sees the outcome, and the lead’s number is removed.`
                : undefined
        }
        prompt={
          pending === 'decline'
            ? {
                label: 'Reason (optional)',
                placeholder: 'e.g. We don’t cover that area',
                hint: `${referral.referrer_name} sees this.`,
              }
            : undefined
        }
        confirmLabel={
          pending === 'decline' ? 'Decline' : pending === 'withdraw' ? 'Withdraw' : 'Close referral'
        }
        busy={busy}
        onConfirm={(value) => handleConfirm(value)}
        onCancel={() => setPending(null)}
      />
    </article>
  )
}
