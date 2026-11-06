# Phase 10.5 Summary — Handoff to 10.6

10.5 is the fifth sub-phase of Phase 10 (KC Business). Read it with `phase-10-plan.md`, `phase-10.4-summary.md` (the owner-only read policy this relies on) and `phase-6a-summary.md` (the matrimony review lifecycle it copies).

---

## 1. What Phase 10.5 is

Mockup screen 5, "My businesses", plus the rule behind it: **new listings are shown to members after an admin approves them.**

| Feature | Behaviour |
|---|---|
| **`/businesses/mine`** | The owner's listings, one card each: logo, name, meta line, a **status badge**, the admin's note (for Changes requested / Turned down), the hidden-by-admin banner, and **View** (live only) / **Edit**, or **Remove** for a turned-down listing. It has a "+ Add" button and the note "New listings are shown to members after an admin approves them", with a dashed "Own another business? Add it here." block underneath. |
| **Entry points** | Directory "My businesses", the "‹ My businesses" back links on the form pages, and Profile > Business, which now shows a one-line summary ("2 listings · 1 pending review · 1 needs changes") with **My businesses ›** and **+ List a business**. |
| **New listing** | Starts **Pending review**. After "List business" the owner lands on My businesses (a pending listing has no public page). Other members can't see it anywhere. |
| **Admin queue** | `/admin/approvals` → **Businesses** tab, with a count beside Members / Events. Oldest submitted first. Each row has the listing, owner, industry, location and date. Expanding it shows the description, products, phone and any earlier note (marked "Resubmitted"). Actions: **Approve**, **Ask for changes** or **Turn down**, where the last two need a note the owner sees. There's an Overview tile "Business listings awaiting review". |
| **Changes requested** | The owner sees the note on My businesses and the edit page ("Saving sends it back for review"). **Saving resubmits.** The note stays so the admin sees what they asked for. |
| **Approved, then edited** | Phone, products, description, logo and so on stay live. **A new name or industry sends it back to Pending and removes Verified**, since it's effectively a different business. The edit page says so. |
| **Turned down** | Final. The edit page shows the note and no form; the only action is **Remove**. A direct update is refused by the database. |
| **Console** | `/admin/businesses` Visible / Hidden now list **approved** listings only. Pending ones live in Approvals. |

All four rules were decided during planning: re-review on name/industry; save resubmits and turned-down is final; queue on the Approvals page; `/businesses/mine` as the list, with Profile linking to it.

## 2. Schema / backend (migration `0030_business_review.sql`, mirrored in `ddl/core_schema.sql`)

- **`businesses`** gains:
  - `review_status`: `pending | approved | changes_requested | rejected`. It was added with default `approved`, so **every existing listing was backfilled as approved**; the default was then switched to `pending`.
  - `review_note`, `reviewed_by`, `reviewed_at`, `submitted_at`.
  - an index on `(review_status, submitted_at)`.
- **`businesses_protect_moderation_columns()`** (same trigger) now also:
  - **insert:** forces `pending` plus `submitted_at = now()`;
  - **update:** refuses client changes to the review columns ("Only an admin can approve a listing"), then applies the owner-edit transitions: rejected raises, changes_requested → pending, approved + name/category change → pending with Verified cleared.
  
  Admin RPCs (definer) skip it.
- **Member-facing reads require `review_status = 'approved'`**, which also covers save, report and activity logging through `get_business`: `list_businesses`, `get_business`, `list_member_businesses` and `business_filter_options`. Same shapes, so `create or replace`. The owner reads their own rows from the table (owner-only policy since 0029).

| Function | Notes |
|---|---|
| `admin_list_businesses` | **Changed:** new trailing `p_review_status text default 'approved'` (null = any). It returns `description`, `products`, `contact_phone`, `review_status`, `review_note` and `submitted_at`, and puts oldest-submitted first for `pending`. Dropped and recreated (6 args). |
| `admin_set_business_review(id, status, note)` | **New.** Pending listings only. A note is required unless approving. Audited as `business_approved` / `business_changes_requested` / `business_rejected`. |
| `admin_overview_stats` | + `businesses_pending`. |

## 3. What shipped in the app

| File | Change |
|---|---|
| `routes/MyBusinesses.tsx` | **New.** `/businesses/mine`, including Remove for turned-down listings (`ConfirmDialog`). |
| `components/businesses/MyBusinessesList.tsx` | Now the card list for that page: status badge, admin note, View (live only), Edit, or Remove for rejected listings. |
| `components/businesses/BusinessStatusBadge.tsx` | **New.** Green Approved; amber Pending review / Changes requested; accent-outlined Turned down. |
| `components/profile/BusinessTab.tsx` | Summary line plus links instead of the list. |
| `routes/BusinessEditPage.tsx` | `MY_BUSINESSES` = `/businesses/mine`, and a new listing goes there. A `ReviewBanner` per status (an approved listing gets the "name or industry" hint). A turned-down listing shows no form or Save. "View listing" shows only when live. |
| `components/admin/BusinessApprovals.tsx` | **New.** The review queue. |
| `routes/admin/AdminApprovals.tsx` | Businesses tab and count. |
| `routes/admin/AdminOverview.tsx` | Awaiting-review tile. |
| `routes/Businesses.tsx`, `App.tsx` | "My businesses" → `/businesses/mine`. The redirect is replaced by the real route. |
| `lib/admin.ts` | `adminListBusinesses({ reviewStatus })` defaults to `'approved'`, so the console's existing tables needed no change. `adminSetBusinessReview`, and 3 audit labels. |
| `lib/businesses.ts`, `types/database.ts` | `BUSINESS_REVIEW_LABELS`, `BusinessReviewStatus`, review fields on `BusinessRow` / `AdminBusinessRow`, the new RPC, and `AdminOverviewStats.businesses_pending`. |

## 4. Known gaps / deferred

- **Owners aren't notified** of a decision; they find out on My businesses or Profile. Admins aren't notified of new listings beyond the count and tile. Push is Phase 7.
- **Any save on a Changes-requested listing resubmits it**, including just changing the logo, because the trigger can't tell a logo upload from a form save.
- **The owner can't preview their pending listing's public page** (`get_business` only returns approved ones). The edit page is the closest view.
- **Approval and Verified are separate.** Approving doesn't verify; an admin verifies from `/admin/businesses` afterwards.
- **Hidden and pending can overlap** (hidden first, then renamed). It then shows in neither console table until it's reviewed; approving it leaves it hidden.
- **0030 was written without a database to run it against.** Its verification block is at the bottom of the file.

## 5. Before you start 10.6

1. Apply `0029` (if you haven't) and then `0030`, and run 0030's verification block:
   - only `approved` rows before any new listing;
   - the status check exists;
   - one overload each of `admin_list_businesses` and `admin_set_business_review`;
   - `businesses_pending` in the overview stats.

   Deploy the frontend.
2. Smoke test with member A (owner), member B and admin C:
   - **New:** A lists a business and lands on My businesses with "Pending review". B can't find it in the directory or on A's member profile. C sees it under Approvals › Businesses (with a count) and on the Overview tile.
   - **Changes:** C asks for changes with a note. A sees the note on My businesses and the edit page. A saves, and it's back to Pending; C's row shows "Resubmitted" and the earlier note.
   - **Approve:** C approves. B now finds it, and A sees "Approved" and View.
   - **Re-review:** C verifies it on `/admin/businesses`. A changes the phone, and it stays live and verified. A renames it, and it goes back to Pending, unverified, gone for B.
   - **Turn down:** C turns down a pending listing. A sees "Turned down" with the note and no Edit. Remove works. In the console, `supabase.from('businesses').update({ name: 'x' }).eq('id', '<turned-down id>')` fails with the turned-down message.
   - **Console:** `/admin/businesses` Visible / Hidden show approved listings only, and the audit log shows the three new actions.
3. 10.6 (Buy & Sell, migration `0031`) adds `business_posts`. Flip the hub's Buy & Sell tile to Live when it ships.
