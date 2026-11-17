-- Phase 11.4: Directory gating (see directory-paid-features.md, phase-11-plan.md).
--
-- Everything here depends on has_service_access(me, 'directory'), which is
-- true for everyone while the Directory paywall is off -- so applying this
-- changes nothing until a super admin turns that paywall on.
--
-- Without Directory access ("free"):
--   * list_directory: job_title and company_name come back null, and more
--     than one of state / city / gotra / occupation at once is refused
--     (SQLSTATE KCL02). Name search combines with one filter freely.
--   * get_member_profile: mobile_number, marital_status, current_district,
--     job_title, company_name and job_location come back null. Opening an
--     11th *different* member in a day (India time) is refused (SQLSTATE
--     KCL01); re-opening one already opened today is free, and your own
--     profile never counts. The member's own "hide my number" still wins for
--     paid viewers.
--   * search_registered_members (Profile -> family linking) stops returning
--     mobile numbers -- otherwise it would hand out what the Directory locks.
--     Free members type a relative's number themselves.
-- With access, or as an admin, or for your own profile: as before.
--
--   * directory_profile_views (viewer, viewed, view_date): only free
--     members' opens are recorded, since only they are counted. RPC-only.
--   * get_member_profile becomes plpgsql + volatile (it now writes). Same
--     return type, so create or replace; the frontend is unaffected.
--   * Custom SQLSTATEs reach supabase-js as error.code ('KCL01' / 'KCL02'),
--     so the app can tell "limit reached" from a real failure.
--
-- ORDER OF DEPLOY: 0035 applied. Apply this, then the frontend (which sets
-- PAYWALL_READY.directory so the admin page offers Turn on).
--
-- Re-runnable.

begin;

-- ================================================================
-- table
-- ================================================================

create table if not exists directory_profile_views (
  viewer_id uuid not null references people(id) on delete cascade,
  viewed_id uuid not null references people(id) on delete cascade,
  -- India date: the daily allowance resets at midnight IST.
  view_date date not null,
  created_at timestamptz not null default now(),
  primary key (viewer_id, view_date, viewed_id)
);

alter table directory_profile_views enable row level security;

-- ================================================================
-- list_directory: paid fields + one filter at a time
-- ================================================================

create or replace function list_directory(
  p_search text default null,
  p_state text default null,
  p_city text default null,
  p_gotra text default null,
  p_occupation text default null,
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  id uuid,
  full_name text,
  gotra text,
  native_place text,
  current_city text,
  current_state text,
  member_code text,
  profile_photo_url text,
  occupation_type text,
  job_title text,
  company_name text,
  has_paid_badge boolean,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid;
  v_full boolean;
  v_filters int;
begin
  if not is_approved_member() then
    return;
  end if;
  select p.id into v_me from people p where p.auth_user_id = auth.uid();
  v_full := coalesce(is_admin() or has_service_access(v_me, 'directory'), false);

  v_filters := (nullif(trim(p_state), '') is not null)::int
             + (nullif(trim(p_city), '') is not null)::int
             + (nullif(trim(p_gotra), '') is not null)::int
             + (nullif(trim(p_occupation), '') is not null)::int;
  if not v_full and v_filters > 1 then
    raise exception using
      errcode = 'KCL02',
      message = 'Combining filters is part of Directory access. Use one filter at a time.';
  end if;

  return query
  select p.id, p.full_name, p.gotra, p.native_place, p.current_city, p.current_state,
         p.member_code, p.profile_photo_url,
         p.occupation_type,
         case when v_full then p.job_title end,
         case when v_full then p.company_name end,
         has_paid_badge(p.id),
         count(*) over ()
  from people p
  where p.member_status = 'approved'
    and (p_search is null or length(trim(p_search)) = 0
         or p.full_name ilike '%' || p_search || '%')
    and (p_state is null or p.current_state ilike p_state)
    and (p_city is null or p.current_city ilike p_city)
    and (p_gotra is null or p.gotra ilike p_gotra)
    and (p_occupation is null or p.occupation_type = p_occupation)
  order by p.full_name asc, p.id asc
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke all on function list_directory(text, text, text, text, text, int, int) from public;
grant execute on function list_directory(text, text, text, text, text, int, int) to authenticated;
revoke execute on function list_directory(text, text, text, text, text, int, int) from anon;

-- ================================================================
-- get_member_profile: paid fields + 10 profiles a day
-- ================================================================

create or replace function get_member_profile(p_person_id uuid)
returns table (
  id uuid,
  full_name text,
  gotra text,
  native_place text,
  current_city text,
  current_district text,
  current_state text,
  member_code text,
  education text,
  marital_status text,
  mobile_number text,
  profile_photo_url text,
  occupation_type text,
  job_title text,
  company_name text,
  job_location text,
  has_paid_badge boolean
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  c_daily_limit constant int := 10;
  v_me uuid;
  v_full boolean;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_opened int;
begin
  -- Same visibility rule as before: approved members see approved members;
  -- admins see anyone. Nothing found = no row (and nothing counted).
  if not exists (
    select 1 from people p
    where p.id = p_person_id
      and (is_approved_member() or is_admin())
      and (p.member_status = 'approved' or is_admin())
  ) then
    return;
  end if;

  select p.id into v_me from people p where p.auth_user_id = auth.uid();
  v_full := coalesce(is_admin() or v_me = p_person_id or has_service_access(v_me, 'directory'), false);
  if v_me is null and not v_full then
    return;
  end if;

  if not v_full then
    -- One member's concurrent opens are serialised, so two tabs can't both
    -- squeeze in as the 10th.
    perform pg_advisory_xact_lock(hashtextextended('directory_views:' || v_me::text, 0));
    if not exists (select 1 from directory_profile_views v
                   where v.viewer_id = v_me and v.view_date = v_today and v.viewed_id = p_person_id) then
      select count(*) into v_opened from directory_profile_views v
      where v.viewer_id = v_me and v.view_date = v_today;
      if v_opened >= c_daily_limit then
        raise exception using
          errcode = 'KCL01',
          message = format('You have opened %s profiles today. More open at midnight, or with Directory access.', c_daily_limit);
      end if;
      insert into directory_profile_views (viewer_id, viewed_id, view_date)
      values (v_me, p_person_id, v_today)
      on conflict do nothing;
    end if;
  end if;

  return query
  select p.id, p.full_name, p.gotra, p.native_place, p.current_city,
         case when v_full then p.current_district end,
         p.current_state, p.member_code, p.education,
         case when v_full then p.marital_status end,
         case when not v_full then null
              when p.hide_mobile and not is_admin() and p.id is distinct from v_me then null
              else p.mobile_number end,
         p.profile_photo_url,
         p.occupation_type,
         case when v_full then p.job_title end,
         case when v_full then p.company_name end,
         case when v_full then p.job_location end,
         has_paid_badge(p.id)
  from people p
  where p.id = p_person_id;
end;
$$;

revoke all on function get_member_profile(uuid) from public;
grant execute on function get_member_profile(uuid) to authenticated;
revoke execute on function get_member_profile(uuid) from anon;

-- How many profiles the caller can still open today. Null = unlimited (has
-- Directory access, is an admin, or the paywall is off).
create or replace function my_directory_opens_left()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select case
           when me.id is null then 0
           when is_admin() or has_service_access(me.id, 'directory') then null
           else greatest(0, 10 - (select count(*)::int from directory_profile_views v
                                  where v.viewer_id = me.id
                                    and v.view_date = (now() at time zone 'Asia/Kolkata')::date))
         end
  from (select (select p.id from people p
                where p.auth_user_id = auth.uid() and p.member_status = 'approved') as id) me;
$$;

revoke all on function my_directory_opens_left() from public;
grant execute on function my_directory_opens_left() to authenticated;
revoke execute on function my_directory_opens_left() from anon;

-- ================================================================
-- search_registered_members: no mobile without Directory access
-- ================================================================

create or replace function search_registered_members(
  p_full_name text,
  p_gotra text default null,
  p_native_place text default null
)
returns table (
  id uuid,
  full_name text,
  gotra text,
  native_place text,
  current_city text,
  current_state text,
  member_code text,
  mobile_number text
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.full_name, p.gotra, p.native_place, p.current_city, p.current_state, p.member_code,
         case when p.hide_mobile then null
              when is_admin()
                or has_service_access((select me.id from people me where me.auth_user_id = auth.uid()),
                                      'directory')
                then p.mobile_number
         end
  from people p
  where is_approved_member()
    and p.member_status = 'approved'
    and length(trim(p_full_name)) >= 3
    and p.full_name ilike '%' || p_full_name || '%'
    and (p_gotra is null or p.gotra ilike p_gotra)
    and (p_native_place is null or p.native_place ilike '%' || p_native_place || '%')
  limit 20;
$$;

revoke all on function search_registered_members(text, text, text) from public;
grant execute on function search_registered_members(text, text, text) to authenticated;
revoke execute on function search_registered_members(text, text, text) from anon;

commit;

-- ================================================================
-- verification (run these after applying)
-- ================================================================
-- select relname, relrowsecurity from pg_class where relname = 'directory_profile_views';
--   -- 1 row, true
-- select proname, prolang::regproc, provolatile,
--        has_function_privilege('anon', oid, 'execute') as anon
-- from pg_proc where proname in ('list_directory', 'get_member_profile',
--                                'my_directory_opens_left', 'search_registered_members');
--   -- get_member_profile volatile ('v'); all anon false
--
-- With the Directory paywall OFF nothing changes for anyone. To see the
-- gate, turn it on (super admin, /admin/access) and as a member without a
-- Directory grant:
--   list_directory: job_title / company_name null; two filters -> KCL02
--   get_member_profile: mobile / marital / district / job fields null;
--     an 11th different profile today -> KCL01; my_directory_opens_left() counts down
--   search_registered_members: mobile_number null
