// Sends a plain notification email via Resend -- no Supabase auth account is
// created, nothing is written to any table. The invited person shows up in
// auth/people the normal way, whenever they actually choose to sign up.
//
// Deploy with: supabase functions deploy send-family-invite
// Requires the RESEND_API_KEY secret (reuse the same key already used for
// this project's SMTP-based OTP emails -- see the setup notes for exact
// commands). SUPABASE_URL and SUPABASE_ANON_KEY are injected automatically.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.4'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://khandelwal-connect.vercel.app'
const FROM_ADDRESS = Deno.env.get('RESEND_FROM_ADDRESS') ?? 'Khandelwal Connect <onboarding@resend.dev>'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

const VALID_SLOTS = ['father', 'mother', 'spouse', 'maternal_uncle', 'spouse_father', 'spouse_mother', 'child']

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

// Relation as seen from the invited person's side. slot is stated from the
// inviter's point of view ("father" = "this person is my father"), so the
// label the recipient reads has to be inverted, and gendered by the
// inviter's own gender where that distinction exists.
function recipientRelationLabel(slot: string, inviterGender: string | null): string {
  const g = (inviterGender ?? '').trim().toLowerCase()
  switch (slot) {
    case 'father':
    case 'mother':
      return g === 'male' ? 'son' : g === 'female' ? 'daughter' : 'child'
    case 'spouse':
      return g === 'male' ? 'husband' : g === 'female' ? 'wife' : 'spouse'
    case 'maternal_uncle':
      return g === 'male' ? 'nephew' : g === 'female' ? 'niece' : "sister's child"
    case 'spouse_father':
    case 'spouse_mother':
      return g === 'male' ? 'son-in-law' : g === 'female' ? 'daughter-in-law' : 'child-in-law'
    case 'child':
      return g === 'male' ? 'father' : g === 'female' ? 'mother' : 'parent'
    default:
      return 'family member'
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

  let body: { slot?: string; email?: string }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'Invalid request body' }, 400)
  }

  const { slot, email } = body
  if (!slot || !VALID_SLOTS.includes(slot)) {
    return json({ error: 'Invalid slot' }, 400)
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return json({ error: 'Invalid email address' }, 400)
  }

  // Scoped to the caller's own session -- RLS applies normally, so this can
  // only ever read the calling user's own row.
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })

  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) {
    return json({ error: 'Not authenticated' }, 401)
  }

  const { data: self, error: selfError } = await supabase
    .from('people')
    .select('full_name, gender')
    .eq('auth_user_id', userData.user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (selfError || !self) {
    return json({ error: 'No person row for the current user' }, 400)
  }

  const relationLabel = recipientRelationLabel(slot, self.gender)
  const safeName = escapeHtml(self.full_name)
  const subject = `${self.full_name} invited you to join Khandelwal Connect`
  const html = `
    <div style="font-family: sans-serif; font-size: 15px; line-height: 1.5; color: #1a1a1a;">
      <p>Hey,</p>
      <p><strong>${safeName}</strong>, your ${relationLabel}, has invited you to join
      <strong>Khandelwal Connect</strong> — a community platform connecting Khandelwal families
      across India and beyond, including family trees, a member directory, and community events.</p>
      <p><a href="${SITE_URL}" style="color: #FF4D2E; font-weight: 600;">Visit Khandelwal Connect</a></p>
      <p style="color: #666;">If you weren't expecting this, you can safely ignore this email.</p>
    </div>
  `

  const resendResponse = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: [email],
      subject,
      html,
    }),
  })

  if (!resendResponse.ok) {
    const errText = await resendResponse.text()
    return json({ error: `Failed to send email: ${errText}` }, 502)
  }

  return json({ ok: true })
})
