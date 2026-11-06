-- Phase 10.5: listing approval + My businesses.
--
--   * businesses.review_status: pending -> approved | changes_requested |
--     rejected, with review_note (the owner sees it), reviewed_by/at and
--     submitted_at. Every existing listing is backfilled as approved; new
--     ones start pending. Member-facing reads (list_businesses, get_business
--     -- and so save / report / activity --, list_member_businesses,
--     business_filter_options) only see approved listings. The table's read
--     policy has been owner-only since 0029, so pending rows are private.
--   * businesses_protect_moderation_columns (0021/0027) also guards the
--     review columns, and moves the review along on an owner's edit:
--       - changes_requested: saving resubmits (back to pending);
--       - approved: a new name or industry sends it back to pending and
--         clears Verified -- effectively a different business;
--       - rejected: final, the owner can only delete it.
--   * admin_set_business_review (any admin, audited), shaped like
--     admin_set_matrimony_status. admin_list_businesses gains a
--     p_review_status filter (default 'approved', so the console's Visible /
--     Hidden lists keep showing live listings) and returns what the review
--     queue shows inline. admin_overview_stats + businesses_pending.
--
-- Run manually in the Supabase SQL editor. Re-runnable.

-- ================================================================
-- businesses: review columns
-- ================================================================

alter table businesses
  add column if not exists review_status text not null default 'approved',
  add column if not exists review_note text,
  add column if not exists reviewed_by uuid references auth.users(id),
  add column if not exists reviewed_at timestamptz,
  add column if not exists submitted_at timestamptz;

-- Existing rows were backfilled as approved by the default above; from here
-- on a new listing starts pending (the trigger enforces it for clients too).
alter table businesses alter column review_status set default 'pending';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'businesses_review_status_check') then
    alter table businesses
      add constraint businesses_review_status_check
      check (review_status in ('pending', 'approved', 'changes_requested', 'rejected'));
  end if;
end;
$$;

create index if not exists businesses_review_idx on businesses (review_status, submitted_at);

-- ================================================================
-- protection + review transitions on owner writes
-- ================================================================

create or replace function businesses_protect_moderation_columns()
returns trigger
language plpgsql
as $$
begin
  if current_user = 'authenticated' then
    if tg_op = 'INSERT' then
      new.is_hidden := false;
      new.hidden_reason := null;
      new.hidden_by := null;
      new.hidden_at := null;
      new.is_verified := false;
      new.verified_by := null;
      new.verified_at := null;
      new.review_status := 'pending';
      new.review_note := null;
      new.reviewed_by := null;
      new.reviewed_at := null;
      new.submitted_at := now();
    else
      if (new.is_hidden, new.hidden_reason, new.hidden_by, new.hidden_at)
         is distinct from
         (old.is_hidden, old.hidden_reason, old.hidden_by, old.hidden_at) then
        raise exception 'Only an admin can hide or unhide a listing';
      end if;
      if (new.is_verified, new.verified_by, new.verified_at)
         is distinct from
         (old.is_verified, old.verified_by, old.verified_at) then
        raise exception 'Only an admin can verify a listing';
      end if;
      if (new.review_status, new.review_note, new.reviewed_by, new.reviewed_at, new.submitted_at)
         is distinct from
         (old.review_status, old.review_note, old.reviewed_by, old.reviewed_at, old.submitted_at) then
        raise exception 'Only an admin can approve a listing';
      end if;

      -- (0030) What an owner's edit does to the review.
      if old.review_status = 'rejected' then
        raise exception 'This listing was turned down. You can remove it, or list your business again.';
      elsif old.review_status = 'changes_requested' then
        -- Saving is the resubmission. The note stays so the admin sees what
        -- they asked for.
        new.review_status := 'pending';
        new.submitted_at := now();
      elsif old.review_status = 'approved'
            and (new.name, new.category) is distinct from (old.name, old.category) then
        -- Effectively a different business: review it again, and drop any
        -- verification an admin gave the old one.
        new.review_status := 'pending';
        new.review_note := null;
        new.submitted_at := now();
        new.is_verified := false;
        new.verified_by := null;
        new.verified_at := null;
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- ================================================================
-- member-facing reads: approved listings only
-- ================================================================

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
         case when b.show_phone then b.contact_phone end as contact_phone,
         b.website, b.logo_url, b.is_verified,
         p.id as owner_id, p.full_name as owner_name, p.profile_photo_url as owner_photo_url,
         p.member_code as owner_member_code,
         count(*) over () as total_count
  from businesses b
  join people p on p.id = b.owner_id
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
         case when b.show_phone then b.contact_phone end, b.website, b.logo_url,
         b.brand_name, b.address_line1, b.address_line2, b.business_email,
         b.business_type,
         b.facebook_url, b.instagram_url, b.linkedin_url, b.youtube_url,
         b.products, b.is_verified,
         exists (select 1 from business_saves s
                 join people me on me.id = s.person_id
                 where me.auth_user_id = auth.uid() and s.business_id = b.id),
         p.id, p.full_name, p.profile_photo_url, p.member_code,
         b.owner_role
  from businesses b
  join people p on p.id = b.owner_id
  where b.id = p_business_id
    and is_approved_member()
    and p.member_status = 'approved'
    and not b.is_hidden
    and b.review_status = 'approved';
$$;

revoke all on function get_business(uuid) from public;
grant execute on function get_business(uuid) to authenticated;

create or replace function list_member_businesses(p_person_id uuid)
returns table (
  id uuid,
  name text,
  category text,
  city text,
  logo_url text
)
language sql
stable
security definer
set search_path = public
as $$
  select b.id, b.name, b.category, b.city, b.logo_url
  from businesses b
  join people p on p.id = b.owner_id
  where b.owner_id = p_person_id
    and is_approved_member()
    and p.member_status = 'approved'
    and not b.is_hidden
    and b.review_status = 'approved'
  order by b.name asc, b.id asc;
$$;

revoke all on function list_member_businesses(uuid) from public;
grant execute on function list_member_businesses(uuid) to authenticated;

create or replace function business_filter_options()
returns table (kind text, value text)
language sql
stable
security definer
set search_path = public
as $$
  select f.kind, f.value
  from (
    select 'category' as kind, b.category as value
    from businesses b join people p on p.id = b.owner_id
    where p.member_status = 'approved' and not b.is_hidden and b.review_status = 'approved' and b.category is not null
    union
    select 'city', b.city
    from businesses b join people p on p.id = b.owner_id
    where p.member_status = 'approved' and not b.is_hidden and b.review_status = 'approved' and b.city is not null
    union
    select 'state', b.state
    from businesses b join people p on p.id = b.owner_id
    where p.member_status = 'approved' and not b.is_hidden and b.review_status = 'approved' and b.state is not null
  ) f
  where is_approved_member()
  order by f.kind, f.value;
$$;

revoke all on function business_filter_options() from public;
grant execute on function business_filter_options() to authenticated;

-- ================================================================
-- admin: review queue
-- ================================================================

drop function if exists admin_list_businesses(boolean, text, text, int, int);
drop function if exists admin_list_businesses(boolean, text, text, int, int, text);

create or replace function admin_list_businesses(
  p_hidden boolean default null,
  p_search text default null,
  p_category text default null,
  p_limit int default 25,
  p_offset int default 0,
  p_review_status text default 'approved'
)
returns table (
  id uuid,
  name text,
  brand_name text,
  category text,
  city text,
  state text,
  logo_url text,
  description text,
  products text[],
  contact_phone text,
  is_hidden boolean,
  hidden_reason text,
  hidden_at timestamptz,
  is_verified boolean,
  verified_at timestamptz,
  review_status text,
  review_note text,
  submitted_at timestamptz,
  owner_id uuid,
  owner_name text,
  owner_member_code text,
  owner_status text,
  created_at timestamptz,
  total_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select b.id, b.name, b.brand_name, b.category, b.city, b.state, b.logo_url,
         b.description, b.products, b.contact_phone,
         b.is_hidden, b.hidden_reason, b.hidden_at,
         b.is_verified, b.verified_at,
         b.review_status, b.review_note, b.submitted_at,
         p.id, p.full_name, p.member_code, p.member_status,
         b.created_at,
         count(*) over ()
  from businesses b
  join people p on p.id = b.owner_id
  where is_admin()
    and (p_review_status is null or b.review_status = p_review_status)
    and (p_hidden is null or b.is_hidden = p_hidden)
    and (p_category is null or b.category = p_category)
    and (p_search is null or length(trim(p_search)) = 0
         or b.name ilike '%' || trim(p_search) || '%'
         or b.brand_name ilike '%' || trim(p_search) || '%'
         or p.full_name ilike '%' || trim(p_search) || '%')
  order by case when p_review_status = 'pending' then b.submitted_at end asc nulls last,
           case when p_hidden then b.hidden_at end desc nulls last,
           b.name asc, b.id asc
  limit least(greatest(coalesce(p_limit, 25), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function admin_list_businesses(boolean, text, text, int, int, text) from public;
grant execute on function admin_list_businesses(boolean, text, text, int, int, text) to authenticated;

-- Approve, ask for changes on, or turn down a pending listing. Any admin. A
-- note is required unless approving; the owner sees it. Audited as
-- business_approved / business_changes_requested / business_rejected.
create or replace function admin_set_business_review(
  p_business_id uuid,
  p_status text,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_business businesses%rowtype;
  v_note text := nullif(trim(p_note), '');
  v_admin_person_id uuid;
begin
  if not is_admin() then
    raise exception 'Not an admin';
  end if;
  if p_status is null or p_status not in ('approved', 'changes_requested', 'rejected') then
    raise exception 'Invalid status: %', p_status;
  end if;
  if p_status <> 'approved' and v_note is null then
    raise exception 'Please tell the owner why';
  end if;

  select * into v_business from businesses where id = p_business_id for update;
  if not found then
    raise exception 'Listing not found';
  end if;
  if v_business.review_status <> 'pending' then
    raise exception 'This listing is not awaiting review';
  end if;

  update businesses
  set review_status = p_status,
      review_note = case when p_status = 'approved' then null else v_note end,
      reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
  where id = p_business_id;

  select id into v_admin_person_id from people where auth_user_id = auth.uid();
  insert into admin_audit_log (admin_id, action, target_type, target_id, notes)
  values (v_admin_person_id, 'business_' || p_status, 'business', p_business_id, v_note);
end;
$$;

revoke all on function admin_set_business_review(uuid, text, text) from public;
grant execute on function admin_set_business_review(uuid, text, text) to authenticated;

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
    'businesses_pending', (select count(*) from businesses where review_status = 'pending'),
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

-- ================================================================
-- verification (run these after applying)
-- ================================================================
-- select review_status, count(*) from businesses group by review_status;
--   -- before anyone lists something new: only 'approved'
-- select conname from pg_constraint where conname = 'businesses_review_status_check';
--   -- 1 row
-- select proname, count(*) from pg_proc
-- where proname in ('admin_list_businesses', 'admin_set_business_review') group by proname;
--   -- 2 rows, each count 1
-- select admin_overview_stats() ? 'businesses_pending';
--   -- true (as an admin)
--
-- Then, signed in as a member who owns an approved listing, in the browser
-- console:
--   await supabase.from('businesses').update({ review_status: 'approved' }).eq('id', '<own id>')
--     -- error: Only an admin can approve a listing
