# Phase 11.7 Summary — Matrimony gating

11.7 locks the paid parts of Matrimony, as set out in `matrimony-paid-features.md`. Read it with `phase-11-plan.md` and the 11.1–11.6 summaries.

**There are two modes, chosen by the Matrimony paywall switch.** Off means **today's rules, unchanged**, so applying 0039 alone changes nothing. On means the paid rules below.

---

## 1. Behaviour

| | Paywall OFF (as before) | ON, with access (or admin) | ON, no access |
|---|---|---|---|
| **Matrimony home** | A live profile browses the opposite gender; otherwise "Create your profile" + How it works | Browse **every listed profile, both genders**, with or without a profile of your own. Without a live profile, a card says "Create a profile to send interests and be listed". Cards show gender when the list mixes. | "**N profiles match you**" + Request access ("Replying to interests you receive is always free"), and your profile card |
| **Open a profile** | Live profile + opposite gender, or a match | Any listed profile | Only someone with a **pending interest between you** (so you can see who sent one, and answer), or a match. Otherwise "Viewing profiles is part of Matrimony access" + Request access |
| **Send interest** | Live profile + opposite gender | Also needs your own **live profile** and the **opposite gender**. Otherwise the page shows "You need a live matrimony profile to send interest ›", or nothing for same gender. | `KCL05` "Sending interest is part of Matrimony access." The page shows the lock line, **unless they already sent you one**, which makes a match |
| **Reply, matches, photos / contact unlock, pause / block / report, being listed** | Free | Free | Free. **Matches survive a lapse.** |

## 2. Schema / backend (migration `0039_matrimony_gating.sql`, mirrored in `ddl/core_schema.sql`)

The whole migration runs in one transaction. All touched functions are closed to `anon`.

- **New definer-only helpers:**
  - `matrimony_my_person_id()`
  - `matrimony_persons_blocked(a, b)`: blocks are person-keyed, so this also covers a caller without a profile
- **`list_matrimony_profiles`:** plpgsql now, with the two modes. It **gains `gender`**, so it was dropped and recreated.
- **`matrimony_browse_count()`:** new. A count only: the opposite gender for someone with an active profile, everyone listed otherwise.
- **`matrimony_filter_options`:** the same modes.
- **`get_matrimony_profile`:** the two modes. It adds **`can_express`** and **`express_blocker`** (`no_profile` / `same_gender` / `no_access`) to its jsonb, so its return type is unchanged.
- **`express_interest`:** the access check (skipped when the other person already sent you one), plus an explicit opposite-gender check.
- **Unchanged:** `respond_interest`, `list_my_interests`, `matrimony_photo_visible` (photos stay match-only) and the safety functions.
- **`core_schema.sql` order:** the helpers sit right after `matrimony_photo_visible`, ahead of the SQL-language `matrimony_browse_count` that calls them.

**Tested on the live database without keeping anything.** The test recorded today's results first, then ran the real 0039 and the checks in one transaction ending in a forced error. Afterwards the database was confirmed unchanged: paywall off, 0 interests, 1 live Matrimony grant (KHA-KA-2084's real 11.2 one), and no new function.

The test data: KHA-KA-2084 (female, non-admin, live profile); KHA-KA-4215 and KHA-KA-8139 (male, admins, live profiles); KHA-KA-4216 (non-admin, no profile). KHA-KA-2084's real Matrimony grant was revoked inside the transaction so they were genuinely free.

| Check | Result |
|---|---|
| OFF: 2084 and 4216 browse list and filters | **Identical to today's live functions** (2 rows / 0 rows) |
| OFF: 2084 opens 4215; 4216 (no profile) opens 2084 | Yes, `can_express` true / no |
| ON, free 2084 | List 0, browse count 2, no filter options; can't open 4215; express → `KCL05` |
| ON, admin 4215 | Both genders, 2 rows. Opens 8139 (same gender): `express_blocker = same_gender`, and sending is refused "Interests can only be sent to the opposite gender". Sends to 2084: `sent` |
| ON, free 2084 after 4215's interest | Opens 4215 (`received`, `no_access`); Received box 1; **accepts → matched, contact unlocked**; still can't browse |
| ON, paid 4216 (no profile) | 3 rows, both genders; opens 2084 with `can_express` false, `no_profile`, contact locked |
| ON, paid 2084 | Sends to 8139: `sent` |
| Signed out | `permission denied for function matrimony_browse_count` |

## 3. What shipped in the app

| File | Change |
|---|---|
| `routes/matrimony/MatrimonyHome.tsx` | The modes, from the ServiceAccess context: `BrowseTeaser` (count + LockedFeature) and `ProfileLinkCard` (extracted). Gender is shown on cards when mixed. |
| `components/matrimony/MatrimonyCard.tsx` | `showGender` |
| `routes/matrimony/MatrimonyProfilePage.tsx` | The Express section follows `can_express` / `express_blocker`. A locked-out member sees the lock card in place of "isn't available". |
| `lib/matrimony.ts`, `types/database.ts` | `matrimonyBrowseCount`; `gender`, `can_express`, `express_blocker`; `matrimony_browse_count` |
| `lib/serviceAccess.ts` | **`PAYWALL_READY.matrimony = true`**. All four paywalls can now be turned on. |

`tsc -b` and `vite build` pass, with no new lint warnings.

## 4. Known gaps / deferred

- **KHA-KA-2084 still holds the real 1-month Matrimony grant** from the 11.2 test (until 17 Dec). Remove it in Admin → Access if it shouldn't count.
- **No parent or guardian browsing on a child's behalf.** That was out of scope in the plan. A paid non-candidate browses as themselves.
- **The admin matrimony pages are unchanged.**

## 5. Before you call 11.7 done

1. ~~**Apply `0039`.**~~ **Applied on 2026-11-17** with `scripts/sql.sh -f`, in one transaction. Verified live:
   - all five member functions are closed to `anon` and open to `authenticated`; the two helpers are closed to both
   - the Matrimony paywall is **off**
   - KHA-KA-2084 still browses 2 profiles, male only; KHA-KA-4216 (no profile) browses none, exactly as before
   - the photo read policy still uses `matrimony_photo_visible` (matches only)
2. Deploy the frontend.
3. **Smoke test:** Admin → Access → Matrimony → Turn on.
   - As a non-admin **without** access: Matrimony shows "N profiles match you" + Request access, and a profile link from elsewhere shows the lock card.
   - Have someone send them an interest. It appears under Interests, they can open it and accept, and the match unlocks contact details.
   - Grant access. They see both genders, and sending works from their live profile.
   - Decide whether to leave the paywall on.
4. Commit.
