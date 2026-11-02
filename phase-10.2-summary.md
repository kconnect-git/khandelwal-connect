# Phase 10.2 Summary — Handoff to 10.3

10.2 is the second sub-phase of Phase 10 (KC Business). Read it together with `phase-10-plan.md`, `phase-10.1-summary.md` and `phase-5b2-summary.md` (business moderation, which this extends).

---

## 1. What Phase 10.2 is

Mockup screen 3, the Businesses directory: the header buttons and the **Verified** tag.

| Feature | Behaviour |
|---|---|
| **Header buttons** | **My businesses** (outline) and **+ List a business** (accent) sit side by side under the title and count. **Both open `/profile?tab=business` for now.** 10.4 repoints List to `/businesses/new`, and 10.5 repoints My businesses to `/businesses/mine`. |
| **Verified tag** | Plain blue "Verified" text at the right of the name row on a directory card. There's no pill, keeping the mockup's colour without the blue box the user turned down in 10.1. |
| **What Verified means** | An **admin-set flag**: an admin actually checked the business (GST, shop visit, known personally). It's **not** listing approval, which 10.5 adds for every listing. Decided during planning, closing `phase-10-plan.md` §6.1. |
| **Admin: Verify / Unverify** | On `/admin/businesses`, visible listings get a Verify (or Unverify) button beside Hide. Verify asks an optional "How was it verified?" note, which goes to the audit log only. Verified listings show the tag in the admin table too. Hidden listings offer only Unhide. |

## 2. Schema / backend (migration `0027_business_verified.sql`, mirrored in `ddl/core_schema.sql`)

- **`businesses`** gains `is_verified boolean not null default false`, `verified_by uuid → auth.users`, and `verified_at timestamptz`.
- **`businesses_protect_moderation_columns()`** (the 0021 trigger function) now guards the verified columns too: an insert by `authenticated` resets them, and a client update that changes them raises `Only an admin can verify a listing`. Only the function was replaced; the trigger is the same. `updateBusiness()` sends only form fields, so normal owner edits are unaffected.

| Function | Notes |
|---|---|
| `admin_set_business_verified(p_business_id, p_verified, p_note)` | **New.** Any admin. Refuses no-ops. Audited as `business_verified` / `business_unverified`, with the note. Shaped like `admin_set_business_hidden`. |
| `list_businesses` | **Changed:** returns `is_verified` after `logo_url`. Dropped and recreated because RETURNS TABLE changed. The body keeps 0026's wide search. |
| `admin_list_businesses` | **Changed:** returns `is_verified`, `verified_at`. Dropped and recreated. |
| `get_business` | **Not changed.** 10.3 adds `is_verified` there with the products change, for the detail page's "Verified member" tag. |

## 3. What shipped in the app

| File | Change |
|---|---|
| `components/businesses/VerifiedTag.tsx` | **New.** The tag, shared by the directory, the admin table and (in 10.3) the detail page. |
| `routes/Businesses.tsx` | Button row, and a tag on cards where `is_verified`. |
| `routes/admin/AdminBusinesses.tsx` | `PendingAction` is now `{ business, kind: 'hide' \| 'unhide' \| 'verify' \| 'unverify' }`, with dialog copy in an `ACTION_COPY` map. There's a Verify/Unverify button and the tag in the Listing cell. |
| `lib/admin.ts` | `adminSetBusinessVerified()`, and audit labels "Verified business listing" / "Removed business verification". |
| `lib/businesses.ts` | `BusinessListingPage` gains `is_verified`. It's deliberately **not** on `BusinessCard`, because `get_business` doesn't return it yet. |
| `types/database.ts` | `BusinessRow` gains the three columns, `AdminBusinessRow` gains `is_verified` and `verified_at`, the `list_businesses` Returns gain `is_verified`, and there's a new `admin_set_business_verified` entry. |

## 4. Known gaps / deferred

- **Verification survives owner edits.** An owner could get verified, then change the listing's name or details. This matches matrimony's "edits after approval aren't re-reviewed"; revisit when 10.5 adds approval (e.g. clear `is_verified` when `name` changes).
- **The owner isn't told** when a listing is verified or unverified, and the Profile Business tab doesn't show it. In-app only, like the rest of moderation.
- **There's no "Verified only" filter** on the directory, and verified listings don't sort first. Both are easy to add if wanted.
- The admin console has no Verified tab or filter, but Overview doesn't need a count either.
- **0027 was written without a database to run it against.** Its verification block is at the bottom of the file.

## 5. Before you start 10.3

1. Apply `0026` (if not already) and then `0027`, and run 0027's verification block: 3 columns, one overload each of `list_businesses` / `admin_list_businesses` / `admin_set_business_verified`. Deploy the frontend.
2. Smoke test:
   - **Directory:** both buttons show and open Profile > Business.
   - **Admin:** on `/admin/businesses`, Verify a listing with a note. The tag appears in the admin table and on its directory card, and `/admin/audit` reads "Verified business listing" with the note. Unverify removes the tag. A hidden listing shows only Unhide.
   - **Protection:** as the listing's owner, in the browser console, `supabase.from('businesses').update({ is_verified: true }).eq('id', '<own id>')` fails with "Only an admin can verify a listing". A normal save from Profile > Business still works on a verified listing, and it stays verified.
3. 10.3 (detail page) changes `get_business`. Add `is_verified` to it then and move the field from `BusinessListingPage` onto `BusinessCard`.
