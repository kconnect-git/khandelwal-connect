# Phase 6b Summary — Handoff to Phase 6c

Read this before starting 6c (pause, un-match, block, report). 6b delivers the **Phase 6 exit criterion**: two members mutually express interest, and only then see each other's contact details. Decisions shared by all of Phase 6 are in `phase-6a-summary.md` §1. Treat this file plus `phase-1-summary.md` … `phase-6a-summary.md` as the source of truth.

---

## 1. What Phase 6b is

| Decision | What was built |
|---|---|
| Who browses | A member whose own matrimony profile is **approved and still eligible**. Everyone else sees the 6a explainer |
| Who is browsable | Approved profiles whose member is eligible **right now** (checked at read time), **opposite gender**, not yourself |
| Card / detail before a match | First name + surname initial, age, city/state, gotra, education, occupation, height, the three texts, disclosed opt-in details. Initials avatar, no photos |
| Unlock | An accepted interest in either direction. Adds full name, father/mother (from `family_relations`), native place, login email, mobile (**null if `hide_mobile`**), photos |
| Interest | Optional message ≤300. Cap of **10 pending outgoing**. Withdrawable while pending, and a withdrawn interest can be re-sent. If they already sent you one, expressing interest **accepts theirs** (instant match) |
| Decline | **Silent.** The sender sees "No response" and can't re-send. The recipient may still send their own interest later |
| Notifications | In-app badge = unseen received interests + unseen acceptances of yours |

## 2. Schema / backend (migration `0024_matrimony_interests.sql`, mirrored in `ddl/core_schema.sql`, `ddl/enable_rls.sql`, `ddl/bucket_policies.sql`)

**`matrimony_interests`** (RPC-only): `from_profile_id`, `to_profile_id` (→ `matrimony_profiles`, cascade), `message`, `status` (`pending | accepted | declined | withdrawn`), `created_at`, `responded_at`, `recipient_seen_at`, `sender_seen_at`. `unique (from, to)`, `from <> to`. A re-send after withdrawal reuses the row. Indexed on `(to, status)` and `(from, status)`.

**Storage:** the `matrimony photo read` policy is now owner **or** admin **or** `matrimony_photo_visible(folder)`, i.e. the caller is matched with the folder's owner.

| Function | Notes |
|---|---|
| `matrimony_my_live_profile_id()` | Caller's profile if approved + eligible, else null. The caller gate. Revoked from clients. |
| `matrimony_is_matched(a, b)` | **The** unlock predicate. Revoked from clients. |
| `matrimony_interest_state(me, other)` | `matched / sent / received / no_response / none`. Revoked from clients. |
| `matrimony_photo_visible(owner_uid)` | Used by the storage policy; granted to `authenticated` (only answers about the caller's own matches). |
| `list_matrimony_profiles(age_min, age_max, state, city, education, occupation, limit, offset)` | Browse. Newest approval first, clamp 1–50, education is a substring match. |
| `matrimony_filter_options()` | States and cities among profiles the caller can browse. |
| `get_matrimony_profile(id)` | jsonb. Null if not visible. Visible = browsable, or matched. Carries `interest_state`, `outgoing_interest_id`, `incoming_interest`, and `contact` **only when matched**. |
| `express_interest(id, message) → 'sent' \| 'matched'` | Checks, in order: caller live, target visible, not already matched; then serialises on the caller's row; reverse pending → accept; existing non-withdrawn row → refused (same wording whether pending or declined); cap of 10. |
| `withdraw_interest(id)` / `respond_interest(id, accept)` | Sender / recipient only, pending only. Accepting re-checks that the sender is still visible. |
| `list_my_interests(box)` | `received` (pending, from live profiles) / `sent` (pending + declined shown as `no_response`) / `matches` (accepted, either side, with full name + main photo path). `is_new` drives the badge. |
| `mark_interests_seen(box)` | Clears `received` / `matches` "new" flags. |
| `matrimony_badge_count()` | The badge. 0 without a profile. |

## 3. What shipped in the app

| Route | Component | Notes |
|---|---|---|
| `/matrimony` | `routes/matrimony/MatrimonyHome.tsx` | Live profile: **browse** with age from/to, State, City and Occupation chips, an education search, Clear, Load more (20/page), plus Interests (badge) and My profile buttons. Otherwise the 6a explainer, now saying browsing opens once you're verified. |
| `/matrimony/:id` | `routes/matrimony/MatrimonyProfilePage.tsx` | The state-aware action box (Express interest dialog with a 300-char message / Withdraw / Accept + Decline with the sender's message / Matched / No response), then contact details + photos when matched, then `MatrimonyDetails`. Every accept dialog states exactly what gets shared (`SHARE_ON_ACCEPT`). |
| `/matrimony/interests` | `routes/matrimony/MatrimonyInterests.tsx` | `TabStrip` Received · Sent · Matches (`?box=`). Opening Received / Matches marks them seen; the "New" tags stay for that visit. Matches show the main photo and link to contact details. |

- `components/matrimony/MatrimonyCard.tsx`: the browse card + `InterestStatePill` (accent only for "Interested in you" and "Matched").
- `context/MatrimonyContext.tsx`: the badge, mounted inside `NoticesProvider` in `App.tsx`, refetched on navigation and on `refresh()`.
- **Navigation (post-6c fix):** Matrimony is a header link on desktop, next to Events, with the badge count. On phones and tablets it stays inside Explore, which now stays lit on `/matrimony/*`. The desktop header / bottom bar switch moved from `sm` (640px) to `lg` (1024px), because the longer header row overflowed on tablets; tablets now get the bottom bar. `MatrimonyIcon` lives in `NavTabs.tsx` and Explore reuses it.
- Badge surfaces: the Explore Matrimonial tile shows "N new" in place of "Live"; the Dashboard gets a neutral "Matrimony · N new updates" row (only when N > 0); the Interests button on `/matrimony`.
- `ConfirmDialog` prompts gained `maxLength` (with a counter) and `hint`.
- `lib/matrimony.ts`: `shortName`, `MatrimonyFilters`, and wrappers for every 6b RPC.

## 4. Known gaps / deferred

- **No un-match, block, pause or report**: that's 6c. Today a match is permanent, and a member who marries keeps existing matches; they only drop out of browse and new interests.
- **Matched access outlives eligibility.** `get_matrimony_profile` shows a matched profile even if its owner is no longer approved or eligible. 6c's un-match/hide should decide whether that's right.
- The browse filters aren't in the URL, so they reset when you leave the page.
- Received interests from a member who has since become ineligible are hidden, not deleted. They reappear if that member becomes eligible again.
- The badge refreshes on navigation, not live (same as notices). Push is Phase 7.
- Like 0023, **0024 was written without a database to run it against**.

## 5. Before you start 6c

1. Apply `0023` first if it isn't already (see `phase-6a-summary.md` §5), then `0024`, and run its verification block. Deploy the frontend.
2. Smoke test (M1 male and F1 female with approved profiles, F2 female approved, X with no profile, admin A):
   - X opens `/matrimony`: the explainer, no browse. `supabase.rpc('list_matrimony_profiles')` as X returns `[]`.
   - M1 browses: sees F1 and F2, never another male, never himself. The age, state and occupation filters narrow the list.
   - M1 opens F1: no photos, no surname, no contact. `createSignedUrl` on F1's photo path fails for M1.
   - M1 expresses interest with a message. F1's Explore tile and dashboard show "1 new"; F1 opens Interests → Received and sees the message; the badge clears.
   - F1 accepts. Both now see the full name, photos, parents, native place, email and mobile. Turn on F1's "Hide my number": M1 sees "Hidden by member". M1's badge shows the new match until he opens Matches.
   - M1 → F2, F2 declines: M1 sees "No response" and "Express interest" is gone. F2 is not told anything.
   - Instant match: F2 → M1 pending, then M1 opens F2 and expresses interest: "You're matched!"
   - Cap: from a test account, send 10 interests; the 11th is refused. Withdraw one, and sending works again.
   - Set F1's marital status to Married: she drops out of M1's browse, and the existing match still shows (see §4).
3. 6c per the plan (`/Users/lakshyapk/.claude/plans/jazzy-weaving-adleman.md`):
   - Pause (`paused` status).
   - Un-match (interest `ended` + `ended_by`, re-locking photos and contact).
   - `matrimony_blocks`.
   - `matrimony_reports` with a Reports tab in `/admin/matrimony` and an admin hide plus owner banner.
   - Delete my matrimony profile.
   - An "Open reports" overview tile.
   - Decide the §4 "matched access outlives eligibility" question.
