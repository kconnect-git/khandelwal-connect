-- Phase 5b-2: business moderation and admin management.
--
--   * businesses gains is_hidden / hidden_reason / hidden_by / hidden_at. A
--     hidden listing drops out of every member-facing read (4 RPCs + the
--     `members read businesses` policy) but its owner still sees it, with
--     the reason, on Profile > Business. A new trigger write-protects the
--     four columns from the client -- `own business update` is
--     column-blind, so without it an owner could simply un-hide themselves.
--   * admin_list_businesses / admin_set_business_hidden (any admin, audited).
--   * admin_list_events gains p_search (signature change: dropped and
--     recreated).
--   * admin_list_admins (any admin, read-only) and admin_grant /
--     admin_set_role / admin_revoke (super_admin only; never on yourself;
--     never leaving zero super_admins). All audited.
--   * admin_overview_stats gains businesses_hidden.
--   * Fixes 0020's admin_list_audit_log: its prefix filter used LIKE, where
--     `_` is a wildcard, so 'member_' also matched 'members_export'.
--   * Closes a grant hole from 0019: assign_member_code_for was only revoked
--     `from public`, but Supabase grants execute on new public functions to
--     anon/authenticated directly, so any signed-in user could call it.
--
-- ORDER OF DEPLOY: apply this migration, then the frontend. The old
-- frontend keeps working against it except for the event queue, which
-- calls admin_list_events by named arguments that still exist.
--
-- Run manually in the Supabase SQL editor -- this repo's migrations are not
-- wired to a runner (see 0001_init.sql).
--
-- Function bodies below are extracted verbatim from ddl/core_schema.sql.

-- ================================================================
-- businesses: moderation columns + protection trigger
-- ================================================================

alter table businesses
  add column is_hidden boolean not null default false,
  add column hidden_reason text,
  add column hidden_by uuid references auth.users(id),
  add column hidden_at timestamptz;

-- (0021) Same idea as people_protect_review_columns: `own business update`
-- is column-blind, so without this an owner could un-hide their own listing
-- through PostgREST. On insert the columns are reset rather than refused --
-- a fresh listing is never hidden, and createBusiness() shouldn't have to
-- know these columns exist.
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
    elsif (new.is_hidden, new.hidden_reason, new.hidden_by, new.hidden_at)
          is distinct from
          (old.is_hidden, old.hidden_reason, old.hidden_by, old.hidden_at) then
      raise exception 'Only an admin can hide or unhide a listing';
    end if;
  end if;
  return new;
end;
$$;

create trigger businesses_protect_moderation_columns
  before insert or update on businesses
  for each row execute function businesses_protect_moderation_columns();

-- ================================================================
-- member-facing reads skip hidden listings
-- ================================================================

drop policy "members read businesses" on businesses;
-- (0021) A listing an admin has hidden is readable by its owner only.
create policy "members read businesses" on businesses for select
  using ((is_approved_member() and not is_hidden)
         or owner_id in (select id from people where auth_user_id = auth.uid()));

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
  primary_product text,
  business_type text,
  facebook_url text,
  instagram_url text,
  linkedin_url text,
  youtube_url text,
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
         b.brand_name, b.address_line1, b.address_line2, b.business_email,
         b.primary_product, b.business_type,
         b.facebook_url, b.instagram_url, b.linkedin_url, b.youtube_url,
         p.id, p.full_name, p.profile_photo_url, p.member_code
  from businesses b
  join people p on p.id = b.owner_id
  where b.id = p_business_id
    and is_approved_member()
    and p.member_status = 'approved'
    and not b.is_hidden;
$$;

revoke all on function get_business(uuid) from public;
grant execute on function get_business(uuid) to authenticated;

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
    and is_approved_member()
    and p.member_status = 'approved'
    and not b.is_hidden
  order by b.name asc, b.id asc;
$$;

revoke all on function list_member_businesses(uuid) from public;
grant execute on function list_member_businesses(uuid) to authenticated;

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
    where p.member_status = 'approved' and not b.is_hidden and b.category is not null
    union
    select 'city', b.city
    from businesses b join people p on p.id = b.owner_id
    where p.member_status = 'approved' and not b.is_hidden and b.city is not null
    union
    select 'state', b.state
    from businesses b join people p on p.id = b.owner_id
    where p.member_status = 'approved' and not b.is_hidden and b.state is not null
  ) f
  where is_approved_member()
  order by f.kind, f.value;
$$;

revoke all on function business_filter_options() from public;
grant execute on function business_filter_options() to authenticated;

-- ================================================================
-- admin_list_events: + p_search
-- ================================================================

drop function admin_list_events(text, int, int);

create or replace function admin_list_events(
  p_status text default 'pending',
  p_search text default null,
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  id uuid,
  title text,
  description text,
  starts_at timestamptz,
  ends_at timestamptz,
  venue text,
  city text,
  state text,
  capacity int,
  visibility text,
  status text,
  creator_id uuid,
  creator_name text,
  creator_photo_url text,
  creator_member_code text,
  going_count bigint,
  my_rsvp_status text,
  rejection_reason text,
  total_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select id from people where auth_user_id = auth.uid() and member_status = 'approved'
  )
  select e.id, e.title, e.description, e.starts_at, e.ends_at,
         e.venue, e.city, e.state, e.capacity, e.visibility, e.status,
         p.id, p.full_name, p.profile_photo_url, p.member_code,
         (select count(*) from rsvps r where r.event_id = e.id and r.status = 'going'),
         (select r.status from rsvps r where r.event_id = e.id and r.person_id = me.id),
         e.rejection_reason,
         count(*) over ()
  from events e
  join people p on p.id = e.creator_id
  left join me on true
  where is_admin()
    and e.status = p_status
    and (p_search is null or length(trim(p_search)) = 0
         or e.title ilike '%' || trim(p_search) || '%'
         or p.full_name ilike '%' || trim(p_search) || '%'
         or e.city ilike '%' || trim(p_search) || '%')
  order by case when p_status = 'pending' then e.created_at end asc,
           e.updated_at desc, e.id asc
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function admin_list_events(text, text, int, int) from public;
grant execute on function admin_list_events(text, text, int, int) to authenticated;

-- ================================================================
-- admin_overview_stats: + businesses_hidden
-- ================================================================

create or replace function admin_overview_stats()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'members_by_status', coalesce(
      (select jsonb_object_agg(s.member_status, s.n)
       from (select member_status, count(*) as n from people group by member_status) s),
      '{}'::jsonb),
    'signups_7d', (select count(*) from people where created_at >= now() - interval '7 days'),
    'signups_30d', (select count(*) from people where created_at >= now() - interval '30 days'),
    'events_pending', (select count(*) from events where status = 'pending'),
    'events_upcoming', (select count(*) from events where status = 'approved' and starts_at >= now()),
    'businesses', (select count(*) from businesses),
    'businesses_hidden', (select count(*) from businesses where is_hidden)
  )
  where is_admin();
$$;

revoke all on function admin_overview_stats() from public;
grant execute on function admin_overview_stats() to authenticated;

-- ================================================================
-- grant hole: assign_member_code_for
-- ================================================================

revoke all on function assign_member_code_for(uuid) from public, anon, authenticated;

-- ================================================================
-- fix from 0020: admin_list_audit_log prefix filter
-- ================================================================

create or replace function admin_list_audit_log(
  p_target_id uuid default null,
  p_action_prefix text default null,
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  id uuid,
  created_at timestamptz,
  action text,
  target_type text,
  target_id uuid,
  target_label text,
  notes text,
  admin_person_id uuid,
  admin_name text,
  total_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.created_at, a.action, a.target_type, a.target_id,
         case a.target_type
           when 'person' then (select t.full_name from people t where t.id = a.target_id)
           when 'event' then (select t.title from events t where t.id = a.target_id)
           when 'business' then (select t.name from businesses t where t.id = a.target_id)
         end,
         a.notes, a.admin_id, ap.full_name,
         count(*) over ()
  from admin_audit_log a
  left join people ap on ap.id = a.admin_id
  where is_admin()
    and (p_target_id is null or a.target_id = p_target_id)
    -- An exact prefix compare, not LIKE: `_` is a LIKE wildcard, so
    -- 'member_%' would also match 'members_export'.
    and (p_action_prefix is null
         or left(a.action, length(p_action_prefix)) = p_action_prefix)
  order by a.created_at desc, a.id asc
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function admin_list_audit_log(uuid, text, int, int) from public;
grant execute on function admin_list_audit_log(uuid, text, int, int) to authenticated;

-- ================================================================
-- Phase 5b-2 (0021): business moderation + admin management
-- ================================================================

-- The console's business list: every listing, hidden or not, with the
-- owner's identity and status. p_hidden null = all. Search covers name,
-- brand name and owner name. Clamp 1-100.
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

-- Hide (reason required -- the owner reads it) or unhide a listing. Any
-- admin. Audited as business_hidden / business_unhidden.
create or replace function admin_set_business_hidden(
  p_business_id uuid,
  p_hidden boolean,
  p_reason text default null
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
  if p_hidden is null then
    raise exception 'Say whether to hide or unhide the listing';
  end if;

  select * into v_business from businesses where id = p_business_id for update;
  if not found then
    raise exception 'Listing not found';
  end if;
  if v_business.is_hidden = p_hidden then
    raise exception 'This listing is already %', case when p_hidden then 'hidden' else 'visible' end;
  end if;

  if p_hidden then
    if p_reason is null or length(trim(p_reason)) = 0 then
      raise exception 'Please give a reason for hiding this listing';
    end if;
    update businesses
    set is_hidden = true, hidden_reason = trim(p_reason),
        hidden_by = auth.uid(), hidden_at = now(), updated_at = now()
    where id = p_business_id;
  else
    update businesses
    set is_hidden = false, hidden_reason = null,
        hidden_by = null, hidden_at = null, updated_at = now()
    where id = p_business_id;
  end if;

  select id into v_admin_person_id from people where auth_user_id = auth.uid();
  insert into admin_audit_log (admin_id, action, target_type, target_id, notes)
  values (v_admin_person_id,
          case when p_hidden then 'business_hidden' else 'business_unhidden' end,
          'business', p_business_id, nullif(trim(p_reason), ''));
end;
$$;

revoke all on function admin_set_business_hidden(uuid, boolean, text) from public;
grant execute on function admin_set_business_hidden(uuid, boolean, text) to authenticated;

-- Everyone in `admins`, with their member identity where they have one (a
-- hand-seeded admin may not). Any admin may read it -- moderators get a
-- read-only view; every write below is super_admin only.
create or replace function admin_list_admins()
returns table (
  auth_user_id uuid,
  role text,
  created_at timestamptz,
  person_id uuid,
  full_name text,
  member_code text,
  profile_photo_url text,
  email text
)
language sql
stable
security definer
set search_path = public
as $$
  select a.auth_user_id, a.role, a.created_at,
         p.id, p.full_name, p.member_code, p.profile_photo_url, u.email::text
  from admins a
  left join people p on p.auth_user_id = a.auth_user_id
  left join auth.users u on u.id = a.auth_user_id
  where is_admin()
  order by case a.role when 'super_admin' then 0 else 1 end,
           p.full_name asc nulls last, a.auth_user_id asc;
$$;

revoke all on function admin_list_admins() from public;
grant execute on function admin_list_admins() to authenticated;

-- Shared guard for the three admin-management writes: the caller must be a
-- super_admin, and must not be acting on themselves -- self-demotion and
-- self-removal are how a console ends up with no super_admin, and a second
-- super_admin can always do it for them.
create or replace function admin_require_super_admin_for(p_target_auth_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(admin_role(), '') <> 'super_admin' then
    raise exception 'Only a super admin can manage admins';
  end if;
  if p_target_auth_user_id = auth.uid() then
    raise exception 'You cannot change your own admin access';
  end if;
end;
$$;

revoke all on function admin_require_super_admin_for(uuid) from public, anon, authenticated;

-- Audit helper for the three writes below. Logged against the member
-- (target_type 'person') where the admin has a people row, so the entry
-- links to their member page and shows on its History; notes carry the
-- role change.
create or replace function admin_log_admin_change(
  p_target_auth_user_id uuid,
  p_action text,
  p_notes text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_person_id uuid;
  v_target_person_id uuid;
begin
  select id into v_admin_person_id from people where auth_user_id = auth.uid();
  select id into v_target_person_id from people where auth_user_id = p_target_auth_user_id;
  insert into admin_audit_log (admin_id, action, target_type, target_id, notes)
  values (v_admin_person_id, p_action, 'person', v_target_person_id, p_notes);
end;
$$;

revoke all on function admin_log_admin_change(uuid, text, text) from public, anon, authenticated;

-- Make an approved member an admin.
create or replace function admin_grant(p_person_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person people%rowtype;
begin
  -- Role check first, so a non-admin can't probe which ids exist. No self
  -- check needed here: the caller is already an admin, so granting
  -- themselves fails as "already an admin" below.
  perform admin_require_super_admin_for(null);
  select * into v_person from people where id = p_person_id;
  if not found then
    raise exception 'Member not found';
  end if;
  if p_role not in ('super_admin', 'moderator') then
    raise exception 'Invalid role: %', p_role;
  end if;
  if v_person.member_status <> 'approved' or v_person.auth_user_id is null then
    raise exception 'Only an approved member can be made an admin';
  end if;
  if exists (select 1 from admins where auth_user_id = v_person.auth_user_id) then
    raise exception '% is already an admin', v_person.full_name;
  end if;

  insert into admins (auth_user_id, role) values (v_person.auth_user_id, p_role);
  perform admin_log_admin_change(v_person.auth_user_id, 'admin_granted', p_role);
end;
$$;

revoke all on function admin_grant(uuid, text) from public;
grant execute on function admin_grant(uuid, text) to authenticated;

-- Change an admin's role. The table lock serialises concurrent role changes
-- so two super_admins can't demote each other at the same instant and leave
-- none. (With self-changes refused, the caller is always a remaining
-- super_admin anyway -- the count check is the belt to that brace.)
create or replace function admin_set_role(p_auth_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current text;
begin
  perform admin_require_super_admin_for(p_auth_user_id);
  if p_role not in ('super_admin', 'moderator') then
    raise exception 'Invalid role: %', p_role;
  end if;

  lock table admins in share row exclusive mode;
  select role into v_current from admins where auth_user_id = p_auth_user_id;
  if not found then
    raise exception 'Not an admin';
  end if;
  if v_current = p_role then
    raise exception 'They are already a %', replace(p_role, '_', ' ');
  end if;
  if v_current = 'super_admin'
     and (select count(*) from admins where role = 'super_admin') <= 1 then
    raise exception 'There must always be at least one super admin';
  end if;

  update admins set role = p_role where auth_user_id = p_auth_user_id;
  perform admin_log_admin_change(p_auth_user_id, 'admin_role_changed', v_current || ' -> ' || p_role);
end;
$$;

revoke all on function admin_set_role(uuid, text) from public;
grant execute on function admin_set_role(uuid, text) to authenticated;

-- Remove someone's admin access. Their membership is untouched.
create or replace function admin_revoke(p_auth_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current text;
begin
  perform admin_require_super_admin_for(p_auth_user_id);

  lock table admins in share row exclusive mode;
  select role into v_current from admins where auth_user_id = p_auth_user_id;
  if not found then
    raise exception 'Not an admin';
  end if;
  if v_current = 'super_admin'
     and (select count(*) from admins where role = 'super_admin') <= 1 then
    raise exception 'There must always be at least one super admin';
  end if;

  delete from admins where auth_user_id = p_auth_user_id;
  perform admin_log_admin_change(p_auth_user_id, 'admin_revoked', v_current);
end;
$$;

revoke all on function admin_revoke(uuid) from public;
grant execute on function admin_revoke(uuid) to authenticated;

-- ================================================================
-- verification (run these after applying)
-- ================================================================
-- select column_name from information_schema.columns
-- where table_name = 'businesses' and (column_name like 'hidden%' or column_name = 'is_hidden');
--   -- 4 rows
-- select tgname from pg_trigger where tgname = 'businesses_protect_moderation_columns';
--   -- 1 row
-- select pg_get_function_identity_arguments(oid) from pg_proc where proname = 'admin_list_events';
--   -- exactly one row: p_status text, p_search text, p_limit integer, p_offset integer
-- select has_function_privilege('authenticated', 'assign_member_code_for(uuid)', 'execute'),
--        has_function_privilege('authenticated', 'admin_log_admin_change(uuid,text,text)', 'execute'),
--        has_function_privilege('authenticated', 'admin_require_super_admin_for(uuid)', 'execute');
--   -- false, false, false
-- select proname from pg_proc
-- where proname in ('admin_list_businesses', 'admin_set_business_hidden', 'admin_list_admins',
--                   'admin_grant', 'admin_set_role', 'admin_revoke');
--   -- 6 rows
--
-- Then, signed in as a business owner in the browser console:
--   await supabase.from('businesses').update({ is_hidden: false }).eq('id', '<their hidden listing>')
--   -- must fail with "Only an admin can hide or unhide a listing"
