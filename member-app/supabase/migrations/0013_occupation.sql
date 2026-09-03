-- Phase 3b, step 1: occupation on the person.
--
-- A fixed occupation select (no free-text profession) captured on the Edit
-- profile screen only -- deliberately NOT in the onboarding wizard, to keep
-- signup short. When occupation is 'Job', three sub-fields (title, company,
-- work location) are captured too. When it's 'Business', the member lists
-- their business(es) on the Businesses pages instead (next migration) --
-- nothing business-specific lives on `people`.
--
-- Visibility: occupation + job fields join the *directory* tier (they're
-- the basis of the directory's Occupation filter and show on cards), so
-- list_directory / get_member_profile both return them. Nothing from the
-- never-exposed tier (home_address, dob, gender, family_*) is touched.
--
-- Run manually in the Supabase SQL editor -- this repo's migrations are not
-- wired to a runner (see 0001_init.sql).

alter table people
  add column occupation_type text
    check (occupation_type is null
           or occupation_type in ('Business', 'Job', 'Student', 'Homemaker', 'Retired', 'Other')),
  add column job_title text,
  add column company_name text,
  add column job_location text;

-- Both table-returning functions change their column lists, and
-- list_directory also gains a parameter, so drop + recreate (postgres won't
-- `create or replace` across either kind of change).
drop function if exists list_directory(text, text, text, text, int, int);
drop function if exists get_member_profile(uuid);

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
