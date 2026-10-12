-- Phase 5b-1: the admin console's read side.
--
-- 5a left the admin surface as one Approvals page. This adds what the
-- console shell (Overview / Approvals / Members / member detail) reads:
--
--   * admin_search_members      -- the members table: status / state / city /
--                                  gotra / occupation filters, search incl.
--                                  login email, pages of up to 100.
--   * admin_member_filter_options -- chip values for those filters.
--   * admin_export_members      -- CSV export, super_admin only, no row cap,
--                                  every call audited as 'members_export'.
--   * admin_get_member          -- one member's full record as jsonb.
--   * admin_list_audit_log      -- the first reader of admin_audit_log.
--   * admin_overview_stats      -- the Overview counters.
--   * admin_filter_members      -- the shared WHERE behind search + export.
--                                  Not callable by clients (see its comment).
--
-- Plus one fix: admin_list_events' `me` CTE is left-joined instead of
-- cross-joined, so an admin who isn't an approved member sees the queue.
--
-- No table or policy changes; nothing here alters what members can see.
-- No Edge Function changes -- "Resend status email" reuses send-member-status.
--
-- ORDER OF DEPLOY: apply this migration, then the frontend.
--
-- Run manually in the Supabase SQL editor -- this repo's migrations are not
-- wired to a runner (see 0001_init.sql).
--
-- Function bodies below are extracted verbatim from ddl/core_schema.sql.

-- ================================================================
-- fix: admin_list_events for admins who aren't approved members
-- ================================================================

-- Admin queue. Same card columns plus rejection_reason and total_count.
-- (0020) `me` is left-joined, not cross-joined: since 0019 it only has a row
-- for an approved member, so an admin who isn't one (seeded by hand, or
-- still pending themselves) got zero rows back instead of the queue.
create or replace function admin_list_events(
  p_status text default 'pending',
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
  order by case when p_status = 'pending' then e.created_at end asc,
           e.updated_at desc, e.id asc
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function admin_list_events(text, int, int) from public;
grant execute on function admin_list_events(text, int, int) to authenticated;

-- ================================================================
-- Phase 5b-1 (0020): admin console read RPCs
-- ================================================================

-- The members table's shared WHERE clause, so the paged list and the CSV
-- export can't disagree about who matches a filter. Returns whole people
-- rows plus the login email, so it is gated on is_admin() itself AND revoked
-- from anon/authenticated by name: Supabase's default privileges grant
-- execute on new public functions to those roles directly, which a plain
-- `revoke ... from public` does not undo. Only the two definer functions
-- below call it.
--
-- p_status null = everyone who has submitted (all but 'onboarding');
-- 'onboarding' can still be asked for explicitly, to find half-finished
-- signups. Search covers name, code, mobile and login email.
create or replace function admin_filter_members(
  p_status text,
  p_search text,
  p_state text,
  p_city text,
  p_gotra text,
  p_occupation text
)
returns table (person people, email text)
language sql
stable
security definer
set search_path = public
as $$
  select p, u.email::text
  from people p
  left join auth.users u on u.id = p.auth_user_id
  where (case when p_status is null then p.member_status <> 'onboarding'
              else p.member_status = p_status end)
    and (p_search is null or length(trim(p_search)) = 0
         or p.full_name ilike '%' || trim(p_search) || '%'
         or p.member_code ilike '%' || trim(p_search) || '%'
         or p.mobile_number like '%' || trim(p_search) || '%'
         or u.email ilike '%' || trim(p_search) || '%')
    and (p_state is null or p.current_state = p_state)
    and (p_city is null or p.current_city = p_city)
    and (p_gotra is null or p.gotra = p_gotra)
    and (p_occupation is null or p.occupation_type = p_occupation)
    and is_admin();
$$;

revoke all on function admin_filter_members(text, text, text, text, text, text)
  from public, anon, authenticated;

-- The console's members table. Same identity tier as admin_list_members
-- (which the approval queue keeps using, with its queue ordering) plus
-- occupation; newest signups first. Clamp 1-100.
create or replace function admin_search_members(
  p_status text default null,
  p_search text default null,
  p_state text default null,
  p_city text default null,
  p_gotra text default null,
  p_occupation text default null,
  p_limit int default 25,
  p_offset int default 0
)
returns table (
  id uuid,
  full_name text,
  profile_photo_url text,
  member_code text,
  email text,
  mobile_number text,
  gotra text,
  native_place text,
  current_city text,
  current_state text,
  occupation_type text,
  member_status text,
  admin_message text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  created_at timestamptz,
  total_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select (f.person).id, (f.person).full_name, (f.person).profile_photo_url,
         (f.person).member_code, f.email, (f.person).mobile_number,
         (f.person).gotra, (f.person).native_place,
         (f.person).current_city, (f.person).current_state,
         (f.person).occupation_type, (f.person).member_status,
         (f.person).admin_message, (f.person).submitted_at,
         (f.person).reviewed_at, (f.person).created_at,
         count(*) over () as total_count
  from admin_filter_members(p_status, p_search, p_state, p_city, p_gotra, p_occupation) f
  where is_admin()
  order by (f.person).created_at desc nulls last, (f.person).id asc
  limit least(greatest(coalesce(p_limit, 25), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function admin_search_members(text, text, text, text, text, text, int, int) from public;
grant execute on function admin_search_members(text, text, text, text, text, text, int, int) to authenticated;

-- Chip values for the members table's filters. Same (kind, value) shape as
-- directory_filter_options, but across everyone who has submitted rather
-- than approved members only -- the console needs to filter the queue too.
-- Occupation is a fixed list client-side (OCCUPATION_OPTIONS), so not here.
create or replace function admin_member_filter_options()
returns table (kind text, value text)
language sql
stable
security definer
set search_path = public
as $$
  select f.kind, f.value
  from (
    select 'state' as kind, p.current_state as value
    from people p where p.member_status <> 'onboarding' and p.current_state is not null
    union
    select 'city', p.current_city
    from people p where p.member_status <> 'onboarding' and p.current_city is not null
    union
    select 'gotra', p.gotra
    from people p where p.member_status <> 'onboarding' and p.gotra is not null
  ) f
  where is_admin()
  order by f.kind, f.value;
$$;

revoke all on function admin_member_filter_options() from public;
grant execute on function admin_member_filter_options() to authenticated;

-- CSV export: the same filters, no row cap, super_admin only -- it is a bulk
-- download of every matching member's mobile number and email. plpgsql (and
-- not `stable`) because every export is written to admin_audit_log with the
-- filters used and the row count.
create or replace function admin_export_members(
  p_status text default null,
  p_search text default null,
  p_state text default null,
  p_city text default null,
  p_gotra text default null,
  p_occupation text default null
)
returns table (
  member_code text,
  member_status text,
  first_name text,
  middle_name text,
  last_name text,
  full_name text,
  gender text,
  dob date,
  email text,
  mobile_number text,
  gotra text,
  native_place text,
  current_city text,
  current_district text,
  current_state text,
  occupation_type text,
  job_title text,
  company_name text,
  marital_status text,
  education text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count bigint;
  v_admin_person_id uuid;
begin
  if coalesce(admin_role(), '') <> 'super_admin' then
    raise exception 'Only a super admin can export member data';
  end if;

  return query
    select (f.person).member_code, (f.person).member_status,
           (f.person).first_name, (f.person).middle_name, (f.person).last_name,
           (f.person).full_name, (f.person).gender, (f.person).dob,
           f.email, (f.person).mobile_number,
           (f.person).gotra, (f.person).native_place,
           (f.person).current_city, (f.person).current_district, (f.person).current_state,
           (f.person).occupation_type, (f.person).job_title, (f.person).company_name,
           (f.person).marital_status, (f.person).education,
           (f.person).submitted_at, (f.person).reviewed_at, (f.person).created_at
    from admin_filter_members(p_status, p_search, p_state, p_city, p_gotra, p_occupation) f
    order by (f.person).full_name asc, (f.person).id asc;
  get diagnostics v_count = row_count;

  select id into v_admin_person_id from people where auth_user_id = auth.uid();
  insert into admin_audit_log (admin_id, action, target_type, target_id, notes)
  values (v_admin_person_id, 'members_export', 'export', null,
          jsonb_strip_nulls(jsonb_build_object(
            'rows', v_count, 'status', p_status, 'search', nullif(trim(p_search), ''),
            'state', p_state, 'city', p_city, 'gotra', p_gotra, 'occupation', p_occupation
          ))::text);
end;
$$;

revoke all on function admin_export_members(text, text, text, text, text, text) from public;
grant execute on function admin_export_members(text, text, text, text, text, text) to authenticated;

-- One member's whole record for the admin detail screen: every people column,
-- the login email, who reviewed them, and their family relations, children
-- and business listings. Admin-only, so none of 3a's visibility tiers apply.
-- Null when the caller isn't an admin or the id is unknown.
create or replace function admin_get_member(p_person_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select to_jsonb(p) || jsonb_build_object(
           'email', u.email,
           'reviewed_by_name',
             (select r.full_name from people r where r.auth_user_id = p.reviewed_by),
           'family_relations', coalesce(
             (select jsonb_agg(to_jsonb(fr) order by fr.slot)
              from family_relations fr where fr.person_id = p.id), '[]'::jsonb),
           'children', coalesce(
             (select jsonb_agg(to_jsonb(c) order by c.created_at, c.id)
              from children c where c.parent_person_id = p.id), '[]'::jsonb),
           'businesses', coalesce(
             (select jsonb_agg(to_jsonb(b) order by b.name, b.id)
              from businesses b where b.owner_id = p.id), '[]'::jsonb)
         )
  from people p
  left join auth.users u on u.id = p.auth_user_id
  where p.id = p_person_id
    and is_admin();
$$;

revoke all on function admin_get_member(uuid) from public;
grant execute on function admin_get_member(uuid) to authenticated;

-- The first reader of admin_audit_log (written since 0018). Newest first,
-- with the acting admin's name and a human label for the target resolved
-- per target_type. p_target_id narrows to one record's history (the member
-- detail screen); p_action_prefix to one family of actions ('member_',
-- 'event_', ...). Clamp 1-50.
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

-- Counters for the console's Overview. One round trip; null for a non-admin.
-- members_by_status only carries statuses that have at least one row -- the
-- client defaults the rest to 0.
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
    'businesses', (select count(*) from businesses)
  )
  where is_admin();
$$;

revoke all on function admin_overview_stats() from public;
grant execute on function admin_overview_stats() to authenticated;

-- ================================================================
-- verification (run these after applying)
-- ================================================================
-- select proname from pg_proc
-- where proname in ('admin_filter_members', 'admin_search_members',
--                   'admin_member_filter_options', 'admin_export_members',
--                   'admin_get_member', 'admin_list_audit_log', 'admin_overview_stats');
--   -- 7 rows
-- select has_function_privilege('authenticated',
--   'admin_filter_members(text,text,text,text,text,text)', 'execute');
--   -- false
-- select prosrc like '%left join me on true%' from pg_proc where proname = 'admin_list_events';
--   -- true
--
-- Then, signed in as an ordinary member in the browser console:
--   await supabase.rpc('admin_search_members')        -- empty array
--   await supabase.rpc('admin_overview_stats')        -- null
--   await supabase.rpc('admin_export_members')        -- error: Only a super admin ...
--   await supabase.rpc('admin_filter_members', { p_status: null, p_search: null,
--     p_state: null, p_city: null, p_gotra: null, p_occupation: null })
--     -- permission denied
