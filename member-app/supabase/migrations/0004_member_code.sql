-- Adds a per-member code, format KHA-<2-letter state code>-<4 digits>,
-- e.g. KHA-RJ-4578, assigned once the profile wizard is completed.
--
-- state_code is populated directly by the "Current state" dropdown on the
-- client (see formOptions.ts's STATE_CODE_BY_NAME) -- this migration and
-- assign_member_code() never derive or look up the state abbreviation from
-- the state name themselves.
--
-- Collision handling: the 4-digit part starts as the last 4 digits of the
-- member's phone number. With only 10,000 possible 4-digit combinations and
-- 500+ members, collisions across the whole member base are near-certain
-- (birthday-paradox math), though rare within any single state's smaller
-- pool. Because the state code is embedded in member_code itself, a plain
-- global UNIQUE constraint on member_code already scopes collision
-- avoidance per state: two members in different states can never collide
-- (their codes differ in the state segment even with the same last 4
-- digits), so the only real collisions are same-state ones, which is
-- exactly what should be checked. assign_member_code() walks forward from
-- the phone-derived number (last4, last4+1, last4+2, ... wrapping at 10000)
-- until it finds a 4-digit slot free within that state.
--
-- assign_member_code() runs as SECURITY DEFINER because normal RLS
-- ("own row read/update") would otherwise stop a member from even
-- indirectly detecting whether another member's number is taken -- the
-- function bypasses that only to perform the collision check and write to
-- the caller's own row (found via auth.uid()), nothing else.
--
-- Run manually in the Supabase SQL editor -- this repo's migrations are not
-- wired to a runner (see 0001_init.sql).

alter table people add column state_code text;
alter table people add column member_code text unique;

alter table people add constraint people_state_code_format
  check (state_code is null or state_code ~ '^[A-Z]{2}$');

alter table people add constraint people_member_code_format
  check (member_code is null or member_code ~ '^KHA-[A-Z]{2}-\d{4}$');

create index people_state_code_idx on people (state_code);

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

  -- Idempotent: calling this again for an already-assigned member just
  -- returns their existing code instead of erroring or reassigning.
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

    begin
      update people set member_code = v_candidate where id = v_person_id;
      return v_candidate;
    exception when unique_violation then
      -- v_candidate was taken (by this state's existing member, or a
      -- concurrent assignment) -- try the next number in sequence.
      null;
    end;
  end loop;

  raise exception 'Could not assign a unique member code for state %', v_state_code;
end;
$$;

revoke all on function assign_member_code() from public;
grant execute on function assign_member_code() to authenticated;
