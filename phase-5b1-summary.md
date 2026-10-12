# Phase 5b-1 Summary — Handoff to Phase 5b-2

Read this before starting Phase 5b-2. It documents what shipped in 5b-1 (the admin console shell and the members side of it) and the decisions behind it. Treat this file plus `phase-1-summary.md` … `phase-5a-summary.md` as the source of truth for current schema and app structure.

---

## 1. What Phase 5b-1 is

5a left the admin surface as one Approvals page. Phase 5b was split during planning:

| Half | Scope |
|---|---|
| **5b-1** (this) | Console shell + `AdminContext`, Overview, members table with filters + CSV, member detail view, resend status email, the non-member-admin fix |
| **5b-2** (next) | Businesses moderation, events queue rewrite, full audit-log page, admin management |

Decisions taken during planning that 5b-2 must keep:

| Decision | What was chosen |
|---|---|
| CSV export | **super_admin only**, enforced in the RPC; every export is written to `admin_audit_log` as `members_export` with the filters and row count |
| Hiding a business (5b-2) | Reason required; owner sees a banner with it on Profile → Business; **no email** |
| Adding an admin (5b-2) | A super_admin picks an **existing approved member**. Refuse removing/demoting the last super_admin, and refuse changing your own role |

## 2. Schema / backend (migration `0020_admin_console.sql`, mirrored in `ddl/core_schema.sql`)

No table, column or policy changes. Nothing here alters what members can see. No Edge Function changes.

| Function | Notes |
|---|---|
| `admin_filter_members(...)` | The shared WHERE clause behind search and export, so the two can't disagree. Returns `(person people, email text)`. Gated on `is_admin()` itself **and** revoked from `public, anon, authenticated` (see §5). |
| `admin_search_members(p_status, p_search, p_state, p_city, p_gotra, p_occupation, p_limit, p_offset)` | The members table. `p_status` null = everyone but `onboarding`; `'onboarding'` can be asked for explicitly. Search: name / code / mobile / **login email**. Newest sign-ups first; clamp 1–100. `admin_list_members` is untouched — the queue still uses it for its queue ordering. |
| `admin_member_filter_options()` | (kind, value) for state / city / gotra across everyone who has submitted. Occupation is the fixed `OCCUPATION_OPTIONS` client-side. |
| `admin_export_members(...)` | Same filters, no row cap, super_admin only, plpgsql because it writes the audit row after `return query` (`get diagnostics row_count`). |
| `admin_get_member(uuid) → jsonb` | `to_jsonb(people row)` + `email`, `reviewed_by_name`, `family_relations`, `children`, `businesses`. Null for a non-admin or unknown id. The jsonb also carries the frozen pre-3b relation columns — the TS type deliberately doesn't expose them. |
| `admin_list_audit_log(p_target_id, p_action_prefix, p_limit, p_offset)` | The first reader of `admin_audit_log`. Joins the acting admin's name and resolves `target_label` per `target_type` (person → name, event → title, business → name; null if the target was deleted). Clamp 1–50. |
| `admin_overview_stats() → jsonb` | `members_by_status` (only statuses with rows — client defaults the rest to 0), `signups_7d/30d`, `events_pending`, `events_upcoming`, `businesses`. |
| `admin_list_events` (fix) | `cross join me` → `left join me on true`. Since 0019 `me` only has a row for an approved member, so an admin who wasn't one got **zero rows**. |

The migration was generated from the mirror (function text extracted verbatim), as in 5a.

## 3. What shipped in the app

| Route | Component | Notes |
|---|---|---|
| `/admin` | `routes/admin/AdminLayout.tsx` + `AdminOverview.tsx` | Layout = the single UI admin gate ("Checking access…" / "Not authorised") + pill section nav + `<Outlet/>`, `max-w-5xl`. Overview = 9 counter tiles (the two "awaiting review" tiles accent-coloured when non-zero, linking into the queue) + last 10 audit rows. |
| `/admin/approvals` | `AdminApprovals.tsx` | Unchanged behaviour; lost its own gate and page chrome. |
| `/admin/members` | `AdminMembers.tsx` | Was a redirect in 5a; now the table. Search + 5 `ChipSelect` filters, all in the query string (`?q=&status=&state=&city=&gotra=&occupation=`). `DataTable`, Load more (25/page), **Export CSV** button only when `role === 'super_admin'`. |
| `/admin/members/:id` | `AdminMemberDetail.tsx` | Review panel (dates, reviewer, admin message, decision buttons, **Resend status email**), Personal, Background & location, Contact & work, Family, Businesses, History (that member's audit rows). |
| `/admin/events` | redirect | → `/admin/approvals?tab=events`, as before. |

All `/admin/*` routes are nested under one `<AuthGate requireComplete allowPending>` — `allowPending` is the fix for a pending admin being bounced to `/pending`.

**New shared pieces**

- `context/AdminContext.tsx` — `{ role, isAdmin, loading, refresh }`. Listens to `onAuthStateChange` and calls `admin_role()` once per signed-in user (null = not an admin). Mounted inside `ProfileRefreshProvider` in `App.tsx`. `hooks/useIsAdmin.ts` was **deleted**; `Layout` and `MemberApprovals` read the context. 5b-2's Admins page must call `refresh()` after changing roles.
- `hooks/useMemberDecision.tsx` — the approve / request info / turn down / revoke dialog, `adminSetMemberStatus`, then `sendMemberStatusEmail`, lifted out of `MemberApprovals`. Returns the openers, `busyId`, `error`, the `dialog` element and an `emailNote` element. A failed email now keeps the target and offers **Retry**, which resends without re-running the decision.
- Resend = `resendMemberStatusEmail(id, currentStatus)` in `lib/admin.ts`: it just calls `send-member-status` with the member's *current* status. The function's existing "row status must still match" guard (409) is what makes that safe.
- `components/admin/AuditList.tsx` — compact audit rows; `members_export` notes (JSON) are rendered as `rows: 42, state: …`. `auditActionLabel` / `auditTargetHref` in `lib/admin.ts` — 5b-2 should add its new actions to `AUDIT_ACTION_LABELS` (unknown ones fall back to the raw string).
- `components/admin/StatusBadge.tsx`, `formatAdminDate` / `formatAdminDateTime` in `lib/admin.ts`.
- `components/ChipSelect.tsx` — was two identical private copies in `Directory.tsx` and `Businesses.tsx`; now shared, and accepts `{ value, label }` options as well as strings.
- `lib/csv.ts` — `toCsv` (RFC 4180 quoting, CRLF, **UTF-8 BOM** so Excel reads Hindi correctly, and a leading `'` on cells starting `= + - @` to stop formula injection — which also keeps `+91…` mobiles as text) and `downloadCsv`.

**Nav**: the Admin tab now points at `/admin` (Overview).

## 4. Types

`types/database.ts` gained `AdminSearchMemberRow`, `AdminMemberFilters`, `AdminMemberExportRow`, `AdminMemberDetail`, `AuditLogRow`, `AdminOverviewStats`, and six RPC signatures.

## 5. Known gaps / things worth knowing

- **(Closed in 0021)** **Supabase grants execute on new `public` functions to `anon` and `authenticated` directly** (default privileges). `revoke … from public` does not undo that. 0020 revokes `admin_filter_members` from both roles by name and also gates it on `is_admin()`. **`assign_member_code_for(uuid)` from 0019 has the same latent problem** — the 5a summary calls it "not granted", but it only has `revoke … from public`, so any signed-in user can probably call it for any person id (it would only assign a code to someone missing one — low impact, but worth closing in 0021 with `revoke … from anon, authenticated`). Check with `select has_function_privilege('authenticated', 'assign_member_code_for(uuid)', 'execute');`.
- **An admin with no `people` row at all** is still sent to `/onboarding` by `AuthGate requireComplete`. Not an issue with 5b-2's "pick an approved member" grant flow; only a hand-seeded admin hits it.
- **A pending admin has no nav tabs** (`showNav` still means approved), so they reach the console by typing `/admin`.
- **(Fixed in 0021)** `admin_list_audit_log`'s prefix filter used `LIKE`, where `_` is a wildcard, so `'member_'` also matched `members_export`. Now an exact `left(...) =` compare; 0020 in the repo was patched too.
- The members table's search box doesn't re-sync if `?q=` changes via back/forward navigation (the filters do).
- Export has no row cap. Fine at ~500 members; revisit if membership grows by an order of magnitude.
- Business names in the member detail aren't links — `/businesses/:id` is member-facing and will hide moderated listings once 5b-2 lands.

## 6. Before you start Phase 5b-2

1. Apply `0020` in the SQL editor and run the verification block at its foot (7 functions present; `admin_filter_members` not executable by `authenticated`; `admin_list_events` uses `left join me on true`). Then deploy the frontend.
2. Smoke test:
   - Admin tab → Overview; counts match `select member_status, count(*) from people group by 1`.
   - Members: filter by state + gotra, search an email; reload — filters persist.
   - As a super_admin, Export CSV → open in Excel: Hindi names render, mobiles keep `+91`; an `members_export` row appears in Recent activity. Flip yourself to `moderator` in SQL → button gone, and `await supabase.rpc('admin_export_members')` raises.
   - Detail page: Request info → email arrives; Resend status email → arrives again; History lists the decision.
   - Seed an admin whose own `member_status` is `pending` → `/admin/*` loads and the Events queue lists rows.
   - Ordinary member → `/admin` shows "Not authorised"; `admin_search_members` returns `[]`, `admin_overview_stats` returns null.
   - Phone width: Members table renders as cards; section pills scroll sideways.

## 7. Phase 5b-2 plan (approved)

**Backend, `0021_admin_moderation.sql`**
- `businesses` + `is_hidden boolean not null default false`, `hidden_reason`, `hidden_by → auth.users`, `hidden_at`; a `businesses_protect_moderation_columns` before-update trigger (same shape as `people_protect_review_columns` — **required**, `own business update` is column-blind, so without it an owner could un-hide themselves).
- `list_businesses`, `get_business`, `list_member_businesses`, `business_filter_options` add `and not b.is_hidden`; policy `members read businesses` → `(is_approved_member() and not is_hidden) or <owner clause>`.
- `admin_list_businesses(p_hidden, p_search, p_category, p_limit, p_offset)`, `admin_set_business_hidden(p_business_id, p_hidden, p_reason)` — reason required to hide; audited `business_hidden` / `business_unhidden`, `target_type 'business'`.
- `admin_list_events` gains `p_search` (signature change → `drop function` + create).
- `admin_list_admins()`, `admin_grant(p_person_id, p_role)`, `admin_set_role(p_auth_user_id, p_role)`, `admin_revoke(p_auth_user_id)` — super_admin only; no self-change; last super_admin protected under `lock table admins in share row exclusive mode`; audited with `target_type 'admin'`.
- Close the `assign_member_code_for` grant (§5).

**Frontend**
- `AdminBusinesses.tsx` — Visible / Hidden tabs, search, Hide (`ConfirmDialog`, reason required) / Unhide. Owner's Profile → Business tab shows "Hidden by an admin: <reason>".
- `EventApprovals.tsx` → the `MemberApprovals` shape: `TabStrip` Pending · Approved · Rejected · Cancelled, search, Load more.
- `AdminAudit.tsx` — full log with action-family filter + Load more, built on `AuditList`.
- `AdminAdmins.tsx` — super_admin only; role selects, Remove, "Add admin" via `admin_search_members({ status: 'approved' })`; `AdminContext.refresh()` after changes.
- Add Businesses · Audit · Admins to `AdminLayout`'s `SECTIONS`, and the new actions to `AUDIT_ACTION_LABELS`.
