import { supabase } from '../utils/supabase'
import { invokeEdgeFunction } from './edgeFunctions'
import type { EventCardRow, EventStatus, EventVisibility } from '../types/database'

// Phase 4. Every read AND every write is an RPC (0018) -- unlike businesses,
// nothing here touches the tables directly. See 0018's header for why.

export type EventCard = EventCardRow
export type EventListPage = EventCard & { total_count: number }

export type MyEventRelation = 'created' | 'invited' | 'joined'
export type MyEvent = EventCard & {
  rejection_reason: string | null
  relation: MyEventRelation
}

export type EventDetail = EventCard & {
  rejection_reason: string | null
  approved_at: string | null
  created_at: string
  is_creator: boolean
  is_invited: boolean
  is_admin: boolean
  can_edit_all: boolean
  can_edit_description: boolean
  can_manage_invitees: boolean
}

export type EventInvitee = {
  person_id: string
  full_name: string
  profile_photo_url: string | null
  member_code: string
  emailed_at: string | null
  created_at: string
}

export type EventListMode = 'upcoming' | 'registered' | 'past'

export const EVENT_TABS: { key: EventListMode; label: string }[] = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'registered', label: 'Registered' },
  { key: 'past', label: 'Past' },
]

export const DEFAULT_EVENT_TAB: EventListMode = 'upcoming'

export function isEventListMode(value: string | null): value is EventListMode {
  return EVENT_TABS.some((tab) => tab.key === value)
}

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  pending: 'Pending approval',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
}

export const EVENT_VISIBILITY_LABELS: Record<EventVisibility, string> = {
  members: 'All members',
  invite_only: 'Invite only',
}

// ------------------------------------------------------------- form ----

/** Editable fields, as form strings. Dates are `datetime-local` values
 * (local wall-clock, no zone) and are converted at the RPC boundary. */
export type EventFormValues = {
  title: string
  description: string
  starts_at: string
  ends_at: string
  venue: string
  city: string
  state: string
  capacity: string
  visibility: EventVisibility
}

export const EMPTY_EVENT_FORM: EventFormValues = {
  title: '',
  description: '',
  starts_at: '',
  ends_at: '',
  venue: '',
  city: '',
  state: '',
  capacity: '',
  visibility: 'members',
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n)
}

/** ISO timestamp -> "YYYY-MM-DDTHH:MM" in the browser's local zone, the
 * value shape a datetime-local input wants. */
export function toDatetimeLocal(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** datetime-local value -> ISO (UTC) string, or null when blank. */
export function fromDatetimeLocal(local: string): string | null {
  const trimmed = local.trim()
  if (trimmed.length === 0) return null
  const d = new Date(trimmed)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export function eventToFormValues(event: EventDetail): EventFormValues {
  return {
    title: event.title,
    description: event.description ?? '',
    starts_at: toDatetimeLocal(event.starts_at),
    ends_at: toDatetimeLocal(event.ends_at),
    venue: event.venue ?? '',
    city: event.city ?? '',
    state: event.state ?? '',
    capacity: event.capacity === null ? '' : String(event.capacity),
    visibility: event.visibility,
  }
}

/** Mirrors check_event_fields (0018) so the user gets a readable message
 * before a round trip. `requireFuture` is false when editing an approved
 * event (only the description is sent, so the locked start time may already
 * be in the past). */
export function validateEvent(
  values: EventFormValues,
  options: { requireFuture?: boolean } = {},
): string | null {
  const { requireFuture = true } = options
  if (values.title.trim().length === 0) return 'Please give the event a title.'

  const starts = fromDatetimeLocal(values.starts_at)
  if (!starts) return 'Please pick a start date and time.'
  if (requireFuture && new Date(starts).getTime() <= Date.now()) {
    return 'The event must start in the future.'
  }

  const ends = fromDatetimeLocal(values.ends_at)
  if (ends && new Date(ends).getTime() < new Date(starts).getTime()) {
    return 'The end time must be after the start time.'
  }

  const capacity = values.capacity.trim()
  if (capacity.length > 0 && !/^\d+$/.test(capacity)) {
    return 'Capacity must be a whole number, or left blank.'
  }
  if (capacity.length > 0 && Number(capacity) <= 0) {
    return 'Capacity must be a positive number, or left blank.'
  }
  return null
}

function formValuesToArgs(values: EventFormValues) {
  const capacity = values.capacity.trim()
  return {
    p_title: values.title.trim(),
    p_description: values.description.trim() || null,
    p_starts_at: fromDatetimeLocal(values.starts_at),
    p_ends_at: fromDatetimeLocal(values.ends_at),
    p_venue: values.venue.trim() || null,
    p_city: values.city.trim() || null,
    p_state: values.state.trim() || null,
    p_capacity: capacity.length > 0 ? Number(capacity) : null,
    p_visibility: values.visibility,
  }
}

// ---------------------------------------------------------- display ----

const DATE_FORMAT = new Intl.DateTimeFormat('en-IN', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})
const TIME_FORMAT = new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit' })

/** "Sat, 14 Mar 2026 · 6:00 pm – 9:00 pm" (end omitted when blank; end
 * date shown only when it differs from the start date). */
export function formatEventWhen(event: { starts_at: string; ends_at: string | null }): string {
  const start = new Date(event.starts_at)
  if (Number.isNaN(start.getTime())) return ''
  let text = `${DATE_FORMAT.format(start)} · ${TIME_FORMAT.format(start)}`
  if (event.ends_at) {
    const end = new Date(event.ends_at)
    if (!Number.isNaN(end.getTime())) {
      const sameDay = start.toDateString() === end.toDateString()
      text += sameDay
        ? ` – ${TIME_FORMAT.format(end)}`
        : ` – ${DATE_FORMAT.format(end)} · ${TIME_FORMAT.format(end)}`
    }
  }
  return text
}

/** "Venue · City, State" for cards and subtitles. */
export function eventPlaceLine(event: {
  venue: string | null
  city: string | null
  state: string | null
}): string {
  const location = [event.city, event.state].filter(Boolean).join(', ')
  return [event.venue, location].filter(Boolean).join(' · ')
}

export function isEventEnded(event: { starts_at: string; ends_at: string | null }): boolean {
  const end = new Date(event.ends_at ?? event.starts_at)
  return !Number.isNaN(end.getTime()) && end.getTime() < Date.now()
}

export function isEventFull(event: { capacity: number | null; going_count: number }): boolean {
  return event.capacity !== null && event.going_count >= event.capacity
}

// ------------------------------------------------------------ reads ----

export async function listEvents(params: {
  mode: EventListMode
  limit?: number
  offset?: number
}): Promise<EventListPage[]> {
  const { data, error } = await supabase.rpc('list_events', {
    p_mode: params.mode,
    p_limit: params.limit ?? 20,
    p_offset: params.offset ?? 0,
  })
  if (error) throw error
  return data ?? []
}

export async function listMyEvents(): Promise<MyEvent[]> {
  const { data, error } = await supabase.rpc('list_my_events')
  if (error) throw error
  return data ?? []
}

export async function getEvent(eventId: string): Promise<EventDetail | null> {
  const { data, error } = await supabase.rpc('get_event', { p_event_id: eventId })
  if (error) throw error
  return data && data.length > 0 ? data[0] : null
}

export async function listEventInvitees(eventId: string): Promise<EventInvitee[]> {
  const { data, error } = await supabase.rpc('list_event_invitees', { p_event_id: eventId })
  if (error) throw error
  return data ?? []
}

// ----------------------------------------------------------- writes ----

/** Returns the new event's id. It lands as `pending`. */
export async function createEvent(values: EventFormValues): Promise<string> {
  const { data, error } = await supabase.rpc('save_event', formValuesToArgs(values))
  if (error) throw error
  return data
}

/** On an approved event the server keeps only the description; the rest of
 * the form is sent anyway so the call shape stays the same. */
export async function updateEvent(eventId: string, values: EventFormValues): Promise<void> {
  const { error } = await supabase.rpc('update_event', {
    p_event_id: eventId,
    ...formValuesToArgs(values),
  })
  if (error) throw error
}

export async function cancelEvent(eventId: string): Promise<void> {
  const { error } = await supabase.rpc('cancel_event', { p_event_id: eventId })
  if (error) throw error
}

/** Join or leave. Returns the live going count. */
export async function rsvpEvent(eventId: string, status: 'going' | 'not_going'): Promise<number> {
  const { data, error } = await supabase.rpc('rsvp_event', {
    p_event_id: eventId,
    p_status: status,
  })
  if (error) throw error
  return data ?? 0
}

export async function addEventInvitee(eventId: string, personId: string): Promise<void> {
  const { error } = await supabase.rpc('add_event_invitee', {
    p_event_id: eventId,
    p_person_id: personId,
  })
  if (error) throw error
}

export async function removeEventInvitee(eventId: string, personId: string): Promise<void> {
  const { error } = await supabase.rpc('remove_event_invitee', {
    p_event_id: eventId,
    p_person_id: personId,
  })
  if (error) throw error
}

export type SendEventInvitesResult = {
  sent: number
  failed: { person_id: string; reason: string }[]
}

/** Emails the given invitees a link to the event. The function checks the
 * caller is the creator, the event is approved, and each id is actually on
 * the invite list; it stamps emailed_at per row that went out. */
export async function sendEventInvites(params: {
  eventId: string
  personIds: string[]
}): Promise<SendEventInvitesResult> {
  return invokeEdgeFunction<SendEventInvitesResult>('send-event-invite', {
    event_id: params.eventId,
    person_ids: params.personIds,
  })
}
