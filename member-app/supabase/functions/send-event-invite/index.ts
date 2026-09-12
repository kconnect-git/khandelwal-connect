// Emails event invitees a link to the event page. Phase 4.
//
// Called by the organiser from the event page ("Send email" / "Email all
// not yet emailed"). Adding someone to the invite list never emails them on
// its own -- this is the explicit step. The request carries only ids:
//   { event_id: uuid, person_ids: uuid[] }        (1..50 ids)
// Recipients' addresses are resolved server-side, so the function can't be
// used as a general mailer:
//   1. the caller must be the event's creator (checked via their JWT),
//   2. the event must be `approved`,
//   3. every person_id must already be on event_invites for that event,
//   4. the login email comes from auth.users (people has no primary email
//      column -- only secondary_email), read with the service role via
//      auth.admin.getUserById(people.auth_user_id).
// Each row that goes out gets event_invites.emailed_at stamped so the
// "Email all not yet emailed" button can skip it next time.
//
// Response: 200 { sent: number, failed: [{ person_id, reason }] } -- a
// partial failure is still 200. 4xx/5xx { error } only for whole-request
// problems.
//
// Deploy with: supabase functions deploy send-event-invite
// Secrets: RESEND_API_KEY (same as send-family-invite), optional
// RESEND_FROM_ADDRESS and SITE_URL. SUPABASE_URL / SUPABASE_ANON_KEY /
// SUPABASE_SERVICE_ROLE_KEY are injected automatically.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.4'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const SITE_URL = (Deno.env.get('SITE_URL') ?? 'https://khandelwal-connect.vercel.app').replace(/\/$/, '')
const FROM_ADDRESS = Deno.env.get('RESEND_FROM_ADDRESS') ?? 'Khandelwal Connect <onboarding@resend.dev>'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const MAX_RECIPIENTS = 50
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function escapeHtml(str: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
  return str.replace(/[&<>"']/g, (c) => map[c])
}

const WHEN_FORMAT = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  dateStyle: 'medium',
  timeStyle: 'short',
})

function formatWhen(startsAt: string, endsAt: string | null): string {
  const start = WHEN_FORMAT.format(new Date(startsAt))
  if (!endsAt) return start
  return `${start} – ${WHEN_FORMAT.format(new Date(endsAt))}`
}

type EventRow = {
  id: string
  title: string
  starts_at: string
  ends_at: string | null
  venue: string | null
  city: string | null
  state: string | null
  status: string
  creator_id: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }
  if (!RESEND_API_KEY) {
    return json({ error: 'Server is missing RESEND_API_KEY' }, 500)
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return json({ error: 'Missing Authorization header' }, 401)
  }

  let body: { event_id?: unknown; person_ids?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request body' }, 400)
  }

  const eventId = typeof body.event_id === 'string' ? body.event_id : ''
  if (!UUID_PATTERN.test(eventId)) {
    return json({ error: 'Invalid event id' }, 400)
  }
  const rawIds = Array.isArray(body.person_ids) ? body.person_ids : []
  const personIds = [...new Set(rawIds.filter((v): v is string => typeof v === 'string' && UUID_PATTERN.test(v)))]
  if (personIds.length === 0 || personIds.length > MAX_RECIPIENTS) {
    return json({ error: `Send between 1 and ${MAX_RECIPIENTS} invitees at a time` }, 400)
  }

  // Who is calling? Scoped to their own session.
  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData, error: userError } = await callerClient.auth.getUser()
  if (userError || !userData.user) {
    return json({ error: 'Not authenticated' }, 401)
  }

  // Everything below reads across rows the caller can't see under RLS
  // (other members' people rows, auth.users) -- service role, with every
  // access gated by the creator check first.
  const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data: event, error: eventError } = await service
    .from('events')
    .select('id, title, starts_at, ends_at, venue, city, state, status, creator_id')
    .eq('id', eventId)
    .maybeSingle<EventRow>()
  if (eventError) {
    return json({ error: `Could not load the event: ${eventError.message}` }, 500)
  }
  if (!event) {
    return json({ error: 'Event not found' }, 404)
  }

  const { data: creator, error: creatorError } = await service
    .from('people')
    .select('auth_user_id, full_name')
    .eq('id', event.creator_id)
    .maybeSingle<{ auth_user_id: string | null; full_name: string }>()
  if (creatorError || !creator) {
    return json({ error: 'Could not load the organiser' }, 500)
  }
  if (creator.auth_user_id !== userData.user.id) {
    return json({ error: 'Only the organiser can email invitees' }, 403)
  }
  if (event.status !== 'approved') {
    return json({ error: 'Invitees can be emailed once the event is approved' }, 403)
  }

  const { data: invites, error: invitesError } = await service
    .from('event_invites')
    .select('id, person_id')
    .eq('event_id', eventId)
    .in('person_id', personIds)
  if (invitesError) {
    return json({ error: `Could not load the invite list: ${invitesError.message}` }, 500)
  }
  const inviteByPerson = new Map((invites ?? []).map((row) => [row.person_id as string, row.id as string]))

  const failed: { person_id: string; reason: string }[] = []
  let sent = 0

  const safeTitle = escapeHtml(event.title)
  const safeOrganiser = escapeHtml(creator.full_name)
  const safeWhen = escapeHtml(formatWhen(event.starts_at, event.ends_at))
  const place = [event.venue, [event.city, event.state].filter(Boolean).join(', ')].filter(Boolean).join(' · ')
  const safePlace = place ? escapeHtml(place) : ''
  const link = `${SITE_URL}/events/${event.id}`
  const subject = `${creator.full_name} invited you to ${event.title}`

  // Sequential on purpose: Resend's free tier rate-limits bursts, and a
  // list of a few dozen is fine one at a time.
  for (const personId of personIds) {
    const inviteId = inviteByPerson.get(personId)
    if (!inviteId) {
      failed.push({ person_id: personId, reason: 'not on the invite list' })
      continue
    }

    const { data: person } = await service
      .from('people')
      .select('auth_user_id, full_name')
      .eq('id', personId)
      .maybeSingle<{ auth_user_id: string | null; full_name: string }>()
    if (!person?.auth_user_id) {
      failed.push({ person_id: personId, reason: 'no account for this member' })
      continue
    }

    const { data: authUser, error: authError } = await service.auth.admin.getUserById(person.auth_user_id)
    const email = authUser?.user?.email
    if (authError || !email) {
      failed.push({ person_id: personId, reason: `${person.full_name}: no email on file` })
      continue
    }

    const html = `
      <div style="font-family: sans-serif; font-size: 15px; line-height: 1.5; color: #1a1a1a;">
        <p>Hi ${escapeHtml(person.full_name)},</p>
        <p><strong>${safeOrganiser}</strong> has invited you to <strong>${safeTitle}</strong>
        on Khandelwal Connect.</p>
        <p>
          <strong>When:</strong> ${safeWhen}<br>
          ${safePlace ? `<strong>Where:</strong> ${safePlace}<br>` : ''}
        </p>
        <p><a href="${link}" style="color: #FF4D2E; font-weight: 600;">View the event and RSVP</a></p>
        <p style="color: #666;">You're receiving this because a member invited you. If you weren't
        expecting it, you can safely ignore this email.</p>
      </div>
    `

    const resendResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: FROM_ADDRESS, to: [email], subject, html }),
    })

    if (!resendResponse.ok) {
      const errText = await resendResponse.text()
      failed.push({ person_id: personId, reason: `${person.full_name}: ${errText.slice(0, 200)}` })
      continue
    }

    await service.from('event_invites').update({ emailed_at: new Date().toISOString() }).eq('id', inviteId)
    sent += 1
  }

  return json({ sent, failed })
})
