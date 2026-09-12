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
  -- Phase 3c (0017): the tabbed Profile page. Name parts are the editable
  -- columns; full_name (above) is derived from them by the
  -- people_sync_full_name trigger below and remains what every reader
  -- (header, directory, search, invite email) uses. Everything else here is
  -- in the never-exposed tier -- get_member_profile / list_directory don't
  -- return any of it.
  first_name text,
  middle_name text,
  last_name text,
  blood_group text
    check (blood_group is null
           or blood_group in ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
  secondary_email text,
  secondary_mobile text
    check (secondary_mobile is null or secondary_mobile ~ '^\+91[6-9]\d{9}$'),
  residence_phone text,
  birth_place text,
  -- home_address (above) doubles as address line 1.
  address_line2 text,
  address_line3 text,
  pincode text
    check (pincode is null or pincode ~ '^\d{6}$'),
  date_of_marriage date,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint people_auth_user_id_key unique (auth_user_id)
);

create index people_state_code_idx on people (state_code);

-- (0017) full_name := "First Middle Last" whenever a name part is written.
create or replace function people_sync_full_name()
returns trigger
language plpgsql
as $$
begin
  if new.first_name is not null and length(trim(new.first_name)) > 0 then
    new.full_name := concat_ws(' ',
      nullif(trim(new.first_name), ''),
      nullif(trim(new.middle_name), ''),
      nullif(trim(new.last_name), ''));
  end if;
  return new;
end;
$$;

create trigger people_sync_full_name
  before insert or update of first_name, middle_name, last_name on people
  for each row execute function people_sync_full_name();

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
  -- (0017) Profile > Children tab details.
  relation text
    check (relation is null or relation in ('Son', 'Daughter')),
  education text,
  profession text
    check (profession is null
           or profession in ('Business', 'Job', 'Student', 'Homemaker', 'Retired', 'Other')),
  marital_status text,
  spouse_name text,
  blood_group text
    check (blood_group is null
           or blood_group in ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
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
  -- (0017) Generic per-slot columns; only the spouse card renders them.
  email text,
  profession text
    check (profession is null
           or profession in ('Business', 'Job', 'Student', 'Homemaker', 'Retired', 'Other')),
  blood_group text
    check (blood_group is null
           or blood_group in ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
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
  -- (0017) Profile > Business tab. `category` is the "industry type";
  -- `city`/`state` are the office city/state. business_type is mirrored by
  -- BUSINESS_TYPE_OPTIONS in src/lib/formOptions.ts.
  brand_name text,
  address_line1 text,
  address_line2 text,
  business_email text,
  primary_product text,
  business_type text
    check (business_type is null or business_type in (
      'Manufacturer', 'Wholesaler', 'Retailer', 'Distributor',
      'Service provider', 'Professional practice', 'Other'
    )),
  facebook_url text,
  instagram_url text,
  linkedin_url text,
  youtube_url text,
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

-- Phase 4 (0018): member-created events with admin approval. Phase 0's
-- placeholder (title/description/location/event_date/capacity) was
-- extended in place: location -> venue, event_date -> starts_at. ALL writes
-- go through the SECURITY DEFINER RPCs at the end of this file -- there are
-- deliberately no insert/update/delete policies (see 0018's header and
-- enable_rls.sql).
create table events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  venue text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  city text,
  state text,
  capacity int check (capacity is null or capacity > 0),
  creator_id uuid references people(id) not null,
  visibility text not null default 'members'
    check (visibility in ('members', 'invite_only')),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  rejection_reason text,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint events_ends_after_starts check (ends_at is null or ends_at >= starts_at)
);

create index events_status_visibility_starts_idx on events (status, visibility, starts_at);
create index events_creator_id_idx on events (creator_id);

-- Leaving flips status to not_going; rows are never deleted.
create table rsvps (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) not null,
  person_id uuid references people(id) not null,
  status text default 'going' check (status in ('going', 'not_going')),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(event_id, person_id)
);

create index rsvps_person_id_idx on rsvps (person_id);
create index rsvps_event_going_idx on rsvps (event_id) where status = 'going';

-- (0018) Who may see + join an invite_only event. emailed_at is stamped by
-- the send-event-invite Edge Function so "Email all not yet emailed" can
-- skip people already notified.
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

-- (0018) Admin role. No policies -- only is_admin() reads it. Seeded by hand.
create table admins (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz default now()
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

-- (0017) Blank -> null, otherwise a loose "something@something.tld" check.
create or replace function normalize_optional_email(p_email text)
returns text
language plpgsql
immutable
as $$
begin
  if p_email is null or length(trim(p_email)) = 0 then
    return null;
  end if;
  if trim(p_email) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Please enter a valid email address';
  end if;
  return lower(trim(p_email));
end;
$$;

revoke all on function normalize_optional_email(text) from public;

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
    select id into v_matched_id from people where member_code = p_member_code;
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
    select id into v_matched_id from people where member_code = p_member_code;
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

-- ================================================================
-- Phase 4 (0018): events RPCs
-- ================================================================
-- Every write to events / rsvps / event_invites is one of these; the
-- select-only safety-net policies live in enable_rls.sql.

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

