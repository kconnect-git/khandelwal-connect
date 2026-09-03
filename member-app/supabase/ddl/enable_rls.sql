alter table people enable row level security;
alter table businesses enable row level security;
alter table events enable row level security;
alter table rsvps enable row level security;
alter table matrimony_profiles enable row level security;
alter table matrimony_interests enable row level security;
alter table dues enable row level security;
alter table admin_audit_log enable row level security;
alter table children enable row level security;
alter table family_relations enable row level security;

-- placeholder: users can read and edit only their own people row for now
create policy "own row read" on people for select
  using (auth.uid() = auth_user_id);
create policy "own row update" on people for update
  using (auth.uid() = auth_user_id);
create policy "own row insert" on people for insert
  with check (auth.uid() = auth_user_id);

-- Phase 2 (family details): children is multi-valued so it needs its own
-- table. Scoped by parent_person_id back to the caller's own people row --
-- no change needed to the people policies above, since everything the
-- family-details screen displays is denormalized onto the caller's own row.
create policy "own children read" on children for select
  using (parent_person_id in (select id from people where auth.uid() = auth_user_id));
create policy "own children insert" on children for insert
  with check (parent_person_id in (select id from people where auth.uid() = auth_user_id));
create policy "own children update" on children for update
  using (parent_person_id in (select id from people where auth.uid() = auth_user_id));
create policy "own children delete" on children for delete
  using (parent_person_id in (select id from people where auth.uid() = auth_user_id));

-- Post-3b (0016): family_relations replaces the 6 single-valued *_name/
-- *_member_code/*_mobile_number/*_dob column groups on people (father,
-- mother, spouse, maternal_uncle, spouse_father, spouse_mother). Same
-- self-scoped-by-person_id shape as children above.
create policy "own family relations read" on family_relations for select
  using (person_id in (select id from people where auth.uid() = auth_user_id));
create policy "own family relations insert" on family_relations for insert
  with check (person_id in (select id from people where auth.uid() = auth_user_id));
create policy "own family relations update" on family_relations for update
  using (person_id in (select id from people where auth.uid() = auth_user_id));
create policy "own family relations delete" on family_relations for delete
  using (person_id in (select id from people where auth.uid() = auth_user_id));

-- Phase 3b (0014): businesses -- any onboarded member reads, owner writes.
-- Any member who has completed onboarding can read listings. The subquery
-- runs under people's own self-only policy, which is exactly enough here
-- (we only need the caller's own row).
create policy "members read businesses" on businesses for select
  using (exists (select 1 from people where auth_user_id = auth.uid() and member_code is not null));

create policy "own business insert" on businesses for insert
  with check (owner_id in (select id from people where auth_user_id = auth.uid()));
create policy "own business update" on businesses for update
  using (owner_id in (select id from people where auth_user_id = auth.uid()));
create policy "own business delete" on businesses for delete
  using (owner_id in (select id from people where auth_user_id = auth.uid()));

-- everything else stays fully closed until you write real policies for it