-- Fixes the root cause behind PGRST116 errors seen during Phase 1 testing:
-- the people table had no constraint stopping two rows from sharing the
-- same auth_user_id, and Phase 0's verify flow inserted unconditionally on
-- every successful OTP verify. Run each step manually in the Supabase SQL
-- editor, in order -- steps 1-2 are read-only checks, step 3 deletes data,
-- step 4 adds the constraint (will fail if duplicates still exist).

-- 1. See which accounts have more than one row.
select auth_user_id, count(*)
from people
group by auth_user_id
having count(*) > 1;

-- 2. Inspect the duplicates before deleting anything (swap in a uuid from step 1).
-- select * from people where auth_user_id = '<uuid-from-step-1>' order by created_at;

-- 3. Keep the oldest row per auth_user_id, delete the rest.
delete from people a
using people b
where a.auth_user_id = b.auth_user_id
  and a.created_at > b.created_at;

-- 4. Prevent this from ever happening again at the database level.
alter table people add constraint people_auth_user_id_key unique (auth_user_id);
