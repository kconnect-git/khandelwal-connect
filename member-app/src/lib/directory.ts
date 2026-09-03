import { supabase } from '../utils/supabase'

export type DirectoryEntry = {
  id: string
  full_name: string
  gotra: string | null
  native_place: string | null
  current_city: string | null
  current_state: string | null
  member_code: string
  profile_photo_url: string | null
  total_count: number
}

export type MemberProfile = {
  id: string
  full_name: string
  gotra: string | null
  native_place: string | null
  current_city: string | null
  current_district: string | null
  current_state: string | null
  member_code: string
  education: string | null
  marital_status: string | null
  mobile_number: string | null
  profile_photo_url: string | null
}

export type DirectoryFilterOptions = {
  states: string[]
  cities: string[]
  gotras: string[]
}

export async function listDirectory(params: {
  search?: string
  state?: string
  city?: string
  gotra?: string
  limit?: number
  offset?: number
}): Promise<DirectoryEntry[]> {
  const { data, error } = await supabase.rpc('list_directory', {
    p_search: params.search || null,
    p_state: params.state || null,
    p_city: params.city || null,
    p_gotra: params.gotra || null,
    p_limit: params.limit ?? 20,
    p_offset: params.offset ?? 0,
  })

  if (error) throw error
  return data ?? []
}

export async function getMemberProfile(personId: string): Promise<MemberProfile | null> {
  const { data, error } = await supabase.rpc('get_member_profile', {
    p_person_id: personId,
  })

  if (error) throw error
  return data && data.length > 0 ? data[0] : null
}

export async function getDirectoryFilterOptions(): Promise<DirectoryFilterOptions> {
  const { data, error } = await supabase.rpc('directory_filter_options')

  if (error) throw error
  const rows = data ?? []
  return {
    states: rows.filter((r) => r.kind === 'state').map((r) => r.value),
    cities: rows.filter((r) => r.kind === 'city').map((r) => r.value),
    gotras: rows.filter((r) => r.kind === 'gotra').map((r) => r.value),
  }
}
