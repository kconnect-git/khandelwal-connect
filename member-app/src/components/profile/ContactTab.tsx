import { TextField } from '../form/TextField'
import { TabSaveBar } from './TabSaveBar'
import type { PersonTabProps } from './tabTypes'

type ContactTabProps = PersonTabProps & {
  /** The sign-in email from the auth session. Read-only here. */
  primaryEmail: string | null
}

export function ContactTab({ value, onChange, saveState, onSave, primaryEmail }: ContactTabProps) {
  return (
    <div className="w-full flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <span className="text-sm text-[var(--color-text-muted)]">Primary email</span>
        <p className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2.5 text-[var(--color-text-muted)] break-all">
          {primaryEmail ?? '—'}
        </p>
        <span className="text-xs text-[var(--color-text-muted)]">
          This is the email you sign in with. It can't be changed here.
        </span>
      </div>
      <TextField
        label="Primary mobile"
        type="tel"
        required
        prefix="+91"
        maxLength={10}
        value={value.mobile_number.replace(/^\+91/, '')}
        onChange={(v) => {
          const digits = v.replace(/\D/g, '').slice(0, 10)
          onChange({ mobile_number: digits ? `+91${digits}` : '' })
        }}
        placeholder="98765 43210"
      />
      <TextField
        label="Secondary email"
        type="email"
        value={value.secondary_email}
        onChange={(v) => onChange({ secondary_email: v })}
        placeholder="you@example.com"
      />
      <TextField
        label="Secondary mobile"
        type="tel"
        prefix="+91"
        maxLength={10}
        value={value.secondary_mobile.replace(/^\+91/, '')}
        onChange={(v) => {
          const digits = v.replace(/\D/g, '').slice(0, 10)
          onChange({ secondary_mobile: digits ? `+91${digits}` : '' })
        }}
        placeholder="98765 43210"
      />
      <TabSaveBar state={saveState} onSave={onSave} />
    </div>
  )
}
