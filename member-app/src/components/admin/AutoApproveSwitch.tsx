import { useCallback, useEffect, useState } from 'react'
import { ConfirmDialog } from '../ConfirmDialog'
import { adminMemberApprovalSettings, adminSetMemberAutoApprove, formatAdminDate } from '../../lib/admin'
import type { MemberApprovalSettings } from '../../types/database'

// (0041) The member auto-approve switch above the review queue. Any admin
// sees the state; only a super admin can flip it (the RPC checks too). Same
// shape as PaywallSwitches.

export function AutoApproveSwitch({ canEdit }: { canEdit: boolean }) {
  const [settings, setSettings] = useState<MemberApprovalSettings | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setSettings(await adminMemberApprovalSettings())
  }, [])

  useEffect(() => {
    load().catch((err) => {
      console.error('[AutoApproveSwitch] failed to load settings', err)
      setError(err instanceof Error ? err.message : 'Could not load the auto-approve setting.')
    })
  }, [load])

  async function flip() {
    if (!settings) return
    setBusy(true)
    setError(null)
    try {
      await adminSetMemberAutoApprove(!settings.auto_approve)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not change auto-approval.')
    } finally {
      setConfirming(false)
      setBusy(false)
    }
  }

  if (!settings) {
    return error ? <p className="text-sm text-[var(--color-accent)]">{error}</p> : null
  }

  const on = settings.auto_approve

  return (
    <section className="flex flex-col gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span className="font-medium">Auto-approve new members</span>
            <span
              className={`rounded-full border px-2 py-0.5 text-xs whitespace-nowrap ${
                on
                  ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
                  : 'border-[var(--color-border)] text-[var(--color-text-muted)]'
              }`}
            >
              {on ? 'On' : 'Off'}
            </span>
          </div>
          <p className="text-sm text-[var(--color-text-muted)]">
            {on
              ? 'Completed profiles are approved straight away, without review.'
              : 'Every completed profile waits here for an admin to review it.'}
          </p>
          {settings.updated_by_name && (
            <p className="text-xs text-[var(--color-text-muted)]">
              Changed {formatAdminDate(settings.updated_at)} by {settings.updated_by_name}
            </p>
          )}
        </div>
        {canEdit ? (
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label="Auto-approve new members"
            disabled={busy}
            onClick={() => setConfirming(true)}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
              on ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-border)]'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                on ? 'translate-x-5' : ''
              }`}
            />
          </button>
        ) : (
          <p className="text-xs text-[var(--color-text-muted)]">Only a super admin can change this.</p>
        )}
      </div>
      {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}

      <ConfirmDialog
        open={confirming}
        title={on ? 'Turn off auto-approval?' : 'Turn on auto-approval?'}
        description={
          on
            ? 'New and resubmitted profiles will wait in Pending for review again.'
            : 'Anyone who finishes the sign-up form gets full access straight away, with no admin review and no approval email. People already waiting in Pending are not affected — review them as usual.'
        }
        confirmLabel={on ? 'Turn off' : 'Turn on'}
        confirmAccent={!on}
        busy={busy}
        onConfirm={() => flip()}
        onCancel={() => setConfirming(false)}
      />
    </section>
  )
}
