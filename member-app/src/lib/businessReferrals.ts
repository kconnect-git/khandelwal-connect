import { supabase } from '../utils/supabase'
import type {
  BusinessReferralRow,
  ReferralCounts,
  ReferralOutcome,
  ReferralStatus,
} from '../types/database'

// Phase 10.7: Referrals. RPC-only (0032). The lead's phone belongs to a
// third party: giving one needs consent, and it's cleared once the referral
// is declined or closed.

export const REFERRAL_STATUS_LABELS: Record<ReferralStatus, string> = {
  new: 'New',
  in_talks: 'In talks',
  declined: 'Declined',
  closed: 'Closed',
}

export const REFERRAL_OUTCOME_LABELS: Record<ReferralOutcome, string> = {
  won: 'Business done',
  lost: 'Didn’t work out',
}

export const REFERRAL_NOTE_MAX = 500
export const REFERRAL_NAME_MAX = 100

const PHONE_PATTERN = /^\+91[6-9]\d{9}$/

export type ReferralFormValues = {
  business_id: string
  lead_name: string
  lead_phone: string
  /** Set when the lead was picked from the members. */
  lead_person_id: string | null
  note: string
  consent: boolean
}

/** Mirrors give_business_referral's checks. */
export function validateReferral(values: ReferralFormValues): string | null {
  if (!values.business_id) return 'Please pick the business.'
  if (values.lead_name.trim().length === 0) return 'Please enter the person’s name.'
  if (values.lead_phone && !PHONE_PATTERN.test(values.lead_phone)) {
    return 'Please enter a valid 10-digit phone number.'
  }
  if (!values.lead_person_id && !values.lead_phone) return 'Please enter their phone number.'
  if (values.note.trim().length === 0) return 'Please say what the referral is for.'
  if (!values.consent) return 'Please confirm you have their permission to share their details.'
  return null
}

export async function giveBusinessReferral(values: ReferralFormValues): Promise<string> {
  const { data, error } = await supabase.rpc('give_business_referral', {
    p_business_id: values.business_id,
    p_lead_name: values.lead_name.trim(),
    p_lead_phone: values.lead_phone || null,
    p_lead_person_id: values.lead_person_id,
    p_note: values.note.trim(),
    p_consent: values.consent,
  })
  if (error) throw error
  return data
}

export async function listBusinessReferrals(params: {
  direction: 'received' | 'given'
  limit?: number
  offset?: number
}): Promise<BusinessReferralRow[]> {
  const { data, error } = await supabase.rpc('list_business_referrals', {
    p_direction: params.direction,
    p_limit: params.limit ?? 20,
    p_offset: params.offset ?? 0,
  })
  if (error) throw error
  return data ?? []
}

export async function getReferralCounts(): Promise<ReferralCounts> {
  const { data, error } = await supabase.rpc('business_referral_counts')
  if (error) throw error
  return data ?? { given: 0, received: 0, closed: 0, won: 0, received_new: 0 }
}

/** Accept (-> In talks) or decline, with an optional reason. */
export async function respondBusinessReferral(
  referralId: string,
  accept: boolean,
  reason?: string,
): Promise<void> {
  const { error } = await supabase.rpc('respond_business_referral', {
    p_referral_id: referralId,
    p_accept: accept,
    p_reason: reason?.trim() || null,
  })
  if (error) throw error
}

export async function closeBusinessReferral(
  referralId: string,
  outcome: ReferralOutcome,
): Promise<void> {
  const { error } = await supabase.rpc('close_business_referral', {
    p_referral_id: referralId,
    p_outcome: outcome,
  })
  if (error) throw error
}

export async function withdrawBusinessReferral(referralId: string): Promise<void> {
  const { error } = await supabase.rpc('withdraw_business_referral', { p_referral_id: referralId })
  if (error) throw error
}
