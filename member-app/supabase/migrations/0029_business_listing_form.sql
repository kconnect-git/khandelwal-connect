-- Phase 10.4: "List your business" -- its own add / edit pages.
--
--   * businesses.owner_role: what the owner is to the business, a fixed list
--     (mirrored by BUSINESS_ROLE_OPTIONS in src/lib/formOptions.ts). Shown
--     on the detail page's Owner card.
--   * businesses.show_phone (default true): the "Show this number on the
--     listing" box. When false, list_businesses / get_business return a null
--     contact_phone, so no WhatsApp / Call buttons; members reach the owner
--     through their member profile. Admin reads still see the number.
--   * The read policy is tightened to the owner's own rows. "members read
--     businesses" let any approved member select * straight from the table,
--     which would leak a hidden phone. Every client read of the table is
--     already the owner's own (getMyBusinesses / getMyBusiness and the
--     .select() after a write), and every cross-member read goes through a
--     security-definer RPC, so nothing else changes. This also keeps 10.5's
--     pending listings private.
--   * get_business: + owner_role, masked phone -> drop + recreate.
--     list_businesses: masked phone, same shape -> create or replace.
--
-- Run manually in the Supabase SQL editor. Re-runnable.

-- ================================================================
-- businesses: owner_role, show_phone
-- ================================================================

alter table businesses
  add column if not exists owner_role text,
  add column if not exists show_phone boolean not null default true;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'businesses_owner_role_check') then
    alter table businesses
      add constraint businesses_owner_role_check check (
        owner_role is null or owner_role in (
          'Owner / Proprietor', 'Partner', 'Founder / Co-founder', 'Director',
          'Manager', 'Family member', 'Other'
        )
      );
  end if;
end;
$$;

-- ================================================================
-- read policy: owner only
-- ================================================================

drop policy if exists "members read businesses" on businesses;
drop policy if exists "own businesses read" on businesses;

create policy "own businesses read" on businesses for select
  using (owner_id in (select id from people where auth_user_id = auth.uid()));

-- ================================================================
-- get_business: + owner_role, phone masked unless show_phone
-- ================================================================

drop function if exists get_business(uuid);

create or replace function get_business(p_business_id uuid)
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
  brand_name text,
  address_line1 text,
  address_line2 text,
  business_email text,
  business_type text,
  facebook_url text,
  instagram_url text,
  linkedin_url text,
  youtube_url text,
  products text[],
  is_verified boolean,
  is_saved boolean,
  owner_id uuid,
  owner_name text,
  owner_photo_url text,
  owner_member_code text,
  owner_role text
)
language sql
stable
security definer
set search_path = public
as $$
  select b.id, b.name, b.category, b.description, b.city, b.state,
         case when b.show_phone then b.contact_phone end, b.website, b.logo_url,
         b.brand_name, b.address_line1, b.address_line2, b.business_email,
         b.business_type,
         b.facebook_url, b.instagram_url, b.linkedin_url, b.youtube_url,
         b.products, b.is_verified,
         exists (select 1 from business_saves s
                 join people me on me.id = s.person_id
                 where me.auth_user_id = auth.uid() and s.business_id = b.id),
         p.id, p.full_name, p.profile_photo_url, p.member_code,
         b.owner_role
  from businesses b
  join people p on p.id = b.owner_id
  where b.id = p_business_id
    and is_approved_member()
    and p.member_status = 'approved'
    and not b.is_hidden;
$$;

revoke all on function get_business(uuid) from public;
grant execute on function get_business(uuid) to authenticated;

-- ================================================================
-- list_businesses: phone masked unless show_phone
-- ================================================================

create or replace function list_businesses(
  p_search text default null,
  p_category text default null,
  p_city text default null,
  p_state text default null,
  p_limit int default 20,
  p_offset int default 0,
  p_saved_only boolean default false
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
  is_verified boolean,
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
         case when b.show_phone then b.contact_phone end as contact_phone,
         b.website, b.logo_url, b.is_verified,
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
         or array_to_string(b.products, ' ') ilike '%' || p_search || '%'
         or b.description ilike '%' || p_search || '%')
    and (p_category is null or b.category = p_category)
    and (p_city is null or b.city ilike p_city)
    and (p_state is null or b.state ilike p_state)
    and (not coalesce(p_saved_only, false)
         or exists (select 1 from business_saves s
                    join people me on me.id = s.person_id
                    where me.auth_user_id = auth.uid() and s.business_id = b.id))
  order by b.name asc, b.id asc
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function list_businesses(text, text, text, text, int, int, boolean) from public;
grant execute on function list_businesses(text, text, text, text, int, int, boolean) to authenticated;

-- ================================================================
-- verification (run these after applying)
-- ================================================================
-- select column_name from information_schema.columns
-- where table_name = 'businesses' and column_name in ('owner_role', 'show_phone');
--   -- 2 rows
-- select conname from pg_constraint where conname = 'businesses_owner_role_check';
--   -- 1 row
-- select policyname from pg_policies where tablename = 'businesses' and cmd = 'SELECT';
--   -- own businesses read (and no "members read businesses")
-- select count(*) from pg_proc where proname = 'get_business';
--   -- 1
--
-- Then, signed in as a member in the browser console:
--   await supabase.from('businesses').select('id, owner_id')
--     -- only your own listings
--   await supabase.rpc('get_business', { p_business_id: '<a listing with show_phone off>' })
--     -- contact_phone: null
