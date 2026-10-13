-- Phase 6c: matrimony safety -- pause, un-match, block, report, admin hide,
-- delete my profile.
--
--   * matrimony_profiles.status gains 'paused' (owner: out of browse, existing
--     matches keep working) and 'hidden' (admin, with a reason the owner sees).
--   * matrimony_interests.status gains 'ended' (un-match, by either side):
--     photos and contact re-lock, the pair drops out of each other's browse,
--     and neither can send interest again.
--   * A match now only counts while BOTH profiles are active: approved or
--     paused, and the member still eligible (matrimony_profile_active). So
--     marrying, being hidden or being turned down suspends that member's
--     matches -- reversibly: unhiding brings them back. This settles the
--     "matched access outlives eligibility" gap left by 0024.
--   * matrimony_blocks is keyed on PEOPLE, not profiles, so deleting and
--     recreating a matrimony profile doesn't escape a block. Blocking ends a
--     match and clears pending interests between the pair; both directions
--     disappear from browse, detail and interests.
--   * matrimony_reports, also keyed on people so a report survives the
--     reported profile being deleted. Admins see the reporter; the reported
--     member never does. One open report per reporter per member.
--   * delete_my_matrimony_profile -- the way out of a rejected profile, too.
--   * Admin: admin_list_matrimony_reports, admin_resolve_matrimony_report,
--     admin_set_matrimony_hidden (all audited). admin_overview_stats gains
--     matrimony_reports_open; admin_list_audit_log resolves 'matrimony_report'.
--
-- ORDER OF DEPLOY: 0023 and 0024 applied first. Apply this, then the frontend.
-- Re-runnable: tables are created if missing, policies/constraints dropped
-- before being re-added, functions are create-or-replace.
--
-- Run manually in the Supabase SQL editor -- this repo's migrations are not
-- wired to a runner (see 0001_init.sql).
--
-- Function bodies below are extracted verbatim from ddl/core_schema.sql.

-- ================================================================
-- tables
-- ================================================================

alter table matrimony_profiles drop constraint if exists matrimony_profiles_status_check;
alter table matrimony_profiles add constraint matrimony_profiles_status_check
  check (status in ('draft', 'pending', 'changes_requested', 'approved', 'rejected',
                    'paused', 'hidden'));

alter table matrimony_interests drop constraint if exists matrimony_interests_status_check;
alter table matrimony_interests add constraint matrimony_interests_status_check
  check (status in ('pending', 'accepted', 'declined', 'withdrawn', 'ended'));
alter table matrimony_interests
  add column if not exists ended_by_profile_id uuid references matrimony_profiles(id) on delete set null,
  add column if not exists ended_at timestamptz;

-- Who has blocked whom. People, not profiles: survives a profile being
-- deleted and recreated.
create table if not exists matrimony_blocks (
  blocker_person_id uuid not null references people(id) on delete cascade,
  blocked_person_id uuid not null references people(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_person_id, blocked_person_id),
  constraint matrimony_blocks_not_self check (blocker_person_id <> blocked_person_id)
);

create index if not exists matrimony_blocks_blocked_idx on matrimony_blocks (blocked_person_id);

create table if not exists matrimony_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_person_id uuid not null references people(id) on delete cascade,
  reported_person_id uuid not null references people(id) on delete cascade,
  reason text not null check (reason in ('Fake profile', 'Inappropriate content',
                                          'Already married', 'Harassment', 'Other')),
  details text check (details is null or length(details) <= 1000),
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolution_note text,
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists matrimony_reports_one_open_idx
  on matrimony_reports (reporter_person_id, reported_person_id) where status = 'open';
create index if not exists matrimony_reports_status_idx on matrimony_reports (status, created_at);

alter table matrimony_blocks enable row level security;
alter table matrimony_reports enable row level security;

-- ================================================================
-- existing functions that learn about 6c
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
           when 'matrimony_profile' then (select t.full_name from matrimony_profiles m
                                          join people t on t.id = m.person_id
                                          where m.id = a.target_id)
           when 'matrimony_report' then (select t.full_name from matrimony_reports r
                                         join people t on t.id = r.reported_person_id
                                         where r.id = a.target_id)
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
                       where status = 'published' and (expires_at is null or expires_at > now())),
    'matrimony_pending', (select count(*) from matrimony_profiles where status = 'pending'),
    'matrimony_approved', (select count(*) from matrimony_profiles where status = 'approved'),
    'matrimony_reports_open', (select count(*) from matrimony_reports where status = 'open')
  )
  where is_admin();
$$;

revoke all on function admin_overview_stats() from public;
grant execute on function admin_overview_stats() to authenticated;

-- (6c) An approved or paused profile can also be sent back or turned down.
-- A hidden one goes through admin_set_matrimony_hidden instead.
create or replace function admin_set_matrimony_status(
  p_profile_id uuid,
  p_status text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile matrimony_profiles%rowtype;
  v_person people%rowtype;
  v_reason text;
  v_note text := nullif(trim(p_note), '');
  v_admin_person_id uuid;
begin
  if not is_admin() then
    raise exception 'Not an admin';
  end if;
  if p_status not in ('approved', 'changes_requested', 'rejected') then
    raise exception 'Invalid status: %', p_status;
  end if;
  if p_status <> 'approved' and v_note is null then
    raise exception 'Please tell the member why';
  end if;

  select * into v_profile from matrimony_profiles where id = p_profile_id for update;
  if not found then
    raise exception 'Profile not found';
  end if;
  if not (v_profile.status = 'pending'
          or (v_profile.status in ('approved', 'paused') and p_status <> 'approved')) then
    raise exception 'This profile is not awaiting review';
  end if;

  if p_status = 'approved' then
    select * into v_person from people where id = v_profile.person_id;
    v_reason := matrimony_ineligible_reason(v_person.member_status, v_person.dob,
                                            v_person.gender, v_person.marital_status);
    if v_reason is not null then
      raise exception 'Not eligible: %', v_reason;
    end if;
  end if;

  update matrimony_profiles
  set status = p_status,
      review_note = case when p_status = 'approved' then null else v_note end,
      reviewed_at = now(), reviewed_by = auth.uid(), updated_at = now()
  where id = p_profile_id;

  select id into v_admin_person_id from people where auth_user_id = auth.uid();
  insert into admin_audit_log (admin_id, action, target_type, target_id, notes)
  values (v_admin_person_id, 'matrimony_' || p_status, 'matrimony_profile', p_profile_id, v_note);
end;
$$;

revoke all on function admin_set_matrimony_status(uuid, text, text) from public;
grant execute on function admin_set_matrimony_status(uuid, text, text) to authenticated;

-- ================================================================
-- Phase 6c (0025): helpers
-- ================================================================

-- An approved or paused profile whose member is still eligible. Both sides
-- of a match must be active for it to unlock anything. Not client-callable.
create or replace function matrimony_profile_active(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from matrimony_profiles m join people p on p.id = m.person_id
    where m.id = p_profile_id
      and m.status in ('approved', 'paused')
      and matrimony_ineligible_reason(p.member_status, p.dob, p.gender, p.marital_status) is null
  );
$$;

revoke all on function matrimony_profile_active(uuid) from public, anon, authenticated;

-- The caller's profile if it is active (approved or paused, eligible). A
-- paused member still sees their matches; only a live (approved) one
-- browses and sends -- that's matrimony_my_live_profile_id (0024). Not
-- client-callable.
create or replace function matrimony_my_active_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.id from matrimony_profiles m join people p on p.id = m.person_id
  where p.auth_user_id = auth.uid() and matrimony_profile_active(m.id);
$$;

revoke all on function matrimony_my_active_profile_id() from public, anon, authenticated;

-- A block between the members behind two profiles, either direction. Not
-- client-callable.
create or replace function matrimony_is_blocked(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from matrimony_profiles a, matrimony_profiles b, matrimony_blocks k
    where a.id = p_a and b.id = p_b
      and ((k.blocker_person_id = a.person_id and k.blocked_person_id = b.person_id)
           or (k.blocker_person_id = b.person_id and k.blocked_person_id = a.person_id))
  );
$$;

revoke all on function matrimony_is_blocked(uuid, uuid) from public, anon, authenticated;

-- An un-matched pair, either direction. Not client-callable.
create or replace function matrimony_is_ended(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from matrimony_interests i
    where i.status = 'ended'
      and ((i.from_profile_id = p_a and i.to_profile_id = p_b)
           or (i.from_profile_id = p_b and i.to_profile_id = p_a))
  );
$$;

revoke all on function matrimony_is_ended(uuid, uuid) from public, anon, authenticated;

-- (6c) The unlock predicate now also needs both profiles active.
create or replace function matrimony_is_matched(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from matrimony_interests i
    where i.status = 'accepted'
      and ((i.from_profile_id = p_a and i.to_profile_id = p_b)
           or (i.from_profile_id = p_b and i.to_profile_id = p_a))
  )
  and matrimony_profile_active(p_a)
  and matrimony_profile_active(p_b);
$$;

revoke all on function matrimony_is_matched(uuid, uuid) from public, anon, authenticated;

-- ================================================================
-- Phase 6c (0025): browse / detail / interests, re-stated
-- ================================================================

-- (6c) Blocked and un-matched pairs drop out of each other's browse.
create or replace function list_matrimony_profiles(
  p_age_min int default null,
  p_age_max int default null,
  p_state text default null,
  p_city text default null,
  p_education text default null,
  p_occupation text default null,
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  id uuid,
  first_name text,
  last_initial text,
  age int,
  current_city text,
  current_state text,
  gotra text,
  education text,
  occupation_type text,
  height_cm int,
  about_me text,
  interest_state text,
  total_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select m.id, p.gender
    from matrimony_profiles m join people p on p.id = m.person_id
    where m.id = matrimony_my_live_profile_id()
  )
  select m.id, p.first_name, left(p.last_name, 1),
         date_part('year', age(p.dob))::int,
         p.current_city, p.current_state, p.gotra, p.education, p.occupation_type,
         m.height_cm, m.about_me,
         matrimony_interest_state(me.id, m.id),
         count(*) over ()
  from matrimony_profiles m
  join people p on p.id = m.person_id
  cross join me
  where m.status = 'approved'
    and m.id <> me.id
    and p.gender in ('Male', 'Female')
    and p.gender <> me.gender
    and matrimony_ineligible_reason(p.member_status, p.dob, p.gender, p.marital_status) is null
    and not matrimony_is_blocked(me.id, m.id)
    and not matrimony_is_ended(me.id, m.id)
    and (p_age_min is null or date_part('year', age(p.dob)) >= p_age_min)
    and (p_age_max is null or date_part('year', age(p.dob)) <= p_age_max)
    and (p_state is null or p.current_state = p_state)
    and (p_city is null or p.current_city = p_city)
    and (p_education is null or length(trim(p_education)) = 0
         or p.education ilike '%' || trim(p_education) || '%')
    and (p_occupation is null or p.occupation_type = p_occupation)
  order by m.reviewed_at desc nulls last, m.id asc
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function list_matrimony_profiles(int, int, text, text, text, text, int, int) from public;
grant execute on function list_matrimony_profiles(int, int, text, text, text, text, int, int) to authenticated;

-- (6c) Works for a paused caller too (matches only). Null when blocked
-- either way, or un-matched and not matched again. Adds
-- match_interest_id, for un-matching.
create or replace function get_matrimony_profile(p_profile_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := matrimony_my_active_profile_id();
  v_me_live boolean;
  v_my_gender text;
  v_matched boolean;
  v_result jsonb;
  v_person people%rowtype;
  v_profile matrimony_profiles%rowtype;
begin
  if v_me is null or p_profile_id is null or p_profile_id = v_me then
    return null;
  end if;
  if matrimony_is_blocked(v_me, p_profile_id) then
    return null;
  end if;

  select p.gender, m.status = 'approved' into v_my_gender, v_me_live
  from matrimony_profiles m join people p on p.id = m.person_id where m.id = v_me;

  select * into v_profile from matrimony_profiles where id = p_profile_id;
  if not found then
    return null;
  end if;
  select * into v_person from people where id = v_profile.person_id;

  v_matched := matrimony_is_matched(v_me, p_profile_id);
  if not v_matched and not (
       v_me_live
       and v_profile.status = 'approved'
       and v_person.gender in ('Male', 'Female') and v_person.gender <> v_my_gender
       and matrimony_ineligible_reason(v_person.member_status, v_person.dob, v_person.gender,
                                       v_person.marital_status) is null
       and not matrimony_is_ended(v_me, p_profile_id)) then
    return null;
  end if;

  v_result := jsonb_build_object(
    'id', v_profile.id,
    'first_name', v_person.first_name,
    'last_initial', left(v_person.last_name, 1),
    'age', date_part('year', age(v_person.dob))::int,
    'gender', v_person.gender,
    'current_city', v_person.current_city,
    'current_state', v_person.current_state,
    'gotra', v_person.gotra,
    'education', v_person.education,
    'occupation_type', v_person.occupation_type,
    'height_cm', v_profile.height_cm,
    'about_me', v_profile.about_me,
    'about_family', v_profile.about_family,
    'partner_expectations', v_profile.partner_expectations,
    'diet', v_profile.diet,
    'smoking', v_profile.smoking,
    'drinking', v_profile.drinking,
    'birth_time', v_profile.birth_time,
    'birth_place', v_profile.birth_place,
    'rashi', v_profile.rashi,
    'nakshatra', v_profile.nakshatra,
    'interest_state', matrimony_interest_state(v_me, p_profile_id),
    -- The interest the caller can act on: their own pending one (withdraw)
    -- or the other person's pending one to them (accept / decline).
    'outgoing_interest_id', (select i.id from matrimony_interests i
                             where i.from_profile_id = v_me and i.to_profile_id = p_profile_id
                               and i.status = 'pending'),
    'incoming_interest', (select jsonb_build_object('id', i.id, 'message', i.message,
                                                    'created_at', i.created_at)
                          from matrimony_interests i
                          where i.from_profile_id = p_profile_id and i.to_profile_id = v_me
                            and i.status = 'pending'),
    'match_interest_id', case when v_matched then
                           (select i.id from matrimony_interests i
                            where i.status = 'accepted'
                              and ((i.from_profile_id = v_me and i.to_profile_id = p_profile_id)
                                   or (i.from_profile_id = p_profile_id and i.to_profile_id = v_me))
                            limit 1)
                         end,
    'contact', null
  );

  if v_matched then
    v_result := v_result || jsonb_build_object('contact', jsonb_build_object(
      'full_name', v_person.full_name,
      'father_name', (select r.related_name from family_relations r
                      where r.person_id = v_person.id and r.slot = 'father'),
      'mother_name', (select r.related_name from family_relations r
                      where r.person_id = v_person.id and r.slot = 'mother'),
      'native_place', v_person.native_place,
      'email', (select u.email from auth.users u where u.id = v_person.auth_user_id),
      'mobile_number', case when v_person.hide_mobile then null else v_person.mobile_number end,
      'mobile_hidden', v_person.hide_mobile,
      'photo_paths', coalesce((select jsonb_agg(ph.storage_path order by ph.position)
                               from matrimony_photos ph where ph.profile_id = p_profile_id),
                              '[]'::jsonb)
    ));
  end if;
  return v_result;
end;
$$;

revoke all on function get_matrimony_profile(uuid) from public;
grant execute on function get_matrimony_profile(uuid) to authenticated;

-- (6c) Unchanged apart from the visibility check now also refusing
-- blocked and un-matched pairs (via get_matrimony_profile).
create or replace function express_interest(p_profile_id uuid, p_message text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := matrimony_my_live_profile_id();
  v_message text := nullif(trim(p_message), '');
  v_existing matrimony_interests%rowtype;
  v_reverse uuid;
begin
  if v_me is null then
    raise exception 'Your matrimony profile needs to be live before you can express interest';
  end if;
  if v_message is not null and length(v_message) > 300 then
    raise exception 'Keep the message to 300 characters';
  end if;
  -- Visibility check (approved, eligible, opposite gender, not blocked, not
  -- un-matched) in one place.
  if get_matrimony_profile(p_profile_id) is null then
    raise exception 'This profile is not available';
  end if;
  if matrimony_is_matched(v_me, p_profile_id) then
    raise exception 'You are already matched';
  end if;

  -- Serialise this member's sends so the pending cap can't be raced.
  perform 1 from matrimony_profiles where id = v_me for update;

  select id into v_reverse from matrimony_interests
  where from_profile_id = p_profile_id and to_profile_id = v_me and status = 'pending'
  for update;
  if v_reverse is not null then
    update matrimony_interests
    set status = 'accepted', responded_at = now(), recipient_seen_at = now()
    where id = v_reverse;
    return 'matched';
  end if;

  select * into v_existing from matrimony_interests
  where from_profile_id = v_me and to_profile_id = p_profile_id
  for update;
  if v_existing.id is not null and v_existing.status <> 'withdrawn' then
    raise exception 'You have already expressed interest in this profile';
  end if;

  if (select count(*) from matrimony_interests
      where from_profile_id = v_me and status = 'pending') >= 10 then
    raise exception 'You have 10 interests waiting for a reply. Withdraw one or wait for replies before sending more.';
  end if;

  if v_existing.id is not null then
    update matrimony_interests
    set status = 'pending', message = v_message, created_at = now(), responded_at = null,
        recipient_seen_at = null, sender_seen_at = null
    where id = v_existing.id;
  else
    insert into matrimony_interests (from_profile_id, to_profile_id, message)
    values (v_me, p_profile_id, v_message);
  end if;
  return 'sent';
end;
$$;

revoke all on function express_interest(uuid, text) from public;
grant execute on function express_interest(uuid, text) to authenticated;

-- (6c) Replying needs a live profile; a paused member resumes first.
create or replace function respond_interest(p_interest_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := matrimony_my_live_profile_id();
  v_interest matrimony_interests%rowtype;
begin
  if v_me is null then
    raise exception 'Your matrimony profile needs to be live to reply. If it is paused, resume it first.';
  end if;

  select * into v_interest from matrimony_interests
  where id = p_interest_id and to_profile_id = v_me
  for update;
  if not found or v_interest.status <> 'pending' then
    raise exception 'This interest is no longer waiting for a reply';
  end if;
  if coalesce(p_accept, false) and get_matrimony_profile(v_interest.from_profile_id) is null then
    raise exception 'This profile is no longer available';
  end if;

  update matrimony_interests
  set status = case when coalesce(p_accept, false) then 'accepted' else 'declined' end,
      responded_at = now(),
      recipient_seen_at = coalesce(recipient_seen_at, now())
  where id = p_interest_id;
end;
$$;

revoke all on function respond_interest(uuid, boolean) from public;
grant execute on function respond_interest(uuid, boolean) to authenticated;

-- (6c) Blocked pairs are left out of every box; Matches only lists matches
-- that are still active on both sides.
create or replace function list_my_interests(p_box text)
returns table (
  interest_id uuid,
  profile_id uuid,
  first_name text,
  last_initial text,
  full_name text,
  age int,
  current_city text,
  current_state text,
  gotra text,
  education text,
  occupation_type text,
  height_cm int,
  status text,
  message text,
  created_at timestamptz,
  responded_at timestamptz,
  is_new boolean,
  main_photo_path text
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select m.id from matrimony_profiles m join people p on p.id = m.person_id
    where p.auth_user_id = auth.uid()
  ),
  boxed as (
    select i.*,
           case when i.from_profile_id = me.id then i.to_profile_id else i.from_profile_id end
             as other_id,
           i.from_profile_id = me.id as outgoing,
           me.id as me_id
    from matrimony_interests i cross join me
    where (p_box = 'received' and i.to_profile_id = me.id and i.status = 'pending')
       or (p_box = 'sent' and i.from_profile_id = me.id and i.status in ('pending', 'declined'))
       or (p_box = 'matches' and i.status = 'accepted'
           and (i.from_profile_id = me.id or i.to_profile_id = me.id))
  )
  select r.id, o.id, p.first_name, left(p.last_name, 1),
         case when r.status = 'accepted' then p.full_name end,
         date_part('year', age(p.dob))::int,
         p.current_city, p.current_state, p.gotra, p.education, p.occupation_type, o.height_cm,
         case when r.status = 'declined' then 'no_response' else r.status end,
         r.message, r.created_at, r.responded_at,
         case
           when p_box = 'received' then r.recipient_seen_at is null
           when p_box = 'matches' then r.outgoing and r.sender_seen_at is null
           else false
         end,
         case when r.status = 'accepted' then
           (select ph.storage_path from matrimony_photos ph
            where ph.profile_id = o.id and ph.position = 1)
         end
  from boxed r
  join matrimony_profiles o on o.id = r.other_id
  join people p on p.id = o.person_id
  where not matrimony_is_blocked(r.me_id, o.id)
    and (p_box <> 'received'
         or (o.status = 'approved'
             and matrimony_ineligible_reason(p.member_status, p.dob, p.gender,
                                             p.marital_status) is null))
    and (p_box <> 'matches' or matrimony_is_matched(r.me_id, o.id))
  order by coalesce(r.responded_at, r.created_at) desc, r.id asc;
$$;

revoke all on function list_my_interests(text) from public;
grant execute on function list_my_interests(text) to authenticated;

-- (6c) New matches only count while the match is active.
create or replace function matrimony_badge_count()
returns int
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select m.id from matrimony_profiles m join people p on p.id = m.person_id
    where p.auth_user_id = auth.uid()
  )
  select (
    (select count(*) from matrimony_interests i
     join matrimony_profiles o on o.id = i.from_profile_id
     join people p on p.id = o.person_id
     cross join me
     where i.to_profile_id = me.id and i.status = 'pending' and i.recipient_seen_at is null
       and o.status = 'approved'
       and matrimony_ineligible_reason(p.member_status, p.dob, p.gender, p.marital_status) is null
       and not matrimony_is_blocked(me.id, o.id))
    +
    (select count(*) from matrimony_interests i cross join me
     where i.from_profile_id = me.id and i.status = 'accepted' and i.sender_seen_at is null
       and matrimony_is_matched(i.from_profile_id, i.to_profile_id))
  )::int;
$$;

revoke all on function matrimony_badge_count() from public;
grant execute on function matrimony_badge_count() to authenticated;

-- ================================================================
-- Phase 6c (0025): member safety actions
-- ================================================================

-- Pause (approved -> paused) or resume (paused -> approved). Paused = out
-- of browse and can't send or reply; existing matches keep working.
create or replace function set_matrimony_paused(p_paused boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update matrimony_profiles m
  set status = case when p_paused then 'paused' else 'approved' end, updated_at = now()
  from people p
  where p.id = m.person_id and p.auth_user_id = auth.uid()
    and m.status = case when p_paused then 'approved' else 'paused' end;
  if not found then
    raise exception '%', case when p_paused then 'Only a live profile can be paused'
                              else 'Only a paused profile can be resumed' end;
  end if;
end;
$$;

revoke all on function set_matrimony_paused(boolean) from public;
grant execute on function set_matrimony_paused(boolean) to authenticated;

-- Un-match, by either side. Photos and contact re-lock for both, and the
-- pair can't send interest to each other again.
create or replace function end_matrimony_match(p_interest_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid;
begin
  select m.id into v_me from matrimony_profiles m join people p on p.id = m.person_id
  where p.auth_user_id = auth.uid();

  update matrimony_interests
  set status = 'ended', ended_by_profile_id = v_me, ended_at = now()
  where id = p_interest_id and status = 'accepted'
    and v_me is not null and (from_profile_id = v_me or to_profile_id = v_me);
  if not found then
    raise exception 'This match could not be found';
  end if;
end;
$$;

revoke all on function end_matrimony_match(uuid) from public;
grant execute on function end_matrimony_match(uuid) to authenticated;

-- Block the member behind a profile. Ends any match, withdraws the
-- caller's pending interest and silently declines theirs. Idempotent.
create or replace function block_matrimony_profile(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me matrimony_profiles%rowtype;
  v_other matrimony_profiles%rowtype;
begin
  select m.* into v_me from matrimony_profiles m join people p on p.id = m.person_id
  where p.auth_user_id = auth.uid();
  if not found then
    raise exception 'You need a matrimony profile to block someone';
  end if;
  select * into v_other from matrimony_profiles where id = p_profile_id;
  if not found or v_other.id = v_me.id then
    raise exception 'Profile not found';
  end if;

  insert into matrimony_blocks (blocker_person_id, blocked_person_id)
  values (v_me.person_id, v_other.person_id)
  on conflict do nothing;

  update matrimony_interests
  set status = case
                 when status = 'accepted' then 'ended'
                 when from_profile_id = v_me.id then 'withdrawn'
                 else 'declined'
               end,
      ended_by_profile_id = case when status = 'accepted' then v_me.id else ended_by_profile_id end,
      ended_at = case when status = 'accepted' then now() else ended_at end,
      responded_at = case when status = 'pending' and to_profile_id = v_me.id then now()
                          else responded_at end
  where status in ('accepted', 'pending')
    and ((from_profile_id = v_me.id and to_profile_id = v_other.id)
         or (from_profile_id = v_other.id and to_profile_id = v_me.id));
end;
$$;

revoke all on function block_matrimony_profile(uuid) from public;
grant execute on function block_matrimony_profile(uuid) to authenticated;

-- Lift a block. An ended match stays ended.
create or replace function unblock_matrimony_person(p_person_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from matrimony_blocks k
  using people p
  where p.auth_user_id = auth.uid()
    and k.blocker_person_id = p.id
    and k.blocked_person_id = p_person_id;
$$;

revoke all on function unblock_matrimony_person(uuid) from public;
grant execute on function unblock_matrimony_person(uuid) to authenticated;

-- The members the caller has blocked: first name + initial only.
create or replace function list_my_matrimony_blocks()
returns table (person_id uuid, first_name text, last_initial text, created_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select b.id, b.first_name, left(b.last_name, 1), k.created_at
  from matrimony_blocks k
  join people me on me.id = k.blocker_person_id
  join people b on b.id = k.blocked_person_id
  where me.auth_user_id = auth.uid()
  order by k.created_at desc;
$$;

revoke all on function list_my_matrimony_blocks() from public;
grant execute on function list_my_matrimony_blocks() to authenticated;

-- Report the member behind a profile to the admins. Allowed for a profile
-- the caller can see, has had an interest with, or has blocked. One open
-- report per reporter per member.
create or replace function report_matrimony_profile(
  p_profile_id uuid,
  p_reason text,
  p_details text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me matrimony_profiles%rowtype;
  v_other matrimony_profiles%rowtype;
  v_details text := nullif(trim(p_details), '');
begin
  select m.* into v_me from matrimony_profiles m join people p on p.id = m.person_id
  where p.auth_user_id = auth.uid();
  if not found then
    raise exception 'You need a matrimony profile to report someone';
  end if;
  select * into v_other from matrimony_profiles where id = p_profile_id;
  if not found or v_other.id = v_me.id then
    raise exception 'Profile not found';
  end if;
  if get_matrimony_profile(p_profile_id) is null
     and not exists (select 1 from matrimony_interests i
                     where (i.from_profile_id = v_me.id and i.to_profile_id = v_other.id)
                        or (i.from_profile_id = v_other.id and i.to_profile_id = v_me.id))
     and not exists (select 1 from matrimony_blocks k
                     where k.blocker_person_id = v_me.person_id
                       and k.blocked_person_id = v_other.person_id) then
    raise exception 'Profile not found';
  end if;
  if v_details is not null and length(v_details) > 1000 then
    raise exception 'Keep the details to 1000 characters';
  end if;
  if p_reason = 'Other' and v_details is null then
    raise exception 'Please say what the problem is';
  end if;

  begin
    insert into matrimony_reports (reporter_person_id, reported_person_id, reason, details)
    values (v_me.person_id, v_other.person_id, p_reason, v_details);
  exception when unique_violation then
    raise exception 'You have already reported this profile. The admins will look at it.';
  end;
end;
$$;

revoke all on function report_matrimony_profile(uuid, text, text) from public;
grant execute on function report_matrimony_profile(uuid, text, text) to authenticated;

-- Delete the caller's matrimony profile: photos, interests and matches go
-- with it (blocks and reports are on people, so they stay). Returns the
-- photo storage paths for the client to remove from the bucket.
create or replace function delete_my_matrimony_profile()
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_paths text[];
begin
  select m.id into v_id from matrimony_profiles m join people p on p.id = m.person_id
  where p.auth_user_id = auth.uid();
  if v_id is null then
    raise exception 'You have no matrimony profile';
  end if;

  select coalesce(array_agg(storage_path), '{}') into v_paths
  from matrimony_photos where profile_id = v_id;
  delete from matrimony_profiles where id = v_id;
  return v_paths;
end;
$$;

revoke all on function delete_my_matrimony_profile() from public;
grant execute on function delete_my_matrimony_profile() to authenticated;

-- ---------------------------------------------------------------- admin

-- Reports for the console, oldest open first / newest resolved first.
-- open_against = open reports about the same member (repeat offenders).
create or replace function admin_list_matrimony_reports(
  p_status text default 'open',
  p_limit int default 25,
  p_offset int default 0
)
returns table (
  id uuid,
  created_at timestamptz,
  reason text,
  details text,
  status text,
  resolution_note text,
  resolved_at timestamptz,
  resolved_by_name text,
  reporter_person_id uuid,
  reporter_name text,
  reported_person_id uuid,
  reported_name text,
  reported_member_code text,
  reported_profile_id uuid,
  reported_profile_status text,
  open_against bigint,
  total_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.created_at, r.reason, r.details, r.status, r.resolution_note, r.resolved_at,
         (select x.full_name from people x where x.auth_user_id = r.resolved_by),
         rp.id, rp.full_name,
         tp.id, tp.full_name, tp.member_code,
         m.id, m.status,
         (select count(*) from matrimony_reports o
          where o.reported_person_id = r.reported_person_id and o.status = 'open'),
         count(*) over ()
  from matrimony_reports r
  join people rp on rp.id = r.reporter_person_id
  join people tp on tp.id = r.reported_person_id
  left join matrimony_profiles m on m.person_id = tp.id
  where is_admin()
    and (p_status is null or r.status = p_status)
  order by
    case when r.status = 'open' then r.created_at end asc nulls last,
    r.resolved_at desc nulls last,
    r.id asc
  limit least(greatest(coalesce(p_limit, 25), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function admin_list_matrimony_reports(text, int, int) from public;
grant execute on function admin_list_matrimony_reports(text, int, int) to authenticated;

-- Close a report, optionally with a note (admins only see it). Audited.
create or replace function admin_resolve_matrimony_report(p_report_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_note text := nullif(trim(p_note), '');
  v_admin_person_id uuid;
begin
  if not is_admin() then
    raise exception 'Not an admin';
  end if;
  update matrimony_reports
  set status = 'resolved', resolution_note = v_note, resolved_by = auth.uid(), resolved_at = now()
  where id = p_report_id and status = 'open';
  if not found then
    raise exception 'This report is already resolved';
  end if;

  select id into v_admin_person_id from people where auth_user_id = auth.uid();
  insert into admin_audit_log (admin_id, action, target_type, target_id, notes)
  values (v_admin_person_id, 'matrimony_report_resolved', 'matrimony_report', p_report_id, v_note);
end;
$$;

revoke all on function admin_resolve_matrimony_report(uuid, text) from public;
grant execute on function admin_resolve_matrimony_report(uuid, text) to authenticated;

-- Hide a live or paused profile (reason required, shown to the owner) or
-- unhide it back to live. Hiding suspends the member's matches too (both
-- sides must be active). Audited.
create or replace function admin_set_matrimony_hidden(
  p_profile_id uuid,
  p_hidden boolean,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text := nullif(trim(p_reason), '');
  v_admin_person_id uuid;
begin
  if not is_admin() then
    raise exception 'Not an admin';
  end if;
  if p_hidden and v_reason is null then
    raise exception 'Please tell the member why';
  end if;

  if p_hidden then
    update matrimony_profiles
    set status = 'hidden', review_note = v_reason, reviewed_at = now(),
        reviewed_by = auth.uid(), updated_at = now()
    where id = p_profile_id and status in ('approved', 'paused');
  else
    update matrimony_profiles
    set status = 'approved', review_note = null, reviewed_at = now(),
        reviewed_by = auth.uid(), updated_at = now()
    where id = p_profile_id and status = 'hidden';
  end if;
  if not found then
    raise exception '%', case when p_hidden then 'Only a live or paused profile can be hidden'
                              else 'This profile is not hidden' end;
  end if;

  select id into v_admin_person_id from people where auth_user_id = auth.uid();
  insert into admin_audit_log (admin_id, action, target_type, target_id, notes)
  values (v_admin_person_id, case when p_hidden then 'matrimony_hidden' else 'matrimony_unhidden' end,
          'matrimony_profile', p_profile_id, v_reason);
end;
$$;

revoke all on function admin_set_matrimony_hidden(uuid, boolean, text) from public;
grant execute on function admin_set_matrimony_hidden(uuid, boolean, text) to authenticated;

-- ================================================================
-- verification (run these after applying)
-- ================================================================
-- select relname, relrowsecurity from pg_class
-- where relname in ('matrimony_blocks', 'matrimony_reports');
--   -- 2 rows, both true
-- select proname from pg_proc
-- where proname in ('set_matrimony_paused', 'end_matrimony_match', 'block_matrimony_profile',
--                   'unblock_matrimony_person', 'list_my_matrimony_blocks',
--                   'report_matrimony_profile', 'delete_my_matrimony_profile',
--                   'admin_list_matrimony_reports', 'admin_resolve_matrimony_report',
--                   'admin_set_matrimony_hidden');
--   -- 10 rows
-- select has_function_privilege('authenticated', 'matrimony_profile_active(uuid)', 'execute');
--   -- false
-- select has_function_privilege('authenticated', 'matrimony_is_blocked(uuid,uuid)', 'execute');
--   -- false
-- select pg_get_constraintdef(oid) from pg_constraint
-- where conname in ('matrimony_profiles_status_check', 'matrimony_interests_status_check');
--   -- include 'paused','hidden' and 'ended' respectively
--
-- Then, signed in as a member in the browser console:
--   await supabase.from('matrimony_reports').select()       -- [] (no policies)
--   await supabase.rpc('admin_list_matrimony_reports')      -- []
