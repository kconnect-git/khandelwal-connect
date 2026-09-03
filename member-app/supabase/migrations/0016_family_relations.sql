-- Normalizes the six single-valued family-relation slots (father, mother,
-- spouse, maternal_uncle, spouse_father, spouse_mother) off `people` and
-- into one table shaped like `children` (0006) -- same
-- name/member_code/resolved-id/mobile/dob pattern, one row per slot instead
-- of 5 columns per slot repeated six times.
--
-- Why: those 6 slots x 5 fields (id/name/member_code/mobile/dob) account for
-- 30 of people's 53 columns. Not a performance problem -- Postgres handles a
-- wide table fine at this scale -- but a maintainability one: a 7th slot
-- (sibling, grandparent) would otherwise mean 5 more columns and another
-- branch in 3 RPCs, forever. This table makes a new slot an insert.
--
-- Expand-contract migration: this step ADDS family_relations and backfills
-- it, and repoints save_family_relation to write there instead of `people`.
-- It deliberately does NOT drop the 30 old people columns yet -- they
-- become frozen/historical the moment this ships (save_family_relation
-- stops writing to them), safe to drop in a later migration once the app
-- has run against family_relations in production for a while. Don't read
-- them going forward; the app already doesn't (see the same-session client
-- changes to FamilyDetails.tsx / profileCompletion.ts / Dashboard.tsx /
-- ProfileEdit.tsx).
--
-- Run manually in the Supabase SQL editor -- this repo's migrations are not
-- wired to a runner (see 0001_init.sql).

create table family_relations (
  id uuid primary key default gen_random_uuid(),
  person_id uuid references people(id) not null,
  slot text not null check (slot in ('father', 'mother', 'spouse', 'maternal_uncle', 'spouse_father', 'spouse_mother')),
  related_name text,
  related_member_code text,
  related_id uuid references people(id),
  mobile_number text,
  dob date,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (person_id, slot)
);

create index family_relations_person_id_idx on family_relations (person_id);

alter table family_relations enable row level security;

-- Same self-scoped shape as children's policies (0006) -- everything here
-- is denormalized onto the caller's own person_id, so no cross-row read is
-- ever needed for these four.
create policy "own family relations read" on family_relations for select
  using (person_id in (select id from people where auth_user_id = auth.uid()));
create policy "own family relations insert" on family_relations for insert
  with check (person_id in (select id from people where auth_user_id = auth.uid()));
create policy "own family relations update" on family_relations for update
  using (person_id in (select id from people where auth_user_id = auth.uid()));
create policy "own family relations delete" on family_relations for delete
  using (person_id in (select id from people where auth_user_id = auth.uid()));

-- One-time backfill from the 6 slot-columns on people. Only rows that
-- actually have a name are copied -- an empty slot stays absent, same as
-- "no row" meaning "not entered yet" going forward.
insert into family_relations (person_id, slot, related_name, related_member_code, related_id, mobile_number, dob)
select id, 'father', father_name, father_member_code, father_id, father_mobile_number, father_dob
from people where father_name is not null
union all
select id, 'mother', mother_name, mother_member_code, mother_id, mother_mobile_number, mother_dob
from people where mother_name is not null
union all
select id, 'spouse', spouse_name, spouse_member_code, spouse_id, spouse_mobile_number, spouse_dob
from people where spouse_name is not null
union all
select id, 'maternal_uncle', maternal_uncle_name, maternal_uncle_member_code, maternal_uncle_id, maternal_uncle_mobile_number, maternal_uncle_dob
from people where maternal_uncle_name is not null
union all
select id, 'spouse_father', spouse_father_name, spouse_father_member_code, spouse_father_id, spouse_father_mobile_number, spouse_father_dob
from people where spouse_father_name is not null
union all
select id, 'spouse_mother', spouse_mother_name, spouse_mother_member_code, spouse_mother_id, spouse_mother_mobile_number, spouse_mother_dob
from people where spouse_mother_name is not null;

-- Rewritten as an upsert into family_relations. Much shorter than the old
-- 6-way if/elsif over 6x5 people columns -- adding a 7th slot here is a
-- change to the check constraint above, not a new branch or new columns.
create or replace function save_family_relation(
  p_slot text,
  p_name text,
  p_member_code text default null,
  p_mobile_number text default null,
  p_dob date default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_self_id uuid;
  v_matched_id uuid;
begin
  select id into v_self_id from people where auth_user_id = auth.uid();
  if v_self_id is null then
    raise exception 'No person row for the current user';
  end if;
  if p_slot not in ('father', 'mother', 'spouse', 'maternal_uncle', 'spouse_father', 'spouse_mother') then
    raise exception 'Invalid slot: %', p_slot;
  end if;

  if p_member_code is not null and length(trim(p_member_code)) > 0 then
    select id into v_matched_id from people where member_code = p_member_code;
    if v_matched_id is null then
      raise exception 'No registered member found with code %', p_member_code;
    end if;
  else
    v_matched_id := null;
    p_member_code := null;
  end if;

  insert into family_relations (person_id, slot, related_name, related_member_code, related_id, mobile_number, dob)
  values (v_self_id, p_slot, p_name, p_member_code, v_matched_id,
          normalize_relative_mobile(p_mobile_number), check_relative_dob(p_dob))
  on conflict (person_id, slot) do update
    set related_name = excluded.related_name,
        related_member_code = excluded.related_member_code,
        related_id = excluded.related_id,
        mobile_number = excluded.mobile_number,
        dob = excluded.dob,
        updated_at = now();
end;
$$;
