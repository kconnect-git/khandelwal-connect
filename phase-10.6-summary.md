# Phase 10.6 Summary — Handoff to 10.7

10.6 is the sixth sub-phase of Phase 10 (KC Business). Read it with `phase-10-plan.md`, `phase-10.3-summary.md` (the saves / reports / RPC-only patterns it reuses) and `phase-10.5-summary.md`.

---

## 1. What Phase 10.6 is

Mockup screen 7, **Buy & Sell**: requirements and offers from members.

| Feature | Behaviour |
|---|---|
| **Browse** | `/business/market` (hub tile now Live). Tabs **Requirements / Offers / Mine**. On the first two: an **Industry** chip, a **Saved** chip and Clear. Live posts only, newest first, with Load more. A boxed "Need something, or have something to offer? **Post a requirement or offer**" sits at the bottom (it opens the form on Offering when you're on the Offers tab). |
| **Card** | "Looking for" (blue) / "Offering" (green) pill and the date, then the title, "terms · city", "poster · business" and details (3 lines, More / Less). **Respond** (accent; outlined "Responded · WhatsApp" afterwards, still tappable), **Save / Saved**, and a small **Report** link. **No phone is shown.** |
| **Respond** | Records the response, then opens WhatsApp **in the same tab** with "Hi, I saw your Buy & Sell post "…" on KITE.". It's the same tab because a pop-up opened after a network call is blocked on most phones. |
| **Post** | `/business/market/new`. Fields: Looking for / Offering toggle, "What do you need? / What are you offering?", Quantity or budget / Price or terms, Details, Industry (required), City / State (from profile, marked), **Post as** (Just me or one of your approved listings, shown only if you have one), **Contact number** (required; from profile, switching to the listing's phone when you post as it, unless you typed your own), with the note "Only shown to members who tap Respond". It lands on Mine. |
| **Mine** | Every post you've made, with a state badge (**Open / Closed / Expired / Hidden by an admin** plus the reason) and "N members responded", which expands to linked names. Actions: **Close**, or **Renew for 30 days** (closed or expired; not while hidden), and **Delete**, each confirmed. |
| **Expiry** | 30 days from posting or renewing. Expired posts drop out of browse and show "Expired" in Mine. |
| **Report → admin** | Reasons: Fake or misleading / Wrong contact details / Inappropriate content / Other (needs details). Post reports appear in the existing `/admin/businesses` › **Reports** tab as "Buy & Sell: <title>" with the poster, and can be hidden (**Hide post**, reason required, audited) or resolved. The Overview "Open business reports" count includes them. |

Decisions taken during planning: any approved member can post (optionally as a listing); Respond is WhatsApp plus a recorded response; the contact number is chosen per post; posts go live at once, with reporting and hiding.

## 2. Schema / backend (migration `0031_business_posts.sql`, mirrored in `ddl/core_schema.sql` and `ddl/enable_rls.sql`)

**New tables, all RPC-only (RLS on, no policies):**
- **`business_posts`**:
  - poster, optional listing (`on delete set null`);
  - `kind` requirement | offer; `title` 1–100; `details` ≤ 1000; `terms` ≤ 100;
  - `category` (the 15 industry values); city; state;
  - `contact_phone` (+91…, required);
  - `status` open | closed; `expires_at` (now + 30 days);
  - hidden columns and timestamps;
  - indexes on (kind, status, expires_at), poster and category.
- **`business_post_responses`** (post, responder): one per member per post.
- **`business_post_saves`** (person, post).

**`business_reports` changes:**
- `business_id` is now nullable, and there's a new `post_id` (cascade);
- `business_reports_one_target_check`: exactly one of the two is set;
- a partial unique index for one open report per (reporter, post).

**Live post:** open, not expired, not hidden, posted by an approved member. The attached listing's name only shows while that listing is approved and not hidden.

| Function | Notes |
|---|---|
| `business_post_live(id)` | Internal helper, revoked from public / anon / authenticated. |
| `list_business_posts(kind, category, city, saved_only, mine, limit, offset)` | Browse = live posts of one kind; mine = all your posts. Returns an effective `status` (open / closed / expired / hidden), plus `is_mine`, `is_saved`, `has_responded`, `response_count` and `hidden_reason` (the last two for your own posts only). **No phone.** |
| `create_business_post(…) → uuid` | Approved members only. Validates every field. `p_business_id` must be your approved, visible listing. |
| `set_business_post_open(id, open)` | Poster only. Close, or reopen with a fresh 30 days. Refused while hidden. |
| `delete_business_post(id)` | Poster only. |
| `respond_to_business_post(id) → phone` | Live and not yours. Records the response (idempotent) and returns the post's number. |
| `list_business_post_responses(id)` | Poster only. |
| `set_business_post_saved(id, saved)` | Saving needs a live post. |
| `report_business_post(id, reason, details)` | Live and not yours. Uses the 4 reasons. Duplicate open report → "You have already reported this post…". |
| `admin_list_business_reports` | **Changed:** returns `post_id`, `post_title`, `post_kind`, `post_is_hidden`. For post reports, `owner_*` is the poster and `business_*` is null. Dropped and recreated. |
| `admin_set_business_post_hidden(id, hidden, reason)` | **New.** Audited as `business_post_hidden` / `business_post_unhidden`, target `business_post`. |
| `admin_list_audit_log` | Labels `business_post` targets, and `business_report` targets by business name **or** post title. |

## 3. What shipped in the app

| File | Change |
|---|---|
| `routes/BuySell.tsx` | **New.** Tabs, filters, list and the call-to-action box. |
| `routes/BuySellNew.tsx` | **New.** The post form. |
| `components/businesses/PostCard.tsx` | **New.** Browse actions; Mine state, responders and Close / Renew / Delete; the report dialog. |
| `lib/businessPosts.ts` | **New.** Labels, `validatePost`, `postPrefill`, `postableBusinesses`, `whatsAppLink`, and a wrapper per RPC. |
| `components/form/FromProfileLabel.tsx` | **New.** The "From your profile" marker, now shared by `BusinessForm` and the post form. |
| `components/admin/BusinessReports.tsx` | Handles post rows: "Buy & Sell: …" label, Hide post, and no View link for posts. |
| `routes/BusinessHub.tsx`, `App.tsx` | Buy & Sell tile Live. `/business/market` and `/business/market/new` routes. |
| `lib/admin.ts`, `types/database.ts` | `adminSetBusinessPostHidden`, audit labels and link, `BusinessPostRow` / `BusinessPostKind` / `BusinessPostStatus` / `BusinessPostResponder`, the RPC entries, and `AdminBusinessReportRow` with post fields. |

## 4. Known gaps / deferred

- **No notifications.** A poster learns about responses only by opening Mine, and gets no reminder when a post is about to expire.
- **No editing after posting.** Close or delete, and post again.
- **Expired and closed posts are never purged.** They stay in Mine until deleted.
- **Respond leaves the app** for WhatsApp, and the response is recorded even if the member then doesn't send the message.
- **No search box** on Buy & Sell. It has an Industry filter only; the RPC also accepts a city that the UI doesn't expose yet.
- **The listing "Verified" tag isn't shown on posts.**
- **0031 was written without a database to run it against.** Its verification block is at the bottom of the file.

## 5. Before you start 10.7

1. Apply `0031` and run its verification block:
   - 3 tables with RLS on;
   - the one-target check on `business_reports`;
   - 11 functions, one each;
   - `business_post_live` not executable by `authenticated`.

   Deploy the frontend.
2. Smoke test with members A and B and admin C:
   - **Post:** A posts "Looking for 200 wedding cards" as their approved listing. The phone switches to the listing's, and A lands on Mine: Open, 0 members responded. The hub's Buy & Sell tile is Live.
   - **Browse:** B sees it under Requirements (not Offers) with A's business name and no phone. The Industry chip filters it, Save puts it under Saved, and Clear resets.
   - **Respond:** B taps Respond, and WhatsApp opens with the prefilled text to A's post number. Back in the app, the card reads "Responded · WhatsApp". A's Mine shows "1 member responded", which expands to B (linking to B's profile).
   - **Close / renew / delete:** A closes it, and it's gone for B. A renews it, and it's back. A deletes another post.
   - **Report:** B reports a post ("Other" needs details). C sees "Buy & Sell: …" in `/admin/businesses` › Reports and hides it with a reason. A's Mine shows "Hidden by an admin" and the reason, and Renew is disabled. C resolves the report. The audit log shows "Hid Buy & Sell post".
   - **Direct access:** in B's console, `supabase.from('business_posts').select()` returns `[]`.
   - **Listing reports** still work as in 10.3.
3. 10.7 (Referrals, migration `0032`) adds `business_referrals`. Flip the hub's Referrals tile when it ships.
