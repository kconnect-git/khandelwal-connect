# Phase 10.3 Summary — Handoff to 10.4

10.3 is the third sub-phase of Phase 10 (KC Business). Read it with `phase-10-plan.md`, `phase-10.2-summary.md`, `phase-5b2-summary.md` (business moderation) and `phase-6c-summary.md` (the matrimony reports it copies).

---

## 1. What Phase 10.3 is

Mockup screen 4, the business detail page.

| Feature | Behaviour |
|---|---|
| **Products & services** | Chips under About, from the new `businesses.products` list. Owners add them in Profile > Business with a type → **Add** chip input (Enter also adds, × removes). Limits: ≤ 20 items, 1–60 characters each, no case-insensitive duplicates. The old single "Primary product / service" box is gone, and existing values were copied into `products`. Directory search also matches products. |
| **Verified tag** | 10.2's blue "Verified" text, under the meta line. |
| **Contact buttons** | Unchanged: WhatsApp primary (orange), Call and Website outlined. Decided in planning, against the mockup's Call-first. |
| **Share** | Opens the phone's share sheet (Web Share API). Where there isn't one, it copies the link and shows "Link copied" for 2 seconds. The link is `/businesses/:id`, which still needs a login. |
| **Save / Saved** | Toggles straight away; if the server refuses, it flips back and shows the error. The directory has a new **Saved** chip after State that lists only saved businesses, with its own empty state ("You haven't saved any businesses yet."). |
| **Report** | Reason (Fake or misleading / Wrong contact details / Inappropriate content / Not a member's business / Other, which needs details) + details ≤ 1000. One open report per member per listing. After sending, the button reads "Reported" with a thank-you line. There's no "also block" for businesses. |
| **Owner view** | The owner sees only **Share**. Save and Report are hidden, and their own views and taps are never counted. |
| **Tracking** | A view (on page load) and taps on WhatsApp and Call are logged in the background for the 10.8 dashboard. Each viewer counts at most once per kind per IST day. Logging never blocks or breaks the page. |
| **Admin: Reports tab** | `/admin/businesses` → **Reports** (Open / Resolved). Each row has the listing, owner (name · code), reason, reporter, Visible/Hidden, date and details, and flags "N open reports" when the listing has several. Actions: View listing (when visible), **Hide listing** (reason required, reuses `admin_set_business_hidden`) and **Resolve** (optional note for admins). |
| **Admin: Overview** | An **Open business reports** tile (urgent when > 0), next to the matrimony one. Audit rows read "Resolved business report" and link to the Reports tab. |

Decisions taken during planning: products are a new array rather than a comma-split of `primary_product`; Saved is a directory chip, not its own page; reports get a full Reports tab (not just a count); WhatsApp stays primary.

## 2. Schema / backend (migration `0028_business_detail.sql`, mirrored in `ddl/core_schema.sql` and `ddl/enable_rls.sql`)

- **`businesses.products text[] not null default '{}'`**, checked by `business_products_valid(text[])` (immutable). The constraint is added only if missing. The backfill copies `left(trim(primary_product), 60)` into empty `products`.
- **New tables**, all **RPC-only** (RLS on, no policies):
  - `business_saves (person_id, business_id)`, primary key on the pair, cascades on both;
  - `business_reports`, shaped like `matrimony_reports`, with a partial unique index for one open report per (reporter, listing);
  - `business_activity (business_id, viewer_person_id, kind view|call|whatsapp, day)`, with a unique index on `(business_id, viewer_person_id, kind, day)` and an index on `(business_id, day)` for 10.8.
- In `core_schema.sql` the three tables sit **right after `businesses`**, because `get_business` / `list_businesses` (SQL-language, checked when they're created) read `business_saves`.

| Function | Notes |
|---|---|
| `get_business` | **Changed:** −`primary_product`, +`products`, `is_verified`, `is_saved`. Dropped and recreated. |
| `list_businesses` | **Changed:** new 7th param `p_saved_only boolean default false`, and search also matches `array_to_string(products, ' ')`. Dropped and recreated; the grant is on the 7-arg signature. |
| `set_business_saved(id, saved)` | **New.** Saving needs the listing to be visible (`get_business`). Unsaving always works. Idempotent. |
| `report_business(id, reason, details)` | **New.** Visible listing, not your own. "Other" needs details. Duplicate open report → "You have already reported this listing…". |
| `log_business_activity(id, kind)` | **New.** Returns quietly for an unknown kind, the owner, an invisible listing or a same-day repeat. |
| `admin_list_business_reports(status, limit, offset)` | **New.** Same ordering as matrimony: oldest open first, newest resolved first. |
| `admin_resolve_business_report(id, note)` | **New.** Audited as `business_report_resolved` / target `business_report`. |
| `admin_overview_stats` | + `business_reports_open`. |
| `admin_list_audit_log` | Labels the `business_report` target with the business name. |

## 3. What shipped in the app

| File | Change |
|---|---|
| `routes/BusinessDetail.tsx` | Verified tag, Products & services section, the Share / Save / Report row (one column for the owner, three for others), view logging after load, and Call/WhatsApp tap logging. Dropped the "Product / service" Details row. |
| `components/ReportDialog.tsx` | **Moved** from `components/matrimony/` and generalised: `reasons`, `note` and `offerBlock` props. Matrimony passes its reasons, its old note and `offerBlock`, so it behaves as before. `REPORT_DETAILS_MAX` lives here now (removed from `lib/matrimony.ts`). |
| `components/form/ChipInput.tsx` | **New.** A text box + Add, Enter to add, removable chips, and an "N of 20" counter near the cap. 10.4's form page reuses it. |
| `components/businesses/BusinessForm.tsx` | "Products & services (optional)" `ChipInput` in place of the Primary product box. |
| `routes/Businesses.tsx` | **Saved** toggle chip (included in Clear), and `savedOnly` passed to both list calls. |
| `components/admin/BusinessReports.tsx` | **New.** The Reports list, a copy of `MatrimonyReports`. |
| `routes/admin/AdminBusinesses.tsx` | Split: `AdminBusinesses` owns the Visible / Hidden / **Reports** tabs and renders `BusinessListings` (the old table, with `view` as a prop) or `BusinessReports`. Switching tabs keeps the other query params. |
| `routes/admin/AdminOverview.tsx` | Open business reports tile. |
| `lib/businesses.ts` | `is_verified` moved onto `BusinessCard` (closing the 10.2 note). `BusinessListing`: −`primary_product`, +`products`, `is_saved`. Form values use `products: string[]`, cleaned before saving (trimmed, blanks and duplicates dropped) and validated against `PRODUCTS_MAX` / `PRODUCT_MAX_LENGTH`. New `setBusinessSaved`, `reportBusiness`, `BUSINESS_REPORT_REASON_OPTIONS`, and `logBusinessActivity` (fire-and-forget). `listBusinesses({ savedOnly })`. |
| `lib/admin.ts` | `adminListBusinessReports`, `adminResolveBusinessReport`, the audit label, and an audit link for `business_report` targets. |
| `types/database.ts` | `BusinessRow.products`, the `get_business` / `list_businesses` shapes, 5 new Functions entries, `BusinessReportReason`, `AdminBusinessReportRow`, and `AdminOverviewStats.business_reports_open`. |

## 4. Known gaps / deferred

- **Reporters aren't told the outcome**, and owners aren't told they were reported (only hidden, if it comes to that). Same as matrimony.
- **Share links need a login.** A non-member who opens one lands on sign-up, not the listing. A public preview page would be a separate decision.
- **Tracking is approximate by design:** once per viewer, per kind, per IST day, and only for logged-in members. Website, email and social-link taps aren't tracked. Nothing reads `business_activity` until 10.8.
- **`primary_product` is dead.** Nothing in the app reads or writes it. Drop the column in a later cleanup, once nothing else references it (the `0017` / `0021` migrations and `phase-3c` docs only).
- **A saved listing that gets hidden** silently drops out of the Saved chip, and unhiding brings it back. Saves cascade away if the listing is deleted.
- **The ReportDialog effect depends on `onCancel`.** Callers pass an inline arrow, so if the parent re-renders while the dialog is open (e.g. the "Link copied" timer), the reason and details reset. This was already true for matrimony. If it bites, memoise `onCancel` or drop it from the effect's dependencies.
- **0028 was written without a database to run it against.** Its verification block is at the bottom of the file.

## 5. Before you start 10.4

1. Apply `0028` and run its verification block:
   - the 3 new tables have RLS on;
   - 7 functions, with `list_businesses` ending in `p_saved_only boolean`;
   - no listing with a `primary_product` but empty `products`;
   - `admin_overview_stats() ? 'business_reports_open'`.

   Deploy the frontend.
2. Smoke test with member A (owner), member B and admin C:
   - **Products:** A adds 3 products in Profile > Business and saves. B sees the chips, and searching one product name in the directory finds the listing.
   - **Save:** B saves A's listing. The directory's Saved chip shows just that one, and unsaving empties it. A sees only Share on their own listing.
   - **Report:** B reports with "Other" and no details, which the dialog won't send; with details it's sent, and a second report is refused. C sees it under Reports and on the Overview tile, hides the listing with a reason (A sees the banner in Profile > Business), and resolves it. The audit log shows "Resolved business report".
   - **Tracking:** B opens A's listing twice and taps WhatsApp and Call. As admin in SQL, `select kind, count(*) from business_activity group by kind` gives view 1, whatsapp 1, call 1. A opening their own listing adds nothing.
   - **Share:** a phone opens the share sheet; desktop shows "Link copied".
   - **Matrimony report** still works, including "Also block".
3. 10.4 moves the form to `/businesses/new` and `/businesses/:id/edit`. It reuses `BusinessForm` (with its `ChipInput`) and adds `show_phone`, `owner_role` and profile prefill.
