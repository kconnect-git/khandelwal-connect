# Phase 4 Summary — Handoff to Phase 5

Read this before starting Phase 5 (admin console). It documents what shipped in Phase 4 — **Events** with member creation, admin approval, public / invite-only visibility, RSVPs and invite emails — plus the decisions behind it. Treat this file plus `phase-1-summary.md` … `phase-3c-summary.md` as the source of truth for current schema/app structure.

---

## 1. What Phase 4 is

The original plan said "admin-created events, members RSVP". During planning that changed to: **any member creates, an admin approves, then members see it.** Decisions locked in (all user-confirmed):

| Decision | What was chosen |
|---|---|
| Who creates | Any onboarded member (`member_code is not null`). New events are `pending`. |
| Approval | Admin moves `pending` → `approved` or `rejected` (with a reason the creator sees). Creator or admin can `cancel`. Only approved events are visible to members. |
| Visibility | `members` (every member can see + join) or `invite_only` (only the creator, admins and people on `event_invites` can see it — `get_event` returns nothing to anyone else, same as a missing business). No "public to the internet" — every viewer is a logged-in member anyway. |
| Invitees | Can be added **only after approval** (server-enforced). Adding an invitee only inserts the row; the person then sees the event on My events. |
| Invite emails | A **separate explicit action**: "Send email" per invitee, or "Email all not yet emailed". `event_invites.emailed_at` tracks who was sent one so the bulk button skips them; individual resend is always allowed. |
| Editing after approval | **Description only.** Title, dates, venue, capacity, visibility are locked; to change them the creator cancels and creates a new event. A pending/rejected event is fully editable and saving resubmits it as pending. |
| RSVP | Join = `rsvps` row with status `going`; Leave flips to `not_going` (never deleted). Capacity and the invite-only check are enforced in `rsvp_event` under a row lock. |
| Cover image | Not built. Text only. |
| Admin UI | A bare `/admin/events` page (approve / reject / cancel) so the flow can be exercised before Phase 5. Not a tab — an item in the account menu, only for admins. |
| Onboarding wizard | Untouched. |

## 2. Schema / backend (migration `0018_events.sql`, mirrored in `ddl/core_schema.sql` + `ddl/enable_rls.sql`)

**Apply `0018` before deploying the frontend.** Pre-check `select count(*) from events;` must be 0 (Phase 0 never inserted anything — `creator_id` is added NOT NULL). Then seed at least one admin:

```sql
insert into admins (auth_user_id) select id from auth.users where email = '<admin email>';
```

**`events`** (Phase 0 placeholder extended in place — `location` → `venue`, `event_date` → `starts_at`): `creator_id` (→ people, not null), `ends_at`, `city`, `state`, `visibility` (check: members / invite_only), `status` (check: pending / approved / rejected / cancelled), `rejection_reason`, `approved_by` (→ auth.users), `approved_at`, `updated_at`; checks `capacity > 0`, `ends_at >= starts_at`; indexes on `(status, visibility, starts_at)` and `creator_id`.

**`rsvps`**: `updated_at`, check `status in (going, not_going)`; indexes on `person_id` and a partial on `event_id where status = 'going'`.

**`event_invites`** (new): `event_id` (cascade), `person_id`, `invited_by`, `emailed_at`, unique `(event_id, person_id)`.

**`admins`** (new): `auth_user_id` pk → auth.users. No policies at all — only `is_admin()` reads it.

### Access model — a deliberate departure from businesses

Businesses (3b §4) let the owner write straight to the table under RLS. Events **don't**: every invariant is conditional or cross-row (status forced to pending, locked fields after approval, invitees only after approval, capacity under a lock, admin gating), which RLS `with check` can't express without a trigger. So:

- **No insert/update/delete policies** on `events`, `rsvps`, `event_invites`, `admins`. Every write is a `SECURITY DEFINER` plpgsql RPC.
- Three narrow **select** policies exist as a safety net (`events visible read`, `own rsvps read`, `own invites read`) but the app never selects these tables directly — the reads need the creator's name/photo from `people`, which stays self-only, so they're RPCs too.
- Other members are only ever exposed at the **directory tier** (`full_name`, `profile_photo_url`, `member_code`), same as 0010.

### RPCs

All `security definer set search_path = public`, `revoke … from public` + `grant … to authenticated`. Every list returns the same **card** columns: the event, `creator_id / creator_name / creator_photo_url / creator_member_code`, `going_count` (live), `my_rsvp_status`.

| Function | Notes |
|---|---|
| `is_admin()` | `exists (select 1 from admins where auth_user_id = auth.uid())`. Client-side UI gate only; every admin RPC re-checks it. |
| `list_events(p_mode, p_limit, p_offset)` | `upcoming` (approved, members-visible, not ended), `registered` (approved, I'm going, any visibility), `past` (approved, ended, members-visible or I went). `total_count` window function, limit clamped 1–50 like `list_businesses`. |
| `list_my_events()` | Created (any status) ∪ invited (approved/cancelled) ∪ joined (members-visible, going, not mine). One row per event with `relation` = created > invited > joined. `rejection_reason` only on own events. |
| `get_event(p_event_id)` | Card + `rejection_reason` (creator/admin only), `approved_at`, `created_at`, and flags `is_creator`, `is_invited`, `is_admin`, `can_edit_all` (creator & pending/rejected), `can_edit_description` / `can_manage_invitees` (creator & approved). Zero rows unless visible to the caller. |
| `list_event_invitees(p_event_id)` | Creator or admin. Directory tier + `emailed_at`. |
| `admin_list_events(p_status, p_limit, p_offset)` | Card + `rejection_reason` + `total_count`; pending ordered oldest-first, others by `updated_at desc`. |
| `save_event(title, description, starts_at, ends_at, venue, city, state, capacity, visibility)` → uuid | Validates via `check_event_fields` (not granted), requires a future start. Always `pending`. |
| `update_event(event_id, …same 9…)` | Creator only. Approved → only `description` written (other params ignored, so the client sends the whole form). Pending/rejected → all fields, back to `pending`, reason cleared. Cancelled → refused. |
| `cancel_event(event_id)` | Creator or admin. |
| `rsvp_event(event_id, status)` → bigint | Locks the event row; requires approved & not ended; `going` checks invite list (invite_only) and capacity (excluding self); upsert. `not_going` updates in place. Returns the going count. |
| `add_event_invitee(event_id, person_id)` | Creator only, approved only, target must be onboarded and not self. Idempotent. |
| `remove_event_invitee(event_id, person_id)` | Creator only. On invite_only events also flips that person's RSVP to `not_going`. |
| `admin_set_event_status(event_id, status, reason)` | `is_admin()` gate. approved/rejected only from pending (reject needs a reason); cancelled from anything. Writes a row to `admin_audit_log` (`event_<status>`). |

### Edge Function `send-event-invite`

`supabase/functions/send-event-invite/index.ts` — deploy with `supabase functions deploy send-event-invite` (manual, like `send-family-invite`). Same secrets (`RESEND_API_KEY`, optional `RESEND_FROM_ADDRESS`, `SITE_URL`).

- Request `{ event_id, person_ids[] }` (1–50). Response `{ sent, failed: [{ person_id, reason }] }` — a partial failure is still 200.
- Verifies the caller via `auth.getUser()`, then uses the **service role** to check: caller is the creator, event is `approved`, each id is on `event_invites`. Ids that aren't go to `failed` ("not on the invite list").
- **`people` has no primary email column** (only `secondary_email`) — the login email lives in `auth.users`, read with `service.auth.admin.getUserById(people.auth_user_id)`. Remember this for any future feature that emails a member.
- Sends sequentially (Resend rate limit), stamps `event_invites.emailed_at` per success. Link is the deep path `${SITE_URL}/events/<id>` — safe since the 3a `vercel.json` rewrite.

## 3. What shipped in the app

| Route | Component | Notes |
|---|---|---|
| `/events` | `routes/Events.tsx` | Upcoming / Registered / Past tabs (`?tab=`), load-more, count. Outline links to Create event / My events. Only approved members-visible events. |
| `/events/mine` | `routes/MyEvents.tsx` | One `list_my_events` call grouped into Created by you (status badge + rejection reason) / Invited / Joined. |
| `/events/new` | `routes/EventNew.tsx` | `EventForm` + "reviewed by an admin" note → `save_event` → detail page. |
| `/events/:id` | `routes/EventDetail.tsx` | Header + when/where + going count; RSVP area (Join accent / Leave outline / reason text when cancelled, pending, ended, full, invite-only); creator: Edit (inline form, `locked` after approval), Cancel event; creator + approved: Invitees section; organiser card → `/members/:id`. Refetches `get_event` after every mutation. |
| `/admin/events` | `routes/AdminEvents.tsx` | `useIsAdmin` gate → pending queue with Approve (accent) / Reject (`window.prompt` for reason) / Cancel, then Recently approved / rejected. |

**Nav**: five tabs now (Home · Directory · Businesses · Events · Profile); bottom-bar labels dropped to `text-[11px]` + `whitespace-nowrap` so five fit at 360px. Admins get an "Admin · Events" item in the account menu (`UserMenu adminHref`, wired from `Layout` via `useIsAdmin(showNav)`). **Dashboard**: third stat tile (Events = upcoming count), grid is `grid-cols-3`.

**Deep-link return path** (`lib/returnTo.ts`): `AuthGate` stores the path + query in `sessionStorage` when an anonymous visitor hits a protected route; `VerifyOtp` navigates to it (else `/onboarding`) after the OTP; both logout handlers clear it. Only same-origin absolute paths, never the auth screens. If the profile turns out incomplete, the target route's own `AuthGate` still bounces to `/onboarding`. The wizard was not touched — invitees are always existing members with complete profiles.

**New components** — `components/TabStrip.tsx` (generic version of `ProfileTabs`, which is untouched), `components/events/`: `EventCard`, `EventStatusBadge`, `EventForm` (`locked` prop), `EventInviteePicker` (name search → Add per result, disabled when self / already invited), `EventInviteesSection` (picker + list + Send email / Resend / Remove / Email all not yet emailed).

**Lib**: `lib/events.ts` (types, `EventFormValues`, `validateEvent`, `datetime-local` ↔ ISO helpers, `formatEventWhen`, `eventPlaceLine`, `isEventEnded`, `isEventFull`, all RPC wrappers, `sendEventInvites`), `lib/admin.ts`, `lib/returnTo.ts`, `lib/edgeFunctions.ts` (`invokeEdgeFunction` — the `FunctionsHttpError` unwrap, now shared with `sendFamilyInvite`), `hooks/useIsAdmin.ts`, `formOptions.ts` (`EVENT_VISIBILITY_OPTIONS`). `TextField` gained `datetime-local` + `disabled`; `SelectField` gained `disabled`. `types/database.ts` has `EventRow`, `RsvpRow`, `EventInviteRow`, `AdminRow`, `EventCardRow` and all 13 RPC signatures (hand-written, as before).

## 4. Patterns to reuse

- **RPC-only writes for stateful tables.** When a table has a lifecycle (status transitions, locked fields, moderation), skip table RLS for writes and put every write in a plpgsql RPC — one place for the invariants, `for update` where counts matter. Matrimony (Phase 6) has the same shape (interest → accepted gating) and should copy this, not the businesses model.
- **`admins` + `is_admin()`** is the Phase 5 role check. Don't invent a second one; extend the table (e.g. a `role` column) if needed.
- **`admin_audit_log`** is now written by `admin_set_event_status` — the console's own actions should keep writing there.
- **`invokeEdgeFunction`** for any new Edge Function call; **service-role + creator check** inside the function for anything that touches other members' data.
- **`returnTo`** for any future emailed deep link (matrimony interests, notices).
- **Card vs detail RPC split** (3c §4) held up: `EventCardRow` for lists, `get_event` adds flags the page needs so the client never re-derives permissions.

## 5. Known gaps / deferred

- **No waitlist** when an event is full, and **no reminders / notifications** — Phase 7 push notifications should cover "your event was approved" and "event tomorrow".
- **Invitee search is name-only** (`search_registered_members` needs ≥3 characters) and shows initials-only avatars (that RPC doesn't return `profile_photo_url`).
- **Admin UI is minimal**: no pagination past 50 pending, no filters, no audit-log viewer. Phase 5.
- **Rejected events can be resubmitted indefinitely** — no cap, no cooldown.
- **Date-only edits after approval require cancel + recreate**; RSVPs don't carry over. Deliberate for now.
- **Non-members can't be invited** (unlike family invites). `send-family-invite` could be reused to email a plain "join the platform" link later.
- The bottom tab bar is now at five tabs — a sixth (matrimony) won't fit; Phase 6 should move something into a "More" menu.

## 6. Before you start Phase 5

1. Confirm `0018` is applied and an admin is seeded:
   ```sql
   select column_name from information_schema.columns where table_name = 'events' order by ordinal_position;
   -- has starts_at, venue, creator_id, visibility, status; no event_date / location
   select tablename, policyname, cmd from pg_policies
   where tablename in ('events','rsvps','event_invites','admins');   -- exactly 3 rows, all SELECT
   select proname, pg_get_function_arguments(oid) from pg_proc
   where proname in ('is_admin','list_events','list_my_events','get_event','save_event','update_event',
                     'cancel_event','rsvp_event','list_event_invitees','add_event_invitee',
                     'remove_event_invitee','admin_list_events','admin_set_event_status');  -- 13 rows
   select * from admins;  -- your auth uid
   ```
2. Deploy the Edge Function: `supabase functions deploy send-event-invite`.
3. Smoke test with two accounts (A creator, B member) and an admin: A creates → pending on My events, absent from `/events`; admin approves → listed; B joins → count 1; A creates an invite-only event → B can't see it until A adds B → B sees it under Invited; A "Send email" → B gets the deep link; log B out, click it → OTP → lands on the event.
4. Phase 5's console should reuse `admin_list_events` / `admin_set_event_status` as-is and add: member approvals, a members table, notices. Extend `admins` rather than adding a role column on `people`.
