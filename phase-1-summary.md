# Phase 1 Summary — Handoff to Phase 2

Read this before starting Phase 2 (family tree). It documents what actually exists today, not what was originally planned — see `khandelwal-connect-project-context.md` for product/design background, but treat this file as the source of truth for current schema and app structure.

---

## 1. What's built

**Flow**: Signup (email) → OTP verify → 3-step onboarding wizard → Dashboard. Profile can be re-edited afterward via `/profile/edit`.

**Deployed to Vercel.** `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` must be set in the Vercel project's environment variables (Vite inlines them at build time — see the comment in `utils/supabase.ts`), and the project redeployed after any change to those.

| Route | Component | Notes |
|---|---|---|
| `/` | `RootRedirect.tsx` | Routes to `/signup`, `/onboarding`, or `/dashboard` based on `useProfileStatus()` |
| `/signup` | `Signup.tsx` | Email input → `supabase.auth.signInWithOtp` |
| `/verify` | `VerifyOtp.tsx` | 6-digit code → `verifyOtp`, creates a blank `people` row on first verify, navigates to `/onboarding` |
| `/onboarding` | `ProfileWizard.tsx` (`AuthGate`, no `requireComplete`) | 3-step wizard, see below |
| `/dashboard` | `Dashboard.tsx` (`AuthGate requireComplete`) | Welcome message, completion bar, links to edit/logout |
| `/profile/edit` | `ProfileEdit.tsx` (`AuthGate requireComplete`) | Same 3 step components as the wizard, no step gating |

**Onboarding wizard** (`routes/wizard/`): 3 steps, each step's fields defined in `validation.ts`'s `STEP_FIELDS`, all required unless noted.
- **Step 1** (`StepPersonal.tsx`): full name, gender, DOB, mobile number (mandatory, `+91` prefix locked in the UI — see `TextField`'s `prefix` prop — validated as `+91[6-9]\d{9}`)
- **Step 2** (`StepLocation.tsx`): home address, current city, current district, current state (dropdown; also sets `state_code` — see §3), native place (label reads "Native place (Rajasthan)" since this community is Rajasthan-rooted)
- **Step 3** (`StepGotraBackground.tsx`): gotra, marital status, education. Finishing this step calls the `complete_onboarding_step3` RPC (§3), which saves these fields **and** generates the member code in one DB round trip, then navigates to `/dashboard`

Steps 1–2 save incrementally on "Next" via `saveOwnPerson` (`lib/people.ts`); step 3 is the one exception (RPC instead of a plain update — see §3 for why).

**Profile completion** (`lib/profileCompletion.ts`): `PROFILE_FIELDS` is the master list (16 fields) used for the completion bar and `isWizardComplete()`. Four fields are already listed with `editableNow: false` — **`father_id`, `mother_id`, `spouse_id`, `profile_photo_url`** — they count toward the completion percentage but have no UI yet. `father_id`/`mother_id`/`spouse_id` are exactly what Phase 2 needs to wire up.

---

## 2. Current `people` table schema

This supersedes Section 6 of `khandelwal-connect-project-context.md`. Canonical reference: `member-app/supabase/ddl/core_schema.sql` (also holds the two functions below). Migration history: `member-app/supabase/migrations/0001` through `0005` — **all five have been applied** to the live Supabase project as of end of Phase 1.

```sql
create table people (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid references auth.users(id),
  full_name text not null,
  gender text,
  dob date,
  gotra text,
  native_place text,
  current_district text,
  current_state text,
  state_code text check (state_code is null or state_code ~ '^[A-Z]{2}$'),
  member_code text unique check (member_code is null or member_code ~ '^KHA-[A-Z]{2}-\d{4}$'),
  father_id uuid references people(id),
  mother_id uuid references people(id),
  spouse_id uuid references people(id),
  current_city text,
  home_address text,
  marital_status text,
  education text,
  profile_photo_url text,
  mobile_number text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index people_state_code_idx on people (state_code);
```

**RLS** (unchanged since Phase 0, `ddl/enable_rls.sql`): `people` allows self-read/update/insert only (`auth.uid() = auth_user_id`). Every other table (`businesses`, `events`, `rsvps`, `matrimony_profiles`, `matrimony_interests`, `dues`, `admin_audit_log`) is RLS-enabled with **no policies at all** — fully locked down, exactly as Phase 0 left them. **This matters a lot for Phase 2**: a family tree needs to read *other people's* rows (to render parents/spouse/siblings), which the current self-only policy does not allow. You'll need to either write a real RLS policy for reading relations, or follow the pattern below.

`father_id`, `mother_id`, `spouse_id` already exist and self-reference `people.id` — the schema for Phase 2 needs no migration for the basic tree links. What it likely does need: a way to create a `people` row for a relative who has no account of their own (`auth_user_id null` is already allowed by the schema for exactly this).

---

## 3. Member code system (new in Phase 1, not in the original plan)

Format: `KHA-<2-letter state code>-<4 digits>`, e.g. `KHA-RJ-4578`.

- **`state_code`**: populated client-side, the moment the user picks "Current state" in `StepLocation.tsx`, from a static lookup (`STATE_CODE_BY_NAME` in `lib/formOptions.ts`, RTO-style codes). Never derived server-side.
- **4-digit part**: starts as the last 4 digits of `mobile_number`. Collision handling is scoped per `state_code` (a global `unique` constraint on `member_code` is sufficient since the state code is embedded in the string — two members in different states can't collide even with the same last 4 digits).
- **`assign_member_code()`**: `SECURITY DEFINER` Postgres function. Runs as an elevated role specifically so it can check other members' rows for collisions despite RLS restricting normal reads to your own row. Idempotent (returns the existing code if already assigned). On collision, walks forward (`last4+1`, `+2`, ... wrapping at 10000) with an explicit `where state_code = ... and member_code = ...` check plus an exception-catching retry loop as a race-condition safety net.
- **`complete_onboarding_step3(p_gotra, p_marital_status, p_education)`**: wraps saving the wizard's step-3 fields *and* calling `assign_member_code()` in one function, so the client makes a single RPC call and both happen in one transaction. This is what `ProfileWizard.tsx`'s Finish button calls.
- **Lazy fallback**: `useProfileStatus.ts` also calls `assign_member_code()` (idempotent, so harmless) any time it sees a profile that's `isWizardComplete()` but has no `member_code` yet — a safety net for edge cases (RPC failure during Finish, or a profile that reached "complete" before this feature existed).
- **Where it's shown**: header user menu (`components/UserMenu.tsx`), a "Member ID" row above "Log out".

Why this lives in a Postgres function and not an app server: **there is no app server**. This is a pure Vite/React SPA calling Supabase directly (`package.json` has no backend framework). RLS also makes client-side collision-checking impossible regardless (a member can't read other members' rows to check for a taken code). See the architecture discussion in the full session transcript if you want the longer version — short version: an app server would just add a network hop in front of the same DB transaction; the correctness here comes from doing the check-and-write atomically in the database, not from which tier calls it.

---

## 4. Key architectural patterns to know before extending

- **`useProfileStatus()` hook** (`hooks/useProfileStatus.ts`): the shared "am I logged in, and is my profile complete" check. Used independently by `AuthGate.tsx` (remounts per route via a `key` prop, so it naturally refetches on navigation) and by `App.tsx`'s `Layout` (persists across navigation, so it needs an explicit signal to refetch — see next point).
- **Header staleness caveat**: `Layout` currently refetches on `location.pathname` changing (passed as `useProfileStatus`'s optional `refreshKey` param) — this is a heuristic ("the URL changed, so probably something changed"), not a precise signal. A cleaner fix (an explicit `ProfileRefreshContext` with a `triggerRefresh()` called right after each mutation) was built and then reverted mid-session — worth revisiting if the header still shows stale data (avatar/member code) right after onboarding/edits without a manual refresh.
- **Duplicate fetching**: `Layout`, `AuthGate`, `Dashboard.tsx`, and `ProfileEdit.tsx` each independently call `supabase.auth.getSession()` + `getOwnPerson()`. Not wrong, just redundant — a shared context/provider would remove the duplication if it becomes a real problem (e.g. Phase 2 adding more places that need "my own person row").
- **`getOwnPerson()`** (`lib/people.ts`) always orders by `created_at, id` and takes the first row rather than assuming one row per `auth_user_id` — historical defense against a duplicate-rows bug from Phase 0 (see the big comment there, and `migrations/0002`). A unique constraint on `auth_user_id` now exists, so this is belt-and-suspenders, not strictly load-bearing anymore.
- **Wizard pattern**: `PersonFormValues` (`lib/people.ts`) is the single form-shape type shared by the wizard and profile-edit screens. `STEP_FIELDS`/`validateStep`/`stepFieldsMissing` (`routes/wizard/validation.ts`) drive both per-step validation and "which step should I land on" logic (`firstIncompleteStep` in `ProfileWizard.tsx`). If Phase 2 adds a 4th wizard step for family info, follow this same pattern.
- **`personToFormValues()`** backfills `state_code` from `current_state` via the same static lookup if the DB value is missing (handles rows saved before `state_code` existed) — a reminder that client-derived fields loaded from a `Person` row should generally have a defensive fallback like this rather than assuming the DB always has the latest expected shape.

---

## 5. Known gaps / things to decide in Phase 2

- **RLS for family tree reads.** Today's self-only policy blocks reading anyone else's row. Phase 2 needs an explicit decision (self + direct relations only, vs. all verified members) — see Section 10 of the context doc, still an open decision.
- **No image upload flow yet.** Storage buckets exist (Phase 0) but nothing uploads to them. `profile_photo_url` is a placeholder field (`editableNow: false`).
- **Uncommitted changes.** Everything from this session (member code system, `state_code`/`home_address`/`current_district`/`current_state`, header user menu, mandatory phone) is uncommitted in the working tree, including the entire `supabase/ddl/` folder. Commit before starting Phase 2 so there's a clean baseline to branch from.
- **Header refresh heuristic** — see §4. Not broken, but fragile; flagged in case it resurfaces.

---

## 6. Before you start Phase 2

1. Confirm migrations `0001`–`0005` are applied to your Supabase project (they are, as of writing — verify with `select proname from pg_proc where proname in ('assign_member_code','complete_onboarding_step3');` if picking this up on a different machine/session).
2. Commit and push the working tree (see §5) — **the live Vercel deployment is behind**. It's currently serving whatever commit was last pushed (`73e4097`, "Fixed infinite reload"), which predates this entire session: no member code system, no `state_code`/`home_address`/`current_district`/`current_state`, no header user menu, no mandatory-phone lock. Push before treating the deployed URL as current.
3. Design the RLS policy for family-tree reads before writing the father/mother/spouse UI — it's the one piece of Phase 2 that isn't a straightforward extension of the existing wizard pattern.
