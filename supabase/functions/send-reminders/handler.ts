/**
 * The send-reminders endpoint as a plain fetch handler. Runtime-agnostic: ./index.ts injects the
 * Deno pieces and server/remindersHandler.test.ts injects fakes.
 *
 * Two callers:
 * - pg_cron, every 5 minutes, with `X-Cron-Secret` (compared in constant time with CRON_SECRET): one run.
 * - the app's Send a test notification, with the user's token: push_test_target reads the device as
 *   that user (PostgREST checks the token), then one test goes to it. 6 tests per 10 minutes per device.
 *
 * Responses (JSON, with CORS headers for allowed origins):
 *   204 preflight · 405 not POST · 200 { ok: true, users, sent, skipped } for the cron, { ok: true } for a test
 *   400 bad_request · 401 notSignedIn / forbidden · 409 notSubscribed / keyMismatch · 410 gone
 *   429 rateLimited + Retry-After · 502 pushFailed · 503 notConfigured / upstream · 500 upstream
 */
import { corsHeaders, readBearer, type ListSetting, type RateLimiter } from '../estimate/auth.ts';
import { TestTargetError, type TickSummary } from './core.ts';
import type { DeliveryReport, PushTarget, VapidConfig } from './webpush.ts';

export interface RemindersHandlerDeps {
  /** Read on every request, so changed secrets apply without a redeploy. */
  settings: () => { cronSecret?: string; vapid: VapidConfig | null; allowedOrigins: ListSetting };
  tick: (vapid: VapidConfig) => Promise<TickSummary>;
  /** push_test_target as the caller; throws TestTargetError('notSignedIn' | 'notSetUp' | 'upstream'). */
  testTarget: (token: string, endpoint: string) => Promise<(PushTarget & { userId: string }) | null>;
  deliverTest: (vapid: VapidConfig, target: PushTarget) => Promise<DeliveryReport>;
  reportTest: (userId: string, report: DeliveryReport) => Promise<void>;
  /** createRateLimiter({ limit: 6, windowMs: 600_000 }), keyed by endpoint. */
  limiter: RateLimiter;
  onError?: (error: unknown) => void;
}

const encoder = new TextEncoder();
const MAX_ENDPOINT = 1000;

/** Equal strings, in time that depends on their length only. */
export function timingSafeEqualString(a: string, b: string): boolean {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createRemindersHandler(deps: RemindersHandlerDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    const { cronSecret, vapid, allowedOrigins } = deps.settings();
    const cors = corsHeaders(req.headers.get('origin'), allowedOrigins);
    const json = (body: unknown, status: number, extra: Record<string, string> = {}): Response =>
      new Response(JSON.stringify(body), { status, headers: { ...cors, ...extra, 'Content-Type': 'application/json' } });

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return json({ code: 'bad_request' }, 405, { Allow: 'POST, OPTIONS' });

    // The job.
    const secret = req.headers.get('x-cron-secret');
    if (secret !== null) {
      if (!cronSecret || !vapid) return json({ code: 'notConfigured' }, 503);
      if (!timingSafeEqualString(secret, cronSecret)) return json({ code: 'forbidden' }, 401);
      try {
        const summary = await deps.tick(vapid);
        return json({ ok: true, users: summary.users, sent: summary.sent, skipped: summary.skipped }, 200);
      } catch (error) {
        deps.onError?.(error);
        return json({ code: 'upstream' }, 500);
      }
    }

    // A test from the app.
    const token = readBearer(req);
    if (!token) return json({ code: 'notSignedIn' }, 401, { 'WWW-Authenticate': 'Bearer' });
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json({ code: 'bad_request' }, 400);
    }
    if (!isRecord(body) || body.action !== 'test' || typeof body.endpoint !== 'string' || body.endpoint === '' || body.endpoint.length > MAX_ENDPOINT) {
      return json({ code: 'bad_request' }, 400);
    }
    const endpoint = body.endpoint;
    if (!vapid) return json({ code: 'notConfigured' }, 503);
    const rate = deps.limiter.take(endpoint);
    if (!rate.ok) return json({ code: 'rateLimited' }, 429, { 'Retry-After': String(rate.retryAfterSeconds) });

    let target: (PushTarget & { userId: string }) | null;
    try {
      target = await deps.testTarget(token, endpoint);
    } catch (error) {
      if (error instanceof TestTargetError && error.code === 'notSignedIn') return json({ code: 'notSignedIn' }, 401, { 'WWW-Authenticate': 'Bearer' });
      if (error instanceof TestTargetError && error.code === 'notSetUp') return json({ code: 'notConfigured' }, 503);
      deps.onError?.(error);
      return json({ code: 'upstream' }, 503);
    }
    if (!target) return json({ code: 'notSubscribed' }, 409);
    if (target.vapidKey !== vapid.publicKey) return json({ code: 'keyMismatch' }, 409);

    const report = await deps.deliverTest(vapid, target);
    try {
      await deps.reportTest(target.userId, report);
    } catch (error) {
      // The test went (or not) either way; the device's status catches up on the next run.
      deps.onError?.(error);
    }
    if (report.outcome === 'ok') return json({ ok: true }, 200);
    if (report.outcome === 'gone') return json({ code: 'gone' }, 410);
    return json({ code: 'pushFailed', status: report.status ?? null }, 502);
  };
}
