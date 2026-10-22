import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSessionForTests } from '@/auth/session';
import { getSupabase, resetSupabaseForTests, storageKeyFor } from '@/auth/supabase';
import type { SyncErrorKind } from '@/db/syncTypes';
import { isSyncError } from '@/sync/errors';
import { createSupabasePushRemote, type PushRemote } from './remote';

/*
 * The real supabase-js client over a stubbed fetch, as in src/sync/remote.test.ts: what goes over the
 * wire for the push_* functions and the test call, and what each answer turns into. No network.
 */
const SUPABASE_URL = 'https://abcdefgh.supabase.co';
const KEY = 'sb_publishable_test_key';
const USER = 'user-1';
const TOKEN = 'access-token-1';
const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/device-1';
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/send-reminders`;

interface SentRequest {
  url: URL;
  method: string;
  headers: Headers;
  body: unknown;
}

type Answer = (request: SentRequest) => Response | Promise<Response>;

let requests: SentRequest[];
let answer: Answer;
let remote: PushRemote;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function storeSession(): void {
  window.localStorage.setItem(
    storageKeyFor(SUPABASE_URL),
    JSON.stringify({
      access_token: TOKEN,
      refresh_token: 'refresh-token',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: USER, email: 'you@example.com', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '' },
    }),
  );
}

async function kindOf(promise: Promise<unknown>): Promise<SyncErrorKind | 'resolved'> {
  try {
    await promise;
    return 'resolved';
  } catch (error) {
    if (isSyncError(error)) return error.kind;
    throw error;
  }
}

beforeAll(async () => {
  await import('@supabase/supabase-js');
});

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', SUPABASE_URL);
  vi.stubEnv('VITE_SUPABASE_KEY', KEY);
  vi.stubGlobal('BroadcastChannel', undefined);
  requests = [];
  answer = () => json(200, { saved: true });
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      const request = { url, method: init?.method ?? 'GET', headers: new Headers(init?.headers), body };
      requests.push(request);
      return answer(request);
    }),
  );
  resetSessionForTests();
  resetSupabaseForTests();
  storeSession();
  remote = createSupabasePushRemote();
});

afterEach(async () => {
  const client = await getSupabase().catch(() => null);
  await client?.auth.dispose();
  resetSessionForTests();
  resetSupabaseForTests();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  window.localStorage.clear();
});

describe('the push functions', () => {
  it('saves a subscription with the arguments push.sql takes and the signed-in token', async () => {
    await remote.subscribe({ endpoint: ENDPOINT, p256dh: 'p256', auth: 'auth' }, { vapidKey: 'B-key', label: 'Android', replaces: 'https://old' });
    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request?.method).toBe('POST');
    expect(request?.url.href).toBe(`${SUPABASE_URL}/rest/v1/rpc/push_subscribe`);
    expect(request?.headers.get('apikey')).toBe(KEY);
    expect(request?.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
    expect(request?.body).toEqual({ p_endpoint: ENDPOINT, p_p256dh: 'p256', p_auth: 'auth', p_vapid_key: 'B-key', p_label: 'Android', p_replaces: 'https://old' });

    await remote.subscribe({ endpoint: ENDPOINT, p256dh: 'p256', auth: 'auth' }, { vapidKey: 'B-key' });
    expect(requests[1]?.body).toMatchObject({ p_label: null, p_replaces: null });
  });

  it('removes a subscription and reads the device', async () => {
    answer = (r) => (r.url.pathname.endsWith('push_unsubscribe') ? json(200, { removed: 1 }) : json(200, { found: true, failures: 2, lastOkAt: '2026-10-22T01:00:00Z', lastError: 'http 503', vapidKey: 'B-key', createdAt: 'x' }));
    await remote.unsubscribe(ENDPOINT);
    expect(await remote.device(ENDPOINT)).toEqual({ found: true, failures: 2, lastOkAt: '2026-10-22T01:00:00Z', lastError: 'http 503', vapidKey: 'B-key' });
    expect(requests.map((r) => [r.url.pathname, r.body])).toEqual([
      ['/rest/v1/rpc/push_unsubscribe', { p_endpoint: ENDPOINT }],
      ['/rest/v1/rpc/push_device', { p_endpoint: ENDPOINT }],
    ]);
    answer = () => json(200, { found: false });
    expect(await remote.device(ENDPOINT)).toEqual({ found: false, failures: 0 });
  });

  it('refuses replies of the wrong shape', async () => {
    answer = () => json(200, { saved: false });
    expect(await kindOf(remote.subscribe({ endpoint: ENDPOINT, p256dh: 'p', auth: 'a' }, { vapidKey: 'B' }))).toBe('rejected');
    answer = () => json(200, { removed: 'one' });
    expect(await kindOf(remote.unsubscribe(ENDPOINT))).toBe('rejected');
    answer = () => json(200, { found: true, failures: -1 });
    expect(await kindOf(remote.device(ENDPOINT))).toBe('rejected');
    answer = () => json(200, ['x']);
    expect(await kindOf(remote.device(ENDPOINT))).toBe('rejected');
  });

  it('maps failures as sync does: push.sql missing is notSetUp, a refused token needsSignIn', async () => {
    answer = () => json(404, { code: 'PGRST202', message: 'Could not find the function public.push_subscribe', details: null, hint: null });
    expect(await kindOf(remote.subscribe({ endpoint: ENDPOINT, p256dh: 'p', auth: 'a' }, { vapidKey: 'B' }))).toBe('notSetUp');
    answer = () => json(401, { code: 'PGRST301', message: 'JWT expired', details: null, hint: null });
    expect(await kindOf(remote.device(ENDPOINT))).toBe('needsSignIn');
    answer = () => json(400, { code: 'PT400', message: 'Not a push subscription', details: null, hint: null });
    expect(await kindOf(remote.subscribe({ endpoint: ENDPOINT, p256dh: 'p', auth: 'a' }, { vapidKey: 'B' }))).toBe('rejected');
    answer = () => json(503, { code: '', message: 'unavailable', details: null, hint: null });
    expect(await kindOf(remote.unsubscribe(ENDPOINT))).toBe('unavailable');
  });

  it('needs a sign-in', async () => {
    window.localStorage.clear();
    resetSessionForTests();
    resetSupabaseForTests();
    expect(await kindOf(remote.device(ENDPOINT))).toBe('needsSignIn');
    expect(requests.filter((r) => r.url.pathname.startsWith('/rest/'))).toHaveLength(0);
  });
});

describe('test', () => {
  it('posts the test to the function with the token and the project key', async () => {
    answer = () => json(200, { ok: true });
    expect(await remote.test(ENDPOINT)).toEqual({ ok: true });
    const [request] = requests;
    expect(request?.url.href).toBe(FUNCTION_URL);
    expect(request?.method).toBe('POST');
    expect(request?.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
    expect(request?.headers.get('apikey')).toBe(KEY);
    expect(request?.headers.get('Content-Type')).toBe('application/json');
    expect(request?.body).toEqual({ action: 'test', endpoint: ENDPOINT });
  });

  it.each([
    [401, { code: 'notSignedIn' }, 'needsSignIn'],
    [404, { code: 'NOT_FOUND', message: 'Requested function was not found' }, 'notSetUp'],
    [409, { code: 'notSubscribed' }, 'notSubscribed'],
    [409, { code: 'keyMismatch' }, 'keyMismatch'],
    [410, { code: 'gone' }, 'gone'],
    [429, { code: 'rateLimited' }, 'rateLimited'],
    [502, { code: 'pushFailed', status: 403 }, 'pushFailed'],
    [503, { code: 'notConfigured' }, 'notSetUp'],
    [503, { code: 'upstream' }, 'unavailable'],
    [500, { code: 'upstream' }, 'unavailable'],
    [400, { code: 'bad_request' }, 'rejected'],
  ])('maps %i %o to %s', async (status, body, kind) => {
    answer = () => json(status, body);
    expect(await remote.test(ENDPOINT)).toEqual({ ok: false, kind });
  });

  it('says offline or unreachable when nothing answers', async () => {
    answer = () => Promise.reject(new TypeError('Failed to fetch'));
    expect(await remote.test(ENDPOINT)).toEqual({ ok: false, kind: 'unreachable' });
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect(await remote.test(ENDPOINT)).toEqual({ ok: false, kind: 'offline' });
  });

  it('never throws without a sign-in', async () => {
    window.localStorage.clear();
    resetSessionForTests();
    resetSupabaseForTests();
    expect(await remote.test(ENDPOINT)).toEqual({ ok: false, kind: 'needsSignIn' });
  });
});
