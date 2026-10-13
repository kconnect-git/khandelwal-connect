import { supabase } from '../utils/supabase'
import type {
  AdminNoticeRow,
  MemberNoticeRow,
  NoticeAudience,
  NoticeStatus,
} from '../types/database'

// Phase 5c (0022): in-app notices. Member reads first, then the admin side
// (every admin RPC re-checks is_admin() on the server).

// ---------------------------------------------------------- member ----

export async function listMyNotices(
  params: { activeOnly?: boolean; limit?: number; offset?: number } = {},
): Promise<MemberNoticeRow[]> {
  const { data, error } = await supabase.rpc('list_my_notices', {
    p_active_only: params.activeOnly ?? false,
    p_limit: params.limit ?? 20,
    p_offset: params.offset ?? 0,
  })
  if (error) throw error
  return data ?? []
}

export async function noticeUnreadCount(): Promise<number> {
  const { data, error } = await supabase.rpc('notice_unread_count')
  if (error) throw error
  return data ?? 0
}

/** One notice, or every notice the member can see when no id is given. */
export async function markNoticesRead(noticeId?: string): Promise<void> {
  const { error } = await supabase.rpc('mark_notices_read', { p_notice_id: noticeId ?? null })
  if (error) throw error
}

// ----------------------------------------------------------- admin ----

export const EMPTY_AUDIENCE: NoticeAudience = { states: [], cities: [], gotras: [], occupations: [] }

function audienceArgs(audience: NoticeAudience) {
  return {
    p_states: audience.states,
    p_cities: audience.cities,
    p_gotras: audience.gotras,
    p_occupations: audience.occupations,
  }
}

export async function adminCountNoticeAudience(audience: NoticeAudience): Promise<number> {
  const { data, error } = await supabase.rpc('admin_count_notice_audience', audienceArgs(audience))
  if (error) throw error
  return Number(data ?? 0)
}

export async function adminListNotices(
  params: { status?: NoticeStatus | null; limit?: number; offset?: number } = {},
): Promise<AdminNoticeRow[]> {
  const { data, error } = await supabase.rpc('admin_list_notices', {
    p_status: params.status ?? null,
    p_limit: params.limit ?? 25,
    p_offset: params.offset ?? 0,
  })
  if (error) throw error
  return data ?? []
}

export async function adminGetNotice(noticeId: string): Promise<AdminNoticeRow | null> {
  const { data, error } = await supabase.rpc('admin_list_notices', {
    p_notice_id: noticeId,
    p_limit: 1,
  })
  if (error) throw error
  return data?.[0] ?? null
}

export type NoticeDraft = {
  title: string
  body: string
  audience: NoticeAudience
  /** ISO timestamp, or null for "until withdrawn". */
  expiresAt: string | null
}

/** Creates a draft when `noticeId` is null; returns the notice's id. */
export async function adminSaveNotice(noticeId: string | null, draft: NoticeDraft): Promise<string> {
  const { data, error } = await supabase.rpc('admin_save_notice', {
    p_notice_id: noticeId,
    p_title: draft.title,
    p_body: draft.body,
    ...audienceArgs(draft.audience),
    p_expires_at: draft.expiresAt,
  })
  if (error) throw error
  return data
}

export async function adminSetNoticeStatus(
  noticeId: string,
  status: 'published' | 'withdrawn',
): Promise<void> {
  const { error } = await supabase.rpc('admin_set_notice_status', {
    p_notice_id: noticeId,
    p_status: status,
  })
  if (error) throw error
}

export async function adminDeleteNotice(noticeId: string): Promise<void> {
  const { error } = await supabase.rpc('admin_delete_notice', { p_notice_id: noticeId })
  if (error) throw error
}

// --------------------------------------------------------- helpers ----

export function noticeAudience(row: AdminNoticeRow): NoticeAudience {
  return {
    states: row.audience_states,
    cities: row.audience_cities,
    gotras: row.audience_gotras,
    occupations: row.audience_occupations,
  }
}

/** "Everyone", or e.g. "Rajasthan, Delhi · Gotra: Bajargan · Business". */
export function audienceSummary(audience: NoticeAudience): string {
  const parts = [
    audience.states.join(', '),
    audience.cities.join(', '),
    audience.gotras.length > 0 ? `Gotra: ${audience.gotras.join(', ')}` : '',
    audience.occupations.join(', '),
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : 'Everyone'
}

/** An expiry picked as a calendar date means "through the end of that day"
 *  in the admin's own timezone. */
export function expiryFromDateInput(value: string): string | null {
  if (!value) return null
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day, 23, 59, 59).toISOString()
}

export function dateInputFromExpiry(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}
