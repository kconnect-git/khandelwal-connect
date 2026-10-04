import { supabase } from '../utils/supabase'
import type { EventCard } from './events'
import type { AdminMemberRow, AdminRoleName, EventStatus, MemberStatus } from '../types/database'
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
  limit?: number
  offset?: number
}): Promise<AdminEventRow[]> {
  const { data, error } = await supabase.rpc('admin_list_events', {
    p_status: params.status,
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
