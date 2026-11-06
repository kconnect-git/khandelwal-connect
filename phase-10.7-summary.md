# Phase 10.7 Summary — Handoff to 10.8

10.7 is the seventh sub-phase of Phase 10 (KC Business). Read it with `phase-10-plan.md` and `phase-10.6-summary.md` (the RPC-only patterns and `whatsAppLink` it reuses).

---

## 1. What Phase 10.7 is

Mockup screen 8, **Referrals: give, receive and track.** A member passes a lead (someone who needs something) to another member's business; the owner accepts or declines and tracks it to a close.

| Feature | Behaviour |
|---|---|
| **Referrals page** | `/business/referrals` (hub tile now Live). Three counters: **Given / Received / Closed**, where Closed adds "N business done". **Received / Given** tabs; Received is the default and reads "Received (N new)" when something is waiting. New first, then In talks, then the rest, newest first, with Load more. **Give a referral** at the bottom. |
| **Give** | From **Refer someone** on any business detail page (non-owners; business pre-picked), or from `/business/referrals/new` with a business search (directory search, 2+ characters, own listings left out). |
| **The lead** | **Someone else:** name + phone, both required. **A member:** search by name (3+ characters) and pick; the name fills, and the phone too unless they hide their number (it's then optional). The business sees a "View profile" link. |
| **Note and consent** | "What's it for?" is required. The **I have their permission to share their details with this business** box is required, and says the number is only seen by the two of them and removed once the referral is closed or declined. |
| **Received card** | Status pill, the lead's name, the note, "Referred by X · for <business>", and while open **Call** / **WhatsApp** the lead (WhatsApp prefilled "…X from the Khandelwal community passed on your details") and View profile for a member lead. **New:** Accept / Decline (optional reason, which the referrer sees). **In talks:** **Update status** → **Business done** / **Didn't work out** (confirmed). |
| **Given card** | "To <business>", the note, "Lead: …", and the status as it moves. Decline reasons and outcomes show here. **Withdraw** while still New. |
| **Privacy** | Once declined or closed, the phone is **erased from the row**, not just hidden. |

Decisions taken during planning: the lead can be anyone; both entry points; New → Accept / Decline, In talks → Business done / Didn't work out; consent checkbox with the number cleared at the end.

## 2. Schema / backend (migration `0032_business_referrals.sql`, mirrored in `ddl/core_schema.sql` and `ddl/enable_rls.sql`)

**`business_referrals`**, RPC-only (RLS on, no policies):
- referrer and business (both cascade);
- `lead_name` (1–100), `lead_phone` (+91…, nullable), `lead_person_id` (set null);
- `note` (1–500);
- `status` new | in_talks | declined | closed;
- `outcome` won | lost, required exactly when closed (a table check);
- `decline_reason` (≤ 300) and timestamps;
- indexes on (business_id, status) and (referrer_person_id).

| Function | Notes |
|---|---|
| `give_business_referral(business, lead_name, lead_phone, lead_person_id, note, consent) → uuid` | Approved members only. Requires consent. The business must be visible (`get_business`) and not yours. A typed lead needs a phone. A picked member must be approved and not the owner. |
| `list_business_referrals(direction, limit, offset)` | `received` = to any of your businesses (whatever their review state); `given` = yours. `lead_phone` only while new or in talks. |
| `business_referral_counts()` | jsonb `{ given, received, closed, won, received_new }`. |
| `respond_business_referral(id, accept, reason)` | Owner, new only. Accept → in_talks; decline → declined, with the reason, and **clears the phone**. |
| `close_business_referral(id, 'won' \| 'lost')` | Owner, in_talks only. Sets the outcome and **clears the phone**. |
| `withdraw_business_referral(id)` | Referrer, new only. Deletes it. |

## 3. What shipped in the app

| File | Change |
|---|---|
| `routes/Referrals.tsx` | **New.** Counters, tabs, list and Give button. |
| `routes/ReferralNew.tsx` | **New.** Business pick or search, the lead toggle and member search, note, consent. |
| `components/businesses/ReferralCard.tsx` | **New.** Both directions, every action, confirmations. |
| `lib/businessReferrals.ts` | **New.** Labels, `validateReferral`, wrappers. |
| `routes/BusinessDetail.tsx` | **Refer someone** for non-owners. |
| `routes/BusinessHub.tsx`, `App.tsx` | Referrals tile Live. `/business/referrals` and `/business/referrals/new`. |
| `types/database.ts` | `ReferralStatus`, `ReferralOutcome`, `BusinessReferralRow`, `ReferralCounts`, 6 RPC entries. |

## 4. Known gaps / deferred

- **No notifications.** An owner only sees new referrals by opening Referrals, though the tab shows a count.
- **No admin or report path.** A spammy referrer can't be reported in-app yet.
- **A referral to a listing that later goes pending, hidden or turned down** stays in its owner's Received list and can still be acted on. Giving one needs the listing to be live.
- **A member lead's number is copied at the time of referral.** If they later hide their number, the copy stays until the referral closes.
- **Counts aren't per business.** The 10.8 dashboard can break them down.
- **0032 was written without a database to run it against.** Its verification block is at the bottom of the file.

## 5. Before you start 10.8

1. Apply `0032` and run its verification block (the table has RLS on; 6 functions, one each). Deploy the frontend.
2. Smoke test with member A (owns an approved listing), member B and member C:
   - **Give from detail:** B opens A's listing and taps **Refer someone**, so the business is pre-picked. B enters "Ravi Sharma", a phone and "Needs 500 wedding cards". Sending without the consent box is refused; with it, B lands on Given with **New**, and the counters read Given 1.
   - **Give from page:** B opens `/business/referrals/new`, searches for A's business, switches to **A member**, picks C (the name fills), and sends.
   - **Receive:** A sees **Received (2 new)**, the lead's name and Call / WhatsApp, and View profile on C's. **Accept** one: it moves to In talks, and B's Given card updates. **Decline** the other with a reason: B sees Declined and the reason, and the phone is gone for both.
   - **Close:** A taps Update status → **Business done** → confirm. Both see "Closed · Business done", with no phone, and Closed reads 1 with "1 business done".
   - **Withdraw:** B gives another and withdraws it while New, and it's gone for both.
   - **Guards:** A's own listing has no Refer button and isn't offered in search. In the console, `supabase.from('business_referrals').select()` returns `[]`.
3. 10.8 (My Business Dashboard, migration `0033`) reads `business_activity` (10.3), `business_post_responses` (10.6) and `business_referrals` (10.7) per listing, and adds enquiries.
