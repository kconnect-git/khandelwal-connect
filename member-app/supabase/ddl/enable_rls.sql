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
--
-- (0019) "own row update" is column-blind, so it would also let a member
-- write member_status / admin_message / reviewed_* / member_code on their own
-- row and approve themselves. The people_protect_review_columns trigger in
-- core_schema.sql blocks exactly those columns on the client path; keep it in
-- mind before widening this policy.
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

-- Phase 3b (0014): businesses -- any approved member reads, owner writes.
-- (0019) Reading is now gated on approval, not merely on having onboarded.
-- The owner clause matters: getMyBusinesses() in lib/businesses.ts selects
-- this table directly, so without it a member awaiting approval would lose
-- their own Profile > Business tab.
-- (0021) A listing an admin has hidden is readable by its owner only.
create policy "members read businesses" on businesses for select
  using ((is_approved_member() and not is_hidden)
         or owner_id in (select id from people where auth_user_id = auth.uid()));

create policy "own business insert" on businesses for insert
  with check (owner_id in (select id from people where auth_user_id = auth.uid()));
create policy "own business update" on businesses for update
  using (owner_id in (select id from people where auth_user_id = auth.uid()));
create policy "own business delete" on businesses for delete
  using (owner_id in (select id from people where auth_user_id = auth.uid()));

-- Phase 4 (0018): events / rsvps / event_invites / admins. WRITES ARE
-- RPC-ONLY -- there are deliberately no insert/update/delete policies on any
-- of these; every write goes through a SECURITY DEFINER function (see
-- core_schema.sql's Phase 4 section and 0018's header for why). These
-- select policies are a safety net only; the app reads through RPCs too.
alter table event_invites enable row level security;
alter table admins enable row level security;

create policy "events visible read" on events for select
  using (
    (status in ('approved', 'cancelled') and visibility = 'members'
       and is_approved_member())
    or creator_id in (select id from people where auth_user_id = auth.uid())
    or exists (select 1 from event_invites i join people p on p.id = i.person_id
               where i.event_id = events.id and p.auth_user_id = auth.uid())
    or is_admin()
  );

create policy "own rsvps read" on rsvps for select
  using (person_id in (select id from people where auth_user_id = auth.uid()));

create policy "own invites read" on event_invites for select
  using (person_id in (select id from people where auth_user_id = auth.uid())
         or invited_by in (select id from people where auth_user_id = auth.uid()));

-- admins: no policies at all (only is_admin() reads it).

-- Phase 5c (0022): notices / notice_reads. RPC-only, like events -- no
-- policies at all; members read through list_my_notices /
-- notice_unread_count and write only through mark_notices_read.
alter table notices enable row level security;
alter table notice_reads enable row level security;

-- everything else stays fully closed until you write real policies for it