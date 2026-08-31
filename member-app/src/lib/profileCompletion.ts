export type ProfileFieldKey =
  | 'full_name'
  | 'gender'
  | 'dob'
  | 'mobile_number'
  | 'current_city'
  | 'native_place'
  | 'district'
  | 'state'
  | 'gotra'
  | 'marital_status'
  | 'education'
  | 'father_id'
  | 'mother_id'
  | 'spouse_id'
  | 'profile_photo_url'

type FieldMeta = {
  key: ProfileFieldKey
  label: string
  requiredForWizard: boolean
  // Whether any screen shipped so far lets the user actually fill this in.
  // Family tree (Phase 2) and photo upload (later) fields count toward
  // completion but have no editable UI yet -- surfaced separately so the
  // completion indicator doesn't read as "stuck" or broken.
  editableNow: boolean
}

export const PROFILE_FIELDS: FieldMeta[] = [
  { key: 'full_name', label: 'Full name', requiredForWizard: true, editableNow: true },
  { key: 'gender', label: 'Gender', requiredForWizard: true, editableNow: true },
  { key: 'dob', label: 'Date of birth', requiredForWizard: true, editableNow: true },
  { key: 'mobile_number', label: 'Mobile number', requiredForWizard: false, editableNow: true },
  { key: 'current_city', label: 'Current city', requiredForWizard: true, editableNow: true },
  { key: 'native_place', label: 'Native place', requiredForWizard: true, editableNow: true },
  { key: 'district', label: 'District', requiredForWizard: true, editableNow: true },
  { key: 'state', label: 'State', requiredForWizard: true, editableNow: true },
  { key: 'gotra', label: 'Gotra', requiredForWizard: true, editableNow: true },
  { key: 'marital_status', label: 'Marital status', requiredForWizard: true, editableNow: true },
  { key: 'education', label: 'Education', requiredForWizard: true, editableNow: true },
  { key: 'father_id', label: "Father (family tree)", requiredForWizard: false, editableNow: false },
  { key: 'mother_id', label: "Mother (family tree)", requiredForWizard: false, editableNow: false },
  { key: 'spouse_id', label: 'Spouse (family tree)', requiredForWizard: false, editableNow: false },
  {
    key: 'profile_photo_url',
    label: 'Profile photo',
    requiredForWizard: false,
    editableNow: false,
  },
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
