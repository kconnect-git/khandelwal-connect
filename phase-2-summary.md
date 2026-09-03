# Phase 2 Summary — Handoff to Phase 3

Read this before starting Phase 3 (directory & business). It documents what actually got built in Phase 2, which is a **deliberately simplified version** of the family tree originally scoped in `khandelwal-connect-project-context.md` — see §1 for exactly what changed and why. Treat this file as the source of truth for current schema/app structure; treat the original context doc's Section 6 and Section 9's "Phase 2" bullet as superseded planning history.

---

## 1. What Phase 2 actually is (and isn't)

The original plan called for a full recursive family tree: parents/grandparents/spouse/children/siblings, a graph or drill-in UI, and RLS policies for reading other members' rows. During planning, that scope was explicitly cut down after discussion — the real tree/graph work (siblings, grandparents, a visualization, consent-based linking between two existing members) is **deferred to a later phase**, not built here.

What shipped instead: a **Family details** screen where a member records their father, mother, spouse (if married), children, spouse's parents, and maternal uncle — each as a plain-text name plus an optional member code, with a search step to link to an already-registered member when possible. Key design decisions, in case they need re-litigating later:

- **No placeholder `people` rows for unregistered relatives.** Earlier drafts of this feature (see git history / prior planning) considered creating a real `people` row for every relative, registered or not. That was scrapped — a relative who isn't a member yet is just text on the caller's own row (`father_name`, etc.) until/unless a real member code links them. This sidesteps an entire class of duplicate-person problems (e.g. two children of the same father both creating separate placeholder rows for him) at the cost of not being a "real" graph yet.
- **Search only ever finds already-registered members** (`search_registered_members` — filters to rows with a `member_code`), using name + optional gotra/native-place to disambiguate common names. It does not search or create placeholder people.
- **Nothing is ever written to another member's row.** Selecting a search match only copies that person's name + member code onto the caller's own row (`father_id`/`father_member_code`/etc.) — it never touches the matched person's own row. This is why no new RLS policy was needed on `people` at all (see §2).
- **The invite feature sends a plain, untracked email — no auth account, no database row.** This went through two other designs first (a direct Resend API email that also logged to a `family_invites` table, then a Supabase `auth.admin.inviteUserByEmail()`-based version that pre-created a real login account for the invitee) before landing here. Both were rejected: the tracking table was decided to be unnecessary overhead, and pre-creating an auth account caused real problems (a second invite to the same email fails with "already registered," even if the first invite was never accepted). Current behavior: `send-family-invite` Edge Function sends one Resend email worded from the recipient's side of the relationship (e.g. "your son, Rohan, invited you") with a link to the site's root — nothing persisted, invite the same email as many times as you want.

---

## 2. Current schema additions

> **Superseded (post-3b):** the flat `people` columns below (`father_name`, `father_member_code`, … all 30 of them across the 6 slots) were normalized into a `family_relations` table in a post-3b database optimization pass. The columns still physically exist on `people` as frozen historical data — nothing writes to them anymore — but the app reads/writes exclusively through `family_relations` now. This section is kept for history; see `phase-3b-summary.md` §6 for the current shape.

Canonical reference: `member-app/supabase/ddl/core_schema.sql` / `enable_rls.sql`. Migration history for this phase: `0006` through `0009`, all applied.

```sql
-- On people: father_id/mother_id/spouse_id already existed from Phase 0.
-- Added this phase:
father_name text,
father_member_code text,
mother_name text,
mother_member_code text,
spouse_name text,
spouse_member_code text,
maternal_uncle_id uuid references people(id),
maternal_uncle_name text,
maternal_uncle_member_code text,
spouse_father_id uuid references people(id),
spouse_father_name text,
spouse_father_member_code text,
spouse_mother_id uuid references people(id),
spouse_mother_name text,
spouse_mother_member_code text
```

The `*_id` FK is only ever populated once `*_member_code` resolves to a real registered member (checked server-side in `save_family_relation`); it's `null` for a plain-text-only entry. `spouse_father_id`/`spouse_mother_id` are the caller's *own* denormalized fields, not the spouse's real `father_id`/`mother_id` — there's no dependency on the spouse having a full `people` row.

**`children` table** (new, multi-valued so it couldn't just be more columns):
```sql
create table children (
  id uuid primary key default gen_random_uuid(),
  parent_person_id uuid references people(id) not null,
  child_name text not null,
  child_member_code text,
  child_id uuid references people(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
```
RLS: self-scoped to `parent_person_id` — a member can only read/write their own children rows.

**`family_invites`**: created in `0008`, dropped again in `0009` in the same phase once the invite design changed (see §1). It does not exist in the current schema — don't be confused if you see `0008`'s CREATE TABLE in migration history, it was reverted before anything depended on it.

**RPCs** (all `SECURITY DEFINER`, same pattern as Phase 1's `assign_member_code()`):
- `search_registered_members(p_full_name, p_gotra, p_native_place)` — returns limited fields (name, gotra, native place, city/state, member code) for people who already have a `member_code`. Needs `SECURITY DEFINER` because self-only RLS otherwise blocks reading anyone else's row.
- `save_family_relation(p_slot, p_name, p_member_code)` — `p_slot in ('father','mother','spouse','maternal_uncle','spouse_father','spouse_mother')`. Validates a given member code actually exists before linking; raises if not. Needs `SECURITY DEFINER` for that cross-row lookup even though the write itself is to the caller's own row.
- `add_child(p_name, p_member_code)` / `update_child(p_child_row_id, p_name, p_member_code)` — same pattern for the `children` table. Deleting a child is a plain client-side `delete` under `children`'s own RLS policy, no RPC needed.

**No changes to `people`'s RLS policies.** Self-only read/update/insert (from Phase 0) is still all that's needed — see §1 for why.

---

## 3. The invite Edge Function

`member-app/supabase/functions/send-family-invite/index.ts` — the first Edge Function in this project (Phase 0/1 had none; everything was direct client-to-Supabase or `SECURITY DEFINER` SQL functions).

- Deployed manually via `supabase functions deploy send-family-invite` — **this is not wired to any CI/auto-deploy.** Unlike the frontend (Vercel auto-deploys on push to the linked branch), a change to this function's code requires re-running that deploy command by hand. Worth automating later if Edge Functions become a bigger part of the app.
- Requires the `RESEND_API_KEY` secret (`supabase secrets set RESEND_API_KEY=...`) — reuses the same Resend account already used for Supabase Auth's OTP emails, but Edge Functions run in a separate sandbox from Auth's SMTP config, so the key has to be given to this function separately. Optional: `RESEND_FROM_ADDRESS` (a verified-domain sender; defaults to Resend's shared test address, which can only send to your own account's email until you set this) and `SITE_URL` (defaults to a placeholder Vercel URL baked into the code — should be set to the real deployed URL).
- Computes the relation label from the *recipient's* side (inverting the slot + the inviter's gender) — e.g. inviting "father" as a male inviter produces "your son"; see `recipientRelationLabel()` in the function for the full mapping (covers father/mother/spouse/maternal_uncle/spouse_father/spouse_mother/child).
- Validates the caller via their forwarded session JWT and looks up their own `full_name`/`gender` — never trusts client-supplied values for the message content.

---

## 4. Known gap: SPA deep-linking on Vercel

Discovered while testing this phase, relevant to any future feature that emails/links a user to a specific in-app path: this is a client-routed SPA (`react-router-dom`'s `BrowserRouter`), and a **hard browser navigation to any path other than `/` 404s on Vercel** unless a rewrite rule is added (a `vercel.json` with a catch-all rewrite to `index.html` was drafted and tested during this phase, then deliberately reverted — the invite email link was pointed at the site root instead, relying on `RootRedirect.tsx`'s existing client-side routing to send an authenticated-but-incomplete profile on to `/onboarding`).

This means: **every current internal link that matters for a fresh, unauthenticated browser hit should point at `/`, not a deep path.** If Phase 4 (events) or Phase 6 (matrimony) want to email a direct link to a specific event or interest — a deep path — this gap will need a real fix (the `vercel.json` rewrite is the straightforward one) rather than relying on the root-redirect workaround again.

> **Update (Phase 3a):** fixed for good — `member-app/vercel.json` now carries the catch-all rewrite to `/index.html`, so hard navigations/refreshes on any path work on Vercel and deep-link emails are safe going forward. The guidance above is historical.

---

## 5. Key architectural patterns to know before extending

- **The `RelationSearchInput` → `RelationField` / `ChildField` → `InviteControl` component stack** (`member-app/src/components/familyDetails/`) is the reusable shape for "search an existing member, or fall back to plain text, or invite them" — any future feature needing similar match-an-existing-member-or-not behavior (e.g. real family tree work later) should look at reusing or extending this rather than rebuilding it.
- **`onSearched` callback pattern**: `RelationSearchInput` reports search results back up via an `onSearched` prop specifically so the parent can gate UI (like showing the Invite button only after a real "not found" result) rather than guessing from field emptiness. Follow this pattern if more conditional-on-search-outcome UI gets added.
- **`lib/familyDetails.ts`** follows the same thin-RPC-wrapper shape as Phase 1's `lib/people.ts` — no business logic in the client beyond argument shaping and error unwrapping (see next point).
- **Unwrapping `FunctionsHttpError`**: `supabase.functions.invoke()` collapses any non-2xx Edge Function response into a generic "Edge Function returned a non-2xx status code" message. `sendFamilyInvite()` in `lib/familyDetails.ts` shows the pattern for recovering the real error from `error.context.json()` — reuse this for any future Edge Function calls rather than surfacing the generic message.
- **`profileCompletion.ts`** now tracks `father_name`/`mother_name`/`spouse_name` (plain text) rather than the old `father_id`/`mother_id`/`spouse_id` placeholders — deliberately, so the completion bar doesn't require an actual registered-member match to read as "complete."

---

## 6. Known gaps / things to decide in Phase 3+

- **Real family tree** (siblings, grandparents, a graph/visualization, linking to an already-registered member's own row with their consent) is still fully deferred — nothing in this phase builds toward it structurally beyond the general "search a registered member" RPC pattern.
- **Duplicate relatives are possible and unreconciled.** If your spouse (or father, etc.) is already a registered member, this phase has no way to detect and merge — inviting or naming them just stores text/a matched code on your own row; there's no cross-checking against what your spouse may have entered about you on their own row.
- **Multiple children supported; only one each of father/mother/spouse/maternal uncle/spouse's-father/spouse's-mother.** No UI for e.g. a second maternal uncle.
- **Edge Function deploys are manual** (§3) — no CI hook exists yet for `supabase/functions/`.
- **Invite emails are unlimited and untracked** — by design (§1), but means no rate-limiting or "you already invited this person" UX exists. Worth revisiting if abuse or duplicate-invite complaints come up.

---

## 7. Before you start Phase 3

1. Confirm migrations `0006`–`0009` are applied (verify `family_invites` does NOT exist — `0009` should have dropped it — and that `people` has the new `*_name`/`*_member_code` columns).
2. Confirm the `send-family-invite` function is deployed and `RESEND_API_KEY` (and ideally `RESEND_FROM_ADDRESS` on a verified domain) is set — test by sending yourself an invite end-to-end before assuming it works.
3. Read §4 (SPA deep-linking gap) before building anything in Phase 3+ that emails or links to a specific in-app path.
