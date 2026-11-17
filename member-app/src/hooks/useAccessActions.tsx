import { useState } from 'react'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { GrantAccessDialog } from '../components/admin/GrantAccessDialog'
import {
  ACCESS_NOTE_MAX,
  PAID_SERVICE_LABELS,
  adminDismissAccessRequest,
  adminGrantServiceAccess,
  adminRevokeServiceAccess,
  sendAccessGrantedEmail,
} from '../lib/serviceAccess'
import type { AccessMonths, PaidService } from '../types/database'

// Phase 11.2: grant / extend, revoke and dismiss, shared by /admin/access and
// the Access panel on member detail -- same shape as useMemberDecision. The
// "access granted" email is sent after the grant commits; if it fails the
// grant stands and the admin gets a Retry.

export type AccessTarget = {
  personId: string
  fullName: string
  service: PaidService
  /** Current access end for this service, if any (drives "Extend"). */
  currentEndsAt: string | null
}

type Pending =
  | { kind: 'grant'; target: AccessTarget }
  | { kind: 'revoke'; target: AccessTarget }
  | { kind: 'dismiss'; requestId: string; target: AccessTarget }

export function useAccessActions({ onChanged }: { onChanged: () => Promise<void> | void }) {
  const [pending, setPending] = useState<Pending | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [emailFailure, setEmailFailure] = useState<{
    grantId: string
    fullName: string
    message: string
  } | null>(null)
  const [retrying, setRetrying] = useState(false)

  function start(next: Pending) {
    setError(null)
    setNotice(null)
    setEmailFailure(null)
    setPending(next)
  }

  async function sendEmail(grantId: string, fullName: string) {
    try {
      await sendAccessGrantedEmail(grantId)
      setEmailFailure(null)
      setNotice(`${fullName} has been emailed.`)
    } catch (err) {
      setEmailFailure({
        grantId,
        fullName,
        message: err instanceof Error ? err.message : 'unknown error',
      })
    }
  }

  async function grant(target: AccessTarget, months: AccessMonths, note: string) {
    setBusy(true)
    setError(null)
    try {
      const grantId = await adminGrantServiceAccess({
        personId: target.personId,
        service: target.service,
        months,
        note,
      })
      setPending(null)
      await onChanged()
      await sendEmail(grantId, target.fullName)
    } catch (err) {
      setPending(null)
      setError(err instanceof Error ? err.message : 'Could not give access.')
    } finally {
      setBusy(false)
    }
  }

  async function confirm(value: string) {
    if (!pending || pending.kind === 'grant') return
    setBusy(true)
    setError(null)
    try {
      if (pending.kind === 'revoke') {
        await adminRevokeServiceAccess({
          personId: pending.target.personId,
          service: pending.target.service,
          note: value,
        })
        setNotice(
          `Removed ${PAID_SERVICE_LABELS[pending.target.service]} access for ${pending.target.fullName}.`,
        )
      } else {
        await adminDismissAccessRequest(pending.requestId, value)
      }
      setPending(null)
      await onChanged()
    } catch (err) {
      setPending(null)
      setError(err instanceof Error ? err.message : 'Could not update access.')
    } finally {
      setBusy(false)
    }
  }

  async function retryEmail() {
    if (!emailFailure) return
    setRetrying(true)
    await sendEmail(emailFailure.grantId, emailFailure.fullName)
    setRetrying(false)
  }

  const cancel = () => setPending(null)

  const dialog = (
    <>
      <GrantAccessDialog
        open={pending?.kind === 'grant'}
        memberName={pending?.target.fullName ?? ''}
        service={pending?.target.service ?? 'directory'}
        currentEndsAt={pending?.target.currentEndsAt ?? null}
        busy={busy}
        onConfirm={(months, note) => {
          if (pending?.kind === 'grant') grant(pending.target, months, note)
        }}
        onCancel={cancel}
      />
      <ConfirmDialog
        open={pending?.kind === 'revoke' || pending?.kind === 'dismiss'}
        title={
          pending?.kind === 'revoke'
            ? `Remove ${PAID_SERVICE_LABELS[pending.target.service]} access for ${pending.target.fullName}?`
            : `Dismiss ${pending?.target.fullName ?? ''}’s request?`
        }
        description={
          pending?.kind === 'revoke'
            ? 'It ends now, including any time added by an extension. They aren’t emailed. Things they already have (matches, events they created) keep working.'
            : 'The request closes without access. They aren’t emailed and can ask again.'
        }
        prompt={{
          label: 'Note (optional)',
          placeholder: pending?.kind === 'revoke' ? 'e.g. refunded' : 'e.g. no payment received',
          hint: 'Only admins see this. It goes in the audit log.',
          maxLength: ACCESS_NOTE_MAX,
        }}
        confirmLabel={pending?.kind === 'revoke' ? 'Remove access' : 'Dismiss'}
        busy={busy}
        onConfirm={confirm}
        onCancel={cancel}
      />
    </>
  )

  const feedback = (
    <>
      {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}
      {notice && <p className="text-sm text-[var(--color-text-muted)]">{notice}</p>}
      {emailFailure && (
        <p className="text-sm text-[var(--color-text-muted)]">
          Access given, but the email to {emailFailure.fullName} could not be sent:{' '}
          {emailFailure.message}.{' '}
          <button
            type="button"
            onClick={retryEmail}
            disabled={retrying}
            className="underline hover:text-[var(--color-text)] disabled:opacity-50"
          >
            {retrying ? 'Retrying…' : 'Retry'}
          </button>
        </p>
      )}
    </>
  )

  return {
    grant: (target: AccessTarget) => start({ kind: 'grant', target }),
    revoke: (target: AccessTarget) => start({ kind: 'revoke', target }),
    dismiss: (requestId: string, target: AccessTarget) =>
      start({ kind: 'dismiss', requestId, target }),
    busy,
    dialog,
    feedback,
  }
}
