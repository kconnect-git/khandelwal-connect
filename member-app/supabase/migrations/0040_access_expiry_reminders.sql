-- Phase 11.8: "your access ends in 5 days" reminder emails (phase-11-plan.md).
--
--   * service_access_grants.reminded_at: set once the reminder for that
--     grant has been emailed. A member's run of chained grants gets one
--     reminder, on its LAST grant -- extending adds a new grant with no
--     reminder yet, so they're reminded again near the new end.
--   * access_reminders_due(): runs ending within 5 days that haven't been
--     reminded, for approved members, and ONLY for services whose paywall is
--     on (while it's off nothing locks when access ends, so "renew" would
--     just confuse people). Returns the login email for the sender.
--   * mark_access_reminded(grant ids): stamps reminded_at.
--   * Both are callable only by service_role (the edge function), never by
--     clients.
--   * Daily schedule: pg_cron at 03:30 UTC (09:00 IST) POSTs to the
--     send-access-expiring edge function via pg_net. The call carries a
--     random secret generated here and kept in Vault; the function checks it
--     with access_reminder_secret_ok() (service_role only). The secret never
--     leaves the database -- nobody has to copy it anywhere.
--   * The edge function must be deployed with --no-verify-jwt (the cron call
--     has no user JWT; the secret is its authentication instead).
--
-- Enables the pg_cron and pg_net extensions (both available on the project,
-- not installed before this).
--
-- ORDER OF DEPLOY: deploy the edge function first
--   (npx supabase functions deploy send-access-expiring --no-verify-jwt
--    --project-ref agxygngazgmemplcogho),
-- then apply this. Applied first, the job would just get a 404 each day
-- until the function exists.
--
-- Re-runnable.

-- ================================================================
-- extensions (outside the transaction: create extension pg_cron can't run
-- inside one on every Postgres build)
-- ================================================================

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

begin;

-- ================================================================
-- column
-- ================================================================

alter table service_access_grants add column if not exists reminded_at timestamptz;

-- ================================================================
-- the secret (generated here, never shown)
-- ================================================================

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'access_reminder_cron_secret') then
    perform vault.create_secret(
      replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
      'access_reminder_cron_secret',
      'Authenticates the daily pg_cron call to the send-access-expiring edge function (0040).'
    );
  end if;
end $$;

create or replace function access_reminder_secret_ok(p_secret text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_secret is not null and length(p_secret) > 0 and exists (
    select 1 from vault.decrypted_secrets s
    where s.name = 'access_reminder_cron_secret' and s.decrypted_secret = p_secret
  );
$$;

revoke all on function access_reminder_secret_ok(text) from public;
revoke all on function access_reminder_secret_ok(text) from anon, authenticated;
grant execute on function access_reminder_secret_ok(text) to service_role;

-- ================================================================
-- what's due
-- ================================================================

create or replace function access_reminders_due()
returns table (
  grant_id uuid,
  person_id uuid,
  full_name text,
  email text,
  service text,
  ends_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select g.id, p.id, p.full_name, u.email::text, g.service, g.ends_at
  from service_access_grants g
  join people p on p.id = g.person_id
  join paid_service_settings s on s.service = g.service
  left join auth.users u on u.id = p.auth_user_id
  where g.revoked_at is null
    and g.reminded_at is null
    and g.ends_at > now()
    and g.ends_at <= now() + interval '5 days'
    and s.enforced
    and p.member_status = 'approved'
    -- the last grant of the run: nothing later for this member + service
    and not exists (select 1 from service_access_grants later
                    where later.person_id = g.person_id
                      and later.service = g.service
                      and later.revoked_at is null
                      and later.ends_at > g.ends_at)
  order by g.ends_at, g.id;
$$;

revoke all on function access_reminders_due() from public;
revoke all on function access_reminders_due() from anon, authenticated;
grant execute on function access_reminders_due() to service_role;

create or replace function mark_access_reminded(p_grant_ids uuid[])
returns int
language sql
security definer
set search_path = public
as $$
  with done as (
    update service_access_grants
    set reminded_at = now()
    where id = any (p_grant_ids) and reminded_at is null
    returning 1
  )
  select count(*)::int from done;
$$;

revoke all on function mark_access_reminded(uuid[]) from public;
revoke all on function mark_access_reminded(uuid[]) from anon, authenticated;
grant execute on function mark_access_reminded(uuid[]) to service_role;

-- ================================================================
-- daily schedule: 03:30 UTC = 09:00 IST
-- ================================================================

do $$
begin
  if exists (select 1 from cron.job where jobname = 'access-expiry-reminders') then
    perform cron.unschedule('access-expiry-reminders');
  end if;
end $$;

select cron.schedule(
  'access-expiry-reminders',
  '30 3 * * *',
  $job$
    select net.http_post(
      url := 'https://agxygngazgmemplcogho.supabase.co/functions/v1/send-access-expiring',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-reminder-secret', (select decrypted_secret from vault.decrypted_secrets
                              where name = 'access_reminder_cron_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 60000
    );
  $job$
);

commit;

-- ================================================================
-- verification (run these after applying)
-- ================================================================
-- select extname from pg_extension where extname in ('pg_cron', 'pg_net');   -- 2 rows
-- select jobname, schedule, active from cron.job where jobname = 'access-expiry-reminders';
--   -- 1 row, '30 3 * * *', true
-- select count(*) from vault.secrets where name = 'access_reminder_cron_secret';   -- 1
-- select proname, has_function_privilege('authenticated', oid, 'execute') authed,
--        has_function_privilege('service_role', oid, 'execute') svc
-- from pg_proc where proname in ('access_reminder_secret_ok', 'access_reminders_due',
--                                'mark_access_reminded');
--   -- authed false, svc true
--
-- To run it now instead of waiting for 09:00 IST:
--   select cron.schedule('access-expiry-reminders-now', '* * * * *', (select command from cron.job where jobname = 'access-expiry-reminders'));
--   -- wait a minute, then: select cron.unschedule('access-expiry-reminders-now');
-- and check: select status_code, content from net._http_response order by created desc limit 1;
