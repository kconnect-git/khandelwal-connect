import { supabase } from '../utils/supabase'
import type {
  BusinessPostKind,
  BusinessPostResponder,
  BusinessPostRow,
  BusinessRow,
  Person,
} from '../types/database'

// Phase 10.6: Buy & Sell. Everything is RPC-only (0031) -- the post tables
// have no client policies, and a post's phone only comes back from
// respond_to_business_post.

export const POST_KIND_LABELS: Record<BusinessPostKind, string> = {
  requirement: 'Looking for',
  offer: 'Offering',
}

/** The one free line under the title means something different per kind. */
export const POST_TERMS_LABELS: Record<BusinessPostKind, string> = {
  requirement: 'Quantity or budget',
  offer: 'Price or terms',
}

/** Mirrors report_business_post (a subset of the listing reasons). */
export const POST_REPORT_REASON_OPTIONS = [
  'Fake or misleading',
  'Wrong contact details',
  'Inappropriate content',
  'Other',
].map((value) => ({ value, label: value }))

export const POST_TITLE_MAX = 100
export const POST_DETAILS_MAX = 1000
export const POST_TERMS_MAX = 100

const PHONE_PATTERN = /^\+91[6-9]\d{9}$/

export type PostFormValues = {
  kind: BusinessPostKind
  title: string
  terms: string
  details: string
  category: string
  city: string
  state: string
  contact_phone: string
  /** '' = post as just me. */
  business_id: string
}

/** Mirrors create_business_post's checks, for a readable message first. */
export function validatePost(values: PostFormValues): string | null {
  if (values.title.trim().length === 0) return 'Please give your post a title.'
  if (values.title.trim().length > POST_TITLE_MAX) {
    return `Keep the title to ${POST_TITLE_MAX} characters.`
  }
  if (values.category.length === 0) return 'Please pick an industry.'
  if (!PHONE_PATTERN.test(values.contact_phone)) {
    return 'Please enter a valid 10-digit contact number.'
  }
  return null
}

/** A new post's starting values: city, state and phone from the member's
 * profile, plus which of them were filled that way. */
export function postPrefill(
  person: Person,
  kind: BusinessPostKind,
): { values: PostFormValues; fromProfile: Set<keyof PostFormValues> } {
  const fromProfile = new Set<keyof PostFormValues>()
  const values: PostFormValues = {
    kind,
    title: '',
    terms: '',
    details: '',
    category: '',
    city: '',
    state: '',
    contact_phone: '',
    business_id: '',
  }
  if (person.current_city) {
    values.city = person.current_city
    fromProfile.add('city')
  }
  if (person.current_state) {
    values.state = person.current_state
    fromProfile.add('state')
  }
  if (person.mobile_number && PHONE_PATTERN.test(person.mobile_number)) {
    values.contact_phone = person.mobile_number
    fromProfile.add('contact_phone')
  }
  return { values, fromProfile }
}

/** Listings a member may post as: their own, approved and not hidden. */
export function postableBusinesses(businesses: BusinessRow[]): BusinessRow[] {
  return businesses.filter((b) => b.review_status === 'approved' && !b.is_hidden)
}

export function whatsAppLink(phone: string, text: string): string {
  return `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`
}

// ------------------------------------------------------------ reads ----

export async function listBusinessPosts(params: {
  kind?: BusinessPostKind
  category?: string
  savedOnly?: boolean
  mine?: boolean
  limit?: number
  offset?: number
}): Promise<BusinessPostRow[]> {
  const { data, error } = await supabase.rpc('list_business_posts', {
    p_kind: params.kind ?? 'requirement',
    p_category: params.category || null,
    p_saved_only: params.savedOnly ?? false,
    p_mine: params.mine ?? false,
    p_limit: params.limit ?? 20,
    p_offset: params.offset ?? 0,
  })
  if (error) throw error
  return data ?? []
}

export async function listBusinessPostResponses(postId: string): Promise<BusinessPostResponder[]> {
  const { data, error } = await supabase.rpc('list_business_post_responses', {
    p_post_id: postId,
  })
  if (error) throw error
  return data ?? []
}

// ----------------------------------------------------------- writes ----

export async function createBusinessPost(values: PostFormValues): Promise<string> {
  const { data, error } = await supabase.rpc('create_business_post', {
    p_kind: values.kind,
    p_title: values.title.trim(),
    p_details: values.details.trim() || null,
    p_terms: values.terms.trim() || null,
    p_category: values.category,
    p_city: values.city.trim() || null,
    p_state: values.state.trim() || null,
    p_contact_phone: values.contact_phone,
    p_business_id: values.business_id || null,
  })
  if (error) throw error
  return data
}

/** Close, or reopen for another 30 days. */
export async function setBusinessPostOpen(postId: string, open: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_business_post_open', {
    p_post_id: postId,
    p_open: open,
  })
  if (error) throw error
}

export async function deleteBusinessPost(postId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_business_post', { p_post_id: postId })
  if (error) throw error
}

/** Records the response and returns the number to WhatsApp. */
export async function respondToBusinessPost(postId: string): Promise<string> {
  const { data, error } = await supabase.rpc('respond_to_business_post', { p_post_id: postId })
  if (error) throw error
  return data
}

export async function setBusinessPostSaved(postId: string, saved: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_business_post_saved', {
    p_post_id: postId,
    p_saved: saved,
  })
  if (error) throw error
}

export async function reportBusinessPost(
  postId: string,
  reason: string,
  details: string,
): Promise<void> {
  const { error } = await supabase.rpc('report_business_post', {
    p_post_id: postId,
    p_reason: reason,
    p_details: details.trim() || null,
  })
  if (error) throw error
}
