import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { postEstimate } from '@/estimate/aiClient';
import { getAccessToken, resetSessionForTests } from './session';
import { getSupabase, resetSupabaseForTests, storageKeyFor } from './supabase';

/*
 * The real supabase-js client, no fakes: a phone that sat idle for over an hour opens on a weak
 * connection. The stored token has run out and every request to Supabase fails. Being signed in
 * must read as a connection problem, never as "sign in to use AI estimates".
 */
const SUPABASE_URL = 'https://abcdefgh.supabase.co';
const NOW = Date.UTC(2026, 9, 16, 11, 10);

function storeRunOutSession(): void {
  window.localStorage.setItem(
    storageKeyFor(SUPABASE_URL),
    JSON.stringify({
      access_token: 'run-out-token',
      refresh_token: 'refresh-token',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(NOW / 1000) - 600,
      user: { id: 'user-1', email: 'fabian@example.com', aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '' },
    }),
  );
}

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
  // Loaded once up front, so loading it never races the fake clock.
  await import('@supabase/supabase-js');
});

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.stubEnv('VITE_SUPABASE_URL', SUPABASE_URL);
  vi.stubEnv('VITE_SUPABASE_KEY', 'sb_publishable_test_key');
  vi.stubEnv('VITE_ESTIMATE_URL', '');
  // No BroadcastChannel: it would keep the test worker alive.
  vi.stubGlobal('BroadcastChannel', undefined);
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async () => Promise.reject(new TypeError('Failed to fetch'))),
  );
  resetSessionForTests();
  resetSupabaseForTests();
  storeRunOutSession();
});

afterEach(async () => {
  const client = await getSupabase().catch(() => null);
  await client?.auth.dispose();
  resetSessionForTests();
  resetSupabaseForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  window.localStorage.clear();
});

describe('getAccessToken with the real supabase-js client', () => {
  it('rejects with the retryable fetch error and keeps the session', async () => {
    const { value, error } = await settle(getAccessToken());

    expect(value).toBeUndefined();
    expect(error).toMatchObject({ name: 'AuthRetryableFetchError' });
    expect(window.localStorage.getItem(storageKeyFor(SUPABASE_URL))).not.toBeNull();
  });

  it('makes an AI estimate report the connection, not a sign-out', async () => {
    const estimateFetch = vi.fn<typeof fetch>();
    const { error } = await settle(postEstimate({ text: 'durian crepe' }, { fetch: estimateFetch, isOnline: () => true, timeoutMs: 60_000 }));

    expect(error).toMatchObject({ name: 'EstimateUnavailableError', reason: 'network' });
    expect(estimateFetch).not.toHaveBeenCalled();
  });

  it('is null once the server refuses the refresh token', async () => {
    vi.mocked(fetch).mockImplementation(
      async () =>
        new Response(JSON.stringify({ code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Refresh Token Not Found' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    const { value, error } = await settle(getAccessToken());

    expect(error).toBeUndefined();
    expect(value).toBeNull();
    expect(window.localStorage.getItem(storageKeyFor(SUPABASE_URL))).toBeNull();
  });
});
