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
  created_at timestamptz default now(),
  updated_at timestamptz default now()
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
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

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
  where auth_user_id = auth.uid()
  order by created_at asc, id asc
  limit 1;

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
  where auth_user_id = auth.uid()
  order by created_at asc, id asc
  limit 1;

  if v_person_id is null then
    raise exception 'No person row for the current user';
  end if;

  update people
  set gotra = p_gotra,
      marital_status = p_marital_status,
      education = p_education
  where id = v_person_id;

  return assign_member_code();
end;
$$;

revoke all on function complete_onboarding_step3(text, text, text) from public;
grant execute on function complete_onboarding_step3(text, text, text) to authenticated;

create table businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references people(id) not null,
  name text not null,
  category text,
  description text,
  type text check (type in ('business','professional','student','homemaker')),
  created_at timestamptz default now()
);

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
  member_code text
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.full_name, p.gotra, p.native_place, p.current_city, p.current_state, p.member_code
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
create or replace function save_family_relation(
  p_slot text,
  p_name text,
  p_member_code text default null
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
  select id into v_self_id from people where auth_user_id = auth.uid() order by created_at asc, id asc limit 1;
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

  if p_slot = 'father' then
    update people set father_name = p_name, father_member_code = p_member_code, father_id = v_matched_id where id = v_self_id;
  elsif p_slot = 'mother' then
    update people set mother_name = p_name, mother_member_code = p_member_code, mother_id = v_matched_id where id = v_self_id;
  elsif p_slot = 'spouse' then
    update people set spouse_name = p_name, spouse_member_code = p_member_code, spouse_id = v_matched_id where id = v_self_id;
  elsif p_slot = 'maternal_uncle' then
    update people set maternal_uncle_name = p_name, maternal_uncle_member_code = p_member_code, maternal_uncle_id = v_matched_id where id = v_self_id;
  elsif p_slot = 'spouse_father' then
    update people set spouse_father_name = p_name, spouse_father_member_code = p_member_code, spouse_father_id = v_matched_id where id = v_self_id;
  elsif p_slot = 'spouse_mother' then
    update people set spouse_mother_name = p_name, spouse_mother_member_code = p_member_code, spouse_mother_id = v_matched_id where id = v_self_id;
  end if;
end;
$$;

revoke all on function save_family_relation(text, text, text) from public;
grant execute on function save_family_relation(text, text, text) to authenticated;

-- Children: same match-or-plain-text pattern as save_family_relation, but as
-- insert/update against the `children` table since a person can have any
-- number of them. Deleting a child row needs no cross-row read, so it's a
-- plain client-side delete under children's own RLS policy -- no RPC for it.
create or replace function add_child(p_name text, p_member_code text default null)
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
  select id into v_self_id from people where auth_user_id = auth.uid() order by created_at asc, id asc limit 1;
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

  insert into children (parent_person_id, child_name, child_member_code, child_id)
  values (v_self_id, p_name, p_member_code, v_matched_id)
  returning id into v_new_id;

  return v_new_id;
end;
$$;

create or replace function update_child(p_child_row_id uuid, p_name text, p_member_code text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_self_id uuid;
  v_matched_id uuid;
begin
  select id into v_self_id from people where auth_user_id = auth.uid() order by created_at asc, id asc limit 1;
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
  set child_name = p_name, child_member_code = p_member_code, child_id = v_matched_id, updated_at = now()
  where id = p_child_row_id and parent_person_id = v_self_id;

  if not found then
    raise exception 'Child record not found';
  end if;
end;
$$;

revoke all on function add_child(text, text) from public;
grant execute on function add_child(text, text) to authenticated;
revoke all on function update_child(uuid, text, text) from public;
grant execute on function update_child(uuid, text, text) to authenticated;