-- Post-3a/0011 follow-up: search_registered_members now also returns the
-- matched member's mobile_number, so selecting a search result on Family
-- details can auto-fill the relative's phone number.
--
-- This is NOT a new privacy exposure: mobile_number is already printed as
-- text on every member's profile screen (get_member_profile, 0010) and
-- readable by any logged-in member there. dob deliberately stays out of
-- this function's return list -- Phase 3a's "never returned to other
-- members" tier (see phase-3a-summary.md §1) still applies to dob, and this
-- migration does not touch that.
--
-- `RETURNS TABLE` can't change its column list via `create or replace` --
-- postgres requires the old function to be dropped first.
--
-- Run manually in the Supabase SQL editor -- this repo's migrations are not
-- wired to a runner (see 0001_init.sql).

drop function if exists search_registered_members(text, text, text);

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
  member_code text,
  mobile_number text
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.full_name, p.gotra, p.native_place, p.current_city, p.current_state, p.member_code, p.mobile_number
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
