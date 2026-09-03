import { TextField } from '../../components/form/TextField'
import { SelectField } from '../../components/form/SelectField'
import { INDIAN_STATE_OPTIONS, STATE_CODE_BY_NAME } from '../../lib/formOptions'
import type { PersonFormValues } from '../../lib/people'

type StepLocationProps = {
  value: PersonFormValues
  onChange: (patch: Partial<PersonFormValues>) => void
}

export function StepLocation({ value, onChange }: StepLocationProps) {
  return (
    <div className="flex flex-col gap-4">
      <TextField
        label="Home address"
        required
        value={value.home_address}
        onChange={(v) => onChange({ home_address: v })}
      />
      <TextField
        label="Current city"
        required
        value={value.current_city}
        onChange={(v) => onChange({ current_city: v })}
      />
      <TextField
        label="Current district"
        required
        value={value.current_district}
        onChange={(v) => onChange({ current_district: v })}
      />
      <SelectField
        label="Current state"
        required
        value={value.current_state}
        onChange={(v) => onChange({ current_state: v, state_code: STATE_CODE_BY_NAME[v] ?? '' })}
        options={INDIAN_STATE_OPTIONS}
      />
      <TextField
        label="Native place (Rajasthan)"
        required
        value={value.native_place}
        onChange={(v) => onChange({ native_place: v })}
      />
    </div>
  )
}
