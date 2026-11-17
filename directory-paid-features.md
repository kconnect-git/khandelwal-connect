# Directory — Free vs Paid

Status: **Built in Phase 11.4** (2026-11-17, migration `0036`). Live once a super admin turns the Directory paywall on in /admin/access.

Part of the paywall plan: every service gets a free tier and a paid tier.
The general rule across the app: free members can see **who and what exists**;
paid members get **how to reach them**.

Routes: `/directory` (search list), `/members/:id` (opened profile).
Current behaviour (before paywall): every approved member sees everything below;
a member can already hide their own mobile number.

## Feature matrix

| Feature | Free | Paid |
|---|---|---|
| Search by name | ✅ | ✅ |
| Filters (state, city, gotra, occupation) | ✅ one at a time | ✅ combined |
| List card: name, photo, member code, city, state, gotra | ✅ | ✅ |
| List card: occupation type | ✅ | ✅ |
| List card: job title, company | ❌ | ✅ |
| Profile: native place, education | ✅ | ✅ |
| Profile: marital status | ❌ | ✅ |
| Profile: district, job location | ❌ | ✅ |
| Profile: mobile number + Call / WhatsApp buttons | ❌ — show "Upgrade to contact" | ✅ |
| Profiles opened per day | **10** | Unlimited |
| Export / download | ❌ | ❌ (admin only) |

## Decisions

1. **Mobile number is the main paid feature** of the Directory. Free members see an
   "Upgrade to contact" prompt in its place.
2. **Marital status is hidden from free members**, so the Directory can't be used as a
   free way round Matrimony.
3. **Daily limit: 10 profile opens per day** for free members (also limits scraping).

## Added while building (11.4)

- **Job title and company are hidden on the opened profile too,** not only on list cards. Otherwise they'd be one tap away.
- **Family linking (Profile → relatives) no longer returns a relative's mobile** without Directory access, because the name search would otherwise hand out what the Directory locks. Free members type the number themselves.
- **Name search combines with one filter.** Only state, city, gotra and occupation count towards "one at a time".
- **The day is India time.** The allowance resets at midnight IST.

## Notes for implementation

- Hide paid fields **on the server** (in `list_directory` / `get_member_profile` RPCs),
  not just in the UI; otherwise free members can read them from the network response.
- A member's own "hide my mobile" setting still wins over paid status.
- The daily limit needs a per-member counter of profile opens (reset daily); opening
  the same profile twice in a day should count once.
- Keep "can view" (entitlement) separate from anything about being listed.
