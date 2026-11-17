// Emails "your access ends in N days" reminders. Phase 11.8.
//
// Called once a day by pg_cron (0040: job 'access-expiry-reminders', 09:00
// IST) via pg_net, with no user session. Deploy with --no-verify-jwt; the
// caller proves itself with the x-reminder-secret header instead, which is
// checked against the secret 0040 generated in Vault
// (access_reminder_secret_ok, service_role only). The secret is never
// stored anywhere else.
//
// For each row of access_reminders_due() (last grant of a run, ending within
// 5 days, not yet reminded, service paywall on, member approved) it sends an
// email through Resend and then stamps reminded_at via mark_access_reminded.
// A failed send is left unstamped, so the next day's run retries it.
//
// Response: 200 { due, sent, failed }, or 4xx/5xx { error }.
//
// Deploy with:
//   npx supabase functions deploy send-access-expiring --no-verify-jwt --project-ref <ref>
// Secrets: RESEND_API_KEY (same as the other senders), optional
// RESEND_FROM_ADDRESS and SITE_URL. SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
// are injected automatically.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.4'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const SITE_URL = (Deno.env.get('SITE_URL') ?? 'https://khandelwal-connect.vercel.app').replace(/\/$/, '')
const FROM_ADDRESS = Deno.env.get('RESEND_FROM_ADDRESS') ?? 'KITE <onboarding@resend.dev>'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const SERVICE_LABELS: Record<string, string> = {
  directory: 'Directory',
  business: 'Business',
  events: 'Events',
  matrimony: 'Matrimony',
}

const DATE_FORMAT = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Asia/Kolkata',
})

const DAY_MS = 24 * 60 * 60 * 1000

type DueRow = {
  grant_id: string
  person_id: string
  full_name: string
  email: string | null
  service: string
  ends_at: string
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function escapeHtml(str: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
  return str.replace(/[&<>"']/g, (c) => map[c])
}

function buildEmail(row: DueRow): { subject: string; html: string } {
  const label = SERVICE_LABELS[row.service] ?? row.service
  const until = DATE_FORMAT.format(new Date(row.ends_at))
  const days = Math.max(1, Math.ceil((new Date(row.ends_at).getTime() - Date.now()) / DAY_MS))
  const when = days === 1 ? 'tomorrow' : `in ${days} days`
  return {
    subject: `Your KITE ${label} access ends ${when}`,
    html: `<div style="font-family: sans-serif; font-size: 15px; line-height: 1.5; color: #1a1a1a;">
      <p>Hi ${escapeHtml(row.full_name)},</p>
      <p>Your <strong>${label}</strong> access ends on <strong>${until}</strong>.</p>
      <p>To keep it, open <strong>Profile → My access</strong> and tap <strong>Request renewal</strong>,
      or reply to the committee's email. Anything you already have (matches, events you created,
      your listings) keeps working after it ends.</p>
      <p><a href="${SITE_URL}/profile" style="color: #FF4D2E; font-weight: 600;">Open My access</a></p>
    </div>`,
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }
  if (!RESEND_API_KEY) {
    return json({ error: 'Server is missing RESEND_API_KEY' }, 500)
  }

  const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const secret = req.headers.get('x-reminder-secret') ?? ''
  const { data: ok, error: secretError } = await service.rpc('access_reminder_secret_ok', {
    p_secret: secret,
  })
  if (secretError) {
    return json({ error: `Could not check the caller: ${secretError.message}` }, 500)
  }
  if (!ok) {
    return json({ error: 'Not allowed' }, 401)
  }

  const { data: due, error: dueError } = await service.rpc('access_reminders_due')
  if (dueError) {
    return json({ error: `Could not load reminders: ${dueError.message}` }, 500)
  }
  const rows = (due ?? []) as DueRow[]

  const sent: string[] = []
  let failed = 0
  for (const row of rows) {
    if (!row.email) {
      failed += 1
      console.error(`[send-access-expiring] no email for person ${row.person_id}`)
      continue
    }
    const { subject, html } = buildEmail(row)
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM_ADDRESS, to: [row.email], subject, html }),
    })
    if (response.ok) {
      sent.push(row.grant_id)
    } else {
      failed += 1
      console.error(
        `[send-access-expiring] Resend failed for grant ${row.grant_id}: ${(await response.text()).slice(0, 200)}`,
      )
    }
  }

  if (sent.length > 0) {
    const { error: markError } = await service.rpc('mark_access_reminded', { p_grant_ids: sent })
    if (markError) {
      // The emails went; without the stamp they'd go again tomorrow.
      return json({ error: `Sent ${sent.length} but could not record them: ${markError.message}` }, 500)
    }
  }

  return json({ due: rows.length, sent: sent.length, failed })
})
