-- Phase 10.6: Buy & Sell -- requirements and offers from members.
--
--   * business_posts: any approved member posts what they're looking for
--     (requirement) or offering (offer), optionally as one of their approved
--     listings. Posts go live at once, expire after 30 days, and the poster
--     can close or renew them. contact_phone is chosen per post and only
--     handed to a member who taps Respond.
--   * business_post_responses: one per member per post, recorded when they
--     tap Respond (which then opens WhatsApp). The poster sees who responded;
--     10.8's dashboard counts them.
--   * business_post_saves: a member's saved posts.
--   * business_reports (0028) now also takes post reports: business_id
--     becomes nullable, post_id is added, and exactly one must be set. The
--     admin Reports tab shows both; admin_set_business_post_hidden hides a
--     post (audited). admin_list_business_reports returns the post columns,
--     and admin_list_audit_log labels the new targets.
--   * All three new tables are RPC-only (RLS on, no policies).
--
-- Run manually in the Supabase SQL editor. Re-runnable.

-- ================================================================
-- tables
-- ================================================================

create table if not exists business_posts (
  id uuid primary key default gen_random_uuid(),
  poster_person_id uuid not null references people(id) on delete cascade,
  business_id uuid references businesses(id) on delete set null,
  kind text not null check (kind in ('requirement', 'offer')),
  title text not null check (length(trim(title)) between 1 and 100),
  details text check (details is null or length(details) <= 1000),
  terms text check (terms is null or length(terms) <= 100),
  category text not null check (category in (
    'Retail', 'Wholesale & Distribution', 'Manufacturing', 'Jewellery',
    'Textiles & Garments', 'Real Estate & Construction', 'Finance & Accounting',
    'Legal', 'Healthcare', 'Education', 'IT & Software', 'Hospitality & Food',
    'Transport & Logistics', 'Agriculture', 'Other'
  )),
  city text,
  state text,
  contact_phone text not null check (contact_phone ~ '^\+91[6-9]\d{9}$'),
  status text not null default 'open' check (status in ('open', 'closed')),
  expires_at timestamptz not null default now() + interval '30 days',
  is_hidden boolean not null default false,
  hidden_reason text,
  hidden_by uuid references auth.users(id),
  hidden_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists business_posts_browse_idx on business_posts (kind, status, expires_at);
create index if not exists business_posts_poster_idx on business_posts (poster_person_id);
create index if not exists business_posts_category_idx on business_posts (category);

create table if not exists business_post_responses (
  post_id uuid not null references business_posts(id) on delete cascade,
  responder_person_id uuid not null references people(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, responder_person_id)
);

create table if not exists business_post_saves (
  person_id uuid not null references people(id) on delete cascade,
  post_id uuid not null references business_posts(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (person_id, post_id)
);

alter table business_posts enable row level security;
alter table business_post_responses enable row level security;
alter table business_post_saves enable row level security;

-- business_reports takes post reports too: exactly one target per report.
alter table business_reports alter column business_id drop not null;
alter table business_reports
  add column if not exists post_id uuid references business_posts(id) on delete cascade;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'business_reports_one_target_check') then
    alter table business_reports
      add constraint business_reports_one_target_check
      check ((business_id is null) <> (post_id is null));
  end if;
end;
$$;

create unique index if not exists business_reports_one_open_post_idx
  on business_reports (reporter_person_id, post_id) where status = 'open' and post_id is not null;

-- ================================================================
-- helpers
-- ================================================================

-- A post other members can see: open, not expired, not hidden, posted by an
-- approved member. Revoked from clients -- RPC bodies use it.
create or replace function business_post_live(p_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from business_posts bp
    join people p on p.id = bp.poster_person_id
    where bp.id = p_post_id
      and bp.status = 'open'
      and bp.expires_at > now()
      and not bp.is_hidden
      and p.member_status = 'approved'
  );
$$;

revoke all on function business_post_live(uuid) from public, anon, authenticated;

-- ================================================================
-- member RPCs
-- ================================================================

-- Browse (p_mine false): live posts of one kind, newest first. Mine: every
-- post of the caller's, whatever its state. Never returns contact_phone --
-- that only comes back from respond_to_business_post.
create or replace function list_business_posts(
  p_kind text default 'requirement',
  p_category text default null,
  p_city text default null,
  p_saved_only boolean default false,
  p_mine boolean default false,
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  id uuid,
  kind text,
  title text,
  details text,
  terms text,
  category text,
  city text,
  state text,
  created_at timestamptz,
  expires_at timestamptz,
  status text,
  poster_id uuid,
  poster_name text,
  poster_photo_url text,
  business_id uuid,
  business_name text,
  is_mine boolean,
  is_saved boolean,
  has_responded boolean,
  response_count bigint,
  hidden_reason text,
  total_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select id from people where auth_user_id = auth.uid()
  )
  select bp.id, bp.kind, bp.title, bp.details, bp.terms, bp.category, bp.city, bp.state,
         bp.created_at, bp.expires_at,
         case when bp.is_hidden then 'hidden'
              when bp.status = 'closed' then 'closed'
              when bp.expires_at <= now() then 'expired'
              else 'open' end,
         p.id, p.full_name, p.profile_photo_url,
         b.id, b.name,
         bp.poster_person_id = me.id,
         exists (select 1 from business_post_saves s
                 where s.person_id = me.id and s.post_id = bp.id),
         exists (select 1 from business_post_responses r
                 where r.responder_person_id = me.id and r.post_id = bp.id),
         case when bp.poster_person_id = me.id
              then (select count(*) from business_post_responses r where r.post_id = bp.id) end,
         case when bp.poster_person_id = me.id then bp.hidden_reason end,
         count(*) over ()
  from business_posts bp
  join people p on p.id = bp.poster_person_id
  join me on true
  -- The business name shows only while that listing is itself live.
  left join businesses b on b.id = bp.business_id
                        and b.review_status = 'approved' and not b.is_hidden
  where is_approved_member()
    and (case when coalesce(p_mine, false)
              then bp.poster_person_id = me.id
              else bp.kind = p_kind
                   and bp.status = 'open'
                   and bp.expires_at > now()
                   and not bp.is_hidden
                   and p.member_status = 'approved'
         end)
    and (p_category is null or bp.category = p_category)
    and (p_city is null or bp.city ilike p_city)
    and (not coalesce(p_saved_only, false)
         or exists (select 1 from business_post_saves s
                    where s.person_id = me.id and s.post_id = bp.id))
  order by bp.created_at desc, bp.id asc
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function list_business_posts(text, text, text, boolean, boolean, int, int) from public;
grant execute on function list_business_posts(text, text, text, boolean, boolean, int, int) to authenticated;

create or replace function create_business_post(
  p_kind text,
  p_title text,
  p_details text,
  p_terms text,
  p_category text,
  p_city text,
  p_state text,
  p_contact_phone text,
  p_business_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid;
  v_id uuid;
  v_title text := nullif(trim(p_title), '');
  v_details text := nullif(trim(p_details), '');
  v_terms text := nullif(trim(p_terms), '');
begin
  select id into v_me from people where auth_user_id = auth.uid() and member_status = 'approved';
  if v_me is null then
    raise exception 'Only approved members can post';
  end if;
  if p_kind is null or p_kind not in ('requirement', 'offer') then
    raise exception 'Say whether you''re looking for something or offering it';
  end if;
  if v_title is null then
    raise exception 'Please give your post a title';
  end if;
  if length(v_title) > 100 then
    raise exception 'Keep the title to 100 characters';
  end if;
  if v_details is not null and length(v_details) > 1000 then
    raise exception 'Keep the details to 1000 characters';
  end if;
  if v_terms is not null and length(v_terms) > 100 then
    raise exception 'Keep that line to 100 characters';
  end if;
  if p_category is null then
    raise exception 'Please pick an industry';
  end if;
  if p_contact_phone is null or p_contact_phone !~ '^\+91[6-9]\d{9}$' then
    raise exception 'Please enter a valid 10-digit contact number';
  end if;
  if p_business_id is not null and not exists (
    select 1 from businesses
    where id = p_business_id and owner_id = v_me
      and review_status = 'approved' and not is_hidden
  ) then
    raise exception 'You can only post as one of your approved listings';
  end if;

  insert into business_posts (poster_person_id, business_id, kind, title, details, terms,
                              category, city, state, contact_phone)
  values (v_me, p_business_id, p_kind, v_title, v_details, v_terms,
          p_category, nullif(trim(p_city), ''), nullif(trim(p_state), ''), p_contact_phone)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function create_business_post(text, text, text, text, text, text, text, text, uuid) from public;
grant execute on function create_business_post(text, text, text, text, text, text, text, text, uuid) to authenticated;

-- Close a post, or reopen it for another 30 days (renew). Poster only; not
-- while an admin has it hidden.
create or replace function set_business_post_open(p_post_id uuid, p_open boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post business_posts%rowtype;
begin
  select bp.* into v_post from business_posts bp
  join people p on p.id = bp.poster_person_id
  where bp.id = p_post_id and p.auth_user_id = auth.uid()
  for update;
  if not found then
    raise exception 'Post not found';
  end if;
  if v_post.is_hidden then
    raise exception 'An admin has hidden this post';
  end if;

  if coalesce(p_open, false) then
    update business_posts
    set status = 'open', expires_at = now() + interval '30 days', updated_at = now()
    where id = p_post_id;
  else
    update business_posts set status = 'closed', updated_at = now() where id = p_post_id;
  end if;
end;
$$;

revoke all on function set_business_post_open(uuid, boolean) from public;
grant execute on function set_business_post_open(uuid, boolean) to authenticated;

create or replace function delete_business_post(p_post_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from business_posts bp
  using people p
  where bp.id = p_post_id and p.id = bp.poster_person_id and p.auth_user_id = auth.uid();
  if not found then
    raise exception 'Post not found';
  end if;
end;
$$;

revoke all on function delete_business_post(uuid) from public;
grant execute on function delete_business_post(uuid) to authenticated;

-- Record that the caller responded, and hand back the number to WhatsApp.
create or replace function respond_to_business_post(p_post_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid;
  v_post business_posts%rowtype;
begin
  if not is_approved_member() then
    raise exception 'Not available';
  end if;
  select id into v_me from people where auth_user_id = auth.uid();
  select * into v_post from business_posts where id = p_post_id;
  if not found or not business_post_live(p_post_id) then
    raise exception 'This post is no longer open';
  end if;
  if v_post.poster_person_id = v_me then
    raise exception 'This is your own post';
  end if;

  insert into business_post_responses (post_id, responder_person_id)
  values (p_post_id, v_me)
  on conflict do nothing;
  return v_post.contact_phone;
end;
$$;

revoke all on function respond_to_business_post(uuid) from public;
grant execute on function respond_to_business_post(uuid) to authenticated;

-- Who responded to one of the caller's posts.
create or replace function list_business_post_responses(p_post_id uuid)
returns table (
  person_id uuid,
  full_name text,
  profile_photo_url text,
  member_code text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.full_name, p.profile_photo_url, p.member_code, r.created_at
  from business_post_responses r
  join business_posts bp on bp.id = r.post_id
  join people me on me.id = bp.poster_person_id
  join people p on p.id = r.responder_person_id
  where r.post_id = p_post_id
    and me.auth_user_id = auth.uid()
  order by r.created_at desc;
$$;

revoke all on function list_business_post_responses(uuid) from public;
grant execute on function list_business_post_responses(uuid) to authenticated;

create or replace function set_business_post_saved(p_post_id uuid, p_saved boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid;
begin
  select id into v_me from people where auth_user_id = auth.uid();
  if v_me is null then
    raise exception 'Not signed in';
  end if;

  if coalesce(p_saved, false) then
    if not is_approved_member() or not business_post_live(p_post_id) then
      raise exception 'This post is no longer open';
    end if;
    insert into business_post_saves (person_id, post_id)
    values (v_me, p_post_id)
    on conflict do nothing;
  else
    delete from business_post_saves where person_id = v_me and post_id = p_post_id;
  end if;
end;
$$;

revoke all on function set_business_post_saved(uuid, boolean) from public;
grant execute on function set_business_post_saved(uuid, boolean) to authenticated;

-- Report a live post that isn't the caller's. One open report per reporter
-- per post. Shares business_reports with listing reports.
create or replace function report_business_post(
  p_post_id uuid,
  p_reason text,
  p_details text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid;
  v_details text := nullif(trim(p_details), '');
begin
  select id into v_me from people where auth_user_id = auth.uid();
  if v_me is null or not is_approved_member() then
    raise exception 'Not signed in';
  end if;
  if not business_post_live(p_post_id) then
    raise exception 'This post is no longer open';
  end if;
  if exists (select 1 from business_posts where id = p_post_id and poster_person_id = v_me) then
    raise exception 'You can''t report your own post';
  end if;
  if p_reason is null or p_reason not in ('Fake or misleading', 'Wrong contact details',
                                          'Inappropriate content', 'Other') then
    raise exception 'Please pick a reason';
  end if;
  if v_details is not null and length(v_details) > 1000 then
    raise exception 'Keep the details to 1000 characters';
  end if;
  if p_reason = 'Other' and v_details is null then
    raise exception 'Please say what the problem is';
  end if;

  begin
    insert into business_reports (reporter_person_id, post_id, reason, details)
    values (v_me, p_post_id, p_reason, v_details);
  exception when unique_violation then
    raise exception 'You have already reported this post. The admins will look at it.';
  end;
end;
$$;

revoke all on function report_business_post(uuid, text, text) from public;
grant execute on function report_business_post(uuid, text, text) to authenticated;

-- ================================================================
-- admin
-- ================================================================

-- Listing and post reports in one list. For a post report the owner_*
-- columns carry the poster, and business_* are null (post_* are null for a
-- listing report). open_against counts open reports on the same target.
drop function if exists admin_list_business_reports(text, int, int);

create or replace function admin_list_business_reports(
  p_status text default 'open',
  p_limit int default 25,
  p_offset int default 0
)
returns table (
  id uuid,
  created_at timestamptz,
  reason text,
  details text,
  status text,
  resolution_note text,
  resolved_at timestamptz,
  resolved_by_name text,
  reporter_person_id uuid,
  reporter_name text,
  business_id uuid,
  business_name text,
  business_is_hidden boolean,
  post_id uuid,
  post_title text,
  post_kind text,
  post_is_hidden boolean,
  owner_id uuid,
  owner_name text,
  owner_member_code text,
  open_against bigint,
  total_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.created_at, r.reason, r.details, r.status, r.resolution_note, r.resolved_at,
         (select x.full_name from people x where x.auth_user_id = r.resolved_by),
         rp.id, rp.full_name,
         b.id, b.name, b.is_hidden,
         bp.id, bp.title, bp.kind, bp.is_hidden,
         op.id, op.full_name, op.member_code,
         (select count(*) from business_reports o
          where o.status = 'open'
            and (o.business_id = r.business_id or o.post_id = r.post_id)),
         count(*) over ()
  from business_reports r
  join people rp on rp.id = r.reporter_person_id
  left join businesses b on b.id = r.business_id
  left join business_posts bp on bp.id = r.post_id
  join people op on op.id = coalesce(b.owner_id, bp.poster_person_id)
  where is_admin()
    and (p_status is null or r.status = p_status)
  order by
    case when r.status = 'open' then r.created_at end asc nulls last,
    r.resolved_at desc nulls last,
    r.id asc
  limit least(greatest(coalesce(p_limit, 25), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function admin_list_business_reports(text, int, int) from public;
grant execute on function admin_list_business_reports(text, int, int) to authenticated;

-- Hide (reason required -- the poster sees it) or unhide a post. Any admin.
-- Audited as business_post_hidden / business_post_unhidden.
create or replace function admin_set_business_post_hidden(
  p_post_id uuid,
  p_hidden boolean,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_post business_posts%rowtype;
  v_admin_person_id uuid;
begin
  if not is_admin() then
    raise exception 'Not an admin';
  end if;
  if p_hidden is null then
    raise exception 'Say whether to hide or unhide the post';
  end if;

  select * into v_post from business_posts where id = p_post_id for update;
  if not found then
    raise exception 'Post not found';
  end if;
  if v_post.is_hidden = p_hidden then
    raise exception 'This post is already %', case when p_hidden then 'hidden' else 'visible' end;
  end if;

  if p_hidden then
    if p_reason is null or length(trim(p_reason)) = 0 then
      raise exception 'Please give a reason for hiding this post';
    end if;
    update business_posts
    set is_hidden = true, hidden_reason = trim(p_reason),
        hidden_by = auth.uid(), hidden_at = now(), updated_at = now()
    where id = p_post_id;
  else
    update business_posts
    set is_hidden = false, hidden_reason = null,
        hidden_by = null, hidden_at = null, updated_at = now()
    where id = p_post_id;
  end if;

  select id into v_admin_person_id from people where auth_user_id = auth.uid();
  insert into admin_audit_log (admin_id, action, target_type, target_id, notes)
  values (v_admin_person_id,
          case when p_hidden then 'business_post_hidden' else 'business_post_unhidden' end,
          'business_post', p_post_id, nullif(trim(p_reason), ''));
end;
$$;

revoke all on function admin_set_business_post_hidden(uuid, boolean, text) from public;
grant execute on function admin_set_business_post_hidden(uuid, boolean, text) to authenticated;

-- Audit log: label the 'business_post' target, and a 'business_report' on a
-- post by the post's title.
create or replace function admin_list_audit_log(
  p_target_id uuid default null,
  p_action_prefix text default null,
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  id uuid,
  created_at timestamptz,
  action text,
  target_type text,
  target_id uuid,
  target_label text,
  notes text,
  admin_person_id uuid,
  admin_name text,
  total_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.created_at, a.action, a.target_type, a.target_id,
         case a.target_type
           when 'person' then (select t.full_name from people t where t.id = a.target_id)
           when 'event' then (select t.title from events t where t.id = a.target_id)
           when 'business' then (select t.name from businesses t where t.id = a.target_id)
           when 'notice' then (select t.title from notices t where t.id = a.target_id)
           when 'matrimony_profile' then (select t.full_name from matrimony_profiles m
                                          join people t on t.id = m.person_id
                                          where m.id = a.target_id)
           when 'matrimony_report' then (select t.full_name from matrimony_reports r
                                         join people t on t.id = r.reported_person_id
                                         where r.id = a.target_id)
           when 'business_report' then (select coalesce(t.name, bp.title) from business_reports r
                                        left join businesses t on t.id = r.business_id
                                        left join business_posts bp on bp.id = r.post_id
                                        where r.id = a.target_id)
           when 'business_post' then (select t.title from business_posts t where t.id = a.target_id)
         end,
         a.notes, a.admin_id, ap.full_name,
         count(*) over ()
  from admin_audit_log a
  left join people ap on ap.id = a.admin_id
  where is_admin()
    and (p_target_id is null or a.target_id = p_target_id)
    -- An exact prefix compare, not LIKE: `_` is a LIKE wildcard, so
    -- 'member_%' would also match 'members_export'.
    and (p_action_prefix is null
         or left(a.action, length(p_action_prefix)) = p_action_prefix)
  order by a.created_at desc, a.id asc
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function admin_list_audit_log(uuid, text, int, int) from public;
grant execute on function admin_list_audit_log(uuid, text, int, int) to authenticated;

-- ================================================================
-- verification (run these after applying)
-- ================================================================
-- select relname, relrowsecurity from pg_class
-- where relname in ('business_posts', 'business_post_responses', 'business_post_saves');
--   -- 3 rows, all true
-- select conname from pg_constraint where conname = 'business_reports_one_target_check';
--   -- 1 row
-- select proname, count(*) from pg_proc
-- where proname in ('list_business_posts', 'create_business_post', 'set_business_post_open',
--                   'delete_business_post', 'respond_to_business_post',
--                   'list_business_post_responses', 'set_business_post_saved',
--                   'report_business_post', 'admin_list_business_reports',
--                   'admin_set_business_post_hidden', 'business_post_live')
-- group by proname;
--   -- 11 rows, each count 1
-- select has_function_privilege('authenticated', 'business_post_live(uuid)', 'execute');
--   -- false
--
-- Then, signed in as a member in the browser console:
--   await supabase.from('business_posts').select()          -- [] (no policies)
--   await supabase.rpc('list_business_posts', { p_kind: 'requirement' })
