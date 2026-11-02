-- Phase 10.1: wider business search, for the KC Business hub.
--
--   * The hub's search box ("Search business, product, industry, city...")
--     hands its text to the directory as ?q=, which calls list_businesses.
--     Until now p_search only matched the business name and owner name, so
--     "Jaipur" or "Textiles" found nothing unless it was in a name.
--   * p_search now also matches category (the industry), city, state,
--     brand_name, primary_product and description. Same ilike '%...%' as
--     before -- fine at community scale (phase-3b-summary.md §5).
--   * Signature and RETURNS TABLE are unchanged from 0021, so this is a plain
--     create or replace (no drop needed) and lib/businesses.ts is untouched.
--
-- Run manually in the Supabase SQL editor. Re-runnable.

create or replace function list_businesses(
  p_search text default null,
  p_category text default null,
  p_city text default null,
  p_state text default null,
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  id uuid,
  name text,
  category text,
  description text,
  city text,
  state text,
  contact_phone text,
  website text,
  logo_url text,
  owner_id uuid,
  owner_name text,
  owner_photo_url text,
  owner_member_code text,
  total_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select b.id, b.name, b.category, b.description, b.city, b.state,
         b.contact_phone, b.website, b.logo_url,
         p.id as owner_id, p.full_name as owner_name, p.profile_photo_url as owner_photo_url,
         p.member_code as owner_member_code,
         count(*) over () as total_count
  from businesses b
  join people p on p.id = b.owner_id
  where is_approved_member()
    and p.member_status = 'approved'
    and not b.is_hidden
    and (p_search is null or length(trim(p_search)) = 0
         or b.name ilike '%' || p_search || '%'
         or p.full_name ilike '%' || p_search || '%'
         or b.category ilike '%' || p_search || '%'
         or b.city ilike '%' || p_search || '%'
         or b.state ilike '%' || p_search || '%'
         or b.brand_name ilike '%' || p_search || '%'
         or b.primary_product ilike '%' || p_search || '%'
         or b.description ilike '%' || p_search || '%')
    and (p_category is null or b.category = p_category)
    and (p_city is null or b.city ilike p_city)
    and (p_state is null or b.state ilike p_state)
  order by b.name asc, b.id asc
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function list_businesses(text, text, text, text, int, int) from public;
grant execute on function list_businesses(text, text, text, text, int, int) to authenticated;

-- ================================================================
-- verification (run these after applying)
-- ================================================================
-- select count(*) from pg_proc where proname = 'list_businesses';
--   -- 1 (no stray overload)
-- select pg_get_functiondef('list_businesses(text,text,text,text,int,int)'::regprocedure)
--   ilike '%primary_product ilike%';
--   -- true
--
-- Then, signed in as an approved member in the browser console (pick a city
-- or industry that exists but isn't in any business name):
--   await supabase.rpc('list_businesses', { p_search: 'Jaipur' })
--   await supabase.rpc('list_businesses', { p_search: 'Textiles' })
