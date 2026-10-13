-- Phase 5c: in-app notices.
--
--   * notices (draft -> published -> withdrawn, optional expires_at) and
--     notice_reads (one row per member per notice once read). Both RPC-only:
--     RLS on, no policies.
--   * Audience = four lists (states / cities / gotras / occupations): OR
--     within a list, AND across lists, empty = no restriction. Matched at
--     read time against the member's current profile.
--   * Member RPCs: list_my_notices, notice_unread_count, mark_notices_read.
--   * Admin RPCs (any admin): admin_count_notice_audience (the composer's
--     live count), admin_list_notices, admin_save_notice,
--     admin_set_notice_status, admin_delete_notice (drafts only).
--     Publish / withdraw / editing a published notice are audited.
--   * admin_list_audit_log resolves notice titles; admin_overview_stats
--     gains notices_active.
--
-- ORDER OF DEPLOY: apply this migration, then the frontend.
--
-- Run manually in the Supabase SQL editor -- this repo's migrations are not
-- wired to a runner (see 0001_init.sql).
--
-- Function bodies below are extracted verbatim from ddl/core_schema.sql.

-- ================================================================
-- tables
-- ================================================================

-- Phase 5c (0022): in-app notices. An admin drafts a notice, targets it,
-- and publishes it; approved members whose profile matches the audience see
-- it in the header bell / dashboard strip until it expires or is withdrawn.
-- RPC-only like events: RLS on, no policies (see enable_rls.sql).
--
-- Audience: four lists, OR within a list, AND across lists; an empty list
-- means "no restriction", so all four empty = every approved member. The
-- match is evaluated at read time against the member's current profile
-- (notice_audience_matches), so moving city moves which notices you see.
create table notices (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 120),
  body text not null check (length(trim(body)) between 1 and 4000),
  audience_states text[] not null default '{}',
  audience_cities text[] not null default '{}',
  audience_gotras text[] not null default '{}',
  audience_occupations text[] not null default '{}',
  status text not null default 'draft'
    check (status in ('draft', 'published', 'withdrawn')),
  -- Null = until withdrawn. Members can still reopen an expired notice from
  -- /notices; it just stops counting as unread / showing on the dashboard.
  expires_at timestamptz,
  created_by uuid references auth.users(id),
  published_by uuid references auth.users(id),
  published_at timestamptz,
  withdrawn_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index notices_status_published_idx on notices (status, published_at desc);

-- One row per (notice, member) once read. Unread = no row.
create table notice_reads (
  notice_id uuid not null references notices(id) on delete cascade,
  person_id uuid not null references people(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (notice_id, person_id)
);

create index notice_reads_person_id_idx on notice_reads (person_id);

alter table notices enable row level security;
alter table notice_reads enable row level security;

-- ================================================================
-- existing functions that learn about notices
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
           when 'notice' then (select t.title from notices t where t.id = a.target_id)
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
    'businesses_hidden', (select count(*) from businesses where is_hidden),
    'notices_active', (select count(*) from notices
                       where status = 'published' and (expires_at is null or expires_at > now()))
  )
  where is_admin();
$$;

revoke all on function admin_overview_stats() from public;
grant execute on function admin_overview_stats() to authenticated;

-- ================================================================
-- Phase 5c (0022): notices
-- ================================================================

-- The audience predicate, in one place for the member reads, the
-- mark-read writes and the composer's "will reach N" count. Pure, no data
-- access. A member with a null field (no gotra on file, say) never matches
-- a list that restricts that field. Not client-callable -- only the definer
-- RPCs below use it.
create or replace function notice_audience_matches(
  p_states text[],
  p_cities text[],
  p_gotras text[],
  p_occupations text[],
  p_state text,
  p_city text,
  p_gotra text,
  p_occupation text
)
returns boolean
language sql
immutable
as $$
  select coalesce(
    (coalesce(cardinality(p_states), 0) = 0 or p_state = any(p_states))
    and (coalesce(cardinality(p_cities), 0) = 0 or p_city = any(p_cities))
    and (coalesce(cardinality(p_gotras), 0) = 0 or p_gotra = any(p_gotras))
    and (coalesce(cardinality(p_occupations), 0) = 0 or p_occupation = any(p_occupations)),
    false);
$$;

revoke all on function notice_audience_matches(text[], text[], text[], text[], text, text, text, text)
  from public, anon, authenticated;

-- Trim, drop blanks, de-duplicate and sort an audience list, so equivalent
-- audiences are stored identically.
create or replace function notice_clean_list(p_values text[])
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(v order by v), '{}')
  from (select distinct trim(x) as v from unnest(coalesce(p_values, '{}')) x
        where length(trim(x)) > 0) t;
$$;

revoke all on function notice_clean_list(text[]) from public, anon, authenticated;

-- ---------------------------------------------------------------- member

-- The caller's notices, newest first: everything published that matches
-- them, expired included (flagged is_active = false) unless p_active_only.
-- The `me` CTE only has a row for an approved member, so it is also the
-- caller gate -- anyone else gets nothing.
create or replace function list_my_notices(
  p_active_only boolean default false,
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  id uuid,
  title text,
  body text,
  published_at timestamptz,
  expires_at timestamptz,
  is_active boolean,
  is_read boolean,
  total_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select id, current_state, current_city, gotra, occupation_type
    from people where auth_user_id = auth.uid() and member_status = 'approved'
  )
  select n.id, n.title, n.body, n.published_at, n.expires_at,
         (n.expires_at is null or n.expires_at > now()),
         exists (select 1 from notice_reads r where r.notice_id = n.id and r.person_id = me.id),
         count(*) over ()
  from notices n
  cross join me
  where n.status = 'published'
    and notice_audience_matches(n.audience_states, n.audience_cities, n.audience_gotras,
                                n.audience_occupations, me.current_state, me.current_city,
                                me.gotra, me.occupation_type)
    and (not coalesce(p_active_only, false) or n.expires_at is null or n.expires_at > now())
  order by n.published_at desc, n.id asc
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function list_my_notices(boolean, int, int) from public;
grant execute on function list_my_notices(boolean, int, int) to authenticated;

-- The header bell's badge: active, matching, unread. 0 for a non-member.
create or replace function notice_unread_count()
returns int
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select id, current_state, current_city, gotra, occupation_type
    from people where auth_user_id = auth.uid() and member_status = 'approved'
  )
  select count(*)::int
  from notices n
  cross join me
  where n.status = 'published'
    and (n.expires_at is null or n.expires_at > now())
    and notice_audience_matches(n.audience_states, n.audience_cities, n.audience_gotras,
                                n.audience_occupations, me.current_state, me.current_city,
                                me.gotra, me.occupation_type)
    and not exists (select 1 from notice_reads r where r.notice_id = n.id and r.person_id = me.id);
$$;

revoke all on function notice_unread_count() from public;
grant execute on function notice_unread_count() to authenticated;

-- Mark one notice (p_notice_id) or every notice the caller can see (null)
-- as read. Silently ignores notices the caller isn't in the audience for,
-- so it can't be used to probe which notices exist.
create or replace function mark_notices_read(p_notice_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me people%rowtype;
begin
  select * into v_me from people
  where auth_user_id = auth.uid() and member_status = 'approved';
  if not found then
    raise exception 'Only approved members can read notices';
  end if;

  insert into notice_reads (notice_id, person_id)
  select n.id, v_me.id
  from notices n
  where (p_notice_id is null or n.id = p_notice_id)
    and n.status = 'published'
    and notice_audience_matches(n.audience_states, n.audience_cities, n.audience_gotras,
                                n.audience_occupations, v_me.current_state, v_me.current_city,
                                v_me.gotra, v_me.occupation_type)
  on conflict (notice_id, person_id) do nothing;
end;
$$;

revoke all on function mark_notices_read(uuid) from public;
grant execute on function mark_notices_read(uuid) to authenticated;

-- ---------------------------------------------------------------- admin

-- The composer's live "will reach N members" count.
create or replace function admin_count_notice_audience(
  p_states text[] default '{}',
  p_cities text[] default '{}',
  p_gotras text[] default '{}',
  p_occupations text[] default '{}'
)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select count(*)
  from people p
  where is_admin()
    and p.member_status = 'approved'
    and notice_audience_matches(notice_clean_list(p_states), notice_clean_list(p_cities),
                                notice_clean_list(p_gotras), notice_clean_list(p_occupations),
                                p.current_state, p.current_city, p.gotra, p.occupation_type);
$$;

revoke all on function admin_count_notice_audience(text[], text[], text[], text[]) from public;
grant execute on function admin_count_notice_audience(text[], text[], text[], text[]) to authenticated;

-- Notices for the console. p_status null = all; p_notice_id fetches one
-- (the editor). reach_count is who matches *now*; read_count is how many
-- have opened it. Each tab sorts by the moment it entered that tab.
create or replace function admin_list_notices(
  p_status text default null,
  p_notice_id uuid default null,
  p_limit int default 25,
  p_offset int default 0
)
returns table (
  id uuid,
  title text,
  body text,
  audience_states text[],
  audience_cities text[],
  audience_gotras text[],
  audience_occupations text[],
  status text,
  expires_at timestamptz,
  published_at timestamptz,
  withdrawn_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  created_by_name text,
  published_by_name text,
  reach_count bigint,
  read_count bigint,
  total_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select n.id, n.title, n.body,
         n.audience_states, n.audience_cities, n.audience_gotras, n.audience_occupations,
         n.status, n.expires_at, n.published_at, n.withdrawn_at, n.created_at, n.updated_at,
         (select c.full_name from people c where c.auth_user_id = n.created_by),
         (select pb.full_name from people pb where pb.auth_user_id = n.published_by),
         (select count(*) from people p
          where p.member_status = 'approved'
            and notice_audience_matches(n.audience_states, n.audience_cities, n.audience_gotras,
                                        n.audience_occupations, p.current_state, p.current_city,
                                        p.gotra, p.occupation_type)),
         (select count(*) from notice_reads r where r.notice_id = n.id),
         count(*) over ()
  from notices n
  where is_admin()
    and (p_status is null or n.status = p_status)
    and (p_notice_id is null or n.id = p_notice_id)
  order by coalesce(n.withdrawn_at, n.published_at, n.updated_at) desc, n.id asc
  limit least(greatest(coalesce(p_limit, 25), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function admin_list_notices(text, uuid, int, int) from public;
grant execute on function admin_list_notices(text, uuid, int, int) to authenticated;

-- Create (p_notice_id null -> a new draft) or edit a notice. Drafts and
-- published notices are editable -- a typo shouldn't need a withdraw and
-- reissue -- but withdrawn ones are not. Editing a published notice is
-- audited; draft edits aren't (nobody has seen them). Returns the id.
create or replace function admin_save_notice(
  p_notice_id uuid,
  p_title text,
  p_body text,
  p_states text[] default '{}',
  p_cities text[] default '{}',
  p_gotras text[] default '{}',
  p_occupations text[] default '{}',
  p_expires_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_notice notices%rowtype;
  v_id uuid;
  v_occupations text[] := notice_clean_list(p_occupations);
  v_admin_person_id uuid;
begin
  if not is_admin() then
    raise exception 'Not an admin';
  end if;
  if p_title is null or length(trim(p_title)) = 0 then
    raise exception 'Please give the notice a title';
  end if;
  if length(trim(p_title)) > 120 then
    raise exception 'Keep the title to 120 characters';
  end if;
  if p_body is null or length(trim(p_body)) = 0 then
    raise exception 'Please write the notice';
  end if;
  if length(trim(p_body)) > 4000 then
    raise exception 'Keep the notice to 4000 characters';
  end if;
  -- Mirrors OCCUPATION_OPTIONS / the people.occupation_type check.
  if exists (select 1 from unnest(v_occupations) o
             where o not in ('Business', 'Job', 'Student', 'Homemaker', 'Retired', 'Other')) then
    raise exception 'Unknown occupation in the audience';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'The expiry date must be in the future';
  end if;

  if p_notice_id is null then
    insert into notices (title, body, audience_states, audience_cities, audience_gotras,
                         audience_occupations, expires_at, created_by)
    values (trim(p_title), trim(p_body), notice_clean_list(p_states), notice_clean_list(p_cities),
            notice_clean_list(p_gotras), v_occupations, p_expires_at, auth.uid())
    returning id into v_id;
    return v_id;
  end if;

  select * into v_notice from notices where id = p_notice_id for update;
  if not found then
    raise exception 'Notice not found';
  end if;
  if v_notice.status = 'withdrawn' then
    raise exception 'A withdrawn notice cannot be edited';
  end if;

  update notices
  set title = trim(p_title), body = trim(p_body),
      audience_states = notice_clean_list(p_states),
      audience_cities = notice_clean_list(p_cities),
      audience_gotras = notice_clean_list(p_gotras),
      audience_occupations = v_occupations,
      expires_at = p_expires_at, updated_at = now()
  where id = p_notice_id;

  if v_notice.status = 'published' then
    select id into v_admin_person_id from people where auth_user_id = auth.uid();
    insert into admin_audit_log (admin_id, action, target_type, target_id, notes)
    values (v_admin_person_id, 'notice_edited', 'notice', p_notice_id, null);
  end if;
  return p_notice_id;
end;
$$;

revoke all on function admin_save_notice(uuid, text, text, text[], text[], text[], text[], timestamptz) from public;
grant execute on function admin_save_notice(uuid, text, text, text[], text[], text[], text[], timestamptz) to authenticated;

-- draft -> published, published -> withdrawn. One-way: a withdrawn notice
-- stays withdrawn (copy it into a new draft instead). Both audited.
create or replace function admin_set_notice_status(p_notice_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_notice notices%rowtype;
  v_admin_person_id uuid;
begin
  if not is_admin() then
    raise exception 'Not an admin';
  end if;
  if p_status not in ('published', 'withdrawn') then
    raise exception 'Invalid status: %', p_status;
  end if;

  select * into v_notice from notices where id = p_notice_id for update;
  if not found then
    raise exception 'Notice not found';
  end if;

  if p_status = 'published' then
    if v_notice.status <> 'draft' then
      raise exception 'Only a draft can be published';
    end if;
    if v_notice.expires_at is not null and v_notice.expires_at <= now() then
      raise exception 'This notice has already expired -- change the expiry date first';
    end if;
    update notices
    set status = 'published', published_at = now(), published_by = auth.uid(), updated_at = now()
    where id = p_notice_id;
  else
    if v_notice.status <> 'published' then
      raise exception 'Only a published notice can be withdrawn';
    end if;
    update notices
    set status = 'withdrawn', withdrawn_at = now(), updated_at = now()
    where id = p_notice_id;
  end if;

  select id into v_admin_person_id from people where auth_user_id = auth.uid();
  insert into admin_audit_log (admin_id, action, target_type, target_id, notes)
  values (v_admin_person_id, 'notice_' || p_status, 'notice', p_notice_id, null);
end;
$$;

revoke all on function admin_set_notice_status(uuid, text) from public;
grant execute on function admin_set_notice_status(uuid, text) to authenticated;

-- Throw away a draft. Published / withdrawn notices are kept for the record.
create or replace function admin_delete_notice(p_notice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Not an admin';
  end if;
  delete from notices where id = p_notice_id and status = 'draft';
  if not found then
    raise exception 'Only a draft can be deleted';
  end if;
end;
$$;

revoke all on function admin_delete_notice(uuid) from public;
grant execute on function admin_delete_notice(uuid) to authenticated;

-- ================================================================
-- verification (run these after applying)
-- ================================================================
-- select relname, relrowsecurity from pg_class where relname in ('notices', 'notice_reads');
--   -- 2 rows, both true
-- select proname from pg_proc
-- where proname in ('list_my_notices', 'notice_unread_count', 'mark_notices_read',
--                   'admin_count_notice_audience', 'admin_list_notices', 'admin_save_notice',
--                   'admin_set_notice_status', 'admin_delete_notice');
--   -- 8 rows
-- select has_function_privilege('authenticated',
--   'notice_audience_matches(text[],text[],text[],text[],text,text,text,text)', 'execute');
--   -- false
--
-- Then, signed in as an ordinary member in the browser console:
--   await supabase.from('notices').select()              -- [] (no policies)
--   await supabase.rpc('admin_list_notices')             -- []
--   await supabase.rpc('admin_save_notice', { p_notice_id: null, p_title: 'x', p_body: 'y' })
--     -- error: Not an admin
