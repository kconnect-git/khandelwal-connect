// Emails a member that they now have access to a paid service. Phase 11.2.
//
// Called by an admin's browser straight after admin_grant_service_access()
// succeeds, with only the new grant's id:
//   { grant_id: uuid }
//
// Everything the email says (service, end date, new vs extended) is read
// back from the database here, never taken from the request. Guards, in
// order:
//   1. the caller must be signed in (their JWT),
//   2. the caller must be in `admins` (checked with the service role),
//   3. the grant must exist, not be revoked and not have ended,
//   4. the member must still be approved,
//   5. the login email comes from auth.users via the service role.
//
// "Extended" = the grant starts in the future (it was chained onto access
// the member already had). The end date shown is the end of the whole run
// of grants for that service, so a second extension reads correctly.
//
// The caller treats a failure here as non-fatal: the grant is already
// committed, and the admin gets a Retry.
//
// Response: 200 { ok: true }, or 4xx/5xx { error }.
//
// Deploy with: supabase functions deploy send-access-granted
// Secrets: RESEND_API_KEY (same as the other senders), optional
// RESEND_FROM_ADDRESS and SITE_URL. SUPABASE_URL / SUPABASE_ANON_KEY /
// SUPABASE_SERVICE_ROLE_KEY are injected automatically.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.4'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const SITE_URL = (Deno.env.get('SITE_URL') ?? 'https://khandelwal-connect.vercel.app').replace(/\/$/, '')
const FROM_ADDRESS = Deno.env.get('RESEND_FROM_ADDRESS') ?? 'KITE <onboarding@resend.dev>'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const SERVICES: Record<string, { label: string; path: string; what: string }> = {
  directory: {
    label: 'Directory',
    path: '/directory',
    what: 'You can now see members’ full profiles and call or WhatsApp them.',
  },
  business: {
    label: 'Business',
    path: '/business',
    what: 'You can now contact businesses, send enquiries, post and respond in Buy & Sell, and read the enquiries on your dashboard.',
  },
  events: {
    label: 'Events',
    path: '/events',
    what: 'You can now create events and invite members.',
  },
  matrimony: {
    label: 'Matrimony',
    path: '/matrimony',
    what: 'You can now browse all matrimony profiles and send interests.',
  },
}

const DATE_FORMAT = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Asia/Kolkata',
})

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

type GrantRow = {
  id: string
  person_id: string
  service: string
  starts_at: string
  ends_at: string
  revoked_at: string | null
}

type PersonRow = {
  id: string
  full_name: string
  member_status: string
  auth_user_id: string | null
}

function buildEmail(
  person: PersonRow,
  service: (typeof SERVICES)[string],
  extended: boolean,
  runEndsAt: string,
): { subject: string; html: string } {
  const name = escapeHtml(person.full_name)
  const until = DATE_FORMAT.format(new Date(runEndsAt))
  const wrap = (inner: string) =>
    `<div style="font-family: sans-serif; font-size: 15px; line-height: 1.5; color: #1a1a1a;">${inner}</div>`

  const subject = extended
    ? `Your KITE ${service.label} access is extended`
    : `You now have KITE ${service.label} access`

  return {
    subject,
    html: wrap(`
      <p>Hi ${name},</p>
      <p>${
        extended
          ? `Your <strong>${service.label}</strong> access has been extended.`
          : `Your <strong>${service.label}</strong> access is now active.`
      } ${escapeHtml(service.what)}</p>
      <p><strong>Access until:</strong> ${until}</p>
      <p><a href="${SITE_URL}${service.path}" style="color: #FF4D2E; font-weight: 600;">Open ${service.label}</a></p>
      <p style="color: #666;">To renew, use Request access in the app before this date, or reply to the committee.</p>
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

  let body: { grant_id?: unknown }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request body' }, 400)
  }

  const grantId = typeof body.grant_id === 'string' ? body.grant_id : ''
  if (!UUID_PATTERN.test(grantId)) {
    return json({ error: 'Invalid grant id' }, 400)
  }

  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData, error: userError } = await callerClient.auth.getUser()
  if (userError || !userData.user) {
    return json({ error: 'Not authenticated' }, 401)
  }

  // The grant tables are RPC-only (no policies), as are admins and
  // auth.users -- service role, with the admin check first.
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

  const { data: grant, error: grantError } = await service
    .from('service_access_grants')
    .select('id, person_id, service, starts_at, ends_at, revoked_at')
    .eq('id', grantId)
    .maybeSingle<GrantRow>()
  if (grantError) {
    return json({ error: `Could not load the grant: ${grantError.message}` }, 500)
  }
  if (!grant) {
    return json({ error: 'Grant not found' }, 404)
  }
  const now = Date.now()
  if (grant.revoked_at || new Date(grant.ends_at).getTime() <= now) {
    return json({ error: 'This access has been removed or has ended' }, 409)
  }
  const serviceInfo = SERVICES[grant.service]
  if (!serviceInfo) {
    return json({ error: 'Unknown service' }, 422)
  }

  // End of the whole run (later extensions included), so the email never
  // shows an earlier date than the admin just saw.
  const { data: run, error: runError } = await service
    .from('service_access_grants')
    .select('ends_at')
    .eq('person_id', grant.person_id)
    .eq('service', grant.service)
    .is('revoked_at', null)
    .order('ends_at', { ascending: false })
    .limit(1)
    .maybeSingle<{ ends_at: string }>()
  if (runError) {
    return json({ error: `Could not load the access period: ${runError.message}` }, 500)
  }
  const runEndsAt = run?.ends_at ?? grant.ends_at

  const { data: person, error: personError } = await service
    .from('people')
    .select('id, full_name, member_status, auth_user_id')
    .eq('id', grant.person_id)
    .maybeSingle<PersonRow>()
  if (personError) {
    return json({ error: `Could not load the member: ${personError.message}` }, 500)
  }
  if (!person) {
    return json({ error: 'Member not found' }, 404)
  }
  if (person.member_status !== 'approved') {
    return json({ error: 'This member is no longer approved' }, 409)
  }
  if (!person.auth_user_id) {
    return json({ error: 'No account for this member' }, 422)
  }

  const { data: authUser, error: authError } = await service.auth.admin.getUserById(person.auth_user_id)
  const email = authUser?.user?.email
  if (authError || !email) {
    return json({ error: 'No email on file for this member' }, 422)
  }

  const extended = new Date(grant.starts_at).getTime() > now
  const { subject, html } = buildEmail(person, serviceInfo, extended, runEndsAt)

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
