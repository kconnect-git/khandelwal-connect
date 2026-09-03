import { TextField } from '../form/TextField'
import type { RelativeContact } from '../../lib/familyDetails'

const today = new Date().toISOString().slice(0, 10)
const minDob = new Date(new Date().setFullYear(new Date().getFullYear() - 115))
  .toISOString()
  .slice(0, 10)

type RelativeContactFieldsProps = {
  value: RelativeContact
  onChange: (value: RelativeContact) => void
}

/** Optional mobile number + date of birth for a relative. Same input shape
 * as the wizard's own-number/dob fields (locked +91 prefix, 10 digits;
 * native date picker bounded to a plausible range) so the data lands in the
 * same format as the member's own row. */
export function RelativeContactFields({ value, onChange }: RelativeContactFieldsProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <TextField
        label="Mobile number (optional)"
        type="tel"
        prefix="+91"
        maxLength={10}
        value={value.mobileNumber.replace(/^\+91/, '')}
        onChange={(v) => {
          const digits = v.replace(/\D/g, '').slice(0, 10)
          onChange({ ...value, mobileNumber: digits ? `+91${digits}` : '' })
        }}
        placeholder="98765 43210"
      />
      <TextField
        label="Date of birth (optional)"
        type="date"
        min={minDob}
        max={today}
        value={value.dob}
        onChange={(v) => onChange({ ...value, dob: v })}
      />
    </div>
  )
}
