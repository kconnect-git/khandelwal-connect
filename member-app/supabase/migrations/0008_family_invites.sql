-- Phase 2: family invites. Tracks invite emails sent for a relation that
-- couldn't be matched to a registered member, so the UI can show "invited on
-- <date>" instead of a blank state and so duplicate sends are visible.
-- Actual email sending happens in the send-family-invite Edge Function (not
-- SQL) -- this table is written by that function using the inviter's own
-- session, so it's just a normal self-scoped insert under RLS.
--
-- Run manually in the Supabase SQL editor -- this repo's migrations are not
-- wired to a runner (see 0001_init.sql).

create table family_invites (
  id uuid primary key default gen_random_uuid(),
  inviter_person_id uuid references people(id) not null,
  slot text not null check (slot in ('father', 'mother', 'spouse', 'maternal_uncle', 'spouse_father', 'spouse_mother', 'child')),
  child_row_id uuid references children(id),
  invitee_email text not null,
  created_at timestamptz default now()
);

alter table family_invites enable row level security;

create policy "own invites read" on family_invites for select
  using (inviter_person_id in (select id from people where auth_user_id = auth.uid()));
create policy "own invites insert" on family_invites for insert
  with check (inviter_person_id in (select id from people where auth_user_id = auth.uid()));
