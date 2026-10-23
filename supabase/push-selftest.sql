-- Kira Makan reminders self-test. Changes nothing (rollback). Run after push.sql and push_configure.
-- A failing assert stops with its message.
-- "Sign in to sync" here means the project has no user yet: sign in once in the app (DEPLOY.md step 14),
-- then run it again. It acts as the first user, with a made-up push address that never receives anything.
begin;

-- 1. The setup, as the SQL Editor's role ------------------------------------------------------------------
do $$ begin
  assert to_regclass('public.push_subscriptions') is not null and to_regclass('public.push_log') is not null,
         'push.sql has run';
  assert exists (select 1 from cron.job j
                  where j.jobname = 'kira-makan-reminders' and j.schedule = '*/5 * * * *' and j.command like '%push_tick%'),
         'the reminders job runs every 5 minutes';
  assert exists (select 1 from vault.secrets s where s.name = 'kira_makan_reminders_url'),
         'push_configure has run (the function address)';
  assert exists (select 1 from vault.secrets s where s.name = 'kira_makan_cron_secret'),
         'push_configure has run (the cron secret)';
  assert not has_function_privilege('anon', 'public.push_subscribe(text,text,text,text,text,text)', 'execute'),
         'signed-out callers can''t subscribe';
  assert not has_function_privilege('authenticated', 'public.push_context(uuid,date)', 'execute'),
         'only the server reads reminder data';
  assert not has_function_privilege('anon', 'public.push_tick()', 'execute')
     and not has_function_privilege('authenticated', 'public.push_tick()', 'execute')
     and not has_function_privilege('service_role', 'public.push_tick()', 'execute'),
         'only the job calls the function';
  assert exists (select 1 from pg_policies p
                  where p.schemaname = 'public' and p.tablename = 'push_subscriptions' and p.policyname = 'push_subscriptions_select_own'),
         'each user reads only their own subscriptions';
end $$;
-- Only browser push services: never another site, a look-alike, a login in the address or another port.
-- (Checked here: signed-in users only reach it through push_subscribe, in section 2.)
do $$
declare
  key text := 'B' || repeat('A', 86);
  sec text := repeat('a', 22);
begin
  assert public.push_valid_subscription('https://updates.push.services.mozilla.com/wpush/v2/x', key, sec, key)
     and public.push_valid_subscription('https://wns2-par02p.notify.windows.com/w/?token=x', key, sec, key)
     and public.push_valid_subscription('https://web.push.apple.com/x', key, sec, key)
     and public.push_valid_subscription('https://FCM.googleapis.com:443/fcm/send/x', key, sec, key),
         'the browsers'' push services are accepted';
  assert not public.push_valid_subscription('https://evil.example/collect', key, sec, key)
     and not public.push_valid_subscription('https://fcm.googleapis.com.evil.example/fcm/send/x', key, sec, key)
     and not public.push_valid_subscription('https://fcm.googleapis.com@evil.example/fcm/send/x', key, sec, key)
     and not public.push_valid_subscription('https://fcm.googleapis.com:8443/fcm/send/x', key, sec, key)
     and not public.push_valid_subscription('https://www.googleapis.com/upload/drive/v3/files', key, sec, key),
         'any other address is refused';
end $$;

-- 2. A device, as the first user ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select id::text from auth.users order by created_at limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  key  text := 'B' || repeat('A', 86);
  sec  text := repeat('a', 22);
  one  text := 'https://fcm.googleapis.com/fcm/send/kira-makan-selftest-1';
  two  text := 'https://fcm.googleapis.com/fcm/send/kira-makan-selftest-2';
  r    jsonb;
begin
  r := public.push_subscribe(one, key, sec, key, 'Self-test', null);
  assert r ->> 'saved' = 'true' and exists (select 1 from public.push_subscriptions s where s.endpoint = one),
         'a subscription is saved for this account';
  r := public.push_device(one);
  assert r ->> 'found' = 'true' and (r ->> 'failures')::integer = 0 and not (r ? 'auth'),
         'this device''s status can be read';
  r := public.push_subscribe(two, key, sec, key, 'Self-test', one);
  assert not exists (select 1 from public.push_subscriptions s where s.endpoint = one)
     and exists (select 1 from public.push_subscriptions s where s.endpoint = two),
         'a refreshed subscription replaces the old one';
  begin
    perform public.push_subscribe('http://not-a-push-service', key, sec, key, null, null);
    assert false, 'a bad subscription is refused';
  exception when sqlstate 'PT400' then
    null;
  end;
  begin
    perform public.push_subscribe('https://evil.example/collect', key, sec, key, null, null);
    assert false, 'a subscription for another site is refused';
  exception when sqlstate 'PT400' then
    null;
  end;
end $$;

-- 3. The job, as the service role -------------------------------------------------------------------------
reset role;
set local role service_role;
do $$
declare
  uid uuid := (current_setting('request.jwt.claims')::jsonb ->> 'sub')::uuid;
  two text := 'https://fcm.googleapis.com/fcm/send/kira-makan-selftest-2';
  r   jsonb;
begin
  r := public.push_context(uid, current_date - 36);
  assert jsonb_typeof(r -> 'subscriptions') = 'array' and jsonb_array_length(r -> 'subscriptions') >= 1
     and r ? 'profile' and r ? 'days' and r ? 'meals' and r ? 'targetNotice' and r ? 'targetNoticeSeen',
         'the server sees the subscription and the synced diary';
  assert public.push_claim(uid, 'checkIn', date '2000-01-01') and not public.push_claim(uid, 'checkIn', date '2000-01-01'),
         'a reminder is claimed once, never twice';
  perform public.push_report(uid, 'checkIn', date '2000-01-01', jsonb_build_array(jsonb_build_object('endpoint', two, 'outcome', 'gone')));
  assert not exists (select 1 from public.push_subscriptions s where s.endpoint = two),
         'an expired subscription is dropped';
  perform public.push_release(uid, 'checkIn', date '2000-01-01');
  assert public.push_claim(uid, 'checkIn', date '2000-01-01'),
         'a released claim can be sent again';
end $$;

-- 4. A rotated subscription, signed out --------------------------------------------------------------------
reset role;
set local role anon;
do $$
declare key text := 'B' || repeat('A', 86);
begin
  assert public.push_resubscribe('https://fcm.googleapis.com/fcm/send/kira-makan-selftest-unknown', repeat('a', 22),
           'https://fcm.googleapis.com/fcm/send/kira-makan-selftest-3', key, repeat('a', 22), key) ->> 'saved' = 'false',
         'a rotation needs the old secret';
end $$;

rollback;
