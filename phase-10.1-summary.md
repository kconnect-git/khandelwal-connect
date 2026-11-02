# Phase 10.1 Summary — Handoff to 10.2

10.1 is the first sub-phase of Phase 10 (KC Business). Read it together with `phase-10-plan.md` (the whole phase, build order and open decisions), `phase-3b-summary.md` (the businesses access model) and `phase-5b2-summary.md` (business moderation).

---

## 1. What Phase 10.1 is

Mockup screen 2: a **KC Business hub** at `/business` that sits between Explore and the directory.

| Feature | Behaviour |
|---|---|
| **Hub page** | A plain header ("KC Business — Discover. Connect. Grow.", styled like Explore's, with no coloured card: the user turned down the blue hero box from the mockup), a search box, and 6 module tiles below it. |
| **Tiles** | Business Directory is **Live** (`/businesses`). Buy & Sell, Referrals, Products & Services, Meetings & Events and My Business Dashboard are **Soon**, greyed out and inert. Each one gets a `to` in the sub-phase that builds it. |
| **Hub search** | Submitting goes to `/businesses?q=<text>`; an empty search goes to `/businesses`. The directory opens with the box already filled and the results already filtered. |
| **Wider search** | Directory search now also matches industry (category), city, state, brand, primary product and description, as well as business and owner name. |
| **Entry points** | Explore's Business tile → `/business`. On desktop, the header's "Businesses" link → `/business` (decided during planning: one entry point everywhere). |
| **Back links** | Hub: "‹ Explore", mobile only, like the directory's old link. Directory: "‹ Business" → hub, at **every** width, since desktop now arrives through the hub too. |

Decisions taken during planning: the route is `/business` (later screens nest as `/business/market`, `/business/referrals`, `/business/dashboard`), the directory stays at `/businesses`, search is widened rather than the placeholder narrowed, and Soon tiles stay silent instead of showing a "coming soon" note.

## 2. Schema / backend (migration `0026_business_search.sql`, mirrored in `ddl/core_schema.sql`)

- `list_businesses` gets a wider `p_search` clause: `ilike '%…%'` on `b.category`, `b.city`, `b.state`, `b.brand_name`, `b.primary_product` and `b.description`, alongside the existing `b.name` and `p.full_name`.
- **Signature and return columns are unchanged**, so it's a plain `create or replace` with no drop. `revoke`/`grant` are re-stated, and the migration is re-runnable. `lib/businesses.ts` and `types/database.ts` are untouched.
- No new tables, columns or policies.

## 3. What shipped in the app

| File | Change |
|---|---|
| `components/SectionTiles.tsx` | **New.** Explore's tile grid moved here without changes: `Svg`, `IconProps`, `Section`, Live/Soon badge, "N new" badge, tile body. It exports `SectionTiles({ sections, newCountFor? })`. |
| `routes/Explore.tsx` | Now just its icons, `SECTIONS` and `<SectionTiles>`. The Business tile goes to `/business`. It looks the same as before, matrimony "N new" badge included. |
| `routes/BusinessHub.tsx` | **New.** Header + search form + 6 tiles. Icons are local (ID card, swap arrows, person-plus, box, bar chart), and Meetings reuses `EventsIcon`. |
| `App.tsx` | `/business` route under `AuthGate requireComplete`. |
| `components/NavTabs.tsx` | Desktop Businesses tab → `/business`. Its prefix match lights it on the hub, the directory and detail. The Explore prefix list uses `/business`, which covers all three. |
| `routes/Businesses.tsx` | Reads `?q=` with `useSearchParams` and seeds both `search` and `debouncedSearch`, so the first fetch already uses it. Back link → "‹ Business", and the placeholder mentions product, industry and city. |

## 4. Known gaps / deferred

- **Typing in the directory doesn't update `?q=`.** The URL only carries the hub's initial search, so after editing the box, back/forward or a refresh restores the hub's query, not the edited one. Fine for now; sync it if the directory gets shareable filter URLs.
- **Search is still a plain `ilike` across 8 columns**, with no ranking. A match in the description counts the same as a match in the name, and results stay in name order. Same caveat as `phase-3b-summary.md` §5.
- **`%` and `_` in a search act as wildcards**, as they always have in this RPC.
- The Dashboard's Businesses stat tile and member-profile business cards still link straight to the directory or detail. That's intended.
- **0026 was written without a database to run it against.** Its verification block is at the bottom of the file.

## 5. Before you start 10.2

1. Apply `0026` and run its verification block (one `list_businesses` overload, and its definition includes `primary_product ilike`). Deploy the frontend.
2. Smoke test:
   - **Explore:** it looks unchanged, and the Business tile opens the hub.
   - **Hub:** the Directory tile opens `/businesses`, and the 5 Soon tiles do nothing. Searching a city or industry that isn't in any business name (e.g. "Jaipur", "Textiles") lands on `/businesses?q=…` with the box filled and matching listings shown. An empty search shows the full directory.
   - **Nav:** at phone width, Explore stays lit on `/business`, `/businesses` and `/businesses/:id`. At desktop width (≥1024px), the header "Businesses" opens the hub and stays lit on all three. The directory's "‹ Business" link shows and returns to the hub.
   - **Themes:** the header, search box and tiles are readable in light and dark mode.
3. Settle open decision §6.1 in `phase-10-plan.md` (what "Verified" means) before building 10.2's card badge.
