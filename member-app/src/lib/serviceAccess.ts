import { supabase } from '../utils/supabase'
import { invokeEdgeFunction } from './edgeFunctions'
import type {
  AccessMonths,
  AccessRequestStatus,
  AdminAccessGrantRow,
  AdminAccessRequestRow,
  AdminMemberAccessRow,
  AdminServiceAccessRow,
  AdminServiceSettingRow,
  MyAccessNewsRow,
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

/** (11.2) Whether a service's gated RPCs and locked UI have shipped
 *  (11.4 Directory, 11.5 Business, 11.6 Events, 11.7 Matrimony). The admin
 *  page won't offer "Turn on" until then: a switch with nothing behind it
 *  would lock nothing. Flip each one in the sub-phase that gates it. */
export const PAYWALL_READY: Record<PaidService, boolean> = {
  directory: true,
  business: true,
  events: false,
  matrimony: false,
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

/** (11.3) Unseen live grants, one row per service, for the Home card. */
export async function getMyAccessNews(): Promise<MyAccessNewsRow[]> {
  const { data, error } = await supabase.rpc('my_access_news')
  if (error) throw error
  return data ?? []
}

/** (11.3) Hide the Home card for that service until the next grant. */
export async function dismissAccessNews(service: PaidService): Promise<void> {
  const { error } = await supabase.rpc('dismiss_access_news', { p_service: service })
  if (error) throw error
}

/** (11.3) What each paid service unlocks, for the member-facing cards. */
export const PAID_SERVICE_UNLOCKS: Record<PaidService, string> = {
  directory: 'Call or WhatsApp members, see full profiles, combine filters, and open as many profiles as you like.',
  business: 'Contact businesses, send enquiries, post and respond in Buy & Sell, and read your dashboard enquiries.',
  events: 'Create events and invite members.',
  matrimony: 'Browse every matrimony profile and send interests.',
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

/** (11.2) Emails the member about a grant. The function re-reads the grant
 *  and member from the database; a failure doesn't undo the grant. */
export async function sendAccessGrantedEmail(grantId: string): Promise<void> {
  await invokeEdgeFunction<{ ok: true }>('send-access-granted', { grant_id: grantId })
}

/** Where the member-facing app keeps each service. */
export const PAID_SERVICE_PATHS: Record<PaidService, string> = {
  directory: '/directory',
  business: '/business',
  events: '/events',
  matrimony: '/matrimony',
}

/** When a grant of `months` made now would end, mirroring
 *  admin_grant_service_access: it starts where current access ends. */
export function previewAccessEnd(currentEndsAt: string | null, months: AccessMonths): Date {
  const now = new Date()
  const current = currentEndsAt ? new Date(currentEndsAt) : null
  const start = current && current > now ? current : now
  const end = new Date(start)
  end.setMonth(end.getMonth() + months)
  // Postgres clamps 31 Jan + 1 month to 28 Feb; JS rolls over to 3 Mar.
  if (end.getDate() !== start.getDate()) end.setDate(0)
  return end
}

/** Super admin only. */
export async function adminSetServiceEnforced(service: PaidService, enforced: boolean): Promise<void> {
  const { error } = await supabase.rpc('admin_set_service_enforced', {
    p_service: service,
    p_enforced: enforced,
  })
  if (error) throw error
}
