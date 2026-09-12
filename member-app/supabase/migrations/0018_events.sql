-- Phase 4: events.
--
-- `events` and `rsvps` have existed since Phase 0 (RLS enabled, zero
-- policies, nothing in the app reads them). This migration makes them real:
--
--   * Any onboarded member can create an event. It starts as `pending` and
--     only an admin can move it to `approved` (or `rejected`, with a reason).
--     Approved events are what members see; creators see their own at any
--     status. Either side can `cancel`.
--   * visibility: `members` (every onboarded member can see + join) or
--     `invite_only` (only the creator, admins, and people on event_invites
--     can see it -- get_event returns nothing to anyone else, same as a
--     missing business).
--   * Invitees can be added only once the event is approved, and adding one
--     does NOT email them -- that's a separate explicit action (the
--     send-event-invite Edge Function), tracked by event_invites.emailed_at.
--   * After approval the creator can edit only the description; a pending or
--     rejected event is fully editable and saving it resubmits as pending.
--   * RSVP = a row in rsvps with status going / not_going. Leaving flips the
--     status, never deletes, so counts stay honest. Capacity and the
--     invite-only check are enforced inside rsvp_event under a row lock.
--
-- Access model -- a deliberate departure from businesses (0014). There,
-- owner writes go straight to the table under RLS. Here every invariant is
-- conditional or cross-row (status forced to pending, locked fields after
-- approval, invitees only after approval, capacity, admin gating), which RLS
-- `with check` can't express without a trigger. So: NO insert/update/delete
-- policies on events / rsvps / event_invites / admins at all -- every write
-- is a SECURITY DEFINER plpgsql RPC below. Only narrow `select` policies
-- exist as a safety net; the app reads through RPCs anyway because cards
-- need the creator's name/photo from `people`, which stays self-only.
-- Directory-tier columns only (full_name, profile_photo_url, member_code)
-- are ever exposed for another member, same as 0010.
--
-- Admins: a plain `admins` table keyed by auth user id plus is_admin().
-- Phase 5's console builds on this; seed it by hand (see the end of the
-- file). There is no admin UI beyond the bare /admin/events page.
--
-- Pre-check before applying: `select count(*) from events;` must be 0
-- (Phase 0 never inserted anything). If it isn't, delete the placeholder
-- rows first -- creator_id is added NOT NULL.
--
-- Run manually in the Supabase SQL editor -- this repo's migrations are not
-- wired to a runner (see 0001_init.sql).

-- ================================================================
-- tables
-- ================================================================

alter table events rename column event_date to starts_at;
alter table events rename column location to venue;

alter table events
  add column creator_id uuid references people(id) not null,
  add column ends_at timestamptz,
  add column city text,
  add column state text,
  add column visibility text not null default 'members'
    check (visibility in ('members', 'invite_only')),
  add column status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  add column rejection_reason text,
  add column approved_by uuid references auth.users(id),
  add column approved_at timestamptz,
  add column updated_at timestamptz default now(),
  add constraint events_capacity_check check (capacity is null or capacity > 0),
  add constraint events_ends_after_starts check (ends_at is null or ends_at >= starts_at);

create index events_status_visibility_starts_idx on events (status, visibility, starts_at);
create index events_creator_id_idx on events (creator_id);

alter table rsvps
  add column updated_at timestamptz default now(),
  add constraint rsvps_status_check check (status in ('going', 'not_going'));

create index rsvps_person_id_idx on rsvps (person_id);
create index rsvps_event_going_idx on rsvps (event_id) where status = 'going';

create table event_invites (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) on delete cascade not null,
  person_id uuid references people(id) not null,
  invited_by uuid references people(id) not null,
  emailed_at timestamptz,
  created_at timestamptz default now(),
  unique (event_id, person_id)
);

create index event_invites_person_id_idx on event_invites (person_id);

create table admins (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz default now()
);

alter table event_invites enable row level security;
alter table admins enable row level security;

-- ================================================================
-- is_admin + select-only RLS
-- ================================================================

-- admins has no policies at all: this definer function is the only reader.
create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from admins where auth_user_id = auth.uid());
$$;

revoke all on function is_admin() from public;
grant execute on function is_admin() to authenticated;

-- Safety-net reads only. Nothing in the app selects these tables directly.
create policy "events visible read" on events for select
  using (
    (status in ('approved', 'cancelled') and visibility = 'members'
       and exists (select 1 from people where auth_user_id = auth.uid() and member_code is not null))
    or creator_id in (select id from people where auth_user_id = auth.uid())
    or exists (select 1 from event_invites i join people p on p.id = i.person_id
               where i.event_id = events.id and p.auth_user_id = auth.uid())
    or is_admin()
  );

create policy "own rsvps read" on rsvps for select
  using (person_id in (select id from people where auth_user_id = auth.uid()));

create policy "own invites read" on event_invites for select
  using (person_id in (select id from people where auth_user_id = auth.uid())
         or invited_by in (select id from people where auth_user_id = auth.uid()));

-- ================================================================
-- read RPCs
-- ================================================================
-- Every list returns the same "card" columns: the event, the creator's
-- directory-tier fields, the live going count, and the caller's own RSVP
-- status. `me` is the caller's onboarded person row; a caller without one
-- gets zero rows (cross join on an empty CTE).

-- Members' event list. p_mode:
--   upcoming   approved, members-visible, not ended        (starts_at asc)
--   registered approved, caller is going, not ended        (any visibility)
--   past       approved, ended, members-visible or caller went (starts_at desc)
create or replace function list_events(
  p_mode text default 'upcoming',
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
  total_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select id from people where auth_user_id = auth.uid() and member_code is not null
  )
  select e.id, e.title, e.description, e.starts_at, e.ends_at,
         e.venue, e.city, e.state, e.capacity, e.visibility, e.status,
         p.id, p.full_name, p.profile_photo_url, p.member_code,
         (select count(*) from rsvps r where r.event_id = e.id and r.status = 'going'),
         (select r.status from rsvps r where r.event_id = e.id and r.person_id = me.id),
         count(*) over ()
  from events e
  join people p on p.id = e.creator_id
  cross join me
  where e.status = 'approved'
    and case p_mode
          when 'upcoming' then
            e.visibility = 'members'
            and coalesce(e.ends_at, e.starts_at) >= now()
          when 'registered' then
            coalesce(e.ends_at, e.starts_at) >= now()
            and exists (select 1 from rsvps r
                        where r.event_id = e.id and r.person_id = me.id and r.status = 'going')
          when 'past' then
            coalesce(e.ends_at, e.starts_at) < now()
            and (e.visibility = 'members'
                 or exists (select 1 from rsvps r
                            where r.event_id = e.id and r.person_id = me.id and r.status = 'going'))
          else false
        end
  order by case when p_mode = 'past' then e.starts_at end desc,
           e.starts_at asc, e.id asc
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function list_events(text, int, int) from public;
grant execute on function list_events(text, int, int) to authenticated;

-- "My events": created by me (any status), invited to (once approved), or
-- joined (members-visible events I'm going to). One row per event, with
-- `relation` saying which -- created wins over invited wins over joined.
-- rejection_reason only travels with the caller's own events.
create or replace function list_my_events()
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
  relation text
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select id from people where auth_user_id = auth.uid() and member_code is not null
  ),
  mine as (
    select e.id as event_id, 'created' as relation, 1 as prio
    from events e cross join me
    where e.creator_id = me.id
    union all
    select i.event_id, 'invited', 2
    from event_invites i
    join events e on e.id = i.event_id
    cross join me
    where i.person_id = me.id and e.status in ('approved', 'cancelled')
    union all
    select r.event_id, 'joined', 3
    from rsvps r
    join events e on e.id = r.event_id
    cross join me
    where r.person_id = me.id and r.status = 'going'
      and e.visibility = 'members' and e.creator_id <> me.id
  ),
  picked as (
    select distinct on (event_id) event_id, relation
    from mine
    order by event_id, prio
  )
  select e.id, e.title, e.description, e.starts_at, e.ends_at,
         e.venue, e.city, e.state, e.capacity, e.visibility, e.status,
         p.id, p.full_name, p.profile_photo_url, p.member_code,
         (select count(*) from rsvps r where r.event_id = e.id and r.status = 'going'),
         (select r.status from rsvps r where r.event_id = e.id and r.person_id = me.id),
         case when picked.relation = 'created' then e.rejection_reason end,
         picked.relation
  from picked
  join events e on e.id = picked.event_id
  join people p on p.id = e.creator_id
  cross join me
  order by (coalesce(e.ends_at, e.starts_at) < now()) asc, e.starts_at asc, e.id asc;
$$;

revoke all on function list_my_events() from public;
grant execute on function list_my_events() to authenticated;

-- One event, plus the flags the detail page needs. Zero rows unless the
-- caller may see it: approved/cancelled members-visible, or they're the
-- creator, an invitee, or an admin. Pending/rejected invite-only events are
-- invisible to invitees (they can't exist yet -- invites come after
-- approval) and pending members events are creator/admin only.
create or replace function get_event(p_event_id uuid)
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
  approved_at timestamptz,
  created_at timestamptz,
  is_creator boolean,
  is_invited boolean,
  is_admin boolean,
  can_edit_all boolean,
  can_edit_description boolean,
  can_manage_invitees boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with ctx as (
    select (select id from people where auth_user_id = auth.uid() and member_code is not null) as me_id,
           is_admin() as admin
  )
  select e.id, e.title, e.description, e.starts_at, e.ends_at,
         e.venue, e.city, e.state, e.capacity, e.visibility, e.status,
         p.id, p.full_name, p.profile_photo_url, p.member_code,
         (select count(*) from rsvps r where r.event_id = e.id and r.status = 'going'),
         (select r.status from rsvps r where r.event_id = e.id and r.person_id = ctx.me_id),
         case when e.creator_id = ctx.me_id or ctx.admin then e.rejection_reason end,
         e.approved_at,
         e.created_at,
         e.creator_id = ctx.me_id,
         exists (select 1 from event_invites i where i.event_id = e.id and i.person_id = ctx.me_id),
         ctx.admin,
         e.creator_id = ctx.me_id and e.status in ('pending', 'rejected'),
         e.creator_id = ctx.me_id and e.status = 'approved',
         e.creator_id = ctx.me_id and e.status = 'approved'
  from events e
  join people p on p.id = e.creator_id
  cross join ctx
  where e.id = p_event_id
    and ctx.me_id is not null
    and (
      (e.status in ('approved', 'cancelled') and e.visibility = 'members')
      or e.creator_id = ctx.me_id
      or (e.status in ('approved', 'cancelled')
          and exists (select 1 from event_invites i where i.event_id = e.id and i.person_id = ctx.me_id))
      or ctx.admin
    );
$$;

revoke all on function get_event(uuid) from public;
grant execute on function get_event(uuid) to authenticated;

-- Invitee list for the creator (or an admin). Directory tier only.
create or replace function list_event_invitees(p_event_id uuid)
returns table (
  person_id uuid,
  full_name text,
  profile_photo_url text,
  member_code text,
  emailed_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select id from people where auth_user_id = auth.uid() and member_code is not null
  )
  select i.person_id, p.full_name, p.profile_photo_url, p.member_code, i.emailed_at, i.created_at
  from event_invites i
  join events e on e.id = i.event_id
  join people p on p.id = i.person_id
  cross join me
  where i.event_id = p_event_id
    and (e.creator_id = me.id or is_admin())
  order by i.created_at asc, i.id asc;
$$;

revoke all on function list_event_invitees(uuid) from public;
grant execute on function list_event_invitees(uuid) to authenticated;

-- Admin queue. Same card columns plus rejection_reason and total_count.
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
    select id from people where auth_user_id = auth.uid() and member_code is not null
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
  cross join me
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
-- write RPCs
-- ================================================================

-- Shared validation for the editable fields. Raises with a user-facing
-- message; returns nothing.
create or replace function check_event_fields(
  p_title text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_capacity int,
  p_visibility text
)
returns void
language plpgsql
immutable
as $$
begin
  if p_title is null or length(trim(p_title)) = 0 then
    raise exception 'Please give the event a title';
  end if;
  if p_starts_at is null then
    raise exception 'Please pick a start date and time';
  end if;
  if p_ends_at is not null and p_ends_at < p_starts_at then
    raise exception 'The end time must be after the start time';
  end if;
  if p_capacity is not null and p_capacity <= 0 then
    raise exception 'Capacity must be a positive number, or left blank';
  end if;
  if p_visibility not in ('members', 'invite_only') then
    raise exception 'Invalid visibility: %', p_visibility;
  end if;
end;
$$;

revoke all on function check_event_fields(text, timestamptz, timestamptz, int, text) from public;

-- Create. Always lands as `pending` -- status is never a parameter.
create or replace function save_event(
  p_title text,
  p_description text default null,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null,
  p_venue text default null,
  p_city text default null,
  p_state text default null,
  p_capacity int default null,
  p_visibility text default 'members'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_self_id uuid;
  v_new_id uuid;
begin
  select id into v_self_id from people where auth_user_id = auth.uid() and member_code is not null;
  if v_self_id is null then
    raise exception 'Complete your profile before creating an event';
  end if;

  perform check_event_fields(p_title, p_starts_at, p_ends_at, p_capacity, p_visibility);
  if p_starts_at <= now() then
    raise exception 'The event must start in the future';
  end if;

  insert into events (creator_id, title, description, starts_at, ends_at,
                      venue, city, state, capacity, visibility, status)
  values (v_self_id, trim(p_title), nullif(trim(p_description), ''), p_starts_at, p_ends_at,
          nullif(trim(p_venue), ''), nullif(trim(p_city), ''), nullif(trim(p_state), ''),
          p_capacity, p_visibility, 'pending')
  returning id into v_new_id;

  return v_new_id;
end;
$$;

revoke all on function save_event(text, text, timestamptz, timestamptz, text, text, text, int, text) from public;
grant execute on function save_event(text, text, timestamptz, timestamptz, text, text, text, int, text) to authenticated;

-- Edit. Creator only.
--   approved          -> only description changes; every other parameter is
--                        ignored (so the client can send the whole form).
--   pending/rejected  -> everything changes and the event goes back to
--                        pending with the rejection reason cleared.
--   cancelled         -> refused.
create or replace function update_event(
  p_event_id uuid,
  p_title text,
  p_description text default null,
  p_starts_at timestamptz default null,
  p_ends_at timestamptz default null,
  p_venue text default null,
  p_city text default null,
  p_state text default null,
  p_capacity int default null,
  p_visibility text default 'members'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_self_id uuid;
  v_event events%rowtype;
begin
  select id into v_self_id from people where auth_user_id = auth.uid() and member_code is not null;
  if v_self_id is null then
    raise exception 'No person row for the current user';
  end if;

  select * into v_event from events where id = p_event_id for update;
  if not found or v_event.creator_id <> v_self_id then
    raise exception 'Event not found';
  end if;

  if v_event.status = 'cancelled' then
    raise exception 'A cancelled event cannot be edited';
  end if;

  if v_event.status = 'approved' then
    update events
    set description = nullif(trim(p_description), ''),
        updated_at = now()
    where id = p_event_id;
    return;
  end if;

  perform check_event_fields(p_title, p_starts_at, p_ends_at, p_capacity, p_visibility);
  if p_starts_at <= now() then
    raise exception 'The event must start in the future';
  end if;

  update events
  set title = trim(p_title),
      description = nullif(trim(p_description), ''),
      starts_at = p_starts_at,
      ends_at = p_ends_at,
      venue = nullif(trim(p_venue), ''),
      city = nullif(trim(p_city), ''),
      state = nullif(trim(p_state), ''),
      capacity = p_capacity,
      visibility = p_visibility,
      status = 'pending',
      rejection_reason = null,
      updated_at = now()
  where id = p_event_id;
end;
$$;

revoke all on function update_event(uuid, text, text, timestamptz, timestamptz, text, text, text, int, text) from public;
grant execute on function update_event(uuid, text, text, timestamptz, timestamptz, text, text, text, int, text) to authenticated;

-- Creator or admin.
create or replace function cancel_event(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_self_id uuid;
  v_event events%rowtype;
begin
  select id into v_self_id from people where auth_user_id = auth.uid() and member_code is not null;
  if v_self_id is null then
    raise exception 'No person row for the current user';
  end if;

  select * into v_event from events where id = p_event_id for update;
  if not found or (v_event.creator_id <> v_self_id and not is_admin()) then
    raise exception 'Event not found';
  end if;
  if v_event.status = 'cancelled' then
    raise exception 'This event is already cancelled';
  end if;

  update events set status = 'cancelled', updated_at = now() where id = p_event_id;
end;
$$;

revoke all on function cancel_event(uuid) from public;
grant execute on function cancel_event(uuid) to authenticated;

-- Join / leave. Returns the new going count so the page can show it without
-- a refetch. The event row is locked for the duration so two people can't
-- both squeeze into the last seat.
create or replace function rsvp_event(p_event_id uuid, p_status text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_self_id uuid;
  v_event events%rowtype;
  v_going bigint;
begin
  if p_status not in ('going', 'not_going') then
    raise exception 'Invalid RSVP status: %', p_status;
  end if;

  select id into v_self_id from people where auth_user_id = auth.uid() and member_code is not null;
  if v_self_id is null then
    raise exception 'Complete your profile before joining an event';
  end if;

  select * into v_event from events where id = p_event_id for update;
  if not found then
    raise exception 'Event not found';
  end if;
  if v_event.status <> 'approved' then
    raise exception 'This event is not open for RSVPs';
  end if;
  if coalesce(v_event.ends_at, v_event.starts_at) < now() then
    raise exception 'This event has already ended';
  end if;

  if p_status = 'going' then
    if v_event.visibility = 'invite_only'
       and v_event.creator_id <> v_self_id
       and not exists (select 1 from event_invites i
                       where i.event_id = p_event_id and i.person_id = v_self_id) then
      raise exception 'This event is invite only';
    end if;

    if v_event.capacity is not null then
      select count(*) into v_going from rsvps
      where event_id = p_event_id and status = 'going' and person_id <> v_self_id;
      if v_going >= v_event.capacity then
        raise exception 'This event is full';
      end if;
    end if;

    insert into rsvps (event_id, person_id, status)
    values (p_event_id, v_self_id, 'going')
    on conflict (event_id, person_id) do update
      set status = 'going', updated_at = now();
  else
    update rsvps set status = 'not_going', updated_at = now()
    where event_id = p_event_id and person_id = v_self_id;
  end if;

  select count(*) into v_going from rsvps where event_id = p_event_id and status = 'going';
  return v_going;
end;
$$;

revoke all on function rsvp_event(uuid, text) from public;
grant execute on function rsvp_event(uuid, text) to authenticated;

-- Creator only, approved events only. Idempotent.
create or replace function add_event_invitee(p_event_id uuid, p_person_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_self_id uuid;
  v_event events%rowtype;
begin
  select id into v_self_id from people where auth_user_id = auth.uid() and member_code is not null;
  if v_self_id is null then
    raise exception 'No person row for the current user';
  end if;

  select * into v_event from events where id = p_event_id;
  if not found or v_event.creator_id <> v_self_id then
    raise exception 'Event not found';
  end if;
  if v_event.status <> 'approved' then
    raise exception 'Invitees can be added once the event is approved';
  end if;
  if p_person_id = v_self_id then
    raise exception 'You are the organiser -- no need to invite yourself';
  end if;
  if not exists (select 1 from people where id = p_person_id and member_code is not null) then
    raise exception 'No registered member found';
  end if;

  insert into event_invites (event_id, person_id, invited_by)
  values (p_event_id, p_person_id, v_self_id)
  on conflict (event_id, person_id) do nothing;
end;
$$;

revoke all on function add_event_invitee(uuid, uuid) from public;
grant execute on function add_event_invitee(uuid, uuid) to authenticated;

-- Creator only. On an invite-only event the person no longer qualifies, so
-- their RSVP (if any) is flipped to not_going as well.
create or replace function remove_event_invitee(p_event_id uuid, p_person_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_self_id uuid;
  v_event events%rowtype;
begin
  select id into v_self_id from people where auth_user_id = auth.uid() and member_code is not null;
  if v_self_id is null then
    raise exception 'No person row for the current user';
  end if;

  select * into v_event from events where id = p_event_id;
  if not found or v_event.creator_id <> v_self_id then
    raise exception 'Event not found';
  end if;

  delete from event_invites where event_id = p_event_id and person_id = p_person_id;
  if not found then
    raise exception 'Invitee not found';
  end if;

  if v_event.visibility = 'invite_only' then
    update rsvps set status = 'not_going', updated_at = now()
    where event_id = p_event_id and person_id = p_person_id and status = 'going';
  end if;
end;
$$;

revoke all on function remove_event_invitee(uuid, uuid) from public;
grant execute on function remove_event_invitee(uuid, uuid) to authenticated;

-- Admin moderation. approved/rejected only from pending; cancelled from
-- anything but cancelled. Every call is written to admin_audit_log.
create or replace function admin_set_event_status(
  p_event_id uuid,
  p_status text,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event events%rowtype;
  v_admin_person_id uuid;
begin
  if not is_admin() then
    raise exception 'Not an admin';
  end if;
  if p_status not in ('approved', 'rejected', 'cancelled') then
    raise exception 'Invalid status: %', p_status;
  end if;

  select * into v_event from events where id = p_event_id for update;
  if not found then
    raise exception 'Event not found';
  end if;

  if p_status = 'approved' then
    if v_event.status <> 'pending' then
      raise exception 'Only a pending event can be approved';
    end if;
    update events
    set status = 'approved', approved_by = auth.uid(), approved_at = now(),
        rejection_reason = null, updated_at = now()
    where id = p_event_id;
  elsif p_status = 'rejected' then
    if v_event.status <> 'pending' then
      raise exception 'Only a pending event can be rejected';
    end if;
    if p_reason is null or length(trim(p_reason)) = 0 then
      raise exception 'Please give a reason for rejecting';
    end if;
    update events
    set status = 'rejected', rejection_reason = trim(p_reason), updated_at = now()
    where id = p_event_id;
  else
    if v_event.status = 'cancelled' then
      raise exception 'This event is already cancelled';
    end if;
    update events set status = 'cancelled', updated_at = now() where id = p_event_id;
  end if;

  select id into v_admin_person_id from people where auth_user_id = auth.uid();
  insert into admin_audit_log (admin_id, action, target_type, target_id, notes)
  values (v_admin_person_id, 'event_' || p_status, 'event', p_event_id, nullif(trim(p_reason), ''));
end;
$$;

revoke all on function admin_set_event_status(uuid, text, text) from public;
grant execute on function admin_set_event_status(uuid, text, text) to authenticated;

-- ================================================================
-- seed an admin (run separately, once per admin account)
-- ================================================================
-- insert into admins (auth_user_id)
-- select id from auth.users where email = 'admin@example.com';
