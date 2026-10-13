# Phase 6a Summary — Handoff to Phase 6b

Read this before starting 6b (browse, interests, mutual unlock). Phase 6 (matrimony) was split into **6a** (profiles + verification), **6b** (browse + interests + unlock: the Phase 6 exit criterion) and **6c** (pause, un-match, block, report). Treat this file plus `phase-1-summary.md` … `phase-5c-summary.md` as the source of truth for current schema and app structure.

---

## 1. Decisions (made during Phase 6 planning, apply to all of 6a–6c)

| Topic | Decision |
|---|---|
| Who creates | **Self only.** No parent-created profiles for children |
| Eligibility | Approved member, **18+** (from `people.dob`), gender **Male / Female**, marital status **not Married**. One SQL function; checked at submit and approval in 6a, and **at read time** from 6b |
| Verification | **Gate.** `draft → pending → approved / changes_requested / rejected`. Invisible until approved. **Edits after approval are not re-reviewed** (an admin can still send an approved profile back or take it down) |
| Who verifies | Any admin (moderator or super_admin) |
| Before a match | First name + last initial, age, city/state, gotra, education, occupation, height, the three text fields, disclosed opt-in details. **No photos, no contact** |
| After a mutual match (6b) | Photos, login email, mobile (**unless `hide_mobile` is on: hide stays**), full name, father/mother, native place |
| Browse (6b) | **Opposite gender only**, enforced server-side. Filters: age range, state/city, education, occupation. No sagotra filter, no height filter |
| Interests (6b) | Optional message ≤300, sender can withdraw, **max 10 pending outgoing**, decline is **silent** ("No response") and can't be resent |
| Safety (6c) | Pause, un-match, block, report → admin hide |
| Notifications | In-app badge only (push is Phase 7) |
| Entry point | The Explore tile (now live) + a dashboard tile in 6b. **No new nav tab** |

## 2. Schema / backend (migration `0023_matrimony_profiles.sql`, mirrored in `ddl/core_schema.sql`, `ddl/enable_rls.sql`, `ddl/bucket_policies.sql`)

The Phase 0 placeholders (`matrimony_profiles`, `matrimony_interests`) are **dropped**. Neither had rows or readers. 6b rebuilds `matrimony_interests` keyed on profile ids.

**`matrimony_profiles`** (one per person, cascades on person delete): `status`, `height_cm` (120–230), `about_me` (≤1000), `about_family` / `partner_expectations` (≤600), opt-in `diet` / `smoking` / `drinking` / `birth_time` / `birth_place` / `rashi` / `nakshatra` (**null = not disclosed**, enums enforced by check constraints), `review_note`, `submitted_at`, `reviewed_at`, `reviewed_by`, timestamps.

**`matrimony_photos`**: `profile_id`, `storage_path` (`{auth uid}/{uuid}.jpg`), `position` 1–3 (1 = main). `(profile_id, position)` is a *deferrable* unique key, so reorders can permute positions in one UPDATE.

Both tables are **RPC-only** (RLS on, no policies), like events and notices.

**Storage (`matrimony-photos`, private):** read = owner **or** `is_admin()`; owner delete added. Upload policy unchanged from Phase 0. **6b adds "or matched" to the read policy.** Photos are only ever shown through 10-minute signed URLs.

| Function | Notes |
|---|---|
| `matrimony_ineligible_reason(member_status, dob, gender, marital_status)` | The eligibility rule. Returns a human-readable reason or null. Revoked from clients. |
| `matrimony_own_profile_id()` | The caller's profile id, creating a draft if needed (approved members only). Revoked from clients. |
| `get_my_matrimony_profile()` | jsonb: `basics` (read-only people fields), `ineligible_reason`, `profile`, `photos`. |
| `save_my_matrimony_profile(...)` | Upsert; blank → null; status untouched; rejected profiles are locked. |
| `submit_matrimony_profile()` | draft / changes_requested → pending. Requires eligible + height + about_me. |
| `add_matrimony_photo(path)` / `remove_matrimony_photo(id)` / `set_main_matrimony_photo(id)` | Path must be in the caller's folder and exist in storage; max 3; removal re-packs positions and returns the path so the client deletes the file. |
| `admin_list_matrimony_profiles(status, search, limit, offset)` | The queue. Pending sorts oldest submission first. Includes `ineligible_reason` and `photo_count`. |
| `admin_get_matrimony_profile(id)` | Full profile + basics + photos. **Audited as `matrimony_profile_viewed`**, at most once per admin per profile per 10 minutes. |
| `admin_set_matrimony_status(id, status, note)` | pending → approved / changes_requested / rejected; approved → changes_requested / rejected. Note required except for approval. Approval re-checks eligibility. Audited `matrimony_<status>`. |
| `admin_list_audit_log` / `admin_overview_stats` | + `matrimony_profile` target label; + `matrimony_pending`, `matrimony_approved`. |

## 3. What shipped in the app

**Members**

| Route | Component | Notes |
|---|---|---|
| `/matrimony` | `routes/matrimony/MatrimonyHome.tsx` | Explainer + a card into your own profile showing its status (or why you can't create one). "Browsing coming soon" until 6b. |
| `/matrimony/profile` | `routes/matrimony/MyMatrimonyProfile.tsx` | If ineligible and nothing started: just the reason + a link to Profile. Otherwise a status banner (with the admin's note), read-only **Basics**, **About** (height required; three textareas with counters), **Photos**, **Optional details** (every select starts on "Don't show"), Save draft / Submit for review (Save changes once submitted). Rejected = read-only. |
| `/explore` | `routes/Explore.tsx` | Matrimonial tile is now live. |

- `components/matrimony/MatrimonyPhotoManager.tsx`: the 3-slot grid, with add, remove and make-main actions. Each action hits the server immediately and reloads without re-seeding the form, so unsaved text survives.
- `components/matrimony/MatrimonyDetails.tsx`: read-only view of a profile's own fields (tag row of disclosed details plus the three texts). Used by the admin review screen; **6b reuses it on the member-facing detail page.**
- `lib/matrimony.ts`: RPC wrappers, photo upload (`compressImage` re-encode strips EXIF, upload, `add_matrimony_photo`, orphan cleanup on failure), `signedPhotoUrls`, option lists (mirroring the check constraints), `formatHeight`, `MATRIMONY_STATUS_LABELS`.
- `components/form/TextField.tsx` accepts `type="time"`.

**Admins**

| Route | Component | Notes |
|---|---|---|
| `/admin/matrimony` | `routes/admin/AdminMatrimony.tsx` | `TabStrip` Pending · Changes requested · Live · Turned down (`?status=`), search by name or member ID, `DataTable`, Review/View links. An ineligible member is flagged in the row. |
| `/admin/matrimony/:id` | `routes/admin/AdminMatrimonyDetail.tsx` | Photos, basics, `MatrimonyDetails`, the review note, history (audit rows for this profile), Approve / Request changes / Turn down via `ConfirmDialog`. Approve is disabled while ineligible. |

- **Console nav replaced**: `AdminLayout` is now a sidebar from `md:` up and a "Section" dropdown on phones (the pill row is gone). Matrimony is the 8th section. The console widened to `max-w-6xl` to make room for the sidebar.
- Overview: **Matrimony profiles awaiting review** (accent when > 0) and **Live matrimony profiles** tiles. Audit log: a **Matrimony** filter tab; matrimony rows link to the review screen.

## 4. Known gaps / deferred

- **No browse yet**: an approved profile is visible to nobody but admins until 6b.
- **A rejected profile is a dead end** for the member until 6c adds "delete my matrimony profile".
- Audited views show up in the Overview's "Recent activity" too. If that gets noisy, filter `matrimony_profile_viewed` out of that one call.
- Eligibility is re-checked on approval but **nothing re-checks an approved profile yet**. 6b's read-time check is what makes a newly Married member drop out.
- `birth_time` is a plain `time` with no timezone; that's fine for horoscope use.
- The migration was written without a database to run it against. **Run its verification block.**

## 5. Before you start 6b

1. Pre-check that `select count(*) from matrimony_profiles` and `from matrimony_interests` are both 0, and that the `matrimony-photos` bucket is private. Apply `0023` and run its verification block, then deploy the frontend.
2. Smoke test (admin A; members M1 Male 25, F1 Female 24; U under 18; W Married):
   - U and W open `/matrimony/profile`: each sees only the reason ("You need to be 18 or older." / "Your profile says you are married.").
   - M1: fill height + about me, pick Diet, leave the rest on "Don't show", add 3 photos (a 4th is refused), make photo 3 main, remove one. Download a photo through its signed URL and confirm no EXIF/GPS. Submit.
   - A: `/admin/matrimony` shows M1 under Pending, and the Overview tile is accent. Open it: the photos load, only Diet appears in the tag row, and the audit log has one "Viewed matrimony profile" (reloading within 10 minutes adds no second one). Request changes with a note.
   - M1 sees the note in the banner, edits, resubmits. A approves, and the row moves to Live.
   - M1 edits "About me" after approval: status stays Live.
   - As F1 in the console: `supabase.from('matrimony_profiles').select()` gives `[]`; `supabase.storage.from('matrimony-photos').createSignedUrl('<M1 path>', 60)` fails; `admin_list_matrimony_profiles` gives `[]`.
   - Console: the sidebar at ≥768px, the dropdown on a phone, and the dropdown tracks detail pages (e.g. `/admin/members/:id` shows "Members").
3. 6b: rebuild `matrimony_interests` on profile ids; add `matrimony_is_matched`, `list_matrimony_profiles` (approved, eligible **at read time**, opposite gender), `get_matrimony_profile` (contact + photos only when matched), `express_interest` (cap 10; a reverse pending interest auto-matches), `withdraw_interest`, `respond_interest`, `list_my_interests`, `matrimony_badge_count`; extend the storage read policy with "or matched". The plan lives in `/Users/lakshyapk/.claude/plans/jazzy-weaving-adleman.md`.
