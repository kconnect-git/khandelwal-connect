-- Repurposes district/state as the member's *current* district/state
-- (paired with current_city) rather than the native place's, and adds a
-- free-text home_address field. native_place remains a standalone field
-- (see StepLocation.tsx) with no district/state of its own.
-- Run manually in the Supabase SQL editor -- this repo's migrations are not
-- wired to a runner (see 0001_init.sql).

alter table people rename column district to current_district;
alter table people rename column state to current_state;
alter table people add column home_address text;
