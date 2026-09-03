# Phase 3a Summary — Handoff to Phase 3b

Read this before starting Phase 3b (business profiles). It documents what shipped in Phase 3a — the member directory, member profile screens, profile photo upload, and app-wide navigation. Treat this file plus `phase-1-summary.md` and `phase-2-summary.md` as the source of truth for current schema/app structure.

---

## 1. What Phase 3a is

The original plan's "Phase 3 — Directory & business" was split in two: **3a = directory + member profiles** (this phase, done) and **3b = business profiles** (next, not started). Everything here was built strictly from columns that already existed on `people` — no profession or mandal fields were added, so the originally planned profession/mandal filter chips are deferred until the data exists.

Decisions locked in during planning (all user-confirmed):

- **Field visibility tiers.** Directory cards show name/gotra/city/state/photo. The profile screen additionally shows native place, district, education, marital status, member code, and the **mobile number printed as text** with Call/WhatsApp actions. `home_address`, `dob`, `gender`, and all family `*_name` fields are **never** returned to other members — this is enforced by the RPC column lists, not by client filtering. Keep it that way when extending.
- **Printing the number means every logged-in member can read every other member's phone.** Deliberate community-trust posture, accepted with eyes open — it raises the stakes on the Phase 5 admin-approval gate (today anyone who completes onboarding is "a member"). A per-user "hide my number" toggle is the planned escape hatch (one column + one line in `get_member_profile`); not built.
- **`people`'s RLS is untouched** — still self-only read/update/insert from Phase 0. All cross-member reads go through new `SECURITY DEFINER` RPCs following the `search_registered_members` pattern.

## 2. Schema / backend additions (migration `0010`, applied)

Canonical reference: `member-app/supabase/ddl/core_schema.sql` + `ddl/bucket_policies.sql`. All three functions are `security definer`, `stable`, `language sql`, granted to `authenticated` only.

- **`list_directory(p_search, p_state, p_city, p_gotra, p_limit, p_offset)`** — paginated A–Z listing of members with a `member_code` (same "completed onboarding" gate as search). Returns directory-tier columns plus `total_count` (window function, repeated on every row — one call gives a page *and* the stat number). `p_limit` clamped to 50 server-side. Name search is `ilike '%…%'`; state/city/gotra are exact `ilike` matches.
- **`get_member_profile(p_person_id)`** — one member's profile-tier columns. Zero rows for an unknown id or someone without a `member_code`.
- **`directory_filter_options()`** — distinct `(kind, value)` pairs (`state`/`city`/`gotra`) present among members, so the directory's filter chips never offer a dead-end option.
- **Storage**: `profile-photos` gained `update` + `delete` policies (owner's own `{auth_user_id}/…` folder). Phase 0 only had insert + public read; re-upload cleanup needs delete.

No new tables. No changes to existing RLS policies.

## 3. What shipped in the app

| Route | Component | Notes |
|---|---|---|
| `/directory` | `routes/Directory.tsx` | Stat header (count), 300ms-debounced name search, State/City/Gotra chip filters (accent-filled when active) + Clear, card list, Load more (offset pagination, 20/page) |
| `/members/:id` | `routes/MemberProfile.tsx` | Works for anyone including self. Design-doc layout: ‹ DIRECTORY back link, photo left of big uppercase name + `Gotra X · City` subtitle + member code, then WhatsApp (accent) / Call (outline) pill buttons, then flat LOCATION / BACKGROUND / CONTACT sections (label-left value-right rows, hairline dividers). Self sees "Edit profile" instead of contact actions |

Both under `AuthGate requireComplete`.

**Photo upload** (`lib/profilePhoto.ts` + a section at the top of `ProfileEdit.tsx`): client-side canvas re-encode (max 1600px long edge, JPEG 0.85) — which **strips EXIF/GPS for free**, so that hardening item is already covered for profile photos. Uploads to `profile-photos/{auth_user_id}/profile-<timestamp>.jpg` (timestamped = new URL every time, no cache busting needed), saves the public URL to `profile_photo_url`, best-effort deletes the previous object. `profile_photo_url` flipped to `editableNow: true` in `profileCompletion.ts`.

**`components/Avatar.tsx`** — shared photo-or-initials avatar (`getInitials` moved here from `App.tsx`). Used by the header `UserMenu`, directory cards, profile hero, and ProfileEdit. Any future avatar should use this, not a bespoke circle.

**Navigation** (`components/NavTabs.tsx`): mobile fixed bottom tab bar (Home · Directory · Family, inline SVG icons) + the same links inline in the desktop header. Rendered only when `useProfileStatus()` is `complete` — pre-onboarding users are locked to the wizard anyway. The Directory tab stays lit on `/members/:id`. `<main>` gets mobile bottom padding so content clears the bar.

**Dashboard redesign** (design-doc home layout): accent "Namaste" over big uppercase name, then a vermilion **membership card** ("MEMBERSHIP" label, member code big in Archivo, city/state right), then a stat-tile grid (currently one tile: member count → links to directory; Events/Businesses tiles slot into the grid in later phases). The membership card is the screen's single accent element, so "Edit profile" was demoted to an outline button (context doc §4's one-vermilion-per-screen rule).

## 4. Fixes shipped alongside (not directory-specific)

- **Header staleness fixed properly** — the fix `phase-1-summary.md` §4 said was "built and then reverted" is now in for good: `context/ProfileRefreshContext.tsx` holds a `version` counter; `Layout` folds it into `useProfileStatus`'s refresh key (route changes remain a safety-net trigger). `triggerRefresh()` is called after: ProfileEdit save / photo upload / photo remove, and ProfileWizard step saves + finish. Header avatar/initials/member-code now update instantly after mutations. **Call `triggerRefresh()` from any future screen that mutates the caller's own `people` row.**
- **SPA refresh-404 fixed** — `member-app/vercel.json` now has the catch-all rewrite to `/index.html`. This supersedes `phase-2-summary.md` §4's "every link must point at `/`" workaround: deep links (refresh, shared URLs, future event/matrimony emails) are now safe on Vercel. Local dev never had the problem (Vite falls back to index.html itself).
- **Father search bug** — the father slot was the only one passing `gotraHint` (the caller's own gotra) into `search_registered_members`, which applies it as an *exact* match; any spelling/whitespace variance in the father's row made his search silently return nothing. No call site passes hints anymore — all seven relation slots now search identically by name. The optional `p_gotra`/`p_native_place` RPC params and the component plumbing remain for a future *soft* version (rank same-gotra matches first, don't exclude).
- **Dev console access** — `window.supabase` is exposed in dev builds only (`utils/supabase.ts`), for RLS spot-checks. Stripped from production bundles.

## 5. Key architectural patterns to know before extending

- **Tiered-RPC pattern for cross-member reads**: never open `people`'s RLS; add/extend a `SECURITY DEFINER` function with an explicit column list instead. Phase 3b's business directory reads should follow this (or use real RLS policies on `businesses`, which has no privacy-sensitive columns — either is defensible; decide explicitly).
- **`lib/directory.ts`** is the thin-wrapper shape (same as `lib/familyDetails.ts`): argument shaping + error unwrapping only, no business logic. `types/database.ts` carries the RPC signatures.
- **`total_count` window-function pagination**: one RPC returns page + total. Reuse for any future paginated list (businesses, events) rather than a separate count call.
- **Stat tiles on the dashboard** are a 2-col grid ready to take more tiles — a "Businesses" count tile in 3b should reuse the same markup.

## 6. Known gaps / deferred

- **Phase 3b (next): business profiles.** The `businesses` table has existed since Phase 0 (`owner_id`, `name`, `category`, `description`, `type` check business/professional/student/homemaker) with RLS **enabled and zero policies** — fully locked, no UI, nothing reads or writes it. Original scope: business profile creation + directory linking (e.g. a PROFESSION/business line on member profiles and a business filter/tab in the directory, per the design doc's profile mockup).
- **"Hide my number" toggle** — planned, not built (see §1).
- **Profession/mandal directory filters** — no fields yet; profession effectively arrives via `businesses` in 3b, mandal is undesigned.
- **Directory scaling**: offset pagination + `count(*) over ()` is fine at ~500 members; revisit (keyset pagination) only if the community grows well past that.
- **Duplicate person rows for relatives** — Phase 2's gap, unchanged.
- **Edge Function deploys still manual** — unchanged from Phase 2 (`send-family-invite` was untouched this phase).

## 7. Before you start Phase 3b

1. Confirm migration `0010` is applied: `select proname from pg_proc where proname in ('list_directory','get_member_profile','directory_filter_options');` → 3 rows, and `profile-photos` shows 4 storage policies.
2. Confirm the deployed site survives a hard refresh on `/directory` (proves `vercel.json` made it into the deploy).
3. Decide the `businesses` access model up front (RLS policies vs. tiered RPCs — see §5) before writing any UI, same lesson as Phase 2's RLS-first advice.
4. One member ↔ many businesses? The table allows it (`owner_id` is not unique). The design doc's profile screen shows a single PROFESSION block — decide whether v1 is one business per member (simpler UI) or many.
