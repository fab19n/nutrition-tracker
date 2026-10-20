import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSessionForTests } from '@/auth/session';
import { getSupabase, resetSupabaseForTests, storageKeyFor } from '@/auth/supabase';
import type { SyncErrorKind } from '@/db/syncTypes';
import { isSyncError } from './errors';
import { createSupabaseRemote, type PushChange, type RemoteCtx, type SyncRemote } from './remote';
import { createFakeServer, FakeRpcError, type FakeServer, type SyncFn } from './testing/fakeServer';

/*
 * The real supabase-js client over a stubbed fetch, as in src/auth/session.realClient.test.ts:
 * what goes over the wire, and what each answer turns into. The stub serves the in-memory fake of
 * supabase/sync.sql, so replies have the shapes Postgres sends. Nothing reaches the network.
 */
const SUPABASE_URL = 'https://abcdefgh.supabase.co';
const KEY = 'sb_publishable_test_key';
const USER = 'user-1';
const EMAIL = 'fabian@example.com';
const TOKEN = 'access-token-1';
const RPC_PATH = /^\/rest\/v1\/rpc\/(sync_[a-z]+)$/;
const DATASET = '6f1c2a0e-8f8e-4c1e-9d55-3f0e7b2a9c11';

interface SentRequest {
  url: URL;
  method: string;
  headers: Headers;
  body: unknown;
  signal: AbortSignal | null;
}

type Answer = (request: SentRequest) => Response | Promise<Response>;

/** The tokens the stub server knows, and whose they are. */
const USERS: Record<string, string> = { [`Bearer ${TOKEN}`]: USER, 'Bearer access-token-2': USER };

let server: FakeServer;
let requests: SentRequest[];
let answer: Answer;
let authAnswer: Answer;
let remote: SyncRemote;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** A PostgREST error body. */
function pgError(code: string, message: string): Record<string, unknown> {
  return { code, message, details: null, hint: null };
}

/** The fake server's answer as PostgREST would send it: the token's user, then the reply or the error. */
const serve: Answer = (request) => {
  const fn = RPC_PATH.exec(request.url.pathname)?.[1] as SyncFn;
  const userId = USERS[request.headers.get('Authorization') ?? ''] ?? null;
  const args = typeof request.body === 'object' && request.body !== null ? (request.body as Record<string, unknown>) : {};
  try {
    return json(200, server.call(userId, fn, args));
  } catch (error) {
    if (error instanceof FakeRpcError) return json(error.status, error.toJSON());
    throw error;
  }
};

/** Never answers; fails the way fetch does when its signal aborts. */
const hang: Answer = ({ signal }) =>
  new Promise<Response>((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(signal.reason));
  });

function rpcRequests(): SentRequest[] {
  return requests.filter((r) => RPC_PATH.test(r.url.pathname));
}

function storeSession(opts: { token?: string; expiresAt?: number } = {}): void {
  window.localStorage.setItem(
    storageKeyFor(SUPABASE_URL),
    JSON.stringify({
      access_token: opts.token ?? TOKEN,
      refresh_token: 'refresh-token',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: opts.expiresAt ?? Math.floor(Date.now() / 1000) + 3600,
      user: { id: USER, email: EMAIL, aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '' },
    }),
  );
}

function ctx(userId = USER, signal = new AbortController().signal): RemoteCtx {
  return { userId, signal };
}

const weigh: PushChange = {
  t: 'weights',
  k: 'w1',
  del: false,
  data: { id: 'w1', kg: 70 },
  base: null,
  at: '2026-10-16T11:00:00.000Z',
  n: 'n1',
};

/** Settles the promise while auth-js backs off between refresh tries (up to 30 s). */
async function settle<T>(promise: Promise<T>): Promise<{ value?: T; error?: unknown }> {
  let done = false;
  const outcome = promise.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  void outcome.then(() => (done = true));
  for (let ms = 0; !done && ms < 40_000; ms += 500) await vi.advanceTimersByTimeAsync(500);
  return outcome;
}

beforeAll(async () => {
  // Loaded once up front, so loading it never races a fake clock.
  await import('@supabase/supabase-js');
});

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', SUPABASE_URL);
  vi.stubEnv('VITE_SUPABASE_KEY', KEY);
  // No BroadcastChannel: it would keep the test worker alive.
  vi.stubGlobal('BroadcastChannel', undefined);
  server = createFakeServer();
  requests = [];
  answer = serve;
  authAnswer = () => Promise.reject(new TypeError('Failed to fetch'));
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      const request = { url, method: init?.method ?? 'GET', headers: new Headers(init?.headers), body, signal: init?.signal ?? null };
      requests.push(request);
      return RPC_PATH.test(url.pathname) ? answer(request) : authAnswer(request);
    }),
  );
  resetSessionForTests();
  resetSupabaseForTests();
  storeSession();
  remote = createSupabaseRemote();
});

afterEach(async () => {
  const client = await getSupabase().catch(() => null);
  await client?.auth.dispose();
  resetSessionForTests();
  resetSupabaseForTests();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  window.localStorage.clear();
});

describe('the requests', () => {
  it('posts to the sync function with the project key and the signed-in token', async () => {
    const summary = await remote.hello(ctx());

    expect(summary).toEqual({ dataset: server.dataset(USER), head: 0, counts: {}, lastChangeAt: null });
    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request?.method).toBe('POST');
    expect(request?.url.href).toBe(`${SUPABASE_URL}/rest/v1/rpc/sync_hello`);
    expect(request?.headers.get('apikey')).toBe(KEY);
    expect(request?.headers.get('Authorization')).toBe(`Bearer ${TOKEN}`);
    expect(request?.body).toEqual({});
  });

  it('pushes, pulls and lists keys with the arguments sync.sql takes', async () => {
    const { dataset } = await remote.hello(ctx());
    const demo: PushChange = { ...weigh, t: 'profile', k: 'me', data: { id: 'me', demoMode: true }, n: 'n2' };

    const before = Date.now();
    const first = await remote.push(ctx(), dataset, 'device-a', [weigh, demo]);
    const pushed = rpcRequests().at(-1);
    expect(pushed?.url.pathname).toBe('/rest/v1/rpc/sync_push');
    expect(pushed?.body).toEqual({ p_dataset: dataset, p_device: 'device-a', p_sent_at: expect.any(String), p_changes: [weigh, demo] });
    const sentAt = Date.parse(String((pushed?.body as { p_sent_at?: unknown }).p_sent_at));
    expect(sentAt).toBeGreaterThanOrEqual(before);
    expect(sentAt).toBeLessThanOrEqual(Date.now());
    expect(first).toEqual({ dataset, prevHead: 0, head: 1, results: [{ i: 0, s: 'ok', rev: 1 }, { i: 1, s: 'invalid' }] });

    // An older edit from another device loses and gets the winner back.
    const older = { ...weigh, data: { id: 'w1', kg: 71 }, at: '2026-10-15T11:00:00.000Z', n: 'n3' };
    expect(await remote.push(ctx(), dataset, 'device-b', [older])).toEqual({
      dataset,
      prevHead: 1,
      head: 1,
      results: [{ i: 0, s: 'lost', rev: 1, del: false, data: { id: 'w1', kg: 70 } }],
    });

    await remote.push(ctx(), dataset, 'device-a', [{ ...weigh, del: true, data: null, base: 1, n: 'n4' }]);
    await remote.push(ctx(), dataset, 'device-a', [{ ...weigh, k: 'w2', data: { id: 'w2', kg: 69 }, n: 'n5' }]);

    const page = await remote.pull(ctx(), 1, 500);
    expect(rpcRequests().at(-1)?.body).toEqual({ p_after: 1, p_limit: 500 });
    expect(page).toEqual({
      dataset,
      head: 3,
      rows: [
        { t: 'weights', k: 'w1', rev: 2, del: true, data: null, at: expect.stringMatching(/\+00:00$/) },
        { t: 'weights', k: 'w2', rev: 3, del: false, data: { id: 'w2', kg: 69 }, at: expect.stringMatching(/\+00:00$/) },
      ],
    });

    // On the wire each key is [t, k, rev].
    expect(await remote.keys(ctx())).toEqual({ dataset, head: 3, keys: [{ t: 'weights', k: 'w2', rev: 3 }] });
    expect(rpcRequests().at(-1)?.body).toEqual({});

    expect(await remote.hello(ctx())).toEqual({ dataset, head: 3, counts: { weights: 1 }, lastChangeAt: expect.stringMatching(/\+00:00$/) });
  });

  it('sends the token getAuth checked, refreshed first when it runs out within a minute', async () => {
    storeSession({ expiresAt: Math.floor(Date.now() / 1000) + 30 });
    authAnswer = ({ url }) =>
      url.pathname === '/auth/v1/token'
        ? json(200, {
            access_token: 'access-token-2',
            refresh_token: 'refresh-token-2',
            token_type: 'bearer',
            expires_in: 3600,
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            user: { id: USER, email: EMAIL, aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '' },
          })
        : Promise.reject(new TypeError('Failed to fetch'));

    await remote.hello(ctx());

    expect(requests.some((r) => r.url.pathname === '/auth/v1/token')).toBe(true);
    expect(rpcRequests().map((r) => r.headers.get('Authorization'))).toEqual(['Bearer access-token-2']);
  });

  it('accepts a pull before the account has a dataset', async () => {
    answer = () => json(200, { dataset: null, head: 0, rows: [] });
    expect(await remote.pull(ctx(), 0, 500)).toEqual({ dataset: null, head: 0, rows: [] });
  });
});

describe('replies this version cannot read', () => {
  const row = { t: 'weights', k: 'w1', rev: 1, del: false, data: { id: 'w1' }, at: '2026-10-16T11:00:00+00:00' };
  const cases: [string, (r: SyncRemote) => Promise<unknown>, unknown][] = [
    ['hello: not an object', (r) => r.hello(ctx()), [1]],
    ['hello: no dataset', (r) => r.hello(ctx()), { head: 0, counts: {}, lastChangeAt: null }],
    ['hello: a negative head', (r) => r.hello(ctx()), { dataset: DATASET, head: -1, counts: {}, lastChangeAt: null }],
    ['hello: a count as text', (r) => r.hello(ctx()), { dataset: DATASET, head: 1, counts: { meals: '1' }, lastChangeAt: null }],
    ['hello: no lastChangeAt', (r) => r.hello(ctx()), { dataset: DATASET, head: 0, counts: {} }],
    ['pull: no rows', (r) => r.pull(ctx(), 0, 500), { dataset: DATASET, head: 0 }],
    ['pull: a rev as text', (r) => r.pull(ctx(), 0, 500), { dataset: DATASET, head: 1, rows: [{ ...row, rev: '1' }] }],
    ['pull: data as an array', (r) => r.pull(ctx(), 0, 500), { dataset: DATASET, head: 1, rows: [{ ...row, data: [] }] }],
    ['pull: no del flag', (r) => r.pull(ctx(), 0, 500), { dataset: DATASET, head: 1, rows: [{ ...row, del: undefined }] }],
    ['pull: rows out of order', (r) => r.pull(ctx(), 0, 500), { dataset: DATASET, head: 2, rows: [{ ...row, rev: 2 }, row] }],
    ['push: an unknown result', (r) => r.push(ctx(), DATASET, 'device-a', [weigh]), { dataset: DATASET, prevHead: 0, head: 1, results: [{ i: 0, s: 'maybe', rev: 1 }] }],
    ['push: a result for a change never sent', (r) => r.push(ctx(), DATASET, 'device-a', [weigh]), { dataset: DATASET, prevHead: 0, head: 1, results: [{ i: 1, s: 'ok', rev: 1 }] }],
    ['push: lost without the winner', (r) => r.push(ctx(), DATASET, 'device-a', [weigh]), { dataset: DATASET, prevHead: 0, head: 0, results: [{ i: 0, s: 'lost', rev: 1 }] }],
    ['push: a head below prevHead', (r) => r.push(ctx(), DATASET, 'device-a', [weigh]), { dataset: DATASET, prevHead: 2, head: 1, results: [] }],
    ['keys: a key as an object', (r) => r.keys(ctx()), { dataset: DATASET, head: 1, keys: [{ t: 'weights', k: 'w1', rev: 1 }] }],
    ['keys: no dataset', (r) => r.keys(ctx()), { dataset: null, head: 0, keys: [] }],
  ];

  it.each(cases)('%s', async (_label, run, body) => {
    answer = () => json(200, body);
    await expect(run(remote)).rejects.toMatchObject({ name: 'SyncError', kind: 'rejected' });
  });

  it('a body that is not JSON', async () => {
    answer = () => new Response('<html>Bad gateway</html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
    await expect(remote.hello(ctx())).rejects.toMatchObject({ kind: 'rejected' });
  });
});

describe('failures', () => {
  const cases: [string, Answer, SyncErrorKind][] = [
    ['no answer (status 0)', () => Promise.reject(new TypeError('Failed to fetch')), 'unreachable'],
    ['401 PT401', () => json(401, pgError('PT401', 'Sign in to sync')), 'needsSignIn'],
    ['401 PGRST303', () => json(401, pgError('PGRST303', 'JWT expired')), 'needsSignIn'],
    ['401 42501 (anonymous)', () => json(401, pgError('42501', 'permission denied for function sync_hello')), 'needsSignIn'],
    ['404 PGRST202', () => json(404, pgError('PGRST202', 'Could not find the function public.sync_hello without parameters')), 'notSetUp'],
    ['403 42501', () => json(403, pgError('42501', 'permission denied for function sync_hello')), 'notSetUp'],
    ['409 PT409', () => json(409, pgError('PT409', 'The synced copy in this account changed')), 'cloudReset'],
    ['429', () => json(429, { message: 'Too many requests' }), 'unavailable'],
    ['503', () => json(503, pgError('PGRST002', 'Could not query the database for the schema cache. Retrying.')), 'unavailable'],
    ['540 (project paused)', () => new Response('', { status: 540 }), 'unavailable'],
    ['400 PT400', () => json(400, pgError('PT400', 'Send at most 200 changes at a time')), 'rejected'],
    ['400 22P02', () => json(400, pgError('22P02', 'invalid input syntax for type uuid: "x"')), 'rejected'],
    ['418', () => json(418, { message: "I'm a teapot" }), 'failed'],
  ];

  it.each(cases)('%s', async (_label, failure, kind) => {
    answer = failure;
    const error: unknown = await remote.hello(ctx()).catch((thrown: unknown) => thrown);
    expect(isSyncError(error, kind)).toBe(true);
    expect(rpcRequests()).toHaveLength(1); // a call is never retried here: the engine decides
  });

  it('reads no answer as offline when the browser says so', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    answer = () => Promise.reject(new TypeError('Failed to fetch'));
    await expect(remote.hello(ctx())).rejects.toMatchObject({ kind: 'offline' });
  });

  it('maps a failed push through the server fake', async () => {
    const { dataset } = await remote.hello(ctx());
    await expect(remote.push(ctx(), DATASET, 'device-a', [weigh])).rejects.toMatchObject({ kind: 'cloudReset' });
    await expect(remote.push(ctx(), dataset, 'not a device', [weigh])).rejects.toMatchObject({ kind: 'rejected' });
  });
});

describe('calls that never leave the phone', () => {
  it('sends nothing when signed out', async () => {
    window.localStorage.clear();
    await expect(remote.hello(ctx())).rejects.toMatchObject({ kind: 'needsSignIn' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends nothing for another account than the link', async () => {
    await expect(remote.pull(ctx('user-2'), 0, 500)).rejects.toMatchObject({ kind: 'aborted' });
    expect(rpcRequests()).toHaveLength(0);
  });

  it('sends nothing once the caller has aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(remote.hello(ctx(USER, controller.signal))).rejects.toMatchObject({ kind: 'aborted' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reads a session that cannot be checked as a connection problem', async () => {
    const now = Date.UTC(2026, 9, 16, 11, 10);
    vi.useFakeTimers({ now, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    // The stored token ran out 10 minutes ago, and the refresh can't reach Supabase.
    storeSession({ expiresAt: Math.floor(now / 1000) - 600 });

    const { error } = await settle(remote.hello(ctx()));

    expect(isSyncError(error, 'unreachable')).toBe(true);
    expect(rpcRequests()).toHaveLength(0);
  });
});

describe('cancelling', () => {
  it('drops the call when the caller aborts mid-flight', async () => {
    answer = hang;
    const controller = new AbortController();
    const call = remote.hello(ctx(USER, controller.signal));
    await vi.waitFor(() => expect(rpcRequests()).toHaveLength(1));

    controller.abort();

    await expect(call).rejects.toMatchObject({ kind: 'aborted' });
  });

  it('gives up after 20 s as unreachable', async () => {
    await remote.hello(ctx()); // the client is loaded and the session read before the clock is faked
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    answer = hang;
    const call = remote.hello(ctx()).catch((thrown: unknown) => thrown);
    // Not vi.waitFor: under fake timers it moves the clock on each try.
    for (let tries = 0; rpcRequests().length < 2 && tries < 100; tries++) await vi.advanceTimersByTimeAsync(0);
    expect(rpcRequests()).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(19_999);
    expect(rpcRequests()[1]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    expect(isSyncError(await call, 'unreachable')).toBe(true);
  });
});
