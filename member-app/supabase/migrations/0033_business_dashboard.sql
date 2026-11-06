-- Phase 10.8: My Business Dashboard, and the enquiries it lists.
--
--   * business_enquiries: a member asks a listing about one of its products
--     (or in general) with a short message. At most one open enquiry per
--     member per listing. The owner sees them on the dashboard, replies on
--     WhatsApp (or via the member's profile when their number is hidden)
--     and marks them done.
--   * business_dashboard(): the owner's numbers for one listing -- this
--     calendar month (India time) of views / calls / WhatsApp taps (10.3's
--     business_activity) and enquiries, open enquiries, referrals waiting or
--     in talks (10.7), Buy & Sell responses to posts made as the listing
--     (10.6), and live requirements in the listing's industry.
--   * RPC-only (RLS on, no policies).
--
-- Run manually in the Supabase SQL editor. Re-runnable.

-- ================================================================
-- table
-- ================================================================

create table if not exists business_enquiries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  from_person_id uuid not null references people(id) on delete cascade,
  about text check (about is null or length(about) <= 60),
  message text not null check (length(trim(message)) between 1 and 500),
  status text not null default 'new' check (status in ('new', 'done')),
  done_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists business_enquiries_business_idx
  on business_enquiries (business_id, created_at desc);
create unique index if not exists business_enquiries_one_open_idx
  on business_enquiries (business_id, from_person_id) where status = 'new';

alter table business_enquiries enable row level security;

-- ================================================================
-- member RPCs
-- ================================================================

-- Ask a listing the caller can see (and doesn't own) about one of its
-- products, or in general (p_about null).
create or replace function send_business_enquiry(
  p_business_id uuid,
  p_about text,
  p_message text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid;
  v_owner uuid;
  v_products text[];
  v_id uuid;
  v_about text := nullif(trim(p_about), '');
  v_message text := nullif(trim(p_message), '');
begin
  select id into v_me from people where auth_user_id = auth.uid() and member_status = 'approved';
  if v_me is null then
    raise exception 'Only approved members can send enquiries';
  end if;
  select g.owner_id, g.products into v_owner, v_products from get_business(p_business_id) g;
  if v_owner is null then
    raise exception 'Business not found';
  end if;
  if v_owner = v_me then
    raise exception 'This is your own business';
  end if;
  if v_about is not null and not (v_about = any (v_products)) then
    raise exception 'Pick one of this business''s products, or General';
  end if;
  if v_message is null then
    raise exception 'Please write a message';
  end if;
  if length(v_message) > 500 then
    raise exception 'Keep the message to 500 characters';
  end if;

  begin
    insert into business_enquiries (business_id, from_person_id, about, message)
    values (p_business_id, v_me, v_about, v_message)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'You already have an enquiry waiting with this business';
  end;
  return v_id;
end;
$$;

revoke all on function send_business_enquiry(uuid, text, text) from public;
grant execute on function send_business_enquiry(uuid, text, text) to authenticated;

-- An owner's enquiries for one listing, newest first. from_phone is null
-- when the member hides their number.
create or replace function list_business_enquiries(
  p_business_id uuid,
  p_status text default 'new',
  p_limit int default 10,
  p_offset int default 0
)
returns table (
  id uuid,
  about text,
  message text,
  status text,
  created_at timestamptz,
  done_at timestamptz,
  from_person_id uuid,
  from_name text,
  from_photo_url text,
  from_member_code text,
  from_phone text,
  total_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select e.id, e.about, e.message, e.status, e.created_at, e.done_at,
         p.id, p.full_name, p.profile_photo_url, p.member_code,
         case when p.hide_mobile then null else p.mobile_number end,
         count(*) over ()
  from business_enquiries e
  join businesses b on b.id = e.business_id
  join people me on me.id = b.owner_id
  join people p on p.id = e.from_person_id
  where e.business_id = p_business_id
    and me.auth_user_id = auth.uid()
    and (p_status is null or e.status = p_status)
  order by e.created_at desc, e.id asc
  limit least(greatest(coalesce(p_limit, 10), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function list_business_enquiries(uuid, text, int, int) from public;
grant execute on function list_business_enquiries(uuid, text, int, int) to authenticated;

-- Mark an enquiry to one of the caller's listings handled, or back to new.
create or replace function set_business_enquiry_done(p_enquiry_id uuid, p_done boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update business_enquiries e
  set status = case when coalesce(p_done, false) then 'done' else 'new' end,
      done_at = case when coalesce(p_done, false) then now() end
  from businesses b, people me
  where e.id = p_enquiry_id and b.id = e.business_id and me.id = b.owner_id
    and me.auth_user_id = auth.uid();
  if not found then
    raise exception 'Enquiry not found';
  end if;
exception when unique_violation then
  -- Reopening while the same member has sent a newer one.
  raise exception 'This member has a newer open enquiry already';
end;
$$;

revoke all on function set_business_enquiry_done(uuid, boolean) from public;
grant execute on function set_business_enquiry_done(uuid, boolean) to authenticated;

-- The owner's dashboard numbers for one listing.
create or replace function business_dashboard(p_business_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_business businesses%rowtype;
  v_month_start date := date_trunc('month', now() at time zone 'Asia/Kolkata')::date;
  v_month_start_ts timestamptz := (date_trunc('month', now() at time zone 'Asia/Kolkata'))
                                  at time zone 'Asia/Kolkata';
begin
  select b.* into v_business from businesses b
  join people me on me.id = b.owner_id
  where b.id = p_business_id and me.auth_user_id = auth.uid();
  if not found then
    raise exception 'Listing not found';
  end if;

  return jsonb_build_object(
    'month_start', v_month_start,
    'views', (select count(*) from business_activity
              where business_id = p_business_id and kind = 'view' and day >= v_month_start),
    'calls', (select count(*) from business_activity
              where business_id = p_business_id and kind = 'call' and day >= v_month_start),
    'whatsapp', (select count(*) from business_activity
                 where business_id = p_business_id and kind = 'whatsapp' and day >= v_month_start),
    'enquiries', (select count(*) from business_enquiries
                  where business_id = p_business_id and created_at >= v_month_start_ts),
    'enquiries_new', (select count(*) from business_enquiries
                      where business_id = p_business_id and status = 'new'),
    'referrals_new', (select count(*) from business_referrals
                      where business_id = p_business_id and status = 'new'),
    'referrals_in_talks', (select count(*) from business_referrals
                           where business_id = p_business_id and status = 'in_talks'),
    'post_responses', (select count(*) from business_post_responses r
                       join business_posts bp on bp.id = r.post_id
                       where bp.business_id = p_business_id
                         and r.created_at >= v_month_start_ts),
    'matching_requirements', (select count(*) from business_posts bp
                              join people p on p.id = bp.poster_person_id
                              where bp.kind = 'requirement'
                                and bp.category = v_business.category
                                and bp.status = 'open'
                                and bp.expires_at > now()
                                and not bp.is_hidden
                                and p.member_status = 'approved'
                                and bp.poster_person_id <> v_business.owner_id)
  );
end;
$$;

revoke all on function business_dashboard(uuid) from public;
grant execute on function business_dashboard(uuid) to authenticated;

-- ================================================================
-- verification (run these after applying)
-- ================================================================
-- select relname, relrowsecurity from pg_class where relname = 'business_enquiries';
--   -- 1 row, true
-- select proname, count(*) from pg_proc
-- where proname in ('send_business_enquiry', 'list_business_enquiries',
--                   'set_business_enquiry_done', 'business_dashboard')
-- group by proname;
--   -- 4 rows, each count 1
--
-- Then, signed in as a member in the browser console:
--   await supabase.from('business_enquiries').select()                 -- [] (no policies)
--   await supabase.rpc('business_dashboard', { p_business_id: '<someone else''s listing>' })
--     -- error: Listing not found
--   await supabase.rpc('business_dashboard', { p_business_id: '<your listing>' })
--     -- { month_start, views, calls, whatsapp, enquiries, ... }
