-- Historical record of a migration already applied manually via the Supabase
-- SQL editor on project agxygngazgmemplcogho (Singapore). This file is not
-- wired to any migration runner -- it exists so the schema is version-
-- controlled and reviewable in git, not to be executed automatically.
-- If the team later adopts CLI-managed migrations (supabase login +
-- supabase link --project-ref agxygngazgmemplcogho + supabase db pull),
-- reconcile against this file first.
--
-- Other tables (businesses, events, rsvps, matrimony_profiles,
-- matrimony_interests, dues, admin_audit_log) and the 4 storage buckets are
-- also live on this project, but their DDL isn't captured here yet -- add it
-- in a follow-up migration file when each is actually wired up.

create table people (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid references auth.users(id),
  full_name text not null,
  gender text,
  dob date,
  gotra text,
  native_place text,
  district text,
  state text,
  father_id uuid references people(id),
  mother_id uuid references people(id),
  spouse_id uuid references people(id),
  current_city text,
  marital_status text,
  education text,
  profile_photo_url text,
  mobile_number text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table people enable row level security;

create policy "own row read" on people for select
  using (auth.uid() = auth_user_id);
create policy "own row update" on people for update
  using (auth.uid() = auth_user_id);
create policy "own row insert" on people for insert
  with check (auth.uid() = auth_user_id);
