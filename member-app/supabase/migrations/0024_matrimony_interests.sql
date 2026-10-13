-- Phase 6b: matrimony browse, interests and the mutual unlock -- the Phase 6
-- exit criterion ("two members mutually express interest, only then see
-- contact info").
--
--   * matrimony_interests rebuilt on profile ids (0023 dropped the Phase 0
--     placeholder). pending -> accepted / declined, or -> withdrawn by the
--     sender. A withdrawn interest can be sent again; a declined one can't,
--     and the sender is never told it was declined (they see "no response").
--     RPC-only: RLS on, no policies.
--   * Who is browsable: an approved matrimony profile whose member is still
--     eligible *right now* (matrimony_ineligible_reason, 0023) and of the
--     opposite gender to the caller. The caller needs an approved, eligible
--     profile themselves to browse or send interest.
--   * matrimony_is_matched: an accepted interest in either direction. The
--     one unlock predicate -- full name, family, email, mobile (unless
--     hide_mobile) and photos are returned only when it holds, and the
--     matrimony-photos read policy uses it for signed URLs.
--   * express_interest: max 10 pending outgoing. If the other person already
--     has a pending interest to the caller, it is accepted instead (instant
--     match) rather than creating a second, crossing row.
--   * matrimony_badge_count: unseen received interests + unseen new matches.
--
-- ORDER OF DEPLOY: 0023 must already be applied. Apply this, then the
-- frontend.
--
-- Run manually in the Supabase SQL editor -- this repo's migrations are not
-- wired to a runner (see 0001_init.sql).
--
-- Function bodies below are extracted verbatim from ddl/core_schema.sql.

-- ================================================================
-- tables
-- ================================================================

-- Re-runnable (0023 already dropped the placeholder; this covers a second
-- run of this file). Discards interests -- only re-run before real use.
drop table if exists matrimony_interests;

create table matrimony_interests (
  id uuid primary key default gen_random_uuid(),
  from_profile_id uuid not null references matrimony_profiles(id) on delete cascade,
  to_profile_id uuid not null references matrimony_profiles(id) on delete cascade,
  message text check (message is null or length(message) <= 300),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'withdrawn')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  -- Badge bookkeeping: the recipient has seen a pending interest; the
  -- sender has seen that it was accepted.
  recipient_seen_at timestamptz,
  sender_seen_at timestamptz,
  constraint matrimony_interests_pair_key unique (from_profile_id, to_profile_id),
  constraint matrimony_interests_not_self check (from_profile_id <> to_profile_id)
);

create index matrimony_interests_to_idx on matrimony_interests (to_profile_id, status);
create index matrimony_interests_from_idx on matrimony_interests (from_profile_id, status);

alter table matrimony_interests enable row level security;

-- ================================================================
-- Phase 6b (0024): helpers
-- ================================================================

-- The caller's matrimony profile id if it is approved and they are still
-- eligible, else null. The caller gate for browsing and interests. Not
-- client-callable.
create or replace function matrimony_my_live_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.id
  from matrimony_profiles m
  join people p on p.id = m.person_id
  where p.auth_user_id = auth.uid()
    and m.status = 'approved'
    and matrimony_ineligible_reason(p.member_status, p.dob, p.gender, p.marital_status) is null;
$$;

revoke all on function matrimony_my_live_profile_id() from public, anon, authenticated;

-- An accepted interest between two profiles, in either direction. Not
-- client-callable.
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
  );
$$;

revoke all on function matrimony_is_matched(uuid, uuid) from public, anon, authenticated;

-- Where the caller (p_me) stands with another profile, from the caller's
-- side: matched / sent / received / no_response (their silent decline of
-- my interest) / none. Not client-callable.
create or replace function matrimony_interest_state(p_me uuid, p_other uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when matrimony_is_matched(p_me, p_other) then 'matched'
    when exists (select 1 from matrimony_interests
                 where from_profile_id = p_me and to_profile_id = p_other
                   and status = 'pending') then 'sent'
    when exists (select 1 from matrimony_interests
                 where from_profile_id = p_other and to_profile_id = p_me
                   and status = 'pending') then 'received'
    when exists (select 1 from matrimony_interests
                 where from_profile_id = p_me and to_profile_id = p_other
                   and status = 'declined') then 'no_response'
    else 'none'
  end;
$$;

revoke all on function matrimony_interest_state(uuid, uuid) from public, anon, authenticated;

-- Used by the matrimony-photos read policy: does the caller have a match
-- with the member who owns this storage folder? Callable by clients (a
-- storage policy runs as the caller), but only ever answers about the
-- caller's own matches.
create or replace function matrimony_photo_visible(p_owner_uid text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from matrimony_profiles mine
    join people me on me.id = mine.person_id
    join people owner on owner.auth_user_id::text = p_owner_uid
    join matrimony_profiles theirs on theirs.person_id = owner.id
    where me.auth_user_id = auth.uid()
      and matrimony_is_matched(mine.id, theirs.id)
  );
$$;

revoke all on function matrimony_photo_visible(text) from public, anon;
grant execute on function matrimony_photo_visible(text) to authenticated;

-- ================================================================
-- storage: matched members can read each other's photos
-- ================================================================

drop policy if exists "matrimony photo read" on storage.objects;
create policy "matrimony photo read"
  on storage.objects for select
  using (bucket_id = 'matrimony-photos'
         and (auth.uid()::text = (storage.foldername(name))[1]
              or public.is_admin()
              or public.matrimony_photo_visible((storage.foldername(name))[1])));

-- ================================================================
-- Phase 6b (0024): browse
-- ================================================================

-- Browsable profiles for the caller: approved, eligible now, opposite
-- gender, not the caller. Card fields only -- first name and surname
-- initial, never contact or photos. Newest approvals first. Returns
-- nothing unless the caller's own profile is live.
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

-- States and cities present among the profiles the caller can browse.
create or replace function matrimony_filter_options()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select m.id, p.gender
    from matrimony_profiles m join people p on p.id = m.person_id
    where m.id = matrimony_my_live_profile_id()
  ),
  visible as (
    select p.current_state, p.current_city
    from matrimony_profiles m
    join people p on p.id = m.person_id
    cross join me
    where m.status = 'approved' and m.id <> me.id
      and p.gender in ('Male', 'Female') and p.gender <> me.gender
      and matrimony_ineligible_reason(p.member_status, p.dob, p.gender, p.marital_status) is null
  )
  select jsonb_build_object(
    'states', coalesce((select jsonb_agg(distinct current_state order by current_state)
                        from visible where current_state is not null), '[]'::jsonb),
    'cities', coalesce((select jsonb_agg(distinct current_city order by current_city)
                        from visible where current_city is not null), '[]'::jsonb)
  );
$$;

revoke all on function matrimony_filter_options() from public;
grant execute on function matrimony_filter_options() to authenticated;

-- One profile, as the caller may see it. Visible when it is browsable
-- (approved, eligible, opposite gender) or already matched with the
-- caller. The unlocked block -- full name, parents, native place, email,
-- mobile (null when hide_mobile) and photo paths -- is added only when
-- matched. Null for anything the caller may not see.
create or replace function get_matrimony_profile(p_profile_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me uuid := matrimony_my_live_profile_id();
  v_my_gender text;
  v_matched boolean;
  v_result jsonb;
  v_person people%rowtype;
  v_profile matrimony_profiles%rowtype;
begin
  if v_me is null or p_profile_id is null or p_profile_id = v_me then
    return null;
  end if;

  select p.gender into v_my_gender
  from matrimony_profiles m join people p on p.id = m.person_id where m.id = v_me;

  select * into v_profile from matrimony_profiles where id = p_profile_id;
  if not found then
    return null;
  end if;
  select * into v_person from people where id = v_profile.person_id;

  v_matched := matrimony_is_matched(v_me, p_profile_id);
  if not v_matched and not (
       v_profile.status = 'approved'
       and v_person.gender in ('Male', 'Female') and v_person.gender <> v_my_gender
       and matrimony_ineligible_reason(v_person.member_status, v_person.dob, v_person.gender,
                                       v_person.marital_status) is null) then
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

-- ================================================================
-- Phase 6b (0024): interests
-- ================================================================

-- Send interest. Returns 'sent', or 'matched' when the other person had
-- already sent theirs (it is accepted instead of crossing). A previously
-- withdrawn interest is revived; a declined one is refused with the same
-- wording as an already-pending one, so a decline stays silent.
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
  -- Visibility check (approved, eligible, opposite gender) in one place.
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

-- The sender takes back an unanswered interest.
create or replace function withdraw_interest(p_interest_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update matrimony_interests i
  set status = 'withdrawn'
  from matrimony_profiles m, people p
  where i.id = p_interest_id
    and i.status = 'pending'
    and m.id = i.from_profile_id
    and p.id = m.person_id
    and p.auth_user_id = auth.uid();
  if not found then
    raise exception 'This interest can no longer be withdrawn';
  end if;
end;
$$;

revoke all on function withdraw_interest(uuid) from public;
grant execute on function withdraw_interest(uuid) to authenticated;

-- The recipient accepts (-> match, everything unlocks) or declines (the
-- sender only ever sees "no response"). Accepting needs both profiles to
-- still be live.
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
    raise exception 'Your matrimony profile needs to be live to reply';
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

-- The caller's interests, one box at a time:
--   received -- pending interests to me from profiles that are still live
--   sent     -- my pending interests, plus declined ones shown as
--               'no_response' (never 'declined')
--   matches  -- accepted, either direction, with the other person's main
--               photo path
-- is_new drives the badge: an unseen received interest, or (sender side) an
-- unseen acceptance.
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
           i.from_profile_id = me.id as outgoing
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
  where p_box <> 'received'
     or (o.status = 'approved'
         and matrimony_ineligible_reason(p.member_status, p.dob, p.gender,
                                         p.marital_status) is null)
  order by coalesce(r.responded_at, r.created_at) desc, r.id asc;
$$;

revoke all on function list_my_interests(text) from public;
grant execute on function list_my_interests(text) to authenticated;

-- Clear the "new" flags for one box once the member has looked at it.
create or replace function mark_interests_seen(p_box text)
returns void
language sql
security definer
set search_path = public
as $$
  with me as (
    select m.id from matrimony_profiles m join people p on p.id = m.person_id
    where p.auth_user_id = auth.uid()
  )
  update matrimony_interests i
  set recipient_seen_at = case when p_box = 'received' then now() else i.recipient_seen_at end,
      sender_seen_at = case when p_box = 'matches' then now() else i.sender_seen_at end
  from me
  where (p_box = 'received' and i.to_profile_id = me.id and i.status = 'pending'
         and i.recipient_seen_at is null)
     or (p_box = 'matches' and i.from_profile_id = me.id and i.status = 'accepted'
         and i.sender_seen_at is null);
$$;

revoke all on function mark_interests_seen(text) from public;
grant execute on function mark_interests_seen(text) to authenticated;

-- The badge: unseen received interests from live profiles + unseen
-- acceptances of the caller's own interests. 0 with no profile.
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
       and matrimony_ineligible_reason(p.member_status, p.dob, p.gender, p.marital_status) is null)
    +
    (select count(*) from matrimony_interests i cross join me
     where i.from_profile_id = me.id and i.status = 'accepted' and i.sender_seen_at is null)
  )::int;
$$;

revoke all on function matrimony_badge_count() from public;
grant execute on function matrimony_badge_count() to authenticated;

-- ================================================================
-- verification (run these after applying)
-- ================================================================
-- select relname, relrowsecurity from pg_class where relname = 'matrimony_interests';
--   -- true
-- select proname from pg_proc
-- where proname in ('list_matrimony_profiles', 'matrimony_filter_options',
--                   'get_matrimony_profile', 'express_interest', 'withdraw_interest',
--                   'respond_interest', 'list_my_interests', 'mark_interests_seen',
--                   'matrimony_badge_count', 'matrimony_photo_visible');
--   -- 10 rows
-- select has_function_privilege('authenticated', 'matrimony_is_matched(uuid,uuid)', 'execute');
--   -- false
-- select has_function_privilege('authenticated', 'matrimony_my_live_profile_id()', 'execute');
--   -- false
--
-- Then, signed in as a member in the browser console:
--   await supabase.from('matrimony_interests').select()      -- [] (no policies)
--   await supabase.rpc('get_matrimony_profile', { p_profile_id: '<unmatched id>' })
--     -- no `contact` block (null)
--   await supabase.storage.from('matrimony-photos').createSignedUrl('<their path>', 60)
--     -- error until matched, works after
