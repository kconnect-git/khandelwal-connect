# Phase 3c Summary — Handoff to Phase 4

Read this before starting Phase 4 (events). It documents what shipped in Phase 3c — the tabbed **Profile** page that replaced Edit profile, Family details and My businesses — plus the decisions behind it. Treat this file plus `phase-1-summary.md` … `phase-3b-summary.md` as the source of truth for current schema/app structure.

---

## 1. What Phase 3c is

A single member-editing surface. Before: `/profile/edit` (the three wizard steps + occupation) and `/family-details` (relation cards) and `/businesses/mine` (listing editor) were three screens. After: one `/profile` route with seven tabs, in the nav slot Family used to occupy.

| Tab | `?tab=` | What's on it |
|---|---|---|
| Personal | `personal` (default) | First / Middle / Last name, gender, DOB, **Age** (read-only, computed), blood group, qualification; then Father / Mother / Maternal uncle relation cards |
| Contact | `contact` | Primary email (read-only, from the auth session), primary mobile, secondary email, secondary mobile |
| Cultural | `cultural` | Gotra, native place (Rajasthan), birth place |
| Residence | `residence` | Address line 1 (= `home_address`), lines 2–3, city, district, state, PIN code, residence phone |
| Business | `business` | Occupation select + job sub-fields (Phase 3b), then the **My businesses** listing editor |
| Spouse | `spouse` | Marital status, date of marriage; when Married: Spouse card (with profession / email / blood group) + Spouse's father / mother cards |
| Children | `children` | Child cards (relation, education, profession, marital status, spouse name, blood group added) + Add a child |

Decisions locked in during planning (all user-confirmed):

- **The wizard now asks First name + Last name** in step 1 instead of one Full name box. This is the one deliberate exception to the "never touch the wizard" rule from 3b — same step, one extra input. Middle name is Profile-only. **`full_name` stays the canonical display column**, derived by a trigger (see §2) — nothing that reads `full_name` (header, directory, `search_registered_members`, `send-family-invite`) changed.
- **Mother, maternal uncle and spouse's parents stayed** (the user's original tab list only named father / spouse / children). Nothing already entered was lost.
- **Business fields went on `businesses`, not `people`.** The Business tab *is* the listings editor; `/businesses/mine` redirects there. "Industry type" is the existing `category`; **"Business type" is nature-of-business** (Manufacturer … Professional practice, Other), a new fixed list.
- **Spouse / child profession use the fixed occupation list**, not free text — same rule as 3b.
- **No new `people` field is exposed to other members.** `get_member_profile` / `list_directory` are untouched; blood group, addresses, secondary contacts, date of marriage, birth place all sit in the never-exposed tier. Revisit deliberately if the community wants e.g. blood group searchable.
- **Per-tab Save.** Each person-backed tab validates and writes *only the columns it owns* (`PERSON_TAB_FIELDS` in `lib/profileTabs.ts`), so a required-field error on one tab never blocks saving another. Relation / child / business cards save themselves exactly as before.

## 2. Schema / backend (migration `0017_profile_tabs.sql`, mirrored in `ddl/core_schema.sql`)

**Apply `0017` before deploying the frontend.** The wizard-complete check now needs `first_name`; the migration backfills it, and without the backfill every member is bounced to onboarding.

**`people`**: `first_name`, `middle_name`, `last_name`, `blood_group` (check: 8 groups), `secondary_email`, `secondary_mobile` (check `+91…`), `residence_phone`, `birth_place`, `address_line2`, `address_line3`, `pincode` (check 6 digits), `date_of_marriage`. Backfill splits `full_name` on whitespace (first token / last token / middle). Trigger **`people_sync_full_name`** (`before insert or update of first_name, middle_name, last_name`) sets `full_name := concat_ws(' ', first, middle, last)` whenever `first_name` is non-blank.

**`family_relations`**: `email`, `profession` (occupation check), `blood_group`. Generic per-slot columns; only the spouse card renders them.

**`children`**: `relation` (Son/Daughter), `education`, `profession`, `marital_status`, `spouse_name`, `blood_group`.

**`businesses`**: `brand_name`, `address_line1`, `address_line2`, `business_email`, `primary_product`, `business_type` (check: 7 values), `facebook_url`, `instagram_url`, `linkedin_url`, `youtube_url`.

**RPCs** (old signatures dropped first — same gotcha as 0011–0014):

| Function | Change |
|---|---|
| `save_family_relation(p_slot, p_name, p_member_code, p_mobile_number, p_dob, p_email, p_profession, p_blood_group)` | 5 → 8 args |
| `add_child(p_name, p_member_code, p_mobile_number, p_dob, p_relation, p_education, p_profession, p_marital_status, p_spouse_name, p_blood_group)` | 4 → 10 args |
| `update_child(p_child_row_id, …same…)` | 5 → 11 args |
| `get_business(uuid)` | returns the 10 new business columns (drop + recreate) |
| `normalize_optional_email(text)` | new helper (blank → null, loose format check, lower-cased), not granted to `authenticated` |

`list_businesses`, `list_member_businesses`, `search_registered_members`, `list_directory`, `get_member_profile`, `directory_filter_options`: unchanged. No RLS changes.

## 3. What shipped in the app

| Route | Component | Notes |
|---|---|---|
| `/profile` | `routes/Profile.tsx` | Loads person + relations + children + businesses + session email in parallel. Tab in `?tab=` (`useSearchParams`). Owns the `PersonFormValues` form and `handleSaveTab()`. Photo control + completion line above the tabs. |
| `/profile/edit`, `/family-details` | `<Navigate to="/profile">` | Old bookmarks keep working. |
| `/businesses/mine` | `<Navigate to="/profile?tab=business">` | Same. "My businesses" on `/businesses` and "Edit listing" on `/businesses/:id` point here. |
| `/businesses/:id` | `routes/BusinessDetail.tsx` | DETAILS gained brand, business type, product/service, office address, email; a LINKS row of outline pills for the socials that are set. |

Deleted: `routes/ProfileEdit.tsx`, `routes/FamilyDetails.tsx`, `routes/MyBusinesses.tsx`.

**New components** — `components/profile/`: `ProfileTabs` (scrollable strip, accent underline), `TabSaveBar`, `ProfilePhotoControl` (moved from ProfileEdit), one component per tab, and `tabTypes.ts` (`PersonTabProps`, `TabSaveState`, `relationInitial()`). `components/familyDetails/RelationDetailsFields.tsx` (spouse extras), `ChildDetailsFields.tsx`. `components/businesses/MyBusinessesEditor.tsx` (the editor card + add block, extracted from the old route). `BusinessForm` is grouped Basics / Office / Contact & links.

**Lib**: `lib/profileTabs.ts` (tab keys, labels, `PERSON_TAB_FIELDS`), `lib/people.ts` (`composeFullName`, `ageFromDob`, the new form keys), `lib/familyDetails.ts` (`RelationDetails`, `ChildDetails`, `EMAIL_PATTERN`, `familyNameCompletionFlags()`), `lib/businesses.ts` (`BusinessCard` vs `BusinessListing` split, social URLs normalised like the website), `lib/formOptions.ts` (`BLOOD_GROUP_OPTIONS`, `CHILD_RELATION_OPTIONS`, `BUSINESS_TYPE_OPTIONS`).

**Validation refactor** — `routes/wizard/validation.ts` is now a per-field rule table (`FIELD_RULES`) + `validateFields(fields, form)`. `validateStep(step)` and `validateProfileTab(tab)` both pick fields from it, so a rule is written once. New rules: secondary email/mobile format, PIN code, date of marriage (not future, not before DOB).

**Completion** (`profileCompletion.ts`): `full_name` → `first_name` (wizard-required) + `last_name` (**not** wizard-required, so a backfilled single-word name isn't bounced to onboarding; step-1 validation still requires it for new signups). No other completion changes.

## 4. Patterns to reuse

- **Tab-scoped saves**: `PERSON_TAB_FIELDS` + `validateProfileTab` + a per-tab `TabSaveState`. Any future "big form split into sections" (e.g. a matrimony profile) should copy this rather than one giant Save.
- **Derived display column via trigger** (`full_name`): when a column has many readers and you need to split its source, keep the column and derive it — no RPC churn.
- **`BusinessCard` vs `BusinessListing`**: list RPCs return the lean card shape; the detail RPC returns the superset. Events can do the same (list vs detail).

## 5. Known gaps / deferred

- **Spouse cards still Married-only** (3a §8 decision, unchanged) — now driven by the live dropdown, so they appear as soon as Married is picked, but Widowed/Divorced members can't record a former spouse.
- **Residence phone has no format check** (landlines vary); PIN code and mobiles do.
- **Blood group isn't searchable / visible to others.** Deliberate; would be a one-line addition to `get_member_profile` if the community wants it.
- **The old 30 relation columns on `people`** (3b §6) are still not dropped. Now that `first_name`/`last_name` exist too, a future cleanup migration could drop those 30 in one go.
- **Directory search is still on `full_name` only** — searching by surname works because `full_name` contains it, but there's no last-name filter chip.

## 6. Before you start Phase 4

1. Confirm `0017` is applied:
   ```sql
   select proname, pg_get_function_arguments(oid) from pg_proc
   where proname in ('save_family_relation','add_child','update_child','get_business');
   -- 4 rows: 8 / 10 / 11 / 1 args, no leftover overloads
   select count(*) from people where first_name is null;  -- 0
   ```
2. Smoke test: open `/profile`, change your middle name, Save → header shows the recomposed name. Pick Married on the Spouse tab → spouse card appears; save profession/email/blood group → reload → still there. Add a business on the Business tab with a business type and a social link → `/businesses/:id` shows them.
3. Read `phase-3b-summary.md` §4 before designing the events access model — don't re-derive it.
