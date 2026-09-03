-- Phase 3b, step 2: business listings.
--
-- `businesses` has existed since Phase 0 with RLS enabled and zero policies.
-- This migration makes it real:
--   * shape: drops `type` (business/professional/student/homemaker was really
--     a per-person occupation -- that now lives on people.occupation_type,
--     0013), adds location/contact/logo columns and updated_at, and pins
--     `category` to a fixed list so the directory's Category chip is useful.
--   * access model (decided in phase-3a-summary.md §7 terms): real RLS for
--     writes -- the owner inserts/updates/deletes their own rows directly
--     from the client, no RPC -- plus SECURITY DEFINER RPCs for reads,
--     because listing cards must join the owner's name/photo/member code
--     from `people`, which stays self-only. Nothing on `businesses` is
--     privacy-sensitive, so an all-members read policy is also added (used
--     by the owner's own "My businesses" select and as a safety net).
--   * one member ↔ many businesses (owner_id is not unique) -- by design.
--
-- Run manually in the Supabase SQL editor -- this repo's migrations are not
-- wired to a runner (see 0001_init.sql).

alter table businesses
  drop column type,
  add column city text,
  add column state text,
  add column contact_phone text
    check (contact_phone is null or contact_phone ~ '^\+91[6-9]\d{9}$'),
  add column website text,
  add column logo_url text,
  add column updated_at timestamptz default now();

-- Mirrored by BUSINESS_CATEGORY_OPTIONS in src/lib/formOptions.ts.
alter table businesses
  add constraint businesses_category_check check (
    category is null or category in (
      'Retail', 'Wholesale & Distribution', 'Manufacturing', 'Jewellery',
      'Textiles & Garments', 'Real Estate & Construction', 'Finance & Accounting',
      'Legal', 'Healthcare', 'Education', 'IT & Software', 'Hospitality & Food',
      'Transport & Logistics', 'Agriculture', 'Other'
    )
  );

create index businesses_owner_id_idx on businesses (owner_id);

-- ---------------------------------------------------------------- RLS ----

-- Any member who has completed onboarding can read listings. The subquery
-- runs under people's own self-only policy, which is exactly enough here
-- (we only need the caller's own row).
create policy "members read businesses" on businesses for select
  using (exists (select 1 from people where auth_user_id = auth.uid() and member_code is not null));

create policy "own business insert" on businesses for insert
  with check (owner_id in (select id from people where auth_user_id = auth.uid()));
create policy "own business update" on businesses for update
  using (owner_id in (select id from people where auth_user_id = auth.uid()));
create policy "own business delete" on businesses for delete
  using (owner_id in (select id from people where auth_user_id = auth.uid()));

-- --------------------------------------------------------------- RPCs ----

-- Paginated listing with the owner's directory-tier fields joined in. Same
-- total_count window-function shape as list_directory (0010). Only
-- businesses whose owner has completed onboarding appear.
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
  where p.member_code is not null
    and (p_search is null or length(trim(p_search)) = 0
         or b.name ilike '%' || p_search || '%'
         or p.full_name ilike '%' || p_search || '%')
    and (p_category is null or b.category = p_category)
    and (p_city is null or b.city ilike p_city)
    and (p_state is null or b.state ilike p_state)
  order by b.name asc, b.id asc
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function list_businesses(text, text, text, text, int, int) from public;
grant execute on function list_businesses(text, text, text, text, int, int) to authenticated;

-- One listing, same columns (minus total_count). Zero rows if unknown or
-- the owner hasn't completed onboarding.
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
  owner_id uuid,
  owner_name text,
  owner_photo_url text,
  owner_member_code text
)
language sql
stable
security definer
set search_path = public
as $$
  select b.id, b.name, b.category, b.description, b.city, b.state,
         b.contact_phone, b.website, b.logo_url,
         p.id, p.full_name, p.profile_photo_url, p.member_code
  from businesses b
  join people p on p.id = b.owner_id
  where b.id = p_business_id
    and p.member_code is not null;
$$;

revoke all on function get_business(uuid) from public;
grant execute on function get_business(uuid) to authenticated;

-- A member's listings, for the BUSINESSES section on their profile screen.
create or replace function list_member_businesses(p_person_id uuid)
returns table (
  id uuid,
  name text,
  category text,
  city text,
  logo_url text
)
language sql
stable
security definer
set search_path = public
as $$
  select b.id, b.name, b.category, b.city, b.logo_url
  from businesses b
  join people p on p.id = b.owner_id
  where b.owner_id = p_person_id
    and p.member_code is not null
  order by b.name asc, b.id asc;
$$;

revoke all on function list_member_businesses(uuid) from public;
grant execute on function list_member_businesses(uuid) to authenticated;

-- Distinct chip values actually present, same (kind, value) shape as
-- directory_filter_options.
create or replace function business_filter_options()
returns table (kind text, value text)
language sql
stable
security definer
set search_path = public
as $$
  select f.kind, f.value
  from (
    select 'category' as kind, b.category as value
    from businesses b join people p on p.id = b.owner_id
    where p.member_code is not null and b.category is not null
    union
    select 'city', b.city
    from businesses b join people p on p.id = b.owner_id
    where p.member_code is not null and b.city is not null
    union
    select 'state', b.state
    from businesses b join people p on p.id = b.owner_id
    where p.member_code is not null and b.state is not null
  ) f
  order by f.kind, f.value;
$$;

revoke all on function business_filter_options() from public;
grant execute on function business_filter_options() to authenticated;

-- ------------------------------------------------------------ storage ----

-- business-media had insert + public read only (Phase 0). Logo re-upload
-- replaces the file, so owners need update + delete on their own folder
-- ({auth_user_id}/{business_id}/logo-<ts>.jpg) -- mirrors 0010's
-- profile-photos policies.
create policy "own business media update"
  on storage.objects for update
  using (bucket_id = 'business-media' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "own business media delete"
  on storage.objects for delete
  using (bucket_id = 'business-media' and auth.uid()::text = (storage.foldername(name))[1]);
