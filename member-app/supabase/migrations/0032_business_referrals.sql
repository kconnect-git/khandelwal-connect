-- Phase 10.7: Referrals -- give, receive and track.
--
--   * business_referrals: a member passes a lead (someone who needs
--     something -- a member or not) to another member's business. The
--     owner accepts (-> in_talks) or declines; an accepted referral is
--     closed as won ("business done") or lost. The referrer follows every
--     step, and can withdraw one that's still new.
--   * The lead's phone belongs to a third party: giving one needs an
--     explicit consent flag, only the referrer and the business owner ever
--     see it, and it's cleared once the referral is declined or closed.
--   * RPC-only (RLS on, no policies). No admin surface -- referrals are
--     private between the two members.
--
-- Run manually in the Supabase SQL editor. Re-runnable.

-- ================================================================
-- table
-- ================================================================

create table if not exists business_referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_person_id uuid not null references people(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  lead_name text not null check (length(trim(lead_name)) between 1 and 100),
  lead_phone text check (lead_phone is null or lead_phone ~ '^\+91[6-9]\d{9}$'),
  lead_person_id uuid references people(id) on delete set null,
  note text not null check (length(trim(note)) between 1 and 500),
  status text not null default 'new' check (status in ('new', 'in_talks', 'declined', 'closed')),
  outcome text check (outcome is null or outcome in ('won', 'lost')),
  decline_reason text check (decline_reason is null or length(decline_reason) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  responded_at timestamptz,
  closed_at timestamptz,
  check ((status = 'closed') = (outcome is not null))
);

create index if not exists business_referrals_business_idx on business_referrals (business_id, status);
create index if not exists business_referrals_referrer_idx on business_referrals (referrer_person_id);

alter table business_referrals enable row level security;

-- ================================================================
-- member RPCs
-- ================================================================

-- Refer a lead to a business the caller can see and doesn't own. The lead
-- is typed in (name + phone) or picked from the members; p_consent is the
-- "I have their permission to share this number" box.
create or replace function give_business_referral(
  p_business_id uuid,
  p_lead_name text,
  p_lead_phone text,
  p_lead_person_id uuid,
  p_note text,
  p_consent boolean
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid;
  v_owner uuid;
  v_id uuid;
  v_name text := nullif(trim(p_lead_name), '');
  v_phone text := nullif(trim(p_lead_phone), '');
  v_note text := nullif(trim(p_note), '');
begin
  select id into v_me from people where auth_user_id = auth.uid() and member_status = 'approved';
  if v_me is null then
    raise exception 'Only approved members can give referrals';
  end if;
  if not coalesce(p_consent, false) then
    raise exception 'Please confirm you have their permission to share their details';
  end if;
  select g.owner_id into v_owner from get_business(p_business_id) g;
  if v_owner is null then
    raise exception 'Business not found';
  end if;
  if v_owner = v_me then
    raise exception 'You can''t refer someone to your own business';
  end if;
  if v_name is null then
    raise exception 'Please enter the person''s name';
  end if;
  if length(v_name) > 100 then
    raise exception 'Keep the name to 100 characters';
  end if;
  if v_phone is not null and v_phone !~ '^\+91[6-9]\d{9}$' then
    raise exception 'Please enter a valid 10-digit phone number';
  end if;
  if p_lead_person_id is not null then
    if not exists (select 1 from people where id = p_lead_person_id and member_status = 'approved') then
      raise exception 'That member wasn''t found';
    end if;
    if p_lead_person_id = v_owner then
      raise exception 'That member owns this business';
    end if;
  elsif v_phone is null then
    raise exception 'Please enter their phone number';
  end if;
  if v_note is null then
    raise exception 'Please say what the referral is for';
  end if;
  if length(v_note) > 500 then
    raise exception 'Keep the note to 500 characters';
  end if;

  insert into business_referrals (referrer_person_id, business_id, lead_name, lead_phone,
                                  lead_person_id, note)
  values (v_me, p_business_id, v_name, v_phone, p_lead_person_id, v_note)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function give_business_referral(uuid, text, text, uuid, text, boolean) from public;
grant execute on function give_business_referral(uuid, text, text, uuid, text, boolean) to authenticated;

-- Received (to any of the caller's businesses) or given (by the caller).
-- The lead's phone only while the referral is still open.
create or replace function list_business_referrals(
  p_direction text default 'received',
  p_limit int default 20,
  p_offset int default 0
)
returns table (
  id uuid,
  status text,
  outcome text,
  decline_reason text,
  note text,
  created_at timestamptz,
  responded_at timestamptz,
  closed_at timestamptz,
  lead_name text,
  lead_phone text,
  lead_person_id uuid,
  lead_member_code text,
  business_id uuid,
  business_name text,
  business_logo_url text,
  owner_name text,
  referrer_id uuid,
  referrer_name text,
  referrer_photo_url text,
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
  select r.id, r.status, r.outcome, r.decline_reason, r.note,
         r.created_at, r.responded_at, r.closed_at,
         r.lead_name,
         case when r.status in ('new', 'in_talks') then r.lead_phone end,
         r.lead_person_id, lp.member_code,
         b.id, b.name, b.logo_url, op.full_name,
         rp.id, rp.full_name, rp.profile_photo_url,
         count(*) over ()
  from business_referrals r
  join businesses b on b.id = r.business_id
  join people op on op.id = b.owner_id
  join people rp on rp.id = r.referrer_person_id
  left join people lp on lp.id = r.lead_person_id
  join me on true
  where case when p_direction = 'given'
             then r.referrer_person_id = me.id
             else b.owner_id = me.id end
  order by case r.status when 'new' then 0 when 'in_talks' then 1 else 2 end,
           r.created_at desc, r.id asc
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

revoke all on function list_business_referrals(text, int, int) from public;
grant execute on function list_business_referrals(text, int, int) to authenticated;

-- The three counters, plus how many closed were won and how many received
-- are waiting on the caller.
create or replace function business_referral_counts()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select id from people where auth_user_id = auth.uid()
  ),
  mine as (
    select r.*, (r.referrer_person_id = me.id) as given_by_me, (b.owner_id = me.id) as to_me
    from business_referrals r
    join businesses b on b.id = r.business_id
    join me on true
    where r.referrer_person_id = me.id or b.owner_id = me.id
  )
  select jsonb_build_object(
    'given', (select count(*) from mine where given_by_me),
    'received', (select count(*) from mine where to_me),
    'closed', (select count(*) from mine where status = 'closed'),
    'won', (select count(*) from mine where status = 'closed' and outcome = 'won'),
    'received_new', (select count(*) from mine where to_me and status = 'new')
  );
$$;

revoke all on function business_referral_counts() from public;
grant execute on function business_referral_counts() to authenticated;

-- Accept (-> in_talks) or decline a new referral to one of the caller's
-- businesses. Declining clears the lead's phone.
create or replace function respond_business_referral(
  p_referral_id uuid,
  p_accept boolean,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reason text := nullif(trim(p_reason), '');
begin
  if v_reason is not null and length(v_reason) > 300 then
    raise exception 'Keep the reason to 300 characters';
  end if;
  if coalesce(p_accept, false) then
    update business_referrals r
    set status = 'in_talks', responded_at = now(), updated_at = now()
    from businesses b, people me
    where r.id = p_referral_id and b.id = r.business_id and me.id = b.owner_id
      and me.auth_user_id = auth.uid() and r.status = 'new';
  else
    update business_referrals r
    set status = 'declined', decline_reason = v_reason, lead_phone = null,
        responded_at = now(), updated_at = now()
    from businesses b, people me
    where r.id = p_referral_id and b.id = r.business_id and me.id = b.owner_id
      and me.auth_user_id = auth.uid() and r.status = 'new';
  end if;
  if not found then
    raise exception 'This referral isn''t waiting for you';
  end if;
end;
$$;

revoke all on function respond_business_referral(uuid, boolean, text) from public;
grant execute on function respond_business_referral(uuid, boolean, text) to authenticated;

-- Close an accepted referral as won ("business done") or lost. Clears the
-- lead's phone.
create or replace function close_business_referral(p_referral_id uuid, p_outcome text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_outcome is null or p_outcome not in ('won', 'lost') then
    raise exception 'Say how it turned out';
  end if;
  update business_referrals r
  set status = 'closed', outcome = p_outcome, lead_phone = null,
      closed_at = now(), updated_at = now()
  from businesses b, people me
  where r.id = p_referral_id and b.id = r.business_id and me.id = b.owner_id
    and me.auth_user_id = auth.uid() and r.status = 'in_talks';
  if not found then
    raise exception 'Only a referral you''ve accepted can be closed';
  end if;
end;
$$;

revoke all on function close_business_referral(uuid, text) from public;
grant execute on function close_business_referral(uuid, text) to authenticated;

-- Take back a referral the business hasn't answered yet.
create or replace function withdraw_business_referral(p_referral_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from business_referrals r
  using people me
  where r.id = p_referral_id and me.id = r.referrer_person_id
    and me.auth_user_id = auth.uid() and r.status = 'new';
  if not found then
    raise exception 'Only a referral that hasn''t been answered can be withdrawn';
  end if;
end;
$$;

revoke all on function withdraw_business_referral(uuid) from public;
grant execute on function withdraw_business_referral(uuid) to authenticated;

-- ================================================================
-- verification (run these after applying)
-- ================================================================
-- select relname, relrowsecurity from pg_class where relname = 'business_referrals';
--   -- 1 row, true
-- select proname, count(*) from pg_proc
-- where proname in ('give_business_referral', 'list_business_referrals', 'business_referral_counts',
--                   'respond_business_referral', 'close_business_referral',
--                   'withdraw_business_referral')
-- group by proname;
--   -- 6 rows, each count 1
--
-- Then, signed in as a member in the browser console:
--   await supabase.from('business_referrals').select()      -- [] (no policies)
--   await supabase.rpc('business_referral_counts')          -- { given: 0, ... }
