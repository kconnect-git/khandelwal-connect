-- Phase 11.1: paid-service access foundation (see phase-11-plan.md and
-- paywall-overview.md).
--
-- Four services become per-member monthly add-ons: directory, business,
-- events, matrimony. Payment is offline: a member requests access in the
-- app, the committee and the member settle it by email, and an admin or
-- moderator grants that one service for 1, 3 or 12 months.
--
--   * paid_service_settings: one row per paid service with an `enforced`
--     switch, OFF by default. While a service is off it behaves exactly as
--     before -- has_service_access() is true for everyone -- so 11.4-11.7
--     can ship their checks and a super admin turns each paywall on when the
--     committee is ready. No free first month: switching on locks everyone
--     without a grant (decided 2026-11-17).
--   * service_access_grants: one row per grant. Extending adds a new row
--     that starts where the current access ends, so the table is the
--     history. Revoking stamps revoked_at on every current and future grant
--     for that member + service.
--   * service_access_requests: "Request access" from the member. One open
--     request per member per service; granting closes it (status 'granted'),
--     or an admin dismisses it.
--   * has_service_access(person, service): THE check every gated RPC uses
--     (11.4-11.7). True when the service isn't enforced, the person is an
--     admin or moderator, or they hold an unrevoked grant covering now().
--     Not executable by clients -- only from definer functions.
--   * Admin RPCs: any admin (moderator or super_admin) can grant, extend,
--     revoke and dismiss; only a super_admin can flip a service's switch.
--     All are audited with target_type 'person' (or none, for the switch)
--     and action names prefixed 'access_' for the audit page's filter.
--   * All three tables are RPC-only (RLS on, no policies).
--   * Admin user ids (granted_by, revoked_by, handled_by, updated_by) are
--     auth user ids, like businesses.reviewed_by / verified_by.
--
-- ORDER OF DEPLOY: apply this, then the frontend (11.2 / 11.3 use it; 11.1
-- itself ships no UI).
--
-- Run manually in the Supabase SQL editor. Re-runnable.

-- ================================================================
-- tables
-- ================================================================

create table if not exists paid_service_settings (
  service text primary key
    check (service in ('directory', 'business', 'events', 'matrimony')),
  enforced boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

insert into paid_service_settings (service)
values ('directory'), ('business'), ('events'), ('matrimony')
on conflict (service) do nothing;

create table if not exists service_access_grants (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people(id) on delete cascade,
  service text not null references paid_service_settings(service),
  months int not null check (months in (1, 3, 12)),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  note text check (note is null or length(note) <= 500),
  granted_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users(id),
  revoke_note text check (revoke_note is null or length(revoke_note) <= 500),
  constraint service_access_grants_period_check check (ends_at > starts_at)
);

create index if not exists service_access_grants_person_idx
  on service_access_grants (person_id, service, ends_at desc);
create index if not exists service_access_grants_live_ends_idx
  on service_access_grants (ends_at) where revoked_at is null;

create table if not exists service_access_requests (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references people(id) on delete cascade,
  service text not null references paid_service_settings(service),
  message text check (message is null or length(message) <= 500),
  status text not null default 'open' check (status in ('open', 'granted', 'dismissed')),
  requested_at timestamptz not null default now(),
  handled_at timestamptz,
  handled_by uuid references auth.users(id),
  handled_note text check (handled_note is null or length(handled_note) <= 500)
);

create unique index if not exists service_access_requests_one_open_idx
  on service_access_requests (person_id, service) where status = 'open';
create index if not exists service_access_requests_status_idx
  on service_access_requests (status, requested_at);

alter table paid_service_settings enable row level security;
alter table service_access_grants enable row level security;
alter table service_access_requests enable row level security;

-- ================================================================
-- helpers (definer-only: no execute for clients)
-- ================================================================

-- When the member's current (or already-queued) access for a service runs
-- out; null when they have none. Grants chain end-to-start, so the latest
-- end of the live grants is the end of the whole run.
create or replace function service_access_ends_at(p_person_id uuid, p_service text)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select max(g.ends_at)
  from service_access_grants g
  where g.person_id = p_person_id
    and g.service = p_service
    and g.revoked_at is null
    and g.ends_at > now();
$$;

revoke all on function service_access_ends_at(uuid, text) from public;
-- Supabase grants execute to anon/authenticated directly on new functions,
-- so revoking from public alone leaves them callable.
revoke all on function service_access_ends_at(uuid, text) from anon, authenticated;

-- The one entitlement check. An unknown service name is treated as
-- enforced (locked), so a typo in a caller fails closed.
create or replace function has_service_access(p_person_id uuid, p_service text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    not coalesce((select s.enforced from paid_service_settings s where s.service = p_service), true)
    or exists (select 1 from people p
               join admins a on a.auth_user_id = p.auth_user_id
               where p.id = p_person_id)
    or exists (select 1 from service_access_grants g
               where g.person_id = p_person_id
                 and g.service = p_service
                 and g.revoked_at is null
                 and g.starts_at <= now()
                 and g.ends_at > now());
$$;

revoke all on function has_service_access(uuid, text) from public;
-- Supabase grants execute to anon/authenticated directly on new functions,
-- so revoking from public alone leaves them callable.
revoke all on function has_service_access(uuid, text) from anon, authenticated;

-- ================================================================
-- member RPCs
-- ================================================================

-- The caller's own access, one row per paid service, in a fixed order.
-- Empty for anyone who isn't an approved member.
--   has_access      -- what the gated RPCs will decide (includes "not
--                      enforced" and "is an admin")
--   ends_at         -- end of the live grant run, null if none
--   expired_at      -- end of the most recent grant that has run out
--                      (for "Expired on <date> -- request again")
--   open_request_at -- when the caller's open request was made, if any
create or replace function my_service_access()
returns table (
  service text,
  enforced boolean,
  has_access boolean,
  is_admin boolean,
  ends_at timestamptz,
  expired_at timestamptz,
  open_request_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select s.service,
         s.enforced,
         has_service_access(me.id, s.service),
         exists (select 1 from admins a where a.auth_user_id = auth.uid()),
         service_access_ends_at(me.id, s.service),
         (select max(g.ends_at) from service_access_grants g
          where g.person_id = me.id and g.service = s.service
            and g.revoked_at is null and g.ends_at <= now()),
         (select r.requested_at from service_access_requests r
          where r.person_id = me.id and r.service = s.service and r.status = 'open')
  from paid_service_settings s
  cross join (select p.id from people p
              where p.auth_user_id = auth.uid() and p.member_status = 'approved') me
  order by array_position(array['directory', 'business', 'events', 'matrimony'], s.service);
$$;

revoke all on function my_service_access() from public;
grant execute on function my_service_access() to authenticated;

-- "Request access". Allowed while the member already has access, so they
-- can ask to renew before it runs out. One open request per service.
create or replace function request_service_access(p_service text, p_message text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid;
  v_message text := nullif(trim(p_message), '');
  v_id uuid;
begin
  select id into v_me from people where auth_user_id = auth.uid() and member_status = 'approved';
  if v_me is null then
    raise exception 'Only approved members can request access';
  end if;
  if not exists (select 1 from paid_service_settings where service = p_service) then
    raise exception 'Unknown service';
  end if;
  if v_message is not null and length(v_message) > 500 then
    raise exception 'Keep the message under 500 characters';
  end if;

  begin
    insert into service_access_requests (person_id, service, message)
    values (v_me, p_service, v_message)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'You have already asked for this. The committee will email you.';
  end;

  return v_id;
end;
$$;

revoke all on function request_service_access(text, text) from public;
grant execute on function request_service_access(text, text) to authenticated;

-- ================================================================
-- admin RPCs: reads
-- ================================================================

-- Each paid service's switch, with how many members hold access and how
-- many requests are waiting.
create or replace function admin_list_service_settings()
returns table (
  service text,
  enforced boolean,
  updated_at timestamptz,
  updated_by_name text,
  active_members bigint,
  open_requests bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select s.service, s.enforced, s.updated_at,
         (select p.full_name from people p where p.auth_user_id = s.updated_by),
         (select count(distinct g.person_id) from service_access_grants g
          where g.service = s.service and g.revoked_at is null
            and g.starts_at <= now() and g.ends_at > now()),
         (select count(*) from service_access_requests r
          where r.service = s.service and r.status = 'open')
  from paid_service_settings s
  where is_admin()
  order by array_position(array['directory', 'business', 'events', 'matrimony'], s.service);
$$;

revoke all on function admin_list_service_settings() from public;
grant execute on function admin_list_service_settings() to authenticated;

-- The request queue. Open requests oldest first (it's a queue); granted /
-- dismissed newest-handled first. email is the login email, so the admin
-- can start the payment conversation.
create or replace function admin_list_access_requests(
  p_status text default 'open',
  p_service text default null,
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  id uuid,
  person_id uuid,
  full_name text,
  member_code text,
  profile_photo_url text,
  email text,
  mobile_number text,
  service text,
  message text,
  status text,
  requested_at timestamptz,
  handled_at timestamptz,
  handled_by_name text,
  handled_note text,
  access_ends_at timestamptz,
  total_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.person_id, p.full_name, p.member_code, p.profile_photo_url,
         u.email::text, p.mobile_number, r.service, r.message, r.status,
         r.requested_at, r.handled_at,
         (select h.full_name from people h where h.auth_user_id = r.handled_by),
         r.handled_note,
         service_access_ends_at(r.person_id, r.service),
         count(*) over ()
  from service_access_requests r
  join people p on p.id = r.person_id
  left join auth.users u on u.id = p.auth_user_id
  where is_admin()
    and r.status = coalesce(p_status, 'open')
    and (p_service is null or r.service = p_service)
  order by
    case when coalesce(p_status, 'open') = 'open' then r.requested_at end asc,
    case when coalesce(p_status, 'open') <> 'open' then r.handled_at end desc nulls last,
    r.id
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function admin_list_access_requests(text, text, int, int) from public;
grant execute on function admin_list_access_requests(text, text, int, int) to authenticated;

-- Members holding access right now, one row per member + service, soonest
-- to run out first. p_expiring_days narrows to those ending within N days.
create or replace function admin_list_service_access(
  p_service text default null,
  p_expiring_days int default null,
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  person_id uuid,
  full_name text,
  member_code text,
  profile_photo_url text,
  email text,
  mobile_number text,
  service text,
  ends_at timestamptz,
  last_granted_at timestamptz,
  total_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with live as (
    select g.person_id, g.service, max(g.ends_at) as ends_at, max(g.created_at) as last_granted_at
    from service_access_grants g
    where g.revoked_at is null
      and g.ends_at > now()
      and (p_service is null or g.service = p_service)
    group by g.person_id, g.service
    having bool_or(g.starts_at <= now())
  )
  select l.person_id, p.full_name, p.member_code, p.profile_photo_url,
         u.email::text, p.mobile_number, l.service, l.ends_at, l.last_granted_at,
         count(*) over ()
  from live l
  join people p on p.id = l.person_id
  left join auth.users u on u.id = p.auth_user_id
  where is_admin()
    and (p_expiring_days is null
         or l.ends_at <= now() + make_interval(days => greatest(p_expiring_days, 0)))
  order by l.ends_at, p.full_name, l.person_id, l.service
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function admin_list_service_access(text, int, int, int) from public;
grant execute on function admin_list_service_access(text, int, int, int) to authenticated;

-- One member's access per service, for the Access panel on member detail.
-- has_grant is about grants only (not "service is off" or "is an admin").
create or replace function admin_member_access(p_person_id uuid)
returns table (
  service text,
  enforced boolean,
  has_grant boolean,
  ends_at timestamptz,
  open_request_id uuid,
  open_request_at timestamptz,
  open_request_message text
)
language sql
stable
security definer
set search_path = public
as $$
  select s.service, s.enforced,
         exists (select 1 from service_access_grants g
                 where g.person_id = p_person_id and g.service = s.service
                   and g.revoked_at is null and g.starts_at <= now() and g.ends_at > now()),
         service_access_ends_at(p_person_id, s.service),
         r.id, r.requested_at, r.message
  from paid_service_settings s
  left join service_access_requests r
    on r.person_id = p_person_id and r.service = s.service and r.status = 'open'
  where is_admin()
  order by array_position(array['directory', 'business', 'events', 'matrimony'], s.service);
$$;

revoke all on function admin_member_access(uuid) from public;
grant execute on function admin_member_access(uuid) to authenticated;

-- Every grant a member has had, newest first.
create or replace function admin_member_access_history(p_person_id uuid)
returns table (
  id uuid,
  service text,
  months int,
  starts_at timestamptz,
  ends_at timestamptz,
  note text,
  granted_by_name text,
  created_at timestamptz,
  revoked_at timestamptz,
  revoked_by_name text,
  revoke_note text
)
language sql
stable
security definer
set search_path = public
as $$
  select g.id, g.service, g.months, g.starts_at, g.ends_at, g.note,
         (select p.full_name from people p where p.auth_user_id = g.granted_by),
         g.created_at, g.revoked_at,
         (select p.full_name from people p where p.auth_user_id = g.revoked_by),
         g.revoke_note
  from service_access_grants g
  where is_admin()
    and g.person_id = p_person_id
  order by g.created_at desc, g.id;
$$;

revoke all on function admin_member_access_history(uuid) from public;
grant execute on function admin_member_access_history(uuid) to authenticated;

-- ================================================================
-- admin RPCs: writes
-- ================================================================

-- Grant or extend. If the member already has live access the new period
-- starts where it ends (extension); otherwise it starts now. Works while
-- the service's switch is off, so access can be set up before launch.
-- Closes the member's open request for that service, if any. Returns the
-- new grant's id (11.2's "access granted" email reads it back).
create or replace function admin_grant_service_access(
  p_person_id uuid,
  p_service text,
  p_months int,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_note text := nullif(trim(p_note), '');
  v_status text;
  v_current_end timestamptz;
  v_start timestamptz;
  v_end timestamptz;
  v_id uuid;
  v_admin_person_id uuid;
begin
  if not is_admin() then
    raise exception 'Not an admin';
  end if;
  if not exists (select 1 from paid_service_settings where service = p_service) then
    raise exception 'Unknown service';
  end if;
  if p_months is null or p_months not in (1, 3, 12) then
    raise exception 'Pick 1, 3 or 12 months';
  end if;
  if v_note is not null and length(v_note) > 500 then
    raise exception 'Keep the note under 500 characters';
  end if;

  select member_status into v_status from people where id = p_person_id;
  if not found then
    raise exception 'Member not found';
  end if;
  if v_status <> 'approved' then
    raise exception 'Only approved members can be given access';
  end if;

  -- Two admins granting the same member + service at once must chain, not
  -- both start from the same end date.
  perform pg_advisory_xact_lock(hashtextextended(p_person_id::text || ':' || p_service, 0));

  v_current_end := service_access_ends_at(p_person_id, p_service);
  v_start := greatest(now(), coalesce(v_current_end, now()));
  v_end := v_start + make_interval(months => p_months);

  insert into service_access_grants (person_id, service, months, starts_at, ends_at, note, granted_by)
  values (p_person_id, p_service, p_months, v_start, v_end, v_note, auth.uid())
  returning id into v_id;

  update service_access_requests
  set status = 'granted', handled_at = now(), handled_by = auth.uid()
  where person_id = p_person_id and service = p_service and status = 'open';

  select id into v_admin_person_id from people where auth_user_id = auth.uid();
  insert into admin_audit_log (admin_id, action, target_type, target_id, notes)
  values (v_admin_person_id,
          case when v_current_end is null then 'access_granted' else 'access_extended' end,
          'person', p_person_id,
          concat_ws(' · ',
                    initcap(p_service),
                    p_months || case when p_months = 1 then ' month' else ' months' end,
                    'until ' || to_char(v_end at time zone 'Asia/Kolkata', 'DD Mon YYYY'),
                    v_note));

  return v_id;
end;
$$;

revoke all on function admin_grant_service_access(uuid, text, int, text) from public;
grant execute on function admin_grant_service_access(uuid, text, int, text) to authenticated;

-- Take a service away now: revokes every live or queued grant for that
-- member + service. Things the member already has keep working per the
-- lapse rule -- that is for the gated RPCs to honour, not this one.
create or replace function admin_revoke_service_access(
  p_person_id uuid,
  p_service text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_note text := nullif(trim(p_note), '');
  v_count int;
  v_admin_person_id uuid;
begin
  if not is_admin() then
    raise exception 'Not an admin';
  end if;
  if not exists (select 1 from paid_service_settings where service = p_service) then
    raise exception 'Unknown service';
  end if;
  if v_note is not null and length(v_note) > 500 then
    raise exception 'Keep the note under 500 characters';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_person_id::text || ':' || p_service, 0));

  update service_access_grants
  set revoked_at = now(), revoked_by = auth.uid(), revoke_note = v_note
  where person_id = p_person_id
    and service = p_service
    and revoked_at is null
    and ends_at > now();
  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'This member has no % access to remove', initcap(p_service);
  end if;

  select id into v_admin_person_id from people where auth_user_id = auth.uid();
  insert into admin_audit_log (admin_id, action, target_type, target_id, notes)
  values (v_admin_person_id, 'access_revoked', 'person', p_person_id,
          concat_ws(' · ', initcap(p_service), v_note));
end;
$$;

revoke all on function admin_revoke_service_access(uuid, text, text) from public;
grant execute on function admin_revoke_service_access(uuid, text, text) to authenticated;

-- Close a request without granting (didn't pay, duplicate, etc.). The
-- member can ask again.
create or replace function admin_dismiss_access_request(p_request_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_note text := nullif(trim(p_note), '');
  v_person_id uuid;
  v_service text;
  v_admin_person_id uuid;
begin
  if not is_admin() then
    raise exception 'Not an admin';
  end if;
  if v_note is not null and length(v_note) > 500 then
    raise exception 'Keep the note under 500 characters';
  end if;

  update service_access_requests
  set status = 'dismissed', handled_at = now(), handled_by = auth.uid(), handled_note = v_note
  where id = p_request_id and status = 'open'
  returning person_id, service into v_person_id, v_service;
  if v_person_id is null then
    raise exception 'This request has already been handled';
  end if;

  select id into v_admin_person_id from people where auth_user_id = auth.uid();
  insert into admin_audit_log (admin_id, action, target_type, target_id, notes)
  values (v_admin_person_id, 'access_request_dismissed', 'person', v_person_id,
          concat_ws(' · ', initcap(v_service), v_note));
end;
$$;

revoke all on function admin_dismiss_access_request(uuid, text) from public;
grant execute on function admin_dismiss_access_request(uuid, text) to authenticated;

-- Turn a service's paywall on or off. Super admin only.
create or replace function admin_set_service_enforced(p_service text, p_enforced boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current boolean;
  v_admin_person_id uuid;
begin
  if coalesce(admin_role(), '') <> 'super_admin' then
    raise exception 'Only a super admin can turn a paywall on or off';
  end if;
  if p_enforced is null then
    raise exception 'Say whether to turn the paywall on or off';
  end if;

  select enforced into v_current from paid_service_settings where service = p_service for update;
  if not found then
    raise exception 'Unknown service';
  end if;
  if v_current = p_enforced then
    raise exception 'The % paywall is already %', initcap(p_service),
      case when p_enforced then 'on' else 'off' end;
  end if;

  update paid_service_settings
  set enforced = p_enforced, updated_at = now(), updated_by = auth.uid()
  where service = p_service;

  select id into v_admin_person_id from people where auth_user_id = auth.uid();
  insert into admin_audit_log (admin_id, action, target_type, target_id, notes)
  values (v_admin_person_id,
          case when p_enforced then 'access_service_enforced' else 'access_service_unenforced' end,
          null, null, initcap(p_service));
end;
$$;

revoke all on function admin_set_service_enforced(text, boolean) from public;
grant execute on function admin_set_service_enforced(text, boolean) to authenticated;

-- ================================================================
-- admin_overview_stats: + access_requests_open
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
    'businesses_hidden', (select count(*) from businesses where is_hidden),
    'businesses_pending', (select count(*) from businesses where review_status = 'pending'),
    'notices_active', (select count(*) from notices
                       where status = 'published' and (expires_at is null or expires_at > now())),
    'matrimony_pending', (select count(*) from matrimony_profiles where status = 'pending'),
    'matrimony_approved', (select count(*) from matrimony_profiles where status = 'approved'),
    'matrimony_reports_open', (select count(*) from matrimony_reports where status = 'open'),
    'business_reports_open', (select count(*) from business_reports where status = 'open'),
    'access_requests_open', (select count(*) from service_access_requests where status = 'open')
  )
  where is_admin();
$$;

revoke all on function admin_overview_stats() from public;
grant execute on function admin_overview_stats() to authenticated;

-- ================================================================
-- verification (run these after applying)
-- ================================================================
-- select service, enforced from paid_service_settings order by service;
--   -- 4 rows, all false
-- select relname, relrowsecurity from pg_class
-- where relname in ('paid_service_settings', 'service_access_grants', 'service_access_requests');
--   -- 3 rows, all true
-- select proname, count(*) from pg_proc
-- where proname in ('service_access_ends_at', 'has_service_access', 'my_service_access',
--                   'request_service_access', 'admin_list_service_settings',
--                   'admin_list_access_requests', 'admin_list_service_access',
--                   'admin_member_access', 'admin_member_access_history',
--                   'admin_grant_service_access', 'admin_revoke_service_access',
--                   'admin_dismiss_access_request', 'admin_set_service_enforced')
-- group by proname;
--   -- 13 rows, each count 1
--
-- Then, signed in as a member (not an admin) in the browser console:
--   await supabase.from('service_access_grants').select()             -- [] (no policies)
--   await supabase.rpc('has_service_access', { p_person_id: '<id>', p_service: 'matrimony' })
--     -- error: permission denied (definer-only)
--   await supabase.rpc('my_service_access')
--     -- 4 rows, enforced false, has_access true
--   await supabase.rpc('request_service_access', { p_service: 'matrimony' })   -- a uuid
--   await supabase.rpc('request_service_access', { p_service: 'matrimony' })
--     -- error: You have already asked for this...
--   await supabase.rpc('admin_grant_service_access', { ... })        -- error: Not an admin
--
-- And as an admin:
--   await supabase.rpc('admin_list_access_requests', {})              -- the request above
--   await supabase.rpc('admin_grant_service_access',
--     { p_person_id: '<member>', p_service: 'matrimony', p_months: 1 }) -- a uuid; request -> granted
--   (again, p_months: 3)  -- starts where the first ends; audit says access_extended
--   await supabase.rpc('admin_member_access', { p_person_id: '<member>' })
--     -- matrimony: has_grant true, ends_at ~4 months out
--   await supabase.rpc('admin_set_service_enforced', { p_service: 'matrimony', p_enforced: true })
--     -- moderator: error; super_admin: ok. Turn it back off before 11.7 ships.
