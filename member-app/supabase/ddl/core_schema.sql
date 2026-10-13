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
  -- Phase 5a (0019): the admin approval gate. member_status -- not
  -- member_code -- is what every cross-member RPC and policy now tests.
  -- 'onboarding' = wizard not finished; submit_for_review() moves it to
  -- 'pending'. A member code is still issued at wizard completion, so a
  -- pending member has an ID but no access. admin_message carries either the
  -- "more info needed" text or the rejection reason (which one is implied by
  -- the status). reviewed_by is null on rows grandfathered by the 0019
  -- backfill. These six columns are write-protected from the client by the
  -- people_protect_review_columns trigger below -- hide_mobile deliberately
  -- is not, since members set it themselves.
  member_status text not null default 'onboarding'
    check (member_status in ('onboarding', 'pending', 'info_requested', 'approved', 'rejected')),
  admin_message text,
  submitted_at timestamptz,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  hide_mobile boolean not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint people_auth_user_id_key unique (auth_user_id)
);

create index people_state_code_idx on people (state_code);

-- (0019) The admin queue orders by submitted_at within a status.
create index people_member_status_idx on people (member_status, submitted_at);

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
-- (0021) Also revoked from anon/authenticated by name: Supabase's default
-- privileges grant execute on new public functions to those roles directly,
-- which `from public` alone never undid -- any signed-in user could call this
-- for any person id until 0021.
revoke all on function assign_member_code_for(uuid) from public, anon, authenticated;

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
  -- (0021) Admin moderation. A hidden listing drops out of every
  -- member-facing read but stays visible to its owner, who sees
  -- hidden_reason as a banner on Profile > Business. Write-protected from
  -- the client by businesses_protect_moderation_columns below; only
  -- admin_set_business_hidden changes them.
  is_hidden boolean not null default false,
  hidden_reason text,
  hidden_by uuid references auth.users(id),
  hidden_at timestamptz,
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

-- (0021) Same idea as people_protect_review_columns: `own business update`
-- is column-blind, so without this an owner could un-hide their own listing
-- through PostgREST. On insert the columns are reset rather than refused --
-- a fresh listing is never hidden, and createBusiness() shouldn't have to
-- know these columns exist.
create or replace function businesses_protect_moderation_columns()
returns trigger
language plpgsql
as $$
begin
  if current_user = 'authenticated' then
    if tg_op = 'INSERT' then
      new.is_hidden := false;
      new.hidden_reason := null;
      new.hidden_by := null;
      new.hidden_at := null;
    elsif (new.is_hidden, new.hidden_reason, new.hidden_by, new.hidden_at)
          is distinct from
          (old.is_hidden, old.hidden_reason, old.hidden_by, old.hidden_at) then
      raise exception 'Only an admin can hide or unhide a listing';
    end if;
  end if;
  return new;
end;
$$;

create trigger businesses_protect_moderation_columns
  before insert or update on businesses
  for each row execute function businesses_protect_moderation_columns();

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

-- (0018) Admin role. No policies -- only is_admin() / admin_role() read it.
-- Seeded by hand. (0019) `role`: moderators run the member and event queues;
-- super_admin additionally may revoke an already-approved member, and owns
-- admin management when Phase 5b builds it.
create table admins (
  auth_user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'moderator'
    check (role in ('super_admin', 'moderator')),
  created_at timestamptz default now()
);

-- Phase 6a (0023): rebuilt from the Phase 0 placeholder. Self only; RPC-only
-- like events (RLS on, no policies). matrimony_interests was dropped here and
-- comes back in 6b against matrimony_profiles.
create table matrimony_profiles (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null unique references people(id) on delete cascade,
  status text not null default 'draft'
    check (status in ('draft', 'pending', 'changes_requested', 'approved', 'rejected',
                      -- (0025) owner pause / admin hide
                      'paused', 'hidden')),
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

-- Phase 6b (0024): interests between matrimony profiles. RPC-only.
create table matrimony_interests (
  id uuid primary key default gen_random_uuid(),
  from_profile_id uuid not null references matrimony_profiles(id) on delete cascade,
  to_profile_id uuid not null references matrimony_profiles(id) on delete cascade,
  message text check (message is null or length(message) <= 300),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'withdrawn', 'ended')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  -- Badge bookkeeping: the recipient has seen a pending interest; the
  -- sender has seen that it was accepted.
  recipient_seen_at timestamptz,
  sender_seen_at timestamptz,
  -- (0025) un-match
  ended_by_profile_id uuid references matrimony_profiles(id) on delete set null,
  ended_at timestamptz,
  constraint matrimony_interests_pair_key unique (from_profile_id, to_profile_id),
  constraint matrimony_interests_not_self check (from_profile_id <> to_profile_id)
);

create index matrimony_interests_to_idx on matrimony_interests (to_profile_id, status);
create index matrimony_interests_from_idx on matrimony_interests (from_profile_id, status);

-- Phase 6c (0025): blocks and reports. RPC-only.
-- Who has blocked whom. People, not profiles: survives a profile being
-- deleted and recreated.
create table matrimony_blocks (
  blocker_person_id uuid not null references people(id) on delete cascade,
  blocked_person_id uuid not null references people(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_person_id, blocked_person_id),
  constraint matrimony_blocks_not_self check (blocker_person_id <> blocked_person_id)
);

create index matrimony_blocks_blocked_idx on matrimony_blocks (blocked_person_id);

create table matrimony_reports (
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

create unique index matrimony_reports_one_open_idx
  on matrimony_reports (reporter_person_id, reported_person_id) where status = 'open';
create index matrimony_reports_status_idx on matrimony_reports (status, created_at);

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

-- Phase 5c (0022): in-app notices. An admin drafts a notice, targets it,
-- and publishes it; approved members whose profile matches the audience see
-- it in the header bell / dashboard strip until it expires or is withdrawn.
-- RPC-only like events: RLS on, no policies (see enable_rls.sql).
--
-- Audience: four lists, OR within a list, AND across lists; an empty list
-- means "no restriction", so all four empty = every approved member. The
-- match is evaluated at read time against the member's current profile
-- (notice_audience_matches), so moving city moves which notices you see.
create table notices (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 120),
  body text not null check (length(trim(body)) between 1 and 4000),
  audience_states text[] not null default '{}',
  audience_cities text[] not null default '{}',
  audience_gotras text[] not null default '{}',
  audience_occupations text[] not null default '{}',
  status text not null default 'draft'
    check (status in ('draft', 'published', 'withdrawn')),
  -- Null = until withdrawn. Members can still reopen an expired notice from
  -- /notices; it just stops counting as unread / showing on the dashboard.
  expires_at timestamptz,
  created_by uuid references auth.users(id),
  published_by uuid references auth.users(id),
  published_at timestamptz,
  withdrawn_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index notices_status_published_idx on notices (status, published_at desc);

-- One row per (notice, member) once read. Unread = no row.
create table notice_reads (
  notice_id uuid not null references notices(id) on delete cascade,
  person_id uuid not null references people(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (notice_id, person_id)
);

create index notice_reads_person_id_idx on notice_reads (person_id);

-- ================================================================
-- membership / admin gate helpers
-- ================================================================
-- Both are defined here, ahead of every RPC that calls them: SQL-language
-- function bodies are parsed at creation time, so a forward reference would
-- fail on a fresh run of this file. (is_admin() arrived in 0018 further
-- down; 0019 moved it up here when get_member_profile started calling it.)

-- admins has no policies at all: these definer functions are its only readers.
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
  where is_approved_member()
    and p.member_status = 'approved'
    and not b.is_hidden
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
    and p.member_status = 'approved'
    and not b.is_hidden;
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
    and not b.is_hidden
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
    where p.member_status = 'approved' and not b.is_hidden and b.category is not null
    union
    select 'city', b.city
    from businesses b join people p on p.id = b.owner_id
    where p.member_status = 'approved' and not b.is_hidden and b.city is not null
    union
    select 'state', b.state
    from businesses b join people p on p.id = b.owner_id
    where p.member_status = 'approved' and not b.is_hidden and b.state is not null
  ) f
  where is_approved_member()
  order by f.kind, f.value;
$$;

revoke all on function business_filter_options() from public;
grant execute on function business_filter_options() to authenticated;

-- ================================================================
-- Phase 4 (0018): events RPCs
-- ================================================================
-- Every write to events / rsvps / event_invites is one of these; the
-- select-only safety-net policies live in enable_rls.sql.

-- is_admin() used to be defined here (0018). 0019 moved it up next to
-- admin_role() / is_approved_member(), above the directory RPCs that now
-- call it -- see "membership / admin gate helpers".

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
-- (0020) `me` is left-joined, not cross-joined: since 0019 it only has a row
-- for an approved member, so an admin who isn't one (seeded by hand, or
-- still pending themselves) got zero rows back instead of the queue.
-- (0021) p_search (title / organiser name / city) added for the tabbed
-- queue; the signature change means 0021 drops the old 3-arg version first.
create or replace function admin_list_events(
  p_status text default 'pending',
  p_search text default null,
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
  left join me on true
  where is_admin()
    and e.status = p_status
    and (p_search is null or length(trim(p_search)) = 0
         or e.title ilike '%' || trim(p_search) || '%'
         or p.full_name ilike '%' || trim(p_search) || '%'
         or e.city ilike '%' || trim(p_search) || '%')
  order by case when p_status = 'pending' then e.created_at end asc,
           e.updated_at desc, e.id asc
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function admin_list_events(text, text, int, int) from public;
grant execute on function admin_list_events(text, text, int, int) to authenticated;

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
-- Phase 5a (0019): member approval RPCs
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
-- Phase 5b-1 (0020): admin console read RPCs
-- ================================================================

-- The members table's shared WHERE clause, so the paged list and the CSV
-- export can't disagree about who matches a filter. Returns whole people
-- rows plus the login email, so it is gated on is_admin() itself AND revoked
-- from anon/authenticated by name: Supabase's default privileges grant
-- execute on new public functions to those roles directly, which a plain
-- `revoke ... from public` does not undo. Only the two definer functions
-- below call it.
--
-- p_status null = everyone who has submitted (all but 'onboarding');
-- 'onboarding' can still be asked for explicitly, to find half-finished
-- signups. Search covers name, code, mobile and login email.
create or replace function admin_filter_members(
  p_status text,
  p_search text,
  p_state text,
  p_city text,
  p_gotra text,
  p_occupation text
)
returns table (person people, email text)
language sql
stable
security definer
set search_path = public
as $$
  select p, u.email::text
  from people p
  left join auth.users u on u.id = p.auth_user_id
  where (case when p_status is null then p.member_status <> 'onboarding'
              else p.member_status = p_status end)
    and (p_search is null or length(trim(p_search)) = 0
         or p.full_name ilike '%' || trim(p_search) || '%'
         or p.member_code ilike '%' || trim(p_search) || '%'
         or p.mobile_number like '%' || trim(p_search) || '%'
         or u.email ilike '%' || trim(p_search) || '%')
    and (p_state is null or p.current_state = p_state)
    and (p_city is null or p.current_city = p_city)
    and (p_gotra is null or p.gotra = p_gotra)
    and (p_occupation is null or p.occupation_type = p_occupation)
    and is_admin();
$$;

revoke all on function admin_filter_members(text, text, text, text, text, text)
  from public, anon, authenticated;

-- The console's members table. Same identity tier as admin_list_members
-- (which the approval queue keeps using, with its queue ordering) plus
-- occupation; newest signups first. Clamp 1-100.
create or replace function admin_search_members(
  p_status text default null,
  p_search text default null,
  p_state text default null,
  p_city text default null,
  p_gotra text default null,
  p_occupation text default null,
  p_limit int default 25,
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
  occupation_type text,
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
  select (f.person).id, (f.person).full_name, (f.person).profile_photo_url,
         (f.person).member_code, f.email, (f.person).mobile_number,
         (f.person).gotra, (f.person).native_place,
         (f.person).current_city, (f.person).current_state,
         (f.person).occupation_type, (f.person).member_status,
         (f.person).admin_message, (f.person).submitted_at,
         (f.person).reviewed_at, (f.person).created_at,
         count(*) over () as total_count
  from admin_filter_members(p_status, p_search, p_state, p_city, p_gotra, p_occupation) f
  where is_admin()
  order by (f.person).created_at desc nulls last, (f.person).id asc
  limit least(greatest(coalesce(p_limit, 25), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function admin_search_members(text, text, text, text, text, text, int, int) from public;
grant execute on function admin_search_members(text, text, text, text, text, text, int, int) to authenticated;

-- Chip values for the members table's filters. Same (kind, value) shape as
-- directory_filter_options, but across everyone who has submitted rather
-- than approved members only -- the console needs to filter the queue too.
-- Occupation is a fixed list client-side (OCCUPATION_OPTIONS), so not here.
create or replace function admin_member_filter_options()
returns table (kind text, value text)
language sql
stable
security definer
set search_path = public
as $$
  select f.kind, f.value
  from (
    select 'state' as kind, p.current_state as value
    from people p where p.member_status <> 'onboarding' and p.current_state is not null
    union
    select 'city', p.current_city
    from people p where p.member_status <> 'onboarding' and p.current_city is not null
    union
    select 'gotra', p.gotra
    from people p where p.member_status <> 'onboarding' and p.gotra is not null
  ) f
  where is_admin()
  order by f.kind, f.value;
$$;

revoke all on function admin_member_filter_options() from public;
grant execute on function admin_member_filter_options() to authenticated;

-- CSV export: the same filters, no row cap, super_admin only -- it is a bulk
-- download of every matching member's mobile number and email. plpgsql (and
-- not `stable`) because every export is written to admin_audit_log with the
-- filters used and the row count.
create or replace function admin_export_members(
  p_status text default null,
  p_search text default null,
  p_state text default null,
  p_city text default null,
  p_gotra text default null,
  p_occupation text default null
)
returns table (
  member_code text,
  member_status text,
  first_name text,
  middle_name text,
  last_name text,
  full_name text,
  gender text,
  dob date,
  email text,
  mobile_number text,
  gotra text,
  native_place text,
  current_city text,
  current_district text,
  current_state text,
  occupation_type text,
  job_title text,
  company_name text,
  marital_status text,
  education text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count bigint;
  v_admin_person_id uuid;
begin
  if coalesce(admin_role(), '') <> 'super_admin' then
    raise exception 'Only a super admin can export member data';
  end if;

  return query
    select (f.person).member_code, (f.person).member_status,
           (f.person).first_name, (f.person).middle_name, (f.person).last_name,
           (f.person).full_name, (f.person).gender, (f.person).dob,
           f.email, (f.person).mobile_number,
           (f.person).gotra, (f.person).native_place,
           (f.person).current_city, (f.person).current_district, (f.person).current_state,
           (f.person).occupation_type, (f.person).job_title, (f.person).company_name,
           (f.person).marital_status, (f.person).education,
           (f.person).submitted_at, (f.person).reviewed_at, (f.person).created_at
    from admin_filter_members(p_status, p_search, p_state, p_city, p_gotra, p_occupation) f
    order by (f.person).full_name asc, (f.person).id asc;
  get diagnostics v_count = row_count;

  select id into v_admin_person_id from people where auth_user_id = auth.uid();
  insert into admin_audit_log (admin_id, action, target_type, target_id, notes)
  values (v_admin_person_id, 'members_export', 'export', null,
          jsonb_strip_nulls(jsonb_build_object(
            'rows', v_count, 'status', p_status, 'search', nullif(trim(p_search), ''),
            'state', p_state, 'city', p_city, 'gotra', p_gotra, 'occupation', p_occupation
          ))::text);
end;
$$;

revoke all on function admin_export_members(text, text, text, text, text, text) from public;
grant execute on function admin_export_members(text, text, text, text, text, text) to authenticated;

-- One member's whole record for the admin detail screen: every people column,
-- the login email, who reviewed them, and their family relations, children
-- and business listings. Admin-only, so none of 3a's visibility tiers apply.
-- Null when the caller isn't an admin or the id is unknown.
create or replace function admin_get_member(p_person_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select to_jsonb(p) || jsonb_build_object(
           'email', u.email,
           'reviewed_by_name',
             (select r.full_name from people r where r.auth_user_id = p.reviewed_by),
           'family_relations', coalesce(
             (select jsonb_agg(to_jsonb(fr) order by fr.slot)
              from family_relations fr where fr.person_id = p.id), '[]'::jsonb),
           'children', coalesce(
             (select jsonb_agg(to_jsonb(c) order by c.created_at, c.id)
              from children c where c.parent_person_id = p.id), '[]'::jsonb),
           'businesses', coalesce(
             (select jsonb_agg(to_jsonb(b) order by b.name, b.id)
              from businesses b where b.owner_id = p.id), '[]'::jsonb)
         )
  from people p
  left join auth.users u on u.id = p.auth_user_id
  where p.id = p_person_id
    and is_admin();
$$;

revoke all on function admin_get_member(uuid) from public;
grant execute on function admin_get_member(uuid) to authenticated;

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

-- ================================================================
-- Phase 5b-2 (0021): business moderation + admin management
-- ================================================================

-- The console's business list: every listing, hidden or not, with the
-- owner's identity and status. p_hidden null = all. Search covers name,
-- brand name and owner name. Clamp 1-100.
create or replace function admin_list_businesses(
  p_hidden boolean default null,
  p_search text default null,
  p_category text default null,
  p_limit int default 25,
  p_offset int default 0
)
returns table (
  id uuid,
  name text,
  brand_name text,
  category text,
  city text,
  state text,
  logo_url text,
  is_hidden boolean,
  hidden_reason text,
  hidden_at timestamptz,
  owner_id uuid,
  owner_name text,
  owner_member_code text,
  owner_status text,
  created_at timestamptz,
  total_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select b.id, b.name, b.brand_name, b.category, b.city, b.state, b.logo_url,
         b.is_hidden, b.hidden_reason, b.hidden_at,
         p.id, p.full_name, p.member_code, p.member_status,
         b.created_at,
         count(*) over ()
  from businesses b
  join people p on p.id = b.owner_id
  where is_admin()
    and (p_hidden is null or b.is_hidden = p_hidden)
    and (p_category is null or b.category = p_category)
    and (p_search is null or length(trim(p_search)) = 0
         or b.name ilike '%' || trim(p_search) || '%'
         or b.brand_name ilike '%' || trim(p_search) || '%'
         or p.full_name ilike '%' || trim(p_search) || '%')
  order by case when p_hidden then b.hidden_at end desc nulls last,
           b.name asc, b.id asc
  limit least(greatest(coalesce(p_limit, 25), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function admin_list_businesses(boolean, text, text, int, int) from public;
grant execute on function admin_list_businesses(boolean, text, text, int, int) to authenticated;

-- Hide (reason required -- the owner reads it) or unhide a listing. Any
-- admin. Audited as business_hidden / business_unhidden.
create or replace function admin_set_business_hidden(
  p_business_id uuid,
  p_hidden boolean,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business businesses%rowtype;
  v_admin_person_id uuid;
begin
  if not is_admin() then
    raise exception 'Not an admin';
  end if;
  if p_hidden is null then
    raise exception 'Say whether to hide or unhide the listing';
  end if;

  select * into v_business from businesses where id = p_business_id for update;
  if not found then
    raise exception 'Listing not found';
  end if;
  if v_business.is_hidden = p_hidden then
    raise exception 'This listing is already %', case when p_hidden then 'hidden' else 'visible' end;
  end if;

  if p_hidden then
    if p_reason is null or length(trim(p_reason)) = 0 then
      raise exception 'Please give a reason for hiding this listing';
    end if;
    update businesses
    set is_hidden = true, hidden_reason = trim(p_reason),
        hidden_by = auth.uid(), hidden_at = now(), updated_at = now()
    where id = p_business_id;
  else
    update businesses
    set is_hidden = false, hidden_reason = null,
        hidden_by = null, hidden_at = null, updated_at = now()
    where id = p_business_id;
  end if;

  select id into v_admin_person_id from people where auth_user_id = auth.uid();
  insert into admin_audit_log (admin_id, action, target_type, target_id, notes)
  values (v_admin_person_id,
          case when p_hidden then 'business_hidden' else 'business_unhidden' end,
          'business', p_business_id, nullif(trim(p_reason), ''));
end;
$$;

revoke all on function admin_set_business_hidden(uuid, boolean, text) from public;
grant execute on function admin_set_business_hidden(uuid, boolean, text) to authenticated;

-- Everyone in `admins`, with their member identity where they have one (a
-- hand-seeded admin may not). Any admin may read it -- moderators get a
-- read-only view; every write below is super_admin only.
create or replace function admin_list_admins()
returns table (
  auth_user_id uuid,
  role text,
  created_at timestamptz,
  person_id uuid,
  full_name text,
  member_code text,
  profile_photo_url text,
  email text
)
language sql
stable
security definer
set search_path = public
as $$
  select a.auth_user_id, a.role, a.created_at,
         p.id, p.full_name, p.member_code, p.profile_photo_url, u.email::text
  from admins a
  left join people p on p.auth_user_id = a.auth_user_id
  left join auth.users u on u.id = a.auth_user_id
  where is_admin()
  order by case a.role when 'super_admin' then 0 else 1 end,
           p.full_name asc nulls last, a.auth_user_id asc;
$$;

revoke all on function admin_list_admins() from public;
grant execute on function admin_list_admins() to authenticated;

-- Shared guard for the three admin-management writes: the caller must be a
-- super_admin, and must not be acting on themselves -- self-demotion and
-- self-removal are how a console ends up with no super_admin, and a second
-- super_admin can always do it for them.
create or replace function admin_require_super_admin_for(p_target_auth_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(admin_role(), '') <> 'super_admin' then
    raise exception 'Only a super admin can manage admins';
  end if;
  if p_target_auth_user_id = auth.uid() then
    raise exception 'You cannot change your own admin access';
  end if;
end;
$$;

revoke all on function admin_require_super_admin_for(uuid) from public, anon, authenticated;

-- Audit helper for the three writes below. Logged against the member
-- (target_type 'person') where the admin has a people row, so the entry
-- links to their member page and shows on its History; notes carry the
-- role change.
create or replace function admin_log_admin_change(
  p_target_auth_user_id uuid,
  p_action text,
  p_notes text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_person_id uuid;
  v_target_person_id uuid;
begin
  select id into v_admin_person_id from people where auth_user_id = auth.uid();
  select id into v_target_person_id from people where auth_user_id = p_target_auth_user_id;
  insert into admin_audit_log (admin_id, action, target_type, target_id, notes)
  values (v_admin_person_id, p_action, 'person', v_target_person_id, p_notes);
end;
$$;

revoke all on function admin_log_admin_change(uuid, text, text) from public, anon, authenticated;

-- Make an approved member an admin.
create or replace function admin_grant(p_person_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_person people%rowtype;
begin
  -- Role check first, so a non-admin can't probe which ids exist. No self
  -- check needed here: the caller is already an admin, so granting
  -- themselves fails as "already an admin" below.
  perform admin_require_super_admin_for(null);
  select * into v_person from people where id = p_person_id;
  if not found then
    raise exception 'Member not found';
  end if;
  if p_role not in ('super_admin', 'moderator') then
    raise exception 'Invalid role: %', p_role;
  end if;
  if v_person.member_status <> 'approved' or v_person.auth_user_id is null then
    raise exception 'Only an approved member can be made an admin';
  end if;
  if exists (select 1 from admins where auth_user_id = v_person.auth_user_id) then
    raise exception '% is already an admin', v_person.full_name;
  end if;

  insert into admins (auth_user_id, role) values (v_person.auth_user_id, p_role);
  perform admin_log_admin_change(v_person.auth_user_id, 'admin_granted', p_role);
end;
$$;

revoke all on function admin_grant(uuid, text) from public;
grant execute on function admin_grant(uuid, text) to authenticated;

-- Change an admin's role. The table lock serialises concurrent role changes
-- so two super_admins can't demote each other at the same instant and leave
-- none. (With self-changes refused, the caller is always a remaining
-- super_admin anyway -- the count check is the belt to that brace.)
create or replace function admin_set_role(p_auth_user_id uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current text;
begin
  perform admin_require_super_admin_for(p_auth_user_id);
  if p_role not in ('super_admin', 'moderator') then
    raise exception 'Invalid role: %', p_role;
  end if;

  lock table admins in share row exclusive mode;
  select role into v_current from admins where auth_user_id = p_auth_user_id;
  if not found then
    raise exception 'Not an admin';
  end if;
  if v_current = p_role then
    raise exception 'They are already a %', replace(p_role, '_', ' ');
  end if;
  if v_current = 'super_admin'
     and (select count(*) from admins where role = 'super_admin') <= 1 then
    raise exception 'There must always be at least one super admin';
  end if;

  update admins set role = p_role where auth_user_id = p_auth_user_id;
  perform admin_log_admin_change(p_auth_user_id, 'admin_role_changed', v_current || ' -> ' || p_role);
end;
$$;

revoke all on function admin_set_role(uuid, text) from public;
grant execute on function admin_set_role(uuid, text) to authenticated;

-- Remove someone's admin access. Their membership is untouched.
create or replace function admin_revoke(p_auth_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current text;
begin
  perform admin_require_super_admin_for(p_auth_user_id);

  lock table admins in share row exclusive mode;
  select role into v_current from admins where auth_user_id = p_auth_user_id;
  if not found then
    raise exception 'Not an admin';
  end if;
  if v_current = 'super_admin'
     and (select count(*) from admins where role = 'super_admin') <= 1 then
    raise exception 'There must always be at least one super admin';
  end if;

  delete from admins where auth_user_id = p_auth_user_id;
  perform admin_log_admin_change(p_auth_user_id, 'admin_revoked', v_current);
end;
$$;

revoke all on function admin_revoke(uuid) from public;
grant execute on function admin_revoke(uuid) to authenticated;

-- ================================================================
-- Phase 5c (0022): notices
-- ================================================================

-- The audience predicate, in one place for the member reads, the
-- mark-read writes and the composer's "will reach N" count. Pure, no data
-- access. A member with a null field (no gotra on file, say) never matches
-- a list that restricts that field. Not client-callable -- only the definer
-- RPCs below use it.
create or replace function notice_audience_matches(
  p_states text[],
  p_cities text[],
  p_gotras text[],
  p_occupations text[],
  p_state text,
  p_city text,
  p_gotra text,
  p_occupation text
)
returns boolean
language sql
immutable
as $$
  select coalesce(
    (coalesce(cardinality(p_states), 0) = 0 or p_state = any(p_states))
    and (coalesce(cardinality(p_cities), 0) = 0 or p_city = any(p_cities))
    and (coalesce(cardinality(p_gotras), 0) = 0 or p_gotra = any(p_gotras))
    and (coalesce(cardinality(p_occupations), 0) = 0 or p_occupation = any(p_occupations)),
    false);
$$;

revoke all on function notice_audience_matches(text[], text[], text[], text[], text, text, text, text)
  from public, anon, authenticated;

-- Trim, drop blanks, de-duplicate and sort an audience list, so equivalent
-- audiences are stored identically.
create or replace function notice_clean_list(p_values text[])
returns text[]
language sql
immutable
as $$
  select coalesce(array_agg(v order by v), '{}')
  from (select distinct trim(x) as v from unnest(coalesce(p_values, '{}')) x
        where length(trim(x)) > 0) t;
$$;

revoke all on function notice_clean_list(text[]) from public, anon, authenticated;

-- ---------------------------------------------------------------- member

-- The caller's notices, newest first: everything published that matches
-- them, expired included (flagged is_active = false) unless p_active_only.
-- The `me` CTE only has a row for an approved member, so it is also the
-- caller gate -- anyone else gets nothing.
create or replace function list_my_notices(
  p_active_only boolean default false,
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  id uuid,
  title text,
  body text,
  published_at timestamptz,
  expires_at timestamptz,
  is_active boolean,
  is_read boolean,
  total_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select id, current_state, current_city, gotra, occupation_type
    from people where auth_user_id = auth.uid() and member_status = 'approved'
  )
  select n.id, n.title, n.body, n.published_at, n.expires_at,
         (n.expires_at is null or n.expires_at > now()),
         exists (select 1 from notice_reads r where r.notice_id = n.id and r.person_id = me.id),
         count(*) over ()
  from notices n
  cross join me
  where n.status = 'published'
    and notice_audience_matches(n.audience_states, n.audience_cities, n.audience_gotras,
                                n.audience_occupations, me.current_state, me.current_city,
                                me.gotra, me.occupation_type)
    and (not coalesce(p_active_only, false) or n.expires_at is null or n.expires_at > now())
  order by n.published_at desc, n.id asc
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function list_my_notices(boolean, int, int) from public;
grant execute on function list_my_notices(boolean, int, int) to authenticated;

-- The header bell's badge: active, matching, unread. 0 for a non-member.
create or replace function notice_unread_count()
returns int
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select id, current_state, current_city, gotra, occupation_type
    from people where auth_user_id = auth.uid() and member_status = 'approved'
  )
  select count(*)::int
  from notices n
  cross join me
  where n.status = 'published'
    and (n.expires_at is null or n.expires_at > now())
    and notice_audience_matches(n.audience_states, n.audience_cities, n.audience_gotras,
                                n.audience_occupations, me.current_state, me.current_city,
                                me.gotra, me.occupation_type)
    and not exists (select 1 from notice_reads r where r.notice_id = n.id and r.person_id = me.id);
$$;

revoke all on function notice_unread_count() from public;
grant execute on function notice_unread_count() to authenticated;

-- Mark one notice (p_notice_id) or every notice the caller can see (null)
-- as read. Silently ignores notices the caller isn't in the audience for,
-- so it can't be used to probe which notices exist.
create or replace function mark_notices_read(p_notice_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me people%rowtype;
begin
  select * into v_me from people
  where auth_user_id = auth.uid() and member_status = 'approved';
  if not found then
    raise exception 'Only approved members can read notices';
  end if;

  insert into notice_reads (notice_id, person_id)
  select n.id, v_me.id
  from notices n
  where (p_notice_id is null or n.id = p_notice_id)
    and n.status = 'published'
    and notice_audience_matches(n.audience_states, n.audience_cities, n.audience_gotras,
                                n.audience_occupations, v_me.current_state, v_me.current_city,
                                v_me.gotra, v_me.occupation_type)
  on conflict (notice_id, person_id) do nothing;
end;
$$;

revoke all on function mark_notices_read(uuid) from public;
grant execute on function mark_notices_read(uuid) to authenticated;

-- ---------------------------------------------------------------- admin

-- The composer's live "will reach N members" count.
create or replace function admin_count_notice_audience(
  p_states text[] default '{}',
  p_cities text[] default '{}',
  p_gotras text[] default '{}',
  p_occupations text[] default '{}'
)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select count(*)
  from people p
  where is_admin()
    and p.member_status = 'approved'
    and notice_audience_matches(notice_clean_list(p_states), notice_clean_list(p_cities),
                                notice_clean_list(p_gotras), notice_clean_list(p_occupations),
                                p.current_state, p.current_city, p.gotra, p.occupation_type);
$$;

revoke all on function admin_count_notice_audience(text[], text[], text[], text[]) from public;
grant execute on function admin_count_notice_audience(text[], text[], text[], text[]) to authenticated;

-- Notices for the console. p_status null = all; p_notice_id fetches one
-- (the editor). reach_count is who matches *now*; read_count is how many
-- have opened it. Each tab sorts by the moment it entered that tab.
create or replace function admin_list_notices(
  p_status text default null,
  p_notice_id uuid default null,
  p_limit int default 25,
  p_offset int default 0
)
returns table (
  id uuid,
  title text,
  body text,
  audience_states text[],
  audience_cities text[],
  audience_gotras text[],
  audience_occupations text[],
  status text,
  expires_at timestamptz,
  published_at timestamptz,
  withdrawn_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  created_by_name text,
  published_by_name text,
  reach_count bigint,
  read_count bigint,
  total_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select n.id, n.title, n.body,
         n.audience_states, n.audience_cities, n.audience_gotras, n.audience_occupations,
         n.status, n.expires_at, n.published_at, n.withdrawn_at, n.created_at, n.updated_at,
         (select c.full_name from people c where c.auth_user_id = n.created_by),
         (select pb.full_name from people pb where pb.auth_user_id = n.published_by),
         (select count(*) from people p
          where p.member_status = 'approved'
            and notice_audience_matches(n.audience_states, n.audience_cities, n.audience_gotras,
                                        n.audience_occupations, p.current_state, p.current_city,
                                        p.gotra, p.occupation_type)),
         (select count(*) from notice_reads r where r.notice_id = n.id),
         count(*) over ()
  from notices n
  where is_admin()
    and (p_status is null or n.status = p_status)
    and (p_notice_id is null or n.id = p_notice_id)
  order by coalesce(n.withdrawn_at, n.published_at, n.updated_at) desc, n.id asc
  limit least(greatest(coalesce(p_limit, 25), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function admin_list_notices(text, uuid, int, int) from public;
grant execute on function admin_list_notices(text, uuid, int, int) to authenticated;

-- Create (p_notice_id null -> a new draft) or edit a notice. Drafts and
-- published notices are editable -- a typo shouldn't need a withdraw and
-- reissue -- but withdrawn ones are not. Editing a published notice is
-- audited; draft edits aren't (nobody has seen them). Returns the id.
create or replace function admin_save_notice(
  p_notice_id uuid,
  p_title text,
  p_body text,
  p_states text[] default '{}',
  p_cities text[] default '{}',
  p_gotras text[] default '{}',
  p_occupations text[] default '{}',
  p_expires_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_notice notices%rowtype;
  v_id uuid;
  v_occupations text[] := notice_clean_list(p_occupations);
  v_admin_person_id uuid;
begin
  if not is_admin() then
    raise exception 'Not an admin';
  end if;
  if p_title is null or length(trim(p_title)) = 0 then
    raise exception 'Please give the notice a title';
  end if;
  if length(trim(p_title)) > 120 then
    raise exception 'Keep the title to 120 characters';
  end if;
  if p_body is null or length(trim(p_body)) = 0 then
    raise exception 'Please write the notice';
  end if;
  if length(trim(p_body)) > 4000 then
    raise exception 'Keep the notice to 4000 characters';
  end if;
  -- Mirrors OCCUPATION_OPTIONS / the people.occupation_type check.
  if exists (select 1 from unnest(v_occupations) o
             where o not in ('Business', 'Job', 'Student', 'Homemaker', 'Retired', 'Other')) then
    raise exception 'Unknown occupation in the audience';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'The expiry date must be in the future';
  end if;

  if p_notice_id is null then
    insert into notices (title, body, audience_states, audience_cities, audience_gotras,
                         audience_occupations, expires_at, created_by)
    values (trim(p_title), trim(p_body), notice_clean_list(p_states), notice_clean_list(p_cities),
            notice_clean_list(p_gotras), v_occupations, p_expires_at, auth.uid())
    returning id into v_id;
    return v_id;
  end if;

  select * into v_notice from notices where id = p_notice_id for update;
  if not found then
    raise exception 'Notice not found';
  end if;
  if v_notice.status = 'withdrawn' then
    raise exception 'A withdrawn notice cannot be edited';
  end if;

  update notices
  set title = trim(p_title), body = trim(p_body),
      audience_states = notice_clean_list(p_states),
      audience_cities = notice_clean_list(p_cities),
      audience_gotras = notice_clean_list(p_gotras),
      audience_occupations = v_occupations,
      expires_at = p_expires_at, updated_at = now()
  where id = p_notice_id;

  if v_notice.status = 'published' then
    select id into v_admin_person_id from people where auth_user_id = auth.uid();
    insert into admin_audit_log (admin_id, action, target_type, target_id, notes)
    values (v_admin_person_id, 'notice_edited', 'notice', p_notice_id, null);
  end if;
  return p_notice_id;
end;
$$;

revoke all on function admin_save_notice(uuid, text, text, text[], text[], text[], text[], timestamptz) from public;
grant execute on function admin_save_notice(uuid, text, text, text[], text[], text[], text[], timestamptz) to authenticated;

-- draft -> published, published -> withdrawn. One-way: a withdrawn notice
-- stays withdrawn (copy it into a new draft instead). Both audited.
create or replace function admin_set_notice_status(p_notice_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_notice notices%rowtype;
  v_admin_person_id uuid;
begin
  if not is_admin() then
    raise exception 'Not an admin';
  end if;
  if p_status not in ('published', 'withdrawn') then
    raise exception 'Invalid status: %', p_status;
  end if;

  select * into v_notice from notices where id = p_notice_id for update;
  if not found then
    raise exception 'Notice not found';
  end if;

  if p_status = 'published' then
    if v_notice.status <> 'draft' then
      raise exception 'Only a draft can be published';
    end if;
    if v_notice.expires_at is not null and v_notice.expires_at <= now() then
      raise exception 'This notice has already expired -- change the expiry date first';
    end if;
    update notices
    set status = 'published', published_at = now(), published_by = auth.uid(), updated_at = now()
    where id = p_notice_id;
  else
    if v_notice.status <> 'published' then
      raise exception 'Only a published notice can be withdrawn';
    end if;
    update notices
    set status = 'withdrawn', withdrawn_at = now(), updated_at = now()
    where id = p_notice_id;
  end if;

  select id into v_admin_person_id from people where auth_user_id = auth.uid();
  insert into admin_audit_log (admin_id, action, target_type, target_id, notes)
  values (v_admin_person_id, 'notice_' || p_status, 'notice', p_notice_id, null);
end;
$$;

revoke all on function admin_set_notice_status(uuid, text) from public;
grant execute on function admin_set_notice_status(uuid, text) to authenticated;

-- Throw away a draft. Published / withdrawn notices are kept for the record.
create or replace function admin_delete_notice(p_notice_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not is_admin() then
    raise exception 'Not an admin';
  end if;
  delete from notices where id = p_notice_id and status = 'draft';
  if not found then
    raise exception 'Only a draft can be deleted';
  end if;
end;
$$;

revoke all on function admin_delete_notice(uuid) from public;
grant execute on function admin_delete_notice(uuid) to authenticated;

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

-- (0025) 6c helpers, ahead of everything that uses them.
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
-- Phase 6b (0024): browse
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

-- ================================================================
-- Phase 6b (0024): interests
-- ================================================================

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
