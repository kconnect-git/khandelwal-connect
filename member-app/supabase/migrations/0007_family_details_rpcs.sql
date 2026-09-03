-- Phase 2: family details RPCs. Depends on 0006_family_details.sql.
--
-- Run manually in the Supabase SQL editor -- this repo's migrations are not
-- wired to a runner (see 0001_init.sql).

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
