-- Reverts 0008_family_invites.sql. Family invites are now a plain,
-- untracked notification email (see send-family-invite) -- no auth account
-- is created and nothing is persisted, so this table has no purpose.
--
-- Run manually in the Supabase SQL editor -- this repo's migrations are not
-- wired to a runner (see 0001_init.sql).

drop table if exists family_invites;
