import { useState } from 'react'
import { TextField } from '../form/TextField'
import { sendFamilyInvite, type InviteSlot } from '../../lib/familyDetails'

type InviteControlProps = {
  slot: InviteSlot
}

/** "Invite" button that turns into an email field + "Send invite" button
 * once clicked -- for a relation that couldn't be matched to a registered
 * member. Sends an email (via the send-family-invite Edge Function)
 * pointing them at the site, worded from their side of the relationship. */
export function InviteControl({ slot }: InviteControlProps) {
  const [inviting, setInviting] = useState(false)
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  if (sent) {
    return <p className="text-sm text-[var(--color-text-muted)]">Invite sent to {email}.</p>
  }

  if (!inviting) {
    return (
      <button
        type="button"
        onClick={() => setInviting(true)}
        className="rounded-lg border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-text-muted)] transition-colors"
      >
        Invite
      </button>
    )
  }

  async function handleSendInvite() {
    setError(null)
    setSending(true)
    try {
      await sendFamilyInvite({ slot, email: email.trim() })
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong sending the invite.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <TextField
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="relative@example.com"
          />
        </div>
        <button
          type="button"
          onClick={handleSendInvite}
          disabled={sending || email.trim().length === 0}
          className="rounded-lg bg-[var(--color-accent)] text-white font-medium px-4 py-2.5 text-sm hover:bg-[var(--color-accent-hover)] disabled:opacity-60 transition-colors"
        >
          {sending ? 'Sending…' : 'Send invite'}
        </button>
      </div>
      {error && <p className="text-sm text-[var(--color-accent)]">{error}</p>}
    </div>
  )
}
