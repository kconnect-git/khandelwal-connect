-- Phase 11.6: Events gating (see events-paid-features.md, phase-11-plan.md).
--
-- Depends on has_service_access(me, 'events'), true for everyone while the
-- Events paywall is off -- applying this changes nothing until a super
-- admin turns that paywall on.
--
--   * save_event (create): refused without Events access (SQLSTATE KCL04).
--     Admins always pass, so committee events are unaffected.
--   * Untouched, free for everyone: browsing, viewing, joining / leaving
--     (rsvp_event), receiving invites. Committee events are free to view and
--     join; an invite-only one is limited by the invite, never by payment.
--   * Untouched on purpose (lapse rule): update_event, cancel_event,
--     add_event_invitee / remove_event_invitee and the send-event-invite
--     function. Each already requires the caller to be the event's creator,
--     and a member can only have created an event with access (or before the
--     paywall), so what they already have keeps working.
--
-- Body is the current one (ddl/core_schema.sql) with only the marked change;
-- same return type, so create or replace. Now closed to anon.
--
-- ORDER OF DEPLOY: 0037 applied. Apply this, then the frontend (which sets
-- PAYWALL_READY.events so the admin page offers Turn on).
--
-- Re-runnable.

begin;

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
  -- (0038) Creating events is part of Events access; admins (committee
  -- events) always pass. Editing, cancelling and inviting to events you
  -- already created stay open after a lapse.
  if not has_service_access(v_self_id, 'events') then
    raise exception using errcode = 'KCL04',
      message = 'Creating events is part of Events access.';
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
revoke execute on function save_event(text, text, timestamptz, timestamptz, text, text, text, int, text) from anon;

commit;

-- ================================================================
-- verification (run these after applying)
-- ================================================================
-- select pg_get_functiondef(oid) like '%has_service_access(v_self_id, ''events'')%' as gated,
--        has_function_privilege('anon', oid, 'execute') as anon
-- from pg_proc where proname = 'save_event';
--   -- gated true, anon false
--
-- With the Events paywall ON, as a member without an Events grant:
--   save_event(...) -> KCL04 "Creating events is part of Events access."
--   rsvp_event / editing their existing events -> unchanged
