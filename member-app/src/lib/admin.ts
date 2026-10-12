import { supabase } from '../utils/supabase'
import type { EventCard } from './events'
import type {
  AdminMemberDetail,
  AdminMemberExportRow,
  AdminMemberFilters,
  AdminBusinessRow,
  AdminListRow,
  AdminMemberRow,
  AdminOverviewStats,
  AdminRoleName,
  AdminSearchMemberRow,
  AuditLogRow,
  EventStatus,
  MemberStatus,
} from '../types/database'
import { invokeEdgeFunction } from './edgeFunctions'

// Phase 4: the bare minimum admin surface (event moderation). Phase 5a adds
// the member queue on the same `admins` table + is_admin() (0018/0019).

export type AdminEventRow = EventCard & { rejection_reason: string | null; total_count: number }

export async function isAdmin(): Promise<boolean> {
  const { data, error } = await supabase.rpc('is_admin')
  if (error) throw error
  return data === true
}

export async function adminListEvents(params: {
  status: EventStatus
  search?: string
  limit?: number
  offset?: number
}): Promise<AdminEventRow[]> {
  const { data, error } = await supabase.rpc('admin_list_events', {
    p_status: params.status,
    p_search: params.search?.trim() || null,
    p_limit: params.limit ?? 20,
    p_offset: params.offset ?? 0,
  })
  if (error) throw error
  return data ?? []
}

export async function adminSetEventStatus(
  eventId: string,
  status: 'approved' | 'rejected' | 'cancelled',
  reason?: string,
): Promise<void> {
  const { error } = await supabase.rpc('admin_set_event_status', {
    p_event_id: eventId,
    p_status: status,
    p_reason: reason?.trim() || null,
  })
  if (error) throw error
}

// ================================================================
// Phase 5a: member approval (0019)
// ================================================================

/** The three outcomes an admin can set. Distinct from MemberStatus, which
 *  also covers the two states only the member's own actions produce. */
export type AdminMemberDecision = Extract<MemberStatus, 'approved' | 'info_requested' | 'rejected'>

/** null when the caller isn't an admin at all. */
export async function adminRole(): Promise<AdminRoleName | null> {
  const { data, error } = await supabase.rpc('admin_role')
  if (error) throw error
  return (data as AdminRoleName | null) ?? null
}

export async function adminListMembers(params: {
  status: MemberStatus
  search?: string
  limit?: number
  offset?: number
}): Promise<AdminMemberRow[]> {
  const { data, error } = await supabase.rpc('admin_list_members', {
    p_status: params.status,
    p_search: params.search?.trim() || null,
    p_limit: params.limit ?? 20,
    p_offset: params.offset ?? 0,
  })
  if (error) throw error
  return data ?? []
}

export async function adminSetMemberStatus(
  personId: string,
  status: AdminMemberDecision,
  message?: string,
): Promise<void> {
  const { error } = await supabase.rpc('admin_set_member_status', {
    p_person_id: personId,
    p_status: status,
    p_message: message?.trim() || null,
  })
  if (error) throw error
}

// Called straight after adminSetMemberStatus. Deliberately separate and
// non-fatal at the call site: the review is already committed, and the member
// sees their status in the app whether or not the email lands. The function
// reads the admin's note and the member code out of the row itself, so
// nothing about the message travels through the client.
export async function sendMemberStatusEmail(
  personId: string,
  status: AdminMemberDecision,
): Promise<void> {
  await invokeEdgeFunction<{ ok: true }>('send-member-status', {
    person_id: personId,
    status,
  })
}

/** Re-sends the email for the member's current status -- the "Resend" button
 *  and the Retry after a failed send. send-member-status refuses (409) unless
 *  the row's status still matches, so this can't announce a stale decision. */
export async function resendMemberStatusEmail(
  personId: string,
  currentStatus: MemberStatus,
): Promise<void> {
  if (!isAdminDecision(currentStatus)) {
    throw new Error('There is no status email for a member in this state.')
  }
  await sendMemberStatusEmail(personId, currentStatus)
}

export function isAdminDecision(status: MemberStatus): status is AdminMemberDecision {
  return status === 'approved' || status === 'info_requested' || status === 'rejected'
}

// ================================================================
// Phase 5b-1: admin console (0020)
// ================================================================

function filterArgs(filters: AdminMemberFilters) {
  return {
    p_status: filters.status ?? null,
    p_search: filters.search?.trim() || null,
    p_state: filters.state ?? null,
    p_city: filters.city ?? null,
    p_gotra: filters.gotra ?? null,
    p_occupation: filters.occupation ?? null,
  }
}

export async function adminSearchMembers(
  filters: AdminMemberFilters,
  page: { limit?: number; offset?: number } = {},
): Promise<AdminSearchMemberRow[]> {
  const { data, error } = await supabase.rpc('admin_search_members', {
    ...filterArgs(filters),
    p_limit: page.limit ?? 25,
    p_offset: page.offset ?? 0,
  })
  if (error) throw error
  return data ?? []
}

export type AdminMemberFilterOptions = { states: string[]; cities: string[]; gotras: string[] }

export async function adminMemberFilterOptions(): Promise<AdminMemberFilterOptions> {
  const { data, error } = await supabase.rpc('admin_member_filter_options')
  if (error) throw error
  const options: AdminMemberFilterOptions = { states: [], cities: [], gotras: [] }
  for (const row of data ?? []) {
    if (row.kind === 'state') options.states.push(row.value)
    else if (row.kind === 'city') options.cities.push(row.value)
    else if (row.kind === 'gotra') options.gotras.push(row.value)
  }
  return options
}

/** Super admin only; the RPC raises otherwise and audits every call. */
export async function adminExportMembers(
  filters: AdminMemberFilters,
): Promise<AdminMemberExportRow[]> {
  const { data, error } = await supabase.rpc('admin_export_members', filterArgs(filters))
  if (error) throw error
  return data ?? []
}

export async function adminGetMember(personId: string): Promise<AdminMemberDetail | null> {
  const { data, error } = await supabase.rpc('admin_get_member', { p_person_id: personId })
  if (error) throw error
  return data ?? null
}

export async function adminListAuditLog(
  params: { targetId?: string; actionPrefix?: string; limit?: number; offset?: number } = {},
): Promise<AuditLogRow[]> {
  const { data, error } = await supabase.rpc('admin_list_audit_log', {
    p_target_id: params.targetId ?? null,
    p_action_prefix: params.actionPrefix ?? null,
    p_limit: params.limit ?? 20,
    p_offset: params.offset ?? 0,
  })
  if (error) throw error
  return data ?? []
}

export async function adminOverviewStats(): Promise<AdminOverviewStats | null> {
  const { data, error } = await supabase.rpc('admin_overview_stats')
  if (error) throw error
  return data ?? null
}

/** Human wording for audit actions. Unknown actions fall back to the raw
 *  string, so a 5b-2 action logged before the UI knows it still reads. */
const AUDIT_ACTION_LABELS: Record<string, string> = {
  member_approved: 'Approved member',
  member_info_requested: 'Asked for more information',
  member_rejected: 'Turned down member',
  event_approved: 'Approved event',
  event_rejected: 'Rejected event',
  event_cancelled: 'Cancelled event',
  members_export: 'Exported members CSV',
  business_hidden: 'Hid business listing',
  business_unhidden: 'Unhid business listing',
  admin_granted: 'Made admin',
  admin_role_changed: 'Changed admin role',
  admin_revoked: 'Removed admin',
}

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action.replace(/_/g, ' ')
}

/** Where an audit row's target lives in the app, if anywhere. */
export function auditTargetHref(row: Pick<AuditLogRow, 'target_type' | 'target_id'>): string | null {
  if (!row.target_id) return null
  if (row.target_type === 'person') return `/admin/members/${row.target_id}`
  if (row.target_type === 'event') return `/events/${row.target_id}`
  // Hidden listings 404 on the member-facing page, so audit rows point at
  // the console's list instead.
  if (row.target_type === 'business') return '/admin/businesses'
  return null
}

const DATE_FORMAT = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' })
const DATE_TIME_FORMAT = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' })

export function formatAdminDate(iso: string | null): string | null {
  return iso ? DATE_FORMAT.format(new Date(iso)) : null
}

export function formatAdminDateTime(iso: string | null): string | null {
  return iso ? DATE_TIME_FORMAT.format(new Date(iso)) : null
}

// ================================================================
// Phase 5b-2: moderation + admin management (0021)
// ================================================================

export async function adminListBusinesses(params: {
  hidden?: boolean | null
  search?: string
  category?: string | null
  limit?: number
  offset?: number
}): Promise<AdminBusinessRow[]> {
  const { data, error } = await supabase.rpc('admin_list_businesses', {
    p_hidden: params.hidden ?? null,
    p_search: params.search?.trim() || null,
    p_category: params.category ?? null,
    p_limit: params.limit ?? 25,
    p_offset: params.offset ?? 0,
  })
  if (error) throw error
  return data ?? []
}

export async function adminSetBusinessHidden(
  businessId: string,
  hidden: boolean,
  reason?: string,
): Promise<void> {
  const { error } = await supabase.rpc('admin_set_business_hidden', {
    p_business_id: businessId,
    p_hidden: hidden,
    p_reason: reason?.trim() || null,
  })
  if (error) throw error
}

export async function adminListAdmins(): Promise<AdminListRow[]> {
  const { data, error } = await supabase.rpc('admin_list_admins')
  if (error) throw error
  return data ?? []
}

/** The writes below are super_admin only and refuse acting on yourself. */
export async function adminGrant(personId: string, role: AdminRoleName): Promise<void> {
  const { error } = await supabase.rpc('admin_grant', { p_person_id: personId, p_role: role })
  if (error) throw error
}

export async function adminSetRole(authUserId: string, role: AdminRoleName): Promise<void> {
  const { error } = await supabase.rpc('admin_set_role', {
    p_auth_user_id: authUserId,
    p_role: role,
  })
  if (error) throw error
}

export async function adminRevoke(authUserId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_revoke', { p_auth_user_id: authUserId })
  if (error) throw error
}

export const ADMIN_ROLE_LABELS: Record<AdminRoleName, string> = {
  super_admin: 'Super admin',
  moderator: 'Moderator',
}
