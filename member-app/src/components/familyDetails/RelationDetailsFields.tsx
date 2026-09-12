import { TextField } from '../form/TextField'
import { SelectField } from '../form/SelectField'
import { BLOOD_GROUP_OPTIONS, OCCUPATION_OPTIONS } from '../../lib/formOptions'
import type { RelationDetails } from '../../lib/familyDetails'

type RelationDetailsFieldsProps = {
  value: RelationDetails
  onChange: (value: RelationDetails) => void
}

const OPTIONAL = [{ value: '', label: 'Select…' }]

/** Profession / email / blood group for a relative -- only the spouse card
 * shows these (0017). Same fixed occupation list as the member's own
 * occupation, deliberately not free text. */
export function RelationDetailsFields({ value, onChange }: RelationDetailsFieldsProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <SelectField
        label="Profession (optional)"
        value={value.profession}
        onChange={(v) => onChange({ ...value, profession: v })}
        options={[...OPTIONAL, ...OCCUPATION_OPTIONS]}
      />
      <SelectField
        label="Blood group (optional)"
        value={value.bloodGroup}
        onChange={(v) => onChange({ ...value, bloodGroup: v })}
        options={[...OPTIONAL, ...BLOOD_GROUP_OPTIONS]}
      />
      <div className="sm:col-span-2">
        <TextField
          label="Email (optional)"
          type="email"
          value={value.email}
          onChange={(v) => onChange({ ...value, email: v })}
          placeholder="spouse@example.com"
        />
      </div>
    </div>
  )
}
