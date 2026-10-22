// @vitest-environment node
// The reminder job's database calls with a real supabase-js client and a fake fetch standing in for
// PostgREST: what goes over the wire, and what each answer turns into.
import { describe, expect, it, vi } from 'vitest';
import { readServerSettings, secretKeyFromEnv } from '../supabase/functions/send-reminders/config';
import { TestTargetError } from '../supabase/functions/send-reminders/core';
import { createServiceClient, createSupabaseReminderStore, createTestTargetReader } from '../supabase/functions/send-reminders/store';

const PROJECT = 'https://ref.supabase.co';
const SECRET = 'sb_secret_test_key';
const PUBLISHABLE = 'sb_publishable_test_key';

interface Sent {
  path: string;
  method: string;
  headers: Headers;
  body: unknown;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function server(answer: (request: Sent) => Response) {
  const sent: Sent[] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const request = { path: url.pathname, method: init?.method ?? 'GET', headers: new Headers(init?.headers), body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined };
    sent.push(request);
    return answer(request);
  });
  return { sent, fetch: fetchMock as unknown as typeof fetch };
}

describe('createSupabaseReminderStore', () => {
  it('calls each push function with the secret key and the exact argument names', async () => {
    const replies: Record<string, unknown> = {
      '/rest/v1/rpc/push_due_users': ['u1', 'u2', 7],
      '/rest/v1/rpc/push_context': { profile: null, days: [] },
      '/rest/v1/rpc/push_claim': true,
      '/rest/v1/rpc/push_release': null,
      '/rest/v1/rpc/push_report': null,
    };
    const { sent, fetch } = server((r) => (r.path in replies ? json(replies[r.path]) : json({ code: 'PGRST202' }, 404)));
    const store = createSupabaseReminderStore(createServiceClient(PROJECT, SECRET, fetch));

    expect(await store.dueUsers()).toEqual(['u1', 'u2']);
    expect(await store.context('u1', '2026-09-16')).toEqual({ profile: null, days: [] });
    expect(await store.claim('u1', 'checkIn', '2026-10-22')).toBe(true);
    await store.release('u1', 'checkIn', '2026-10-22');
    await store.report('u1', 'gap', '2026-10-22', [
      { endpoint: 'https://push/1', outcome: 'ok', status: 201 },
      { endpoint: 'https://push/2', outcome: 'failed', error: 'http 503', transient: true },
    ]);
    await store.report('u1', null, null, [{ endpoint: 'https://push/3', outcome: 'skipped', error: 'oldKey' }]);

    expect(sent.map((r) => [r.method, r.path, r.body])).toEqual([
      ['POST', '/rest/v1/rpc/push_due_users', {}],
      ['POST', '/rest/v1/rpc/push_context', { p_user: 'u1', p_from: '2026-09-16' }],
      ['POST', '/rest/v1/rpc/push_claim', { p_user: 'u1', p_kind: 'checkIn', p_date: '2026-10-22' }],
      ['POST', '/rest/v1/rpc/push_release', { p_user: 'u1', p_kind: 'checkIn', p_date: '2026-10-22' }],
      [
        'POST',
        '/rest/v1/rpc/push_report',
        {
          p_user: 'u1',
          p_kind: 'gap',
          p_date: '2026-10-22',
          p_results: [
            { endpoint: 'https://push/1', outcome: 'ok', error: null },
            { endpoint: 'https://push/2', outcome: 'failed', error: 'http 503' },
          ],
        },
      ],
      ['POST', '/rest/v1/rpc/push_report', { p_user: 'u1', p_kind: null, p_date: null, p_results: [{ endpoint: 'https://push/3', outcome: 'skipped', error: 'oldKey' }] }],
    ]);
    for (const request of sent) {
      expect(request.headers.get('apikey')).toBe(SECRET);
      expect(request.headers.get('Authorization')).toBe(`Bearer ${SECRET}`);
    }
  });

  it('reads a claim another run made as false', async () => {
    const { fetch } = server(() => json(false));
    expect(await createSupabaseReminderStore(createServiceClient(PROJECT, SECRET, fetch)).claim('u1', 'gap', '2026-10-22')).toBe(false);
  });

  it('throws on an error reply, with the code and no values', async () => {
    const { fetch } = server(() => json({ code: '42883', message: 'function public.push_context(uuid, date) does not exist', details: null, hint: null }, 404));
    const store = createSupabaseReminderStore(createServiceClient(PROJECT, SECRET, fetch));
    await expect(store.context('u1', '2026-09-16')).rejects.toThrow('push_context failed (42883)');
    await expect(store.dueUsers()).rejects.toThrow('push_due_users failed');
    await expect(store.claim('u1', 'gap', '2026-10-22')).rejects.toThrow();
    await expect(store.release('u1', 'gap', '2026-10-22')).rejects.toThrow();
    await expect(store.report('u1', null, null, [])).rejects.toThrow();
  });
});

describe('createTestTargetReader', () => {
  const ROW = { userId: 'user-1', endpoint: 'https://push/1', p256dh: 'p', auth: 'a', vapidKey: 'B-key' };

  it("reads the caller's device with the caller's token", async () => {
    const { sent, fetch } = server(() => json(ROW));
    expect(await createTestTargetReader(PROJECT, PUBLISHABLE, fetch)('user-token', 'https://push/1')).toEqual(ROW);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.path).toBe('/rest/v1/rpc/push_test_target');
    expect(sent[0]?.body).toEqual({ p_endpoint: 'https://push/1' });
    expect(sent[0]?.headers.get('apikey')).toBe(PUBLISHABLE);
    expect(sent[0]?.headers.get('Authorization')).toBe('Bearer user-token');
  });

  it('is null when the account has no such device', async () => {
    const { fetch } = server(() => json(null));
    expect(await createTestTargetReader(PROJECT, PUBLISHABLE, fetch)('user-token', 'https://push/1')).toBeNull();
  });

  it.each([
    [401, { code: 'PGRST301', message: 'JWT expired' }, 'notSignedIn'],
    [400, { code: 'PT401', message: 'Sign in to sync' }, 'notSignedIn'],
    [404, { code: 'PGRST202', message: 'Could not find the function' }, 'notSetUp'],
    [500, { code: 'XX000', message: 'boom' }, 'upstream'],
  ])('maps %i %o to %s', async (status, body, code) => {
    const { fetch } = server(() => json(body, status));
    const reading = createTestTargetReader(PROJECT, PUBLISHABLE, fetch)('user-token', 'https://push/1');
    await expect(reading).rejects.toBeInstanceOf(TestTargetError);
    await expect(reading).rejects.toMatchObject({ code });
  });

  it('refuses a reply of the wrong shape', async () => {
    const { fetch } = server(() => json({ userId: 'user-1' }));
    await expect(createTestTargetReader(PROJECT, PUBLISHABLE, fetch)('user-token', 'https://push/1')).rejects.toMatchObject({ code: 'upstream' });
  });
});

describe('readServerSettings', () => {
  it('reads the secret key from SUPABASE_SECRET_KEYS, else the single-key variables', () => {
    expect(secretKeyFromEnv((n) => ({ SUPABASE_SECRET_KEYS: '{"default":"sb_secret_a","other":"sb_secret_b"}' })[n])).toBe('sb_secret_a');
    expect(secretKeyFromEnv((n) => ({ SUPABASE_SECRET_KEYS: '{"other":"sb_secret_b"}' })[n])).toBe('sb_secret_b');
    expect(secretKeyFromEnv((n) => ({ SUPABASE_SECRET_KEYS: 'nope', SUPABASE_SECRET_KEY: 'sb_secret_c' })[n])).toBe('sb_secret_c');
    expect(secretKeyFromEnv((n) => ({ SUPABASE_SERVICE_ROLE_KEY: 'eyJ.legacy' })[n])).toBe('eyJ.legacy');
    expect(secretKeyFromEnv(() => undefined)).toBeUndefined();
  });

  it('treats a short cron secret as none', () => {
    const env: Record<string, string> = { SUPABASE_URL: `${PROJECT}/`, SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE, CRON_SECRET: 'too-short', ALLOWED_ORIGIN: 'https://app' };
    expect(readServerSettings((n) => env[n])).toEqual({ url: PROJECT, publishableKey: PUBLISHABLE, vapid: null, allowedOrigins: 'https://app' });
    expect(readServerSettings((n) => ({ ...env, CRON_SECRET: 'f'.repeat(64) })[n]).cronSecret).toBe('f'.repeat(64));
  });
});
