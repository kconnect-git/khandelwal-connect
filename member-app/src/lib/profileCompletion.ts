export type ProfileFieldKey =
  | 'full_name'
  | 'gender'
  | 'dob'
  | 'mobile_number'
  | 'home_address'
  | 'current_city'
  | 'current_district'
  | 'current_state'
  | 'native_place'
  | 'gotra'
  | 'marital_status'
  | 'education'
  | 'father_name'
  | 'mother_name'
  | 'spouse_name'
  | 'profile_photo_url'
  | 'occupation_type'

type FieldMeta = {
  key: ProfileFieldKey
  label: string
  requiredForWizard: boolean
  // Whether any screen shipped so far lets the user actually fill this in.
  // Fields that count toward completion but have no editable UI yet are
  // surfaced separately so the completion indicator doesn't read as "stuck"
  // or broken. (As of Phase 3a everything is editable; the mechanism stays
  // for future fields.)
  editableNow: boolean
}

export const PROFILE_FIELDS: FieldMeta[] = [
  { key: 'full_name', label: 'Full name', requiredForWizard: true, editableNow: true },
  { key: 'gender', label: 'Gender', requiredForWizard: true, editableNow: true },
  { key: 'dob', label: 'Date of birth', requiredForWizard: true, editableNow: true },
  { key: 'mobile_number', label: 'Mobile number', requiredForWizard: true, editableNow: true },
  { key: 'home_address', label: 'Home address', requiredForWizard: true, editableNow: true },
  { key: 'current_city', label: 'Current city', requiredForWizard: true, editableNow: true },
  { key: 'current_district', label: 'Current district', requiredForWizard: true, editableNow: true },
  { key: 'current_state', label: 'Current state', requiredForWizard: true, editableNow: true },
  { key: 'native_place', label: 'Native place', requiredForWizard: true, editableNow: true },
  { key: 'gotra', label: 'Gotra', requiredForWizard: true, editableNow: true },
  { key: 'marital_status', label: 'Marital status', requiredForWizard: true, editableNow: true },
  { key: 'education', label: 'Education', requiredForWizard: true, editableNow: true },
  { key: 'father_name', label: 'Father (family details)', requiredForWizard: false, editableNow: true },
  { key: 'mother_name', label: 'Mother (family details)', requiredForWizard: false, editableNow: true },
  { key: 'spouse_name', label: 'Spouse (family details)', requiredForWizard: false, editableNow: true },
  { key: 'profile_photo_url', label: 'Profile photo', requiredForWizard: false, editableNow: true },
  // Edit-profile only, by design: the wizard stays at its 3 steps.
  { key: 'occupation_type', label: 'Occupation', requiredForWizard: false, editableNow: true },
]

export type ProfileCompletion = {
  completed: number
  total: number
  percent: number
  missing: ProfileFieldKey[]
  missingNotYetEditable: FieldMeta[]
}

function isFilled(value: unknown): boolean {
  return value !== null && value !== undefined && value !== ''
}

export function getProfileCompletion(
  person: Partial<Record<ProfileFieldKey, unknown>>,
): ProfileCompletion {
  const missing: ProfileFieldKey[] = []
  const missingNotYetEditable: FieldMeta[] = []
  let completed = 0

  for (const field of PROFILE_FIELDS) {
    if (isFilled(person[field.key])) {
      completed += 1
    } else {
      missing.push(field.key)
      if (!field.editableNow) missingNotYetEditable.push(field)
    }
  }

  const total = PROFILE_FIELDS.length
  return {
    completed,
    total,
    percent: Math.round((completed / total) * 100),
    missing,
    missingNotYetEditable,
  }
}

export function isWizardComplete(person: Partial<Record<ProfileFieldKey, unknown>>): boolean {
  return PROFILE_FIELDS.filter((field) => field.requiredForWizard).every((field) =>
    isFilled(person[field.key]),
  )
}
