import { useState } from 'react'
import { ConfirmDialog } from '../ConfirmDialog'
import { formatAdminDate } from '../../lib/admin'
import {
  PAID_SERVICE_LABELS,
  PAYWALL_READY,
  adminSetServiceEnforced,
} from '../../lib/serviceAccess'
import type { AdminServiceSettingRow } from '../../types/database'

// Phase 11.2: one card per paid service with its paywall switch. Any admin
// sees the state and counts; only a super admin can flip it (the RPC checks
// too). No free period: turning one on locks every member without a grant,
// so the confirm says how many currently have access.

export function PaywallSwitches({
  settings,
  canEdit,
  onChanged,
}: {
  settings: AdminServiceSettingRow[]
  canEdit: boolean
  onChanged: () => Promise<void> | void
}) {
  const [pending, setPending] = useState<AdminServiceSettingRow | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function flip(row: AdminServiceSettingRow) {
    setBusy(true)
    setError(null)
    try {
      await adminSetServiceEnforced(row.service, !row.enforced)
      setPending(null)
      await onChanged()
    } catch (err) {
      setPending(null)
      setError(err instanceof Error ? err.message : 'Could not change the paywall.')
    } finally {
      setBusy(false)
    }
  }

  const label = pending ? PAID_SERVICE_LABELS[pending.service] : ''
  const active = pending ? Number(pending.active_members) : 0

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs font-medium tracking-wide text-[var(--color-text-muted)] uppercase">
        Paywalls
      </h2>
      {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {settings.map((row) => {
          const ready = PAYWALL_READY[row.service]
          return (
            <li
              key={row.service}
              className="flex flex-col gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{PAID_SERVICE_LABELS[row.service]}</span>
                <span
                  className={`rounded-full border px-2 py-0.5 text-xs whitespace-nowrap ${
                    row.enforced
                      ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
                      : 'border-[var(--color-border)] text-[var(--color-text-muted)]'
                  }`}
                >
                  {row.enforced ? 'Paywall on' : 'Free for all'}
                </span>
              </div>
              <p className="text-sm text-[var(--color-text-muted)]">
                {Number(row.active_members)} with access · {Number(row.open_requests)}{' '}
                {Number(row.open_requests) === 1 ? 'request' : 'requests'}
              </p>
              {row.updated_by_name && (
                <p className="text-xs text-[var(--color-text-muted)]">
                  Changed {formatAdminDate(row.updated_at)} by {row.updated_by_name}
                </p>
              )}
              {canEdit &&
                (row.enforced || ready ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setPending(row)}
                    className="mt-auto self-start rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-sm whitespace-nowrap hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
                  >
                    {row.enforced ? 'Turn off' : 'Turn on'}
                  </button>
                ) : (
                  <p className="mt-auto text-xs text-[var(--color-text-muted)]">
                    Can be turned on once this service’s locks are built.
                  </p>
                ))}
            </li>
          )
        })}
      </ul>
      {!canEdit && (
        <p className="text-xs text-[var(--color-text-muted)]">
          Only a super admin can turn a paywall on or off.
        </p>
      )}

      <ConfirmDialog
        open={pending !== null}
        title={pending?.enforced ? `Turn off the ${label} paywall?` : `Turn on the ${label} paywall?`}
        description={
          pending?.enforced
            ? `${label} becomes free for every member again. Existing access isn’t touched and keeps counting down.`
            : `Members without ${label} access lose the paid features straight away — there is no free period. ${active} ${
                active === 1 ? 'member has' : 'members have'
              } access now. Admins and moderators always keep access.`
        }
        confirmLabel={pending?.enforced ? 'Turn off' : 'Turn on'}
        confirmAccent={!pending?.enforced}
        busy={busy}
        onConfirm={() => {
          if (pending) flip(pending)
        }}
        onCancel={() => setPending(null)}
      />
    </section>
  )
}
