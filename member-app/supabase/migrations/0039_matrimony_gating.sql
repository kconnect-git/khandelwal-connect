-- Phase 11.7: Matrimony gating (see matrimony-paid-features.md, phase-11-plan.md).
--
-- Two modes, chosen by the Matrimony paywall switch:
--
--   OFF (today's rules, unchanged): only a member with a live matrimony
--   profile browses, and only the opposite gender.
--
--   ON:
--     * With Matrimony access (or an admin): browse every listed profile,
--       BOTH genders, whether or not they have a profile of their own.
--     * Without access: browse returns nothing; matrimony_browse_count()
--       gives the number for "N profiles match you". They can open only a
--       profile with a pending interest between them (so they can see who
--       sent them interest, and answer), plus their matches.
--     * Sending interest needs access AND your own live profile AND the
--       opposite gender (an interest is from one profile to another).
--       Refused without access with SQLSTATE KCL05 -- unless the other
--       person already sent you one, which makes it a match (that is just
--       accepting, and accepting is free).
--   Either way, unchanged and free: replying to interests, matches, the
--   mutual unlock of photos and contact (matrimony_photo_visible), safety
--   tools, being listed. Matches survive a lapse.
--
-- Being LISTED (eligibility) is untouched -- that is still an approved
-- profile + matrimony_ineligible_reason() is null.
--
--   * list_matrimony_profiles gains `gender` (cards need it once both
--     genders show), so it is dropped and recreated; plpgsql now.
--   * matrimony_filter_options, get_matrimony_profile: same return types,
--     create or replace. get_matrimony_profile adds `can_express` and
--     `express_blocker` ('no_profile' | 'same_gender' | 'no_access' | null)
--     to its jsonb so the page can say why the button isn't there.
--   * Blocks are checked by PERSON (matrimony_blocks is person-keyed), so a
--     caller without a profile is covered too.
--   * All touched functions are closed to anon.
--
-- ORDER OF DEPLOY: 0038 applied. Apply this, then the frontend (which sets
-- PAYWALL_READY.matrimony so the admin page offers Turn on).
--
-- Re-runnable.

begin;

-- ================================================================
-- helpers (definer-only)
-- ================================================================

-- The caller's people.id if they are an approved member, else null.
create or replace function matrimony_my_person_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id from people p where p.auth_user_id = auth.uid() and p.member_status = 'approved';
$$;

revoke all on function matrimony_my_person_id() from public;
revoke all on function matrimony_my_person_id() from anon, authenticated;

-- A block between two people, either direction.
create or replace function matrimony_persons_blocked(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from matrimony_blocks k
    where (k.blocker_person_id = p_a and k.blocked_person_id = p_b)
       or (k.blocker_person_id = p_b and k.blocked_person_id = p_a)
  );
$$;

revoke all on function matrimony_persons_blocked(uuid, uuid) from public;
revoke all on function matrimony_persons_blocked(uuid, uuid) from anon, authenticated;

-- ================================================================
-- browse
-- ================================================================

drop function if exists list_matrimony_profiles(int, int, text, text, text, text, int, int);

create function list_matrimony_profiles(
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
  gender text,
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
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_person uuid := matrimony_my_person_id();
  v_live uuid := matrimony_my_live_profile_id();
  v_mine uuid := matrimony_my_active_profile_id();
  v_enforced boolean := coalesce((select s.enforced from paid_service_settings s
                                  where s.service = 'matrimony'), false);
  v_both boolean;
  v_my_gender text;
begin
  if v_person is null then
    return;
  end if;
  if v_enforced then
    -- Paid (or admin): everyone listed, both genders.
    if not has_service_access(v_person, 'matrimony') then
      return;
    end if;
    v_both := true;
  else
    -- Today's rule: a live profile browses the opposite gender.
    if v_live is null then
      return;
    end if;
    v_both := false;
    select p.gender into v_my_gender from people p where p.id = v_person;
  end if;

  return query
  select m.id, p.first_name, left(p.last_name, 1),
         date_part('year', age(p.dob))::int,
         p.gender,
         p.current_city, p.current_state, p.gotra, p.education, p.occupation_type,
         m.height_cm, m.about_me,
         case when v_mine is null then 'none' else matrimony_interest_state(v_mine, m.id) end,
         count(*) over ()
  from matrimony_profiles m
  join people p on p.id = m.person_id
  where m.status = 'approved'
    and m.person_id <> v_person
    and p.gender in ('Male', 'Female')
    and (v_both or p.gender <> v_my_gender)
    and matrimony_ineligible_reason(p.member_status, p.dob, p.gender, p.marital_status) is null
    and not matrimony_persons_blocked(v_person, p.id)
    and (v_mine is null or not matrimony_is_ended(v_mine, m.id))
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
end;
$$;

revoke all on function list_matrimony_profiles(int, int, text, text, text, text, int, int) from public;
grant execute on function list_matrimony_profiles(int, int, text, text, text, text, int, int) to authenticated;
revoke execute on function list_matrimony_profiles(int, int, text, text, text, text, int, int) from anon;

-- "N profiles match you", for a member who can't browse. A member with an
-- active profile counts the opposite gender; anyone else counts everyone
-- listed. Returns a number only -- no profile data.
create or replace function matrimony_browse_count()
returns int
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select matrimony_my_person_id() as person_id,
           (select p.gender from matrimony_profiles m join people p on p.id = m.person_id
            where m.id = matrimony_my_active_profile_id()) as gender
  )
  select count(*)::int
  from matrimony_profiles m
  join people p on p.id = m.person_id
  cross join me
  where me.person_id is not null
    and m.status = 'approved'
    and m.person_id <> me.person_id
    and p.gender in ('Male', 'Female')
    and (me.gender is null or p.gender <> me.gender)
    and matrimony_ineligible_reason(p.member_status, p.dob, p.gender, p.marital_status) is null
    and not matrimony_persons_blocked(me.person_id, p.id);
$$;

revoke all on function matrimony_browse_count() from public;
grant execute on function matrimony_browse_count() to authenticated;
revoke execute on function matrimony_browse_count() from anon;

-- States and cities among the profiles the caller can browse (same modes).
create or replace function matrimony_filter_options()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_person uuid := matrimony_my_person_id();
  v_enforced boolean := coalesce((select s.enforced from paid_service_settings s
                                  where s.service = 'matrimony'), false);
  v_both boolean;
  v_my_gender text;
  v_result jsonb;
begin
  if v_person is null then
    return jsonb_build_object('states', '[]'::jsonb, 'cities', '[]'::jsonb);
  end if;
  if v_enforced then
    if not has_service_access(v_person, 'matrimony') then
      return jsonb_build_object('states', '[]'::jsonb, 'cities', '[]'::jsonb);
    end if;
    v_both := true;
  else
    if matrimony_my_live_profile_id() is null then
      return jsonb_build_object('states', '[]'::jsonb, 'cities', '[]'::jsonb);
    end if;
    v_both := false;
    select p.gender into v_my_gender from people p where p.id = v_person;
  end if;

  with visible as (
    select p.current_state, p.current_city
    from matrimony_profiles m
    join people p on p.id = m.person_id
    where m.status = 'approved' and m.person_id <> v_person
      and p.gender in ('Male', 'Female') and (v_both or p.gender <> v_my_gender)
      and matrimony_ineligible_reason(p.member_status, p.dob, p.gender, p.marital_status) is null
  )
  select jsonb_build_object(
    'states', coalesce((select jsonb_agg(distinct current_state order by current_state)
                        from visible where current_state is not null), '[]'::jsonb),
    'cities', coalesce((select jsonb_agg(distinct current_city order by current_city)
                        from visible where current_city is not null), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function matrimony_filter_options() from public;
grant execute on function matrimony_filter_options() to authenticated;
revoke execute on function matrimony_filter_options() from anon;

-- ================================================================
-- one profile
-- ================================================================

create or replace function get_matrimony_profile(p_profile_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_person uuid := matrimony_my_person_id();
  v_me uuid := matrimony_my_active_profile_id();
  v_live uuid := matrimony_my_live_profile_id();
  v_enforced boolean := coalesce((select s.enforced from paid_service_settings s
                                  where s.service = 'matrimony'), false);
  v_access boolean;
  v_my_gender text;
  v_matched boolean;
  v_listed boolean;
  v_pending boolean;
  v_blocker text;
  v_result jsonb;
  v_person_row people%rowtype;
  v_profile matrimony_profiles%rowtype;
begin
  if v_person is null or p_profile_id is null or p_profile_id is not distinct from v_me then
    return null;
  end if;
  -- Today's rule: you need a profile of your own to look at anyone.
  if not v_enforced and v_me is null then
    return null;
  end if;

  select * into v_profile from matrimony_profiles where id = p_profile_id;
  if not found or v_profile.person_id = v_person then
    return null;
  end if;
  select * into v_person_row from people where id = v_profile.person_id;
  if matrimony_persons_blocked(v_person, v_person_row.id) then
    return null;
  end if;

  select p.gender into v_my_gender from people p where p.id = v_person;
  v_access := has_service_access(v_person, 'matrimony');
  v_matched := v_me is not null and matrimony_is_matched(v_me, p_profile_id);
  v_listed := v_profile.status = 'approved'
              and v_person_row.gender in ('Male', 'Female')
              and matrimony_ineligible_reason(v_person_row.member_status, v_person_row.dob,
                                              v_person_row.gender, v_person_row.marital_status) is null
              and (v_me is null or not matrimony_is_ended(v_me, p_profile_id));
  v_pending := v_me is not null and exists (
    select 1 from matrimony_interests i
    where i.status = 'pending'
      and ((i.from_profile_id = v_me and i.to_profile_id = p_profile_id)
           or (i.from_profile_id = p_profile_id and i.to_profile_id = v_me)));

  if not v_matched then
    if not v_enforced then
      -- Today's rule, unchanged.
      if not (v_live is not null and v_listed and v_person_row.gender <> v_my_gender) then
        return null;
      end if;
    else
      -- Paid: anyone listed. Free: only someone you have a pending interest with.
      if not (v_listed and (v_access or v_pending)) then
        return null;
      end if;
    end if;
  end if;

  v_blocker := case
    when v_live is null then 'no_profile'
    when v_person_row.gender = v_my_gender then 'same_gender'
    when v_enforced and not v_access then 'no_access'
  end;

  v_result := jsonb_build_object(
    'id', v_profile.id,
    'first_name', v_person_row.first_name,
    'last_initial', left(v_person_row.last_name, 1),
    'age', date_part('year', age(v_person_row.dob))::int,
    'gender', v_person_row.gender,
    'current_city', v_person_row.current_city,
    'current_state', v_person_row.current_state,
    'gotra', v_person_row.gotra,
    'education', v_person_row.education,
    'occupation_type', v_person_row.occupation_type,
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
    'interest_state', case when v_me is null then 'none'
                           else matrimony_interest_state(v_me, p_profile_id) end,
    -- (0039) Whether "Express interest" applies, and if not, why.
    'can_express', v_blocker is null,
    'express_blocker', v_blocker,
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
      'full_name', v_person_row.full_name,
      'father_name', (select r.related_name from family_relations r
                      where r.person_id = v_person_row.id and r.slot = 'father'),
      'mother_name', (select r.related_name from family_relations r
                      where r.person_id = v_person_row.id and r.slot = 'mother'),
      'native_place', v_person_row.native_place,
      'email', (select u.email from auth.users u where u.id = v_person_row.auth_user_id),
      'mobile_number', case when v_person_row.hide_mobile then null else v_person_row.mobile_number end,
      'mobile_hidden', v_person_row.hide_mobile,
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
revoke execute on function get_matrimony_profile(uuid) from anon;

-- ================================================================
-- sending interest
-- ================================================================

-- Unchanged apart from (0039): Matrimony access when the paywall is on
-- (skipped when the other person already sent you one -- that is accepting,
-- which is free), and an explicit opposite-gender check, since paid members
-- can now view both genders.
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
  -- (0039) Matrimony access -- unless they already sent you one, which
  -- makes this a match (accepting is free).
  if not has_service_access(matrimony_my_person_id(), 'matrimony')
     and not exists (select 1 from matrimony_interests
                     where from_profile_id = p_profile_id and to_profile_id = v_me
                       and status = 'pending') then
    raise exception using errcode = 'KCL05',
      message = 'Sending interest is part of Matrimony access.';
  end if;
  -- Visibility check (approved, eligible, not blocked, not un-matched) in
  -- one place.
  if get_matrimony_profile(p_profile_id) is null then
    raise exception 'This profile is not available';
  end if;
  if (select p.gender from matrimony_profiles m join people p on p.id = m.person_id
      where m.id = p_profile_id)
     is not distinct from
     (select p.gender from matrimony_profiles m join people p on p.id = m.person_id
      where m.id = v_me) then
    raise exception 'Interests can only be sent to the opposite gender';
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
revoke execute on function express_interest(uuid, text) from anon;

commit;

-- ================================================================
-- verification (run these after applying)
-- ================================================================
-- select proname, has_function_privilege('anon', oid, 'execute') as anon,
--        has_function_privilege('authenticated', oid, 'execute') as authed
-- from pg_proc where proname in ('list_matrimony_profiles', 'matrimony_browse_count',
--   'matrimony_filter_options', 'get_matrimony_profile', 'express_interest',
--   'matrimony_my_person_id', 'matrimony_persons_blocked');
--   -- anon false everywhere; the two helpers authed false too
--
-- Paywall OFF: a member with a live profile browses the opposite gender as
-- before; anyone without a profile sees nothing.
-- Paywall ON, no grant: list empty, matrimony_browse_count() > 0, express
-- -> KCL05, can open only someone with a pending interest with them.
-- Paywall ON, with grant: both genders, with or without an own profile.
