// Emails a member the outcome of their membership review. Phase 5a.
//
// Called by an admin from the member queue, straight after
// admin_set_member_status() succeeds. The request carries only an id and the
// status the admin just set:
//   { person_id: uuid, status: 'approved' | 'info_requested' | 'rejected' }
//
// Deliberately no message in the body -- the admin's note and the member code
// are read back out of the row here, so the email can never say something the
// database doesn't. Guards, in order:
//   1. the caller must be signed in (their JWT),
//   2. the caller must be in `admins` (checked with the service role -- this
//      function's own is_admin(), never a flag from the client),
//   3. the person must exist,
//   4. their member_status must still equal the status being announced, so a
//      stale or replayed call can't email an outcome that has since changed,
//   5. the login email comes from auth.users (people has no primary email
//      column -- only secondary_email), read with the service role via
//      auth.admin.getUserById(people.auth_user_id).
//
// The caller treats a failure here as non-fatal: the review itself is already
// committed, and the member sees their status in the app either way.
//
// Response: 200 { ok: true }, or 4xx/5xx { error }.
//
// Deploy with: supabase functions deploy send-member-status
// Secrets: RESEND_API_KEY (same as the other two senders), optional
// RESEND_FROM_ADDRESS and SITE_URL. SUPABASE_URL / SUPABASE_ANON_KEY /
// SUPABASE_SERVICE_ROLE_KEY are injected automatically.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.4'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const SITE_URL = (Deno.env.get('SITE_URL') ?? 'https://khandelwal-connect.vercel.app').replace(/\/$/, '')
const FROM_ADDRESS = Deno.env.get('RESEND_FROM_ADDRESS') ?? 'Khandelwal Connect <onboarding@resend.dev>'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const STATUSES = ['approved', 'info_requested', 'rejected'] as const
type Status = (typeof STATUSES)[number]

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

// The admin's note is plain text typed into a textarea; keep its line breaks.
function escapeParagraph(str: string): string {
  return escapeHtml(str).replace(/\r?\n/g, '<br>')
}

type PersonRow = {
  id: string
  full_name: string
  member_code: string | null
  member_status: string
  admin_message: string | null
  auth_user_id: string | null
}

function buildEmail(person: PersonRow, status: Status): { subject: string; html: string } {
  const name = escapeHtml(person.full_name)
  const note = person.admin_message ? escapeParagraph(person.admin_message) : ''
  const wrap = (inner: string) =>
    `<div style="font-family: sans-serif; font-size: 15px; line-height: 1.5; color: #1a1a1a;">${inner}</div>`

  if (status === 'approved') {
    return {
      subject: 'Your Khandelwal Connect membership is approved',
      html: wrap(`
        <p>Hi ${name},</p>
        <p>Your membership has been approved. You now have full access to the
        member directory, businesses and events.</p>
        ${person.member_code ? `<p><strong>Your member ID:</strong> ${escapeHtml(person.member_code)}</p>` : ''}
        <p><a href="${SITE_URL}/dashboard" style="color: #FF4D2E; font-weight: 600;">Open Khandelwal Connect</a></p>
      `),
    }
  }

  if (status === 'info_requested') {
    return {
      subject: 'More information needed for your Khandelwal Connect membership',
      html: wrap(`
        <p>Hi ${name},</p>
        <p>Before your membership can be approved, we need a little more
        information:</p>
        <blockquote style="margin: 16px 0; padding: 12px 16px; border-left: 3px solid #FF4D2E; background: #faf7f5;">
          ${note}
        </blockquote>
        <p>Update your profile and send it back for review.</p>
        <p><a href="${SITE_URL}/pending" style="color: #FF4D2E; font-weight: 600;">Review your profile</a></p>
      `),
    }
  }

  return {
    subject: 'About your Khandelwal Connect membership',
    html: wrap(`
      <p>Hi ${name},</p>
      <p>Your membership application was not approved.</p>
      ${note ? `<blockquote style="margin: 16px 0; padding: 12px 16px; border-left: 3px solid #999; background: #f6f6f6;">${note}</blockquote>` : ''}
      <p style="color: #666;">If you think this is a mistake, please get in touch
      with your mandal and they can look at it again.</p>
    `),
  }
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

  let body: { person_id?: unknown; status?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request body' }, 400)
  }

  const personId = typeof body.person_id === 'string' ? body.person_id : ''
  if (!UUID_PATTERN.test(personId)) {
    return json({ error: 'Invalid member id' }, 400)
  }
  const status = STATUSES.find((s) => s === body.status)
  if (!status) {
    return json({ error: 'Invalid status' }, 400)
  }

  // Who is calling? Scoped to their own session.
  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData, error: userError } = await callerClient.auth.getUser()
  if (userError || !userData.user) {
    return json({ error: 'Not authenticated' }, 401)
  }

  // Everything below reads rows the caller can't see under RLS (another
  // member's people row, admins, auth.users) -- service role, with the admin
  // check first.
  const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data: admin, error: adminError } = await service
    .from('admins')
    .select('auth_user_id')
    .eq('auth_user_id', userData.user.id)
    .maybeSingle<{ auth_user_id: string }>()
  if (adminError) {
    return json({ error: `Could not check admin access: ${adminError.message}` }, 500)
  }
  if (!admin) {
    return json({ error: 'Not an admin' }, 403)
  }

  const { data: person, error: personError } = await service
    .from('people')
    .select('id, full_name, member_code, member_status, admin_message, auth_user_id')
    .eq('id', personId)
    .maybeSingle<PersonRow>()
  if (personError) {
    return json({ error: `Could not load the member: ${personError.message}` }, 500)
  }
  if (!person) {
    return json({ error: 'Member not found' }, 404)
  }
  if (person.member_status !== status) {
    return json({ error: 'This member\'s status has changed since the review' }, 409)
  }
  if (!person.auth_user_id) {
    return json({ error: 'No account for this member' }, 422)
  }

  const { data: authUser, error: authError } = await service.auth.admin.getUserById(person.auth_user_id)
  const email = authUser?.user?.email
  if (authError || !email) {
    return json({ error: 'No email on file for this member' }, 422)
  }

  const { subject, html } = buildEmail(person, status)

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
    return json({ error: `Could not send the email: ${errText.slice(0, 200)}` }, 502)
  }

  return json({ ok: true })
})
