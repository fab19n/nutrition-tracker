/**
 * Supabase Edge Function: POST /functions/v1/send-reminders (decision §10.19)
 *
 * Called every 5 minutes by pg_cron (public.push_tick in supabase/push.sql) with `X-Cron-Secret`, and
 * by the app for a test notification with the signed-in user's token. The platform's JWT check is
 * off (supabase/config.toml: verify_jwt = false): the cron call has no JWT, and a test is checked by
 * PostgREST inside push_test_target.
 *
 * Secrets (supabase secrets set --env-file supabase/.env.secrets): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
 * VAPID_SUBJECT and CRON_SECRET (npm run push:keys prints them), and ALLOWED_ORIGIN (shared with the
 * estimate function) for the test's CORS. SUPABASE_URL and the project keys come from the platform.
 * Deploy: npx supabase functions deploy send-reminders --no-verify-jwt --use-api
 *
 * Logs carry counts and codes only: never an endpoint, an email or a user id.
 */
import { createRateLimiter } from '../estimate/auth.ts';
import { readServerSettings } from './config.ts';
import { deliverTest, runTick, TestTargetError } from './core.ts';
import { createRemindersHandler } from './handler.ts';
import { createServiceClient, createSupabaseReminderStore, createTestTargetReader } from './store.ts';
import { createWebPushSender, type VapidConfig } from './webpush.ts';

const env = (name: string) => Deno.env.get(name);
const log = (line: string) => console.log('[send-reminders]', line);

/** The service role's store; a missing URL or key throws, which the handler answers with 500 or 503. */
function serviceStore() {
  const settings = readServerSettings(env);
  if (!settings.url || !settings.secretKey) throw new Error('SUPABASE_URL or the secret key is missing from the function environment.');
  return createSupabaseReminderStore(createServiceClient(settings.url, settings.secretKey));
}

function sender(vapid: VapidConfig) {
  return createWebPushSender(vapid, { fetch, nowMs: () => Date.now() });
}

const handler = createRemindersHandler({
  settings: () => readServerSettings(env),
  tick: async (vapid) => {
    const summary = await runTick({ store: serviceStore(), sender: sender(vapid), vapid, log }, Date.now());
    log(JSON.stringify(summary));
    return summary;
  },
  testTarget: (token, endpoint) => {
    const settings = readServerSettings(env);
    if (!settings.url || !settings.publishableKey) return Promise.reject(new TestTargetError('notSetUp'));
    return createTestTargetReader(settings.url, settings.publishableKey)(token, endpoint);
  },
  deliverTest: (vapid, target) => deliverTest({ sender: sender(vapid), vapid }, target),
  reportTest: (userId, report) => serviceStore().report(userId, null, null, [report]),
  limiter: createRateLimiter({ limit: 6, windowMs: 600_000 }),
  onError: (error) => console.error('[send-reminders]', error instanceof Error ? `${error.name}: ${error.message}` : 'error'),
});

Deno.serve(handler);
