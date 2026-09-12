-- Phase 3c: the tabbed Profile page (replaces Edit profile + Family details).
--
-- Adds the richer per-member fields the Profile tabs capture, the extra
-- spouse/child details on family_relations/children, and the extra
-- listing fields on businesses. Nothing here changes who can read what:
-- every new `people` column stays in the never-exposed tier
-- (get_member_profile / list_directory are untouched), family_relations /
-- children stay self-scoped, and the new businesses columns are ordinary
-- public listing info (get_business returns them).
--
-- Name split: first_name / middle_name / last_name are the editable
-- columns from now on. full_name stays as the canonical *display* column
-- -- the header, directory, search_registered_members, and the
-- send-family-invite function all read it -- and is derived from the
-- three parts by a trigger, so no RPC on `people` had to change. Existing
-- rows are backfilled by a plain whitespace split (first token / last
-- token / whatever is between); members can fix the split on the Profile
-- page.
--
-- IMPORTANT: apply this BEFORE deploying the Phase 3c frontend. The app's
-- wizard-complete check now requires first_name, so without the backfill
-- every member would be bounced back to onboarding.
--
-- Run manually in the Supabase SQL editor -- this repo's migrations are not
-- wired to a runner (see 0001_init.sql).

-- ================================================================
-- people
-- ================================================================

alter table people
  add column first_name text,
  add column middle_name text,
  add column last_name text,
  add column blood_group text
    check (blood_group is null
           or blood_group in ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
  add column secondary_email text,
  add column secondary_mobile text
    check (secondary_mobile is null or secondary_mobile ~ '^\+91[6-9]\d{9}$'),
  add column residence_phone text,
  add column birth_place text,
  add column address_line2 text,
  add column address_line3 text,
  add column pincode text
    check (pincode is null or pincode ~ '^\d{6}$'),
  add column date_of_marriage date;

-- One-time backfill of the name parts from full_name.
with parts as (
  select id, regexp_split_to_array(trim(full_name), '\s+') as p
  from people
  where first_name is null and length(trim(full_name)) > 0
)
update people
set first_name = parts.p[1],
    last_name = case when array_length(parts.p, 1) >= 2
                     then parts.p[array_length(parts.p, 1)] end,
    middle_name = case when array_length(parts.p, 1) >= 3
                       then array_to_string(parts.p[2:array_length(parts.p, 1) - 1], ' ') end
from parts
where people.id = parts.id;

-- full_name is derived from the parts whenever they're written. Fires only
-- when a name-part column is in the SET list (or on insert), so writes that
-- don't touch the name never recompose it.
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

drop trigger if exists people_sync_full_name on people;
create trigger people_sync_full_name
  before insert or update of first_name, middle_name, last_name on people
  for each row execute function people_sync_full_name();

-- ================================================================
-- family_relations / children -- spouse & child details
-- ================================================================

alter table family_relations
  add column email text,
  add column profession text
    check (profession is null
           or profession in ('Business', 'Job', 'Student', 'Homemaker', 'Retired', 'Other')),
  add column blood_group text
    check (blood_group is null
           or blood_group in ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'));

alter table children
  add column relation text
    check (relation is null or relation in ('Son', 'Daughter')),
  add column education text,
  add column profession text
    check (profession is null
           or profession in ('Business', 'Job', 'Student', 'Homemaker', 'Retired', 'Other')),
  add column marital_status text,
  add column spouse_name text,
  add column blood_group text
    check (blood_group is null
           or blood_group in ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'));

-- Blank -> null, otherwise a loose "something@something.tld" check. Same
-- role as normalize_relative_mobile: only called from the definer functions.
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

-- Parameter lists change, so drop the old signatures first (postgres would
-- otherwise create ambiguous overloads).
drop function if exists save_family_relation(text, text, text, text, date);
drop function if exists add_child(text, text, text, date);
drop function if exists update_child(uuid, text, text, text, date);

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

-- ================================================================
-- businesses -- richer listing fields
-- ================================================================

-- Mirrored by BUSINESS_TYPE_OPTIONS in src/lib/formOptions.ts. "Business
-- type" is the nature of the business; "industry type" is the existing
-- `category` column.
alter table businesses
  add column brand_name text,
  add column address_line1 text,
  add column address_line2 text,
  add column business_email text,
  add column primary_product text,
  add column business_type text
    check (business_type is null or business_type in (
      'Manufacturer', 'Wholesaler', 'Retailer', 'Distributor',
      'Service provider', 'Professional practice', 'Other'
    )),
  add column facebook_url text,
  add column instagram_url text,
  add column linkedin_url text,
  add column youtube_url text;

-- RETURNS TABLE column list changes -> drop + recreate. list_businesses and
-- list_member_businesses are unchanged (cards don't show these fields).
drop function if exists get_business(uuid);

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
