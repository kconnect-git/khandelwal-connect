import { supabase } from '../utils/supabase'
import type { EventCard } from './events'
import type { EventStatus } from '../types/database'

// Phase 4: the bare minimum admin surface (event moderation). Phase 5's
// console builds on the same `admins` table + is_admin() (0018).

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
