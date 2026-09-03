-- Phase 2: family details capture (simplified -- no tree/graph yet, see
-- khandelwal-connect-project-context.md and the Phase 2 plan for scope).
--
-- Each single-valued relation gets a denormalized name + member-code pair on
-- the caller's own `people` row. father_id/mother_id/spouse_id already
-- exist; maternal_uncle_id/spouse_father_id/spouse_mother_id are new. The
-- *_id column is only ever set once the *_member_code resolves to a real
-- registered member (see save_family_relation in 0007) -- it stays null for
-- a plain-text-only entry (relative not registered, or not searched for).
--
-- Run manually in the Supabase SQL editor -- this repo's migrations are not
-- wired to a runner (see 0001_init.sql).

alter table people
  add column father_name text,
  add column father_member_code text,
  add column mother_name text,
  add column mother_member_code text,
  add column spouse_name text,
  add column spouse_member_code text,
  add column maternal_uncle_id uuid references people(id),
  add column maternal_uncle_name text,
  add column maternal_uncle_member_code text,
  add column spouse_father_id uuid references people(id),
  add column spouse_father_name text,
  add column spouse_father_member_code text,
  add column spouse_mother_id uuid references people(id),
  add column spouse_mother_name text,
  add column spouse_mother_member_code text;

-- Children are multi-valued, so they need their own table rather than more
-- columns on `people`. Same name + member_code + resolved-id pattern as the
-- single-valued relations above, one row per child.
create table children (
  id uuid primary key default gen_random_uuid(),
  parent_person_id uuid references people(id) not null,
  child_name text not null,
  child_member_code text,
  child_id uuid references people(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table children enable row level security;

create policy "own children read" on children for select
  using (parent_person_id in (select id from people where auth_user_id = auth.uid()));
create policy "own children insert" on children for insert
  with check (parent_person_id in (select id from people where auth_user_id = auth.uid()));
create policy "own children update" on children for update
  using (parent_person_id in (select id from people where auth_user_id = auth.uid()));
create policy "own children delete" on children for delete
  using (parent_person_id in (select id from people where auth_user_id = auth.uid()));

-- No changes to the existing `people` RLS policies: everything this phase
-- displays is denormalized onto the caller's own row, so self-only
-- read/update already covers it. The only cross-row read is the narrow
-- search_registered_members() function in 0007, which is not a general
-- table grant.
