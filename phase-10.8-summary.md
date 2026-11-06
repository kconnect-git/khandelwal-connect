# Phase 10.8 Summary — Phase 10 complete

10.8 is the last sub-phase of Phase 10 (KC Business). Read it with `phase-10-plan.md` and the 10.3, 10.6 and 10.7 summaries, whose data it reads (`business_activity`, `business_posts` / `business_post_responses`, `business_referrals`).

---

## 1. What Phase 10.8 is

Mockup screen 9, **My Business Dashboard: my leads and opportunities**, plus the **enquiries** it lists.

| Feature | Behaviour |
|---|---|
| **Entry** | The hub's **My Business Dashboard** tile (now Live) → `/business/dashboard`, and a **Dashboard** link on each live (approved, not hidden) listing in My businesses → `/business/dashboard?business=<id>`. |
| **Picker** | When the owner has more than one live listing, a Business select, kept in `?business=`. A `?business=` that isn't one of their live listings shows "That listing isn't one of your live listings". |
| **Empty states** | No live listing: "List a business to see your dashboard", or "Your listing is waiting for an admin to approve it…" (→ My businesses) if one is pending. |
| **Completeness** | "Listing N% complete" and "X/10 fields", with an accent bar and a nudge for the first missing field: products → description → logo → phone → website → role → city → state → industry → name. Shows "Your listing has everything members look for." when complete, plus **Edit listing**. |
| **{Month}** | The calendar month in India time, labelled with its name (decided in planning). Four tiles: **Profile views, Calls, WhatsApp taps, Enquiries.** Views and taps count each member once per kind per day (10.3's rule). |
| **New enquiries** | Open enquiries, newest first, up to 10. Each shows the member, "Asked about {product or General} · date", the message, **Reply** (WhatsApp: "Hi X, thanks for your enquiry about … on Khandelwal Connect."; or **View profile** when they hide their number) and **Mark done**. **Show handled** lists done ones with **Undo**. |
| **Leads** | Shown when there's anything: "N new referrals · N in talks" (→ Referrals) and "N Buy & Sell responses this month" for posts made as this listing (→ Buy & Sell Mine). |
| **Match banner** | When > 0: "**N requirements match your category**", "Members are looking for what you offer in Buy & Sell.", and **View requirements** → `/business/market?category=<industry>` (Buy & Sell now reads `?category=`). |
| **Enquire** | On business detail pages, other members get an **Enquire** pill in the contact row, always shown even when the phone is hidden. Tapping a **product chip** opens it with that product picked. The dialog has About (General or a product) and a Message (≤ 500). After sending: "Enquiry sent" and "Sent — {owner} will see it on their dashboard." A second open enquiry to the same listing is refused. |

Decisions taken during planning: enquiries are a new feature (not a re-use of responses or referrals); "this month" is the calendar month; the entry points are the hub tile plus My businesses.

## 2. Schema / backend (migration `0033_business_dashboard.sql`, mirrored in `ddl/core_schema.sql` and `ddl/enable_rls.sql`)

**`business_enquiries`**, RPC-only (RLS on, no policies):
- business and sender (both cascade);
- `about` (≤ 60; null = General) and `message` (1–500);
- `status` new | done, with `done_at`;
- an index on (business, created_at desc);
- a partial unique index for **one open enquiry per member per listing**.

| Function | Notes |
|---|---|
| `send_business_enquiry(business, about, message) → uuid` | Approved members. The listing must be visible (`get_business`) and not yours. `about` must be null or one of the listing's `products`. Duplicate → "You already have an enquiry waiting with this business". |
| `list_business_enquiries(business, status, limit, offset)` | Owner only. `from_phone` is null when the member hides their number. |
| `set_business_enquiry_done(id, done)` | Owner only. Reopening while that member has a newer open one gives a readable error. |
| `business_dashboard(business) → jsonb` | Owner only, otherwise "Listing not found". Returns `month_start`, `views`, `calls`, `whatsapp`, `enquiries` (this month), `enquiries_new` (open), `referrals_new`, `referrals_in_talks`, `post_responses` (this month, posts made as the listing) and `matching_requirements` (live requirements in the listing's industry, not the owner's own). |

## 3. What shipped in the app

| File | Change |
|---|---|
| `routes/BusinessDashboard.tsx` | **New.** The picker and empty states, plus `ListingDashboard` (completeness, month tiles, enquiries, leads, match banner). |
| `components/businesses/EnquiryDialog.tsx` | **New.** Same modal style as `ReportDialog`. |
| `components/StatCounter.tsx` | **New.** The number tile, lifted out of `Referrals.tsx` and now used by both. |
| `lib/businessDashboard.ts` | **New.** `listingCompleteness(row)`, `getBusinessDashboard`, `sendBusinessEnquiry`, `listBusinessEnquiries`, `setBusinessEnquiryDone`. |
| `routes/BusinessDetail.tsx` | The Enquire pill (the contact row now always shows for non-owners), product chips as enquiry buttons, and the dialog. |
| `components/businesses/MyBusinessesList.tsx` | **Dashboard** link on live listings. |
| `routes/BuySell.tsx` | Seeds the Industry chip from `?category=`. |
| `routes/BusinessHub.tsx`, `App.tsx` | Dashboard tile Live. `/business/dashboard` route. |
| `types/database.ts` | `BusinessEnquiryRow`, `BusinessDashboardStats`, 4 RPC entries. |

## 4. Known gaps / deferred

- **No notifications.** Owners see enquiries, referrals and responses only on the dashboard and Referrals pages. Push is Phase 7.
- **Numbers are approximate by design:** once per member per kind per day, logged-in members only. There's no month-over-month history or chart; past months are in `business_activity` but not shown.
- **Enquiries aren't reportable** and have no admin view. A member can send another once the owner marks theirs done.
- **The enquiry list shows the latest 10 open** with no Load more. Fine at community scale.
- **The completeness score is client-side** and weights all 10 fields equally.
- **0033 was written without a database to run it against.** Its verification block is at the bottom of the file.

## 5. Before you call Phase 10 done

1. Apply `0033` and run its verification block (`business_enquiries` with RLS on; 4 functions, one each; `business_dashboard` raises for someone else's listing). Deploy the frontend.
2. Smoke test with member A (owns an approved listing with products) and member B:
   - **Enquire:** B opens A's listing, taps a product chip, and the dialog opens with it picked. B sends: "Enquiry sent". A second enquiry is refused. Turn off A's "Show this number", and Enquire is still there.
   - **Dashboard:** A opens the hub tile (or Dashboard on My businesses). The {Month} tiles show B's visit and taps, and Enquiries 1. B's enquiry is listed. **Reply** opens WhatsApp to B. **Mark done** moves it under Show handled, and **Undo** brings it back.
   - **Completeness:** remove A's logo, and the bar drops with "Add a logo…". **Edit listing** opens the form.
   - **Leads:** B refers someone to A, and the dashboard shows "1 new referral · 0 in talks".
   - **Match:** B posts a requirement in A's industry. A sees "1 requirement matches your category", and **View requirements** opens Buy & Sell filtered to it.
   - **Edges:** a member with no live listing sees the empty state, `?business=<someone else's id>` shows the not-yours message, and in the console `supabase.from('business_enquiries').select()` returns `[]`.
3. **Commit.** 10.4–10.8 are still uncommitted in the working tree, alongside migrations `0029`–`0033`.

## 6. Phase 10 at a glance

| Sub-phase | Screen | Migration |
|---|---|---|
| 10.1 | Business hub `/business` + wider search | `0026` |
| 10.2 | Directory buttons + admin-set Verified | `0027` |
| 10.3 | Detail: products, Share / Save / Report, activity tracking | `0028` |
| 10.4 | List your business: own form pages, prefill, role, show-phone | `0029` |
| 10.5 | My businesses + listing approval | `0030` |
| 10.6 | Buy & Sell | `0031` |
| 10.7 | Referrals | `0032` |
| 10.8 | My Business Dashboard + enquiries | `0033` |

Still "Soon" on the hub: **Products & Services** (could become a search across `products`) and **Meetings & Events** (could link to Events filtered to business meet-ups). See `phase-10-plan.md` §6.6.
