-- Kira Makan sync self-test. Changes nothing (rollback). A failing assert stops with its message.
-- Optional extra check, run on its own: begin; set local role anon; select public.sync_pull(0, 1); rollback;
-- must fail with "permission denied for function sync_pull".
begin;
select set_config('request.jwt.claims',
  json_build_object('sub', (select id::text from auth.users order by created_at limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  d    uuid := (public.sync_hello() ->> 'dataset')::uuid;
  r    jsonb;
  rev1 bigint;
  row1 jsonb := '{"t":"weights","k":"selftest","del":false,"data":{"id":"selftest","kg":70},"base":null,"at":"2026-01-01T00:00:00.000Z","n":"selftest-n1"}';
begin
  r := public.sync_push(d, 'selftest-a', now(), jsonb_build_array(row1));
  assert r #>> '{results,0,s}' = 'ok', 'a new row applies';
  rev1 := (r #>> '{results,0,rev}')::bigint;

  r := public.sync_push(d, 'selftest-a', now(), jsonb_build_array(row1));
  assert r #>> '{results,0,s}' = 'ok' and r ->> 'head' = r ->> 'prevHead', 'a retried push adds no revision';

  r := public.sync_push(d, 'selftest-b', now(), jsonb_build_array(row1 ||
         '{"data":{"id":"selftest","kg":71},"at":"2025-12-31T00:00:00.000Z","n":"selftest-n2"}'::jsonb));
  assert r #>> '{results,0,s}' = 'lost' and r #>> '{results,0,data,kg}' = '70', 'an older edit that never saw the current copy loses';

  r := public.sync_push(d, 'selftest-b', now(), jsonb_build_array(row1 ||
         jsonb_build_object('del', true, 'data', null, 'base', rev1, 'at', '2025-01-01T00:00:00.000Z', 'n', 'selftest-n3')));
  assert r #>> '{results,0,s}' = 'ok', 'an edit made on top of the current copy applies, whatever its clock says';

  r := public.sync_push(d, 'selftest-b', now(),
         '[{"t":"profile","k":"me","del":false,"data":{"id":"me","demoMode":true},"base":null,"at":"2026-01-01T00:00:00.000Z","n":"selftest-n4"}]');
  assert r #>> '{results,0,s}' = 'invalid', 'demo data never syncs';

  r := public.sync_pull(rev1, 10);
  assert exists (select 1 from jsonb_array_elements(r -> 'rows') x where x ->> 'k' = 'selftest' and (x ->> 'del')::boolean),
         'pull returns the tombstone';

  r := public.sync_push(d, 'selftest-b', now(),
         '[{"t":"weights","k":"selftest-2","del":false,"data":{"id":"selftest-2"},"base":null,"at":"2026-02-30T00:00:00.000Z","n":"selftest-n5"},
           {"t":"weights","k":"selftest-3","del":false,"data":{"id":"selftest-3"},"base":null,"at":"2026-01-01T00:00:00.000Z","n":"selftest-n6"}]');
  assert r #>> '{results,0,s}' = 'invalid' and r #>> '{results,1,s}' = 'ok', 'a bad row is answered invalid and the rest of the batch applies';
end $$;
rollback;
