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
      <TextField
        label="Full name"
        required
        value={value.full_name}
        onChange={(v) => onChange({ full_name: v })}
      />
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
        label="Mobile number (optional)"
        type="tel"
        value={value.mobile_number}
        onChange={(v) => onChange({ mobile_number: v })}
        placeholder="+91 98765 43210"
      />
    </div>
  )
}
