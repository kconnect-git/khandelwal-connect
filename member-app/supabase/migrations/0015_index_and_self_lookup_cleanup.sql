-- Quick, safe cleanup -- no schema shape changes.
--
-- 1. children.parent_person_id had no index despite being the RLS filter
--    column on every children policy and the exact column getChildren()
--    filters on for every Family details page load.
--
-- 2. Five RPCs looked up the caller's own people row with
--    `order by created_at asc, id asc limit 1` -- a tiebreak defending
--    against duplicate auth_user_id rows. That problem was fixed for good
--    in migration 0002 (`alter table people add constraint
--    people_auth_user_id_key unique (auth_user_id)`), which has been live
--    since Phase 1. The ORDER BY has been dead weight (forces a sort for no
--    reason) ever since; `core_schema.sql` never documented the constraint
--    either, so this went unnoticed. Simplified to a plain lookup here.
--
-- Run manually in the Supabase SQL editor -- this repo's migrations are not
-- wired to a runner (see 0001_init.sql).

create index if not exists children_parent_person_id_idx on children (parent_person_id);

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
