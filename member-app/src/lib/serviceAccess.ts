import { supabase } from '../utils/supabase'
import type {
  AccessMonths,
  AccessRequestStatus,
  AdminAccessGrantRow,
  AdminAccessRequestRow,
  AdminMemberAccessRow,
  AdminServiceAccessRow,
  AdminServiceSettingRow,
  MyServiceAccessRow,
  PaidService,
} from '../types/database'

// Phase 11.1: paid-service access (0034). RPC-only. Payment is offline: the
// member requests access, the committee settles it by email, and an admin or
// moderator grants the service for 1, 3 or 12 months. Every paid rule is
// enforced server-side by has_service_access(); nothing here is a gate.

export const PAID_SERVICES: PaidService[] = ['directory', 'business', 'events', 'matrimony']

export const PAID_SERVICE_LABELS: Record<PaidService, string> = {
  directory: 'Directory',
  business: 'Business',
  events: 'Events',
  matrimony: 'Matrimony',
}

export const ACCESS_MONTH_OPTIONS: AccessMonths[] = [1, 3, 12]

export const ACCESS_REQUEST_MESSAGE_MAX = 500
export const ACCESS_NOTE_MAX = 500

export function accessMonthsLabel(months: AccessMonths): string {
  return months === 1 ? '1 month' : `${months} months`
}

// ---------------------------------------------------------------- member

export async function getMyServiceAccess(): Promise<MyServiceAccessRow[]> {
  const { data, error } = await supabase.rpc('my_service_access')
  if (error) throw error
  return data ?? []
}

export async function requestServiceAccess(service: PaidService, message?: string): Promise<void> {
  const { error } = await supabase.rpc('request_service_access', {
    p_service: service,
    p_message: message?.trim() || null,
  })
  if (error) throw error
}

// ---------------------------------------------------------------- admin reads

export async function adminListServiceSettings(): Promise<AdminServiceSettingRow[]> {
  const { data, error } = await supabase.rpc('admin_list_service_settings')
  if (error) throw error
  return data ?? []
}

export async function adminListAccessRequests(params: {
  status?: AccessRequestStatus
  service?: PaidService | null
  limit?: number
  offset?: number
}): Promise<AdminAccessRequestRow[]> {
  const { data, error } = await supabase.rpc('admin_list_access_requests', {
    p_status: params.status ?? 'open',
    p_service: params.service ?? null,
    p_limit: params.limit ?? 20,
    p_offset: params.offset ?? 0,
  })
  if (error) throw error
  return data ?? []
}

export async function adminListServiceAccess(params: {
  service?: PaidService | null
  expiringDays?: number | null
  limit?: number
  offset?: number
}): Promise<AdminServiceAccessRow[]> {
  const { data, error } = await supabase.rpc('admin_list_service_access', {
    p_service: params.service ?? null,
    p_expiring_days: params.expiringDays ?? null,
    p_limit: params.limit ?? 20,
    p_offset: params.offset ?? 0,
  })
  if (error) throw error
  return data ?? []
}

export async function adminMemberAccess(personId: string): Promise<AdminMemberAccessRow[]> {
  const { data, error } = await supabase.rpc('admin_member_access', { p_person_id: personId })
  if (error) throw error
  return data ?? []
}

export async function adminMemberAccessHistory(personId: string): Promise<AdminAccessGrantRow[]> {
  const { data, error } = await supabase.rpc('admin_member_access_history', {
    p_person_id: personId,
  })
  if (error) throw error
  return data ?? []
}

// ---------------------------------------------------------------- admin writes

/** Grant, or extend if the member already has access (the new period starts
 *  where the current one ends). Returns the new grant's id. */
export async function adminGrantServiceAccess(params: {
  personId: string
  service: PaidService
  months: AccessMonths
  note?: string
}): Promise<string> {
  const { data, error } = await supabase.rpc('admin_grant_service_access', {
    p_person_id: params.personId,
    p_service: params.service,
    p_months: params.months,
    p_note: params.note?.trim() || null,
  })
  if (error) throw error
  return data
}

export async function adminRevokeServiceAccess(params: {
  personId: string
  service: PaidService
  note?: string
}): Promise<void> {
  const { error } = await supabase.rpc('admin_revoke_service_access', {
    p_person_id: params.personId,
    p_service: params.service,
    p_note: params.note?.trim() || null,
  })
  if (error) throw error
}

export async function adminDismissAccessRequest(requestId: string, note?: string): Promise<void> {
  const { error } = await supabase.rpc('admin_dismiss_access_request', {
    p_request_id: requestId,
    p_note: note?.trim() || null,
  })
  if (error) throw error
}

/** Super admin only. */
export async function adminSetServiceEnforced(service: PaidService, enforced: boolean): Promise<void> {
  const { error } = await supabase.rpc('admin_set_service_enforced', {
    p_service: service,
    p_enforced: enforced,
  })
  if (error) throw error
}
