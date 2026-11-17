# Phase 11.4 Summary — Directory gating

11.4 locks the paid parts of the Directory, as set out in `directory-paid-features.md`. Read it with `phase-11-plan.md` and the 11.1–11.3 summaries. **It changes nothing until a super admin turns the Directory paywall on** in /admin/access. Every check goes through `has_service_access(me, 'directory')`, which is true for everyone while the paywall is off.

---

## 1. What members without Directory access get

| Where | Free | With access, admins, or your own profile |
|---|---|---|
| **Directory list** | Name, photo, member code, city, state, gotra, occupation type, badge. **Job title and company are hidden.** | Everything, as before |
| **Filters** | Name search plus **one** of state / city / gotra / occupation. Picking a second chip replaces the first, and a note with Request access appears: "One filter at a time. Combining filters is part of Directory access." | Any combination |
| **Opened profile** | Location (city, state, native place), occupation, education, businesses. **No mobile, marital status, district, job title, company or work location.** Instead of WhatsApp / Call: "Upgrade to call or WhatsApp {first name}" + Request access. The Contact row reads "Part of Directory access". A "See full profiles" card says what's included. | Everything. A member's own "hide my number" still applies. |
| **Daily allowance** | **10 different profiles a day** (India time). Re-opening one already opened today is free, and your own profile never counts. "N of 10 profile views left today" shows on the Directory and on profiles. The 11th shows "That's 10 profiles today… more open at midnight" with Request access. | Unlimited |
| **Family linking** (Profile → relatives search) | Finds the member, but **doesn't return their mobile**. You type it yourself. | Mobile pre-filled, as before |

## 2. Schema / backend (migration `0036_directory_gating.sql`, mirrored in `ddl/core_schema.sql` and `ddl/enable_rls.sql`)

The whole migration runs in one transaction.

- **`directory_profile_views`** (viewer, viewed, India date; PK on all three). RPC-only. **Only free members' opens are recorded**, because only they are counted.
- **`list_directory`** is now plpgsql. Without access, job title and company are null, and two or more filters raise **SQLSTATE `KCL02`**. Its return type is unchanged.
- **`get_member_profile`** is now plpgsql and **volatile** (it writes the view row). Without access, the six paid fields are null, and the 11th different profile in a day raises **`KCL01`**. An advisory lock per viewer stops two tabs both getting in as the 10th. Return type unchanged.
- **`my_directory_opens_left()`** returns a number, or null for unlimited.
- **`search_registered_members`** doesn't return a mobile without access.
- All four are closed to `anon`.
- **`core_schema.sql` ordering:** `service_access_ends_at` and `has_service_access` moved up beside `has_paid_badge`, because `search_registered_members` is a plain SQL function that now calls them. Postgres checks SQL function bodies when it creates them, so a fresh build would fail otherwise.

**Tested on the live database without keeping anything.** The real 0036 plus a test ran in one transaction (`psql --single-transaction`) that ended in a forced error. The test turned the Directory paywall on and used KHA-KA-2084, who has no Directory grant. Afterwards the database was confirmed unchanged: no table, the old function, the paywall off, no grants.

| Check | Result |
|---|---|
| Free list | 6 rows, no job title or company |
| One filter / two filters | OK / `KCL02` "Combining filters is part of Directory access…" |
| Free profile | mobile, marital, district and job all null; education and city present |
| Opens left | 10 → 9 after one profile; unchanged on re-opening it or opening your own |
| Own profile | Full, including mobile |
| Family search | Free: the member found, no mobile. With access: mobile returned. |
| 10 opened, then a new one | `KCL01` "You have opened 10 profiles today…"; re-opening an earlier one still works |
| After a Directory grant | 11th profile opens with mobile; two filters allowed; opens left "unlimited" |
| Admin | Full profile, unlimited |
| Signed out | `permission denied for function list_directory` |

## 3. What shipped in the app

| File | Change |
|---|---|
| `lib/directory.ts` | `DIRECTORY_DAILY_LIMIT`, `DirectoryLimitError` (`daily_limit` / `combined_filters`, from `KCL01` / `KCL02`), `getMyDirectoryOpensLeft`. |
| `routes/MemberProfile.tsx` | Limit screen, locked Contact (compact `LockedFeature`), "Part of Directory access", "See full profiles" card, opens left. |
| `routes/Directory.tsx` | One filter at a time without access (a new pick replaces the others), the note, opens left, and handling for a `KCL02` caused by a stale access state. |
| `lib/serviceAccess.ts` | **`PAYWALL_READY.directory = true`**, so the admin page now offers Turn on for Directory. |
| `types/database.ts` | `my_directory_opens_left`. |

`tsc -b` and `vite build` pass. No new lint warnings beyond the existing set-state-in-effect pattern.

## 4. Known gaps / deferred

- **Business listings still show owners' phone numbers.** That's Business access, coming in 11.5. Until then, a free member can reach an owner's number through their business listing.
- **"Who viewed my profile"** could later read `directory_profile_views`, but it only records free members' opens. Paid views would need recording too.
- **Old view rows are never cleaned up.** They're tiny (three columns), so this is fine at community scale.
- **The member UI only knows about access after `my_service_access` loads.** If access lapses mid-session, the server still enforces, and a combined filter is handled gracefully.

## 5. Before you call 11.4 done

1. ~~**Apply `0036`.**~~ **Applied on 2026-11-17** with `scripts/sql.sh -f`, in one transaction. Verified live:
   - `get_member_profile` is plpgsql and volatile; `list_directory` is plpgsql
   - all four functions are closed to `anon` and open to `authenticated`
   - `directory_profile_views` has RLS on and 0 rows
   - the Directory paywall is still **off**
   - as KHA-KA-2084: a profile still shows the mobile, opens left is "unlimited", two filters are allowed, and no view rows are written
2. Deploy the frontend.
3. **Smoke test with the paywall on.** As super admin, Admin → Access → Directory → Turn on (confirm).
   - As a member **without** a Directory grant:
     - The Directory shows "10 of 10 profile views left today" and no job lines.
     - Choosing a second filter replaces the first and shows the note.
     - A profile shows no Call / WhatsApp, "Upgrade to call or WhatsApp…", and no job or marital rows.
     - The 11th different profile shows the limit screen.
     - **Request access** → it appears in Admin → Access.
   - Give that member Directory access. After a reload, everything is visible and unlimited, and the PREMIUM badge appears on them.
   - **Then decide** whether to leave the Directory paywall on, or Turn off until launch.
4. Commit.
