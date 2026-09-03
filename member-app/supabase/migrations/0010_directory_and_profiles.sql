-- Phase 3a: directory & member profiles.
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
create or replace function list_directory(
  p_search text default null,
  p_state text default null,
  p_city text default null,
  p_gotra text default null,
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
  total_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.full_name, p.gotra, p.native_place, p.current_city, p.current_state,
         p.member_code, p.profile_photo_url,
         count(*) over () as total_count
  from people p
  where p.member_code is not null
    and (p_search is null or length(trim(p_search)) = 0
         or p.full_name ilike '%' || p_search || '%')
    and (p_state is null or p.current_state ilike p_state)
    and (p_city is null or p.current_city ilike p_city)
    and (p_gotra is null or p.gotra ilike p_gotra)
  order by p.full_name asc, p.id asc
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function list_directory(text, text, text, text, int, int) from public;
grant execute on function list_directory(text, text, text, text, int, int) to authenticated;

-- One member's profile-tier fields. Zero rows if the id doesn't exist or the
-- person hasn't completed onboarding.
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
  profile_photo_url text
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.full_name, p.gotra, p.native_place, p.current_city, p.current_district,
         p.current_state, p.member_code, p.education, p.marital_status,
         p.mobile_number, p.profile_photo_url
  from people p
  where p.id = p_person_id
    and p.member_code is not null;
$$;

revoke all on function get_member_profile(uuid) from public;
grant execute on function get_member_profile(uuid) to authenticated;

-- Distinct filter values actually present among members, so the directory's
-- filter chips only ever offer options that return results.
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
  ) f
  order by f.kind, f.value;
$$;

revoke all on function directory_filter_options() from public;
grant execute on function directory_filter_options() to authenticated;

-- profile-photos had insert + read policies only (Phase 0). Re-uploading a
-- photo replaces the file, so owners also need update + delete on their own
-- folder ({auth_user_id}/...).
create policy "own profile photo update"
  on storage.objects for update
  using (bucket_id = 'profile-photos' and auth.uid()::text = (storage.foldername(name))[1]);

create policy "own profile photo delete"
  on storage.objects for delete
  using (bucket_id = 'profile-photos' and auth.uid()::text = (storage.foldername(name))[1]);
