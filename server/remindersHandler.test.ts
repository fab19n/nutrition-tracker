// @vitest-environment node
// The send-reminders endpoint: the cron call with its secret, and a test notification from the app.
import { describe, expect, it, vi } from 'vitest';
import { createRateLimiter } from '../supabase/functions/estimate/auth';
import { TestTargetError, type TickSummary } from '../supabase/functions/send-reminders/core';
import { createRemindersHandler, timingSafeEqualString, type RemindersHandlerDeps } from '../supabase/functions/send-reminders/handler';
import type { DeliveryReport, PushTarget, VapidConfig } from '../supabase/functions/send-reminders/webpush';

const URL_ = 'https://ref.supabase.co/functions/v1/send-reminders';
const APP = 'https://kira-makan.vercel.app';
const SECRET = 'c'.repeat(64);
const VAPID: VapidConfig = { publicKey: 'B-current-key', privateKey: 'private', subject: APP };
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/phone';
const TARGET = { userId: 'user-1', endpoint: ENDPOINT, p256dh: 'p', auth: 'a', vapidKey: VAPID.publicKey };
const SUMMARY: TickSummary = { users: 2, sent: 1, skipped: { quiet: 1 } };

function setup(patch: Partial<RemindersHandlerDeps> = {}, settings: Partial<ReturnType<RemindersHandlerDeps['settings']>> = {}) {
  let now = 0;
  const deps = {
    settings: () => ({ cronSecret: SECRET, vapid: VAPID, allowedOrigins: APP, ...settings }),
    tick: vi.fn(async (_vapid: VapidConfig) => SUMMARY),
    testTarget: vi.fn(async (_token: string, _endpoint: string): Promise<(PushTarget & { userId: string }) | null> => TARGET),
    deliverTest: vi.fn(async (_vapid: VapidConfig, target: PushTarget): Promise<DeliveryReport> => ({ endpoint: target.endpoint, outcome: 'ok', status: 201 })),
    reportTest: vi.fn(async (_userId: string, _report: DeliveryReport) => {}),
    limiter: createRateLimiter({ limit: 6, windowMs: 600_000, now: () => now }),
    onError: vi.fn(),
    ...patch,
  };
  const handle = createRemindersHandler(deps);
  return { deps, handle, advance: (ms: number) => (now += ms) };
}

function cron(secret = SECRET): Request {
  return new Request(URL_, { method: 'POST', headers: { 'X-Cron-Secret': secret, 'Content-Type': 'application/json' }, body: '{}' });
}

function test(body: unknown = { action: 'test', endpoint: ENDPOINT }, token: string | null = 'user-token'): Request {
  const headers: Record<string, string> = { Origin: APP, 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request(URL_, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
}

async function answer(res: Response): Promise<{ status: number; body: unknown }> {
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
}

describe('the cron call', () => {
  it('runs the job once with the right secret', async () => {
    const { deps, handle } = setup();
    expect(await answer(await handle(cron()))).toEqual({ status: 200, body: { ok: true, users: 2, sent: 1, skipped: { quiet: 1 } } });
    expect(deps.tick).toHaveBeenCalledTimes(1);
    expect(deps.tick).toHaveBeenCalledWith(VAPID);
  });

  it('refuses a wrong secret without running anything', async () => {
    const { deps, handle } = setup();
    expect(await answer(await handle(cron('d'.repeat(64))))).toEqual({ status: 401, body: { code: 'forbidden' } });
    expect(await answer(await handle(cron('short')))).toEqual({ status: 401, body: { code: 'forbidden' } });
    expect(deps.tick).not.toHaveBeenCalled();
  });

  it('says it is not configured without CRON_SECRET or the VAPID keys', async () => {
    expect(await answer(await setup({}, { cronSecret: undefined }).handle(cron()))).toEqual({ status: 503, body: { code: 'notConfigured' } });
    expect(await answer(await setup({}, { vapid: null }).handle(cron()))).toEqual({ status: 503, body: { code: 'notConfigured' } });
  });

  it('answers 500 when the run fails', async () => {
    const { deps, handle } = setup({ tick: vi.fn(async () => Promise.reject(new Error('push_due_users failed (57014)'))) });
    expect(await answer(await handle(cron()))).toEqual({ status: 500, body: { code: 'upstream' } });
    expect(deps.onError).toHaveBeenCalled();
  });
});

describe('a test from the app', () => {
  it('answers a preflight from the app with CORS, and refuses other methods', async () => {
    const { handle } = setup();
    const preflight = await handle(new Request(URL_, { method: 'OPTIONS', headers: { Origin: APP } }));
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe(APP);
    const get = await handle(new Request(URL_, { method: 'GET' }));
    expect(get.status).toBe(405);
    expect(get.headers.get('Allow')).toBe('POST, OPTIONS');
    expect(await get.json()).toEqual({ code: 'bad_request' });
  });

  it('sends one test to the caller’s own device', async () => {
    const { deps, handle } = setup();
    const res = await handle(test());
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(APP);
    expect(await answer(res)).toEqual({ status: 200, body: { ok: true } });
    expect(deps.testTarget).toHaveBeenCalledWith('user-token', ENDPOINT);
    expect(deps.deliverTest).toHaveBeenCalledWith(VAPID, TARGET);
    expect(deps.reportTest).toHaveBeenCalledWith('user-1', { endpoint: ENDPOINT, outcome: 'ok', status: 201 });
  });

  it('needs a sign-in and a test body', async () => {
    const { deps, handle } = setup();
    expect(await answer(await handle(test(undefined, null)))).toEqual({ status: 401, body: { code: 'notSignedIn' } });
    expect(await answer(await handle(test('not json')))).toEqual({ status: 400, body: { code: 'bad_request' } });
    expect(await answer(await handle(test({ action: 'send', endpoint: ENDPOINT })))).toEqual({ status: 400, body: { code: 'bad_request' } });
    expect(await answer(await handle(test({ action: 'test', endpoint: 'x'.repeat(1001) })))).toEqual({ status: 400, body: { code: 'bad_request' } });
    expect(deps.testTarget).not.toHaveBeenCalled();
    expect(await answer(await setup({}, { vapid: null }).handle(test()))).toEqual({ status: 503, body: { code: 'notConfigured' } });
  });

  it.each([
    ['notSignedIn', 401, 'notSignedIn'],
    ['notSetUp', 503, 'notConfigured'],
    ['upstream', 503, 'upstream'],
  ] as const)('maps a %s reading the device to %i', async (code, status, answerCode) => {
    const { deps, handle } = setup({ testTarget: vi.fn(async () => Promise.reject(new TestTargetError(code))) });
    expect(await answer(await handle(test()))).toEqual({ status, body: { code: answerCode } });
    expect(deps.deliverTest).not.toHaveBeenCalled();
  });

  it('says when the account has no such device, or it has another key', async () => {
    expect(await answer(await setup({ testTarget: vi.fn(async () => null) }).handle(test()))).toEqual({ status: 409, body: { code: 'notSubscribed' } });
    const old = setup({ testTarget: vi.fn(async () => ({ ...TARGET, vapidKey: 'B-old-key' })) });
    expect(await answer(await old.handle(test()))).toEqual({ status: 409, body: { code: 'keyMismatch' } });
    expect(old.deps.deliverTest).not.toHaveBeenCalled();
  });

  it('passes on what the push service said', async () => {
    const gone = setup({ deliverTest: vi.fn(async () => ({ endpoint: ENDPOINT, outcome: 'gone' as const, status: 410 })) });
    expect(await answer(await gone.handle(test()))).toEqual({ status: 410, body: { code: 'gone' } });
    expect(gone.deps.reportTest).toHaveBeenCalledWith('user-1', { endpoint: ENDPOINT, outcome: 'gone', status: 410 });
    const failed = setup({ deliverTest: vi.fn(async () => ({ endpoint: ENDPOINT, outcome: 'failed' as const, error: 'http 403', status: 403 })) });
    expect(await answer(await failed.handle(test()))).toEqual({ status: 502, body: { code: 'pushFailed', status: 403 } });
  });

  it('allows 6 tests in 10 minutes for a device', async () => {
    const { handle, advance } = setup();
    for (let i = 0; i < 6; i++) expect((await handle(test())).status).toBe(200);
    const seventh = await handle(test());
    expect(seventh.status).toBe(429);
    expect(Number(seventh.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(await seventh.json()).toEqual({ code: 'rateLimited' });
    advance(600_000);
    expect((await handle(test())).status).toBe(200);
  });
});

describe('timingSafeEqualString', () => {
  it('compares whole strings', () => {
    expect(timingSafeEqualString(SECRET, SECRET)).toBe(true);
    expect(timingSafeEqualString(SECRET, `${SECRET.slice(0, -1)}d`)).toBe(false);
    expect(timingSafeEqualString(SECRET, SECRET.slice(0, -1))).toBe(false);
    expect(timingSafeEqualString('', SECRET)).toBe(false);
    expect(timingSafeEqualString('', '')).toBe(true);
  });
});
