import { supabase } from '../utils/supabase'
import type { ChildRow } from '../types/database'

export type FamilySlot = 'father' | 'mother' | 'spouse' | 'maternal_uncle' | 'spouse_father' | 'spouse_mother'

export type MemberCandidate = {
  id: string
  full_name: string
  gotra: string | null
  native_place: string | null
  current_city: string | null
  current_state: string | null
  member_code: string
}

export type ChildRecord = {
  id: string
  child_name: string
  child_member_code: string | null
  child_id: string | null
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
): Promise<void> {
  const { error } = await supabase.rpc('save_family_relation', {
    p_slot: slot,
    p_name: name,
    p_member_code: memberCode || null,
  })

  if (error) throw error
}

export async function getChildren(personId: string): Promise<ChildRecord[]> {
  const { data, error } = await supabase
    .from('children')
    .select('id, child_name, child_member_code, child_id')
    .eq('parent_person_id', personId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data ?? []) as ChildRow[]
}

export async function addChild(name: string, memberCode?: string | null): Promise<string> {
  const { data, error } = await supabase.rpc('add_child', {
    p_name: name,
    p_member_code: memberCode || null,
  })

  if (error) throw error
  return data as string
}

export async function updateChild(
  childRowId: string,
  name: string,
  memberCode?: string | null,
): Promise<void> {
  const { error } = await supabase.rpc('update_child', {
    p_child_row_id: childRowId,
    p_name: name,
    p_member_code: memberCode || null,
  })

  if (error) throw error
}

export async function removeChild(childRowId: string): Promise<void> {
  const { error } = await supabase.from('children').delete().eq('id', childRowId)
  if (error) throw error
}
