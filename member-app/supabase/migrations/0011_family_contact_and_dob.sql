-- Post-Phase-3a: capture a mobile number and date of birth for each relative
-- entered on the Family details screen (father/mother/spouse/maternal uncle/
-- spouse's parents, and each child).
--
-- Same denormalized posture as 0006: these are the *caller's* entries about
-- their relative, stored on the caller's own row (or the caller's own
-- `children` row). Nothing is copied from, or written to, the relative's own
-- `people` row even when a member code links them -- so a linked member's
-- real dob (never exposed cross-member, see 0010) stays private.
--
-- Run manually in the Supabase SQL editor -- this repo's migrations are not
-- wired to a runner (see 0001_init.sql).

alter table people
  add column father_mobile_number text,
  add column father_dob date,
  add column mother_mobile_number text,
  add column mother_dob date,
  add column spouse_mobile_number text,
  add column spouse_dob date,
  add column maternal_uncle_mobile_number text,
  add column maternal_uncle_dob date,
  add column spouse_father_mobile_number text,
  add column spouse_father_dob date,
  add column spouse_mother_mobile_number text,
  add column spouse_mother_dob date;

alter table children
  add column child_mobile_number text,
  add column child_dob date;

-- The three family RPCs gain two optional params. `create or replace` with a
-- different parameter list would ADD an overload rather than replace, and
-- the old 3-arg shape would then be ambiguous with the new one's defaults --
-- so drop the old signatures explicitly first.
drop function if exists save_family_relation(text, text, text);
drop function if exists add_child(text, text);
drop function if exists update_child(uuid, text, text);

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
  v_mobile text;
  v_dob date;
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

  v_mobile := normalize_relative_mobile(p_mobile_number);
  v_dob := check_relative_dob(p_dob);

  if p_slot = 'father' then
    update people set father_name = p_name, father_member_code = p_member_code, father_id = v_matched_id,
      father_mobile_number = v_mobile, father_dob = v_dob where id = v_self_id;
  elsif p_slot = 'mother' then
    update people set mother_name = p_name, mother_member_code = p_member_code, mother_id = v_matched_id,
      mother_mobile_number = v_mobile, mother_dob = v_dob where id = v_self_id;
  elsif p_slot = 'spouse' then
    update people set spouse_name = p_name, spouse_member_code = p_member_code, spouse_id = v_matched_id,
      spouse_mobile_number = v_mobile, spouse_dob = v_dob where id = v_self_id;
  elsif p_slot = 'maternal_uncle' then
    update people set maternal_uncle_name = p_name, maternal_uncle_member_code = p_member_code, maternal_uncle_id = v_matched_id,
      maternal_uncle_mobile_number = v_mobile, maternal_uncle_dob = v_dob where id = v_self_id;
  elsif p_slot = 'spouse_father' then
    update people set spouse_father_name = p_name, spouse_father_member_code = p_member_code, spouse_father_id = v_matched_id,
      spouse_father_mobile_number = v_mobile, spouse_father_dob = v_dob where id = v_self_id;
  elsif p_slot = 'spouse_mother' then
    update people set spouse_mother_name = p_name, spouse_mother_member_code = p_member_code, spouse_mother_id = v_matched_id,
      spouse_mother_mobile_number = v_mobile, spouse_mother_dob = v_dob where id = v_self_id;
  end if;
end;
$$;

revoke all on function save_family_relation(text, text, text, text, date) from public;
grant execute on function save_family_relation(text, text, text, text, date) to authenticated;

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
