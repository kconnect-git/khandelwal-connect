import { supabase } from '../utils/supabase'
import { STATE_CODE_BY_NAME } from './formOptions'
import type { Person } from '../types/database'

export type PersonFormValues = {
  // Name parts (0017). full_name is derived from these -- see
  // composeFullName / the people_sync_full_name trigger.
  first_name: string
  middle_name: string
  last_name: string
  gender: string
  dob: string
  mobile_number: string
  home_address: string
  current_city: string
  current_district: string
  current_state: string
  state_code: string
  native_place: string
  gotra: string
  marital_status: string
  education: string
  // Edit-profile only (never in the wizard): fixed occupation select, plus
  // job sub-fields that only apply when occupation_type === 'Job'.
  occupation_type: string
  job_title: string
  company_name: string
  job_location: string
  // Phase 3c Profile tabs (never in the wizard).
  blood_group: string
  secondary_email: string
  secondary_mobile: string
  residence_phone: string
  birth_place: string
  address_line2: string
  address_line3: string
  pincode: string
  date_of_marriage: string
}

/** "First Middle Last" with blanks dropped -- same rule as the DB trigger. */
export function composeFullName(first: string, middle: string, last: string): string {
  return [first, middle, last]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(' ')
}

/** Whole years since dob, or null when dob is blank/invalid. */
export function ageFromDob(dob: string): number | null {
  if (!dob) return null
  const birth = new Date(dob)
  if (Number.isNaN(birth.getTime())) return null
  const now = new Date()
  let age = now.getFullYear() - birth.getFullYear()
  const beforeBirthday =
    now.getMonth() < birth.getMonth() ||
    (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())
  if (beforeBirthday) age -= 1
  return age < 0 ? null : age
}

export function personToFormValues(person: Person): PersonFormValues {
  return {
    first_name: person.first_name ?? '',
    middle_name: person.middle_name ?? '',
    last_name: person.last_name ?? '',
    gender: person.gender ?? '',
    dob: person.dob ?? '',
    mobile_number: person.mobile_number ?? '',
    home_address: person.home_address ?? '',
    current_city: person.current_city ?? '',
    current_district: person.current_district ?? '',
    current_state: person.current_state ?? '',
    // Backfill for rows saved before state_code existed: current_state is
    // already set, but state_code was never populated. Deriving it here
    // (client-side, same lookup the dropdown itself uses) means the wizard
    // doesn't force the user to re-pick a state that's already showing the
    // right value on screen.
    state_code: person.state_code || STATE_CODE_BY_NAME[person.current_state ?? ''] || '',
    native_place: person.native_place ?? '',
    gotra: person.gotra ?? '',
    marital_status: person.marital_status ?? '',
    education: person.education ?? '',
    occupation_type: person.occupation_type ?? '',
    job_title: person.job_title ?? '',
    company_name: person.company_name ?? '',
    job_location: person.job_location ?? '',
    blood_group: person.blood_group ?? '',
    secondary_email: person.secondary_email ?? '',
    secondary_mobile: person.secondary_mobile ?? '',
    residence_phone: person.residence_phone ?? '',
    birth_place: person.birth_place ?? '',
    address_line2: person.address_line2 ?? '',
    address_line3: person.address_line3 ?? '',
    pincode: person.pincode ?? '',
    date_of_marriage: person.date_of_marriage ?? '',
  }
}

export function formValuesToPatch(values: Partial<PersonFormValues>): Partial<Person> {
  const patch: Record<string, string | null> = {}
  for (const [key, value] of Object.entries(values)) {
    patch[key] = value === '' ? null : (value as string)
  }
  // Whenever a name part is being written, send the composed full_name too:
  // the insert path needs it (full_name is NOT NULL) and it keeps the
  // client's optimistic state right. The DB trigger recomposes from the
  // row's actual parts afterwards, so this is never the last word.
  if ('first_name' in values || 'middle_name' in values || 'last_name' in values) {
    const composed = composeFullName(
      values.first_name ?? '',
      values.middle_name ?? '',
      values.last_name ?? '',
    )
    if (composed) patch.full_name = composed
  }
  return patch as Partial<Person>
}

export async function getOwnPerson(authUserId: string): Promise<Person | null> {
  // people_auth_user_id_key (migration 0002) guarantees at most one row per
  // account, so a plain .maybeSingle() is safe -- no ordering/tiebreak
  // needed (that used to matter before this constraint existed, when a
  // duplicate-polluted account could cause AuthGate/ProfileWizard to
  // redirect in a loop depending on which duplicate a query happened to
  // return).
  const { data, error } = await supabase
    .from('people')
    .select('*')
    .eq('auth_user_id', authUserId)
    .maybeSingle()

  if (error) throw error
  return data
}

export async function createOwnPerson(authUserId: string, fullName: string): Promise<Person> {
  const { data, error } = await supabase
    .from('people')
    .insert({ auth_user_id: authUserId, full_name: fullName })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updateOwnPerson(id: string, patch: Partial<Person>): Promise<Person> {
  const { data, error } = await supabase
    .from('people')
    .update(patch)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function saveOwnPerson(
  patch: Partial<Person>,
  existing: Person | null,
  authUserId: string,
): Promise<Person> {
  if (existing) {
    return updateOwnPerson(existing.id, patch)
  }

  const fullName = patch.full_name ?? 'Member'
  const rest = { ...patch }
  delete rest.full_name
  const created = await createOwnPerson(authUserId, fullName)
  if (Object.keys(rest).length === 0) return created
  return updateOwnPerson(created.id, rest)
}
