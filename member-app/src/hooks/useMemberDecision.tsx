import { useState } from 'react'
import { ConfirmDialog } from '../components/ConfirmDialog'
import {
  adminSetMemberStatus,
  resendMemberStatusEmail,
  sendMemberStatusEmail,
  type AdminMemberDecision,
} from '../lib/admin'
import type { MemberStatus } from '../types/database'

// Phase 5b-1. The approve / request info / turn down flow, lifted out of
// MemberApprovals so the queue rows and the admin member detail screen run
// exactly the same dialog, RPC and email sequence.

export type DecisionTarget = { id: string; full_name: string; member_status: MemberStatus }

/** What each action does, and what the dialog asks for. Approving needs no
 *  message; the other two do, because the member reads it on /pending. */
type PendingAction = {
  member: DecisionTarget
  decision: AdminMemberDecision
  title: string
  description?: string
  prompt?: { label: string; placeholder: string; required: true }
  confirmLabel: string
  confirmAccent?: boolean
}

/** A decision that saved but whose email didn't go out -- kept so the admin
 *  can retry without re-running the decision (which the RPC would refuse as
 *  "already <status>"). */
export type EmailFailure = { member: DecisionTarget; status: AdminMemberDecision; message: string }

export function useMemberDecision({ onDecided }: { onDecided?: () => void | Promise<void> } = {}) {
  const [action, setAction] = useState<PendingAction | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [emailFailure, setEmailFailure] = useState<EmailFailure | null>(null)
  const [retrying, setRetrying] = useState(false)

  async function runAction(pending: PendingAction, message: string) {
    setBusyId(pending.member.id)
    setError(null)
    setEmailFailure(null)
    try {
      await adminSetMemberStatus(pending.member.id, pending.decision, message || undefined)
      // The review itself is committed at this point. A failed email must not
      // read as a failed decision, so it degrades to a retryable note.
      try {
        await sendMemberStatusEmail(pending.member.id, pending.decision)
      } catch (emailErr) {
        console.error('[useMemberDecision] status saved but email failed', emailErr)
        setEmailFailure({
          member: { ...pending.member, member_status: pending.decision },
          status: pending.decision,
          message: emailErr instanceof Error ? emailErr.message : 'unknown error',
        })
      }
      setAction(null)
      await onDecided?.()
    } catch (err) {
      console.error('[useMemberDecision] failed to set member status', err)
      setError(err instanceof Error ? err.message : 'Could not update this member.')
    } finally {
      setBusyId(null)
    }
  }

  async function retryEmail() {
    if (!emailFailure) return
    setRetrying(true)
    try {
      await resendMemberStatusEmail(emailFailure.member.id, emailFailure.status)
      setEmailFailure(null)
    } catch (err) {
      setEmailFailure({
        ...emailFailure,
        message: err instanceof Error ? err.message : 'unknown error',
      })
    } finally {
      setRetrying(false)
    }
  }

  function approve(member: DecisionTarget) {
    setAction({
      member,
      decision: 'approved',
      title: `Approve ${member.full_name}?`,
      description: 'They get full access to the directory, businesses and events, and an email saying so.',
      confirmLabel: 'Approve',
      confirmAccent: true,
    })
  }

  function requestInfo(member: DecisionTarget) {
    setAction({
      member,
      decision: 'info_requested',
      title: `Ask ${member.full_name} for more information`,
      prompt: {
        label: 'What do they need to add or fix?',
        placeholder: 'e.g. Please add your native place and a clearer photo.',
        required: true,
      },
      confirmLabel: 'Send request',
    })
  }

  function reject(member: DecisionTarget) {
    const revoking = member.member_status === 'approved'
    setAction({
      member,
      decision: 'rejected',
      title: revoking ? `Revoke ${member.full_name}'s membership?` : `Turn down ${member.full_name}?`,
      description: revoking
        ? 'They lose access to everything except their own profile immediately.'
        : undefined,
      prompt: {
        label: 'Reason',
        placeholder: 'The member sees this, so keep it factual.',
        required: true,
      },
      confirmLabel: revoking ? 'Revoke membership' : 'Turn down',
    })
  }

  const dialog = (
    <ConfirmDialog
      open={action !== null}
      title={action?.title ?? ''}
      description={action?.description}
      prompt={action?.prompt}
      confirmLabel={action?.confirmLabel ?? 'Confirm'}
      confirmAccent={action?.confirmAccent}
      busy={busyId !== null}
      onConfirm={(value) => {
        if (action) runAction(action, value)
      }}
      onCancel={() => setAction(null)}
    />
  )

  const emailNote = emailFailure && (
    <p className="text-sm text-[var(--color-text-muted)]">
      Saved, but the email to {emailFailure.member.full_name} could not be sent:{' '}
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
  )

  return { approve, requestInfo, reject, busyId, error, setError, dialog, emailNote }
}
