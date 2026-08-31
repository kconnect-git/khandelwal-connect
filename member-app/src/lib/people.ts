import { supabase } from '../utils/supabase'
import type { Person } from '../types/database'

export type PersonFormValues = {
  full_name: string
  gender: string
  dob: string
  mobile_number: string
  current_city: string
  native_place: string
  district: string
  state: string
  gotra: string
  marital_status: string
  education: string
}

export function personToFormValues(person: Person): PersonFormValues {
  return {
    full_name: person.full_name ?? '',
    gender: person.gender ?? '',
    dob: person.dob ?? '',
    mobile_number: person.mobile_number ?? '',
    current_city: person.current_city ?? '',
    native_place: person.native_place ?? '',
    district: person.district ?? '',
    state: person.state ?? '',
    gotra: person.gotra ?? '',
    marital_status: person.marital_status ?? '',
    education: person.education ?? '',
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
  // No unique constraint exists on auth_user_id, so more than one row can
  // exist for the same account (e.g. from re-verifying before this table
  // had a duplicate check). Order + take the first rather than
  // .maybeSingle(), which throws on >1 row. `id` is a required tiebreaker:
  // rows inserted close together can share the same created_at timestamp,
  // and ORDER BY with no tiebreak on a tied column is non-deterministic in
  // Postgres -- without it, two calls to this exact query can return two
  // different rows for the same account, which is exactly what caused an
  // infinite AuthGate/ProfileWizard redirect loop on a duplicate-polluted
  // test account (one query call saw an incomplete row, the next saw a
  // complete one).
  const { data, error } = await supabase
    .from('people')
    .select('*')
    .eq('auth_user_id', authUserId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(1)

  if (error) throw error
  return data && data.length > 0 ? data[0] : null
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
