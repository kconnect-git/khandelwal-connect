# Phase 10.4 Summary — Handoff to 10.5

10.4 is the fourth sub-phase of Phase 10 (KC Business). Read it with `phase-10-plan.md`, `phase-10.3-summary.md` and `phase-3b-summary.md` (the original businesses access model, which this changes).

---

## 1. What Phase 10.4 is

Mockup screen 6, "List your business": the listing form gets its own pages.

| Feature | Behaviour |
|---|---|
| **New listing** | `/businesses/new`, reached from the directory's "+ List a business" and Profile > Business. Title "List your business". On save it goes to the new listing's detail page. |
| **Edit listing** | `/businesses/:id/edit`, reached from the detail page's "Edit listing" (owner) and Profile > Business "Edit". On save it shows "Saved." and stays. **Remove listing** asks for confirmation, then returns to Profile > Business. Anyone but the owner gets "Listing not found". |
| **Prefill** | A new listing starts with **City**, **State** and **Phone** from the member's profile, and **Your role = Owner / Proprietor** when their occupation is Business. Each is marked "From your profile" (accent, right of the label) until the member changes it, with a banner explaining it at the top. Nothing is written back to the profile. |
| **Form order** | Matches the mockup: Business name, Industry type, Your role, City, State, Phone or WhatsApp, the **Show this number on the listing** box, Short description, Products & services, Website. Everything else (brand, business type, office address, business email, 4 social links) is under **More details (optional)**. |
| **Required** | Name, industry, **city, state and phone** (decided in planning). This is enforced by the form only, for new listings and edits alike. |
| **Your role** | A fixed list: Owner / Proprietor, Partner, Founder / Co-founder, Director, Manager, Family member, Other. It shows on the detail page's Owner card ("Partner · KHA-RJ-0123"). |
| **Show this number** | On by default. Off means no WhatsApp or Call buttons for other members; they reach the owner through the Owner card → member profile. |
| **Logo** | On a new listing it can be picked before saving (with a preview) and uploads right after the listing is created. If only the upload fails, the member lands on the edit page with "Your listing was saved, but the logo didn't upload…". On the edit page, Change / Remove act immediately, as before. |
| **Profile > Business** | Occupation is unchanged. "My businesses" is now a **compact list**: logo, name, meta line, View (unless hidden) / Edit, and the admin-hidden banner. It's followed by "+ List a business". The inline editor cards are gone. |

## 2. Schema / backend (migration `0029_business_listing_form.sql`, mirrored in `ddl/core_schema.sql` and `ddl/enable_rls.sql`)

- `businesses.owner_role text`, with a `businesses_owner_role_check` for the 7 values (added only if missing; mirrored by `BUSINESS_ROLE_OPTIONS` in `lib/formOptions.ts`).
- `businesses.show_phone boolean not null default true`.
- **Read policy tightened:** `members read businesses` is replaced by **`own businesses read`**, the owner's rows only. The old policy let any approved member `select *` the table directly, which would have exposed a phone the owner chose to hide. I checked that every function reading `businesses` is security definer and that every client read of the table is the owner's own, so nothing else changed. 10.5's pending listings get this privacy for free.

| Function | Notes |
|---|---|
| `get_business` | **Changed:** `contact_phone` is null unless `show_phone`, and it returns `owner_role` (last column). Dropped and recreated. |
| `list_businesses` | **Changed:** same masking. Same shape, so `create or replace`. |
| Admin RPCs | Unchanged, so admins still see the number. |

## 3. What shipped in the app

| File | Change |
|---|---|
| `routes/BusinessEditPage.tsx` | **New.** One page for both routes (`mode: 'new' \| 'edit'`): loads the person (and listing), prefill, form, logo section, save, remove. |
| `App.tsx` | `/businesses/new` and `/businesses/:id/edit` under `AuthGate requireComplete`. |
| `components/businesses/BusinessForm.tsx` | Reordered as above. New `fromProfile` prop. Role select and the show-phone checkbox (same style as Profile's "Hide my number"). |
| `components/businesses/MyBusinessesList.tsx` | **New.** The compact Profile list. |
| `components/businesses/MyBusinessesEditor.tsx` | **Deleted.** Its hidden banner and logo controls moved to the new page. |
| `components/profile/BusinessTab.tsx`, `routes/Profile.tsx` | `BusinessTab` takes just `businesses`, dropping `ownerId` / `authUserId` / `onBusinessesChange`. |
| `components/form/TextField.tsx`, `SelectField.tsx` | `label` widened to `React.ReactNode`, so a label can carry the "From your profile" marker. |
| `routes/Businesses.tsx` | "+ List a business" → `/businesses/new`. "My businesses" still → Profile until 10.5. |
| `routes/BusinessDetail.tsx` | Owner's "Edit listing" → `/businesses/:id/edit`, and the Owner card shows the role. |
| `lib/businesses.ts` | Form values gain `owner_role` and `show_phone`. `validateBusiness` requires city, state and phone. New `businessFormFromProfile(person)` and `getMyBusiness(id)`. `BusinessListing` gains `owner_role`. |
| `lib/formOptions.ts`, `types/database.ts` | `BUSINESS_ROLE_OPTIONS`. `BusinessRow` gains `owner_role` and `show_phone`, and the `get_business` Returns gain `owner_role`. |

## 4. Known gaps / deferred

- **Phone is required by the form, not the database.** Older listings without a phone, city or state still show. Their owner must fill them in before the next save goes through.
- **A hidden phone hides both WhatsApp and Call.** There's no "WhatsApp only" option. The owner's member profile still shows their personal mobile unless they turned on "Hide my number".
- **Prefill is one-way and only for new listings.** Changing the profile later doesn't update existing listings.
- **The logo can fail after the listing exists**, which is handled by sending the member to the edit page with a message. The listing has no logo until they retry.
- **The "‹ My businesses" back links and the directory's "My businesses" button still go to Profile > Business.** 10.5 repoints them to `/businesses/mine`.
- **Detail-page access for the owner of a hidden listing** is unchanged: `get_business` still hides it, so its "View" link is suppressed, while "Edit" works.
- **0029 was written without a database to run it against.** Its verification block is at the bottom of the file.

## 5. Before you start 10.5

1. Apply `0029` and run its verification block:
   - `owner_role` and `show_phone` exist;
   - the role check exists;
   - the only SELECT policy on `businesses` is `own businesses read`;
   - there's one `get_business`.

   Deploy the frontend.
2. Smoke test with member A (owner) and member B:
   - **New listing:** Directory "+ List a business" opens `/businesses/new` with city, state and phone prefilled and marked (and the role too if A's occupation is Business). Editing one drops its marker. Clearing the phone and saving is refused with a message. Pick a logo, then **List business**, and you land on the detail page with the logo.
   - **Hidden phone:** A unticks "Show this number" and saves. B's detail page has no WhatsApp / Call. In B's console, `supabase.rpc('get_business', { p_business_id })` gives `contact_phone: null`, and `supabase.from('businesses').select('id, owner_id')` lists only B's own listings.
   - **Edit:** reach the edit page from the detail page and from Profile > Business. Change products and save ("Saved."). Change, then remove, the logo. **Remove listing** → confirm → back on Profile, and the row is gone.
   - **Profile tab:** the compact list shows. A hidden listing shows the reason and no View link.
   - **Owner card:** the detail page shows "Owner / Proprietor · KHA-…".
   - **Directory and admin:** both still list everything as before (the RPCs are unaffected by the tighter policy).
3. 10.5 builds `/businesses/mine` and listing approval (`review_status`, migration `0030`). Repoint `MY_BUSINESSES` in `BusinessEditPage.tsx`, the directory's "My businesses" button, and Profile's list to show status badges.
