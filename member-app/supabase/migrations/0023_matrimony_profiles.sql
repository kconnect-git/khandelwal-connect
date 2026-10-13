-- Phase 6a: matrimony profiles, photos and admin verification.
--
--   * matrimony_profiles is rebuilt from the unused Phase 0 placeholder (no
--     rows, no readers). Self only: one profile per approved member.
--     draft -> pending -> approved / changes_requested / rejected. Invisible
--     to other members until approved (browse arrives in 6b). Editing an
--     approved profile does not send it back for review.
--   * Opt-in details (diet, smoking, drinking, horoscope) are nullable
--     columns: null = not disclosed. Nothing is defaulted or copied from
--     people -- not even birth_place.
--   * matrimony_photos: 0-3 per profile in the private matrimony-photos
--     bucket. Readable by the owner and admins only for now; 6b adds "and a
--     mutual match".
--   * Eligibility (approved member, 18+, Male/Female, not Married) lives in
--     one function and is checked at submit and approval, and -- from 6b --
--     at read time, so a member who marries or loses approval drops out.
--   * Both tables RPC-only, like events and notices: RLS on, no policies.
--   * Admin RPCs (any admin): admin_list_matrimony_profiles,
--     admin_get_matrimony_profile (audited as a view, since it shows
--     photos), admin_set_matrimony_status (audited).
--   * admin_list_audit_log resolves matrimony profiles to the member's name;
--     admin_overview_stats gains matrimony_pending / matrimony_approved.
--
-- ORDER OF DEPLOY: apply this migration, then the frontend.
--
-- Pre-check: `select count(*) from matrimony_profiles;` and the same for
-- matrimony_interests must both be 0 -- this drops them.
--
-- Also confirm the matrimony-photos bucket is *private* (Storage > Buckets);
-- Phase 0 created it that way.
--
-- Run manually in the Supabase SQL editor -- this repo's migrations are not
-- wired to a runner (see 0001_init.sql).
--
-- Function bodies below are extracted verbatim from ddl/core_schema.sql.

-- ================================================================
-- tables
-- ================================================================

-- The Phase 0 placeholders. matrimony_interests references nothing new yet;
-- 6b rebuilds it against matrimony_profiles, so drop it now rather than
-- leave a table keyed on people that nothing will use.
--
-- Re-runnable: dependants are dropped first, so a second run (after a
-- partial or complete first one) starts clean. That also discards any
-- matrimony data -- only re-run before real profiles exist.
drop table if exists matrimony_interests;
drop table if exists matrimony_photos;
drop table if exists matrimony_profiles;

create table matrimony_profiles (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null unique references people(id) on delete cascade,
  status text not null default 'draft'
    check (status in ('draft', 'pending', 'changes_requested', 'approved', 'rejected')),
  height_cm int check (height_cm is null or height_cm between 120 and 230),
  about_me text check (about_me is null or length(about_me) <= 1000),
  about_family text check (about_family is null or length(about_family) <= 600),
  partner_expectations text
    check (partner_expectations is null or length(partner_expectations) <= 600),
  -- Opt-in details. Null = the member chose not to disclose it.
  diet text
    check (diet is null or diet in ('Vegetarian', 'Jain', 'Eggetarian', 'Non-vegetarian')),
  smoking text check (smoking is null or smoking in ('Never', 'Occasionally', 'Yes')),
  drinking text check (drinking is null or drinking in ('Never', 'Occasionally', 'Yes')),
  birth_time time,
  birth_place text check (birth_place is null or length(birth_place) <= 100),
  rashi text check (rashi is null or rashi in (
    'Mesh', 'Vrishabh', 'Mithun', 'Kark', 'Simha', 'Kanya',
    'Tula', 'Vrishchik', 'Dhanu', 'Makar', 'Kumbh', 'Meen')),
  nakshatra text check (nakshatra is null or nakshatra in (
    'Ashwini', 'Bharani', 'Krittika', 'Rohini', 'Mrigashira', 'Ardra', 'Punarvasu',
    'Pushya', 'Ashlesha', 'Magha', 'Purva Phalguni', 'Uttara Phalguni', 'Hasta',
    'Chitra', 'Swati', 'Vishakha', 'Anuradha', 'Jyeshtha', 'Mula', 'Purva Ashadha',
    'Uttara Ashadha', 'Shravana', 'Dhanishta', 'Shatabhisha', 'Purva Bhadrapada',
    'Uttara Bhadrapada', 'Revati')),
  -- The admin's "what to change" note or rejection reason; which one is
  -- implied by the status, as with people.admin_message.
  review_note text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The admin queue filters by status and orders by submitted_at.
create index matrimony_profiles_status_idx on matrimony_profiles (status, submitted_at);

create table matrimony_photos (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references matrimony_profiles(id) on delete cascade,
  -- {auth uid}/{uuid}.jpg inside the matrimony-photos bucket.
  storage_path text not null unique,
  -- 1 = the main photo. Deferrable so a reorder can permute positions in a
  -- single UPDATE without tripping over itself mid-statement.
  position int not null check (position between 1 and 3),
  created_at timestamptz not null default now(),
  constraint matrimony_photos_position_key unique (profile_id, position)
    deferrable initially immediate
);

alter table matrimony_profiles enable row level security;
alter table matrimony_photos enable row level security;

-- ================================================================
-- storage: matrimony-photos
-- ================================================================

-- Phase 0 created only the owner-upload policy. Owners also need to read
-- (their own preview), and delete when they remove a photo; admins read to
-- verify. 6b widens the read policy to mutual matches.
drop policy if exists "matrimony photo read" on storage.objects;
drop policy if exists "own matrimony photo delete" on storage.objects;
create policy "matrimony photo read"
  on storage.objects for select
  using (bucket_id = 'matrimony-photos'
         and (auth.uid()::text = (storage.foldername(name))[1] or public.is_admin()));

create policy "own matrimony photo delete"
  on storage.objects for delete
  using (bucket_id = 'matrimony-photos' and auth.uid()::text = (storage.foldername(name))[1]);

-- ================================================================
-- existing functions that learn about matrimony
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
    'matrimony_approved', (select count(*) from matrimony_profiles where status = 'approved')
  )
  where is_admin();
$$;

revoke all on function admin_overview_stats() from public;
grant execute on function admin_overview_stats() to authenticated;

-- ================================================================
-- Phase 6a (0023): matrimony profiles
-- ================================================================

-- Why this person can't have a live matrimony profile, or null if they can.
-- The one eligibility rule, used at submit, at approval and (6b) at read
-- time. Not client-callable.
create or replace function matrimony_ineligible_reason(
  p_member_status text,
  p_dob date,
  p_gender text,
  p_marital_status text
)
returns text
language sql
stable
as $$
  select case
    when p_member_status is distinct from 'approved'
      then 'Your membership needs to be approved first.'
    when p_dob is null
      then 'Add your date of birth on your profile first.'
    when p_dob > (current_date - interval '18 years')::date
      then 'You need to be 18 or older.'
    when p_gender is null or p_gender not in ('Male', 'Female')
      then 'Set your gender to Male or Female on your profile.'
    when p_marital_status = 'Married'
      then 'Your profile says you are married.'
  end;
$$;

revoke all on function matrimony_ineligible_reason(text, date, text, text)
  from public, anon, authenticated;

-- Everything the owner's matrimony page needs in one call: the basics it
-- shows read-only from people, why they're ineligible (if they are), and
-- their profile + photos (null if they haven't started one).
create or replace function get_my_matrimony_profile()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'basics', jsonb_build_object(
      'first_name', p.first_name,
      'last_name', p.last_name,
      'full_name', p.full_name,
      'gender', p.gender,
      'dob', p.dob,
      'gotra', p.gotra,
      'current_city', p.current_city,
      'current_state', p.current_state,
      'education', p.education,
      'occupation_type', p.occupation_type,
      'marital_status', p.marital_status
    ),
    'ineligible_reason', matrimony_ineligible_reason(p.member_status, p.dob, p.gender,
                                                     p.marital_status),
    'profile', (select to_jsonb(m) from matrimony_profiles m where m.person_id = p.id),
    'photos', coalesce(
      (select jsonb_agg(jsonb_build_object('id', ph.id, 'storage_path', ph.storage_path,
                                           'position', ph.position)
                        order by ph.position)
       from matrimony_photos ph
       join matrimony_profiles m on m.id = ph.profile_id
       where m.person_id = p.id),
      '[]'::jsonb)
  )
  from people p
  where p.auth_user_id = auth.uid();
$$;

revoke all on function get_my_matrimony_profile() from public;
grant execute on function get_my_matrimony_profile() to authenticated;

-- The caller's profile id, creating a draft if they have none. Approved
-- members only. Not client-callable -- the save / photo RPCs use it.
create or replace function matrimony_own_profile_id()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person_id uuid;
  v_id uuid;
begin
  select id into v_person_id from people
  where auth_user_id = auth.uid() and member_status = 'approved';
  if not found then
    raise exception 'Only approved members can create a matrimony profile';
  end if;

  select id into v_id from matrimony_profiles where person_id = v_person_id;
  if v_id is null then
    insert into matrimony_profiles (person_id) values (v_person_id)
    on conflict (person_id) do nothing;
    select id into v_id from matrimony_profiles where person_id = v_person_id;
  end if;
  return v_id;
end;
$$;

revoke all on function matrimony_own_profile_id() from public, anon, authenticated;

-- Create or edit the caller's profile. Blank strings are stored as null
-- (= not disclosed). Leaves the status alone: a draft stays a draft, and an
-- approved profile stays approved -- edits after approval aren't re-reviewed.
-- A rejected profile is locked.
create or replace function save_my_matrimony_profile(
  p_height_cm int,
  p_about_me text,
  p_about_family text,
  p_partner_expectations text,
  p_diet text default null,
  p_smoking text default null,
  p_drinking text default null,
  p_birth_time time default null,
  p_birth_place text default null,
  p_rashi text default null,
  p_nakshatra text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := matrimony_own_profile_id();
  v_status text;
begin
  select status into v_status from matrimony_profiles where id = v_id for update;
  if v_status = 'rejected' then
    raise exception 'This profile was turned down and can no longer be edited';
  end if;
  if length(trim(coalesce(p_about_me, ''))) > 1000 then
    raise exception 'Keep "About me" to 1000 characters';
  end if;
  if length(trim(coalesce(p_about_family, ''))) > 600 then
    raise exception 'Keep "About my family" to 600 characters';
  end if;
  if length(trim(coalesce(p_partner_expectations, ''))) > 600 then
    raise exception 'Keep "What I''m looking for" to 600 characters';
  end if;

  -- Enum values and the height range are enforced by the table's check
  -- constraints; a bad value surfaces as a constraint error.
  update matrimony_profiles
  set height_cm = p_height_cm,
      about_me = nullif(trim(p_about_me), ''),
      about_family = nullif(trim(p_about_family), ''),
      partner_expectations = nullif(trim(p_partner_expectations), ''),
      diet = nullif(trim(p_diet), ''),
      smoking = nullif(trim(p_smoking), ''),
      drinking = nullif(trim(p_drinking), ''),
      birth_time = p_birth_time,
      birth_place = nullif(trim(p_birth_place), ''),
      rashi = nullif(trim(p_rashi), ''),
      nakshatra = nullif(trim(p_nakshatra), ''),
      updated_at = now()
  where id = v_id;
  return v_id;
end;
$$;

revoke all on function save_my_matrimony_profile(int, text, text, text, text, text, text, time, text, text, text) from public;
grant execute on function save_my_matrimony_profile(int, text, text, text, text, text, text, time, text, text, text) to authenticated;

-- draft / changes_requested -> pending. Checks eligibility and the two
-- required fields.
create or replace function submit_matrimony_profile()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person people%rowtype;
  v_profile matrimony_profiles%rowtype;
  v_reason text;
begin
  select * into v_person from people where auth_user_id = auth.uid();
  if not found then
    raise exception 'Profile not found';
  end if;
  v_reason := matrimony_ineligible_reason(v_person.member_status, v_person.dob,
                                          v_person.gender, v_person.marital_status);
  if v_reason is not null then
    raise exception '%', v_reason;
  end if;

  select * into v_profile from matrimony_profiles where person_id = v_person.id for update;
  if not found then
    raise exception 'Save your matrimony profile first';
  end if;
  if v_profile.status not in ('draft', 'changes_requested') then
    raise exception 'This profile has already been submitted';
  end if;
  if v_profile.height_cm is null then
    raise exception 'Please add your height';
  end if;
  if v_profile.about_me is null then
    raise exception 'Please write something in "About me"';
  end if;

  update matrimony_profiles
  set status = 'pending', submitted_at = now(), updated_at = now()
  where id = v_profile.id;
end;
$$;

revoke all on function submit_matrimony_profile() from public;
grant execute on function submit_matrimony_profile() to authenticated;

-- Record a photo the client has just uploaded to
-- matrimony-photos/{auth uid}/... . Takes the next free position (max 3).
create or replace function add_matrimony_photo(p_storage_path text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid := matrimony_own_profile_id();
  v_position int;
  v_id uuid;
begin
  if p_storage_path is null
     or split_part(p_storage_path, '/', 1) <> auth.uid()::text
     or p_storage_path !~ '^[0-9a-f-]+/[A-Za-z0-9_-]+\.jpg$' then
    raise exception 'Invalid photo path';
  end if;
  if not exists (select 1 from storage.objects
                 where bucket_id = 'matrimony-photos' and name = p_storage_path) then
    raise exception 'Photo upload not found';
  end if;
  if (select status from matrimony_profiles where id = v_profile_id) = 'rejected' then
    raise exception 'This profile was turned down and can no longer be edited';
  end if;

  select min(n) into v_position
  from generate_series(1, 3) n
  where not exists (select 1 from matrimony_photos
                    where profile_id = v_profile_id and position = n);
  if v_position is null then
    raise exception 'You can add up to 3 photos';
  end if;

  insert into matrimony_photos (profile_id, storage_path, position)
  values (v_profile_id, p_storage_path, v_position)
  returning id into v_id;
  update matrimony_profiles set updated_at = now() where id = v_profile_id;
  return v_id;
end;
$$;

revoke all on function add_matrimony_photo(text) from public;
grant execute on function add_matrimony_photo(text) to authenticated;

-- Remove one of the caller's photos and close the gap in positions.
-- Returns the storage path so the client can delete the file itself
-- (owner delete policy above).
create or replace function remove_matrimony_photo(p_photo_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
  v_path text;
begin
  delete from matrimony_photos ph
  using matrimony_profiles m, people p
  where ph.id = p_photo_id
    and m.id = ph.profile_id
    and p.id = m.person_id
    and p.auth_user_id = auth.uid()
  returning ph.profile_id, ph.storage_path into v_profile_id, v_path;
  if v_path is null then
    raise exception 'Photo not found';
  end if;

  update matrimony_photos ph
  set position = r.n
  from (select id, row_number() over (order by position) as n
        from matrimony_photos where profile_id = v_profile_id) r
  where ph.id = r.id and ph.position <> r.n;
  update matrimony_profiles set updated_at = now() where id = v_profile_id;
  return v_path;
end;
$$;

revoke all on function remove_matrimony_photo(uuid) from public;
grant execute on function remove_matrimony_photo(uuid) to authenticated;

-- Put one of the caller's photos first (the main photo); the rest keep
-- their relative order.
create or replace function set_main_matrimony_photo(p_photo_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile_id uuid;
begin
  select ph.profile_id into v_profile_id
  from matrimony_photos ph
  join matrimony_profiles m on m.id = ph.profile_id
  join people p on p.id = m.person_id
  where ph.id = p_photo_id and p.auth_user_id = auth.uid();
  if v_profile_id is null then
    raise exception 'Photo not found';
  end if;

  -- The position key is deferrable, so it's checked at the end of this
  -- statement rather than row by row as the positions swap.
  update matrimony_photos ph
  set position = r.n
  from (select id,
               row_number() over (order by (id = p_photo_id) desc, position) as n
        from matrimony_photos where profile_id = v_profile_id) r
  where ph.id = r.id and ph.position <> r.n;
end;
$$;

revoke all on function set_main_matrimony_photo(uuid) from public;
grant execute on function set_main_matrimony_photo(uuid) to authenticated;

-- ---------------------------------------------------------------- admin

-- The verification queue. p_status null = all. Pending sorts oldest
-- submission first (it's a queue); the other tabs newest review first.
create or replace function admin_list_matrimony_profiles(
  p_status text default 'pending',
  p_search text default null,
  p_limit int default 25,
  p_offset int default 0
)
returns table (
  id uuid,
  person_id uuid,
  full_name text,
  member_code text,
  gender text,
  age int,
  current_city text,
  current_state text,
  gotra text,
  status text,
  photo_count int,
  ineligible_reason text,
  review_note text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by_name text,
  total_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, p.id, p.full_name, p.member_code, p.gender,
         date_part('year', age(p.dob))::int,
         p.current_city, p.current_state, p.gotra, m.status,
         (select count(*)::int from matrimony_photos ph where ph.profile_id = m.id),
         matrimony_ineligible_reason(p.member_status, p.dob, p.gender, p.marital_status),
         m.review_note, m.submitted_at, m.reviewed_at,
         (select r.full_name from people r where r.auth_user_id = m.reviewed_by),
         count(*) over ()
  from matrimony_profiles m
  join people p on p.id = m.person_id
  where is_admin()
    and (p_status is null or m.status = p_status)
    and (p_search is null or length(trim(p_search)) = 0
         or p.full_name ilike '%' || trim(p_search) || '%'
         or p.member_code ilike '%' || trim(p_search) || '%')
  order by
    case when m.status = 'pending' then m.submitted_at end asc nulls last,
    coalesce(m.reviewed_at, m.updated_at) desc,
    m.id asc
  limit least(greatest(coalesce(p_limit, 25), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function admin_list_matrimony_profiles(text, text, int, int) from public;
grant execute on function admin_list_matrimony_profiles(text, text, int, int) to authenticated;

-- One profile for the review screen: the matrimony fields, the member's
-- basics, photo paths and eligibility. Opening it shows private photos, so
-- it is audited as matrimony_profile_viewed -- at most once per admin per
-- profile per 10 minutes, so a reload doesn't flood the log.
create or replace function admin_get_matrimony_profile(p_profile_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_admin_person_id uuid;
begin
  if not is_admin() then
    raise exception 'Not an admin';
  end if;

  select to_jsonb(m) || jsonb_build_object(
           'full_name', p.full_name,
           'member_code', p.member_code,
           'gender', p.gender,
           'dob', p.dob,
           'gotra', p.gotra,
           'current_city', p.current_city,
           'current_state', p.current_state,
           'education', p.education,
           'occupation_type', p.occupation_type,
           'marital_status', p.marital_status,
           'member_status', p.member_status,
           'ineligible_reason', matrimony_ineligible_reason(p.member_status, p.dob, p.gender,
                                                            p.marital_status),
           'reviewed_by_name', (select r.full_name from people r
                                where r.auth_user_id = m.reviewed_by),
           'photos', coalesce(
             (select jsonb_agg(jsonb_build_object('id', ph.id, 'storage_path', ph.storage_path,
                                                  'position', ph.position)
                               order by ph.position)
              from matrimony_photos ph where ph.profile_id = m.id),
             '[]'::jsonb))
  into v_result
  from matrimony_profiles m
  join people p on p.id = m.person_id
  where m.id = p_profile_id;

  if v_result is null then
    return null;
  end if;

  select id into v_admin_person_id from people where auth_user_id = auth.uid();
  if not exists (select 1 from admin_audit_log
                 where action = 'matrimony_profile_viewed'
                   and target_id = p_profile_id
                   and admin_id is not distinct from v_admin_person_id
                   and created_at > now() - interval '10 minutes') then
    insert into admin_audit_log (admin_id, action, target_type, target_id, notes)
    values (v_admin_person_id, 'matrimony_profile_viewed', 'matrimony_profile', p_profile_id, null);
  end if;
  return v_result;
end;
$$;

revoke all on function admin_get_matrimony_profile(uuid) from public;
grant execute on function admin_get_matrimony_profile(uuid) to authenticated;

-- The review decision. pending -> approved / changes_requested / rejected;
-- an approved profile can also be sent back (changes_requested) or taken
-- down (rejected), since owners can edit it without re-review. A note is
-- required for anything but an approval -- the member sees it. Approving
-- re-checks eligibility. Audited as matrimony_<status>.
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
          or (v_profile.status = 'approved' and p_status <> 'approved')) then
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
-- verification (run these after applying)
-- ================================================================
-- select relname, relrowsecurity from pg_class
-- where relname in ('matrimony_profiles', 'matrimony_photos');
--   -- 2 rows, both true
-- select proname from pg_proc
-- where proname in ('get_my_matrimony_profile', 'save_my_matrimony_profile',
--                   'submit_matrimony_profile', 'add_matrimony_photo',
--                   'remove_matrimony_photo', 'set_main_matrimony_photo',
--                   'admin_list_matrimony_profiles', 'admin_get_matrimony_profile',
--                   'admin_set_matrimony_status');
--   -- 9 rows
-- select has_function_privilege('authenticated',
--   'matrimony_ineligible_reason(text,date,text,text)', 'execute');   -- false
-- select has_function_privilege('authenticated', 'matrimony_own_profile_id()', 'execute');
--   -- false
-- select policyname from pg_policies
-- where tablename = 'objects' and policyname like '%matrimony%';
--   -- 3 rows: own matrimony photo upload, matrimony photo read, own matrimony photo delete
--
-- Then, signed in as an ordinary member in the browser console:
--   await supabase.from('matrimony_profiles').select()         -- [] (no policies)
--   await supabase.rpc('admin_list_matrimony_profiles')        -- []
--   await supabase.rpc('admin_set_matrimony_status',
--     { p_profile_id: '<id>', p_status: 'approved' })          -- error: Not an admin
