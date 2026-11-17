# Phase 11.8 Summary — Access expiry reminders

11.8 is the last sub-phase of Phase 11. Every day at **09:00 IST**, members whose paid access ends within **5 days** get an email asking them to renew. Read it with `phase-11-plan.md` and the 11.1–11.7 summaries.

---

## 1. Behaviour

- **Who gets one:** an approved member whose run of access for a service (chained extensions included) ends within 5 days, if they haven't had a reminder for it yet and **that service's paywall is on**. While a paywall is off nothing locks when access ends, so there's nothing to renew.
- **One reminder per run:** it's recorded on the **last** grant of the run. Extending adds a new grant, so the member is reminded again near the new end date.
- **The email:**
  - subject "Your KITE Matrimony access ends in 3 days" (or "…ends tomorrow")
  - the end date
  - "open Profile → My access and tap Request renewal, or reply to the committee's email"
  - "anything you already have (matches, events you created, your listings) keeps working"
  - an **Open My access** link. Request renewal shows in My access in the last 7 days (11.3).
- **Failures:** a failed send isn't recorded, so the next day retries it. A member with no login email is skipped and logged.

## 2. How it runs (migration `0040_access_expiry_reminders.sql` + edge function `send-access-expiring`)

1. **pg_cron** job `access-expiry-reminders`, schedule `30 3 * * *` (03:30 UTC = 09:00 IST). It uses **pg_net** to POST to `…/functions/v1/send-access-expiring` with an `x-reminder-secret` header.
2. **The secret:** 0040 generates it **inside the database** (64 hex characters) and stores it in **Vault** as `access_reminder_cron_secret`. The function checks it with `access_reminder_secret_ok()`. It's never in code, chat or anyone's terminal.
3. The function runs with the service role and calls `access_reminders_due()` for who's due, sends each email through Resend, then calls `mark_access_reminded(grant ids)`.
4. All three functions can be called **only by `service_role`**, not by signed-in members or signed-out visitors.
5. The function is deployed with **`--no-verify-jwt`**, because the cron call has no user login. The secret is its authentication instead; a missing or wrong secret gets 401.

The `pg_cron` and `pg_net` extensions were available but not installed, and 0040 turns them on. `core_schema.sql` mirrors the column and the three functions; the extensions, secret and job are project setup and live only in 0040.

**Tested on the live database without keeping anything.** 0040's column, secret and functions ran in one transaction ending in a forced error; the extensions and schedule were left out of the test. Existing grants were set aside and six test grants added:

| Case | Due? |
|---|---|
| KHA-KA-2084 Matrimony, ends in 3 days, paywall on | ✅ due, with an email address |
| KHA-KA-4216 Business, ends in 2 days but extended to 32 days | No (only the last grant counts) |
| KHA-JH-9473 Directory, ends in 10 days | No |
| KHA-JH-9473 Matrimony, ends tomorrow, already reminded | No |
| KHA-KA-4216 Events, ends in 2 days, Events paywall off in the test | No |
| KHA-KA-2084 Directory, ends in 4 days, revoked | No |

Other checks:
- Marking the due one leaves 0 due, and marking it again changes nothing.
- The secret check: a wrong, empty or missing secret returns false; the real one (64 characters) returns true.
- As a signed-in member, both functions are refused.

Afterwards the database was confirmed unchanged: no secret, no column, the original grants and paywalls.

## 3. Known gaps / deferred

- **No admin view of reminders sent.** `reminded_at` is on the grant; it could be shown in member access history later.
- **No reminder once access has already lapsed.** The member sees the lock and Request again.
- **Resend's daily limit** isn't a concern at community scale.

## 4. Before you call 11.8 (and Phase 11) done

1. ~~**Deploy the function first.**~~ Deployed on 2026-11-17 with `--no-verify-jwt`.
2. ~~**Apply `0040`.**~~ **Applied on 2026-11-17.** Verified live:
   - `pg_cron` and `pg_net` are installed
   - job `access-expiry-reminders` is `30 3 * * *` and active
   - the Vault secret exists
   - the three functions can be called by `service_role` only
   - a call with a wrong secret gets **401 Not allowed**
3. ~~**Run it once.**~~ **Done end to end:** the job's own `net.http_post` call, with the Vault secret, returned **200 `{"due":0,"sent":0,"failed":0}`**. Nothing ends within 5 days yet. The first scheduled run is 18 Nov, 09:00 IST.
4. Commit.

**Note:** on 2026-11-17 a super admin (KHA-KA-4215) turned **all four paywalls on** from /admin/access. So once 0040 is applied, reminders are live for every service.
