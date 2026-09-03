export type Option = { value: string; label: string }

export const GENDER_OPTIONS: Option[] = [
  { value: 'Male', label: 'Male' },
  { value: 'Female', label: 'Female' },
  { value: 'Other', label: 'Other' },
  { value: 'Prefer not to say', label: 'Prefer not to say' },
]

export const MARITAL_STATUS_OPTIONS: Option[] = [
  { value: 'Single', label: 'Single' },
  { value: 'Married', label: 'Married' },
  { value: 'Widowed', label: 'Widowed' },
  { value: 'Divorced', label: 'Divorced' },
  { value: 'Separated', label: 'Separated' },
  { value: 'Prefer not to say', label: 'Prefer not to say' },
]

// Fixed list, mirrored by the check constraint on people.occupation_type
// (migration 0013). 'Job' unlocks title/company/location sub-fields;
// 'Business' points the member at the Businesses pages instead.
export const OCCUPATION_OPTIONS: Option[] = [
  { value: 'Business', label: 'Business' },
  { value: 'Job', label: 'Job' },
  { value: 'Student', label: 'Student' },
  { value: 'Homemaker', label: 'Homemaker' },
  { value: 'Retired', label: 'Retired' },
  { value: 'Other', label: 'Other' },
]

// Fixed list, mirrored by businesses_category_check (migration 0014).
export const BUSINESS_CATEGORY_OPTIONS: Option[] = [
  'Retail',
  'Wholesale & Distribution',
  'Manufacturing',
  'Jewellery',
  'Textiles & Garments',
  'Real Estate & Construction',
  'Finance & Accounting',
  'Legal',
  'Healthcare',
  'Education',
  'IT & Software',
  'Hospitality & Food',
  'Transport & Logistics',
  'Agriculture',
  'Other',
].map((value) => ({ value, label: value }))

type StateEntry = { name: string; code: string }

// 2-letter codes follow the same convention as Indian vehicle registration
// plates (RJ, KA, MH, DL, ...) -- used to build member codes (see
// STATE_CODE_BY_NAME below), not just for display.
const INDIAN_STATE_ENTRIES: StateEntry[] = [
  { name: 'Andhra Pradesh', code: 'AP' },
  { name: 'Arunachal Pradesh', code: 'AR' },
  { name: 'Assam', code: 'AS' },
  { name: 'Bihar', code: 'BR' },
  { name: 'Chhattisgarh', code: 'CG' },
  { name: 'Goa', code: 'GA' },
  { name: 'Gujarat', code: 'GJ' },
  { name: 'Haryana', code: 'HR' },
  { name: 'Himachal Pradesh', code: 'HP' },
  { name: 'Jharkhand', code: 'JH' },
  { name: 'Karnataka', code: 'KA' },
  { name: 'Kerala', code: 'KL' },
  { name: 'Madhya Pradesh', code: 'MP' },
  { name: 'Maharashtra', code: 'MH' },
  { name: 'Manipur', code: 'MN' },
  { name: 'Meghalaya', code: 'ML' },
  { name: 'Mizoram', code: 'MZ' },
  { name: 'Nagaland', code: 'NL' },
  { name: 'Odisha', code: 'OD' },
  { name: 'Punjab', code: 'PB' },
  { name: 'Rajasthan', code: 'RJ' },
  { name: 'Sikkim', code: 'SK' },
  { name: 'Tamil Nadu', code: 'TN' },
  { name: 'Telangana', code: 'TS' },
  { name: 'Tripura', code: 'TR' },
  { name: 'Uttar Pradesh', code: 'UP' },
  { name: 'Uttarakhand', code: 'UK' },
  { name: 'West Bengal', code: 'WB' },
]

const INDIAN_UNION_TERRITORY_ENTRIES: StateEntry[] = [
  { name: 'Andaman and Nicobar Islands', code: 'AN' },
  { name: 'Chandigarh', code: 'CH' },
  { name: 'Dadra and Nagar Haveli and Daman and Diu', code: 'DD' },
  { name: 'Delhi', code: 'DL' },
  { name: 'Jammu and Kashmir', code: 'JK' },
  { name: 'Ladakh', code: 'LA' },
  { name: 'Lakshadweep', code: 'LD' },
  { name: 'Puducherry', code: 'PY' },
]

const OTHER_STATE_ENTRY: StateEntry = { name: 'Outside India / Other', code: 'XX' }

const ALL_STATE_ENTRIES: StateEntry[] = [
  ...INDIAN_STATE_ENTRIES,
  ...INDIAN_UNION_TERRITORY_ENTRIES,
  OTHER_STATE_ENTRY,
]

export const INDIAN_STATE_OPTIONS: Option[] = ALL_STATE_ENTRIES.map((s) => ({
  value: s.name,
  label: s.name,
}))

// Looked up client-side, at the moment the user picks a state, so that
// state_code is populated straight from the dropdown -- member-code
// generation never has to derive it later.
export const STATE_CODE_BY_NAME: Record<string, string> = Object.fromEntries(
  ALL_STATE_ENTRIES.map((s) => [s.name, s.code]),
)
