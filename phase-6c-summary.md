# Phase 6c Summary — Handoff to Phase 7

6c completes Phase 6 (matrimony). Read this with `phase-6a-summary.md` (profiles + verification) and `phase-6b-summary.md` (browse + interests + unlock). Treat these plus `phase-1-summary.md` … `phase-5c-summary.md` as the source of truth.

---

## 1. What Phase 6c is

| Feature | Behaviour |
|---|---|
| **Pause** (owner) | `approved ↔ paused`. Out of browse; can't send or reply to interests. Existing matches keep working, and the member still sees Interests / Matches |
| **Un-match** (either side) | Interest → `ended`, which re-locks photos and contact. The pair drops out of each other's browse and can't send interest again |
| **Block** (either side) | On **people**, not profiles, so deleting and recreating a profile doesn't escape it. Ends any match, withdraws the blocker's pending interest and silently declines theirs. Hidden both ways from browse, detail and every interest box. Unblock from `/matrimony/profile` (an ended match stays ended) |
| **Report** | A reason (Fake profile / Inappropriate content / Already married / Harassment / Other, which needs details) + details ≤1000 + "Also block" (on by default). Admins only. One open report per reporter per member. Allowed for a profile you can see, have had an interest with, or have blocked |
| **Admin hide** | `approved / paused → hidden` with a reason the owner sees in their banner; unhide → live. The owner can still edit while hidden |
| **Delete my profile** | Removes the profile, photos (rows + files), interests and matches. Blocks and reports stay (they're on people). A rejected profile's way out: delete, then start a new one that needs verifying again |

**The 6b open question, decided:** a match only unlocks anything while **both profiles are active**: approved or paused, and the member still eligible. So marrying, being hidden or being turned down suspends that member's matches for both sides. It's reversible: unhide, and the matches come back. This is all in `matrimony_is_matched`, which the storage policy, detail, Matches box and badge all go through.

## 2. Schema / backend (migration `0025_matrimony_safety.sql`, mirrored in `ddl/core_schema.sql`, `ddl/enable_rls.sql`)

- `matrimony_profiles.status` + `paused`, `hidden`. `matrimony_interests.status` + `ended`, plus `ended_by_profile_id`, `ended_at`.
- **`matrimony_blocks`** `(blocker_person_id, blocked_person_id)` PK. **`matrimony_reports`**: reporter/reported person ids, `reason`, `details`, `status` open/resolved, `resolution_note`, `resolved_by/at`; a partial unique index enforces one open report per pair. Both RPC-only.
- In `core_schema.sql`, the 6c helpers sit where 6b's `matrimony_is_matched` was, ahead of everything that calls them, because SQL-language function bodies are checked against what already exists when they're created.

| Function | Notes |
|---|---|
| `matrimony_profile_active(id)` / `matrimony_my_active_profile_id()` | approved-or-paused + eligible. Revoked from clients. |
| `matrimony_is_blocked(a, b)` / `matrimony_is_ended(a, b)` | Either direction. Revoked from clients. |
| `matrimony_is_matched` | **Changed**: accepted AND both active. |
| `list_matrimony_profiles`, `get_matrimony_profile`, `express_interest`, `respond_interest`, `list_my_interests`, `matrimony_badge_count` | Re-stated. They exclude blocked / ended pairs. `get_matrimony_profile` now works for a paused caller (matches only) and returns `match_interest_id`. Replying needs a live profile. |
| `set_matrimony_paused(bool)`, `end_matrimony_match(interest_id)`, `block_matrimony_profile(profile_id)`, `unblock_matrimony_person(person_id)`, `list_my_matrimony_blocks()`, `report_matrimony_profile(profile_id, reason, details)`, `delete_my_matrimony_profile() → text[]` | Member actions. |
| `admin_list_matrimony_reports(status)`, `admin_resolve_matrimony_report(id, note)`, `admin_set_matrimony_hidden(id, hidden, reason)` | Any admin. Resolve and hide/unhide are audited (`matrimony_report_resolved`, `matrimony_hidden`, `matrimony_unhidden`). |
| `admin_set_matrimony_status` | Paused profiles can also be sent back / turned down. |
| `admin_overview_stats` / `admin_list_audit_log` | + `matrimony_reports_open`; + `matrimony_report` target label. |

## 3. What shipped in the app

**Members**
- `/matrimony/profile`: paused / hidden banners, and a **Manage** section (`components/matrimony/ManageMatrimony.tsx`) with Pause / Resume, the Blocked list with Unblock, and Delete (with a confirm).
- `/matrimony/:id`: Un-match (when matched) · Block · Report, quietly at the foot of the page. `components/matrimony/ReportDialog.tsx` has a reason select, details and "Also block". Block (and report + block) returns to `/matrimony`; un-match returns to Matches.
- `/matrimony`: a paused member keeps the Interests / My profile buttons, with a "resume to browse" note instead of the list.

**Admins**
- `/admin/matrimony` tabs: Pending · **Reports** · Changes requested · Live · **Paused** · **Hidden** · Turned down.
- Reports (`components/admin/MatrimonyReports.tsx`) has Open / Resolved views. Each row shows the reported member (flagged in accent when they have several open reports), reason, reporter, profile status and details, with View profile, Hide profile (reason required) and Resolve (optional admin-only note).
- The review screen gains Hide / Unhide.
- The Overview has an **Open matrimony reports** tile; the audit log labels the new actions and links them.

## 4. Known gaps / deferred

- **Reporters aren't told the outcome**, and hidden members aren't emailed. In-app only, like the rest of Phase 6.
- A hidden member has no in-app way to ask for review; they'd contact an admin outside the app.
- Unblocking doesn't restore an ended match (deliberate). The pair also stays un-matched for good, because `ended` blocks re-sending in both directions.
- A member who deletes their profile and makes a new one starts with a clean interest history. Blocks against them still apply.
- Like 0023/0024, **0025 was written without a database to run it against**. It's written to be re-runnable.

## 5. Before you start Phase 7

1. Apply `0025` and run its verification block (the constraint check should list `paused`, `hidden` and `ended`). Deploy the frontend.
2. Smoke test (M1 and F1 matched; F2 live; admin A):
   - **Pause**: M1 pauses. F2 no longer finds him; F1 still sees his contact; M1 sees the "resume to browse" note, and Matches still lists F1. Resume.
   - **Un-match**: F1 un-matches M1. Neither sees the other's contact; `createSignedUrl` on her photo fails for M1; neither appears in the other's browse.
   - **Block**: M1 blocks F2 while F2 has a pending interest to him. She disappears for him and he for her, and her interest is gone from his Received. Unblock from M1's profile page: F2 shows in browse again.
   - **Report**: F2 reports M1 ("Other" without details is refused) with Also block. A sees it under Reports and on the Overview tile, hides M1's profile with a reason, and M1 sees the banner. M1's matches can no longer see him. Unhide: they come back. Resolve the report.
   - **Delete**: a rejected member deletes their profile, the photo files are gone from the bucket, and they can start a new draft.
   - **Marriage**: set a matched member to Married. The match disappears for both; set them back and it returns.
3. Phase 7 per §9 of the context doc: RLS audit (matrimony is a good first target: try each RPC as a non-matched member, a paused member and a blocked member), the EXIF pipeline verified on real uploads, push for approvals / events / notices / **matrimony interests and matches**, PWA install testing.
