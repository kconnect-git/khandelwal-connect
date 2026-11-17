import { useState } from 'react'

// Phase 11.2: email + phone for the payment conversation, which happens by
// email outside the app. The email is a mailto link with a Copy button
// beside it (webmail users can't use mailto).

export function AccessContact({ email, mobile }: { email: string | null; mobile: string | null }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    if (!email) return
    try {
      await navigator.clipboard.writeText(email)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard blocked (insecure context, permissions): the link still works.
    }
  }

  if (!email && !mobile) return <span className="text-[var(--color-text-muted)]">—</span>

  return (
    <div className="flex flex-col items-end gap-0.5 md:items-start">
      {email && (
        <span className="flex items-center gap-2">
          <a href={`mailto:${email}`} className="break-all underline-offset-2 hover:underline">
            {email}
          </a>
          <button
            type="button"
            onClick={copy}
            className="shrink-0 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </span>
      )}
      {mobile && <span className="text-xs text-[var(--color-text-muted)]">{mobile}</span>}
    </div>
  )
}
