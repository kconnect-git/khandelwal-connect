# Paywall — Overview

Started 2026-11-16. Free-vs-paid split agreed for all five live services; nothing
implemented yet (no subscription or entitlement code exists).

**General rule:** free members see *who and what exists*; paid members get *how to
reach them* and the tools that bring them business. Profile, attending events, and
being listed (business, matrimony) stay free so the network stays full.

| Service | File | Paid in short |
|---|---|---|
| Directory | [directory-paid-features.md](directory-paid-features.md) | mobile / Call / WhatsApp, marital status, job details, combined filters; free capped at 10 profile opens/day |
| Business | [business-paid-features.md](business-paid-features.md) | listing contacts, enquiries, Buy & Sell respond/post, reading dashboard enquiries; listing a business and referrals are free |
| Events | [events-paid-features.md](events-paid-features.md) | creating events and inviting; attending always free; committee events free |
| Matrimony | [matrimony-paid-features.md](matrimony-paid-features.md) | browsing all profiles (both genders) and sending interest; free can be listed and accept interests |
| Profile | [profile-paid-features.md](profile-paid-features.md) | all free; paid badge; "who viewed me" later |

## Plan and payment decisions (2026-11-17)

1. **Separate add-ons per service.** A member is paid *for a service*, not paid
   overall. Paid services: **Directory, Business, Events, Matrimony.** Profile has no
   add-on (it is free).
2. **Monthly pricing.** Each grant of access lasts one month and then needs renewing.
3. **Payments are offline for now.** No payment provider in the app.
   - Member taps **"Request access"** on a locked service → a request is recorded
     (member, service, date).
   - The conversation and payment happen **by email**, outside the app.
   - An **admin or moderator** grants access to that service from the **admin
     portal** (e.g. "give X access to Matrimony"). They can also extend or revoke it.
4. **When access lapses:** what the member already has keeps working (matches and
   their unlocked contact, events they created, their listings); new paid actions
   and paid views stop.

## Defaults agreed (2026-11-17)

- **Grant length:** admin picks **1, 3 or 12 months** (default 1) when granting or
  extending. Extending adds to the current end date, not to today.
- **Paid badge:** shown when the member has **any** active add-on.
- **Admins and moderators** get every service automatically.
- **Emails:** member is emailed when access is **granted**, and **5 days before** it
  expires (existing Resend setup).

## Still to decide

- Prices per add-on (not needed in the app while payment is offline).
- Should admins also get an email for each new access request, or just the in-app
  queue? (Plan default: in-app queue only.)

Build plan: [phase-11-plan.md](phase-11-plan.md).

## Implementation principles

- Enforce every paid check **on the server** (in the RPCs), never only in the UI.
- Keep **entitlement** (can view / act) separate from **eligibility** (can be listed).
- One helper, e.g. `has_service_access(person_id, service)`, true when the member has
  a grant for that service whose end date is in the future. Every RPC uses it.
- Data: an access-grants table (member, service, starts, ends, granted_by, note) and
  an access-requests table (member, service, status, requested_at, handled_by).
  Grants and revocations go in the existing audit log.
- Admin roles already exist (`moderator`, `super_admin`); both can grant access.
- Admins and moderators themselves: decide whether they get every service
  automatically (suggested: yes).
