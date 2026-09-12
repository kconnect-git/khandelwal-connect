import type { PersonFormValues } from './people'

export type ProfileTabKey =
  | 'personal'
  | 'contact'
  | 'cultural'
  | 'residence'
  | 'business'
  | 'spouse'
  | 'children'

export const PROFILE_TABS: { key: ProfileTabKey; label: string }[] = [
  { key: 'personal', label: 'Personal' },
  { key: 'contact', label: 'Contact' },
  { key: 'cultural', label: 'Cultural' },
  { key: 'residence', label: 'Residence' },
  { key: 'business', label: 'Business' },
  { key: 'spouse', label: 'Spouse' },
  { key: 'children', label: 'Children' },
]

export const DEFAULT_PROFILE_TAB: ProfileTabKey = 'personal'

export function isProfileTabKey(value: string | null): value is ProfileTabKey {
  return PROFILE_TABS.some((tab) => tab.key === value)
}

/** Which `people` columns each tab owns. A tab's Save validates and writes
 * only these, so an error on one tab never blocks another. Tabs missing
 * here (children) have no person-level fields -- they save per card. */
export const PERSON_TAB_FIELDS: Partial<Record<ProfileTabKey, (keyof PersonFormValues)[]>> = {
  personal: ['first_name', 'middle_name', 'last_name', 'gender', 'dob', 'blood_group', 'education'],
  contact: ['mobile_number', 'secondary_email', 'secondary_mobile'],
  cultural: ['gotra', 'native_place', 'birth_place'],
  residence: [
    'home_address',
    'address_line2',
    'address_line3',
    'current_city',
    'current_district',
    'current_state',
    'state_code',
    'pincode',
    'residence_phone',
  ],
  business: ['occupation_type', 'job_title', 'company_name', 'job_location'],
  spouse: ['marital_status', 'date_of_marriage'],
}
