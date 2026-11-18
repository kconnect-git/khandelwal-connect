-- Auto-approve switch for the member approval queue.
--
--   * member_approval_settings: one row, auto_approve off by default.
--     RPC-only (RLS on, no policies).
--   * admin_member_approval_settings(): any admin reads the switch.
--   * admin_set_member_auto_approve(bool): super admin only, audited as
--     member_auto_approve_on / _off (same shape as the paywall switches).
--   * submit_for_review(): unchanged until the profile is moved to
--     'pending'; with the switch on it then goes straight to 'approved'
--     (reviewed_by null = nobody reviewed it) and logs member_auto_approved
--     with a null admin_id. That covers the wizard's Finish, the
--     useProfileStatus catch-up call and a resubmit after "More info".
--     Turning the switch on does NOT approve people already waiting in
--     Pending; they are still reviewed by hand.
--   * No status email for an auto-approval: send-member-status is admin-only,
--     and the member lands on the dashboard right away.
--
-- ORDER OF DEPLOY: apply this, then the frontend. Re-runnable.

-- ================================================================
-- table
-- ================================================================

create table if not exists member_approval_settings (
  id boolean primary key default true check (id),
  auto_approve boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

insert into member_approval_settings (id) values (true) on conflict (id) do nothing;

alter table member_approval_settings enable row level security;

-- ================================================================
-- admin RPCs
-- ================================================================

create or replace function admin_member_approval_settings()
returns table (
  auto_approve boolean,
  updated_at timestamptz,
  updated_by_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select s.auto_approve, s.updated_at,
         (select p.full_name from people p where p.auth_user_id = s.updated_by)
  from member_approval_settings s
  where is_admin();
$$;

revoke all on function admin_member_approval_settings() from public;
grant execute on function admin_member_approval_settings() to authenticated;
revoke execute on function admin_member_approval_settings() from anon;

create or replace function admin_set_member_auto_approve(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current boolean;
  v_admin_person_id uuid;
begin
  if coalesce(admin_role(), '') <> 'super_admin' then
    raise exception 'Only a super admin can change auto-approval';
  end if;
  if p_enabled is null then
    raise exception 'Say whether to turn auto-approval on or off';
  end if;

  select auto_approve into v_current from member_approval_settings where id for update;
  if v_current = p_enabled then
    raise exception 'Auto-approval is already %', case when p_enabled then 'on' else 'off' end;
  end if;

  update member_approval_settings
  set auto_approve = p_enabled, updated_at = now(), updated_by = auth.uid()
  where id;

  select id into v_admin_person_id from people where auth_user_id = auth.uid();
  insert into admin_audit_log (admin_id, action, target_type, target_id, notes)
  values (v_admin_person_id,
          case when p_enabled then 'member_auto_approve_on' else 'member_auto_approve_off' end,
          null, null, null);
end;
$$;

revoke all on function admin_set_member_auto_approve(boolean) from public;
grant execute on function admin_set_member_auto_approve(boolean) to authenticated;
revoke execute on function admin_set_member_auto_approve(boolean) from anon;

-- ================================================================
-- submit_for_review: + auto-approve
-- ================================================================

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

  if coalesce((select s.auto_approve from member_approval_settings s where s.id), false) then
    update people
    set member_status = 'approved', admin_message = null,
        submitted_at = now(), reviewed_by = null, reviewed_at = now(), updated_at = now()
    where id = v_person.id;

    insert into admin_audit_log (admin_id, action, target_type, target_id, notes)
    values (null, 'member_auto_approved', 'person', v_person.id, null);
  else
    update people
    set member_status = 'pending', submitted_at = now(), updated_at = now()
    where id = v_person.id;
  end if;

  return v_code;
end;
$$;

revoke all on function submit_for_review() from public;
grant execute on function submit_for_review() to authenticated;
revoke execute on function submit_for_review() from anon;

-- ================================================================
-- verification
-- ================================================================
-- select * from member_approval_settings;            -- 1 row, auto_approve false
-- select proname from pg_proc where proname in
--   ('admin_member_approval_settings', 'admin_set_member_auto_approve');  -- 2 rows
