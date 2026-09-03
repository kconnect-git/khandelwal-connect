# Khandelwal Connect — Project Context & Build Plan

This document captures all product, design, and technical decisions made during planning, for handoff to a development session (Claude Code or a developer). Read this fully before writing code.

---

## 0. Current status (read this first)

**Phases 0, 1, 2, 3a, and 3b are all complete.** For the full handoff — schema as it actually stands today, architectural patterns, known gaps — read **`phase-1-summary.md`**, **`phase-2-summary.md`**, **`phase-3a-summary.md`**, and **`phase-3b-summary.md`** before starting Phase 4. This section is a short pointer, not the source of truth for current state. A small post-3a addendum (optional mobile + DOB per relative on Family details, migrations `0011`/`0012`) is documented in `phase-3a-summary.md` §8. A post-3b database optimization pass (missing index, dead defensive code, and normalizing the 6 family-relation slots off `people` into a `family_relations` table — migrations `0015`/`0016`) is documented in `phase-3b-summary.md` §6.

Phase 0 (backend foundation):
- ✅ Supabase project created (region: Singapore), email auth + Resend SMTP, OTP email template edited to show the 6-digit code
- ✅ Publishable/Secret key format in use; publishable key in frontend `.env` only
- ✅ Core schema + RLS created — **note**: the `people` table has evolved significantly since Section 6 below was drafted (new columns, two SQL functions). See `phase-1-summary.md` for the current DDL, not Section 6
- ✅ Storage buckets created with policies (untouched since Phase 0 — no upload flow built yet)
- ✅ `supabase-js` installed, client wired up, RLS sanity-checked
- ✅ Real Vite/React app shell (dark vermilion tokens, Archivo + Hanken Grotesk), light/dark toggle
- ✅ Signup → email OTP → onboarding flow wired to real `people` inserts

Phase 1 (identity & signup):
- ✅ 3-step onboarding wizard (personal → location → gotra/background), all fields required except where noted
- ✅ Dashboard shell with a profile-completion indicator
- ✅ Profile edit screen (reuses the same 3 step components)
- ✅ Header user menu (initials avatar, member ID, log out) — not in the original plan, added during Phase 1
- ✅ Per-member code system (`KHA-<state>-<4 digits>`) — also not in the original plan, see `phase-1-summary.md`

Phase 2 (family details — **a deliberately simplified version of the original Phase 2 plan**, see `phase-2-summary.md` §1 for exactly what changed and why):
- ✅ "Family details" screen (father, mother, spouse, children, spouse's parents, maternal uncle) — each a plain-text name plus an optional member code, not a full recursive tree
- ✅ Search-an-existing-registered-member flow (`search_registered_members` RPC) to link a relation to a real member by name/gotra/native-place match, or by member code directly
- ✅ Invite-by-email for relatives who aren't registered yet (`send-family-invite` Edge Function via Resend) — a plain notification email, no auth account pre-created, nothing tracked
- ❌ **Still not built** (deferred to a later phase): siblings, grandparents, a graph/visualization, RLS policies for reading other members' full rows, consent-based linking between two existing members' own rows. See `phase-2-summary.md` for why this was cut down and what a real family tree would still need.

Phase 3a (directory & member profiles — Phase 3 was split into 3a/3b during planning):
- ✅ Member directory (`/directory`): search, state/city/gotra filter chips, pagination, member count stat — all via new `SECURITY DEFINER` RPCs; `people`'s self-only RLS untouched
- ✅ Member profile screen (`/members/:id`, design-doc layout) with tiered field visibility; mobile number shown to logged-in members with Call/WhatsApp actions
- ✅ Profile photo upload (canvas re-encode, EXIF stripped client-side), shared `Avatar` component everywhere
- ✅ App navigation: mobile bottom tabs + desktop header links (Home · Directory · Family)
- ✅ Dashboard redesigned to the design-doc home layout (accent membership card with member code, stat tiles)
- ✅ Fixes: header-staleness (`ProfileRefreshContext`), SPA refresh-404 on Vercel (`vercel.json` rewrite — supersedes `phase-2-summary.md` §4's workaround), father-search gotra bug
- ❌ **Still not built**: mandal filter, "hide my number" toggle. See `phase-3a-summary.md`.

Phase 3b (occupation + business listings):
- ✅ Occupation select on Edit profile (never the wizard), job title/company/location when Job; WORK section on member profiles; Occupation chip + work line in the directory
- ✅ `businesses` made real: RLS (members read, owner writes), listing `/businesses`, detail `/businesses/:id`, editor `/businesses/mine` with logo upload, dashboard tile, nav tab, BUSINESSES section on member profiles
- ✅ `businesses.type` dropped (superseded by `people.occupation_type`); fixed category list
- ❌ Not built: listing moderation (→ Phase 5 admin), distributor/investor tags, logo galleries. See `phase-3b-summary.md`.

**Immediate next step:** read the four phase summaries (especially `phase-3b-summary.md` §4–6), then plan Phase 4 (events).

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

> **This section is the original planning draft and is now stale for `people`.** Phase 1 renamed `district`/`state` to `current_district`/`current_state`, added `home_address`, `state_code`, and `member_code` (plus two SQL functions). Phase 2 added plain-text name + optional member-code pairs for father/mother/spouse/maternal-uncle/spouse's-parents, plus a `children` table. See `phase-1-summary.md` and `phase-2-summary.md` for the actual current DDL — treat what's below as historical context for *why* the table looks the way it does, not as truth.

Core principle (**partially superseded — see `phase-2-summary.md` §1**): the family tree is **one self-referencing `people` table**, not six separate tables per the six design-doc sub-screens (Ancestral roots, Parents, Grandparents, Spouse, Children, Siblings). Grandparents, for example, fall out of the schema automatically via `father_id.father_id` — no special-cased screen logic needed per generation. Phase 2 shipped a simpler, non-graph version of this instead (plain text + optional link, no placeholder rows for unregistered relatives); a real graph with grandparents/siblings derived this way is still future work, not yet built.

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
- [x] React/Vite project scaffolded as the real app (not the demo), dark vermilion design tokens as CSS variables, Archivo/Hanken Grotesk loaded
- [x] Signup form + OTP code-entry screen wired to real auth + `people` inserts
- [x] Deployed to Vercel
- **Exit criteria**: sign up with email, get OTP, land on empty dashboard — met

### Phase 1 — Identity & signup (Week 2)
- [x] 3-step signup form (personal → location → gotra)
- [x] Email OTP flow end-to-end
- [x] Home dashboard shell with profile-completion indicator
- [x] Basic profile edit screen
- [x] *(added, not originally planned)* header user menu, per-member code system, mandatory locked `+91` mobile number
- **Exit criteria**: new member can sign up, verify, see their own dashboard — met. Full details in `phase-1-summary.md`

### Phase 2 — Family details (Weeks 3–4) — **done, scope reduced from original plan**
- ✅ Father/mother/spouse/children/spouse's-parents/maternal-uncle capture, each a plain-text name plus an optional member code linking to a real registered member
- ✅ Search-an-existing-member flow to avoid duplicate/ambiguous entries where possible
- ✅ Invite-by-email for relatives not yet registered
- ❌ Not done, deferred: grandparents, siblings, a tree visualization/overview screen, RLS for reading other members' full rows (nothing needed one, since everything is denormalized onto the caller's own row)
- See `phase-2-summary.md` for the full account of what shipped and why the scope changed
- **Exit criteria (revised)**: member can record their immediate family's names/member-codes and invite unregistered relatives by email — met

### Phase 3 — Directory & business (Week 5) — split into 3a (done) / 3b (next)
**3a — directory & member profiles, done:**
- [x] Directory list with search + filter chips (location/gotra — profession/mandal deferred, fields don't exist yet)
- [x] Member profile screen (incl. own-profile view, contact actions, tiered field visibility)
- [x] *(added, not originally planned)* profile photo upload, app-wide navigation, dashboard redesign, header-refresh + SPA-404 fixes
- **Exit criteria (3a)**: members can find each other and view profiles — met. Full details in `phase-3a-summary.md`

**3b — occupation + business listings, done:**
- [x] Occupation on the person (Edit profile only, not the wizard — a deliberate rule, see `phase-3b-summary.md` §1)
- [x] Business listing creation/edit/logo (`businesses` access model: RLS for owner writes + `SECURITY DEFINER` list RPCs for reads)
- [x] Directory linking (WORK + BUSINESSES sections on member profiles, Occupation chip in the directory, Businesses tab + dashboard tile)
- **Exit criteria (3b)**: members can see business listings — met. Full details in `phase-3b-summary.md`

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

- ~~Exact RLS policy wording for `people` table visibility~~ — **decided in Phase 3a**: `people` stays self-only; cross-member reads go through `SECURITY DEFINER` RPCs with fixed column tiers (see `phase-3a-summary.md` §1–2)
- ~~Access model for `businesses` in Phase 3b~~ — **decided in Phase 3b**: hybrid — real RLS for owner writes, `SECURITY DEFINER` RPCs for reads that join the owner (see `phase-3b-summary.md` §1/§4). Reuse for events.
- Per-user "hide my number" toggle — planned follow-up to Phase 3a's decision to print mobile numbers on profiles
- Whether dues/payments launch in v1 or a later phase
- Self-hosting fonts vs. CDN (deferred until design is locked)
- Team size/timeline — the sprint plan above assumes 1–2 developers; adjust phase lengths accordingly

---

*This document reflects planning decisions as of the current conversation. Treat Section 6 (schema) as a starting draft to refine, not final DDL — write and test the actual SQL in Phase 0.*
