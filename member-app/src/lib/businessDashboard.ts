import { supabase } from '../utils/supabase'
import type { BusinessDashboardStats, BusinessEnquiryRow, BusinessRow } from '../types/database'

// Phase 10.8: the owner's dashboard and the enquiries it lists. RPC-only
// (0033).

export const ENQUIRY_MESSAGE_MAX = 500

// ------------------------------------------------------- completeness ----

type CompletenessField = {
  filled: (row: BusinessRow) => boolean
  /** Shown when this is the first thing missing. */
  nudge: string
}

// In nudge priority: what most helps members find and contact the business
// comes first.
const COMPLETENESS_FIELDS: CompletenessField[] = [
  {
    filled: (row) => row.products.length > 0,
    nudge: 'Add your products and services to get more enquiries.',
  },
  {
    filled: (row) => Boolean(row.description?.trim()),
    nudge: 'Add a short description so members know what you do.',
  },
  { filled: (row) => Boolean(row.logo_url), nudge: 'Add a logo so your listing stands out.' },
  { filled: (row) => Boolean(row.contact_phone), nudge: 'Add a phone or WhatsApp number.' },
  { filled: (row) => Boolean(row.website), nudge: 'Add your website.' },
  { filled: (row) => Boolean(row.owner_role), nudge: 'Say what your role is in the business.' },
  { filled: (row) => Boolean(row.city), nudge: 'Add your city.' },
  { filled: (row) => Boolean(row.state), nudge: 'Add your state.' },
  { filled: (row) => Boolean(row.category), nudge: 'Pick your industry.' },
  { filled: (row) => Boolean(row.name.trim()), nudge: 'Add your business name.' },
]

export function listingCompleteness(row: BusinessRow): {
  filled: number
  total: number
  percent: number
  nudge: string | null
} {
  const missing = COMPLETENESS_FIELDS.filter((field) => !field.filled(row))
  const total = COMPLETENESS_FIELDS.length
  const filled = total - missing.length
  return {
    filled,
    total,
    percent: Math.round((filled / total) * 100),
    nudge: missing[0]?.nudge ?? null,
  }
}

// ------------------------------------------------------------ dashboard ----

export async function getBusinessDashboard(businessId: string): Promise<BusinessDashboardStats> {
  const { data, error } = await supabase.rpc('business_dashboard', { p_business_id: businessId })
  if (error) throw error
  return data
}

// ------------------------------------------------------------ enquiries ----

export async function sendBusinessEnquiry(
  businessId: string,
  about: string | null,
  message: string,
): Promise<void> {
  const { error } = await supabase.rpc('send_business_enquiry', {
    p_business_id: businessId,
    p_about: about,
    p_message: message.trim(),
  })
  if (error) throw error
}

export async function listBusinessEnquiries(params: {
  businessId: string
  status: 'new' | 'done'
  limit?: number
}): Promise<BusinessEnquiryRow[]> {
  const { data, error } = await supabase.rpc('list_business_enquiries', {
    p_business_id: params.businessId,
    p_status: params.status,
    p_limit: params.limit ?? 10,
  })
  if (error) throw error
  return data ?? []
}

export async function setBusinessEnquiryDone(enquiryId: string, done: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_business_enquiry_done', {
    p_enquiry_id: enquiryId,
    p_done: done,
  })
  if (error) throw error
}
