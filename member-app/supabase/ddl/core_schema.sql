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
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index people_state_code_idx on people (state_code);

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