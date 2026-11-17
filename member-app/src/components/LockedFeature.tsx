import { useState } from 'react'
import { ConfirmDialog } from './ConfirmDialog'
import { useServiceAccess } from '../context/ServiceAccessContext'
import {
  ACCESS_REQUEST_MESSAGE_MAX,
  PAID_SERVICE_LABELS,
  PAID_SERVICE_UNLOCKS,
} from '../lib/serviceAccess'
import type { PaidService } from '../types/database'

// Phase 11.3: the card shown in place of a paid feature. Payment is offline,
// so the one action is Request access: the committee then emails the member
// to arrange payment and an admin turns the service on.
//
// Renders nothing when the member has access (or while that's unknown), so
// callers can drop it in unconditionally:
//   <LockedFeature service="directory" title="Upgrade to contact members" />
// and pass `compact` for an inline line instead of a card (e.g. in place of
// a Call button).
//
// UI only -- the RPCs behind each feature check access themselves.

const DATE_FORMAT = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

function formatDate(iso: string): string {
  return DATE_FORMAT.format(new Date(iso))
}

export function RequestAccessControl({
  service,
  compact = false,
}: {
  service: PaidService
  compact?: boolean
}) {
  const { row, request } = useServiceAccess()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const current = row(service)
  const label = PAID_SERVICE_LABELS[service]

  async function send(message: string) {
    setBusy(true)
    setError(null)
    try {
      await request(service, message)
      setOpen(false)
    } catch (err) {
      setOpen(false)
      setError(err instanceof Error ? err.message : 'Could not send your request.')
    } finally {
      setBusy(false)
    }
  }

  if (current?.open_request_at) {
    return (
      <p className="text-sm text-[var(--color-text-muted)]">
        Requested on {formatDate(current.open_request_at)}. The committee will email you.
      </p>
    )
  }

  return (
    <div className={`flex flex-col gap-1.5 ${compact ? '' : 'items-start'}`}>
      <button
        type="button"
        onClick={() => {
          setError(null)
          setOpen(true)
        }}
        className={
          compact
            ? 'self-start text-sm font-medium text-[var(--color-accent)] hover:underline'
            : 'rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-accent-hover)]'
        }
      >
        {current?.ends_at
          ? 'Request renewal'
          : current?.expired_at
            ? 'Request again'
            : 'Request access'}
      </button>
      {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}

      <ConfirmDialog
        open={open}
        title={current?.ends_at ? `Renew ${label} access` : `Request ${label} access`}
        description={`${PAID_SERVICE_UNLOCKS[service]} The committee will email you about payment. Access is monthly.`}
        prompt={{
          label: 'Message (optional)',
          placeholder: 'Anything the committee should know',
          hint: 'Only the committee sees this.',
          maxLength: ACCESS_REQUEST_MESSAGE_MAX,
        }}
        confirmLabel="Send request"
        confirmAccent
        busy={busy}
        onConfirm={send}
        onCancel={() => setOpen(false)}
      />
    </div>
  )
}

export function LockedFeature({
  service,
  title,
  description,
  compact = false,
}: {
  service: PaidService
  /** e.g. "Upgrade to contact members". Defaults to "{Service} is a paid service". */
  title?: string
  /** Defaults to what the service unlocks. */
  description?: string
  compact?: boolean
}) {
  const { hasAccess, row } = useServiceAccess()
  if (hasAccess(service)) return null

  const current = row(service)
  const label = PAID_SERVICE_LABELS[service]
  const expired = current?.expired_at ? `Your ${label} access ended on ${formatDate(current.expired_at)}.` : null

  if (compact) {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-sm text-[var(--color-text-muted)]">
          {title ?? `Part of ${label} access.`}
        </p>
        <RequestAccessControl service={service} compact />
      </div>
    )
  }

  return (
    <div className="w-full flex flex-col gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <div className="flex flex-col gap-1">
        <p className="font-medium">{title ?? `${label} is a paid service`}</p>
        <p className="text-sm text-[var(--color-text-muted)]">
          {description ?? PAID_SERVICE_UNLOCKS[service]}
        </p>
        {expired && <p className="text-sm text-[var(--color-text-muted)]">{expired}</p>}
      </div>
      <RequestAccessControl service={service} />
    </div>
  )
}
