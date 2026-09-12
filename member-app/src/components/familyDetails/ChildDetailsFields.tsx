import { TextField } from '../form/TextField'
import { SelectField } from '../form/SelectField'
import {
  BLOOD_GROUP_OPTIONS,
  CHILD_RELATION_OPTIONS,
  MARITAL_STATUS_OPTIONS,
  OCCUPATION_OPTIONS,
} from '../../lib/formOptions'
import type { ChildDetails } from '../../lib/familyDetails'

type ChildDetailsFieldsProps = {
  value: ChildDetails
  onChange: (value: ChildDetails) => void
}

const OPTIONAL = [{ value: '', label: 'Select…' }]

/** Relation / education / profession / marital status / spouse name /
 * blood group for one child (0017). Spouse name only appears once the
 * child's marital status is Married. */
export function ChildDetailsFields({ value, onChange }: ChildDetailsFieldsProps) {
  function patch(p: Partial<ChildDetails>) {
    onChange({ ...value, ...p })
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <SelectField
        label="Relation (optional)"
        value={value.relation}
        onChange={(v) => patch({ relation: v })}
        options={[...OPTIONAL, ...CHILD_RELATION_OPTIONS]}
      />
      <SelectField
        label="Blood group (optional)"
        value={value.bloodGroup}
        onChange={(v) => patch({ bloodGroup: v })}
        options={[...OPTIONAL, ...BLOOD_GROUP_OPTIONS]}
      />
      <TextField
        label="Education (optional)"
        value={value.education}
        onChange={(v) => patch({ education: v })}
        placeholder="e.g. B.Com"
      />
      <SelectField
        label="Profession (optional)"
        value={value.profession}
        onChange={(v) => patch({ profession: v })}
        options={[...OPTIONAL, ...OCCUPATION_OPTIONS]}
      />
      <SelectField
        label="Marital status (optional)"
        value={value.maritalStatus}
        onChange={(v) => patch({ maritalStatus: v })}
        options={[...OPTIONAL, ...MARITAL_STATUS_OPTIONS]}
      />
      {value.maritalStatus === 'Married' && (
        <TextField
          label="Spouse name (optional)"
          value={value.spouseName}
          onChange={(v) => patch({ spouseName: v })}
        />
      )}
    </div>
  )
}
