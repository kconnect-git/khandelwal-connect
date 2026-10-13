import { supabase } from '../utils/supabase'
import { compressImage } from './profilePhoto'
import type { Option } from './formOptions'
import type {
  AdminMatrimonyDetail,
  AdminMatrimonyReportRow,
  AdminMatrimonyRow,
  MatrimonyBlockRow,
  MatrimonyBox,
  MatrimonyCardRow,
  MatrimonyFilterOptions,
  MatrimonyInterestRow,
  MatrimonyProfileRow,
  MatrimonyProfileView,
  MatrimonyStatus,
  MyMatrimony,
} from '../types/database'

// Phase 6a (0023): matrimony profiles. Everything goes through RPCs -- the
// tables have RLS on and no policies, like events and notices. Photos live
// in the private matrimony-photos bucket and are only ever shown through
// short-lived signed URLs.

const BUCKET = 'matrimony-photos'
const SIGNED_URL_TTL_SECONDS = 600
export const MAX_MATRIMONY_PHOTOS = 3

export const ABOUT_ME_MAX = 1000
export const ABOUT_FAMILY_MAX = 600
export const PARTNER_EXPECTATIONS_MAX = 600
export const INTEREST_MESSAGE_MAX = 300

/** What accepting an interest shares -- shown in every accept dialog. */
export const SHARE_ON_ACCEPT =
  'You will both see each other’s full name, photos, parents’ names, native place, email and mobile number (unless it is hidden).'

export const MATRIMONY_STATUS_LABELS: Record<MatrimonyStatus, string> = {
  draft: 'Draft',
  pending: 'Awaiting review',
  changes_requested: 'Changes requested',
  approved: 'Live',
  rejected: 'Turned down',
  paused: 'Paused',
  hidden: 'Hidden by admin',
}

// ---------------------------------------------------------------- options
// Fixed lists, mirrored by the matrimony_profiles check constraints (0023).

const toOptions = (values: string[]): Option[] => values.map((value) => ({ value, label: value }))

export const DIET_OPTIONS = toOptions(['Vegetarian', 'Jain', 'Eggetarian', 'Non-vegetarian'])

export const HABIT_OPTIONS = toOptions(['Never', 'Occasionally', 'Yes'])

export const RASHI_OPTIONS = toOptions([
  'Mesh', 'Vrishabh', 'Mithun', 'Kark', 'Simha', 'Kanya',
  'Tula', 'Vrishchik', 'Dhanu', 'Makar', 'Kumbh', 'Meen',
])

export const NAKSHATRA_OPTIONS = toOptions([
  'Ashwini', 'Bharani', 'Krittika', 'Rohini', 'Mrigashira', 'Ardra', 'Punarvasu',
  'Pushya', 'Ashlesha', 'Magha', 'Purva Phalguni', 'Uttara Phalguni', 'Hasta',
  'Chitra', 'Swati', 'Vishakha', 'Anuradha', 'Jyeshtha', 'Mula', 'Purva Ashadha',
  'Uttara Ashadha', 'Shravana', 'Dhanishta', 'Shatabhisha', 'Purva Bhadrapada',
  'Uttara Bhadrapada', 'Revati',
])

/** Height is picked in feet and inches and stored in cm. */
export function formatHeight(cm: number | null): string | null {
  if (!cm) return null
  const totalInches = Math.round(cm / 2.54)
  return `${Math.floor(totalInches / 12)}′ ${totalInches % 12}″ (${cm} cm)`
}

// 4'0" to 7'0", one option per inch.
export const HEIGHT_OPTIONS: Option[] = Array.from({ length: 37 }, (_, i) => {
  const cm = Math.round((48 + i) * 2.54)
  return { value: String(cm), label: formatHeight(cm) ?? '' }
})

// ---------------------------------------------------------------- member

/** The editable fields as form strings; '' = not filled in / not disclosed. */
export type MatrimonyFormValues = {
  height_cm: string
  about_me: string
  about_family: string
  partner_expectations: string
  diet: string
  smoking: string
  drinking: string
  /** 'HH:MM' */
  birth_time: string
  birth_place: string
  rashi: string
  nakshatra: string
}

export function matrimonyFormValues(profile: MatrimonyProfileRow | null): MatrimonyFormValues {
  return {
    height_cm: profile?.height_cm ? String(profile.height_cm) : '',
    about_me: profile?.about_me ?? '',
    about_family: profile?.about_family ?? '',
    partner_expectations: profile?.partner_expectations ?? '',
    diet: profile?.diet ?? '',
    smoking: profile?.smoking ?? '',
    drinking: profile?.drinking ?? '',
    birth_time: profile?.birth_time?.slice(0, 5) ?? '',
    birth_place: profile?.birth_place ?? '',
    rashi: profile?.rashi ?? '',
    nakshatra: profile?.nakshatra ?? '',
  }
}

export async function getMyMatrimony(): Promise<MyMatrimony | null> {
  const { data, error } = await supabase.rpc('get_my_matrimony_profile')
  if (error) throw error
  return data ?? null
}

export async function saveMyMatrimony(values: MatrimonyFormValues): Promise<void> {
  const text = (value: string) => value.trim() || null
  const { error } = await supabase.rpc('save_my_matrimony_profile', {
    p_height_cm: values.height_cm ? Number(values.height_cm) : null,
    p_about_me: text(values.about_me),
    p_about_family: text(values.about_family),
    p_partner_expectations: text(values.partner_expectations),
    p_diet: text(values.diet),
    p_smoking: text(values.smoking),
    p_drinking: text(values.drinking),
    p_birth_time: values.birth_time || null,
    p_birth_place: text(values.birth_place),
    p_rashi: text(values.rashi),
    p_nakshatra: text(values.nakshatra),
  })
  if (error) throw error
}

export async function submitMyMatrimony(): Promise<void> {
  const { error } = await supabase.rpc('submit_matrimony_profile')
  if (error) throw error
}

/** Compress (which also strips EXIF -- see compressImage), upload to the
 *  caller's own folder, then record it. If recording fails (say a 4th
 *  photo), the orphaned file is cleaned up. */
export async function uploadMatrimonyPhoto(file: File): Promise<void> {
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) throw new Error('Please sign in again.')

  const blob = await compressImage(file)
  const path = `${auth.user.id}/${crypto.randomUUID()}.jpg`
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { contentType: 'image/jpeg' })
  if (uploadError) throw uploadError

  const { error } = await supabase.rpc('add_matrimony_photo', { p_storage_path: path })
  if (error) {
    await supabase.storage.from(BUCKET).remove([path])
    throw error
  }
}

export async function removeMatrimonyPhoto(photoId: string): Promise<void> {
  const { data: path, error } = await supabase.rpc('remove_matrimony_photo', {
    p_photo_id: photoId,
  })
  if (error) throw error
  // Best-effort, as with profile photos: the row is already gone, so an
  // orphaned file is not worth failing over.
  const { error: removeError } = await supabase.storage.from(BUCKET).remove([path])
  if (removeError) console.warn('[matrimony] failed to remove photo file', removeError)
}

export async function setMainMatrimonyPhoto(photoId: string): Promise<void> {
  const { error } = await supabase.rpc('set_main_matrimony_photo', { p_photo_id: photoId })
  if (error) throw error
}

/** storage path -> signed URL. Paths the caller may not read are left out. */
export async function signedPhotoUrls(paths: string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {}
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS)
  if (error) throw error
  const urls: Record<string, string> = {}
  for (const entry of data ?? []) {
    if (entry.path && entry.signedUrl) urls[entry.path] = entry.signedUrl
  }
  return urls
}

// ---------------------------------------------------------------- browse (6b)

/** "Priya S." -- the most of a name anyone sees before a match. */
export function shortName(row: { first_name: string | null; last_initial: string | null }): string {
  return [row.first_name, row.last_initial ? `${row.last_initial}.` : null].filter(Boolean).join(' ')
}

export type MatrimonyFilters = {
  ageMin: string
  ageMax: string
  state: string
  city: string
  education: string
  occupation: string
}

export const EMPTY_MATRIMONY_FILTERS: MatrimonyFilters = {
  ageMin: '',
  ageMax: '',
  state: '',
  city: '',
  education: '',
  occupation: '',
}

export async function listMatrimonyProfiles(
  filters: MatrimonyFilters,
  page: { limit?: number; offset?: number } = {},
): Promise<MatrimonyCardRow[]> {
  const { data, error } = await supabase.rpc('list_matrimony_profiles', {
    p_age_min: filters.ageMin ? Number(filters.ageMin) : null,
    p_age_max: filters.ageMax ? Number(filters.ageMax) : null,
    p_state: filters.state || null,
    p_city: filters.city || null,
    p_education: filters.education.trim() || null,
    p_occupation: filters.occupation || null,
    p_limit: page.limit ?? 20,
    p_offset: page.offset ?? 0,
  })
  if (error) throw error
  return data ?? []
}

export async function matrimonyFilterOptions(): Promise<MatrimonyFilterOptions> {
  const { data, error } = await supabase.rpc('matrimony_filter_options')
  if (error) throw error
  return data ?? { states: [], cities: [] }
}

export async function getMatrimonyProfile(profileId: string): Promise<MatrimonyProfileView | null> {
  const { data, error } = await supabase.rpc('get_matrimony_profile', { p_profile_id: profileId })
  if (error) throw error
  return data ?? null
}

// ---------------------------------------------------------------- interests (6b)

/** 'matched' when the other person had already sent theirs. */
export async function expressInterest(
  profileId: string,
  message: string,
): Promise<'sent' | 'matched'> {
  const { data, error } = await supabase.rpc('express_interest', {
    p_profile_id: profileId,
    p_message: message.trim() || null,
  })
  if (error) throw error
  return data
}

export async function withdrawInterest(interestId: string): Promise<void> {
  const { error } = await supabase.rpc('withdraw_interest', { p_interest_id: interestId })
  if (error) throw error
}

export async function respondInterest(interestId: string, accept: boolean): Promise<void> {
  const { error } = await supabase.rpc('respond_interest', {
    p_interest_id: interestId,
    p_accept: accept,
  })
  if (error) throw error
}

export async function listMyInterests(box: MatrimonyBox): Promise<MatrimonyInterestRow[]> {
  const { data, error } = await supabase.rpc('list_my_interests', { p_box: box })
  if (error) throw error
  return data ?? []
}

export async function markInterestsSeen(box: MatrimonyBox): Promise<void> {
  const { error } = await supabase.rpc('mark_interests_seen', { p_box: box })
  if (error) throw error
}

export async function matrimonyBadgeCount(): Promise<number> {
  const { data, error } = await supabase.rpc('matrimony_badge_count')
  if (error) throw error
  return data ?? 0
}

// ---------------------------------------------------------------- safety (6c)

export const REPORT_REASON_OPTIONS = toOptions([
  'Fake profile',
  'Inappropriate content',
  'Already married',
  'Harassment',
  'Other',
])

export const REPORT_DETAILS_MAX = 1000

export async function setMatrimonyPaused(paused: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_matrimony_paused', { p_paused: paused })
  if (error) throw error
}

export async function endMatrimonyMatch(interestId: string): Promise<void> {
  const { error } = await supabase.rpc('end_matrimony_match', { p_interest_id: interestId })
  if (error) throw error
}

export async function blockMatrimonyProfile(profileId: string): Promise<void> {
  const { error } = await supabase.rpc('block_matrimony_profile', { p_profile_id: profileId })
  if (error) throw error
}

export async function unblockMatrimonyPerson(personId: string): Promise<void> {
  const { error } = await supabase.rpc('unblock_matrimony_person', { p_person_id: personId })
  if (error) throw error
}

export async function listMyMatrimonyBlocks(): Promise<MatrimonyBlockRow[]> {
  const { data, error } = await supabase.rpc('list_my_matrimony_blocks')
  if (error) throw error
  return data ?? []
}

export async function reportMatrimonyProfile(
  profileId: string,
  reason: string,
  details: string,
): Promise<void> {
  const { error } = await supabase.rpc('report_matrimony_profile', {
    p_profile_id: profileId,
    p_reason: reason,
    p_details: details.trim() || null,
  })
  if (error) throw error
}

/** Deletes the profile (with its interests and matches), then its photo
 *  files. File removal is best-effort, as elsewhere. */
export async function deleteMyMatrimony(): Promise<void> {
  const { data: paths, error } = await supabase.rpc('delete_my_matrimony_profile')
  if (error) throw error
  if (paths && paths.length > 0) {
    const { error: removeError } = await supabase.storage.from(BUCKET).remove(paths)
    if (removeError) console.warn('[matrimony] failed to remove photo files', removeError)
  }
}

// ---------------------------------------------------------------- admin

export async function adminListMatrimony(params: {
  status: MatrimonyStatus
  search?: string
  limit?: number
  offset?: number
}): Promise<AdminMatrimonyRow[]> {
  const { data, error } = await supabase.rpc('admin_list_matrimony_profiles', {
    p_status: params.status,
    p_search: params.search?.trim() || null,
    p_limit: params.limit ?? 25,
    p_offset: params.offset ?? 0,
  })
  if (error) throw error
  return data ?? []
}

export async function adminGetMatrimony(profileId: string): Promise<AdminMatrimonyDetail | null> {
  const { data, error } = await supabase.rpc('admin_get_matrimony_profile', {
    p_profile_id: profileId,
  })
  if (error) throw error
  return data ?? null
}

export async function adminListMatrimonyReports(params: {
  status: 'open' | 'resolved'
  limit?: number
  offset?: number
}): Promise<AdminMatrimonyReportRow[]> {
  const { data, error } = await supabase.rpc('admin_list_matrimony_reports', {
    p_status: params.status,
    p_limit: params.limit ?? 25,
    p_offset: params.offset ?? 0,
  })
  if (error) throw error
  return data ?? []
}

export async function adminResolveMatrimonyReport(reportId: string, note: string): Promise<void> {
  const { error } = await supabase.rpc('admin_resolve_matrimony_report', {
    p_report_id: reportId,
    p_note: note.trim() || null,
  })
  if (error) throw error
}

export async function adminSetMatrimonyHidden(
  profileId: string,
  hidden: boolean,
  reason?: string,
): Promise<void> {
  const { error } = await supabase.rpc('admin_set_matrimony_hidden', {
    p_profile_id: profileId,
    p_hidden: hidden,
    p_reason: reason?.trim() || null,
  })
  if (error) throw error
}

export type AdminMatrimonyDecision = Extract<
  MatrimonyStatus,
  'approved' | 'changes_requested' | 'rejected'
>

export async function adminSetMatrimonyStatus(
  profileId: string,
  status: AdminMatrimonyDecision,
  note?: string,
): Promise<void> {
  const { error } = await supabase.rpc('admin_set_matrimony_status', {
    p_profile_id: profileId,
    p_status: status,
    p_note: note?.trim() || null,
  })
  if (error) throw error
}
