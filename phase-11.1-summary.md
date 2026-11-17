# Phase 11.1 Summary — Access foundation

11.1 is the first sub-phase of Phase 11 (paid services). Read it with `phase-11-plan.md` and `paywall-overview.md`. It ships **backend only**: the tables, the access check every later sub-phase uses, and the member and admin RPCs. There is no UI yet. 11.2 builds the admin portal and 11.3 the member side.

---

## 1. What Phase 11.1 is

Four services become per-member monthly add-ons: **Directory, Business, Events, Matrimony**. Payment is offline:
1. The member **requests access**.
2. The committee and the member settle payment by email.
3. An **admin or moderator grants** that one service for **1, 3 or 12 months**.

| Behaviour | Rule |
|---|---|
| **Paywall switch** | One switch per service, **off by default**. While it's off, the service is free for everyone, exactly as it was before 11.1. Only a **super admin** can turn a switch on or off. |
| **No free month** | Turning a switch on locks every member who has no grant (decided 2026-11-17). Admins can grant access **while the switch is still off**, so paid members are set up before launch. |
| **Who has access** | Any of: the switch is off; the member is an **admin or moderator**; or they hold an unrevoked grant covering now. |
| **Extending** | Granting again while the member still has access **chains**: the new period starts where the current one ends, not today. |
| **Revoking** | Removes the member's current and queued access to that service at once. |
| **Requests** | One open request per member per service. Requests are allowed while the member still has access, so they can renew early. Granting closes the open request as `granted`; an admin can also **dismiss** it with a note. |
| **Audit** | Every grant, extension, revocation, dismissal and switch change is written to the audit log, with action names starting `access_`. Grants read like "Matrimony · 1 month · until 17 Dec 2026 · paid by UPI". |

## 2. Schema / backend (migration `0034_service_access.sql`, mirrored in `ddl/core_schema.sql` and `ddl/enable_rls.sql`)

All three tables are RPC-only (RLS on, no policies). Admin user columns (`granted_by`, `revoked_by`, `handled_by`, `updated_by`) hold auth user ids, the same as `businesses.verified_by`.

- **`paid_service_settings`:** `service` (the primary key; one of the four), `enforced`, `updated_at`, `updated_by`. Seeded with the 4 rows, all off.
- **`service_access_grants`:** person, service, `months` (1, 3 or 12), `starts_at`, `ends_at`, `note`, `granted_by`, `revoked_at`, `revoked_by`, `revoke_note`. Each grant is one row, so the table is the history.
- **`service_access_requests`:** person, service, `message` (up to 500 characters), `status` (open, granted or dismissed), `requested_at`, `handled_at`, `handled_by`, `handled_note`. A partial unique index allows one open request per member per service.

| Function | Who | Notes |
|---|---|---|
| `has_service_access(person, service) → bool` | **Definer-only** (no client execute) | **The** entitlement check for 11.4–11.7. An unknown service name counts as locked. |
| `service_access_ends_at(person, service)` | Definer-only | End of the live or queued run of grants. |
| `my_service_access()` | Approved member | One row per service: `enforced`, `has_access`, `is_admin`, `ends_at`, `expired_at` (most recent lapsed grant), `open_request_at`. |
| `request_service_access(service, message) → uuid` | Approved member | A duplicate gives "You have already asked for this. The committee will email you." |
| `admin_list_service_settings()` | Any admin | Each switch, plus its active member count and open request count. |
| `admin_list_access_requests(status, service, limit, offset)` | Any admin | Includes the member's **login email** and phone, plus their current access end. Open requests are listed oldest first. |
| `admin_list_service_access(service, expiring_days, limit, offset)` | Any admin | Members holding access now, one row per member and service, soonest to expire first. |
| `admin_member_access(person)` / `admin_member_access_history(person)` | Any admin | For the Access panel on member detail. |
| `admin_grant_service_access(person, service, months, note) → uuid` | Any admin | Only approved members can be granted access. An advisory lock makes two simultaneous grants chain instead of overlapping. The audit entry is `access_granted` or `access_extended`. |
| `admin_revoke_service_access(person, service, note)` | Any admin | "This member has no X access to remove" if there's nothing to revoke. |
| `admin_dismiss_access_request(request, note)` | Any admin | "This request has already been handled" if the request isn't open. |
| `admin_set_service_enforced(service, bool)` | **Super admin** | Refuses a no-op such as "already on". |
| `admin_overview_stats()` | Any admin | Adds `access_requests_open`. |

**Changes from the plan:**
- Revoking works per member and service, not per grant id.
- Three read RPCs were added for 11.2: `admin_list_service_settings`, `admin_list_service_access` and `admin_member_access_history`.

## 3. What shipped in the app

| File | Change |
|---|---|
| `lib/serviceAccess.ts` | **New.** `PAID_SERVICES`, `PAID_SERVICE_LABELS`, `ACCESS_MONTH_OPTIONS`, and a wrapper for each RPC. |
| `types/database.ts` | `PaidService`, `AccessMonths`, `AccessRequestStatus`, 6 row types, 11 RPC entries, and `AdminOverviewStats.access_requests_open`. |
| `lib/admin.ts` | Audit labels for the six `access_*` actions. |

`tsc -b` passes.

## 4. Testing done

- 0034 was run **twice** (it's re-runnable) against PGlite, an in-memory Postgres, with stub `auth`, `people`, `admins` and audit tables.
- Every row in §2 behaved as described. That covers:
  - the request, duplicate and pending-member errors
  - grant, then extend, chaining from 17 Dec to 17 Mar
  - the request being closed on grant
  - a moderator being refused the switch while a super admin can use it
  - access when the switch is on, off, or the service name is unknown
  - admins having access automatically
  - revoke, dismiss, history and audit notes
  - `expired_at` after a grant lapses
  - `has_service_access` not being executable by `authenticated`
- **Applied to Supabase on 2026-11-17** with `scripts/sql.sh -f`. The verification queries passed: 4 settings rows (all off), 3 tables with RLS on and no policies, and 13 functions, one each.
- **Fixed during the live run:** Supabase grants `anon` and `authenticated` execute rights on new functions directly, so revoking from `public` alone left `has_service_access` and `service_access_ends_at` callable by clients. 0034 now also revokes them from `anon` and `authenticated`. This was applied live and checked: neither role can execute them.

## 5. Known gaps / deferred

- **Nothing is gated yet.** No RPC calls `has_service_access` until 11.4–11.7, and every switch is off. Applying 0034 changes nothing for members.
- The **audit page** has no "Access" filter chip yet. Its `access_` prefix is ready for 11.2 to add one.
- A **revoked** grant doesn't count as "expired", so `expired_at` ignores it. The member just sees Request access again.
- No **email** on grant (11.2) or before expiry (11.8).

## 6. Before you call 11.1 done

1. ~~Apply `0034` and run its verification block.~~ Done on 2026-11-17 (see §4).
2. In the browser console:
   - As a member: `my_service_access` returns 4 rows with `has_access: true`. `request_service_access('matrimony')` works once and is refused the second time.
   - As a moderator: grant 1 month, then 3 months, and check `admin_member_access` shows an end date about 4 months out. Trying the switch is refused.
3. Delete the test grants and requests, or leave them for 11.2 to display.
4. Commit.
