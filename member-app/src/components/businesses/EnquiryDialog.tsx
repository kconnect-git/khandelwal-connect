import { useEffect, useState } from 'react'
import { ENQUIRY_MESSAGE_MAX } from '../../lib/businessDashboard'

// Phase 10.8: ask a business about one of its products, or in general. Same
// modal style as ReportDialog.

const GENERAL = ''

type EnquiryDialogProps = {
  open: boolean
  businessName: string
  products: string[]
  /** Pre-picked when opened from a product chip; null = General. */
  initialAbout: string | null
  busy: boolean
  onSubmit: (enquiry: { about: string | null; message: string }) => void
  onCancel: () => void
}

export function EnquiryDialog({
  open,
  businessName,
  products,
  initialAbout,
  busy,
  onSubmit,
  onCancel,
}: EnquiryDialogProps) {
  const [about, setAbout] = useState(GENERAL)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!open) return
    setAbout(initialAbout ?? GENERAL)
    setMessage('')
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, initialAbout, onCancel])

  if (!open) return null

  const disabled = busy || message.trim().length === 0

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
        aria-labelledby="enquiry-dialog-title"
        className="w-full max-w-md rounded-t-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-xl sm:rounded-2xl"
      >
        <h2 id="enquiry-dialog-title" className="text-base font-semibold">
          Enquire with {businessName}
        </h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          The owner sees your name and message, and can reply on WhatsApp.
        </p>

        <label className="mt-4 block">
          <span className="text-xs font-medium tracking-wide text-[var(--color-text-muted)] uppercase">
            About
          </span>
          <select
            value={about}
            onChange={(event) => setAbout(event.target.value)}
            className="mt-1.5 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
          >
            <option value={GENERAL}>General enquiry</option>
            {products.map((product) => (
              <option key={product} value={product}>
                {product}
              </option>
            ))}
          </select>
        </label>

        <label className="mt-4 block">
          <span className="text-xs font-medium tracking-wide text-[var(--color-text-muted)] uppercase">
            Message
          </span>
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            maxLength={ENQUIRY_MESSAGE_MAX}
            rows={4}
            placeholder="What would you like to know?"
            className="mt-1.5 w-full resize-y rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
          />
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
            onClick={() => onSubmit({ about: about || null, message: message.trim() })}
            disabled={disabled}
            className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
          >
            {busy ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}
