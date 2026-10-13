import { useEffect, useState } from 'react'
import { REPORT_DETAILS_MAX, REPORT_REASON_OPTIONS } from '../../lib/matrimony'

// Phase 6c: report a matrimony profile. ConfirmDialog only takes free text,
// and a report needs a reason and an "also block" choice, so this is its own
// small dialog in the same style.

type ReportDialogProps = {
  open: boolean
  name: string
  busy: boolean
  onSubmit: (report: { reason: string; details: string; alsoBlock: boolean }) => void
  onCancel: () => void
}

export function ReportDialog({ open, name, busy, onSubmit, onCancel }: ReportDialogProps) {
  const [reason, setReason] = useState('')
  const [details, setDetails] = useState('')
  const [alsoBlock, setAlsoBlock] = useState(true)

  useEffect(() => {
    if (!open) return
    setReason('')
    setDetails('')
    setAlsoBlock(true)
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onCancel])

  if (!open) return null

  const needsDetails = reason === 'Other' && details.trim().length === 0
  const disabled = busy || !reason || needsDetails

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
        aria-labelledby="report-dialog-title"
        className="w-full max-w-md rounded-t-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xl sm:rounded-2xl"
      >
        <h2 id="report-dialog-title" className="text-base font-semibold">
          Report {name}
        </h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Only the admins see reports. {name} won’t be told who reported them.
        </p>

        <label className="mt-4 block">
          <span className="text-xs font-medium tracking-wide text-[var(--color-text-muted)] uppercase">
            Reason
          </span>
          <select
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="mt-1.5 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
          >
            <option value="">Select…</option>
            {REPORT_REASON_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="mt-4 block">
          <span className="text-xs font-medium tracking-wide text-[var(--color-text-muted)] uppercase">
            Details {reason === 'Other' ? '' : '(optional)'}
          </span>
          <textarea
            value={details}
            onChange={(event) => setDetails(event.target.value)}
            maxLength={REPORT_DETAILS_MAX}
            rows={4}
            placeholder="What happened?"
            className="mt-1.5 w-full resize-y rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
          />
        </label>

        <label className="mt-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={alsoBlock}
            onChange={(event) => setAlsoBlock(event.target.checked)}
          />
          Also block {name}
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
            onClick={() => onSubmit({ reason, details: details.trim(), alsoBlock })}
            disabled={disabled}
            className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
          >
            {busy ? 'Working…' : 'Send report'}
          </button>
        </div>
      </div>
    </div>
  )
}
