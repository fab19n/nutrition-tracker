-- Kira Makan reminders: push notifications to the installed app (ARCHITECTURE.md §10.19, DEPLOY.md part 10).
-- Paste the whole file into Supabase › SQL Editor › New query › Run, after supabase/sync.sql. Safe to run again.
-- Then run public.push_configure(…) once (DEPLOY.md step 58) and supabase/push-selftest.sql.
-- Later changes ship as new files (push-002.sql, …). To change a function's arguments, drop the old
-- signature first: create or replace with different arguments adds an overload.
-- Keep this file out of supabase/migrations: a pasted file isn't recorded as applied, so db push would rerun it.

-- 0. Needs sync.sql (sync_rows, sync_caller) -------------------------------------------------------
do $$ begin
  if to_regclass('public.sync_rows') is null or to_regprocedure('public.sync_caller()') is null then
    raise exception 'Run supabase/sync.sql first';
  end if;
end $$;
create extension if not exists pg_net;
create extension if not exists pg_cron;

-- 1. Tables ------------------------------------------------------------------------------------------
-- One row per device: the browser's push address and keys. Written only through the functions below.
create table if not exists public.push_subscriptions (
  -- Postgres caps a regex repeat count at 255, so the length is a separate test.
  endpoint    text primary key check (endpoint ~ '^https://\S+$' and char_length(endpoint) between 18 and 1000),
  user_id     uuid not null references auth.users (id) on delete cascade,
  p256dh      text not null,
  auth_secret text not null,
  vapid_key   text not null,
  label       text check (char_length(label) <= 40),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  last_ok_at  timestamptz,
  last_error  text check (char_length(last_error) <= 200),
  failures    integer not null default 0 check (failures >= 0)
);
create index if not exists push_subscriptions_user on public.push_subscriptions (user_id, updated_at desc);

-- What was sent: claimed before sending, so a reminder never goes twice. local_date is the logical day
-- (checkIn, gap) or the week's Monday (weeklyReview, targetSuggestion).
create table if not exists public.push_log (
  user_id    uuid not null references auth.users (id) on delete cascade,
  kind       text not null check (kind in ('checkIn', 'gap', 'weeklyReview', 'targetSuggestion')),
  local_date date not null,
  sent_at    timestamptz not null default now(),
  delivered  integer not null default 0,
  primary key (user_id, kind, local_date)
);

-- The server's 36-day meal read (push_context) without detoasting every meal row.
create index if not exists sync_rows_meal_day on public.sync_rows (user_id, (data ->> 'logicalDay'))
  where tbl = 'meals' and not deleted;

-- 2. Access: read your own rows; nobody writes the tables directly ------------------------------------
alter table public.push_subscriptions enable row level security;
alter table public.push_log enable row level security;
revoke all on table public.push_subscriptions, public.push_log from public, anon, authenticated;
grant select on table public.push_subscriptions, public.push_log to authenticated;
drop policy if exists push_subscriptions_select_own on public.push_subscriptions;
create policy push_subscriptions_select_own on public.push_subscriptions
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists push_log_select_own on public.push_log;
create policy push_log_select_own on public.push_log
  for select to authenticated using (user_id = (select auth.uid()));

-- 3. Functions ---------------------------------------------------------------------------------------
-- A browser push subscription's shape: an https endpoint, a 65-byte P-256 key (p256dh, and the VAPID key
-- it was made with) and a 16-byte auth secret, in base64url.
-- The endpoint must be a browser push service (FCM, Mozilla, Windows, Apple), so a signed-in account
-- can't make send-reminders POST anywhere else: https, port 443 if any, no user or password, and the
-- host on the list. Keep it in step with supabase/functions/_shared/pushHosts.ts.
create or replace function public.push_valid_subscription(p_endpoint text, p_p256dh text, p_auth text, p_vapid_key text)
returns boolean language sql immutable security invoker set search_path = '' as $$
  select coalesce(
    p_endpoint ~ '^https://\S+$' and char_length(p_endpoint) between 18 and 1000
    and lower(substring(p_endpoint from '^https://([A-Za-z0-9.-]+)(?::443)?(?:[/?#]|$)')) ~
        '^(fcm\.googleapis\.com|jmt[0-9]+\.google\.com|([a-z0-9-]+\.)*push\.services\.mozilla\.com|[a-z0-9-]+\.notify\.windows\.com|([a-z0-9-]+\.)*push\.apple\.com)$'
    and p_p256dh ~ '^[A-Za-z0-9_-]{86,88}={0,2}$'
    and p_vapid_key ~ '^[A-Za-z0-9_-]{86,88}={0,2}$'
    and p_auth ~ '^[A-Za-z0-9_-]{21,24}={0,2}$', false)
$$;

-- This device's subscription, for the signed-in user. A rotated endpoint replaces the old one
-- (p_replaces, when it's the caller's); an endpoint another account had moves to the caller. Each user
-- keeps their 10 newest devices.
create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_vapid_key text,
  p_label text default null, p_replaces text default null)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := public.sync_caller();
begin
  if not public.push_valid_subscription(p_endpoint, p_p256dh, p_auth, p_vapid_key) then
    raise exception 'Not a push subscription' using errcode = 'PT400';
  end if;
  if p_replaces is not null and p_replaces <> p_endpoint then
    delete from public.push_subscriptions s where s.endpoint = p_replaces and s.user_id = v_uid;
  end if;
  insert into public.push_subscriptions as s (endpoint, user_id, p256dh, auth_secret, vapid_key, label)
  values (p_endpoint, v_uid, p_p256dh, p_auth, p_vapid_key, left(nullif(trim(p_label), ''), 40))
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth_secret = excluded.auth_secret,
        vapid_key = excluded.vapid_key, label = excluded.label, updated_at = now(), failures = 0, last_error = null;
  delete from public.push_subscriptions s where s.user_id = v_uid and s.endpoint in (
    select o.endpoint from public.push_subscriptions o where o.user_id = v_uid
     order by o.updated_at desc, o.endpoint offset 10);
  return jsonb_build_object('saved', true);
end; $$;

-- Turn off, Sign out and Delete everything on this device.
create or replace function public.push_unsubscribe(p_endpoint text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_uid uuid := public.sync_caller(); v_n integer;
begin
  delete from public.push_subscriptions s where s.endpoint = p_endpoint and s.user_id = v_uid;
  get diagnostics v_n = row_count;
  return jsonb_build_object('removed', v_n);
end; $$;

-- What the account knows about this device (S38's card). Never its keys.
create or replace function public.push_device(p_endpoint text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := public.sync_caller(); v_row public.push_subscriptions%rowtype;
begin
  select * into v_row from public.push_subscriptions s where s.endpoint = p_endpoint and s.user_id = v_uid;
  if not found then
    return jsonb_build_object('found', false);
  end if;
  return jsonb_build_object('found', true, 'createdAt', v_row.created_at, 'lastOkAt', v_row.last_ok_at,
    'lastError', v_row.last_error, 'failures', v_row.failures, 'vapidKey', v_row.vapid_key);
end; $$;

-- The send-reminders function's test, as the caller (PostgREST checked the token): their own device, or null.
create or replace function public.push_test_target(p_endpoint text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := public.sync_caller(); v_row public.push_subscriptions%rowtype;
begin
  select * into v_row from public.push_subscriptions s where s.endpoint = p_endpoint and s.user_id = v_uid;
  if not found then
    return null;
  end if;
  return jsonb_build_object('userId', v_row.user_id, 'endpoint', v_row.endpoint, 'p256dh', v_row.p256dh,
    'auth', v_row.auth_secret, 'vapidKey', v_row.vapid_key);
end; $$;

-- The service worker's pushsubscriptionchange, signed out (anon): the old subscription's auth secret
-- proves the device owns it. Anything wrong answers saved: false, with no detail.
create or replace function public.push_resubscribe(p_old_endpoint text, p_old_auth text, p_endpoint text,
  p_p256dh text, p_auth text, p_vapid_key text)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_row public.push_subscriptions%rowtype;
begin
  if p_old_endpoint is null or p_old_auth is null
     or not public.push_valid_subscription(p_endpoint, p_p256dh, p_auth, p_vapid_key) then
    return jsonb_build_object('saved', false);
  end if;
  select * into v_row from public.push_subscriptions s where s.endpoint = p_old_endpoint for update;
  if not found or v_row.auth_secret is distinct from p_old_auth then
    return jsonb_build_object('saved', false);
  end if;
  delete from public.push_subscriptions s where s.endpoint = p_old_endpoint;
  insert into public.push_subscriptions as s (endpoint, user_id, p256dh, auth_secret, vapid_key, label)
  values (p_endpoint, v_row.user_id, p_p256dh, p_auth, p_vapid_key, v_row.label)
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth_secret = excluded.auth_secret,
        vapid_key = excluded.vapid_key, label = excluded.label, updated_at = now(), failures = 0, last_error = null;
  return jsonb_build_object('saved', true);
end; $$;

-- The job (service role): who has a device.
create or replace function public.push_due_users()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(u.user_id), '[]'::jsonb)
    from (select distinct s.user_id from public.push_subscriptions s) u
$$;

-- The job (service role): compact JSON for the reminder rules, never whole rows (meals carry photo
-- thumbnails). Days and meals from p_from on; the send log of the last 8 days.
create or replace function public.push_context(p_user uuid, p_from date)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'profile', (select jsonb_build_object('timeZone', r.data -> 'timeZone', 'rolloverHour', r.data -> 'rolloverHour',
                  'startedOn', r.data -> 'startedOn', 'reminders', r.data -> 'reminders', 'demoMode', r.data -> 'demoMode')
                  from public.sync_rows r
                 where r.user_id = p_user and r.tbl = 'profile' and r.row_key = 'me' and not r.deleted),
    'days', coalesce((select jsonb_agg(jsonb_build_object('d', r.row_key, 's', r.data ->> 'status', 'sl', r.data ->> 'sleepAt')
                        order by r.row_key)
                        from public.sync_rows r
                       where r.user_id = p_user and r.tbl = 'days' and not r.deleted
                         and r.row_key >= to_char(p_from, 'YYYY-MM-DD')), '[]'::jsonb),
    'completeDays', (select count(*) from public.sync_rows r
                      where r.user_id = p_user and r.tbl = 'days' and not r.deleted and r.data ->> 'status' = 'complete'),
    'meals', coalesce((select jsonb_agg(jsonb_build_object('d', r.data ->> 'logicalDay', 'at', r.data ->> 'eatenAt',
                         'sl', r.data ->> 'slot', 'g', coalesce(r.data -> 'isGuess' = 'true'::jsonb, false)))
                         from public.sync_rows r
                        where r.user_id = p_user and r.tbl = 'meals' and not r.deleted
                          and (r.data ->> 'logicalDay') >= to_char(p_from, 'YYYY-MM-DD')), '[]'::jsonb),
    'periods', coalesce((select jsonb_agg(jsonb_build_object('id', r.row_key, 'g', r.data ->> 'goalId', 'f', r.data ->> 'from',
                           't', r.data ->> 'to', 'c', r.data ->> 'createdAt'))
                           from public.sync_rows r
                          where r.user_id = p_user and r.tbl = 'goalPeriods' and not r.deleted), '[]'::jsonb),
    'goals', coalesce((select jsonb_agg(jsonb_build_object('id', r.row_key, 'tp', r.data ->> 'template'))
                         from public.sync_rows r
                        where r.user_id = p_user and r.tbl = 'goals' and not r.deleted), '[]'::jsonb),
    'targetNotice', (select r.data -> 'targetNotice' from public.sync_rows r
                      where r.user_id = p_user and r.tbl = 'insightFeedback' and r.row_key = 'targetNotice' and not r.deleted),
    'targetNoticeSeen', (select r.data -> 'targetNoticeSeen' from public.sync_rows r
                          where r.user_id = p_user and r.tbl = 'insightFeedback' and r.row_key = 'targetNoticeSeen' and not r.deleted),
    'subscriptions', coalesce((select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh,
                                 'auth', s.auth_secret, 'vapidKey', s.vapid_key))
                                 from public.push_subscriptions s where s.user_id = p_user), '[]'::jsonb),
    'sent', coalesce((select jsonb_agg(jsonb_build_object('kind', l.kind, 'date', l.local_date, 'at', l.sent_at))
                        from public.push_log l
                       where l.user_id = p_user and l.sent_at > now() - interval '8 days'), '[]'::jsonb))
$$;

-- The job (service role): claims a reminder before sending it. False when another run already did.
create or replace function public.push_claim(p_user uuid, p_kind text, p_date date)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
begin
  insert into public.push_log (user_id, kind, local_date) values (p_user, p_kind, p_date) on conflict do nothing;
  return found;
end; $$;

-- The job (service role): nobody got it and it may work later, so the next run tries again.
create or replace function public.push_release(p_user uuid, p_kind text, p_date date)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  delete from public.push_log l where l.user_id = p_user and l.kind = p_kind and l.local_date = p_date;
end; $$;

-- The job (service role): how each device took it. ok resets its failures, gone drops it, failed counts
-- one more, skipped notes why. With a kind and date, the log counts the deliveries.
create or replace function public.push_report(p_user uuid, p_kind text, p_date date, p_results jsonb)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_item jsonb; v_endpoint text; v_ok integer := 0;
begin
  if jsonb_typeof(p_results) is distinct from 'array' then
    raise exception 'Results must be an array' using errcode = 'PT400';
  end if;
  for v_item in select e.value from jsonb_array_elements(p_results) e loop
    v_endpoint := v_item ->> 'endpoint';
    case v_item ->> 'outcome'
      when 'ok' then
        update public.push_subscriptions s set last_ok_at = now(), failures = 0, last_error = null, updated_at = now()
         where s.endpoint = v_endpoint and s.user_id = p_user;
        v_ok := v_ok + 1;
      when 'gone' then
        delete from public.push_subscriptions s where s.endpoint = v_endpoint and s.user_id = p_user;
      when 'failed' then
        update public.push_subscriptions s set failures = s.failures + 1, last_error = left(coalesce(v_item ->> 'error', 'failed'), 200)
         where s.endpoint = v_endpoint and s.user_id = p_user;
      when 'skipped' then
        update public.push_subscriptions s set last_error = left(coalesce(v_item ->> 'error', 'skipped'), 200)
         where s.endpoint = v_endpoint and s.user_id = p_user;
      else
        null;
    end case;
  end loop;
  if p_kind is not null and p_date is not null then
    update public.push_log l set delivered = l.delivered + v_ok
     where l.user_id = p_user and l.kind = p_kind and l.local_date = p_date;
  end if;
end; $$;

-- pg_cron's job, every 5 minutes: calls send-reminders with the cron secret, but only while some device
-- has reminders on and push_configure has stored the address and the secret. Also tidies the logs.
create or replace function public.push_tick()
returns bigint language plpgsql volatile security definer set search_path = '' as $$
declare v_url text; v_secret text;
begin
  if not exists (select 1 from public.push_subscriptions) then
    return null;
  end if;
  select max(d.decrypted_secret) filter (where d.name = 'kira_makan_reminders_url'),
         max(d.decrypted_secret) filter (where d.name = 'kira_makan_cron_secret')
    into v_url, v_secret
    from vault.decrypted_secrets d
   where d.name in ('kira_makan_reminders_url', 'kira_makan_cron_secret');
  if v_url is null or v_secret is null then
    return null;
  end if;
  delete from public.push_log l where l.sent_at < now() - interval '60 days';
  begin
    delete from cron.job_run_details d where d.end_time < now() - interval '7 days';
  exception when others then
    null;
  end;
  return net.http_post(
    url := v_url,
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'X-Cron-Secret', v_secret),
    timeout_milliseconds := 30000);
end; $$;

-- Run once from the SQL Editor (DEPLOY.md step 58): stores the function's address and the cron secret
-- in Vault, where push_tick reads them. Running it again replaces both.
create or replace function public.push_configure(p_function_url text, p_cron_secret text)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_function_url is null or p_function_url !~ '^https://[^/\s]+/functions/v1/send-reminders$' then
    raise exception 'Use the function address: https://<project-ref>.supabase.co/functions/v1/send-reminders' using errcode = '22023';
  end if;
  if p_cron_secret is null or char_length(p_cron_secret) < 32 then
    raise exception 'The cron secret needs 32 characters or more (npm run push:keys makes one)' using errcode = '22023';
  end if;
  select s.id into v_id from vault.secrets s where s.name = 'kira_makan_reminders_url';
  if v_id is null then
    perform vault.create_secret(p_function_url, 'kira_makan_reminders_url', 'Kira Makan: the send-reminders function address');
  else
    perform vault.update_secret(v_id, p_function_url);
  end if;
  v_id := null;
  select s.id into v_id from vault.secrets s where s.name = 'kira_makan_cron_secret';
  if v_id is null then
    perform vault.create_secret(p_cron_secret, 'kira_makan_cron_secret', 'Kira Makan: the X-Cron-Secret send-reminders checks');
  else
    perform vault.update_secret(v_id, p_cron_secret);
  end if;
  return 'Reminders configured. The job calls the function every 5 minutes.';
end; $$;

-- 4. The job -------------------------------------------------------------------------------------------
-- cron.schedule with an existing name updates that job, so running this file again changes nothing.
do $$ begin
  perform cron.schedule('kira-makan-reminders', '*/5 * * * *', 'select public.push_tick()');
end $$;

-- 5. Who may call what (explicit, since Supabase grants new functions to anon, authenticated and service_role)
revoke all on function public.push_valid_subscription(text, text, text, text), public.push_subscribe(text, text, text, text, text, text),
  public.push_unsubscribe(text), public.push_device(text), public.push_test_target(text),
  public.push_resubscribe(text, text, text, text, text, text), public.push_due_users(), public.push_context(uuid, date),
  public.push_claim(uuid, text, date), public.push_release(uuid, text, date), public.push_report(uuid, text, date, jsonb),
  public.push_tick(), public.push_configure(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.push_subscribe(text, text, text, text, text, text), public.push_unsubscribe(text),
  public.push_device(text), public.push_test_target(text) to authenticated;
grant execute on function public.push_resubscribe(text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.push_due_users(), public.push_context(uuid, date), public.push_claim(uuid, text, date),
  public.push_release(uuid, text, date), public.push_report(uuid, text, date, jsonb) to service_role;

notify pgrst, 'reload schema';
