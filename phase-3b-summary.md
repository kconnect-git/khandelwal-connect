# Phase 3b Summary — Handoff to Phase 4

Read this before starting Phase 4 (events). It documents what shipped in Phase 3b — occupation on the person, and business listings — plus the decisions behind it. Treat this file plus `phase-1-summary.md`, `phase-2-summary.md`, and `phase-3a-summary.md` as the source of truth for current schema/app structure.

---

## 1. What Phase 3b is

The original plan's "business profiles + directory linking." Built in two chunks, two migrations:

- **Step 1 — occupation on the person (`0013`).** A fixed occupation select on Edit profile, with job sub-fields when the answer is Job. Shows on member profiles and directory cards; filterable in the directory.
- **Step 2 — business listings (`0014`).** The `businesses` table made real: RLS, listing/detail/editor screens, logo upload, dashboard tile, nav tab, and a BUSINESSES section on member profiles.

Decisions locked in during planning (all user-confirmed):

- **Nothing was added to the onboarding wizard.** Occupation lives on Edit profile only and counts toward the completion indicator. Rationale: keep signup short for an older, less tech-comfortable community; a required wizard field would also mark every existing member incomplete. Treat this as a standing rule for future per-member fields.
- **No free-text "profession" field.** Occupation is a fixed list: Business, Job, Student, Homemaker, Retired, Other. `Job` unlocks job title / company / work location (all required once Job is picked; cleared on save if the member switches away). `Business` shows a pointer to My businesses instead — nothing business-specific lives on `people`.
- **`businesses.type` was dropped.** Its values (business/professional/student/homemaker) were really a per-person occupation, which is now `people.occupation_type`. `businesses` is strictly listings.
- **One member ↔ many businesses.** `owner_id` is not unique; My businesses is a list. A member can run a shop and a practice.
- **Access model — hybrid, decided explicitly (per `phase-3a-summary.md` §7).** Nothing on `businesses` is privacy-sensitive, so it gets *real RLS*: any onboarded member (has `member_code`) can read; only the owner can insert/update/delete. Writes are plain client-side table calls — no RPC. Reads for cards/detail still go through `SECURITY DEFINER` RPCs because they join the owner's name/photo/member code from `people`, which stays self-only.
- **Business category is a fixed list** (15 values, check constraint + `BUSINESS_CATEGORY_OPTIONS`) so the Category chip is meaningful. Free text would have fragmented the filter within weeks.

## 2. Schema / backend additions

Canonical reference: `member-app/supabase/ddl/core_schema.sql`, `ddl/enable_rls.sql`, `ddl/bucket_policies.sql`. Migrations `0013` and `0014`, both to be applied manually in the SQL editor.

**`people`** (`0013`): `occupation_type text` (check-constrained to the six values), `job_title`, `company_name`, `job_location` (all text, nullable).

**`businesses`** (`0014`): dropped `type`; added `city`, `state`, `contact_phone` (check `^\+91[6-9]\d{9}$`), `website`, `logo_url`, `updated_at`; `category` gained a check constraint; index on `owner_id`. Four RLS policies (members read / owner insert / owner update / owner delete).

**Visibility tiers** (extending `phase-3a-summary.md` §1): `occupation_type`, `job_title`, `company_name` joined the **directory** tier; `job_location` joined the **profile** tier. Nothing moved out of the never-exposed tier (`home_address`, `dob`, `gender`, family `*_name`/`*_mobile`/`*_dob`).

**RPCs** — all `security definer`, `stable`, `language sql`, `authenticated` only:

| Function | Change |
|---|---|
| `list_directory(p_search, p_state, p_city, p_gotra, **p_occupation**, p_limit, p_offset)` | `0013`: new param + returns `occupation_type`, `job_title`, `company_name`. Dropped and recreated (param list + column list both changed). |
| `get_member_profile(p_person_id)` | `0013`: returns the four occupation fields. Dropped and recreated. |
| `directory_filter_options()` | `0013`: emits an `occupation` kind. |
| `list_businesses(p_search, p_category, p_city, p_state, p_limit, p_offset)` | `0014`, new. Business columns + `owner_id`/`owner_name`/`owner_photo_url`/`owner_member_code` + `total_count`. Search matches business name *or* owner name. Only businesses whose owner has a `member_code`. |
| `get_business(p_business_id)` | `0014`, new. Same shape, one row. |
| `list_member_businesses(p_person_id)` | `0014`, new. `id, name, category, city, logo_url` for the profile screen. |
| `business_filter_options()` | `0014`, new. `(kind, value)` for `category`/`city`/`state`. |

**Storage**: `business-media` gained `update` + `delete` policies on the owner's own `{auth_user_id}/…` folder (it had insert + public read from Phase 0). Logo path: `{auth_user_id}/{business_id}/logo-<timestamp>.jpg`.

**Gotcha worth remembering**: Postgres won't `create or replace` a function whose *parameter list* or `RETURNS TABLE` *column list* changed — it either creates an ambiguous overload or errors. Every such change in `0011`–`0014` does `drop function if exists <old signature>` first. Follow the same pattern.

## 3. What shipped in the app

| Route | Component | Notes |
|---|---|---|
| `/profile/edit` | `routes/ProfileEdit.tsx` + `components/form/OccupationFields.tsx` | New Occupation section at the bottom. Validation via `validateOccupation()` in `wizard/validation.ts` (not part of `validateStep`, so the wizard is untouched). |
| `/directory` | `routes/Directory.tsx` | Occupation chip; cards show a second muted line from `workLine()` ("Job title · Company", or the occupation). |
| `/members/:id` | `routes/MemberProfile.tsx` | WORK section (occupation, title, company, work location) and a BUSINESSES card list (via `list_member_businesses`, best-effort — a failure there doesn't blank the profile). |
| `/businesses` | `routes/Businesses.tsx` | Same shape as Directory: count header, 300ms-debounced search, Category/City/State chips + Clear, cards (logo-or-initials Avatar, name, "Category · City, State", owner name), Load more. "My businesses" outline link at the top. |
| `/businesses/:id` | `routes/BusinessDetail.tsx` | Hero (logo, uppercase name, meta line), WhatsApp / Call / Website pills for non-owners, "Edit listing" for the owner, ABOUT paragraph, DETAILS rows, OWNER card linking to `/members/:owner_id`. |
| `/businesses/mine` | `routes/MyBusinesses.tsx` | One editor card per listing (logo add/change/remove, `BusinessForm` fields, Save, Remove with confirm, View link) + a dashed "Add a business" block. Logo can only be added after the row exists (needs the id for the storage path). |

All under `AuthGate requireComplete`. `NavTabs` gained a Businesses tab (briefcase icon; the `/businesses` prefix keeps it lit on detail and editor). Dashboard gained a Businesses stat tile beside Members.

**Libraries**: `lib/businesses.ts` (thin wrappers: RPC reads, plain-table writes, logo upload/remove reusing the exported `compressImage()` from `lib/profilePhoto.ts`, `validateBusiness()`, `businessMetaLine()`), `lib/directory.ts` gained `workLine()` and the occupation param, `lib/formOptions.ts` gained `OCCUPATION_OPTIONS` and `BUSINESS_CATEGORY_OPTIONS`. `types/database.ts` has the `businesses` table and all new RPC signatures.

## 4. Patterns to reuse

- **Hybrid access model for a non-sensitive table**: RLS for the owner's writes (plain `supabase.from(...)` calls), one `SECURITY DEFINER` list RPC for reads that need an owner join. Events (Phase 4) should look the same: `events` rows are public to members, RSVPs are owner-written, and event cards will want a creator/organiser join.
- **`components/businesses/BusinessForm.tsx`** is a controlled fields-only component used by both the editor card and the add block — the shape to copy for any "list of my things with an add form" screen.
- **Website normalisation** (`https://` prefixed when missing) and the `+91` phone handling live in `lib/businesses.ts`, not the form — keep validation/normalisation in the lib layer.
- **Stat tiles** on the dashboard are now a 2-col grid with two tiles; an Events tile slots in the same way.

## 5. Known gaps / deferred

- **No moderation of listings.** Any onboarded member can publish anything. Phase 5's admin console should get a businesses table with hide/remove.
- **One logo per business**, no gallery. The `business-media` bucket and path convention support more files if wanted.
- **No "looking for distributors / investors" tags** (mentioned in the product doc's business network line). Undesigned; would be a jsonb tag column + chip filter.
- **Search is `ilike '%…%'` on name/owner** — fine at community scale, same caveat as the directory.
- **Occupation is optional.** The completion bar nudges, nothing enforces it. Directory's Occupation chip only offers values that exist.
- **Family details' spouse cards** are still gated on `marital_status = 'Married'` (see `phase-3a-summary.md` §8) — unchanged here.
- **Edge Function deploys still manual**; `send-family-invite` untouched this phase.

## 6. Post-3b: database optimization pass (migrations `0015`, `0016`)

A live schema introspection (tables, columns, constraints, indexes, RLS policies, function signatures — via `information_schema`/`pg_catalog`, not the DDL files) turned up drift between what the database actually had and what `core_schema.sql` documented, plus one real structural improvement. All applied.

**`0015` — quick, safe fixes, no schema shape change:**
- **`children.parent_person_id` had no index**, despite being the RLS filter on every `children` policy and the exact column `getChildren()` filters on for every Family details page load. Added `children_parent_person_id_idx`.
- **Five RPCs** (`assign_member_code`, `complete_onboarding_step3`, `save_family_relation`, `add_child`, `update_child`) looked up the caller's own `people` row with `order by created_at asc, id asc limit 1` — a tiebreak against duplicate `auth_user_id` rows. That was fixed for good in migration `0002` (Phase 1), which added `people_auth_user_id_key unique (auth_user_id)`. The `ORDER BY` has been dead weight (forces a sort for no reason) ever since; simplified to a plain lookup in all five.
- **`core_schema.sql` never documented the `0002` constraint at all** — a real drift between the committed "canonical" file and the live database that had existed since Phase 1 and was never caught until this pass. Added and documented.
- **`lib/people.ts`'s `getOwnPerson()`** carried the same defensive multi-row handling (order-by + `limit(1)` + take `data[0]`) with a comment explaining a duplicate-account bug that the `0002` constraint has made structurally impossible since Phase 1. Simplified to `.eq(...).maybeSingle()`.

**Deliberately not indexed, and why:** the FK columns that used to live on `people` (`father_id`, `mother_id`, `spouse_id`, `maternal_uncle_id`, `spouse_father_id`, `spouse_mother_id` — now on `family_relations`, see below) and similar columns on `dues`/`admin_audit_log`/`matrimony_interests` have no supporting index. Nothing in the app currently queries by them, and `people`/`family_relations` are write-heavy (every profile/family-details save touches them), so an unused index would cost writes for zero read benefit. Add each one exactly when the feature that queries it gets built — the same way `businesses_owner_id_idx` was added in the same migration (`0014`) that introduced `list_businesses`' owner join. `matrimony_interests` will similarly want a second index on `to_person_id` ("who's interested in me") once Phase 6 needs that lookup direction; its current `unique(from_person_id, to_person_id)` only accelerates `from_person_id`-led lookups.

**`0016` — normalized the six family-relation slots off `people`:**

30 of `people`'s 53 columns (57%) existed purely to encode six named relationship slots (father, mother, spouse, maternal uncle, spouse's father, spouse's mother), each repeating the same five fields: id, name, member code, mobile, date of birth. This was **not a performance problem** — Postgres handles a 53-column table without issue at this scale, nothing was slow — it was a maintainability one: every future relation type (a sibling, a grandparent) meant five new columns and another branch in three RPCs, forever.

New table, shaped like `children` (0006) — same name/member_code/resolved-id/mobile/dob pattern, one row per slot instead of 5 columns × 6 slots:
```sql
create table family_relations (
  id uuid primary key default gen_random_uuid(),
  person_id uuid references people(id) not null,
  slot text not null check (slot in ('father', 'mother', 'spouse', 'maternal_uncle', 'spouse_father', 'spouse_mother')),
  related_name text,
  related_member_code text,
  related_id uuid references people(id),
  mobile_number text,
  dob date,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (person_id, slot)
);
```
RLS: same self-scoped-by-`person_id` shape as `children`'s four policies. `save_family_relation` was rewritten as a single `insert ... on conflict (person_id, slot) do update` — replacing what used to be a 6-way `if/elsif` over 30 columns. **A 7th slot is now a change to the `check` constraint, not new columns or a new branch.**

**Expand-contract, not a hard cutover.** This migration adds `family_relations`, backfills it from the 6 old slot-columns (one-time `insert ... select` per slot, only where a name existed), and repoints `save_family_relation` to write there instead of `people`. It deliberately **does not drop the 30 old `people` columns yet** — they become frozen/historical the moment this shipped (nothing writes to them anymore) but are left in place, safe to drop in a later migration once the app has run against `family_relations` in production for a while. **Don't read them going forward** — the app already doesn't (see below).

**Client changes, all required in the same step** (not deferrable, since the write path moved):
- `types/database.ts`: removed the 30 relation columns from the `Person` type (they still physically exist on the row, deliberately excluded from the type so nothing reads stale data through `Person`); added `FamilyRelationRow`/`FamilyRelationSlot` and the `family_relations` table entry.
- `lib/familyDetails.ts`: `getFamilyRelations(personId)` (plain client select under `family_relations`' RLS, same shape as `getChildren()`) and `getFamilyNameCompletionFlags(personId)` (just the three name presence flags, for the completion count below).
- `routes/FamilyDetails.tsx`: fetches relations alongside children, builds a `Map<slot, row>`, and initializes each `RelationField` from that map instead of from `person.father_name` etc. The per-field remount `key` (used to force fresh initial values after a reload) switched from `person.updated_at` to `loadAttempt`, since editing a family relation no longer touches `people.updated_at` at all.
- `lib/profileCompletion.ts` **itself needed no change** — `getProfileCompletion()` already took a loose `Partial<Record<ProfileFieldKey, unknown>>`, not a strict `Person`. `Dashboard.tsx` and `ProfileEdit.tsx` now fetch `getFamilyNameCompletionFlags()` and merge it into the object they pass in (`{ ...person, ...familyFlags }`) instead of relying on `person.father_name` being populated directly.

**Before dropping the old 30 columns later**: confirm nothing still reads them (grep for `father_name`, `father_id`, etc. across `src/` and the DDL — should only turn up in this file and `phase-2-summary.md`'s superseded-schema note), then a follow-up migration can `alter table people drop column ...` for all 30 plus the now-unused `people.father_id`/`mother_id`/`spouse_id` FK constraints. Not urgent; they're harmless dead weight until then.

## 7. Before you start Phase 4

1. Confirm `0013` and `0014` are applied:
   ```sql
   select proname, pg_get_function_arguments(oid) from pg_proc
   where proname in ('list_directory','get_member_profile','list_businesses','get_business',
                     'list_member_businesses','business_filter_options');
   ```
   → 6 rows; `list_directory` shows 7 args. And `select policyname from pg_policies where tablename = 'businesses';` → 4 rows.
2. Smoke test: set your occupation to Job on Edit profile → it appears on your member profile and the directory card. Add a business on My businesses, upload a logo, confirm it shows on `/businesses`, its detail page, and your member profile; confirm another account can't edit it.
3. Read §4 before designing the events access model — don't re-derive it.
