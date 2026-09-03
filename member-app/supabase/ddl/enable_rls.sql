alter table people enable row level security;
alter table businesses enable row level security;
alter table events enable row level security;
alter table rsvps enable row level security;
alter table matrimony_profiles enable row level security;
alter table matrimony_interests enable row level security;
alter table dues enable row level security;
alter table admin_audit_log enable row level security;

-- placeholder: users can read and edit only their own people row for now
create policy "own row read" on people for select
  using (auth.uid() = auth_user_id);
create policy "own row update" on people for update
  using (auth.uid() = auth_user_id);
create policy "own row insert" on people for insert
  with check (auth.uid() = auth_user_id);

-- everything else stays fully closed until you write real policies for it