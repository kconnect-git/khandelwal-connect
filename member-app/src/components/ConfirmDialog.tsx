import { useEffect, useRef, useState } from 'react'

// Phase 5a. The admin screens need to ask for a rejection reason or an
// "what's missing" note, which Phase 4 did with window.prompt() -- fine to
// exercise a flow with, not fine to ship: no styling, no validation, and it
// is blocked outright in some browsers. This is the smallest real dialog that
// covers both that and a plain yes/no confirm.
//
// Deliberately not a portal: there is no stacking context in the app deep
// enough to need one, and a fixed overlay at z-50 already clears the bottom
// tab bar (z-10).

type ConfirmDialogProps = {
  open: boolean
  title: string
  description?: string
  /** Renders a textarea whose value is passed to onConfirm. */
  prompt?: {
    label: string
    placeholder?: string
    /** Block confirming until something is typed. */
    required?: boolean
  }
  confirmLabel: string
  /** Paint the confirm button in the accent colour (approve, publish...). */
  confirmAccent?: boolean
  busy?: boolean
  onConfirm: (value: string) => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  description,
  prompt,
  confirmLabel,
  confirmAccent = false,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [value, setValue] = useState('')
  const firstFieldRef = useRef<HTMLTextAreaElement | HTMLButtonElement | null>(null)

  // Reset between openings -- the same dialog instance is reused for every
  // row in a queue, so a stale reason must never carry over to the next member.
  useEffect(() => {
    if (open) setValue('')
  }, [open])

  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKeyDown)
    firstFieldRef.current?.focus()
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onCancel])

  if (!open) return null

  const missingRequired = Boolean(prompt?.required) && value.trim().length === 0
  const disabled = busy || missingRequired

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
        aria-labelledby="confirm-dialog-title"
        className="w-full max-w-md rounded-t-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xl sm:rounded-2xl"
      >
        <h2 id="confirm-dialog-title" className="text-base font-semibold">
          {title}
        </h2>
        {description && (
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">{description}</p>
        )}

        {prompt && (
          <label className="mt-4 block">
            <span className="text-xs font-medium tracking-wide text-[var(--color-text-muted)] uppercase">
              {prompt.label}
            </span>
            <textarea
              ref={firstFieldRef as React.RefObject<HTMLTextAreaElement>}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={prompt.placeholder}
              rows={4}
              className="mt-1.5 w-full resize-y rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
            />
            {prompt.required && (
              <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
                The member sees this, so say what they need to do.
              </span>
            )}
          </label>
        )}

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
            ref={!prompt ? (firstFieldRef as React.RefObject<HTMLButtonElement>) : undefined}
            onClick={() => onConfirm(value.trim())}
            disabled={disabled}
            className={
              confirmAccent
                ? 'rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50'
                : 'rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm font-medium hover:bg-[var(--color-surface-hover)] disabled:opacity-50'
            }
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
