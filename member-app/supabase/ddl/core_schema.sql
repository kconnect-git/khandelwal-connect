create table people (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid references auth.users(id),
  full_name text not null,
  gender text,
  dob date,
  gotra text,
  native_place text,
  current_district text,
  current_state text,
  state_code text check (state_code is null or state_code ~ '^[A-Z]{2}$'),
  member_code text unique check (member_code is null or member_code ~ '^KHA-[A-Z]{2}-\d{4}$'),
  -- Added in migration 0002 (Phase 1) after a dedupe pass; this file never
  -- reflected it until a live schema introspection turned up the drift.
  -- Guarantees at most one people row per auth account -- every self-lookup
  -- RPC below can do a plain `where auth_user_id = auth.uid()` with no
  -- tiebreak, and the client (getOwnPerson) can use .maybeSingle().
  father_id uuid references people(id),
  mother_id uuid references people(id),
  spouse_id uuid references people(id),
  current_city text,
  home_address text,
  marital_status text,
  education text,
  profile_photo_url text,
  mobile_number text,
  -- Phase 2 (family details, simplified -- see the Phase 2 plan): each
  -- single-valued relation is a plain-text name plus an optional member
  -- code. The *_id FK is only ever set once *_member_code resolves to a
  -- real registered member (see save_family_relation below); it stays null
  -- for a plain-text-only entry.
  father_name text,
  father_member_code text,
  mother_name text,
  mother_member_code text,
  spouse_name text,
  spouse_member_code text,
  maternal_uncle_id uuid references people(id),
  maternal_uncle_name text,
  maternal_uncle_member_code text,
  spouse_father_id uuid references people(id),
  spouse_father_name text,
  spouse_father_member_code text,
  spouse_mother_id uuid references people(id),
  spouse_mother_name text,
  spouse_mother_member_code text,
  -- Post-3a (0011): the caller's own entries of each relative's mobile and
  -- dob. Never copied from / written to the relative's own row.
  father_mobile_number text,
  father_dob date,
  mother_mobile_number text,
  mother_dob date,
  spouse_mobile_number text,
  spouse_dob date,
  maternal_uncle_mobile_number text,
  maternal_uncle_dob date,
  spouse_father_mobile_number text,
  spouse_father_dob date,
  spouse_mother_mobile_number text,
  spouse_mother_dob date,
  -- Phase 3b (0013): fixed occupation select (Edit profile only, never the
  -- wizard) + job sub-fields that only apply when occupation_type = Job.
  occupation_type text
    check (occupation_type is null
           or occupation_type in ('Business', 'Job', 'Student', 'Homemaker', 'Retired', 'Other')),
  job_title text,
  company_name text,
  job_location text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint people_auth_user_id_key unique (auth_user_id)
);

create index people_state_code_idx on people (state_code);

-- Children are multi-valued, so they get their own table rather than more
-- columns on `people`. Same name + member_code + resolved-id pattern as the
-- single-valued relations above, one row per child.
create table children (
  id uuid primary key default gen_random_uuid(),
  parent_person_id uuid references people(id) not null,
  child_name text not null,
  child_member_code text,
  child_id uuid references people(id),
  child_mobile_number text,
  child_dob date,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- (0015) children.parent_person_id is the RLS filter on every children
-- policy and the exact column getChildren() filters on every load.
create index children_parent_person_id_idx on children (parent_person_id);

create table family_relations (
  id uuid primary key default gen_random_uuid(),
  person_id uuid references people(id) not null,
  slot text not null check (slot in ('father', 'mother', 'spouse', 'maternal_uncle', 'spouse_father', 'spouse_mother')),
  related_name text,
  related_member_code text,
  related_id uuid references people(id),
  mobile_number text,
  dob date,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (person_id, slot)
);

create index family_relations_person_id_idx on family_relations (person_id);

alter table family_relations enable row level security;

-- Same self-scoped shape as children's policies (0006) -- everything here
-- is denormalized onto the caller's own person_id, so no cross-row read is
-- ever needed for these four.
create policy "own family relations read" on family_relations for select
  using (person_id in (select id from people where auth_user_id = auth.uid()));
create policy "own family relations insert" on family_relations for insert
  with check (person_id in (select id from people where auth_user_id = auth.uid()));
create policy "own family relations update" on family_relations for update
  using (person_id in (select id from people where auth_user_id = auth.uid()));
create policy "own family relations delete" on family_relations for delete
  using (person_id in (select id from people where auth_user_id = auth.uid()));

-- Generates and persists a KHA-<state_code>-<4 digits> member code for the
-- calling user's own row. The 4-digit part starts as the last 4 digits of
-- mobile_number; on a collision within the same state_code it walks
-- forward (last4 + 1, +2, ... wrapping at 10000) until it finds a free
-- slot. security definer so it can see across other members' rows to check
-- for collisions despite RLS restricting normal reads to a caller's own
-- row -- it only ever writes to the caller's own row (found via auth.uid()).
-- Idempotent: returns the existing code if one is already assigned.
create or replace function assign_member_code()
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
  where auth_user_id = auth.uid();

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

revoke all on function assign_member_code() from public;
grant execute on function assign_member_code() to authenticated;

-- Called once, when the onboarding wizard's step 3 "Finish" is clicked:
-- saves the step-3 fields and generates the member code in the same
-- database round trip.
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

  return assign_member_code();
end;
$$;

revoke all on function complete_onboarding_step3(text, text, text) from public;
grant execute on function complete_onboarding_step3(text, text, text) to authenticated;

-- Phase 3b (0014): one member <-> many listings. `type` was dropped -- the
-- per-person occupation now lives on people.occupation_type (0013).
-- Writes are plain client access under the RLS policies in enable_rls.sql;
-- reads for listing cards go through the RPCs appended at the end of this
-- file (owner join).
create table businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references people(id) not null,
  name text not null,
  category text,
  description text,
  city text,
  state text,
  contact_phone text
    check (contact_phone is null or contact_phone ~ '^\+91[6-9]\d{9}$'),
  website text,
  logo_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Mirrored by BUSINESS_CATEGORY_OPTIONS in src/lib/formOptions.ts.
alter table businesses
  add constraint businesses_category_check check (
    category is null or category in (
      'Retail', 'Wholesale & Distribution', 'Manufacturing', 'Jewellery',
      'Textiles & Garments', 'Real Estate & Construction', 'Finance & Accounting',
      'Legal', 'Healthcare', 'Education', 'IT & Software', 'Hospitality & Food',
      'Transport & Logistics', 'Agriculture', 'Other'
    )
  );

create index businesses_owner_id_idx on businesses (owner_id);

create table events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  location text,
  event_date timestamptz not null,
  capacity int,
  created_at timestamptz default now()
);

create table rsvps (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) not null,
  person_id uuid references people(id) not null,
  status text default 'going',
  created_at timestamptz default now(),
  unique(event_id, person_id)
);

create table matrimony_profiles (
  id uuid primary key default gen_random_uuid(),
  person_id uuid references people(id) unique not null,
  bio text,
  height text,
  profession text,
  opt_in_tags jsonb default '[]'::jsonb,
  verified_by_mandal boolean default false,
  created_at timestamptz default now()
);

create table matrimony_interests (
  id uuid primary key default gen_random_uuid(),
  from_person_id uuid references people(id) not null,
  to_person_id uuid references people(id) not null,
  status text default 'pending' check (status in ('pending','accepted','declined')),
  created_at timestamptz default now(),
  unique(from_person_id, to_person_id)
);

create table dues (
  id uuid primary key default gen_random_uuid(),
  person_id uuid references people(id) not null,
  fiscal_year text not null,
  amount_due numeric,
  amount_paid numeric default 0,
  status text default 'pending',
  created_at timestamptz default now()
);

create table admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references people(id),
  action text not null,
  target_type text,
  target_id uuid,
  notes text,
  created_at timestamptz default now()
);

-- Phase 2: family details RPCs (see migrations 0006/0007 for how these were
-- introduced).

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
  select p.id, p.full_name, p.gotra, p.native_place, p.current_city, p.current_state, p.member_code, p.mobile_number
  from people p
  where p.member_code is not null
    and length(trim(p_full_name)) >= 3
    and p.full_name ilike '%' || p_full_name || '%'
    and (p_gotra is null or p.gotra ilike p_gotra)
    and (p_native_place is null or p.native_place ilike '%' || p_native_place || '%')
  limit 20;
$$;

revoke all on function search_registered_members(text, text, text) from public;
grant execute on function search_registered_members(text, text, text) to authenticated;

-- Saves one of the single-valued relations (father/mother/spouse/
-- maternal_uncle/spouse_father/spouse_mother) on the caller's own row. Name
-- is always stored as plain text. If a member code is given, it must resolve
-- to a real registered member (checked here, since the caller can't read
-- other rows directly) -- on success the *_id FK is set alongside the
-- denormalized *_member_code; omitting the code clears any existing link.
-- Mobile/dob (0011) are optional plain entries about the relative.
--
-- Shared normalisation for the optional contact fields: blank -> null, and a
-- non-blank mobile must be the same +91 + 10 digits shape the wizard
-- enforces for the member's own number. dob may not be in the future.
create or replace function normalize_relative_mobile(p_mobile text)
returns text
language plpgsql
immutable
as $$
begin
  if p_mobile is null or length(trim(p_mobile)) = 0 then
    return null;
  end if;
  if trim(p_mobile) !~ '^\+91[6-9]\d{9}$' then
    raise exception 'Mobile number must be +91 followed by 10 digits';
  end if;
  return trim(p_mobile);
end;
$$;

create or replace function check_relative_dob(p_dob date)
returns date
language plpgsql
stable
as $$
begin
  if p_dob is not null and p_dob > current_date then
    raise exception 'Date of birth cannot be in the future';
  end if;
  return p_dob;
end;
$$;

revoke all on function normalize_relative_mobile(text) from public;
revoke all on function check_relative_dob(date) from public;

-- Rewritten as an upsert into family_relations. Much shorter than the old
-- 6-way if/elsif over 6x5 people columns -- adding a 7th slot here is a
-- change to the check constraint above, not a new branch or new columns.
create or replace function save_family_relation(
  p_slot text,
  p_name text,
  p_member_code text default null,
  p_mobile_number text default null,
  p_dob date default null
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
    select id into v_matched_id from people where member_code = p_member_code;
    if v_matched_id is null then
      raise exception 'No registered member found with code %', p_member_code;
    end if;
  else
    v_matched_id := null;
    p_member_code := null;
  end if;

  insert into family_relations (person_id, slot, related_name, related_member_code, related_id, mobile_number, dob)
  values (v_self_id, p_slot, p_name, p_member_code, v_matched_id,
          normalize_relative_mobile(p_mobile_number), check_relative_dob(p_dob))
  on conflict (person_id, slot) do update
    set related_name = excluded.related_name,
        related_member_code = excluded.related_member_code,
        related_id = excluded.related_id,
        mobile_number = excluded.mobile_number,
        dob = excluded.dob,
        updated_at = now();
end;
$$;

revoke all on function save_family_relation(text, text, text, text, date) from public;
grant execute on function save_family_relation(text, text, text, text, date) to authenticated;

-- (0015) self-lookup simplified: the unique auth_user_id constraint (see
-- the people table above) makes the old order-by-and-limit-1 tiebreak
-- unnecessary.
create or replace function add_child(
  p_name text,
  p_member_code text default null,
  p_mobile_number text default null,
  p_dob date default null
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
    select id into v_matched_id from people where member_code = p_member_code;
    if v_matched_id is null then
      raise exception 'No registered member found with code %', p_member_code;
    end if;
  else
    v_matched_id := null;
    p_member_code := null;
  end if;

  insert into children (parent_person_id, child_name, child_member_code, child_id, child_mobile_number, child_dob)
  values (v_self_id, p_name, p_member_code, v_matched_id,
          normalize_relative_mobile(p_mobile_number), check_relative_dob(p_dob))
  returning id into v_new_id;

  return v_new_id;
end;
$$;

create or replace function update_child(
  p_child_row_id uuid,
  p_name text,
  p_member_code text default null,
  p_mobile_number text default null,
  p_dob date default null
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
    select id into v_matched_id from people where member_code = p_member_code;
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
      updated_at = now()
  where id = p_child_row_id and parent_person_id = v_self_id;

  if not found then
    raise exception 'Child record not found';
  end if;
end;
$$;

revoke all on function add_child(text, text, text, date) from public;
grant execute on function add_child(text, text, text, date) to authenticated;
revoke all on function update_child(uuid, text, text, text, date) from public;
grant execute on function update_child(uuid, text, text, text, date) to authenticated;

-- Family invites (a "your father/spouse/etc. was invited" notification
-- email) are sent by the send-family-invite Edge Function via Resend
-- directly -- a plain, untracked email. No auth account is created and
-- nothing about the invite is persisted in the database.

-- Phase 3a: directory & member profiles (see migration 0010).
--
-- `people`'s RLS stays self-only. All cross-member reads go through the
-- SECURITY DEFINER RPCs below, which expose two fixed column tiers:
--   directory tier  (list_directory): name, gotra, native place, city/state,
--                   member code, photo
--   profile tier    (get_member_profile): directory tier + district,
--                   education, marital status, mobile number
-- home_address, dob, gender, and the family_* columns are never returned --
-- keep it that way when extending these.

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
  where p.member_code is not null
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
         p.mobile_number, p.profile_photo_url,
         p.occupation_type, p.job_title, p.company_name, p.job_location
  from people p
  where p.id = p_person_id
    and p.member_code is not null;
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
    from people p where p.member_code is not null and p.current_state is not null
    union
    select 'city', p.current_city
    from people p where p.member_code is not null and p.current_city is not null
    union
    select 'gotra', p.gotra
    from people p where p.member_code is not null and p.gotra is not null
    union
    select 'occupation', p.occupation_type
    from people p where p.member_code is not null and p.occupation_type is not null
  ) f
  order by f.kind, f.value;
$$;

revoke all on function directory_filter_options() from public;
grant execute on function directory_filter_options() to authenticated;

-- ================================================================
-- Phase 3b (0014): business listing RPCs
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
  where p.member_code is not null
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

-- One listing, same columns (minus total_count). Zero rows if unknown or
-- the owner hasn't completed onboarding.
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
         p.id, p.full_name, p.profile_photo_url, p.member_code
  from businesses b
  join people p on p.id = b.owner_id
  where b.id = p_business_id
    and p.member_code is not null;
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
    and p.member_code is not null
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
    where p.member_code is not null and b.category is not null
    union
    select 'city', b.city
    from businesses b join people p on p.id = b.owner_id
    where p.member_code is not null and b.city is not null
    union
    select 'state', b.state
    from businesses b join people p on p.id = b.owner_id
    where p.member_code is not null and b.state is not null
  ) f
  order by f.kind, f.value;
$$;

revoke all on function business_filter_options() from public;
grant execute on function business_filter_options() to authenticated;
