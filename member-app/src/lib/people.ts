import { supabase } from '../utils/supabase'
import { STATE_CODE_BY_NAME } from './formOptions'
import type { Person } from '../types/database'

export type PersonFormValues = {
  full_name: string
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
}

export function personToFormValues(person: Person): PersonFormValues {
  return {
    full_name: person.full_name ?? '',
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
  }
}

export function formValuesToPatch(values: Partial<PersonFormValues>): Partial<Person> {
  const patch: Record<string, string | null> = {}
  for (const [key, value] of Object.entries(values)) {
    patch[key] = value === '' ? null : (value as string)
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
