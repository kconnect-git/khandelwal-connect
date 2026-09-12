import { TextField } from '../../components/form/TextField'
import { SelectField } from '../../components/form/SelectField'
import { GENDER_OPTIONS } from '../../lib/formOptions'
import type { PersonFormValues } from '../../lib/people'

const today = new Date().toISOString().slice(0, 10)
const minDob = new Date(new Date().setFullYear(new Date().getFullYear() - 115))
  .toISOString()
  .slice(0, 10)

type StepPersonalProps = {
  value: PersonFormValues
  onChange: (patch: Partial<PersonFormValues>) => void
}

export function StepPersonal({ value, onChange }: StepPersonalProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <TextField
          label="First name"
          required
          value={value.first_name}
          onChange={(v) => onChange({ first_name: v })}
        />
        <TextField
          label="Last name"
          required
          value={value.last_name}
          onChange={(v) => onChange({ last_name: v })}
        />
      </div>
      <SelectField
        label="Gender"
        required
        value={value.gender}
        onChange={(v) => onChange({ gender: v })}
        options={GENDER_OPTIONS}
      />
      <TextField
        label="Date of birth"
        type="date"
        required
        min={minDob}
        max={today}
        value={value.dob}
        onChange={(v) => onChange({ dob: v })}
      />
      <TextField
        label="Mobile number"
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
    </div>
  )
}
