import { TextField } from '../../components/form/TextField'
import { SelectField } from '../../components/form/SelectField'
import { MARITAL_STATUS_OPTIONS } from '../../lib/formOptions'
import type { PersonFormValues } from '../../lib/people'

type StepGotraBackgroundProps = {
  value: PersonFormValues
  onChange: (patch: Partial<PersonFormValues>) => void
}

export function StepGotraBackground({ value, onChange }: StepGotraBackgroundProps) {
  return (
    <div className="flex flex-col gap-4">
      <TextField
        label="Gotra"
        required
        value={value.gotra}
        onChange={(v) => onChange({ gotra: v })}
      />
      <SelectField
        label="Marital status"
        required
        value={value.marital_status}
        onChange={(v) => onChange({ marital_status: v })}
        options={MARITAL_STATUS_OPTIONS}
      />
      <TextField
        label="Education"
        required
        value={value.education}
        onChange={(v) => onChange({ education: v })}
        placeholder="e.g. B.Tech Computer Science, IIT Delhi"
      />
    </div>
  )
}
