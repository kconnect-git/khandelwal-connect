# Phase 11.6 Summary — Events gating

11.6 locks creating events, as set out in `events-paid-features.md`. Read it with `phase-11-plan.md` and the 11.1–11.5 summaries. **It changes nothing until a super admin turns the Events paywall on** in /admin/access. The check is `has_service_access(me, 'events')`.

---

## 1. What members without Events access get

| | Free | With access, or admins |
|---|---|---|
| Browse, view and join / leave events, receive invites | ✅ | ✅ |
| **Create an event** | ❌ The "Create event" buttons (Events, My events) still lead to `/events/new`, which shows "Creating events is part of Events access" + Request access in place of the form | ✅ (still admin-approved) |
| Edit / cancel / invite to events **they already created** | ✅ (lapse rule) | ✅ |
| Committee events (made by admins) | Free to view and join; invite-only ones are limited by the invite | — |

## 2. Schema / backend (migration `0038_events_gating.sql`, mirrored in `ddl/core_schema.sql`)

- **`save_event`** (the create RPC) raises **SQLSTATE `KCL04`** "Creating events is part of Events access." without access. Its body is the current one with only that check added, and it's now closed to `anon`.
- **Deliberately untouched:** `update_event`, `cancel_event`, `add_event_invitee` / `remove_event_invitee` and the `send-event-invite` function. Each was confirmed to already require the event's creator (or an admin, to cancel), and a member can only have created an event with access or before the paywall.

**Tested on the live database without keeping anything.** The real 0038 plus tests ran in one transaction ending in a forced error, with the Events paywall switched on inside it. Afterwards the database was confirmed unchanged: paywall off, no test events, the old `save_event`.

| Check (KHA-KA-4216, non-admin) | Result |
|---|---|
| Create without access | `KCL04` "Creating events is part of Events access." |
| Join an upcoming event / browse | OK (going = 1) / 1 event |
| Create after an Events grant | OK, lands as `pending` |
| Grant revoked: edit that event | OK |
| Grant revoked: create another | `KCL04` |
| Admin (KHA-MH-3004, no grant) create | OK: committee events unaffected |
| Signed out | `permission denied for function save_event` |

## 3. What shipped in the app

| File | Change |
|---|---|
| `routes/EventNew.tsx` | The lock card replaces the form without access. |
| `lib/serviceAccess.ts` | **`PAYWALL_READY.events = true`** |

`tsc -b` and `vite build` pass, with no new lint warnings.

## 4. Before you call 11.6 done

1. ~~**Apply `0038`.**~~ **Applied on 2026-11-17** with `scripts/sql.sh -f`, in one transaction. Verified live: `save_event` carries the Events check, is closed to `anon` and open to `authenticated`, and the Events paywall is **off**.
2. Deploy the frontend.
3. **Smoke test:** Admin → Access → Events → Turn on. Then, as a non-admin without Events access:
   - Create event → lock card → Request access reaches the queue.
   - Joining an event still works.
   - Grant Events access and check creating works.
4. Commit.
