# Phase 11 Plan — Paid Services (Access Add-ons)

> **Status: in progress.** 11.1–11.7 ✅ built (11.8 left) — see the `phase-11.N-summary.md` files.

Phase 11 puts four services behind per-service monthly add-ons: **Directory, Business,
Events and Matrimony**. Payment happens offline for now:
1. The member taps **Request access** on a locked service.
2. The committee and the member arrange payment **by email**.
3. An **admin or moderator** grants access for that service from the admin portal.

This is a **plan**, not a handoff. We build it as **11.1, 11.2, …**, and each sub-phase gets its own `phase-11.N-summary.md` when it ships. Before starting, read:
- `paywall-overview.md` (the decisions)
- the four `*-paid-features.md` files (what is free and what is paid in each service)
- `phase-5a-summary.md` (member approval and email)
- `phase-5b1-summary.md` / `phase-5b2-summary.md` (admin console and audit)

---

## 1. Where we are today

- **Access:** there's no subscription or entitlement code. Any approved member can use every service. Matrimony browsing is the one exception: it also needs the member's own approved, eligible matrimony profile.
- **Server checks:** every service already reads and writes through `SECURITY DEFINER` RPCs. That gives us one server-side place to add each paid check.
- **Admin roles:** `moderator` and `super_admin` already exist (`admin_role()`, `is_admin()`), along with an audit log (`admin_list_audit_log`).
- **Email:** Resend sends email through edge functions (`send-member-status`, `send-event-invite`, `send-family-invite`). Nothing sends on a schedule yet.

## 2. Build order

Migrations continue from `0034`.

| Sub-phase | What | Depends on | Migration |
|---|---|---|---|
| **11.1** ✅ | Access foundation: tables, `has_service_access()`, request/grant RPCs, per-service switch | — | `0034` |
| **11.2** ✅ | Admin portal: requests queue, grant / extend / revoke, access panel on member detail, "access granted" email | 11.1 | — (edge fn) |
| **11.3** ✅ | Member side: "My access" in Profile, `<LockedFeature>` + Request access, paid badge, Home "access granted" card | 11.1 | `0035` |
| **11.4** ✅ | Directory gating | 11.1, 11.3 | `0036` |
| **11.5** ✅ | Business gating | 11.1, 11.3 | `0037` |
| **11.6** ✅ | Events gating | 11.1, 11.3 | `0038` |
| **11.7** ✅ | Matrimony gating | 11.1, 11.3 | `0039` |
| **11.8** | Expiry reminder email (5 days before) | 11.2 | `0040` (schedule) |

The sub-phases from 11.4 to 11.7 don't depend on each other, so they can ship in any order. Each service's switch stays **off** until that service is ready (see §3).

## 3. Sub-phases

### 11.1 — Access foundation (`0034`) — ✅ built, see `phase-11.1-summary.md`

- **Enum `paid_service`:** `directory`, `business`, `events`, `matrimony`.
- **Table `service_access_grants`:** `id`, `person_id`, `service`, `starts_at`, `ends_at`, `granted_by`, `note`, `revoked_at`, `revoked_by`, `created_at`.
  - Each grant, extension or revocation creates a row or updates one, so the table keeps a history.
- **Table `service_access_requests`:** `id`, `person_id`, `service`, `status` (`open` / `granted` / `dismissed`), `message` (optional, up to 500 characters), `requested_at`, `handled_by`, `handled_at`.
  - A member can have only one open request per service.
- **Table `paid_service_settings`:** `service`, `enforced boolean default false`.
  - This is the per-service switch. While it's off, the service behaves exactly as it does today.
  - That lets us ship the code safely and turn on each paywall when the committee is ready.
- **`has_service_access(p_person uuid, p_service paid_service) returns boolean`.** It returns true when any of these holds:
  - the service is not enforced
  - the person is an admin or moderator
  - the person has an unrevoked grant with `starts_at <= now() < ends_at`

  Every gated RPC calls only this function.
- **`my_service_access()`:** returns the member's own `(service, enforced, has_access, ends_at, open_request)` for each service. The UI loads this once.
- **`request_service_access(p_service, p_message)`:** creates the member's request.
- **Admin RPCs** (both admin roles can use them, and each one is written to the audit log):
  - `admin_list_access_requests(status, service, limit, offset)`
  - `admin_grant_service_access(person, service, months 1|3|12, note, request_id?)`
    - If the member already has active access, the new period starts at the current `ends_at`. Otherwise it starts now.
    - It also marks the request `granted`.
  - `admin_revoke_service_access(person, service, note)`: revokes every live or queued grant for that member and service (built this way instead of per grant id, because admins think in "remove X's Matrimony")
  - `admin_dismiss_access_request(request_id, note)`
  - `admin_member_access(person)`: the member's current access and grant history
  - `admin_set_service_enforced(service, bool)`: super_admin only
  - `admin_list_service_settings()` and `admin_list_service_access(service, expiring_days, …)`: added while building, for 11.2's page
  - `admin_member_access_history(person)`: every grant, newest first
- **Overview stats:** `admin_overview_stats` gains an `access_requests_open` count.

### 11.2 — Admin portal — ✅ built, see `phase-11.2-summary.md`

- **New page `/admin/access`** with two tabs:
  - **Requests:** open requests showing member, service, message, date and the member's email.
    - Actions: **Grant** (a dialog to pick 1, 3 or 12 months and add a note) and **Dismiss**.
    - A copy button for the member's email, so the payment conversation can start.
  - **Active:** current grants, filterable by service and by "expiring in 7 days". Each row has **Extend** and **Revoke**.
- **On `AdminMemberDetail`:** an **Access** panel showing each service's status, its end date, and Grant / Extend / Revoke buttons.
- **Service switches:** super_admin only, on the same page. Each one has a confirm step.
- **Edge function `send-access-granted`:** tells the member which service they got and until when. It follows the same guards as `send-member-status`: it re-reads the grant from the database and never trusts the client body. A failure doesn't block the grant.
- **Admin nav:** an Access tab with an open-requests badge.

### 11.3 — Member side — ✅ built, see `phase-11.3-summary.md`

- **`ServiceAccessContext`:** loads `my_service_access()` once **the member is signed in**, and refreshes it when they request access. The function isn't executable by `anon`, so calling it signed-out errors.
- **`<LockedFeature service=… title=… >`:** an "Upgrade to …" card used everywhere a feature is locked. It shows one of:
  - a **Request access** button, with an optional message
  - "Request sent on <date> — the committee will email you"
  - "Expired on <date> — Request again"
- **Profile → "My access" section:** each paid service with its status, end date and a Request button. This is a section, not a new tab, to keep the tab list as it is.
- **Paid badge:** a small "Member" badge when the person has *any* active add-on. `list_directory` and `get_member_profile` return `has_paid_access boolean` to support it. The badge only appears once at least one service is enforced.

> **Each of 11.4–11.7:** set that service's entry in `PAYWALL_READY` (`lib/serviceAccess.ts`) to `true`, so the admin page offers Turn on.

### 11.4 — Directory gating (`0036`) — ✅ built, see `phase-11.4-summary.md`

Follows `directory-paid-features.md`.
- **`list_directory`:**
  - Without access, it returns null `job_title` and `company_name`.
  - It also rejects more than one filter at a time from a member without access.
- **`get_member_profile`:**
  - Without access, it returns null `mobile_number`, `marital_status`, `current_district` and `job_location`.
  - The member's own "hide mobile" setting still applies to members with access.
- **Daily limit:** a new `directory_profile_views(viewer, viewed, view_date)` table with a unique `(viewer, viewed, view_date)`.
  - Without access, opening an 11th *different* profile in a day raises `daily_limit_reached`.
  - Opening your own profile never counts.
- **UI changes:**
  - "Upgrade to contact" in place of Call / WhatsApp
  - a limit-reached screen
  - filter chips allow only one active filter at a time

### 11.5 — Business gating (`0037`) — ✅ built, see `phase-11.5-summary.md`

Follows `business-paid-features.md`.
- **`get_business`:** without access, it returns null phone, email, website and social links. The owner always sees their own listing in full.
- **`send_business_enquiry`, `respond_to_business_post`, `create_business_post`:** each requires access.
- **Dashboard RPC:**
  - Without access, it returns the counts only.
  - `list_business_enquiries` requires access.
- **Free for everyone:** listing a business, referrals, saves and reports.
- **UI:** `<LockedFeature>` replaces the contact buttons, the Enquire button, Respond / Post in Buy & Sell, and the enquiries list on the dashboard.

### 11.6 — Events gating (`0038`) — ✅ built, see `phase-11.6-summary.md`

Follows `events-paid-features.md`.
- **Need access:** `create_event` and the invitee and email RPCs (`add_event_invitee`, `remove_event_invitee`, `send-event-invite`).
- **Exempt:** admins create committee events whatever their access.
- **Lapsed access:** a member whose access has lapsed can still edit and cancel events they already created. Only creating a new event is blocked.
- **Free for everyone:** browsing and joining.

### 11.7 — Matrimony gating (`0039`) — ✅ built, see `phase-11.7-summary.md`

Follows `matrimony-paid-features.md`. This is the largest change.
- **Browsing:** `list_matrimony_profiles` and `get_matrimony_profile` change their access check.
  - Old check: "the caller has an approved, eligible profile".
  - New check: `has_service_access(caller, 'matrimony')`.
  - With access, the caller sees **every listed profile, both genders**.
- **Without access:**
  - `matrimony_browse_count()` returns only a number. It needs a new RPC, and no profile data leaves the server.
  - `get_matrimony_profile` is allowed only for a profile that has a pending or accepted interest **to** the caller.
- **`express_interest`:**
  - requires access, **and** the caller's own approved, eligible profile
  - the target must be the opposite gender
  - the limit of 10 pending interests stays
- **Responding to an interest** (`respond_interest`) stays free.
- **Unchanged:** the mutual unlock and the safety rules. Matches survive a lapse.
- **Listing eligibility** (`matrimony_ineligible_reason`) is **unchanged**.
- **UI changes:**
  - Matrimony home shows the count and an upgrade card for free members.
  - Interests show who sent them to everyone.
  - Send interest is gated.

### 11.8 — Expiry reminders (`0040`)

- **Edge function `send-access-expiring`:** emails each member whose grant ends in 5 days.
- **No repeat emails:** a `reminded_at` column on the grant stops a member getting the same reminder twice.
- **Schedule:** a daily trigger through `pg_cron` + `pg_net`, or a Supabase scheduled function. We'll confirm which one the project's plan supports when we get to this sub-phase.

## 4. Cross-cutting rules

- **Server first:** every paid rule is enforced in an RPC or a storage policy. The UI only hides things for a nicer experience.
- **Viewing vs being listed:** entitlement (`has_service_access`) is never mixed with listing eligibility.
- **Hidden fields:** a paid field is **null in the response**, not merely hidden in the UI.
- **Members' own choices win:** a member's own privacy settings (hide mobile, `show_phone`) take priority over paid access.
- **Lapsed access:** what the member already has keeps working. Only *new* paid views and actions stop.
- **Audit:** every grant, extension, revocation, dismissal and switch toggle is audited.
- **Wizard:** no new fields in the onboarding wizard (see `keep-onboarding-wizard-short`).

## 5. Open decisions

- ~~**Admin email for new requests**~~ — **decided 2026-11-17: no.** The admin portal queue and its badge are enough.
- **Prices:** these aren't needed in the app while payment is offline. Later we could show a price on the Request card.
- ~~**Launch / free first month**~~ — **decided 2026-11-17: no free month.** Turning a service's switch on locks everyone without a grant. Admins can grant access *before* the switch is turned on, so paid members don't lose access on launch day.

## 6. Out of scope

- Online payment (Razorpay or Stripe) and invoices.
- "Who viewed my profile", which is planned for later as a paid feature.
- Attendee lists for events.
- Parents managing a child's matrimony profile.
