# Phase 11.5 Summary — Business gating

11.5 locks the paid parts of KC Business, as set out in `business-paid-features.md`. Read it with `phase-11-plan.md` and the 11.1–11.4 summaries. **It changes nothing until a super admin turns the Business paywall on** in /admin/access. Every check goes through `has_service_access(me, 'business')`.

---

## 1. What members without Business access get

| Where | Free | With access, admins, or the listing's owner |
|---|---|---|
| **Business directory and detail** | Name, logo, category, place, **office address**, description, products, Verified, owner card. **No phone, email, website or social links.** "Upgrade to contact {business}" + Request access replaces WhatsApp / Call / Website / Enquire. Product chips are plain (not enquiry buttons). | Everything. The owner always sees their own listing in full, and the listing's own "show this number" still applies. |
| **Enquire** | Refused (`KCL03`) | As before |
| **Buy & Sell** | Read every post. **Respond** shows "Responding to posts is part of Business access" + Request access. The **Post** button is replaced by a lock line, and `/business/market/new` shows a lock card. | Respond (opens WhatsApp) and post |
| **Lapsed access** | A post you **already responded to** still opens the poster's WhatsApp | — |
| **My Business Dashboard** | Completeness, month tiles, leads and the match banner stay free. The enquiry list becomes "**N enquiries waiting for you**" + Request access. | The enquiry list, Reply, Mark done |
| **Free for everyone** | Listing your own business, saves, reports, referrals (giving and receiving) | — |

## 2. Schema / backend (migration `0037_business_gating.sql`, mirrored in `ddl/core_schema.sql`)

The whole migration runs in one transaction. **The six function bodies were generated from the current `core_schema.sql` with only the marked edits**, and the same text was written back to the core schema, so the two can't drift. Return types are unchanged (create or replace), and all six are closed to `anon`.

| Function | Change |
|---|---|
| `list_businesses`, `get_business` | `contact_phone`, `website`, `business_email` and the 4 social URLs are null unless the caller owns the listing, is an admin, or has Business access. A `cross join lateral` resolves the caller once. |
| `send_business_enquiry`, `create_business_post` | `KCL03` without access |
| `respond_to_business_post` | `KCL03` without access, **unless the caller already responded to that post** (lapse rule) |
| `list_business_enquiries` | No rows without access. `business_dashboard` counts are untouched. |

**Tested on the live database without keeping anything.** The real 0037 plus tests ran in one transaction ending in a forced error (`psql --single-transaction`), with the Business paywall switched on inside it. Afterwards the database was confirmed unchanged: paywall off, no enquiries, posts or responses added, the listing owner as before, and the old function bodies.

| Check | Result |
|---|---|
| Free list (KHA-KA-2084) | 2 listings, no phone or website |
| Free detail | Found; phone and email null; name and products present |
| Free enquire / post | `KCL03` "Sending enquiries…" / "Posting in Buy & Sell is part of Business access." |
| Free first respond (KHA-KA-4216, non-admin) | `KCL03` "Responding to posts is part of Business access." |
| Free re-respond (KHA-KA-2084, who responded during 10.6 testing) | Allowed: the lapse rule, as designed |
| Free read posts | 1 post |
| Non-admin owner without access (listing reassigned to KHA-KA-4216 inside the transaction) | Own listing full; dashboard counts 1 enquiry, list returns 0 |
| After a Business grant | Phone and email present; respond returns the phone; enquiry sent |
| Grant revoked after responding | Re-responding still returns the phone |
| Signed out | `permission denied for function list_businesses` |

An admin-owned listing (KHA-MH-3004) listed its enquiries without a grant. That's correct, because admins get every service.

## 3. What shipped in the app

| File | Change |
|---|---|
| `routes/BusinessDetail.tsx` | `locked = !isOwner && !hasAccess('business')`: the compact LockedFeature replaces the contact row, and product chips go plain. |
| `components/businesses/PostCard.tsx` | Respond, when locked and not already responded, shows the lock line instead. |
| `routes/BuySell.tsx`, `routes/BuySellNew.tsx` | The Post button is replaced by a lock line; the new-post page shows a lock card. |
| `routes/BusinessDashboard.tsx` | "N enquiries waiting for you" + Request access replaces the list. Show handled is hidden. |
| `lib/serviceAccess.ts` | **`PAYWALL_READY.business = true`** |

`tsc -b` and `vite build` pass, with no new lint warnings.

## 4. Known gaps / deferred

- **Enquiries now only come from paid members.** A free owner sees the count but not the senders. That's by design.
- **The badge isn't on business cards.** The plan left that open.
- **The owner card links to the owner's member profile,** which follows the Directory rules (11.4).

## 5. Before you call 11.5 done

1. ~~**Apply `0037`.**~~ **Applied on 2026-11-17** with `scripts/sql.sh -f`, in one transaction. Verified live:
   - all six functions carry the gate, are closed to `anon` and open to `authenticated`
   - the Business paywall is **off**
   - as KHA-KA-4216 (non-admin, no grant): listings still show phone and email, as before
2. Deploy the frontend.
3. **Smoke test:** Admin → Access → Business → Turn on. Then, as a non-admin member without Business access:
   - A listing shows "Upgrade to contact…" and no phone, email or links.
   - Buy & Sell Respond shows the lock line, and Post is locked.
   - If they own a listing, the dashboard shows "N enquiries waiting".
   - **Request access** reaches the admin queue.

   Then grant Business and check everything opens up. Finally, decide whether to leave the paywall on.
4. Commit. **11.4, the bell change and 11.5 are all still uncommitted.**
