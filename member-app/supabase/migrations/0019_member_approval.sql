-- Phase 5a: the member approval gate.
--
-- Until now "is a member" meant `member_code is not null` -- i.e. anyone who
-- finished the onboarding wizard. That is the gate in every cross-member RPC
-- and in the businesses / events read policies, and since 3a it also means
-- every such person can read every other member's mobile number. This
-- migration puts an admin between onboarding and access:
--
--   * people.member_status is the new gate. A member finishing the wizard
--     lands on 'pending' and sees a holding screen; an admin moves them to
--     'approved' (or asks for more information, or rejects with a reason).
--     Everyone who already has a member code is grandfathered to 'approved'
--     by the backfill below, so existing members notice nothing.
--   * A member code is still issued at wizard completion, not at approval.
--     It is deterministic (KHA-<state>-<last 4 of mobile>), every existing
--     member has one, and family linking resolves by it -- but with status as
--     the gate a pending person's code simply never surfaces to anyone.
--   * The status columns are write-protected by a trigger. `own row update`
--     on people is column-blind, so without it a member could approve
--     themselves through PostgREST -- and could already hand-pick their own
--     member_code, which this closes too.
--   * admins gains `role`. Moderators run the queues; super_admin is
--     additionally required to revoke an already-approved member.
--
-- Two shapes of gate are rewritten below, and the difference matters:
--   target gate -- "only show rows for approved people": stays inline, as
--                  `p.member_status = 'approved'`.
--   caller gate -- "only answer if the caller is approved": is_approved_member().
-- Eight of the directory / business read RPCs never checked the caller at
-- all, only the rows they returned, so they gain a caller gate here rather
-- than merely having one rewritten.
--
-- The 22 `create or replace` blocks that follow are unchanged apart from
-- their gate lines; they are reproduced in full only because Postgres has no
-- way to patch a predicate inside an existing function.
--
-- ORDER OF DEPLOY: apply this migration, then deploy the send-member-status
-- Edge Function, then the frontend. The new frontend against the old
-- database would read member_status as undefined and lock every member out.
--
-- Pre-check: `select count(*) from people where member_code is null;` -- those
-- rows stay 'onboarding' and are auto-submitted the next time that person
-- loads the app.
--
-- Run manually in the Supabase SQL editor -- this repo's migrations are not
-- wired to a runner (see 0001_init.sql).

-- ================================================================
-- columns
-- ================================================================

alter table people
  add column member_status text not null default 'onboarding'
    check (member_status in ('onboarding', 'pending', 'info_requested', 'approved', 'rejected')),
  add column admin_message text,
  add column submitted_at timestamptz,
  add column reviewed_by uuid references auth.users(id),
  add column reviewed_at timestamptz,
  add column hide_mobile boolean not null default false;

create index people_member_status_idx on people (member_status, submitted_at);

alter table admins
  add column role text not null default 'moderator'
    check (role in ('super_admin', 'moderator'));

-- ================================================================
-- backfill -- must run BEFORE the protect trigger exists
-- ================================================================
-- Everyone who already completed onboarding is grandfathered in. reviewed_by
-- stays null, which is the marker for "approved by this backfill, not by a
-- person". Rows without a code stay 'onboarding'.

update people
set member_status = 'approved',
    submitted_at = coalesce(submitted_at, created_at, now()),
    reviewed_at = now()
where member_code is not null;

-- Everyone seeded as an admin so far is the owner.
update admins set role = 'super_admin';

-- ================================================================
-- write protection for the review columns
-- ================================================================
-- (0019) `own row update` (enable_rls.sql) lets a member write any column of
-- their own row, which would let them approve themselves -- or, since Phase
-- 1, hand-pick their own member_code. PostgREST runs as `authenticated`;
-- every SECURITY DEFINER RPC runs as the function owner, so this blocks the
-- client path only and leaves submit_for_review / admin_set_member_status
-- free to write these columns.
create or replace function people_protect_review_columns()
returns trigger
language plpgsql
as $$
begin
  if current_user = 'authenticated'
     and (new.member_status, new.admin_message, new.submitted_at,
          new.reviewed_by, new.reviewed_at, new.member_code)
         is distinct from
         (old.member_status, old.admin_message, old.submitted_at,
          old.reviewed_by, old.reviewed_at, old.member_code) then
    raise exception 'These fields can only be changed through the review process';
  end if;
  return new;
end;
$$;

create trigger people_protect_review_columns
  before update on people
  for each row execute function people_protect_review_columns();

-- ================================================================
-- gate helpers
-- ================================================================
-- is_admin() is unchanged from 0018 and is not recreated here. In
-- ddl/core_schema.sql it moved above the directory RPCs, because
-- get_member_profile now calls it and SQL-language bodies are parsed at
-- creation time; in an existing database it already exists, so ordering is
-- only a concern for a fresh run of the mirror.

-- (0019) Null for a non-admin, so it doubles as "am I an admin, and which
-- kind". is_admin() is deliberately left alone -- it is used inside RLS and
-- a dozen RPCs, and every role gets those.
create or replace function admin_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from admins where auth_user_id = auth.uid();
$$;

revoke all on function admin_role() from public;
grant execute on function admin_role() to authenticated;

-- (0019) The caller-side membership gate. Before 0019 every RPC below
-- open-coded `member_code is not null`; the hard approval gate made that
-- wrong in two ways -- a pending member now holds a code, and eight of these
-- read RPCs never checked the *caller* at all, only the rows returned. Row
-- predicates stay inline as `p.member_status = 'approved'`; this helper is
-- for the plain boolean caller checks, including the two RLS policies.
create or replace function is_approved_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from people
    where auth_user_id = auth.uid() and member_status = 'approved'
  );
$$;

revoke all on function is_approved_member() from public;
grant execute on function is_approved_member() to authenticated;

-- ================================================================
-- member code + submission
-- ================================================================

-- Generates and persists a KHA-<state_code>-<4 digits> member code for the
-- calling user's own row. The 4-digit part starts as the last 4 digits of
-- mobile_number; on a collision within the same state_code it walks
-- forward (last4 + 1, +2, ... wrapping at 10000) until it finds a free
-- slot. security definer so it can see across other members' rows to check
-- for collisions despite RLS restricting normal reads to a caller's own
-- row -- it only ever writes to the caller's own row (found via auth.uid()).
-- Idempotent: returns the existing code if one is already assigned.
-- (0019) Split in two: the collision walk now takes a person id so that
-- admin_set_member_status can issue a code for somebody else on approval
-- (a safety net -- in practice the code is already there from the wizard).
-- assign_member_code() below is the unchanged caller-facing wrapper.
create or replace function assign_member_code_for(p_person_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person_id uuid;
  v_mobile text;
  v_state_code text;
  v_existing_code text;
  v_last4 int;
  v_candidate text;
  v_offset int;
begin
  select id, mobile_number, state_code, member_code
    into v_person_id, v_mobile, v_state_code, v_existing_code
  from people
  where id = p_person_id;

  if v_person_id is null then
    raise exception 'No person row for the current user';
  end if;

  if v_existing_code is not null then
    return v_existing_code;
  end if;

  if v_state_code is null or v_state_code !~ '^[A-Z]{2}$' then
    raise exception 'state_code must be set before a member code can be assigned';
  end if;

  if v_mobile is null or length(regexp_replace(v_mobile, '\D', '', 'g')) < 4 then
    raise exception 'mobile_number must be set before a member code can be assigned';
  end if;

  v_last4 := right(regexp_replace(v_mobile, '\D', '', 'g'), 4)::int;

  for v_offset in 0..9999 loop
    v_candidate := 'KHA-' || v_state_code || '-' ||
      lpad((((v_last4 + v_offset) % 10000))::text, 4, '0');

    if not exists (
      select 1 from people
      where state_code = v_state_code
        and member_code = v_candidate
    ) then
      begin
        update people set member_code = v_candidate where id = v_person_id;
        return v_candidate;
      exception when unique_violation then
        null;
      end;
    end if;
  end loop;

  raise exception 'Could not assign a unique member code for state %', v_state_code;
end;
$$;

-- Not granted to authenticated: reachable only through the wrapper below and
-- through submit_for_review / admin_set_member_status.
revoke all on function assign_member_code_for(uuid) from public;

create or replace function assign_member_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person_id uuid;
begin
  select id into v_person_id from people where auth_user_id = auth.uid();
  if v_person_id is null then
    raise exception 'No person row for the current user';
  end if;
  return assign_member_code_for(v_person_id);
end;
$$;

revoke all on function assign_member_code() from public;
grant execute on function assign_member_code() to authenticated;

-- (0019) The member's side of the approval gate, and the only way a row
-- leaves 'onboarding' or 'info_requested'. Three callers: the wizard's
-- Finish (via complete_onboarding_step3), the lazy backfill in
-- useProfileStatus, and the "Resubmit for review" button on /pending.
-- Idempotent for an already-approved member so the lazy path is safe to
-- call on every load.
--
-- The field check mirrors isWizardComplete() in lib/profileCompletion.ts --
-- the 12 requiredForWizard fields. last_name is deliberately excluded there
-- (0017 backfilled name parts by splitting full_name, so single-word names
-- would otherwise be stuck), so it is excluded here too.
create or replace function submit_for_review()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person people%rowtype;
  v_code text;
begin
  select * into v_person from people where auth_user_id = auth.uid() for update;
  if not found then
    raise exception 'No person row for the current user';
  end if;

  if v_person.member_status = 'approved' then
    return v_person.member_code;
  end if;
  if v_person.member_status = 'rejected' then
    raise exception 'This application was declined. Please contact the mandal.';
  end if;

  if v_person.first_name is null or v_person.gender is null or v_person.dob is null
     or v_person.mobile_number is null or v_person.home_address is null
     or v_person.current_city is null or v_person.current_district is null
     or v_person.current_state is null or v_person.native_place is null
     or v_person.gotra is null or v_person.marital_status is null
     or v_person.education is null then
    raise exception 'Complete your profile before submitting it for review';
  end if;

  v_code := assign_member_code_for(v_person.id);

  update people
  set member_status = 'pending', submitted_at = now(), updated_at = now()
  where id = v_person.id;

  return v_code;
end;
$$;

revoke all on function submit_for_review() from public;
grant execute on function submit_for_review() to authenticated;

-- Called once, when the onboarding wizard's step 3 "Finish" is clicked:
-- saves the step-3 fields and generates the member code in the same
-- database round trip. (0019) It now also submits the profile for review, so
-- the member lands on /pending rather than the dashboard. Signature and
-- return value are unchanged -- the wizard still gets the member code back.
create or replace function complete_onboarding_step3(
  p_gotra text,
  p_marital_status text,
  p_education text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person_id uuid;
begin
  select id into v_person_id
  from people
  where auth_user_id = auth.uid();

  if v_person_id is null then
    raise exception 'No person row for the current user';
  end if;

  update people
  set gotra = p_gotra, marital_status = p_marital_status, education = p_education
  where id = v_person_id;

  return submit_for_review();
end;
$$;

revoke all on function complete_onboarding_step3(text, text, text) from public;
grant execute on function complete_onboarding_step3(text, text, text) to authenticated;

-- ================================================================
-- policies
-- ================================================================

drop policy "members read businesses" on businesses;
create policy "members read businesses" on businesses for select
  using (is_approved_member()
         or owner_id in (select id from people where auth_user_id = auth.uid()));

drop policy "events visible read" on events;
create policy "events visible read" on events for select
  using (
    (status in ('approved', 'cancelled') and visibility = 'members'
       and is_approved_member())
    or creator_id in (select id from people where auth_user_id = auth.uid())
    or exists (select 1 from event_invites i join people p on p.id = i.person_id
               where i.event_id = events.id and p.auth_user_id = auth.uid())
    or is_admin()
  );

-- ================================================================
-- regated RPCs: family
-- ================================================================

-- Directory-style lookup used to disambiguate common names before saving a
-- relation: only returns people who already completed onboarding (have a
-- member_code), and only limited fields -- not a general table read. SECURITY
-- DEFINER because it has to search across rows the caller doesn't own,
-- which self-only RLS on `people` otherwise blocks.
-- mobile_number added (0012): already printed on every member's profile
-- screen (get_member_profile), so returning it here too is not a new
-- exposure. dob deliberately stays out of this list -- see 0012's header.
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
         case when p.hide_mobile then null else p.mobile_number end
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

-- Rewritten as an upsert into family_relations. Much shorter than the old
-- 6-way if/elsif over 6x5 people columns -- adding a 7th slot here is a
-- change to the check constraint above, not a new branch or new columns.
-- (0017) email / profession / blood_group added (spouse card).
create or replace function save_family_relation(
  p_slot text,
  p_name text,
  p_member_code text default null,
  p_mobile_number text default null,
  p_dob date default null,
  p_email text default null,
  p_profession text default null,
  p_blood_group text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_self_id uuid;
  v_matched_id uuid;
begin
  select id into v_self_id from people where auth_user_id = auth.uid();
  if v_self_id is null then
    raise exception 'No person row for the current user';
  end if;
  if p_slot not in ('father', 'mother', 'spouse', 'maternal_uncle', 'spouse_father', 'spouse_mother') then
    raise exception 'Invalid slot: %', p_slot;
  end if;

  if p_member_code is not null and length(trim(p_member_code)) > 0 then
    select id into v_matched_id from people where member_code = p_member_code and member_status = 'approved';
    if v_matched_id is null then
      raise exception 'No registered member found with code %', p_member_code;
    end if;
  else
    v_matched_id := null;
    p_member_code := null;
  end if;

  insert into family_relations (person_id, slot, related_name, related_member_code, related_id,
                                mobile_number, dob, email, profession, blood_group)
  values (v_self_id, p_slot, p_name, p_member_code, v_matched_id,
          normalize_relative_mobile(p_mobile_number), check_relative_dob(p_dob),
          normalize_optional_email(p_email), nullif(trim(p_profession), ''), nullif(trim(p_blood_group), ''))
  on conflict (person_id, slot) do update
    set related_name = excluded.related_name,
        related_member_code = excluded.related_member_code,
        related_id = excluded.related_id,
        mobile_number = excluded.mobile_number,
        dob = excluded.dob,
        email = excluded.email,
        profession = excluded.profession,
        blood_group = excluded.blood_group,
        updated_at = now();
end;
$$;

revoke all on function save_family_relation(text, text, text, text, date, text, text, text) from public;
grant execute on function save_family_relation(text, text, text, text, date, text, text, text) to authenticated;

-- (0015) self-lookup simplified: the unique auth_user_id constraint (see
-- the people table above) makes the old order-by-and-limit-1 tiebreak
-- unnecessary. (0017) six child-detail params added.
create or replace function add_child(
  p_name text,
  p_member_code text default null,
  p_mobile_number text default null,
  p_dob date default null,
  p_relation text default null,
  p_education text default null,
  p_profession text default null,
  p_marital_status text default null,
  p_spouse_name text default null,
  p_blood_group text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_self_id uuid;
  v_matched_id uuid;
  v_new_id uuid;
begin
  select id into v_self_id from people where auth_user_id = auth.uid();
  if v_self_id is null then
    raise exception 'No person row for the current user';
  end if;

  if p_member_code is not null and length(trim(p_member_code)) > 0 then
    select id into v_matched_id from people where member_code = p_member_code and member_status = 'approved';
    if v_matched_id is null then
      raise exception 'No registered member found with code %', p_member_code;
    end if;
  else
    v_matched_id := null;
    p_member_code := null;
  end if;

  insert into children (parent_person_id, child_name, child_member_code, child_id,
                        child_mobile_number, child_dob,
                        relation, education, profession, marital_status, spouse_name, blood_group)
  values (v_self_id, p_name, p_member_code, v_matched_id,
          normalize_relative_mobile(p_mobile_number), check_relative_dob(p_dob),
          nullif(trim(p_relation), ''), nullif(trim(p_education), ''), nullif(trim(p_profession), ''),
          nullif(trim(p_marital_status), ''), nullif(trim(p_spouse_name), ''), nullif(trim(p_blood_group), ''))
  returning id into v_new_id;

  return v_new_id;
end;
$$;

create or replace function update_child(
  p_child_row_id uuid,
  p_name text,
  p_member_code text default null,
  p_mobile_number text default null,
  p_dob date default null,
  p_relation text default null,
  p_education text default null,
  p_profession text default null,
  p_marital_status text default null,
  p_spouse_name text default null,
  p_blood_group text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_self_id uuid;
  v_matched_id uuid;
begin
  select id into v_self_id from people where auth_user_id = auth.uid();
  if v_self_id is null then
    raise exception 'No person row for the current user';
  end if;

  if p_member_code is not null and length(trim(p_member_code)) > 0 then
    select id into v_matched_id from people where member_code = p_member_code and member_status = 'approved';
    if v_matched_id is null then
      raise exception 'No registered member found with code %', p_member_code;
    end if;
  else
    v_matched_id := null;
    p_member_code := null;
  end if;

  update children
  set child_name = p_name, child_member_code = p_member_code, child_id = v_matched_id,
      child_mobile_number = normalize_relative_mobile(p_mobile_number),
      child_dob = check_relative_dob(p_dob),
      relation = nullif(trim(p_relation), ''),
      education = nullif(trim(p_education), ''),
      profession = nullif(trim(p_profession), ''),
      marital_status = nullif(trim(p_marital_status), ''),
      spouse_name = nullif(trim(p_spouse_name), ''),
      blood_group = nullif(trim(p_blood_group), ''),
      updated_at = now()
  where id = p_child_row_id and parent_person_id = v_self_id;

  if not found then
    raise exception 'Child record not found';
  end if;
end;
$$;

revoke all on function add_child(text, text, text, date, text, text, text, text, text, text) from public;
grant execute on function add_child(text, text, text, date, text, text, text, text, text, text) to authenticated;
revoke all on function update_child(uuid, text, text, text, date, text, text, text, text, text, text) from public;
grant execute on function update_child(uuid, text, text, text, date, text, text, text, text, text, text) to authenticated;

-- ================================================================
-- regated RPCs: directory
-- ================================================================

-- Paginated directory listing. Only members who completed onboarding (have a
-- member_code) appear -- same gate as search_registered_members. total_count
-- is the filtered total (window function), repeated on every row, so one
-- call gives both a page and the stat-block number.
-- (0013) occupation_type/job_title/company_name join the directory tier;
-- get_member_profile adds job_location; list_directory gains p_occupation.
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
  job_location text
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
         p.occupation_type, p.job_title, p.company_name, p.job_location
  from people p
  where p.id = p_person_id
    and (is_approved_member() or is_admin())
    and (p.member_status = 'approved' or is_admin());
$$;

revoke all on function get_member_profile(uuid) from public;
grant execute on function get_member_profile(uuid) to authenticated;

-- Same (kind, value) shape as before, plus an 'occupation' kind. Column
-- list is unchanged, so create or replace is fine here.
create or replace function directory_filter_options()
returns table (kind text, value text)
language sql
stable
security definer
set search_path = public
as $$
  select f.kind, f.value
  from (
    select 'state' as kind, p.current_state as value
    from people p where p.member_status = 'approved' and p.current_state is not null
    union
    select 'city', p.current_city
    from people p where p.member_status = 'approved' and p.current_city is not null
    union
    select 'gotra', p.gotra
    from people p where p.member_status = 'approved' and p.gotra is not null
    union
    select 'occupation', p.occupation_type
    from people p where p.member_status = 'approved' and p.occupation_type is not null
  ) f
  where is_approved_member()
  order by f.kind, f.value;
$$;

revoke all on function directory_filter_options() from public;
grant execute on function directory_filter_options() to authenticated;

-- ================================================================
-- regated RPCs: businesses
-- ================================================================

-- Paginated listing with the owner's directory-tier fields joined in. Same
-- total_count window-function shape as list_directory (0010). Only
-- businesses whose owner has completed onboarding appear.
create or replace function list_businesses(
  p_search text default null,
  p_category text default null,
  p_city text default null,
  p_state text default null,
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  id uuid,
  name text,
  category text,
  description text,
  city text,
  state text,
  contact_phone text,
  website text,
  logo_url text,
  owner_id uuid,
  owner_name text,
  owner_photo_url text,
  owner_member_code text,
  total_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select b.id, b.name, b.category, b.description, b.city, b.state,
         b.contact_phone, b.website, b.logo_url,
         p.id as owner_id, p.full_name as owner_name, p.profile_photo_url as owner_photo_url,
         p.member_code as owner_member_code,
         count(*) over () as total_count
  from businesses b
  join people p on p.id = b.owner_id
  where is_approved_member()
    and p.member_status = 'approved'
    and (p_search is null or length(trim(p_search)) = 0
         or b.name ilike '%' || p_search || '%'
         or p.full_name ilike '%' || p_search || '%')
    and (p_category is null or b.category = p_category)
    and (p_city is null or b.city ilike p_city)
    and (p_state is null or b.state ilike p_state)
  order by b.name asc, b.id asc
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function list_businesses(text, text, text, text, int, int) from public;
grant execute on function list_businesses(text, text, text, text, int, int) to authenticated;

-- One listing: the card columns plus the (0017) detail columns. Zero rows
-- if unknown or the owner hasn't completed onboarding.
create or replace function get_business(p_business_id uuid)
returns table (
  id uuid,
  name text,
  category text,
  description text,
  city text,
  state text,
  contact_phone text,
  website text,
  logo_url text,
  brand_name text,
  address_line1 text,
  address_line2 text,
  business_email text,
  primary_product text,
  business_type text,
  facebook_url text,
  instagram_url text,
  linkedin_url text,
  youtube_url text,
  owner_id uuid,
  owner_name text,
  owner_photo_url text,
  owner_member_code text
)
language sql
stable
security definer
set search_path = public
as $$
  select b.id, b.name, b.category, b.description, b.city, b.state,
         b.contact_phone, b.website, b.logo_url,
         b.brand_name, b.address_line1, b.address_line2, b.business_email,
         b.primary_product, b.business_type,
         b.facebook_url, b.instagram_url, b.linkedin_url, b.youtube_url,
         p.id, p.full_name, p.profile_photo_url, p.member_code
  from businesses b
  join people p on p.id = b.owner_id
  where b.id = p_business_id
    and is_approved_member()
    and p.member_status = 'approved';
$$;

revoke all on function get_business(uuid) from public;
grant execute on function get_business(uuid) to authenticated;

-- A member's listings, for the BUSINESSES section on their profile screen.
create or replace function list_member_businesses(p_person_id uuid)
returns table (
  id uuid,
  name text,
  category text,
  city text,
  logo_url text
)
language sql
stable
security definer
set search_path = public
as $$
  select b.id, b.name, b.category, b.city, b.logo_url
  from businesses b
  join people p on p.id = b.owner_id
  where b.owner_id = p_person_id
    and is_approved_member()
    and p.member_status = 'approved'
  order by b.name asc, b.id asc;
$$;

revoke all on function list_member_businesses(uuid) from public;
grant execute on function list_member_businesses(uuid) to authenticated;

-- Distinct chip values actually present, same (kind, value) shape as
-- directory_filter_options.
create or replace function business_filter_options()
returns table (kind text, value text)
language sql
stable
security definer
set search_path = public
as $$
  select f.kind, f.value
  from (
    select 'category' as kind, b.category as value
    from businesses b join people p on p.id = b.owner_id
    where p.member_status = 'approved' and b.category is not null
    union
    select 'city', b.city
    from businesses b join people p on p.id = b.owner_id
    where p.member_status = 'approved' and b.city is not null
    union
    select 'state', b.state
    from businesses b join people p on p.id = b.owner_id
    where p.member_status = 'approved' and b.state is not null
  ) f
  where is_approved_member()
  order by f.kind, f.value;
$$;

revoke all on function business_filter_options() from public;
grant execute on function business_filter_options() to authenticated;

-- ================================================================
-- regated RPCs: events
-- ================================================================
-- Each of these changes exactly one line: the `me` CTE / v_self_id lookup
-- (and one target check in add_event_invitee) now tests member_status.

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
    select id from people where auth_user_id = auth.uid() and member_status = 'approved'
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
    select id from people where auth_user_id = auth.uid() and member_status = 'approved'
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
    select (select id from people where auth_user_id = auth.uid() and member_status = 'approved') as me_id,
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
    select id from people where auth_user_id = auth.uid() and member_status = 'approved'
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
  select id into v_self_id from people where auth_user_id = auth.uid() and member_status = 'approved';
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
  select id into v_self_id from people where auth_user_id = auth.uid() and member_status = 'approved';
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
  select id into v_self_id from people where auth_user_id = auth.uid() and member_status = 'approved';
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

  select id into v_self_id from people where auth_user_id = auth.uid() and member_status = 'approved';
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
  select id into v_self_id from people where auth_user_id = auth.uid() and member_status = 'approved';
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
  if not exists (select 1 from people where id = p_person_id and member_status = 'approved') then
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
  select id into v_self_id from people where auth_user_id = auth.uid() and member_status = 'approved';
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

-- ================================================================
-- member approval RPCs
-- ================================================================

-- The admin queue. auth.users is joined for the login email -- `people` has
-- no primary email column (only secondary_email), the same reason
-- send-event-invite has to go through auth.admin.getUserById. Safe here
-- because the function is definer-owned and gated on is_admin().
--
-- Ordering: the two queues a human works through (pending, info_requested)
-- come oldest-first so nobody waits forever; the archive tabs come
-- most-recently-reviewed first.
create or replace function admin_list_members(
  p_status text default 'pending',
  p_search text default null,
  p_limit int default 20,
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
  select p.id, p.full_name, p.profile_photo_url, p.member_code,
         u.email::text, p.mobile_number,
         p.gotra, p.native_place, p.current_city, p.current_state,
         p.member_status, p.admin_message,
         p.submitted_at, p.reviewed_at, p.created_at,
         count(*) over () as total_count
  from people p
  left join auth.users u on u.id = p.auth_user_id
  where is_admin()
    and p.member_status = p_status
    and (p_search is null or length(trim(p_search)) = 0
         or p.full_name ilike '%' || p_search || '%'
         or p.member_code ilike '%' || p_search || '%'
         or p.mobile_number like '%' || p_search || '%')
  order by case when p_status in ('pending', 'info_requested') then p.submitted_at end asc,
           p.reviewed_at desc nulls last, p.full_name asc, p.id asc
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function admin_list_members(text, text, int, int) from public;
grant execute on function admin_list_members(text, text, int, int) to authenticated;

-- Moderation, shaped like admin_set_event_status above. The state machine:
--
--   pending / info_requested -> approved | info_requested | rejected
--   rejected                 -> approved | info_requested   (admin reopens;
--                               the member cannot resubmit themselves)
--   approved                 -> rejected                    (revocation,
--                               super_admin only)
--
-- 'onboarding' rows are not reviewable -- that person hasn't submitted yet.
-- Approving clears admin_message and issues a member code if one is somehow
-- missing; rejecting or asking for more information requires a message,
-- which is what the member sees on /pending.
create or replace function admin_set_member_status(
  p_person_id uuid,
  p_status text,
  p_message text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person people%rowtype;
  v_admin_person_id uuid;
begin
  if not is_admin() then
    raise exception 'Not an admin';
  end if;
  if p_status not in ('approved', 'info_requested', 'rejected') then
    raise exception 'Invalid status: %', p_status;
  end if;

  select * into v_person from people where id = p_person_id for update;
  if not found then
    raise exception 'Member not found';
  end if;
  if v_person.member_status = 'onboarding' then
    raise exception 'This person has not finished onboarding yet';
  end if;
  if v_person.member_status = p_status then
    raise exception 'This member is already %', p_status;
  end if;

  if p_status = 'approved' then
    perform assign_member_code_for(p_person_id);
    update people
    set member_status = 'approved', admin_message = null,
        reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
    where id = p_person_id;

  elsif p_status = 'info_requested' then
    if v_person.member_status = 'approved' then
      raise exception 'An approved member cannot be sent back for more information';
    end if;
    if p_message is null or length(trim(p_message)) = 0 then
      raise exception 'Please say what information is needed';
    end if;
    update people
    set member_status = 'info_requested', admin_message = trim(p_message),
        reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
    where id = p_person_id;

  else
    if v_person.member_status = 'approved' and coalesce(admin_role(), '') <> 'super_admin' then
      raise exception 'Only a super admin can revoke an approved membership';
    end if;
    if p_message is null or length(trim(p_message)) = 0 then
      raise exception 'Please give a reason for rejecting';
    end if;
    update people
    set member_status = 'rejected', admin_message = trim(p_message),
        reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
    where id = p_person_id;
  end if;

  -- admin_audit_log.admin_id -> people(id) and is nullable: an admin with no
  -- people row of their own logs as null rather than failing the review.
  select id into v_admin_person_id from people where auth_user_id = auth.uid();
  insert into admin_audit_log (admin_id, action, target_type, target_id, notes)
  values (v_admin_person_id, 'member_' || p_status, 'person', p_person_id,
          nullif(trim(p_message), ''));
end;
$$;

revoke all on function admin_set_member_status(uuid, text, text) from public;
grant execute on function admin_set_member_status(uuid, text, text) to authenticated;

-- ================================================================
-- verification (run these after applying)
-- ================================================================
-- select member_status, count(*) from people group by 1;
--   -- 'approved' should equal the old count of member_code is not null,
--   -- the rest 'onboarding', and nothing 'pending' yet.
-- select count(*) from people where member_code is not null and member_status <> 'approved';
--   -- 0
-- select auth_user_id, role from admins;
--   -- every existing admin is super_admin
-- select proname from pg_proc
-- where proname in ('is_approved_member', 'admin_role', 'assign_member_code_for',
--                   'submit_for_review', 'admin_list_members', 'admin_set_member_status');
--   -- 6 rows
-- select policyname from pg_policies
-- where policyname in ('members read businesses', 'events visible read')
--   and qual like '%is_approved_member%';
--   -- 2 rows
-- select tgname from pg_trigger
-- where tgrelid = 'people'::regclass and tgname = 'people_protect_review_columns';
--   -- 1 row
-- select proname from pg_proc
-- where prosrc like '%member_code is not null%' and pronamespace = 'public'::regnamespace;
--   -- only the code-assignment / family-lookup parameter checks, no gates
--
-- Then, signed in as an ordinary member in the browser console:
--   await supabase.from('people').update({ member_status: 'approved' })
--     .eq('auth_user_id', (await supabase.auth.getUser()).data.user.id)
--   -- must fail with "These fields can only be changed through the review process"
