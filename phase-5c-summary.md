# Phase 5c Summary — Handoff to Phase 6

Read this before starting Phase 6 (matrimony). It covers what shipped in 5c, in-app notices, which completes Phase 5. Treat this file plus `phase-1-summary.md` … `phase-5b2-summary.md` as the source of truth for current schema and app structure.

---

## 1. What Phase 5c is

Admins can send announcements to members inside the app, targeted by where members live and who they are. In-app only: no email or push.

| Decision | What was chosen |
|---|---|
| Who publishes | **Any admin** (moderator or super_admin) |
| Lifecycle | `draft` → `published` → `withdrawn`, one way only. A withdrawn notice can't be revived; start a new one |
| Lifetime | Optional **"show until"** date (end of that day, the admin's timezone). Without one it shows until withdrawn |
| Targeting | Four multi-select lists (states, cities, gotras, occupations). **OR within a list, AND across lists**; an empty list = no restriction, so all empty = every approved member |
| Scheduling | None. Save a draft, publish when ready |
| Editing live notices | Allowed (typos shouldn't need a withdraw and reissue), audited as `notice_edited`. It doesn't reset anyone's read state |

## 2. Schema / backend (migration `0022_notices.sql`, mirrored in `ddl/core_schema.sql` + `ddl/enable_rls.sql`)

**`notices`**: `title` (≤120), `body` (≤4000), `audience_states/cities/gotras/occupations text[]` (default `{}`), `status`, `expires_at`, `created_by` / `published_by` (→ auth.users), `published_at`, `withdrawn_at`, timestamps. Index `(status, published_at desc)`.

**`notice_reads`**: `(notice_id, person_id)` primary key + `read_at`. Unread = no row. Both FKs cascade on delete.

Both tables are **RPC-only**: RLS enabled, no policies. Same model as events.

**The audience is matched at read time** against the member's *current* profile, so moving city changes which notices you see. A member with a null field (no gotra on file, say) never matches a list that restricts that field. There's no snapshot of who a notice "was sent to"; `reach_count` is always "who matches now".

| Function | Notes |
|---|---|
| `notice_audience_matches(...)` | The one audience predicate, pure SQL, used by every function below. Revoked from `public, anon, authenticated`. |
| `notice_clean_list(text[])` | Trims, drops blanks, dedupes and sorts an audience list before it's stored. Revoked likewise. |
| `list_my_notices(p_active_only, p_limit, p_offset)` | Published, matching notices, newest first, with `is_active` (not expired) and `is_read`. Expired notices are included unless `p_active_only`. The approved-only `me` CTE is the caller gate. Clamp 1–50. |
| `notice_unread_count()` | Active, matching and unread. 0 for anyone who isn't an approved member. |
| `mark_notices_read(p_notice_id)` | One notice, or all the caller can see when null. Skips notices outside the caller's audience, so it can't be used to probe which notices exist. |
| `admin_count_notice_audience(states, cities, gotras, occupations)` | The composer's live count of approved members. |
| `admin_list_notices(p_status, p_notice_id, p_limit, p_offset)` | Notice columns, creator and publisher names, `reach_count`, `read_count`. `p_notice_id` fetches one for the editor. Each tab sorts by when the notice entered it. |
| `admin_save_notice(p_notice_id, title, body, 4 lists, p_expires_at) → uuid` | null id = new draft. Validates title and body lengths, occupation values (mirrors `OCCUPATION_OPTIONS`) and a future expiry. Withdrawn notices can't be edited. Edits to published notices are audited. |
| `admin_set_notice_status(p_notice_id, 'published' \| 'withdrawn')` | draft → published (refuses an already-expired draft); published → withdrawn. Audited as `notice_published` / `notice_withdrawn`. |
| `admin_delete_notice(p_notice_id)` | Drafts only, not audited (nobody saw them). |
| `admin_list_audit_log` | `target_type 'notice'` resolves to the notice title. |
| `admin_overview_stats` | + `notices_active`. |

## 3. What shipped in the app

**Members**

| Where | Component | Notes |
|---|---|---|
| Header | `components/NoticeBell.tsx` | Bell with an unread badge (9+ cap), linking to `/notices`. Shown with the nav, i.e. approved members only. It sits in the header, not the tab bar, which was already at its width limit. |
| `/notices` | `routes/Notices.tsx` | Every notice addressed to you, newest first, 20 per page. Opening the page **marks them all read**. The "New" tags come from the loaded state, so they stay for that visit while the bell clears. Expired notices are dimmed with an "Expired" label. |
| Dashboard | `components/NoticeStrip.tsx` | Up to 3 active unread notices at the top, each with **Dismiss** (marks it read, optimistically), plus "N more · all notices". Renders nothing when there's nothing unread. |

`context/NoticesContext.tsx` holds the unread count. It refetches on sign-in, on every navigation (one cheap count), and on `refresh()`, which the page and the strip call after marking read. It's mounted inside `AdminProvider` in `App.tsx`, because it needs the router (`useLocation`).

**Admins**

| Route | Component | Notes |
|---|---|---|
| `/admin/notices` | `routes/admin/AdminNotices.tsx` | `TabStrip` Drafts · **Published** (default) · Withdrawn (`?status=`). Shows the audience summary, "Would reach N" for drafts or "read / reach" otherwise, the date, and the expiry. Drafts: Publish / Edit / Delete. Published: Edit / Withdraw, plus an "Expired" tag when the date has passed. "New notice" button. |
| `/admin/notices/new`, `/admin/notices/:id` | `routes/admin/AdminNoticeEditor.tsx` | Title (120), message (4000, with a counter), audience via `MultiChipSelect` (state, city and gotra options from `admin_member_filter_options`; occupations from `OCCUPATION_OPTIONS`), live **"Will reach N approved members"** (debounced; turns accent with a warning at 0, and **Publish is disabled at 0**), optional date, and a live preview. Draft: Publish + Save draft. Published: Save changes + Withdraw. Withdrawn: read-only. Saving a new draft redirects to its `:id` URL; a failed publish after a successful save does too, so a retry doesn't create a duplicate. |

- `components/MultiChipSelect.tsx`: chosen values as removable accent chips, plus a `ChipSelect` offering what's left.
- Console nav: **Notices** pill after Businesses (7 pills, scrolling sideways on a phone). Overview: an **Active notices** tile. Audit log: a **Notices** filter tab, and notice rows link to the editor.
- `lib/notices.ts` holds both the member and admin wrappers, plus `audienceSummary`, `noticeAudience`, `EMPTY_AUDIENCE`, and `expiryFromDateInput` / `dateInputFromExpiry`. `types/database.ts` adds `NoticeStatus`, `NoticeAudience`, `MemberNoticeRow`, `AdminNoticeRow`, `AdminOverviewStats.notices_active` and 8 RPC signatures.

## 4. Known gaps / deferred

- **No email or push delivery.** A member only sees a notice by opening the app. Push is Phase 7's job ("push notifications wired for approvals, events, notices"); the natural hook is `admin_set_notice_status(..., 'published')`.
- **No snapshot of recipients.** Reach and read counts are "who matches now", so they drift as members move city, get approved, and so on.
- **The audience options only list values that already exist** on submitted profiles. You can't target a city nobody lives in yet, which is deliberate.
- **Expiry is date-only**, ending at 23:59:59 in the *admin's* browser timezone. Fine for an India-only audience.
- **The bell count refreshes on navigation, not live.** A notice published while a member is idle on one page shows up on their next navigation.
- Saving a brand-new draft remounts the editor on its new URL, so the "Draft saved." note doesn't survive that first save. Later saves show it.
- The console now has 7 pills. Another section should become a menu, not an eighth pill.

## 5. Before you start Phase 6

1. Apply `0022` and run its verification block, then deploy the frontend.
2. Smoke test (admin A, members M1 in Jaipur/Business and M2 in Delhi/Job):
   - Composer: with an empty audience the count equals your approved member count. Add state Rajasthan and the count drops. Add occupation Job alongside it and the count only includes Rajasthan members with Job.
   - Publish "Test" to city Jaipur. M1 sees the bell badge, the dashboard strip and the `/notices` card. M2 sees nothing, and `mark_notices_read('<id>')` as M2 inserts no row.
   - M1 dismisses it on the dashboard: the strip entry goes and the bell clears. Publish a second notice; opening `/notices` clears the bell while the "New" tag stays for that visit.
   - Edit the live notice's title: M1 sees the new title, still read. An audit row `Edited published notice` appears.
   - Set an expiry to today, then (via SQL, back-dating `expires_at`) check that it leaves the bell and dashboard but stays on `/notices` as "Expired".
   - Withdraw: it vanishes for members, and the editor goes read-only.
   - As a moderator: everything above works. As an ordinary member: `supabase.from('notices').select()` returns `[]` and `admin_save_notice` raises "Not an admin".
   - Phone width: the bell fits in the header next to the theme toggle and avatar, and the composer's chips wrap.
3. Phase 6 (matrimony) per §9 of the project context: matrimony profile with opt-in tags, browse/filter, express interest with mutual-consent gating, and admin verification. `phase-4-summary.md` recommends copying the **events** access model (RPC-only writes), and the admin verification queue fits as an eighth console section. That's the point to replace the pill row with a menu.
