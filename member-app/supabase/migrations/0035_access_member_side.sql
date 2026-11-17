-- Phase 11.3: paid access, member side (see phase-11-plan.md).
--
--   * service_access_grants.member_seen_at: when the member dismissed the
--     "You now have X access" card on Home. Null = not seen yet. In place of
--     a personal notification feed, which the app doesn't have (decided
--     2026-11-17: a Home card now, a real feed maybe later as its own phase).
--   * my_access_news(): the caller's unseen live grants, one row per
--     service: whether it's new access or an extension, and the end of the
--     whole run. dismiss_access_news(service) marks them seen.
--   * has_paid_badge(person): the paid badge -- the person holds a live grant
--     for ANY service, and at least one paywall is on (until something is
--     paid for, a badge means nothing). Definer-only, like
--     has_service_access. Admins get every service free but no badge unless
--     they also hold a grant.
--   * list_directory / get_member_profile gain has_paid_badge. Adding a
--     column changes the return type, so both are dropped and recreated --
--     inside one transaction, so the directory is never missing. Bodies are
--     otherwise unchanged from 0013/0019.
--   * Supabase grants execute on new functions to anon and authenticated
--     directly: helpers are revoked from both, member RPCs from anon. The two
--     recreated directory RPCs also lose anon (they returned nothing
--     signed-out anyway, via is_approved_member()).
--
-- ORDER OF DEPLOY: 0034 applied. Apply this, then the frontend. The old
-- frontend keeps working against it (the extra column is ignored).
--
-- Re-runnable.

begin;

-- ================================================================
-- table
-- ================================================================

alter table service_access_grants add column if not exists member_seen_at timestamptz;

-- ================================================================
-- helper (definer-only)
-- ================================================================

create or replace function has_paid_badge(p_person_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from paid_service_settings where enforced)
     and exists (select 1 from service_access_grants g
                 where g.person_id = p_person_id
                   and g.revoked_at is null
                   and g.starts_at <= now()
                   and g.ends_at > now());
$$;

revoke all on function has_paid_badge(uuid) from public;
revoke all on function has_paid_badge(uuid) from anon, authenticated;

-- ================================================================
-- directory RPCs + has_paid_badge
-- ================================================================

drop function if exists list_directory(text, text, text, text, text, int, int);

create function list_directory(
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
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.full_name, p.gotra, p.native_place, p.current_city, p.current_state,
         p.member_code, p.profile_photo_url,
         p.occupation_type, p.job_title, p.company_name,
         has_paid_badge(p.id),
         count(*) over () as total_count
  from people p
  where is_approved_member()
    and p.member_status = 'approved'
    and (p_search is null or length(trim(p_search)) = 0
         or p.full_name ilike '%' || p_search || '%')
    and (p_state is null or p.current_state ilike p_state)
    and (p_city is null or p.current_city ilike p_city)
    and (p_gotra is null or p.gotra ilike p_gotra)
    and (p_occupation is null or p.occupation_type = p_occupation)
  order by p.full_name asc, p.id asc
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function list_directory(text, text, text, text, text, int, int) from public;
grant execute on function list_directory(text, text, text, text, text, int, int) to authenticated;
revoke execute on function list_directory(text, text, text, text, text, int, int) from anon;

drop function if exists get_member_profile(uuid);

create function get_member_profile(p_person_id uuid)
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
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.full_name, p.gotra, p.native_place, p.current_city, p.current_district,
         p.current_state, p.member_code, p.education, p.marital_status,
         case when p.hide_mobile and not is_admin() then null else p.mobile_number end,
         p.profile_photo_url,
         p.occupation_type, p.job_title, p.company_name, p.job_location,
         has_paid_badge(p.id)
  from people p
  where p.id = p_person_id
    and (is_approved_member() or is_admin())
    and (p.member_status = 'approved' or is_admin());
$$;

revoke all on function get_member_profile(uuid) from public;
grant execute on function get_member_profile(uuid) to authenticated;
revoke execute on function get_member_profile(uuid) from anon;

-- ================================================================
-- member RPCs: the Home "access granted" card
-- ================================================================

-- One row per service with unseen live grants. extended = every unseen
-- grant was chained onto access the member already had (it starts after it
-- was made); a brand-new grant plus an extension of it reads as new.
create or replace function my_access_news()
returns table (
  service text,
  extended boolean,
  ends_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select g.service,
         bool_and(g.starts_at > g.created_at + interval '1 minute'),
         service_access_ends_at(me.id, g.service)
  from (select p.id from people p
        where p.auth_user_id = auth.uid() and p.member_status = 'approved') me
  join service_access_grants g on g.person_id = me.id
  where g.member_seen_at is null
    and g.revoked_at is null
    and g.ends_at > now()
  group by me.id, g.service
  order by array_position(array['directory', 'business', 'events', 'matrimony'], g.service);
$$;

revoke all on function my_access_news() from public;
grant execute on function my_access_news() to authenticated;
revoke execute on function my_access_news() from anon;

create or replace function dismiss_access_news(p_service text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid;
begin
  select id into v_me from people where auth_user_id = auth.uid() and member_status = 'approved';
  if v_me is null then
    raise exception 'Only approved members can do this';
  end if;
  update service_access_grants
  set member_seen_at = now()
  where person_id = v_me
    and service = p_service
    and member_seen_at is null;
end;
$$;

revoke all on function dismiss_access_news(text) from public;
grant execute on function dismiss_access_news(text) to authenticated;
revoke execute on function dismiss_access_news(text) from anon;

commit;

-- ================================================================
-- verification (run these after applying)
-- ================================================================
-- select column_name from information_schema.columns
-- where table_name = 'service_access_grants' and column_name = 'member_seen_at';
--   -- 1 row
-- select proname, pg_get_function_result(oid) like '%has_paid_badge%' as has_col,
--        has_function_privilege('anon', oid, 'execute') as anon,
--        has_function_privilege('authenticated', oid, 'execute') as authed
-- from pg_proc where proname in ('list_directory', 'get_member_profile', 'has_paid_badge',
--                                'my_access_news', 'dismiss_access_news');
--   -- list_directory / get_member_profile: has_col true, anon false, authed true
--   -- has_paid_badge: anon false, authed false
--   -- my_access_news / dismiss_access_news: anon false, authed true
--
-- Then, signed in as a member who holds a grant they haven't dismissed:
--   await supabase.rpc('my_access_news')                       -- [{ service, extended, ends_at }]
--   await supabase.rpc('dismiss_access_news', { p_service: 'matrimony' })
--   await supabase.rpc('my_access_news')                       -- []
--   await supabase.rpc('list_directory', {})                   -- rows carry has_paid_badge
--     (false for everyone while every paywall is off)
