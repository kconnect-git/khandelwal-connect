import { supabase } from '../utils/supabase'
import { compressImage } from './profilePhoto'
import type { BusinessRow } from '../types/database'

const BUCKET = 'business-media'

/** A listing as returned by list_businesses / get_business: the business
 * row plus the owner's directory-tier fields joined in. */
export type BusinessListing = {
  id: string
  name: string
  category: string | null
  description: string | null
  city: string | null
  state: string | null
  contact_phone: string | null
  website: string | null
  logo_url: string | null
  owner_id: string
  owner_name: string
  owner_photo_url: string | null
  owner_member_code: string
}

export type BusinessListingPage = BusinessListing & { total_count: number }

export type MemberBusiness = {
  id: string
  name: string
  category: string | null
  city: string | null
  logo_url: string | null
}

export type BusinessFilterOptions = {
  categories: string[]
  cities: string[]
  states: string[]
}

/** Editable fields, as form strings. Empty string means "not given". */
export type BusinessFormValues = {
  name: string
  category: string
  description: string
  city: string
  state: string
  contact_phone: string
  website: string
}

export const EMPTY_BUSINESS_FORM: BusinessFormValues = {
  name: '',
  category: '',
  description: '',
  city: '',
  state: '',
  contact_phone: '',
  website: '',
}

export function businessToFormValues(row: BusinessRow): BusinessFormValues {
  return {
    name: row.name ?? '',
    category: row.category ?? '',
    description: row.description ?? '',
    city: row.city ?? '',
    state: row.state ?? '',
    contact_phone: row.contact_phone ?? '',
    website: row.website ?? '',
  }
}

const PHONE_PATTERN = /^\+91[6-9]\d{9}$/

/** Mirrors the DB check constraints (0014) so the user gets a readable
 * message before a round trip. */
export function validateBusiness(values: BusinessFormValues): string | null {
  if (values.name.trim().length === 0) return 'Business name is required.'
  if (values.category.trim().length === 0) return 'Please pick a category.'
  const phone = values.contact_phone.trim()
  if (phone.length > 0 && !PHONE_PATTERN.test(phone)) {
    return 'Please enter a valid 10-digit contact number, or leave it blank.'
  }
  return null
}

function normaliseWebsite(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return null
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

function formValuesToPatch(values: BusinessFormValues): Partial<BusinessRow> {
  return {
    name: values.name.trim(),
    category: values.category.trim() || null,
    description: values.description.trim() || null,
    city: values.city.trim() || null,
    state: values.state.trim() || null,
    contact_phone: values.contact_phone.trim() || null,
    website: normaliseWebsite(values.website),
  }
}

// ------------------------------------------------------------ reads ----

export async function listBusinesses(params: {
  search?: string
  category?: string
  city?: string
  state?: string
  limit?: number
  offset?: number
}): Promise<BusinessListingPage[]> {
  const { data, error } = await supabase.rpc('list_businesses', {
    p_search: params.search || null,
    p_category: params.category || null,
    p_city: params.city || null,
    p_state: params.state || null,
    p_limit: params.limit ?? 20,
    p_offset: params.offset ?? 0,
  })

  if (error) throw error
  return data ?? []
}

export async function getBusiness(businessId: string): Promise<BusinessListing | null> {
  const { data, error } = await supabase.rpc('get_business', { p_business_id: businessId })
  if (error) throw error
  return data && data.length > 0 ? data[0] : null
}

export async function listMemberBusinesses(personId: string): Promise<MemberBusiness[]> {
  const { data, error } = await supabase.rpc('list_member_businesses', { p_person_id: personId })
  if (error) throw error
  return data ?? []
}

export async function getBusinessFilterOptions(): Promise<BusinessFilterOptions> {
  const { data, error } = await supabase.rpc('business_filter_options')
  if (error) throw error
  const rows = data ?? []
  return {
    categories: rows.filter((r) => r.kind === 'category').map((r) => r.value),
    cities: rows.filter((r) => r.kind === 'city').map((r) => r.value),
    states: rows.filter((r) => r.kind === 'state').map((r) => r.value),
  }
}

// ----------------------------------------------------------- writes ----
// Plain client-side table access under businesses' RLS (owner-only write,
// members read) -- no RPC needed, nothing here touches another member's row.

export async function getMyBusinesses(ownerId: string): Promise<BusinessRow[]> {
  const { data, error } = await supabase
    .from('businesses')
    .select('*')
    .eq('owner_id', ownerId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return data ?? []
}

export async function createBusiness(
  ownerId: string,
  values: BusinessFormValues,
): Promise<BusinessRow> {
  const { data, error } = await supabase
    .from('businesses')
    .insert({ owner_id: ownerId, ...formValuesToPatch(values), name: values.name.trim() })
    .select()
    .single()

  if (error) throw error
  return data
}

export async function updateBusiness(
  businessId: string,
  values: BusinessFormValues,
): Promise<BusinessRow> {
  const { data, error } = await supabase
    .from('businesses')
    .update({ ...formValuesToPatch(values), updated_at: new Date().toISOString() })
    .eq('id', businessId)
    .select()
    .single()

  if (error) throw error
  return data
}

export async function deleteBusiness(business: BusinessRow): Promise<void> {
  const { error } = await supabase.from('businesses').delete().eq('id', business.id)
  if (error) throw error
  if (business.logo_url) await deleteStoredLogo(business.logo_url)
}

// ------------------------------------------------------------- logo ----
// Same pipeline as profile photos: canvas re-encode (caps size, strips
// EXIF/GPS), timestamped path so the public URL changes on every upload,
// best-effort delete of the previous object.

function storagePathFromPublicUrl(url: string): string | null {
  const marker = `/${BUCKET}/`
  const index = url.indexOf(marker)
  if (index === -1) return null
  return decodeURIComponent(url.slice(index + marker.length))
}

async function deleteStoredLogo(publicUrl: string): Promise<void> {
  const path = storagePathFromPublicUrl(publicUrl)
  if (!path) return
  const { error } = await supabase.storage.from(BUCKET).remove([path])
  if (error) console.warn('[businesses] failed to remove old logo', error)
}

export async function uploadBusinessLogo(
  file: File,
  authUserId: string,
  business: BusinessRow,
): Promise<BusinessRow> {
  const blob = await compressImage(file)

  const path = `${authUserId}/${business.id}/logo-${Date.now()}.jpg`
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, { contentType: 'image/jpeg' })
  if (uploadError) throw uploadError

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path)
  const { data: updated, error } = await supabase
    .from('businesses')
    .update({ logo_url: data.publicUrl, updated_at: new Date().toISOString() })
    .eq('id', business.id)
    .select()
    .single()
  if (error) throw error

  if (business.logo_url) await deleteStoredLogo(business.logo_url)
  return updated
}

export async function removeBusinessLogo(business: BusinessRow): Promise<BusinessRow> {
  const { data: updated, error } = await supabase
    .from('businesses')
    .update({ logo_url: null, updated_at: new Date().toISOString() })
    .eq('id', business.id)
    .select()
    .single()
  if (error) throw error

  if (business.logo_url) await deleteStoredLogo(business.logo_url)
  return updated
}

/** "Category · City, State" for cards and subtitles. */
export function businessMetaLine(b: {
  category: string | null
  city: string | null
  state?: string | null
}): string {
  const location = [b.city, b.state ?? null].filter(Boolean).join(', ')
  return [b.category, location].filter(Boolean).join(' · ')
}
