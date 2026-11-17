-- Phase 11.5: Business gating (see business-paid-features.md, phase-11-plan.md).
--
-- Everything here depends on has_service_access(me, 'business'), which is
-- true for everyone while the Business paywall is off -- so applying this
-- changes nothing until a super admin turns that paywall on.
--
-- Without Business access ("free"):
--   * list_businesses / get_business: contact_phone, website, business_email
--     and the four social links come back null -- unless the caller owns the
--     listing (or is an admin). The listing's own "show this number" still
--     wins for everyone. Name, category, place, description, products,
--     address, Verified and the owner card stay free.
--   * create_business_post, send_business_enquiry: refused (SQLSTATE KCL03).
--   * respond_to_business_post (it returns the poster's phone): refused
--     (KCL03) -- unless the caller already responded to that post, so a
--     member whose access lapses keeps the contacts they already had.
--   * list_business_enquiries (owner's dashboard): returns no rows. The
--     dashboard's counts (business_dashboard) stay free, so an owner sees
--     "3 people enquired" and upgrades to read them.
-- Free for everyone, untouched: listing your own business, saves, reports,
-- reading Buy & Sell posts, and referrals (giving and receiving).
--
-- Bodies are the current ones (ddl/core_schema.sql) with only the marked
-- changes; return types are unchanged, so create or replace. All six are
-- closed to anon.
--
-- ORDER OF DEPLOY: 0036 applied. Apply this, then the frontend (which sets
-- PAYWALL_READY.business so the admin page offers Turn on).
--
-- Re-runnable.

begin;

-- ---------------------------------------------------------------- list_businesses

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
         case when b.show_phone and (b.owner_id = me.id or is_admin() or has_service_access(me.id, 'business')) then b.contact_phone end as contact_phone,
         case when (b.owner_id = me.id or is_admin() or has_service_access(me.id, 'business')) then b.website end, b.logo_url, b.is_verified,
         p.id as owner_id, p.full_name as owner_name, p.profile_photo_url as owner_photo_url,
         p.member_code as owner_member_code,
         count(*) over () as total_count
  from businesses b
  join people p on p.id = b.owner_id
  cross join lateral (select (select x.id from people x where x.auth_user_id = auth.uid()) as id) me
  where is_approved_member()
    and p.member_status = 'approved'
    and not b.is_hidden
    and b.review_status = 'approved'
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
revoke execute on function list_businesses(text, text, text, text, int, int, boolean) from anon;

-- ---------------------------------------------------------------- get_business

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
  owner_member_code text,
  owner_role text
)
language sql
stable
security definer
set search_path = public
as $$
  select b.id, b.name, b.category, b.description, b.city, b.state,
         case when b.show_phone and (b.owner_id = me.id or is_admin() or has_service_access(me.id, 'business')) then b.contact_phone end,
         case when (b.owner_id = me.id or is_admin() or has_service_access(me.id, 'business')) then b.website end, b.logo_url,
         b.brand_name, b.address_line1, b.address_line2,
         case when (b.owner_id = me.id or is_admin() or has_service_access(me.id, 'business')) then b.business_email end,
         b.business_type,
         case when (b.owner_id = me.id or is_admin() or has_service_access(me.id, 'business')) then b.facebook_url end,
         case when (b.owner_id = me.id or is_admin() or has_service_access(me.id, 'business')) then b.instagram_url end,
         case when (b.owner_id = me.id or is_admin() or has_service_access(me.id, 'business')) then b.linkedin_url end,
         case when (b.owner_id = me.id or is_admin() or has_service_access(me.id, 'business')) then b.youtube_url end,
         b.products, b.is_verified,
         exists (select 1 from business_saves s
                 join people me on me.id = s.person_id
                 where me.auth_user_id = auth.uid() and s.business_id = b.id),
         p.id, p.full_name, p.profile_photo_url, p.member_code,
         b.owner_role
  from businesses b
  join people p on p.id = b.owner_id
  cross join lateral (select (select x.id from people x where x.auth_user_id = auth.uid()) as id) me
  where b.id = p_business_id
    and is_approved_member()
    and p.member_status = 'approved'
    and not b.is_hidden
    and b.review_status = 'approved';
$$;

revoke all on function get_business(uuid) from public;
grant execute on function get_business(uuid) to authenticated;
revoke execute on function get_business(uuid) from anon;

-- ---------------------------------------------------------------- respond_to_business_post

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
  -- (0037) Business access, unless they already responded (a lapsed member
  -- keeps what they had).
  if not has_service_access(v_me, 'business')
     and not exists (select 1 from business_post_responses r
                     where r.post_id = p_post_id and r.responder_person_id = v_me) then
    raise exception using errcode = 'KCL03',
      message = 'Responding to posts is part of Business access.';
  end if;

  insert into business_post_responses (post_id, responder_person_id)
  values (p_post_id, v_me)
  on conflict do nothing;
  return v_post.contact_phone;
end;
$$;

revoke all on function respond_to_business_post(uuid) from public;
grant execute on function respond_to_business_post(uuid) to authenticated;
revoke execute on function respond_to_business_post(uuid) from anon;

-- ---------------------------------------------------------------- create_business_post

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
  -- (0037)
  if not has_service_access(v_me, 'business') then
    raise exception using errcode = 'KCL03',
      message = 'Posting in Buy & Sell is part of Business access.';
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
revoke execute on function create_business_post(text, text, text, text, text, text, text, text, uuid) from anon;

-- ---------------------------------------------------------------- send_business_enquiry

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
  -- (0037)
  if not has_service_access(v_me, 'business') then
    raise exception using errcode = 'KCL03',
      message = 'Sending enquiries is part of Business access.';
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
revoke execute on function send_business_enquiry(uuid, text, text) from anon;

-- ---------------------------------------------------------------- list_business_enquiries

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
    -- (0037) Reading enquiries is part of Business access; the dashboard's
    -- counts stay free.
    and has_service_access(me.id, 'business')
    and (p_status is null or e.status = p_status)
  order by e.created_at desc, e.id asc
  limit least(greatest(coalesce(p_limit, 10), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function list_business_enquiries(uuid, text, int, int) from public;
grant execute on function list_business_enquiries(uuid, text, int, int) to authenticated;
revoke execute on function list_business_enquiries(uuid, text, int, int) from anon;

commit;

-- ================================================================
-- verification (run these after applying)
-- ================================================================
-- select proname, has_function_privilege('anon', oid, 'execute') as anon,
--        pg_get_functiondef(oid) like '%has_service_access(%business%' as gated
-- from pg_proc where proname in ('list_businesses', 'get_business', 'respond_to_business_post',
--                                'create_business_post', 'send_business_enquiry',
--                                'list_business_enquiries');
--   -- 6 rows, anon false, gated true
--
-- With the Business paywall OFF nothing changes. With it ON, as a member
-- without a Business grant: listings show no phone / website / email /
-- socials (except their own); posting, responding and enquiring raise KCL03;
-- their dashboard lists no enquiries but still counts them.
