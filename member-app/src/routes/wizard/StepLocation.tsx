import { TextField } from '../../components/form/TextField'
import { SelectField } from '../../components/form/SelectField'
import { INDIAN_STATE_OPTIONS } from '../../lib/formOptions'
import type { PersonFormValues } from '../../lib/people'

type StepLocationProps = {
  value: PersonFormValues
  onChange: (patch: Partial<PersonFormValues>) => void
}

export function StepLocation({ value, onChange }: StepLocationProps) {
  return (
    <div className="flex flex-col gap-4">
      <TextField
        label="Current city"
        required
        value={value.current_city}
        onChange={(v) => onChange({ current_city: v })}
      />
      <TextField
        label="Native place"
        required
        value={value.native_place}
        onChange={(v) => onChange({ native_place: v })}
      />
      <TextField
        label="District"
        required
        value={value.district}
        onChange={(v) => onChange({ district: v })}
      />
      <SelectField
        label="State"
        required
        value={value.state}
        onChange={(v) => onChange({ state: v })}
        options={INDIAN_STATE_OPTIONS}
      />
    </div>
  )
}
