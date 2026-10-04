# Phase 5a Summary — Handoff to Phase 5b

Read this before starting Phase 5b (the admin console proper). It documents what shipped in Phase 5a — the **hard member-approval gate** — plus the decisions behind it. Treat this file plus `phase-1-summary.md` … `phase-4-summary.md` as the source of truth for current schema/app structure.

---

## 1. What Phase 5a is

Until now "is a member" meant `member_code is not null` — anyone who finished the onboarding wizard. That was the gate in every cross-member RPC and in the businesses/events read policies, and since 3a it also meant every such person could read every other member's mobile number. 5a puts an admin between onboarding and access.

| Decision | What was chosen |
|---|---|
| The gate | `people.member_status`, not `member_code`. Values: `onboarding` → `pending` → `approved` / `info_requested` / `rejected`. |
| Existing members | **Grandfathered.** The backfill approves everyone who already had a member code, with `reviewed_by` left null as the marker. They notice nothing. |
| Member code | Still issued at **wizard completion**, not at approval. It's deterministic, every existing member has one, and family linking resolves by it — but a non-approved person's code never surfaces anywhere. So "Approve & Issue ID" in the original plan is just **Approve**. |
| What a pending member can reach | `/pending` and `/profile` only. Everything else bounces to `/pending`. No tabs, no member ID in the header. |
| Resubmission | From `info_requested` only. A **rejected member cannot resubmit** — an admin reopens them from the Rejected tab. Deliberate, to stop a rejected applicant looping. |
| Revocation | `approved → rejected` exists and is **super_admin only**. The one role-gated action in 5a. |
| Admin roles | `admins.role` — `super_admin` / `moderator`. Every existing admin was backfilled to `super_admin`. `is_admin()` is unchanged and still means "any admin". |
| Hide my number | A self-editable `people.hide_mobile`. `get_member_profile` and `search_registered_members` return a null mobile when it's set; admins still see it. |
| Email | One Edge Function, three templates, sent by the client after the RPC. Failure is non-fatal. |
| Onboarding wizard | Untouched (no new step). It now lands on `/` instead of `/dashboard`, and `RootRedirect` decides. |

## 2. Schema / backend (migration `0019_member_approval.sql`, mirrored in `ddl/core_schema.sql` + `ddl/enable_rls.sql`)

**Apply `0019` before deploying the frontend.** The new frontend against the old database reads `member_status` as undefined and locks every member out — the strict `=== 'approved'` check in `useProfileStatus` is deliberate for exactly that reason.

**`people`** gains `member_status` (check: onboarding / pending / info_requested / approved / rejected, default `onboarding`), `admin_message`, `submitted_at`, `reviewed_by` (→ auth.users, like `events.approved_by`), `reviewed_at`, `hide_mobile`; index on `(member_status, submitted_at)`.

- `admin_message` is **one** column carrying either the "more info needed" text or the rejection reason — which one is implied by the status. Cleared on approve.
- `'onboarding'` exists so half-finished signups are untouched by the backfill and the client never has to infer "not submitted yet" from nulls.

**`admins`** gains `role` (check: super_admin / moderator, default moderator).

### Two things worth knowing before you extend this

- **`own row update` on `people` is column-blind.** Without protection a member could `update people set member_status = 'approved'` straight through PostgREST — and could already hand-pick their own `member_code`, a hole that had been open since Phase 1. The new **`people_protect_review_columns`** `before update` trigger rejects changes to `member_status`, `admin_message`, `submitted_at`, `reviewed_by`, `reviewed_at` and `member_code` when `current_user = 'authenticated'`. SECURITY DEFINER RPCs run as the owner and pass. `hide_mobile` is deliberately **not** in that list.
- **Eight read RPCs never checked the caller at all** — `search_registered_members`, `list_directory`, `get_member_profile`, `directory_filter_options`, `list_businesses`, `get_business`, `list_member_businesses`, `business_filter_options` only filtered the rows they returned. Any authenticated JWT, even a half-finished wizard, could call them. They now have a caller gate as well as a rewritten target gate.

### The two shapes of gate

Keep these straight when adding anything new:

- **target gate** — "only show rows belonging to approved people": inline, `p.member_status = 'approved'`.
- **caller gate** — "only answer if the caller is approved": `is_approved_member()`.

`is_approved_member()` is a new `security definer stable` helper. **`is_admin()` moved** in `ddl/core_schema.sql` from the Phase 4 section up to a new "membership / admin gate helpers" block above the directory RPCs, because `get_member_profile` now calls it and SQL-language bodies are parsed at creation time. The migration doesn't recreate it — it already exists — so this only matters for a fresh run of the mirror.

**24 gate sites were rewritten**, all `create or replace` with unchanged signatures: 2 RLS policies (`members read businesses`, `events visible read`), 3 family code lookups (`save_family_relation`, `add_child`, `update_child`), `search_registered_members`, 3 directory RPCs, 4 business RPCs, and the 11 event RPCs' `me` CTE / `v_self_id` lookup plus one target check in `add_event_invitee`.

The `members read businesses` policy also gained an **owner clause** (`or owner_id in (select id from people where auth_user_id = auth.uid())`) — `getMyBusinesses()` in `lib/businesses.ts` selects that table directly, so without it a member awaiting approval would lose their own Profile → Business tab.

### RPCs

| Function | Notes |
|---|---|
| `is_approved_member()` | The caller gate. `security definer` so it works inside policies on other tables. |
| `admin_role()` | The caller's role, or null for a non-admin — so it doubles as "am I an admin, and which kind". |
| `assign_member_code_for(uuid)` | The old `assign_member_code` body, now keyed by person id. **Not granted** — reachable only via the wrapper, `submit_for_review` and `admin_set_member_status`. |
| `assign_member_code()` | Unchanged signature; now a thin wrapper that resolves `auth.uid()` and delegates. |
| `submit_for_review()` → text | Own row `for update`. Idempotent for an approved member (returns the code); raises for a rejected one. Mirrors `isWizardComplete()` server-side over the 12 `requiredForWizard` fields (`last_name` excluded, same reason as 0017). Assigns the code, sets `pending` + `submitted_at`. Three callers: `complete_onboarding_step3`, the `useProfileStatus` lazy path, the Resubmit button. |
| `complete_onboarding_step3(...)` | Signature and return unchanged; its `return assign_member_code()` became `return submit_for_review()`. |
| `admin_list_members(p_status, p_search, p_limit, p_offset)` | `is_admin()`. Identity tier + the login email (left join `auth.users` — `people` still has no primary email column) + review columns + `total_count`. Search on name / code / mobile. Pending & info_requested oldest-first; the archive tabs by `reviewed_at desc`. Clamp 1–50. |
| `admin_set_member_status(p_person_id, p_status, p_message)` | Shaped like `admin_set_event_status`. Enforces the state machine under `for update`; `info_requested` / `rejected` require a message; `approved` clears it and calls `assign_member_code_for`; `approved → rejected` needs `admin_role() = 'super_admin'`; writes `admin_audit_log` as `member_<status>` / `target_type 'person'`. |

### Edge Function `send-member-status`

`supabase/functions/send-member-status/index.ts` — deploy with `supabase functions deploy send-member-status` (manual, like the other two). Same secrets (`RESEND_API_KEY`, optional `RESEND_FROM_ADDRESS`, `SITE_URL`).

- Request `{ person_id, status }`. Response `{ ok: true }` or `{ error }`.
- **No message in the body** — the admin's note and the member code are read back out of the row, so the email can never say something the database doesn't.
- Guards in order: JWT → caller is in `admins` (service role; never a client flag) → person exists → **`person.member_status` still equals the announced status** (409 otherwise, which blocks a replayed or stale call) → login email via `auth.admin.getUserById`.
- Called from the client **after** the RPC commits. A failure is reported as a muted note ("Saved, but the email could not be sent"), never as a failed review.

## 3. What shipped in the app

| Route | Component | Notes |
|---|---|---|
| `/pending` | `routes/PendingApproval.tsx` | Three faces driven by `member_status`: under review / more information needed (admin's note + accent **Resubmit for review**) / not approved (reason, no resubmit). Plus Edit profile and Log out. Reads `useProfileRefresh().version` as its status key so a resubmit re-renders. |
| `/admin/approvals` | `routes/admin/AdminApprovals.tsx` | The admin landing page. One `useIsAdmin` gate for both queues, then a `TabStrip` (`?tab=`) over **Members** and **Events**, each labelled with its pending count. `/admin`, `/admin/members` and `/admin/events` redirect here (the last two are Phase 4 / early-5a paths that appear in the summaries and in bookmarks). |
| — | `components/admin/MemberApprovals.tsx` | The member queue panel: `TabStrip` (Pending · More info · Approved · Not approved, `?status=`), debounced search, Load more, `DataTable` rows, per-row Approve / Request info / Turn down, and Revoke for super_admins on the Approved tab. |
| — | `components/admin/EventApprovals.tsx` | Phase 4's event queue as three `DataTable` sections (Pending / Recently approved / Recently rejected). It lost its own gate/chrome, dropped `EventCard` (still used by the member-facing `/events` and `/events/mine`), and **swapped `window.prompt` / `window.confirm` for `ConfirmDialog`** — the two panels now sit behind one tab strip, so they had to ask for a reason the same way. |
| `/profile` | `routes/Profile.tsx` | Now `allowPending`. Back link goes to `/pending` when not approved; an accent banner shows the admin's request; the Contact tab gained the **Hide my number** toggle (saves on toggle, optimistic, not via the tab's Save button). |

**New components**: `components/ConfirmDialog.tsx` — a small real modal with an optional required textarea, replacing Phase 4's `window.prompt` / `window.confirm` approach. Both approval panels use it; 5b should reuse it for businesses moderation and notices.

**`components/admin/DataTable.tsx`**: admin lists are scanned down a column, not read one row at a time, so both queues render as tables. A plain `<table>` is unusable on a phone, so this renders the same `columns` array two ways and lets CSS pick: a real table from **`md:` (768px)** up, and one stacked card per row below it, where each cell becomes a label/value pair. The switch is `md:`, not `sm:` — at 640px a six-column table is already crushed, so tablets are better served by cards. Above the breakpoint the table carries `min-w-[44rem]` inside an `overflow-x-auto` wrapper, so a wide row scrolls within the table instead of dragging the page sideways. Nothing is dropped on the narrow layout unless a column sets `mobile: 'hidden'`. Because both layouts come from one array, a new field can't drift between them. `AdminApprovals` is `max-w-5xl` rather than the member-facing `max-w-2xl` to give the columns room.

**Admin page structure**: the panels under `components/admin/` are deliberately split from the route so 5b can drop them into a proper `AdminLayout` (Overview / Approvals / Members / Businesses / Audit / Admins) without unpicking them. Each panel takes an optional `onChanged` callback, which `AdminApprovals` uses to refresh the pending counts on its tabs after a decision. Note that both panels and the parent write to the same query string: the member panel merges `?status=` rather than replacing, so the parent's `?tab=` survives.

**Auth flow**: `useProfileStatus` gained the state **`awaiting_approval`** (wizard done, not approved). Its lazy path now calls `submit_for_review` instead of `assign_member_code`, which also moves `onboarding` → `pending` and catches the historical rows that completed the wizard but never got a code. `AuthGate` gained `allowPending`; `RootRedirect` routes `awaiting_approval` → `/pending`; the wizard's Finish and its already-done guard both navigate to `/` and let `RootRedirect` choose.

**Nav**: admins get a **sixth tab, "Admin"**, after Profile — Phase 4's `UserMenu` `adminHref` is gone and `UserMenu` is back to member ID + log out. The tab lands on `/admin/members`; `isActive` lights it for any `/admin/*` path, and `/admin/events` carries a "← Members" link since the menu route to it no longer exists. `HeaderNav` and `BottomTabs` both take an `isAdmin` prop.

Phase 4 called five tabs the width ceiling at 360px, and this makes six. Two mitigations: the label drops from `text-[11px]` to `text-[10px]` **only** when the sixth tab is present, so ordinary members keep the tuned size; and each tab got `min-w-0 overflow-hidden`, because a flex item's default `min-width: auto` would otherwise let a too-wide label push the whole bar past the viewport instead of clipping. At 10px the longest label ("Businesses") needs roughly 50px against a 53px share on a 320px screen, so it should not actually clip — but **this is the one thing in 5a worth checking on a real phone**, and if a seventh section ever arrives the bar needs a "More" menu rather than another notch down.

`showNav` still means approved, so a pending member gets the header and account menu but no tabs, and the member ID stays hidden until approval.

**Lib**: `lib/people.ts` gained `submitForReview`, `setHideMobile`, `MEMBER_STATUS_LABELS`. `lib/admin.ts` gained `adminRole`, `adminListMembers`, `adminSetMemberStatus`, `sendMemberStatusEmail`, `AdminMemberDecision`. `types/database.ts` gained `MemberStatus`, `AdminRoleName`, `AdminMemberRow`, the six new `Person` columns, `AdminRow.role`, and five RPC signatures.

## 4. How the migration was built (repeat this in 5b)

0019 has to `create or replace` 22 existing functions just to change one predicate in each, because Postgres can't patch a function body. Those bodies were **not retyped**. `ddl/core_schema.sql` was edited first (line-targeted substitutions, each one a reviewable diff), then the migration was generated by extracting the finished function text straight out of the mirror. That guarantees the migration and the mirror can't drift, and it keeps the risky part — the ~6 genuinely new functions — small enough to read.

The generator lived in the scratchpad and isn't committed; it was ~60 lines of Python that pulled `create or replace function <name>` through its closing `$$;` plus the trailing revoke/grant lines. Worth rebuilding if 5b needs another bulk regate.

## 5. Known gaps / deferred

- **A pending member can't link relatives by member code.** `search_registered_members` returns nothing to a non-approved caller, and the three family code lookups now require an approved target, so `save_family_relation` with a code raises. They can still save plain-text names. Acceptable, but it means the Family tabs are partly inert until approval.
- **No admin management UI.** `admins.role` exists and is enforced, but adding/removing an admin or changing a role is still a hand-written SQL insert. That's 5b.
- **No member detail view for admins.** The queue row shows name, code, city/state, gotra, mobile and email; "View profile" goes to the normal `/members/:id` (which has an `is_admin()` bypass so pending targets open). A full review view over every wizard field is 5b's `admin_get_member`.
- **`admin_list_members` is capped at 50 per page** and has no state/city/gotra filters or CSV export — all 5b.
- **No "resend status email" button.** If the email fails the admin sees a note, but the only recovery is to re-run the decision, which the "already <status>" guard refuses. 5b should add an explicit resend.
- **The event panel is still capped at 50 pending**, with no status tabs, search or pagination — it renders Pending / Recently approved / Recently rejected as three stacked sections. 5b brings it up to the member panel's shape.
- **An admin who is not themselves an approved member is half-locked-out**, and it's silent. Two separate causes, both worth fixing in 5b: `admin_list_events` still has Phase 4's `cross join me` (which now requires `member_status = 'approved'`), so their event queue returns **zero rows** rather than an error; and the `/admin/approvals` route is wrapped in `<AuthGate requireComplete>` without `allowPending`, so they'd be bounced to `/pending` before seeing anything. Neither bites today because every existing admin was grandfathered, but seeding a brand-new admin who hasn't onboarded will trip both. `admin_list_members` deliberately has no such caller gate — only `is_admin()`.
- **Rejected members can't self-resubmit**, by design. If that turns out too harsh, the change is one branch in `submit_for_review`.
- **No rate limit** on `info_requested` → resubmit looping.
- `admin_audit_log` still has **no reader** — the 5a decisions are being recorded and nothing displays them. 5b's `admin_list_audit_log`.

## 6. Before you start Phase 5b

1. Apply `0019`, then run the verification block at the bottom of the migration. In particular:
   ```sql
   select member_status, count(*) from people group by 1;
   -- 'approved' == the old count of member_code is not null; rest 'onboarding'; 0 pending
   select auth_user_id, role from admins;                       -- all super_admin
   select proname from pg_proc where proname in ('is_approved_member','admin_role',
     'assign_member_code_for','submit_for_review','admin_list_members','admin_set_member_status');
   ```
2. Deploy the Edge Function: `supabase functions deploy send-member-status`. Then deploy the frontend — **in that order**.
3. Smoke test with four accounts (A existing, N new, R to reject, plus an admin):
   - A logs in → dashboard unchanged, member ID still in the menu.
   - N finishes the wizard → lands on `/pending`; typing `/directory` bounces back; N is absent from A's directory and from A's relative search; A opening `/members/<N>` gets nothing.
   - Admin → Request info → N gets an email, sees the note on `/pending` and a banner on `/profile`, edits, Resubmits → back in Pending with "You asked: …".
   - Admin → Approve → N gets the welcome email with their member ID, reloads, lands on the dashboard, appears in the directory.
   - Admin → Turn down R → R sees the reason and has no Resubmit button; the admin can still Approve from the Not approved tab.
   - A toggles Hide my number → B sees "Hidden by this member" on A's profile; the admin queue still shows it.
   - Flip an admin to `moderator` in SQL → Revoke disappears from the Approved tab and the RPC refuses it.
   - In the browser console as an ordinary member, `update people set member_status='approved'` must raise.
4. Phase 5b builds the console shell around this: `/admin/*` layout with tabs, an `AdminContext` so `is_admin()` / `admin_role()` are fetched once rather than per page, a real members table with filters and CSV, businesses moderation, the events queue rewritten onto the shell, the audit log viewer, and admin management. Extend `admins`; don't add a role column to `people`.
