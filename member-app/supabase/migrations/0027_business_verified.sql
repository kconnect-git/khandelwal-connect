-- Phase 10.2: "Verified" business listings.
--
--   * businesses gains is_verified / verified_by / verified_at. Verified is an
--     admin's statement that they actually checked the business (GST, shop
--     visit, known personally) -- NOT the same as listing approval, which
--     10.5 adds for every listing. Members see a "Verified" tag on the
--     directory card (and on the detail page from 10.3).
--   * businesses_protect_moderation_columns (0021) now also guards the three
--     verified columns: reset on insert, refused on a client update. The
--     trigger itself is unchanged; only its function is replaced.
--   * admin_set_business_verified (any admin, audited as business_verified /
--     business_unverified), shaped like admin_set_business_hidden.
--   * list_businesses and admin_list_businesses return is_verified (and
--     verified_at for the console). RETURNS TABLE changes -> drop + recreate.
--     get_business is left for 10.3, which changes it anyway.
--
-- Run manually in the Supabase SQL editor. Re-runnable.

-- ================================================================
-- businesses: verified columns + protection
-- ================================================================

alter table businesses
  add column if not exists is_verified boolean not null default false,
  add column if not exists verified_by uuid references auth.users(id),
  add column if not exists verified_at timestamptz;

create or replace function businesses_protect_moderation_columns()
returns trigger
language plpgsql
as $$
begin
  if current_user = 'authenticated' then
    if tg_op = 'INSERT' then
      new.is_hidden := false;
      new.hidden_reason := null;
      new.hidden_by := null;
      new.hidden_at := null;
      new.is_verified := false;
      new.verified_by := null;
      new.verified_at := null;
    else
      if (new.is_hidden, new.hidden_reason, new.hidden_by, new.hidden_at)
         is distinct from
         (old.is_hidden, old.hidden_reason, old.hidden_by, old.hidden_at) then
        raise exception 'Only an admin can hide or unhide a listing';
      end if;
      if (new.is_verified, new.verified_by, new.verified_at)
         is distinct from
         (old.is_verified, old.verified_by, old.verified_at) then
        raise exception 'Only an admin can verify a listing';
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- ================================================================
-- list_businesses: + is_verified
-- ================================================================

drop function if exists list_businesses(text, text, text, text, int, int);

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
         b.contact_phone, b.website, b.logo_url, b.is_verified,
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
-- admin_list_businesses: + is_verified, verified_at
-- ================================================================

drop function if exists admin_list_businesses(boolean, text, text, int, int);

create or replace function admin_list_businesses(
  p_hidden boolean default null,
  p_search text default null,
  p_category text default null,
  p_limit int default 25,
  p_offset int default 0
)
returns table (
  id uuid,
  name text,
  brand_name text,
  category text,
  city text,
  state text,
  logo_url text,
  is_hidden boolean,
  hidden_reason text,
  hidden_at timestamptz,
  is_verified boolean,
  verified_at timestamptz,
  owner_id uuid,
  owner_name text,
  owner_member_code text,
  owner_status text,
  created_at timestamptz,
  total_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select b.id, b.name, b.brand_name, b.category, b.city, b.state, b.logo_url,
         b.is_hidden, b.hidden_reason, b.hidden_at,
         b.is_verified, b.verified_at,
         p.id, p.full_name, p.member_code, p.member_status,
         b.created_at,
         count(*) over ()
  from businesses b
  join people p on p.id = b.owner_id
  where is_admin()
    and (p_hidden is null or b.is_hidden = p_hidden)
    and (p_category is null or b.category = p_category)
    and (p_search is null or length(trim(p_search)) = 0
         or b.name ilike '%' || trim(p_search) || '%'
         or b.brand_name ilike '%' || trim(p_search) || '%'
         or p.full_name ilike '%' || trim(p_search) || '%')
  order by case when p_hidden then b.hidden_at end desc nulls last,
           b.name asc, b.id asc
  limit least(greatest(coalesce(p_limit, 25), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function admin_list_businesses(boolean, text, text, int, int) from public;
grant execute on function admin_list_businesses(boolean, text, text, int, int) to authenticated;

-- ================================================================
-- admin_set_business_verified
-- ================================================================

-- Verify or un-verify a listing. Any admin. The optional note ("GST checked",
-- "visited the shop") goes to the audit log only; members just see the tag.
create or replace function admin_set_business_verified(
  p_business_id uuid,
  p_verified boolean,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business businesses%rowtype;
  v_admin_person_id uuid;
begin
  if not is_admin() then
    raise exception 'Not an admin';
  end if;
  if p_verified is null then
    raise exception 'Say whether to verify the listing or remove verification';
  end if;

  select * into v_business from businesses where id = p_business_id for update;
  if not found then
    raise exception 'Listing not found';
  end if;
  if v_business.is_verified = p_verified then
    raise exception 'This listing is already %', case when p_verified then 'verified' else 'not verified' end;
  end if;

  if p_verified then
    update businesses
    set is_verified = true, verified_by = auth.uid(), verified_at = now(), updated_at = now()
    where id = p_business_id;
  else
    update businesses
    set is_verified = false, verified_by = null, verified_at = null, updated_at = now()
    where id = p_business_id;
  end if;

  select id into v_admin_person_id from people where auth_user_id = auth.uid();
  insert into admin_audit_log (admin_id, action, target_type, target_id, notes)
  values (v_admin_person_id,
          case when p_verified then 'business_verified' else 'business_unverified' end,
          'business', p_business_id, nullif(trim(p_note), ''));
end;
$$;

revoke all on function admin_set_business_verified(uuid, boolean, text) from public;
grant execute on function admin_set_business_verified(uuid, boolean, text) to authenticated;

-- ================================================================
-- verification (run these after applying)
-- ================================================================
-- select column_name from information_schema.columns
-- where table_name = 'businesses' and column_name in ('is_verified', 'verified_by', 'verified_at');
--   -- 3 rows
-- select proname, count(*) from pg_proc
-- where proname in ('list_businesses', 'admin_list_businesses', 'admin_set_business_verified')
-- group by proname;
--   -- 3 rows, each count 1 (no stray overloads)
-- select has_function_privilege('authenticated', 'admin_set_business_verified(uuid,boolean,text)', 'execute');
--   -- true (the function itself refuses non-admins)
--
-- Then, signed in as a member who owns a listing, in the browser console:
--   await supabase.from('businesses').update({ is_verified: true }).eq('id', '<own listing id>')
--     -- error: Only an admin can verify a listing
--   await supabase.rpc('admin_set_business_verified', { p_business_id: '<id>', p_verified: true })
--     -- error: Not an admin
