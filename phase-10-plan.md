# Phase 10 Plan — KC Business

Phase 10 grows the existing business listings (Phase 3b, moderation added in 5b-2) into a full **KC Business** section. It follows the 9-screen mockup set (Explore → Business hub → Directory → Detail → My businesses → List your business → Buy & Sell → Referrals → My Business Dashboard).

This is a **plan**, not a handoff. We build one screen at a time as **10.1, 10.2, …**, and each sub-phase gets its own `phase-10.N-summary.md` when it ships, in the same shape as the earlier summaries. Read `phase-3b-summary.md` (the businesses access model) and `phase-5b2-summary.md` (business moderation) before starting.

---

## 1. Where we are today

| # | Mockup screen | Status | What exists |
|---|---|---|---|
| 1 | Explore | ✅ Done | `routes/Explore.tsx`. The Business tile is Live and links straight to `/businesses` |
| 2 | Business hub | ❌ Missing | — |
| 3 | Business directory | ✅ Mostly done | `routes/Businesses.tsx`: count header, debounced search (business or owner name), Category / City / State chips, Load more |
| 4 | Business detail | 🟡 Partial | `routes/BusinessDetail.tsx`: WhatsApp / Call / Website, About, Details rows, social links, Owner card |
| 5 | My businesses | 🟡 Partial | No screen of its own. `/businesses/mine` redirects to `/profile?tab=business` (`components/profile/BusinessTab.tsx`) |
| 6 | List your business | 🟡 Partial | `components/businesses/BusinessForm.tsx`, inside the Profile Business tab |
| 7 | Buy & Sell | ❌ Missing | — |
| 8 | Referrals | ❌ Missing | — |
| 9 | My Business Dashboard | ❌ Missing | — |

**What the backend has today:**
- **`businesses` columns:** name, category (15 fixed values), description, city, state, contact_phone, website, logo_url. 0017 added brand_name, address lines, business_email, primary_product, business_type and 4 social URLs. 0021 added `is_hidden` and its moderation columns.
- **Access model:** RLS covers owner writes. `SECURITY DEFINER` RPCs handle reads (`list_businesses`, `get_business`, `list_member_businesses`, `business_filter_options`).
- **Moderation:** admins can hide a listing after it's published (`/admin/businesses`, Visible / Hidden). There is **no pre-approval**: a new listing goes live immediately.

---

## 2. Gaps between the mockups and the code

| Screen | Missing |
|---|---|
| 2 Hub | Hub page, search box, 6 tiles with Live / Soon badges |
| 3 Directory | "Verified" badge on cards, "+ List a business" button, back link to the hub |
| 4 Detail | Products & services chips, "Verified member" tag, owner member code in the info table, **Share / Save / Report** |
| 5 My businesses | A screen of its own, with an **Approved / Pending review** status per listing and View / Edit |
| 6 List your business | Page-style form, **"From your profile"** prefill (role, city, state, phone), **"Show this number on the listing"** toggle, products & services chip input, owner's role/designation |
| 7 Buy & Sell | Everything |
| 8 Referrals | Everything |
| 9 Dashboard | Everything, including **tracking** views, call taps and WhatsApp taps |

---

## 3. Build order

Each sub-phase is one screen, so it's small enough to ship and smoke-test alone. Migrations continue from `0026`.

| Sub-phase | Screen | Depends on | Migration |
|---|---|---|---|
| **10.1** ✅ | Business hub | — | `0026` wider search in `list_businesses` |
| **10.2** ✅ | Directory polish | 10.1 | `0027` admin-set Verified flag |
| **10.3** ✅ | Business detail | — | `0028` products, saves, reports, activity tracking |
| **10.4** | List your business | 10.3 (products column) | `0029` show-phone, owner role, review status |
| **10.5** | My businesses | 10.4 (review status) | admin queue in the same `0029` |
| **10.6** | Buy & Sell | 10.1 | `0030` posts |
| **10.7** | Referrals | 10.1 | `0031` referrals |
| **10.8** | My Business Dashboard | 10.3 tracking, 10.6, 10.7 | `0032` enquiries + stats RPC |

Activity tracking (views / calls / WhatsApp taps) ships in **10.3**, not 10.8, so the dashboard has real data by the time it's built.

---

## 4. Sub-phases

### 10.1 — Business hub (screen 2) — ✅ built, see `phase-10.1-summary.md`
- New route **`/business`** ("KC Business — Discover. Connect. Grow."). The Explore Business tile **and the desktop header "Businesses" link** point here instead of `/businesses`.
- Search box: on submit, goes to `/businesses?q=<text>`. The directory reads `q` as its starting search. **`list_businesses` search was widened** (`0026`) to also match category, city, state, brand, primary product and description.
- 6 tiles, reusing Explore's tile and `SectionBadge`:
  - Business Directory (Live → `/businesses`)
  - Buy & Sell (Soon)
  - Referrals (Soon)
  - Products & Services (Soon)
  - Meetings & Events (Soon)
  - My Business Dashboard (Soon)

  Each tile flips to Live in the sub-phase that builds it.
- `NavTabs`: add `/business` to the Explore prefix list so the tab stays lit.
- **Exit:** Explore → Business → hub → Directory works, and a search from the hub lands pre-filtered.

### 10.2 — Business directory polish (screen 3) — ✅ built, see `phase-10.2-summary.md`
- Header: **My businesses** + **+ List a business** buttons. Both open the Profile Business tab until 10.4 / 10.5 give them their own pages.
- Back link "‹ Business" to the hub (shipped in 10.1).
- Card: a blue **"Verified"** text tag. Verified is an **admin-set flag** (`0027`: `is_verified`, trigger-protected, `admin_set_business_verified`, audited), with Verify / Unverify on `/admin/businesses`.
- **Exit:** the card matches the mockup and the buttons route correctly.

### 10.3 — Business detail (screen 4) — ✅ built, see `phase-10.3-summary.md`
- **Products & services:** new `businesses.products text[]` (≤ 20 items, 1–60 characters each), shown as chips. Old `primary_product` values were copied in. The Profile > Business form now uses a chip input, and `primary_product` is no longer edited or shown.
- **Header:** the blue **Verified** tag (10.2's flag). The owner's member code stays on the Owner card rather than as a fact row.
- **Contact buttons:** unchanged, WhatsApp primary (decided in planning, against the mockup's Call-first).
- **Share:** Web Share API, falling back to copying the link (`/businesses/:id`, which needs login).
- **Save:** new `business_saves`. Saved listings show under a **Saved** chip on the directory.
- **Report:** new `business_reports`, a copy of `matrimony_reports`, with an admin **Reports** tab on `/admin/businesses` (Hide listing + Resolve, audited) and an Overview tile. The report dialog is now shared with matrimony (`components/ReportDialog.tsx`).
- **Tracking:** new `business_activity` via `log_business_activity`. Each viewer counts at most once per kind (view / call / WhatsApp) per IST day, and the owner never counts.
- "Ask about this" enquiries on a product chip remain **10.8**.
- **Exit:** chips, Share, Save and Report work. Opening a listing as another member writes one view row, and tapping Call or WhatsApp writes a row each.

### 10.4 — List your business (screen 6)
- Move the add/edit form out of the Profile tab onto its own pages: **`/businesses/new`** and **`/businesses/:id/edit`**. Both reuse `BusinessForm`. The Profile Business tab becomes a short summary that links to My businesses.
- **"From your profile" prefill:** on a new listing, prefill city, state, phone and role from `people`. Each prefilled field has a small "From your profile" label until the member edits it. Nothing is written back to the profile.
- **New columns:**
  - `owner_role text`: free text, e.g. "Founder" or "Partner". It describes the listing, not the person, so the "no free-text profession" rule doesn't apply.
  - `show_phone boolean default true`: when false, `get_business` / `list_businesses` return no phone (admins still see it).
- Products & services input: a text box with an **Add** button, and removable chips.
- Logo upload: today a logo can only be added once the listing exists. Keep that, by saving first and then showing the logo upload.
- Required fields per the mockup: name, category, city, state, phone.
- **Exit:** a member creates a listing from `/businesses/new` with prefilled fields. With the phone hidden, another member can't see it in the UI or through the RPC.

### 10.5 — My businesses (screen 5)
- New route **`/businesses/mine`** (replacing the redirect): a list of the member's own listings with status, View / Edit, "+ Add", and a dashed "Own another business?" block.
- **Pre-approval:** new `businesses.review_status` (`pending → approved | changes_requested | rejected`), using the same lifecycle as events and matrimony. Existing rows are backfilled as `approved`. Member-facing reads require `approved` and `not is_hidden`. Changing the column from the client is blocked by a trigger, like `businesses_protect_moderation_columns`.
- Edits after approval: **not** re-reviewed (same as matrimony 6a). Admins can still hide a listing.
- Admin: `/admin/businesses` gets a **Pending** tab with Approve / Request changes / Reject (with a reason), audited. The Overview gets a "Businesses pending" tile.
- The note from the mockup: "New listings are shown to members after an admin approves them."
- **Exit:** a new listing shows "Pending review", is invisible to other members, and goes live once an admin approves it.

### 10.6 — Buy & Sell (screen 7)
- New `business_posts` table:
  - `kind` (`requirement | offer`), `title`, `details`
  - `quantity_or_budget` / `price_or_terms`
  - `category` (same 15 values), `city`, `state`
  - `poster_person_id`, optional `business_id`
  - `status` (`open | closed`), `expires_at` (default 30 days), and the `is_hidden` moderation columns
- Route **`/business/market`** with tabs **Requirements / Offers / Mine**. Cards show a "Looking for" or "Offering" pill, the date, the poster and their business. Each card has **Respond** and **Save** buttons.
- **Respond** opens the poster's WhatsApp with a pre-filled message *and* records an enquiry (10.8).
- "Post a requirement or offer" form. In Mine, the poster can close or delete their posts.
- **Moderation:** posts go live without review (they're short-lived). Report and hide work as in 10.3.
- **Exit:** member A posts a requirement, member B sees it and responds, and A can close it.

### 10.7 — Referrals (screen 8)
- New `business_referrals` table:
  - `from_person_id`, `to_business_id`
  - `lead_name`, `lead_phone`, `note`
  - `status` (`new → accepted → in_talks → closed`, or `declined`), `closed_outcome` (`won | lost`, optional), timestamps
- **Privacy:** `lead_phone` is visible only to the referrer and the receiving business's owner. Every read and write goes through RPCs only (the events model).
- Route **`/business/referrals`**: Given / Received / Closed counters, **Received / Given** tabs, Accept / Decline on New, "Update status" on accepted ones, and a **Give a referral** form (pick a business → lead details → note).
- **Exit:** A refers a lead to B's business. B accepts it, moves it to In talks and then closes it, and A sees each status change under Given.

### 10.8 — My Business Dashboard (screen 9)
- Route **`/business/dashboard`**, with a business picker when the owner has more than one.
- **Listing completeness:** computed client-side from the filled fields, along with a nudge such as "Add products and services…".
- **This month:** profile views, calls, WhatsApp taps (from `business_activity`) and enquiries. These come from one `business_dashboard_stats(business_id)` RPC that only the owner can call.
- **New enquiries:** new `business_enquiries (business_id, from_person_id, about text, source detail|market, created_at, read_at)`. Enquiries come from a new "Ask about this" action on a product chip (10.3 detail page) and from Buy & Sell Respond. **Reply** opens WhatsApp to the enquirer.
- **Match banner:** a count of open requirements in the business's category, with a link to Buy & Sell filtered to that category.
- **Exit:** the owner sees non-zero stats generated by another test account, plus that account's enquiry, and Reply opens WhatsApp.

---

## 5. Cross-cutting rules (carried over, do not re-derive)

- **Onboarding wizard untouched.** Every new field lives on the listing or in the Business section.
- **Access model:** listing rows keep the hybrid model (RLS for owner writes, RPCs for joined reads). New tables with a status lifecycle or private data (referrals, enquiries, reports, posts) are **RPC-only**, as in events and matrimony.
- **Function signature changes:** use `drop function if exists <old signature>` before recreating (the gotcha from `phase-3b-summary.md` §2).
- **Migrations are run by hand** in the SQL editor, written to be re-runnable, and mirrored into `ddl/core_schema.sql` and `ddl/enable_rls.sql`.
- **Admin actions are audited** in `admin_audit_log`, and new action types get labels in the audit page.
- **Notifications are in-app only** (badges or counts). Email and push stay with Phase 7.

---

## 6. Open decisions (settle before the sub-phase that needs them)

1. ~~**What "Verified" means (10.2 / 10.3).**~~ **Decided in 10.2:** a separate admin-set `is_verified` flag for listings an admin has actually checked (GST, shop visit, known personally). It's independent of 10.5's approval.
2. **Should the Profile Business tab keep an editor (10.4)?** Recommendation: no. The tab shows a summary and links to My businesses, so there's one place to edit.
3. **Pre-approval for existing listings (10.5).** Recommendation: backfill everything currently live as `approved`, so nothing disappears.
4. **Do Buy & Sell posts need review (10.6)?** Recommendation: no, rely on report and hide. Revisit if there's spam.
5. **Referral outcome value (10.7):** should a closed referral record a ₹ value? Recommendation: not in v1, only won or lost.
6. **Products & Services and Meetings & Events tiles:** these stay **Soon** throughout Phase 10. Products & Services could later become a search across `products`, and Meetings & Events could link to Events filtered to business meet-ups.

## 7. Out of scope for Phase 10

- In-app chat. Contact stays on WhatsApp and Call.
- Payments, featured or paid listings.
- Logo galleries, or more than one logo.
- Email or push for referrals, enquiries or posts.
- Distributor or investor tags (still undesigned, from `phase-3b-summary.md` §5).
