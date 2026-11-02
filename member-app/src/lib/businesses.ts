import { supabase } from '../utils/supabase'
import { compressImage } from './profilePhoto'
import { EMAIL_PATTERN } from './familyDetails'
import type { BusinessRow } from '../types/database'

const BUCKET = 'business-media'

/** The columns every listing RPC returns (cards). */
export type BusinessCard = {
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
  /** (0027) Admin-set "Verified". */
  is_verified: boolean
}

export type BusinessListingPage = BusinessCard & { total_count: number }

/** One listing as returned by get_business: the card fields plus the
 * richer Phase 3c detail columns (0017) and, from 0028, products and
 * whether the caller saved it. */
export type BusinessListing = BusinessCard & {
  brand_name: string | null
  address_line1: string | null
  address_line2: string | null
  business_email: string | null
  business_type: string | null
  facebook_url: string | null
  instagram_url: string | null
  linkedin_url: string | null
  youtube_url: string | null
  products: string[]
  is_saved: boolean
}

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
  brand_name: string
  category: string
  business_type: string
  products: string[]
  description: string
  address_line1: string
  address_line2: string
  city: string
  state: string
  contact_phone: string
  business_email: string
  website: string
  facebook_url: string
  instagram_url: string
  linkedin_url: string
  youtube_url: string
}

export const EMPTY_BUSINESS_FORM: BusinessFormValues = {
  name: '',
  brand_name: '',
  category: '',
  business_type: '',
  products: [],
  description: '',
  address_line1: '',
  address_line2: '',
  city: '',
  state: '',
  contact_phone: '',
  business_email: '',
  website: '',
  facebook_url: '',
  instagram_url: '',
  linkedin_url: '',
  youtube_url: '',
}

export function businessToFormValues(row: BusinessRow): BusinessFormValues {
  return {
    name: row.name ?? '',
    brand_name: row.brand_name ?? '',
    category: row.category ?? '',
    business_type: row.business_type ?? '',
    products: row.products ?? [],
    description: row.description ?? '',
    address_line1: row.address_line1 ?? '',
    address_line2: row.address_line2 ?? '',
    city: row.city ?? '',
    state: row.state ?? '',
    contact_phone: row.contact_phone ?? '',
    business_email: row.business_email ?? '',
    website: row.website ?? '',
    facebook_url: row.facebook_url ?? '',
    instagram_url: row.instagram_url ?? '',
    linkedin_url: row.linkedin_url ?? '',
    youtube_url: row.youtube_url ?? '',
  }
}

const PHONE_PATTERN = /^\+91[6-9]\d{9}$/

/** (0028) Mirrors business_products_valid. */
export const PRODUCTS_MAX = 20
export const PRODUCT_MAX_LENGTH = 60

/** Trimmed, blanks dropped, case-insensitive duplicates dropped. */
function cleanProducts(products: string[]): string[] {
  const seen = new Set<string>()
  const cleaned: string[] = []
  for (const raw of products) {
    const item = raw.trim()
    const key = item.toLowerCase()
    if (item.length === 0 || seen.has(key)) continue
    seen.add(key)
    cleaned.push(item)
  }
  return cleaned
}

/** Mirrors the DB check constraints (0014/0017) so the user gets a readable
 * message before a round trip. */
export function validateBusiness(values: BusinessFormValues): string | null {
  if (values.name.trim().length === 0) return 'Business name is required.'
  if (values.category.trim().length === 0) return 'Please pick an industry type.'
  const phone = values.contact_phone.trim()
  if (phone.length > 0 && !PHONE_PATTERN.test(phone)) {
    return 'Please enter a valid 10-digit contact number, or leave it blank.'
  }
  const email = values.business_email.trim()
  if (email.length > 0 && !EMAIL_PATTERN.test(email)) {
    return 'Please enter a valid business email, or leave it blank.'
  }
  const products = cleanProducts(values.products)
  if (products.length > PRODUCTS_MAX) {
    return `Add at most ${PRODUCTS_MAX} products or services.`
  }
  if (products.some((item) => item.length > PRODUCT_MAX_LENGTH)) {
    return `Keep each product or service to ${PRODUCT_MAX_LENGTH} characters.`
  }
  return null
}

/** `https://` prefixed when missing. Used for the website and the four
 * social links alike. */
function normaliseWebsite(raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed.length === 0) return null
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

function formValuesToPatch(values: BusinessFormValues): Partial<BusinessRow> {
  return {
    name: values.name.trim(),
    brand_name: values.brand_name.trim() || null,
    category: values.category.trim() || null,
    business_type: values.business_type.trim() || null,
    products: cleanProducts(values.products),
    description: values.description.trim() || null,
    address_line1: values.address_line1.trim() || null,
    address_line2: values.address_line2.trim() || null,
    city: values.city.trim() || null,
    state: values.state.trim() || null,
    contact_phone: values.contact_phone.trim() || null,
    business_email: values.business_email.trim().toLowerCase() || null,
    website: normaliseWebsite(values.website),
    facebook_url: normaliseWebsite(values.facebook_url),
    instagram_url: normaliseWebsite(values.instagram_url),
    linkedin_url: normaliseWebsite(values.linkedin_url),
    youtube_url: normaliseWebsite(values.youtube_url),
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
  /** (0028) Only listings the caller saved. */
  savedOnly?: boolean
}): Promise<BusinessListingPage[]> {
  const { data, error } = await supabase.rpc('list_businesses', {
    p_search: params.search || null,
    p_category: params.category || null,
    p_city: params.city || null,
    p_state: params.state || null,
    p_limit: params.limit ?? 20,
    p_offset: params.offset ?? 0,
    p_saved_only: params.savedOnly ?? false,
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

// ------------------------------------------- save / report / track ----
// (0028) RPC-only: business_saves, business_reports and business_activity
// have no table policies.

export async function setBusinessSaved(businessId: string, saved: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_business_saved', {
    p_business_id: businessId,
    p_saved: saved,
  })
  if (error) throw error
}

/** Mirrors the business_reports.reason check. */
export const BUSINESS_REPORT_REASON_OPTIONS = [
  'Fake or misleading',
  'Wrong contact details',
  'Inappropriate content',
  "Not a member's business",
  'Other',
].map((value) => ({ value, label: value }))

export async function reportBusiness(
  businessId: string,
  reason: string,
  details: string,
): Promise<void> {
  const { error } = await supabase.rpc('report_business', {
    p_business_id: businessId,
    p_reason: reason,
    p_details: details.trim() || null,
  })
  if (error) throw error
}

export type BusinessActivityKind = 'view' | 'call' | 'whatsapp'

/** Fire-and-forget: tracking must never break the page. The RPC itself
 * skips the owner and repeats on the same day. */
export function logBusinessActivity(businessId: string, kind: BusinessActivityKind): void {
  supabase
    .rpc('log_business_activity', { p_business_id: businessId, p_kind: kind })
    .then(({ error }) => {
      if (error) console.warn('[businesses] failed to log activity', error)
    })
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
