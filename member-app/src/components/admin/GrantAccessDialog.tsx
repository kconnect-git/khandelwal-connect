import { useEffect, useRef, useState } from 'react'
import { formatAdminDate } from '../../lib/admin'
import {
  ACCESS_MONTH_OPTIONS,
  ACCESS_NOTE_MAX,
  PAID_SERVICE_LABELS,
  accessMonthsLabel,
  previewAccessEnd,
} from '../../lib/serviceAccess'
import type { AccessMonths, PaidService } from '../../types/database'

// Phase 11.2: give or extend one member's access to one paid service. Same
// shell as ConfirmDialog, plus the 1 / 3 / 12 month choice and a preview of
// the end date (the server computes the real one the same way: an extension
// starts where current access ends).

type GrantAccessDialogProps = {
  open: boolean
  memberName: string
  service: PaidService
  /** The member's current access end for this service, if any. */
  currentEndsAt: string | null
  busy?: boolean
  onConfirm: (months: AccessMonths, note: string) => void
  onCancel: () => void
}

export function GrantAccessDialog({
  open,
  memberName,
  service,
  currentEndsAt,
  busy = false,
  onConfirm,
  onCancel,
}: GrantAccessDialogProps) {
  const [months, setMonths] = useState<AccessMonths>(1)
  const [note, setNote] = useState('')
  const firstRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (open) {
      setMonths(1)
      setNote('')
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKeyDown)
    firstRef.current?.focus()
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onCancel])

  if (!open) return null

  const label = PAID_SERVICE_LABELS[service]
  const extending = currentEndsAt !== null && new Date(currentEndsAt) > new Date()
  const until = formatAdminDate(previewAccessEnd(currentEndsAt, months).toISOString())

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="grant-access-title"
        className="w-full max-w-md rounded-t-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xl sm:rounded-2xl"
      >
        <h2 id="grant-access-title" className="text-base font-semibold">
          {extending ? `Extend ${label} for ${memberName}` : `Give ${memberName} ${label} access`}
        </h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          {extending
            ? `Their access runs until ${formatAdminDate(currentEndsAt)}. The extra time starts then.`
            : 'Access starts now. They’ll get an email saying so.'}
        </p>

        <fieldset className="mt-4">
          <legend className="text-xs font-medium tracking-wide text-[var(--color-text-muted)] uppercase">
            Length
          </legend>
          <div className="mt-1.5 flex gap-2">
            {ACCESS_MONTH_OPTIONS.map((option, index) => (
              <label
                key={option}
                className={`flex-1 cursor-pointer rounded-lg border px-3 py-2 text-center text-sm transition-colors ${
                  months === option
                    ? 'border-[var(--color-accent)] text-[var(--color-accent)] font-medium'
                    : 'border-[var(--color-border)] hover:bg-[var(--color-surface-hover)]'
                }`}
              >
                <input
                  ref={index === 0 ? firstRef : undefined}
                  type="radio"
                  name="grant-months"
                  value={option}
                  checked={months === option}
                  onChange={() => setMonths(option)}
                  className="sr-only"
                />
                {accessMonthsLabel(option)}
              </label>
            ))}
          </div>
          <p className="mt-2 text-sm">
            Access until <span className="font-medium">{until}</span>
          </p>
        </fieldset>

        <label className="mt-4 block">
          <span className="text-xs font-medium tracking-wide text-[var(--color-text-muted)] uppercase">
            Note (optional)
          </span>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="e.g. ₹500 paid by UPI on 17 Nov"
            maxLength={ACCESS_NOTE_MAX}
            rows={3}
            className="mt-1.5 w-full resize-y rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
          />
          <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
            Only admins see this. It goes in the audit log.
          </span>
        </label>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-medium hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(months, note.trim())}
            disabled={busy}
            className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
          >
            {busy ? 'Working…' : extending ? 'Extend access' : 'Give access'}
          </button>
        </div>
      </div>
    </div>
  )
}
