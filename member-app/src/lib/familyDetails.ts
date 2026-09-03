import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '../utils/supabase'
import type { ChildRow, FamilyRelationRow, FamilyRelationSlot } from '../types/database'

export type FamilySlot = FamilyRelationSlot

export type MemberCandidate = {
  id: string
  full_name: string
  gotra: string | null
  native_place: string | null
  current_city: string | null
  current_state: string | null
  member_code: string
  mobile_number: string | null
}

export type ChildRecord = {
  id: string
  child_name: string
  child_member_code: string | null
  child_id: string | null
  child_mobile_number: string | null
  child_dob: string | null
}

/** Optional extras the caller records about a relative -- their own entry,
 * never copied from the relative's real row even when a member code links
 * them. Mobile is stored as `+91` + 10 digits (same shape as the member's
 * own number); dob is an ISO `YYYY-MM-DD` string. Empty means "not given". */
export type RelativeContact = {
  mobileNumber: string
  dob: string
}

export const EMPTY_RELATIVE_CONTACT: RelativeContact = { mobileNumber: '', dob: '' }

const RELATIVE_MOBILE_PATTERN = /^\+91[6-9]\d{9}$/

/** Client-side check mirroring the server's normalize_relative_mobile /
 * check_relative_dob, so the user gets a readable message before a round
 * trip. Returns an error string, or null when the contact is acceptable. */
export function validateRelativeContact(contact: RelativeContact): string | null {
  const mobile = contact.mobileNumber.trim()
  if (mobile.length > 0 && !RELATIVE_MOBILE_PATTERN.test(mobile)) {
    return 'Please enter a valid 10-digit mobile number, or leave it blank.'
  }

  const dob = contact.dob.trim()
  if (dob.length > 0) {
    const parsed = new Date(dob)
    if (Number.isNaN(parsed.getTime())) return 'Please enter a valid date of birth.'
    if (parsed > new Date()) return 'Date of birth cannot be in the future.'
  }

  return null
}

function contactArgs(contact?: RelativeContact) {
  return {
    p_mobile_number: contact?.mobileNumber.trim() || null,
    p_dob: contact?.dob.trim() || null,
  }
}

export async function searchRegisteredMembers(params: {
  fullName: string
  gotra?: string
  nativePlace?: string
}): Promise<MemberCandidate[]> {
  const { data, error } = await supabase.rpc('search_registered_members', {
    p_full_name: params.fullName,
    p_gotra: params.gotra || null,
    p_native_place: params.nativePlace || null,
  })

  if (error) throw error
  return data ?? []
}

export async function saveFamilyRelation(
  slot: FamilySlot,
  name: string,
  memberCode?: string | null,
  contact?: RelativeContact,
): Promise<void> {
  const { error } = await supabase.rpc('save_family_relation', {
    p_slot: slot,
    p_name: name,
    p_member_code: memberCode || null,
    ...contactArgs(contact),
  })

  if (error) throw error
}

/** One row per slot the caller has actually entered (father/mother/spouse/
 * maternal_uncle/spouse_father/spouse_mother) -- an absent slot means "not
 * entered yet", same as the old flat null columns did. Plain client select
 * under family_relations' self-scoped RLS, same shape as getChildren(). */
export async function getFamilyRelations(personId: string): Promise<FamilyRelationRow[]> {
  const { data, error } = await supabase
    .from('family_relations')
    .select('*')
    .eq('person_id', personId)

  if (error) throw error
  return data ?? []
}

/** Just the three flat name fields getProfileCompletion() checks (see
 * profileCompletion.ts's PROFILE_FIELDS) -- father_name/mother_name/
 * spouse_name used to live directly on the person row; now they're derived
 * from family_relations. Callers merge this into the object they pass to
 * getProfileCompletion() rather than reading it off `person` directly. */
export type FamilyNameCompletionFlags = {
  father_name: string | null
  mother_name: string | null
  spouse_name: string | null
}

export async function getFamilyNameCompletionFlags(personId: string): Promise<FamilyNameCompletionFlags> {
  const relations = await getFamilyRelations(personId)
  const bySlot = new Map(relations.map((r) => [r.slot, r]))
  return {
    father_name: bySlot.get('father')?.related_name ?? null,
    mother_name: bySlot.get('mother')?.related_name ?? null,
    spouse_name: bySlot.get('spouse')?.related_name ?? null,
  }
}

export async function getChildren(personId: string): Promise<ChildRecord[]> {
  const { data, error } = await supabase
    .from('children')
    .select('id, child_name, child_member_code, child_id, child_mobile_number, child_dob')
    .eq('parent_person_id', personId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data ?? []) as ChildRow[]
}

export async function addChild(
  name: string,
  memberCode?: string | null,
  contact?: RelativeContact,
): Promise<string> {
  const { data, error } = await supabase.rpc('add_child', {
    p_name: name,
    p_member_code: memberCode || null,
    ...contactArgs(contact),
  })

  if (error) throw error
  return data as string
}

export async function updateChild(
  childRowId: string,
  name: string,
  memberCode?: string | null,
  contact?: RelativeContact,
): Promise<void> {
  const { error } = await supabase.rpc('update_child', {
    p_child_row_id: childRowId,
    p_name: name,
    p_member_code: memberCode || null,
    ...contactArgs(contact),
  })

  if (error) throw error
}

export async function removeChild(childRowId: string): Promise<void> {
  const { error } = await supabase.from('children').delete().eq('id', childRowId)
  if (error) throw error
}

export type InviteSlot = FamilySlot | 'child'

export async function sendFamilyInvite(params: { slot: InviteSlot; email: string }): Promise<void> {
  const { data, error } = await supabase.functions.invoke('send-family-invite', {
    body: { slot: params.slot, email: params.email },
  })

  if (error) {
    // supabase-js collapses any non-2xx response into a generic
    // "Edge Function returned a non-2xx status code" message -- the actual
    // reason is in the response body, reachable via error.context.
    if (error instanceof FunctionsHttpError) {
      let message = error.message
      try {
        const body = await error.context.json()
        if (body?.error) message = body.error
      } catch {
        // response wasn't JSON -- fall back to the generic message
      }
      throw new Error(message)
    }
    throw error
  }
  if (data?.error) throw new Error(data.error)
}
