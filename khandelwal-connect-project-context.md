# Khandelwal Connect — Project Context & Build Plan

This document captures all product, design, and technical decisions made during planning, for handoff to a development session (Claude Code or a developer). Read this fully before writing code.

---

## 0. Current status (read this first)

**Phase 0 backend setup is complete.** The Supabase project already exists and is configured. Do not recreate any of the following — connect to what's already there:

- ✅ Supabase project created (region: Singapore, closest to India-based users)
- ✅ Email auth enabled, custom SMTP connected via **Resend** (host `smtp.resend.com`, port 465, username `resend`, sender currently on Resend's shared test domain — should move to a verified custom domain before real users sign up)
- ✅ OTP email template edited so `{{ .Token }}` (the 6-digit code) is the primary content, with the magic-link `{{ .ConfirmationURL }}` demoted to a small fallback link
- ✅ API keys: using the **new Publishable/Secret key format** (not legacy anon/service_role — Supabase is deprecating legacy keys by end of 2026). Publishable key goes in the frontend `.env`; secret key is reserved for server-side code only (Edge Functions, admin backend) and has not been used client-side anywhere
- ✅ Core schema created in the SQL editor (all 8 tables from Section 6: `people`, `businesses`, `events`, `rsvps`, `matrimony_profiles`, `matrimony_interests`, `dues`, `admin_audit_log`)
- ✅ RLS enabled on every table, with placeholder policies on `people` (self-read/update/insert only). Every other table is fully locked down — no policies written yet, intentionally, until each feature is built
- ✅ "Automatically expose new tables" turned OFF, "Enable automatic RLS" turned ON in project API settings — so any new table created later starts locked down by default
- ✅ Storage buckets created (`profile-photos`, `business-media`, `matrimony-photos`, `kyc-documents`) with SQL policies applied (public read for photos/media, owner-only upload via `{user_id}/filename` path convention, `kyc-documents` has no public read policy at all)
- ✅ `@supabase/supabase-js` installed in a scaffolded project, `.env` with `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` set, `utils/supabase.ts` client created
- ⏳ Sanity check in progress: confirming a `select()` against `people` from the client returns an empty array (not an error) when logged out — validates RLS + client wiring before building further

**Not yet started (this is where a new session should pick up):**
- Real Vite/React app shell — current `App.tsx` is still Supabase's generic `todos` demo, not the actual app
- Dark vermilion design tokens as CSS variables, Archivo + Hanken Grotesk fonts loaded
- Signup flow UI (3-step form) wired to real `people` table inserts
- Email OTP login screen — **note**: needs an actual 6-digit code input field, which is not shown in the original design docs (those were designed around magic-link-style flows). Add this as a new screen/step in the login flow
- Light/dark mode toggle
- Empty/basic Home dashboard shell
- First deploy to Vercel or Netlify

**Immediate next step:** scaffold the real app (design tokens, fonts, routing) and build the signup → OTP entry → empty dashboard flow. This is Phase 0's remaining exit criteria.

---

## 1. What this app is

A community platform for the Khandelwal family/caste network, connecting members across India (and diaspora) for:
- **Family tree** — recursive genealogy (parents, grandparents, spouse, children, siblings)
- **Directory** — searchable member list, filterable by mandal/gotra/profession
- **Business & jobs network** — member business profiles, distributors, investors
- **Events** — community events with RSVP
- **Matrimony** — family-verified profiles, consent-gated contact sharing
- **Admin console** — membership approvals, dues tracking, notices, audit log

Two source design documents were reviewed:
1. `Khandelwal Connect (signup)` — signup flow (3-step) + family tree sub-screens (Navy/Coral theme, early direction)
2. `Khandelwal Connects app design` — full member app (6 mobile screens) + admin console (3 desktop screens), plus an appendix with an alternate "warm traditional" direction

**Decision:** we are building on the **dark vermilion** direction from the main design doc (not the warm traditional appendix, not the navy/coral from the signup doc). Accent color `#FF4D2E`, near-black dark surfaces as default, with a light/dark toggle for accessibility (see Section 4).

---

## 2. Platform strategy

- **Build once as a PWA** (Progressive Web App) — works as a website, installs to home screen on mobile and desktop, feels native (own icon, full-screen, offline support, push notifications), zero app store fees or review delay.
- **Admin console** is a separate web app (desktop-first), not part of the installable PWA — it's a data-table-heavy dashboard, better suited to a browser tab.
- **Future**: wrap the same PWA codebase in Capacitor or React Native/Expo to publish to the App Store / Play Store once the product is stable. Not a rewrite — an additive step.

---

## 3. Tech stack (chosen to be free at ~500 users)

| Layer | Choice | Why |
|---|---|---|
| Backend | **Supabase** (Postgres + Auth + Storage + Edge Functions) | Relational data model fits the family graph; Row Level Security enforces privacy at the DB layer; free tier covers 500 users comfortably (50k MAU, 500MB DB, 1GB storage) |
| Member app | **React + Vite (or Next.js)**, PWA | One codebase, installable, free hosting |
| Admin console | **Next.js** on Vercel | Free hosting, separate deploy from member app |
| Auth | **Email OTP** via Supabase built-in auth (see Section 5) | Free, no SMS provider cost (phone OTP was considered and rejected — costs money per message) |
| Email delivery | **Resend** (free tier: 3,000 emails/month) or **Brevo** (300/day free) | Supabase's default email sending is rate-limited/testing-only; need real SMTP before launch |
| Push notifications | **Firebase Cloud Messaging** | Free, unlimited, works alongside Supabase backend |
| Payments/dues | **Razorpay** (or similar) | Pay-per-transaction, no fixed cost |
| Fonts | **Archivo** (headings) + **Hanken Grotesk** (body) | Free Google Fonts, no license needed. Load via Google Fonts CDN initially; self-host later for PWA offline performance |

**Estimated cost at 500 users: $0–10/month**, mainly photo storage headroom.

---

## 4. Visual design system

- **Direction**: Dark vermilion (modern). Near-black background as default, `#FF4D2E` as accent only (CTAs, active states, badges) — never as body text color (fails contrast on black).
- **Light/dark toggle**: required, not optional. Default to dark, but make switching one tap, always in the same header location — important because the user base spans generations and some users will find dark-only UI hard to read.
- **Typography**: Archivo (bold, numerals, headings) + Hanken Grotesk (body). Minimum 15px body text (not 13-14px) to be comfortable for older users. WCAG AA contrast (4.5:1 minimum) on all text, especially secondary/muted grays used for timestamps, professions, etc.
- **Reusable patterns**:
  - Stat blocks (e.g. "12.4K Members") — Archivo bold numeral + Hanken Grotesk label, used on Home, Admin overview, Directory header
  - Status pills — one primary vermilion pill per screen max (e.g. "Active"), everything else neutral/outline (Pending, Committee, New) so vermilion doesn't get diluted
  - Cards — consistent 12–16px border radius across member cards, event cards, matrimony cards

---

## 5. Authentication

**Decision: Email-based OTP, not phone OTP.**

- Use Supabase's built-in `signInWithOtp({ email })` / `verifyOtp()` flow — Supabase generates and manages the 6-digit code server-side; no custom OTP table or expiry logic needs to be built.
- Configure the Supabase email template to display the OTP code itself (not just a magic link).
- Connect Resend (or Brevo) as the SMTP provider before real users sign up — Supabase's default sender is rate-limited to testing volume only.
- The "Mobile number" field from the original signup design is kept, but as a **profile field only** (shown in directory, used for the "Call" button on member profiles) — not used as a login credential.
- Do **not** build a fully custom OTP system (own table + Edge Functions generating/verifying codes) unless a specific limitation of the Supabase-native flow is hit. It would duplicate work for no benefit at this stage.

---

## 6. Data model

Core principle: the family tree is **one self-referencing `people` table**, not six separate tables per the six design-doc sub-screens (Ancestral roots, Parents, Grandparents, Spouse, Children, Siblings). Grandparents, for example, fall out of the schema automatically via `father_id.father_id` — no special-cased screen logic needed per generation.

Planned core tables (not final DDL — write this in Phase 0):

```
people
  id, auth_user_id (nullable — not everyone in the tree has an account),
  full_name, gender, dob, gotra, native_place, district, state,
  father_id -> people.id, mother_id -> people.id, spouse_id -> people.id,
  current_city, marital_status, education, profile_photo_url,
  created_at, updated_at

businesses
  id, owner_id -> people.id, name, category, description,
  type (business/professional/student/homemaker), created_at

events
  id, title, description, location, event_date, capacity, created_at

rsvps
  id, event_id -> events.id, person_id -> people.id, status, created_at

matrimony_profiles
  id, person_id -> people.id, bio, height, education, profession,
  opt_in_tags (jsonb — user-chosen only, see Section 7), verified_by_mandal (bool),
  created_at

matrimony_interests
  id, from_person_id, to_person_id, status (pending/accepted/declined), created_at
  -- contact details + photos only unlock when status = accepted on both sides

dues
  id, person_id -> people.id, fiscal_year, amount_due, amount_paid, status

admin_audit_log
  id, admin_id, action, target_type, target_id, notes, created_at
```

**Row Level Security (RLS) must be enabled on every table from Phase 0**, even with placeholder policies — never deferred to "later." Key policies to design carefully:
- `people`: who can read whose family tree (self, direct relations, or all verified members — decide explicitly, don't default to fully public)
- `matrimony_profiles` / `matrimony_interests`: contact fields and photos readable only after mutual `accepted` status
- `admin_audit_log`, `dues`: admin-role read/write only

---

## 7. File uploads

Four distinct upload types with different sensitivity — **do not treat them the same way**:

| Type | Bucket | Sensitivity | Access |
|---|---|---|---|
| Profile photo | `profile-photos` | Low | Public read, owner-only write |
| Business media | `business-media` | Low | Public read, owner-only write |
| Matrimony photos | `matrimony-photos` | High | Private; signed URL only after mutual match acceptance |
| KYC documents (aadhaar, referral) | `kyc-documents` | Highest | Admin-role read only, logged in `admin_audit_log` on every view |

**Upload flow**: client never proxies files through the app server.
1. Client requests a signed upload URL from Supabase (permission-checked server-side)
2. Client compresses/resizes image locally (max 1600px long edge) before uploading
3. Direct upload to Supabase Storage via the signed URL
4. Edge Function triggers on upload: generates thumbnail, **strips EXIF metadata** (phones embed GPS location — must not leak, especially for matrimony/KYC), updates the DB record

**Matrimony opt-in tags** (e.g. "Manglik: No", dietary preference): must be a checklist the user actively fills in during profile creation — never pre-populated or defaulted to visible. Render as a scrollable row of only the tags the user chose to disclose.

**Family info privacy default**: given the "serious platform" tone of the dark vermilion direction, default father/mother/native place visibility to logged-in verified members only, not fully public to unverified accounts. Should be a toggle in account settings, not hardcoded.

---

## 8. System architecture (summary)

```
Member app (PWA)  ─┐
                    ├──> Supabase backend
Admin console (web)─┘        ├── Auth (email OTP)
                              ├── Postgres DB (RLS enforced)
                              └── Storage (4 buckets, signed URLs)
                                       │
                        ┌──────────────┴──────────────┐
                  Push notifications             Payment gateway
                  (Firebase Cloud Messaging)      (Razorpay)
```

---

## 9. Sprint / build plan

Assumes a small team (1–2 developers), ~1-week sprints. Compress or stretch as needed.

### Phase 0 — Foundation (Week 1)
- [x] Supabase project created, region set close to users (Singapore)
- [x] Email auth enabled, Resend SMTP connected, OTP-style email template set
- [x] Core schema created (Section 6), RLS enabled on every table (placeholder policies on `people`, rest locked down)
- [x] Storage buckets created (Section 7) with policies attached
- [x] `supabase-js` installed, `.env` and client set up, connection sanity-checked
- [ ] React/Vite project scaffolded as the real app (not the demo), dark vermilion design tokens as CSS variables, Archivo/Hanken Grotesk loaded
- [ ] Signup form + OTP code-entry screen (note: needs a new UI step not in the original design docs — see Section 0) wired to real auth + `people` inserts
- [ ] Deployed once to Vercel/Netlify for a live URL from day one
- **Exit criteria**: sign up with email, get OTP, land on empty dashboard — *backend half done, frontend half remaining*

### Phase 1 — Identity & signup (Week 2)
- 3-step signup form (personal → location → gotra)
- Email OTP flow end-to-end
- Home dashboard shell with profile-completion indicator
- Basic profile edit screen
- **Exit criteria**: new member can sign up, verify, see their own dashboard

### Phase 2 — Family tree (Weeks 3–4)
- Ancestral roots, parents, grandparents, spouse & family, children, siblings sub-forms, all writing to `people`
- Family tree overview screen with drill-in navigation
- RLS policies for family-tree visibility proven here (reused later for matrimony)
- **Exit criteria**: member can build full family tree, see it rendered on overview

### Phase 3 — Directory & business (Week 5)
- Directory list with search + filter chips (location/gotra/profession/mandal)
- Member profile screen
- Business profile creation + directory linking
- **Exit criteria**: members can find each other and see business listings

### Phase 4 — Events (Week 6)
- Events list (Upcoming/Registered/Past)
- RSVP flow with live counts
- Event detail screen
- **Exit criteria**: admin-created event shows up, members can RSVP

### Phase 5 — Admin console (Weeks 7–8, can run parallel to Phase 3–4)
- Admin auth/role check (separate from member auth)
- Overview dashboard (counters, activity log)
- Member records table (search, filters, CSV export)
- Approval queue (Approve & Issue ID / Request more info / Reject)
- Notice composer with audience targeting
- **Exit criteria**: admin can approve a new member end-to-end, member sees status change

### Phase 6 — Matrimony (Weeks 9–10, deliberately last)
- Matrimony profile creation with opt-in tags
- Browse/filter screen
- Express interest flow, mutual-consent gating before contact/photos unlock
- Admin verification step specific to matrimony profiles
- **Exit criteria**: two members mutually express interest, only then see contact info

### Phase 7 — Hardening & launch prep (Week 11)
- Full RLS audit (actively try to access data you shouldn't be able to)
- Image compression/EXIF-stripping pipeline verified on real uploads
- Push notifications wired for approvals, events, notices
- Dues/payment integration if launching with it live
- PWA install flow tested on real devices (Android Chrome + iOS Safari)
- **Exit criteria**: ready for first real 50–100 users, not all 500 at once

---

## 10. Open decisions still to make

- Exact RLS policy wording for `people` table visibility (self/relations only vs. all verified members)
- Whether dues/payments launch in v1 or a later phase
- Self-hosting fonts vs. CDN (deferred until design is locked)
- Team size/timeline — the sprint plan above assumes 1–2 developers; adjust phase lengths accordingly

---

*This document reflects planning decisions as of the current conversation. Treat Section 6 (schema) as a starting draft to refine, not final DDL — write and test the actual SQL in Phase 0.*
