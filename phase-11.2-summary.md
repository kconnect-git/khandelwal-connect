# Phase 11.2 Summary — Admin portal for paid access

11.2 is the admin side of Phase 11. Read it with `phase-11-plan.md` and `phase-11.1-summary.md`, whose RPCs it calls. It needs **no migration**. It adds one new edge function, `send-access-granted`.

---

## 1. What Phase 11.2 is

| Feature | Behaviour |
|---|---|
| **Access section** | A new `/admin/access` in the admin nav, after Matrimony. The nav item carries a badge with the number of **open access requests**. It refreshes on every navigation and right after a grant or dismiss. On a phone, the Section dropdown shows "Access (N)". |
| **Paywalls** | One card per service: **Paywall on** / **Free for all**, "N with access · N requests", and who last changed it. Only a **super admin** sees Turn on / Turn off. **Turn on is hidden until that service's locks are built.** `PAYWALL_READY` in `lib/serviceAccess.ts` is false for all four; 11.4–11.7 each flip their own entry. Turning a paywall on asks for confirmation ("no free period… N members have access now"). |
| **Requests tab** | Open / Granted / Dismissed, plus a service filter. Open requests are listed oldest first. Each row shows the member (linked to member detail), the service, **email (a mailto link with Copy) and phone** for the payment conversation, current access end, request date, and the member's message. The actions are **Give access** (or **Extend** if they already have access) and **Dismiss** (with an optional note). Handled requests show who handled them and when, plus the note. |
| **With access tab** | Members holding access now, one row per member and service, **soonest to end first**. Filters: All or **Ending in 7 days**, and service. Rows ending within 7 days show "N days left" in accent. The actions are **Extend** and **Remove**. |
| **Grant dialog** | 1 / 3 / 12 months (default 1). A **live preview** of the end date: an extension starts where the current access ends, with month-ends clamped the way Postgres does them. An optional note (up to 500 characters, admins only, goes to the audit log). |
| **Remove / Dismiss** | A confirm with an optional note. Neither emails the member. Removing ends access now, including any time from an extension. |
| **Email** | After a grant commits, `send-access-granted` emails the member. The subject is "You now have KITE Matrimony access" or "…access is extended". The body says what the service unlocks, the **Access until** date (the end of the whole run of grants) and a link to the service. A failed email shows "Access given, but the email… could not be sent: …" with **Retry**, and the grant stands. On success: "X has been emailed." |
| **Member detail** | A new **Paid access** section (above Personal). It has one line per service: "Until 17 Dec 2026", "Requested 12 Nov" (accent) or "No access", "paywall off" when the service's switch is off, "renewal requested", and the member's request message. The buttons are Give access / Extend, Remove and Dismiss request. A collapsible "N grants so far" lists every grant: length, dates, by whom, note, and removal. Only approved members get buttons. |
| **Overview** | An **Access requests** tile (accent when above 0), linking to `/admin/access`. |
| **Audit log** | An **Access** filter chip (prefix `access_`). Access actions link to the member. |

## 2. Backend

- **No migration.** It uses 0034 as applied.
- **New edge function `supabase/functions/send-access-granted`.** The body is `{ grant_id }`. Guards:
  - the caller is signed in
  - the caller is in `admins` (checked with the service role)
  - the grant exists, isn't revoked and hasn't ended (409 otherwise)
  - the member is still approved
  - the login email comes from `auth.users`

  "Extended" means the grant starts in the future. The secrets are the same as the other senders (`RESEND_API_KEY`, plus optional `RESEND_FROM_ADDRESS` and `SITE_URL`).

## 3. What shipped in the app

| File | Change |
|---|---|
| `routes/admin/AdminAccess.tsx` | **New.** Intro line, `PaywallSwitches`, and the Requests / With access tabs (`?tab=active`). |
| `components/admin/PaywallSwitches.tsx` | **New.** |
| `components/admin/AccessRequests.tsx` | **New.** The queue. |
| `components/admin/ActiveAccess.tsx` | **New.** Members holding access now. |
| `components/admin/GrantAccessDialog.tsx` | **New.** Months, end-date preview, note. |
| `components/admin/MemberAccessPanel.tsx` | **New.** For member detail. |
| `components/admin/AccessContact.tsx` | **New.** Email mailto + Copy, and phone. |
| `components/admin/PillChoice.tsx` | **New.** A small required single choice beside ChipSelects. It isn't a second TabStrip, per AdminLayout's note about stacked strips. |
| `hooks/useAccessActions.tsx` | **New.** Grant, revoke and dismiss, the dialogs, and the email-with-Retry. Shared by the queue, the active list and member detail. Same shape as `useMemberDecision`. |
| `lib/serviceAccess.ts` | `sendAccessGrantedEmail`, `PAID_SERVICE_PATHS`, `previewAccessEnd`, `PAYWALL_READY`. |
| `routes/admin/AdminLayout.tsx` | The Access section, the badge, and the outlet context (`AdminOutletContext.refreshAccessCount`). |
| `routes/admin/AdminMemberDetail.tsx` | The Paid access section. |
| `routes/admin/AdminOverview.tsx`, `routes/admin/AdminAudit.tsx`, `App.tsx` | The tile, the filter chip, and the `/admin/access` route. |

`tsc -b` and `vite build` pass. oxlint shows only the existing `set-state-in-effect` warning on the usual load-in-effect pattern.

## 4. Verified on the live database (2026-11-17, Supabase MCP)

- **Smoke test:** run as a real moderator, a real approved member and `anon`, by setting the JWT claims and switching role inside one transaction that **forces a rollback**. Afterwards there were 0 grants, 0 requests and 0 `access_*` audit rows, and every paywall was still off.
  - **Member:** request works and a duplicate is refused. Grant gives "Not an admin". `has_service_access` gives "permission denied". Reading the table directly returns 0 rows.
  - **Moderator:**
    - The overview count is 1, and the queue shows the request with an email.
    - Grant 1 month gives 17 Nov → 17 Dec. Extending 3 months chains on: 17 Dec → 17 Mar.
    - With access and the member panel both show "until 17 Mar 27".
    - The switch is refused for a moderator.
    - Remove works. Dismiss works, and dismissing twice is refused.
    - The audit log has `access_granted`, `access_extended`, `access_revoked` and `access_request_dismissed`.
  - **`anon`:** 0 rows from everything.
- **Security advisor:** the 0034 findings are all the project-wide categories:
  - RLS on with no policies (intended: RPC-only)
  - definer functions executable by `authenticated` (intended: they're the API, and each checks the caller)
  - definer functions executable by `anon`
- **Hardening applied live and mirrored in 0034 and `core_schema.sql`:** the 12 client RPCs from 0034 (including `admin_overview_stats`) are revoked from `anon`. Signed-in access is unchanged.
- **Not related to 0034:** about 105 older functions are also executable by `anon`. They return nothing when signed out, but could get the same tidy-up in a later migration. The advisor also flags 11 functions with a mutable `search_path` and leaked-password protection being off in Auth settings.

## 5. Known gaps / deferred

- **Not exercised in a browser yet.** No admin login was available to drive it. The RPCs it calls are verified live (§4).
- ~~**The email itself isn't tested yet.**~~ **Tested end to end on 2026-11-17.** Member KHA-KA-2084 requested Matrimony in the app console. An admin granted 1 month in /admin/access. The results:
  - the request closed as `granted`
  - the grant runs 17 Nov → 17 Dec 2026
  - the audit entry reads "access_granted · Matrimony · 1 month · until 17 Dec 2026"
  - the open-request count went back to 0
  - the function logged `POST 200` (about 4 s), which it only returns once Resend has accepted the email
- **Turn on is hidden for every service** until 11.4–11.7 set `PAYWALL_READY`. The RPC itself would allow it; the UI holds it back.
- **No email on Remove or Dismiss**, by design. The member just sees the service locked, or can Request again.
- **No members-side UI yet.** Members can't request access in the app until 11.3. Until then, test requests can be made from the console (below).

## 6. Before you call 11.2 done

1. ~~**Deploy the function.**~~ Deployed on 2026-11-17 with `npx supabase functions deploy send-access-granted --project-ref …`. A probe confirmed it: CORS preflight returns 200; with no auth header the gateway returns 401; a bad grant id gives `Invalid grant id`; a non-user token gives `Not authenticated`.
2. Deploy the frontend.
3. **Smoke test:**
   - As member A, in the browser console: `await supabase.rpc('request_service_access', { p_service: 'matrimony', p_message: 'Paid by UPI' })`.
   - As a **moderator**:
     - The nav shows **Access (1)** and the Overview tile shows 1.
     - Requests lists A with email and Copy. **Give access** → 1 month → the preview reads one month from today. Confirm: the row leaves Open, the badge clears, and A receives "You now have KITE Matrimony access".
     - With access lists A. **Extend** → 3 months: the preview starts from A's current end, and the email says "extended" with the later date.
     - On A's member detail: Paid access shows "Until …" and "N grants so far" lists both grants. The History list shows "Gave service access" and "Extended service access".
     - **Remove**: A drops off With access, and history shows the removal.
     - Make another request, then **Dismiss** it with a note: it appears under Dismissed with the note.
     - Audit log → **Access** shows all of the above.
     - The paywall cards show no Turn on button and say "Only a super admin…".
   - As a **super admin**: the cards say "Can be turned on once this service's locks are built."
   - **Email failure:** temporarily break `RESEND_API_KEY` and grant. You should see "Access given, but the email… could not be sent" with Retry, and the grant is still there.
4. Commit.
