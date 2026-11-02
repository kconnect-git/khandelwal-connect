-- Phase 10.3: business detail -- products, save, report, activity tracking.
--
--   * businesses.products text[] (<= 20 items, 1-60 chars each) replaces the
--     single free-text primary_product as what the listing shows. Existing
--     primary_product values are copied in. primary_product stays on the
--     table, unedited and unread, until a later cleanup drops it.
--   * business_saves: a member's saved listings (Save on the detail page,
--     "Saved" chip on the directory). RPC-only.
--   * business_reports: members report a listing to the admins, shaped like
--     matrimony_reports (0025). One open report per reporter per listing.
--     Admins get a Reports tab (list + resolve, audited) and an Overview
--     count; hiding reuses admin_set_business_hidden. RPC-only.
--   * business_activity: views and Call / WhatsApp taps, at most once per
--     viewer per kind per IST day, never counting the owner. Written now so
--     the 10.8 dashboard has data. RPC-only; logging never raises.
--   * get_business: - primary_product, + products, is_verified, is_saved.
--     list_businesses: + p_saved_only, and search also matches products.
--     Both change shape -> drop + recreate.
--   * admin_overview_stats + business_reports_open; admin_list_audit_log
--     labels the 'business_report' target.
--
-- Run manually in the Supabase SQL editor. Re-runnable.

-- ================================================================
-- products
-- ================================================================

create or replace function business_products_valid(p_products text[])
returns boolean
language sql
immutable
as $$
  select coalesce(cardinality(p_products), 0) <= 20
     and not exists (select 1 from unnest(p_products) x
                     where x is null or length(trim(x)) = 0 or length(trim(x)) > 60);
$$;

alter table businesses
  add column if not exists products text[] not null default '{}';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'businesses_products_check') then
    alter table businesses
      add constraint businesses_products_check check (business_products_valid(products));
  end if;
end;
$$;

update businesses
set products = array[left(trim(primary_product), 60)]
where products = '{}'
  and nullif(trim(primary_product), '') is not null;

-- ================================================================
-- tables: saves, reports, activity (all RPC-only)
-- ================================================================

create table if not exists business_saves (
  person_id uuid not null references people(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (person_id, business_id)
);

create table if not exists business_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_person_id uuid not null references people(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  reason text not null check (reason in ('Fake or misleading', 'Wrong contact details',
                                          'Inappropriate content', 'Not a member''s business',
                                          'Other')),
  details text check (details is null or length(details) <= 1000),
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolution_note text,
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists business_reports_one_open_idx
  on business_reports (reporter_person_id, business_id) where status = 'open';
create index if not exists business_reports_status_idx on business_reports (status, created_at);

create table if not exists business_activity (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  viewer_person_id uuid not null references people(id) on delete cascade,
  kind text not null check (kind in ('view', 'call', 'whatsapp')),
  day date not null,
  created_at timestamptz not null default now()
);

create unique index if not exists business_activity_once_a_day_idx
  on business_activity (business_id, viewer_person_id, kind, day);
create index if not exists business_activity_business_day_idx
  on business_activity (business_id, day);

alter table business_saves enable row level security;
alter table business_reports enable row level security;
alter table business_activity enable row level security;

-- ================================================================
-- get_business: - primary_product, + products, is_verified, is_saved
-- ================================================================

drop function if exists get_business(uuid);

create or replace function get_business(p_business_id uuid)
returns table (
  id uuid,
  name text,
  category text,
  description text,
  city text,
  state text,
  contact_phone text,
  website text,
  logo_url text,
  brand_name text,
  address_line1 text,
  address_line2 text,
  business_email text,
  business_type text,
  facebook_url text,
  instagram_url text,
  linkedin_url text,
  youtube_url text,
  products text[],
  is_verified boolean,
  is_saved boolean,
  owner_id uuid,
  owner_name text,
  owner_photo_url text,
  owner_member_code text
)
language sql
stable
security definer
set search_path = public
as $$
  select b.id, b.name, b.category, b.description, b.city, b.state,
         b.contact_phone, b.website, b.logo_url,
         b.brand_name, b.address_line1, b.address_line2, b.business_email,
         b.business_type,
         b.facebook_url, b.instagram_url, b.linkedin_url, b.youtube_url,
         b.products, b.is_verified,
         exists (select 1 from business_saves s
                 join people me on me.id = s.person_id
                 where me.auth_user_id = auth.uid() and s.business_id = b.id),
         p.id, p.full_name, p.profile_photo_url, p.member_code
  from businesses b
  join people p on p.id = b.owner_id
  where b.id = p_business_id
    and is_approved_member()
    and p.member_status = 'approved'
    and not b.is_hidden;
$$;

revoke all on function get_business(uuid) from public;
grant execute on function get_business(uuid) to authenticated;

-- ================================================================
-- list_businesses: + p_saved_only, search also matches products
-- ================================================================

drop function if exists list_businesses(text, text, text, text, int, int);
drop function if exists list_businesses(text, text, text, text, int, int, boolean);

create or replace function list_businesses(
  p_search text default null,
  p_category text default null,
  p_city text default null,
  p_state text default null,
  p_limit int default 20,
  p_offset int default 0,
  p_saved_only boolean default false
)
returns table (
  id uuid,
  name text,
  category text,
  description text,
  city text,
  state text,
  contact_phone text,
  website text,
  logo_url text,
  is_verified boolean,
  owner_id uuid,
  owner_name text,
  owner_photo_url text,
  owner_member_code text,
  total_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select b.id, b.name, b.category, b.description, b.city, b.state,
         b.contact_phone, b.website, b.logo_url, b.is_verified,
         p.id as owner_id, p.full_name as owner_name, p.profile_photo_url as owner_photo_url,
         p.member_code as owner_member_code,
         count(*) over () as total_count
  from businesses b
  join people p on p.id = b.owner_id
  where is_approved_member()
    and p.member_status = 'approved'
    and not b.is_hidden
    and (p_search is null or length(trim(p_search)) = 0
         or b.name ilike '%' || p_search || '%'
         or p.full_name ilike '%' || p_search || '%'
         or b.category ilike '%' || p_search || '%'
         or b.city ilike '%' || p_search || '%'
         or b.state ilike '%' || p_search || '%'
         or b.brand_name ilike '%' || p_search || '%'
         or array_to_string(b.products, ' ') ilike '%' || p_search || '%'
         or b.description ilike '%' || p_search || '%')
    and (p_category is null or b.category = p_category)
    and (p_city is null or b.city ilike p_city)
    and (p_state is null or b.state ilike p_state)
    and (not coalesce(p_saved_only, false)
         or exists (select 1 from business_saves s
                    join people me on me.id = s.person_id
                    where me.auth_user_id = auth.uid() and s.business_id = b.id))
  order by b.name asc, b.id asc
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function list_businesses(text, text, text, text, int, int, boolean) from public;
grant execute on function list_businesses(text, text, text, text, int, int, boolean) to authenticated;

-- ================================================================
-- member RPCs: save, report, log activity
-- ================================================================

-- Save or unsave a listing the caller can see. Idempotent.
create or replace function set_business_saved(p_business_id uuid, p_saved boolean)
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
    if not exists (select 1 from get_business(p_business_id)) then
      raise exception 'Listing not found';
    end if;
    insert into business_saves (person_id, business_id)
    values (v_me, p_business_id)
    on conflict do nothing;
  else
    delete from business_saves where person_id = v_me and business_id = p_business_id;
  end if;
end;
$$;

revoke all on function set_business_saved(uuid, boolean) from public;
grant execute on function set_business_saved(uuid, boolean) to authenticated;

-- Report a listing the caller can see and doesn't own. One open report per
-- reporter per listing.
create or replace function report_business(
  p_business_id uuid,
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
  if v_me is null then
    raise exception 'Not signed in';
  end if;
  if not exists (select 1 from get_business(p_business_id)) then
    raise exception 'Listing not found';
  end if;
  if exists (select 1 from businesses where id = p_business_id and owner_id = v_me) then
    raise exception 'You can''t report your own listing';
  end if;
  if p_reason is null or p_reason not in ('Fake or misleading', 'Wrong contact details',
                                          'Inappropriate content', 'Not a member''s business',
                                          'Other') then
    raise exception 'Please pick a reason';
  end if;
  if v_details is not null and length(v_details) > 1000 then
    raise exception 'Keep the details to 1000 characters';
  end if;
  if p_reason = 'Other' and v_details is null then
    raise exception 'Please say what the problem is';
  end if;

  begin
    insert into business_reports (reporter_person_id, business_id, reason, details)
    values (v_me, p_business_id, p_reason, v_details);
  exception when unique_violation then
    raise exception 'You have already reported this listing. The admins will look at it.';
  end;
end;
$$;

revoke all on function report_business(uuid, text, text) from public;
grant execute on function report_business(uuid, text, text) to authenticated;

-- Record a view / Call tap / WhatsApp tap. Quietly does nothing for the
-- owner, an invisible listing or a repeat on the same IST day, so the page
-- never fails because of tracking.
create or replace function log_business_activity(p_business_id uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid;
begin
  if p_kind is null or p_kind not in ('view', 'call', 'whatsapp') then
    return;
  end if;
  select id into v_me from people where auth_user_id = auth.uid();
  if v_me is null then
    return;
  end if;
  if not exists (select 1 from get_business(p_business_id) g where g.owner_id <> v_me) then
    return;
  end if;

  insert into business_activity (business_id, viewer_person_id, kind, day)
  values (p_business_id, v_me, p_kind, (now() at time zone 'Asia/Kolkata')::date)
  on conflict do nothing;
end;
$$;

revoke all on function log_business_activity(uuid, text) from public;
grant execute on function log_business_activity(uuid, text) to authenticated;

-- ================================================================
-- admin: reports
-- ================================================================

-- Reports for the console, oldest open first / newest resolved first.
-- open_against = open reports on the same listing (repeat complaints).
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
         op.id, op.full_name, op.member_code,
         (select count(*) from business_reports o
          where o.business_id = r.business_id and o.status = 'open'),
         count(*) over ()
  from business_reports r
  join people rp on rp.id = r.reporter_person_id
  join businesses b on b.id = r.business_id
  join people op on op.id = b.owner_id
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

-- Close a report, optionally with a note (admins only see it). Audited.
create or replace function admin_resolve_business_report(p_report_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_note text := nullif(trim(p_note), '');
  v_admin_person_id uuid;
begin
  if not is_admin() then
    raise exception 'Not an admin';
  end if;
  update business_reports
  set status = 'resolved', resolution_note = v_note, resolved_by = auth.uid(), resolved_at = now()
  where id = p_report_id and status = 'open';
  if not found then
    raise exception 'This report is already resolved';
  end if;

  select id into v_admin_person_id from people where auth_user_id = auth.uid();
  insert into admin_audit_log (admin_id, action, target_type, target_id, notes)
  values (v_admin_person_id, 'business_report_resolved', 'business_report', p_report_id, v_note);
end;
$$;

revoke all on function admin_resolve_business_report(uuid, text) from public;
grant execute on function admin_resolve_business_report(uuid, text) to authenticated;

-- ================================================================
-- admin_overview_stats + business_reports_open;
-- admin_list_audit_log labels 'business_report'
-- ================================================================

create or replace function admin_overview_stats()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'members_by_status', coalesce(
      (select jsonb_object_agg(s.member_status, s.n)
       from (select member_status, count(*) as n from people group by member_status) s),
      '{}'::jsonb),
    'signups_7d', (select count(*) from people where created_at >= now() - interval '7 days'),
    'signups_30d', (select count(*) from people where created_at >= now() - interval '30 days'),
    'events_pending', (select count(*) from events where status = 'pending'),
    'events_upcoming', (select count(*) from events where status = 'approved' and starts_at >= now()),
    'businesses', (select count(*) from businesses),
    'businesses_hidden', (select count(*) from businesses where is_hidden),
    'notices_active', (select count(*) from notices
                       where status = 'published' and (expires_at is null or expires_at > now())),
    'matrimony_pending', (select count(*) from matrimony_profiles where status = 'pending'),
    'matrimony_approved', (select count(*) from matrimony_profiles where status = 'approved'),
    'matrimony_reports_open', (select count(*) from matrimony_reports where status = 'open'),
    'business_reports_open', (select count(*) from business_reports where status = 'open')
  )
  where is_admin();
$$;

revoke all on function admin_overview_stats() from public;
grant execute on function admin_overview_stats() to authenticated;

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
           when 'business_report' then (select t.name from business_reports r
                                        join businesses t on t.id = r.business_id
                                        where r.id = a.target_id)
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
-- where relname in ('business_saves', 'business_reports', 'business_activity');
--   -- 3 rows, all true
-- select proname, pg_get_function_arguments(oid) from pg_proc
-- where proname in ('get_business', 'list_businesses', 'set_business_saved', 'report_business',
--                   'log_business_activity', 'admin_list_business_reports',
--                   'admin_resolve_business_report');
--   -- 7 rows; list_businesses ends in p_saved_only boolean
-- select count(*) from businesses
-- where nullif(trim(primary_product), '') is not null and products = '{}';
--   -- 0 (every old primary_product was copied into products)
-- select admin_overview_stats() ? 'business_reports_open';
--   -- true (as an admin)
--
-- Then, signed in as a member in the browser console:
--   await supabase.from('business_reports').select()    -- [] (no policies)
--   await supabase.rpc('log_business_activity', { p_business_id: '<someone else''s listing>', p_kind: 'view' })
--   -- run it twice; as admin in SQL: one 'view' row for that viewer today
