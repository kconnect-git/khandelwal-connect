# Matrimony — Free vs Paid

Status: **Built in Phase 11.7** (2026-11-17, migration `0039`). Live once a super admin turns the Matrimony paywall on in /admin/access.

Part of the paywall plan: every service gets a free tier and a paid tier.
Guiding rule here: **keep it simple — paid members see all profiles.**

Keep two things separate:
- **Listed** (eligibility): who appears in browse. Unchanged — an approved matrimony
  profile and the member is still eligible (`matrimony_ineligible_reason`).
- **Can view** (entitlement): who can browse. Becomes "has a paid plan".

Routes: `/matrimony`, `/matrimony/:id`, `/matrimony/profile`, `/matrimony/interests`.

## Feature matrix

| Feature | Free | Paid |
|---|---|---|
| Create own matrimony profile and be listed (admin-approved) | ✅ | ✅ |
| Safety: pause, block, report, end match, delete my profile | ✅ | ✅ |
| Browse | ❌ — only a count, e.g. "142 profiles match you" | ✅ **all profiles, both genders** |
| Open a full profile (about me, family background, horoscope, expectations) | ❌ (except people who sent them interest) | ✅ |
| Send interest | ❌ | ✅ |
| See who sent them interest, open that profile | ✅ | ✅ |
| Accept / decline an interest | ✅ | ✅ |
| After a match: photos, full name, family, mobile, email (both sides) | ✅ | ✅ |
| Browse without being a candidate (married member, parent, etc.) | ❌ | ✅ |

## Decisions

1. **Free members see nothing in browse** — only a count of matching profiles, with an
   upgrade prompt.
2. **Only sending interest is paid.** Free members can see who sent them interest,
   open that sender's profile, and accept or decline. A match unlocks contact
   details for both sides (existing mutual-unlock rule, 0024/0025). This means a
   paid member's interest is never wasted on someone who can't reply.
3. **Paid members see all profiles, both genders** — whether or not they are a
   candidate themselves. No "opposite gender only" filter on browse for paid members.
4. **Pre-match locks stay as today**: photos, full name, family, mobile, email are
   shown only after a match, paid or not.
5. **Pending interest limit stays at 10** for everyone (not discussed further; keep
   simple).

## Added while building (11.7)

- **While the Matrimony paywall is OFF, today's rules stay exactly as they are:** a live profile browses the opposite gender, and you need a profile to look at anyone. "Paid sees both genders, with or without a profile" applies only once the paywall is ON. Otherwise applying the migration alone would have let everyone browse both genders.
- **A free member pressing "Express interest" on someone who already sent them one** gets a match. That's accepting, which is free.
- **A paid member without a live profile of their own** can browse and open profiles, but the page says "You need a live matrimony profile to send interest".
- **Cards show gender** when the list mixes genders.

## Notes for implementation

- Change the browse check in `list_matrimony_profiles` / `get_matrimony_profile`
  from "caller has an approved, eligible profile" to "caller is paid" (plus: a free
  caller may open a profile that has a pending/accepted interest *to* them).
- Remove the opposite-gender restriction on browse for paid callers.
- **Sending interest still needs the sender to have their own approved, eligible
  profile** (an interest is from one profile to another) — a paid non-candidate can
  browse but not send. Interests should still only go to the opposite gender.
- The free "count" must be computed server-side and return no profile data.
- If a plan lapses: existing matches and their unlocked contact stay; browsing and
  sending stop.
