# Phase 11.3 Summary — Paid access, member side

11.3 is the member side of Phase 11. Read it with `phase-11-plan.md` and the 11.1 and 11.2 summaries. It adds migration `0035` and the pieces 11.4–11.7 will use to lock each service. **No service is locked yet**: every paywall is still off, so members see no change until a grant or a paywall exists.

---

## 1. What Phase 11.3 is

| Feature | Behaviour |
|---|---|
| **`<LockedFeature service=…>`** | A card that replaces a paid feature for a member without access. It shows a title (default "{Service} is a paid service"), what the service unlocks, "Your {Service} access ended on {date}" if it lapsed, and **Request access**. `compact` gives one line plus a link instead, for use in place of a button such as Call. It **renders nothing when the member has access, or while that isn't known yet**, so callers can drop it in unconditionally. Not used anywhere yet; 11.4–11.7 place it. |
| **Request access** | Opens a dialog: "Request {Service} access", what it unlocks, "The committee will email you about payment. Access is monthly.", and an optional message (up to 500 characters). Afterwards it reads "Requested on {date}. The committee will email you." The label becomes **Request again** after a lapse and **Request renewal** while access is still running. |
| **Profile → My access** | A section above the profile tabs, approved members only. It's **hidden while there's nothing to say** (every paywall off and nothing held or requested). It shows one line per service, linking to that service: "Until {date}", "Free for everyone right now", "Ended {date}", "Not included" or "Included for admins". Request access appears when the service is locked, or in the **last 7 days** before access ends (for renewal). |
| **Home card** | "**You now have Matrimony access** · until 17 Dec 2026" (or "**Matrimony access extended**"), with **Open Matrimony ›** and ✕, one per service with an unseen grant. Dismissing it, or opening the service, stores the dismissal on the grant in the database, so it stays gone on every device. It sits below the notices strip, and is deliberately not the accent colour. This replaces a personal notification feed for now (decided 2026-11-17). |
| **Paid badge** | A small outlined **PREMIUM** pill beside the name in the Directory list and under the member code on a member's profile. The server decides: the member holds a live grant for **any** service **and** at least one paywall is on. Admins get every service free but no badge unless they also hold a grant. |

## 2. Schema / backend (migration `0035_access_member_side.sql`, mirrored in `ddl/core_schema.sql`)

The whole migration runs in one transaction.

- **`service_access_grants.member_seen_at`:** when the member dismissed the Home card. Null means not seen yet.
- **`has_paid_badge(person)`:** callable only from other database functions (revoked from `anon` and `authenticated`). In `core_schema.sql` it sits beside `is_approved_member`, because the directory RPCs below call it.
- **`list_directory` and `get_member_profile` gain `has_paid_badge boolean`.** A new return column means they were **dropped and recreated**. Their bodies are otherwise unchanged, and both are now closed to `anon`; signed out, they returned nothing anyway.
- **`my_access_news()`:** the caller's unseen live grants, one row per service: `extended` (every unseen grant was chained onto existing access) and `ends_at` (the end of the whole run). `dismiss_access_news(service)` marks them seen. Both are closed to `anon`.

**Applied live on 2026-11-17** with `scripts/sql.sh -f`, and verified through the Supabase MCP:
- Permissions are as intended, and the badge column is present on both RPCs.
- As KHA-KA-2084, in a rolled-back transaction:
  - news returned "matrimony, new, until 17 Dec 2026"
  - their badge was false, since every paywall is off; 6 directory rows had no badges
  - after a dismiss, news was empty
  - with a paywall switched on inside the same transaction, their badge became true

Their real card is untouched and still waiting for them.

## 3. What shipped in the app

| File | Change |
|---|---|
| `context/ServiceAccessContext.tsx` | **New.** `my_service_access` + `my_access_news`, loaded only once signed in (both RPCs are closed to `anon`) and refreshed on navigation. Provides `hasAccess(service)` (true while unknown), `row`, `anythingToShow`, `request`, `dismissNews` (optimistic) and `refresh`. Mounted in `App.tsx` inside `MatrimonyProvider`. |
| `components/LockedFeature.tsx` | **New.** `LockedFeature` and `RequestAccessControl`. |
| `components/profile/MyAccessSection.tsx` | **New.** On `routes/Profile.tsx` above the tabs. |
| `components/AccessNewsCards.tsx` | **New.** On `routes/Dashboard.tsx` below `NoticeStrip`. |
| `components/PaidBadge.tsx` | **New.** In `routes/Directory.tsx` and `routes/MemberProfile.tsx`. |
| `lib/serviceAccess.ts` | `getMyAccessNews`, `dismissAccessNews`, `PAID_SERVICE_UNLOCKS`. |
| `lib/directory.ts`, `types/database.ts` | `has_paid_badge`, `MyAccessNewsRow`, 2 RPC entries. |

`tsc -b` and `vite build` pass. The new files add only the lint warnings the existing contexts already have (fast-refresh export and set-state-in-effect).

## 4. Known gaps / deferred

- **Nothing is locked yet.** `<LockedFeature>` isn't placed anywhere until 11.4–11.7, and every `PAYWALL_READY` entry is false.
- **Badge wording is "Premium".** That was my choice, since the plan never named it. Changing it is one string in `PaidBadge.tsx`.
- **The badge isn't on matrimony cards or business listings.** The plan left that open.
- **Not exercised in a browser yet** (step 2 below).

## 5. Before you call 11.3 done

1. ~~Apply `0035`.~~ Done (§2). Deploy the frontend.
2. **Smoke test:**
   - As **KHA-KA-2084** (granted Matrimony until 17 Dec in 11.2):
     - **Home** shows "You now have Matrimony access · until 17 Dec 2026". **Open Matrimony ›** goes there, and the card is gone after a reload, including on another device.
     - **Profile** shows **My access**: Directory, Business and Events "Free for everyone right now", Matrimony "Until 17 Dec 2026", and no Request buttons.
   - As a **member with no grant**: no My access section and no Home card.
   - **Badge:** no PREMIUM pill anywhere, because every paywall is off.
3. Commit.
