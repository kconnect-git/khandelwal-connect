# Phase 5b-2 Summary — Handoff to Phase 5c

Read this before starting Phase 5c (in-app notices). It documents what shipped in 5b-2 (moderation and admin management) on top of the 5b-1 console shell. Treat this file plus `phase-1-summary.md` … `phase-5b1-summary.md` as the source of truth for current schema and app structure.

---

## 1. What Phase 5b-2 is

The second half of the admin console: business moderation, the events queue rebuilt with tabs and search, a full audit-log page, and admin management. With this, Phase 5's original "admin console" scope is done except notices (5c).

| Decision | What was chosen |
|---|---|
| Hiding a business | Any admin. Reason **required**. Owner sees it as a banner on Profile → Business. **No email.** |
| Who manages admins | super_admin only. Any admin can *see* the Admins list (read-only for moderators). |
| Adding an admin | Pick an **approved member** — no invite-by-email path into the console. |
| Safety rails | You can't change or remove **yourself**; there must always be **at least one super_admin**. |
| Events pill | No separate Events section in the console nav — the Events tab inside Approvals is the queue. |

## 2. Schema / backend (migration `0021_admin_moderation.sql`, mirrored in `ddl/core_schema.sql` + `ddl/enable_rls.sql`)

**`businesses`** gains `is_hidden boolean not null default false`, `hidden_reason`, `hidden_by` (→ auth.users), `hidden_at`.

- **`businesses_protect_moderation_columns`** (`before insert or update`). `own business update` is column-blind, so without it an owner could un-hide their own listing through PostgREST. On **update** it raises if any of the four columns change while `current_user = 'authenticated'`; on **insert** it silently resets them, so `createBusiness()` needn't know they exist. Definer RPCs run as the owner and pass — same shape as `people_protect_review_columns`.
- **Member-facing reads skip hidden listings**: `list_businesses`, `get_business`, `list_member_businesses`, `business_filter_options` all add `not b.is_hidden`, and the `members read businesses` policy is now `(is_approved_member() and not is_hidden) or <owner clause>`. The owner clause is what keeps a hidden listing on its owner's Profile → Business tab.

| Function | Notes |
|---|---|
| `admin_list_businesses(p_hidden, p_search, p_category, p_limit, p_offset)` | `is_admin()`. Every listing with owner name / code / status. Search: name, brand, owner. Hidden tab ordered by `hidden_at desc`. Clamp 1–100. |
| `admin_set_business_hidden(p_business_id, p_hidden, p_reason)` | `is_admin()`. Refuses a no-op; reason required to hide; unhide clears all four columns. Audited `business_hidden` / `business_unhidden`, `target_type 'business'`. |
| `admin_list_events(p_status, p_search, p_limit, p_offset)` | **Signature change** (`p_search` — title / organiser / city), so 0021 drops the 3-arg version first. The old frontend still works against it: it calls by named args and `p_search` defaults to null. |
| `admin_list_admins()` | Any admin. `admins` left-joined to `people` + `auth.users`, so a hand-seeded admin with no profile still appears (person columns null). super_admins first. |
| `admin_grant(p_person_id, p_role)` | super_admin. Role check runs **before** the person lookup so a non-admin can't probe ids. Target must be approved with an auth user, and not already an admin. |
| `admin_set_role(p_auth_user_id, p_role)` / `admin_revoke(p_auth_user_id)` | super_admin; never on yourself; refuse leaving zero super_admins, checked under `lock table admins in share row exclusive mode`. (With self-changes refused the caller is always a surviving super_admin, so the count check is belt-and-braces.) Revoke leaves membership untouched. |
| `admin_require_super_admin_for(uuid)`, `admin_log_admin_change(uuid, text, text)` | Internal helpers, revoked from `public, anon, authenticated`. Admin changes are logged as `admin_granted` / `admin_role_changed` / `admin_revoked` with `target_type 'person'` and the target's **person id** (when they have one), so the entry links to their member page and appears in its History. Notes carry the role (`moderator -> super_admin`). |
| `admin_overview_stats()` | + `businesses_hidden`. |
| `admin_list_audit_log` (fix) | 0020's prefix filter used `LIKE`; `_` is a wildcard, so `'member_'` matched `members_export`. Now `left(action, length(prefix)) = prefix`. 0020 in the repo was patched as well; 0021 re-creates the function for databases that already ran the old 0020. |
| `assign_member_code_for` (grant hole) | Now revoked from `anon, authenticated` by name. Before this, any signed-in user could call it for any person id (Supabase's default privileges grant execute on new public functions directly — `revoke … from public` never undid that). |

**Rule going forward**: any function that must not be client-callable needs `revoke all on function … from public, anon, authenticated;`. The remaining `from public`-only helpers (`check_event_fields`, `check_relative_dob`, `normalize_optional_email`, `normalize_relative_mobile`) are pure validators with no side effects, so they were left alone.

## 3. What shipped in the app

| Route | Component | Notes |
|---|---|---|
| `/admin/businesses` | `routes/admin/AdminBusinesses.tsx` | `TabStrip` Visible / Hidden (`?view=hidden`), search, category `ChipSelect` (`?category=`), `DataTable`, Load more. Hide → `ConfirmDialog` with required reason; Unhide → plain confirm. Owner links to `/admin/members/:id`; "View" only when the owner is approved (the public page wouldn't resolve otherwise). |
| `/admin/approvals?tab=events` | `components/admin/EventApprovals.tsx` | Rewritten in `MemberApprovals`' shape: `TabStrip` Pending · Approved · Rejected · Cancelled (`?status=`, merged into the parent's query string), debounced search, Load more (20/page). Pending: Approve / Reject / Cancel; Approved: Cancel event; Rejected shows the reason; Cancelled is read-only. |
| `/admin/audit` | `routes/admin/AdminAudit.tsx` | `TabStrip` All · Members · Events · Businesses · Admins · Exports (`?type=`), 30/page, built on 5b-1's `AuditList`. |
| `/admin/admins` | `routes/admin/AdminAdmins.tsx` | Admin list (you're marked "(you)" and get no controls on your own row). super_admins get a role `<select>` (change opens a confirm) and Remove per row, plus **Add an admin**: search approved members (`admin_search_members({ status: 'approved' })`, ≥ 2 chars), pick a role, Add. Moderators see the list read-only with a note. |
| Profile → Business | `components/businesses/MyBusinessesEditor.tsx` | Hidden listing: accent banner "Hidden from the businesses directory by an admin" + reason; the "View" link is dropped. Editing doesn't unhide it. |

- `AdminLayout` sections are now Overview · Approvals · Members · Businesses · Audit log · Admins — six pills, horizontally scrollable on a phone.
- Overview gained a **Hidden listings** tile; the Business listings tile now links to `/admin/businesses`.
- `AdminContext` exposes `authUserId` (used by the Admins page to spot "you").
- Audit rows for businesses link to `/admin/businesses` (not `/businesses/:id`, which 404s for hidden listings). `AUDIT_ACTION_LABELS` covers every action now written.
- `lib/admin.ts`: `adminListBusinesses`, `adminSetBusinessHidden`, `adminListAdmins`, `adminGrant`, `adminSetRole`, `adminRevoke`, `ADMIN_ROLE_LABELS`; `adminListEvents` takes `search`. `types/database.ts`: `BusinessRow` + 4 columns, `AdminBusinessRow`, `AdminListRow`, `AdminOverviewStats.businesses_hidden`, six RPC signatures.

## 4. Known gaps / deferred

- **A role change only reaches the affected admin on their next load** — `AdminContext` fetches `admin_role()` once per sign-in. Server-side checks apply immediately, so a demoted super_admin just sees buttons the RPCs now refuse.
- **No email when a listing is hidden** (deliberate). The owner finds out from the banner next time they open Profile → Business.
- **A rejected event can't be reopened** — `admin_set_event_status` only moves `pending` → approved/rejected and anything → cancelled. Unchanged from Phase 4.
- **An owner can still delete a hidden listing**; the audit row stays, with a "deleted record" label.
- Bottom-tab and console-pill crowding: six console pills scroll fine, but anything more should become a menu.

## 5. Before you start Phase 5c

1. Apply `0020` (if not yet) and then `0021`, running each verification block. Deploy the frontend after.
2. Smoke test:
   - Hide a business with a reason → gone from `/businesses`, from the owner's `/members/:id`, from the business filter chips, and from `/businesses/<id>`. The owner sees the banner on Profile → Business. Unhide → back everywhere.
   - As the owner in the browser console: `await supabase.from('businesses').update({ is_hidden: false }).eq('id', '<hidden id>')` → "Only an admin can hide or unhide a listing".
   - Events: each tab lists the right rows; search by organiser name; Load more past 20.
   - Audit log: "Members" no longer shows CSV exports; "Exports" does.
   - Admins (as super_admin A): add member M as moderator → M sees the Admin tab after reload, no Export button. Change M to super_admin, then remove M. Your own row has no controls. With a second super_admin B, B can demote A; neither can demote themselves.
   - As a moderator: Admins page is read-only; `await supabase.rpc('admin_grant', { p_person_id: '<id>', p_role: 'moderator' })` → "Only a super admin can manage admins".
   - `await supabase.rpc('assign_member_code_for', { p_person_id: '<id>' })` as any member → permission denied.
3. Phase 5c (notices) from the original plan: `notices` + `notice_reads`, audience targeting by state / city / gotra / occupation, a composer with a live "will reach N members" count (`admin_filter_members`'s WHERE is a ready model for the targeting predicate), a dashboard strip and a header bell. Add it as a seventh console section only if the pills still fit; otherwise this is the moment for a section menu.
