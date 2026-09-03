-- Two changes, both driven by wanting member-code generation to happen at
-- the moment the onboarding wizard is finished (step 3's "Finish" click),
-- bundled into the same database write as saving that step's fields --
-- rather than lazily, on some later page load noticing member_code is null.
--
-- 1. assign_member_code() is redefined with an *explicit* per-state
--    collision check (`where state_code = v_state_code and member_code =
--    v_candidate`) instead of relying implicitly on the fact that a global
--    unique constraint on member_code happens to be state-scoped because
--    the state code is embedded in the string. Same behavior, clearer to
--    read. The exception handler stays as a race-condition safety net for
--    the TOCTOU gap between the check and the update.
--
-- 2. complete_onboarding_step3() wraps: (a) writing the wizard's step-3
--    fields (gotra, marital_status, education) and (b) calling
--    assign_member_code() -- both inside one SECURITY DEFINER function, so
--    the client makes a single RPC call and the two things happen in one
--    round trip / one transaction. state_code and mobile_number are
--    already on the row by this point (saved during steps 1-2), which is
--    what assign_member_code() needs.
--
-- Run manually in the Supabase SQL editor -- this repo's migrations are not
-- wired to a runner (see 0001_init.sql).

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

    -- Explicit per-state check: only a member who shares this same
    -- state_code and this exact candidate counts as a collision. A member
    -- in a different state with the same last 4 digits produces a
    -- different string entirely (different state segment) and never
    -- reaches this comparison.
    if not exists (
      select 1 from people
      where state_code = v_state_code
        and member_code = v_candidate
    ) then
      begin
        update people set member_code = v_candidate where id = v_person_id;
        return v_candidate;
      exception when unique_violation then
        -- Lost a race to a concurrent assignment for the same candidate;
        -- keep looping to the next number.
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
