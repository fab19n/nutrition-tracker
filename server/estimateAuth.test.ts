// @vitest-environment node
// Server code (Deno Edge Function): test with the runtime's own fetch classes.
import { describe, expect, it, vi } from 'vitest';
import {
  authorize,
  CORS_ALLOW_HEADERS,
  corsHeaders,
  createRateLimiter,
  ESTIMATES_PER_HOUR,
  identityFromClaims,
  isAllowedEmail,
  isAllowedOrigin,
  parseList,
  publicKeyFromEnv,
  readBearer,
  type VerifyToken,
} from '../supabase/functions/estimate/auth';
import { EstimateError, type EstimateInput, type EstimateOutput } from '../supabase/functions/estimate/core';
import { createEstimateHandler, type EstimateHandlerDeps } from '../supabase/functions/estimate/handler';

const URL_ = 'https://ref.supabase.co/functions/v1/estimate';
const APP = 'https://kira-makan.vercel.app';

function req(headers: Record<string, string> = {}, init: RequestInit = {}): Request {
  return new Request(URL_, { method: 'POST', ...init, headers });
}

const verifyAs =
  (email: string | null): VerifyToken =>
  async () =>
    email === null ? null : { email };

describe('readBearer', () => {
  it('reads the token from a Bearer header, any case, trimmed', () => {
    expect(readBearer(req({ Authorization: 'Bearer abc.def.ghi' }))).toBe('abc.def.ghi');
    expect(readBearer(req({ authorization: 'bearer   tok  ' }))).toBe('tok');
  });

  it('returns null for a missing, empty or non-Bearer header', () => {
    expect(readBearer(req())).toBeNull();
    expect(readBearer(req({ Authorization: 'Bearer' }))).toBeNull();
    expect(readBearer(req({ Authorization: 'Bearer   ' }))).toBeNull();
    expect(readBearer(req({ Authorization: 'Basic dXNlcjpwYXNz' }))).toBeNull();
    expect(readBearer(req({ Authorization: 'Bearer two tokens' }))).toBeNull();
  });
});

describe('parseList', () => {
  it('splits on commas, trims and drops blanks', () => {
    expect(parseList(' a@x.com , ,b@y.com,')).toEqual(['a@x.com', 'b@y.com']);
    expect(parseList(['  c ', ''])).toEqual(['c']);
    expect(parseList(undefined)).toEqual([]);
  });
});

describe('isAllowedEmail', () => {
  const list = ' Fabian@Example.com, other@example.com ';

  it('matches case-insensitively with whitespace trimmed', () => {
    expect(isAllowedEmail('fabian@example.com', list)).toBe(true);
    expect(isAllowedEmail('  FABIAN@EXAMPLE.COM ', list)).toBe(true);
    expect(isAllowedEmail('other@example.com', ['OTHER@example.com'])).toBe(true);
  });

  it('rejects emails not on the list and partial matches', () => {
    expect(isAllowedEmail('stranger@example.com', list)).toBe(false);
    expect(isAllowedEmail('fabian@example.co', list)).toBe(false);
    expect(isAllowedEmail('', list)).toBe(false);
    expect(isAllowedEmail(undefined, list)).toBe(false);
  });

  it('allows nobody when the list is empty or unset', () => {
    expect(isAllowedEmail('fabian@example.com', '')).toBe(false);
    expect(isAllowedEmail('fabian@example.com', ' , ')).toBe(false);
    expect(isAllowedEmail('fabian@example.com', undefined)).toBe(false);
    expect(isAllowedEmail('fabian@example.com', [])).toBe(false);
  });
});

describe('identityFromClaims', () => {
  it('accepts signed-in users with an email', () => {
    expect(identityFromClaims({ role: 'authenticated', email: ' me@example.com ', sub: 'u1' })).toEqual({ email: 'me@example.com' });
  });

  it('rejects API keys, anonymous users and junk', () => {
    expect(identityFromClaims({ role: 'anon' })).toBeNull();
    expect(identityFromClaims({ role: 'service_role' })).toBeNull();
    expect(identityFromClaims({ role: 'authenticated', is_anonymous: true })).toBeNull();
    expect(identityFromClaims({ role: 'authenticated', email: '' })).toBeNull();
    expect(identityFromClaims({ role: 'authenticated', email: 42 })).toBeNull();
    expect(identityFromClaims(null)).toBeNull();
    expect(identityFromClaims('authenticated')).toBeNull();
  });
});

describe('publicKeyFromEnv', () => {
  const envOf = (vars: Record<string, string>) => (name: string) => vars[name];

  it('prefers the default publishable key from the JSON dictionary', () => {
    const get = envOf({ SUPABASE_PUBLISHABLE_KEYS: '{"web":"sb_publishable_web","default":"sb_publishable_def"}', SUPABASE_ANON_KEY: 'anon' });
    expect(publicKeyFromEnv(get)).toBe('sb_publishable_def');
  });

  it('takes the first named key when there is no default', () => {
    expect(publicKeyFromEnv(envOf({ SUPABASE_PUBLISHABLE_KEYS: '{"web":"sb_publishable_web"}' }))).toBe('sb_publishable_web');
  });

  it('falls back to the single publishable key, then the legacy anon key', () => {
    expect(publicKeyFromEnv(envOf({ SUPABASE_PUBLISHABLE_KEYS: '{}', SUPABASE_PUBLISHABLE_KEY: 'sb_local' }))).toBe('sb_local');
    expect(publicKeyFromEnv(envOf({ SUPABASE_PUBLISHABLE_KEYS: 'not json', SUPABASE_ANON_KEY: 'anon' }))).toBe('anon');
    expect(publicKeyFromEnv(envOf({ SUPABASE_ANON_KEY: 'anon' }))).toBe('anon');
    expect(publicKeyFromEnv(envOf({}))).toBeUndefined();
  });
});

describe('authorize', () => {
  const allowed = 'me@example.com';

  it('answers 401 without a token and never calls verify', async () => {
    const verify = vi.fn(verifyAs('me@example.com'));
    await expect(authorize(req(), verify, allowed)).resolves.toMatchObject({ ok: false, status: 401, code: 'notSignedIn' });
    expect(verify).not.toHaveBeenCalled();
  });

  it('passes the bearer token to verify', async () => {
    const verify = vi.fn(verifyAs('me@example.com'));
    await authorize(req({ Authorization: 'Bearer the-jwt' }), verify, allowed);
    expect(verify).toHaveBeenCalledWith('the-jwt');
  });

  it('answers 401 when the token does not verify', async () => {
    await expect(authorize(req({ Authorization: 'Bearer bad' }), verifyAs(null), allowed)).resolves.toMatchObject({
      ok: false,
      status: 401,
      code: 'notSignedIn',
    });
  });

  it('answers 403 for a verified user who is not on the list, or when the list is empty', async () => {
    const auth = { Authorization: 'Bearer ok' };
    await expect(authorize(req(auth), verifyAs('stranger@example.com'), allowed)).resolves.toMatchObject({
      ok: false,
      status: 403,
      code: 'forbidden',
    });
    await expect(authorize(req(auth), verifyAs('me@example.com'), '')).resolves.toMatchObject({ status: 403, code: 'forbidden' });
  });

  it('answers 503 when the check itself fails', async () => {
    const verify: VerifyToken = async () => {
      throw new Error('auth server down');
    };
    await expect(authorize(req({ Authorization: 'Bearer ok' }), verify, allowed)).resolves.toMatchObject({
      ok: false,
      status: 503,
      code: 'upstream',
    });
  });

  it('lets an allowed user through with a normalised email', async () => {
    await expect(authorize(req({ Authorization: 'Bearer ok' }), verifyAs('Me@Example.com'), allowed)).resolves.toEqual({
      ok: true,
      email: 'me@example.com',
    });
  });
});

describe('CORS', () => {
  const origins = `${APP}, http://localhost:5173/, https://kira-makan-*-fabian.vercel.app`;

  it('matches exact origins, ignoring case and a trailing slash', () => {
    expect(isAllowedOrigin(APP, origins)).toBe(true);
    expect(isAllowedOrigin('https://KIRA-MAKAN.vercel.app', origins)).toBe(true);
    expect(isAllowedOrigin('http://localhost:5173', origins)).toBe(true);
  });

  it('rejects other origins, schemes and ports', () => {
    expect(isAllowedOrigin('https://evil.example', origins)).toBe(false);
    expect(isAllowedOrigin('http://kira-makan.vercel.app', origins)).toBe(false);
    expect(isAllowedOrigin('http://localhost:4173', origins)).toBe(false);
    expect(isAllowedOrigin('https://kira-makan.vercel.app.evil.example', origins)).toBe(false);
    expect(isAllowedOrigin('null', origins)).toBe(false);
    expect(isAllowedOrigin(null, origins)).toBe(false);
    expect(isAllowedOrigin(APP, undefined)).toBe(false);
  });

  it('lets a * cover part of one host label, never a dot', () => {
    expect(isAllowedOrigin('https://kira-makan-abc123-fabian.vercel.app', origins)).toBe(true);
    expect(isAllowedOrigin('https://kira-makan-git-main-fabian.vercel.app', origins)).toBe(true);
    expect(isAllowedOrigin('https://kira-makan-x.evil.example-fabian.vercel.app', origins)).toBe(false);
    expect(isAllowedOrigin('https://kira-makan--fabian.vercel.app', origins)).toBe(false);
    expect(isAllowedOrigin('https://anything.example', '*')).toBe(false);
  });

  it('echoes an allowed origin with the allowed headers and methods', () => {
    const headers = corsHeaders(APP, origins);
    expect(headers['Access-Control-Allow-Origin']).toBe(APP);
    expect(headers['Access-Control-Allow-Methods']).toBe('POST, OPTIONS');
    expect(headers.Vary).toBe('Origin');
    for (const name of ['authorization', 'apikey', 'content-type', 'x-client-info']) {
      expect(headers['Access-Control-Allow-Headers']).toContain(name);
    }
    expect(CORS_ALLOW_HEADERS).toBe('authorization, apikey, content-type, x-client-info');
  });

  it('sends no allow header for other or missing origins', () => {
    expect(corsHeaders('https://evil.example', origins)).toEqual({ Vary: 'Origin' });
    expect(corsHeaders(null, origins)).toEqual({ Vary: 'Origin' });
    expect(corsHeaders(APP, '')).toEqual({ Vary: 'Origin' });
  });
});

describe('createRateLimiter', () => {
  const HOUR = 60 * 60 * 1000;

  it('allows the limit within the window, then blocks with a retry time', () => {
    let t = 0;
    const limiter = createRateLimiter({ limit: 3, windowMs: HOUR, now: () => t });
    expect(limiter.take('me')).toEqual({ ok: true, remaining: 2 });
    t = 10_000;
    expect(limiter.take('me')).toEqual({ ok: true, remaining: 1 });
    expect(limiter.take('me')).toEqual({ ok: true, remaining: 0 });
    t = 20_000;
    expect(limiter.take('me')).toEqual({ ok: false, retryAfterSeconds: 3580 });
  });

  it('slides: requests older than the window stop counting', () => {
    let t = 0;
    const limiter = createRateLimiter({ limit: 2, windowMs: HOUR, now: () => t });
    limiter.take('me');
    t = 1000;
    limiter.take('me');
    expect(limiter.take('me').ok).toBe(false);
    t = HOUR;
    expect(limiter.take('me')).toEqual({ ok: true, remaining: 0 });
    expect(limiter.take('me').ok).toBe(false);
    t = HOUR + 1000;
    expect(limiter.take('me').ok).toBe(true);
  });

  it('blocked attempts do not extend the wait', () => {
    let t = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: HOUR, now: () => t });
    limiter.take('me');
    t = HOUR - 5000;
    expect(limiter.take('me')).toEqual({ ok: false, retryAfterSeconds: 5 });
    t = HOUR;
    expect(limiter.take('me').ok).toBe(true);
  });

  it('counts each user separately', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: HOUR, now: () => 0 });
    expect(limiter.take('a').ok).toBe(true);
    expect(limiter.take('a').ok).toBe(false);
    expect(limiter.take('b').ok).toBe(true);
  });

  it('keeps active users counted when it sweeps idle ones', () => {
    let t = 0;
    const limiter = createRateLimiter({ limit: 1, windowMs: HOUR, now: () => t, maxKeys: 2 });
    limiter.take('old');
    t = HOUR;
    limiter.take('active');
    limiter.take('new'); // over maxKeys: idle 'old' is swept
    expect(limiter.take('active').ok).toBe(false);
    expect(limiter.take('new').ok).toBe(false);
    expect(limiter.take('old').ok).toBe(true);
  });

  it('defaults to 30 estimates an hour', () => {
    expect(ESTIMATES_PER_HOUR).toBe(30);
    const limiter = createRateLimiter({ limit: ESTIMATES_PER_HOUR, windowMs: HOUR, now: () => 0 });
    for (let i = 0; i < 30; i++) expect(limiter.take('me').ok).toBe(true);
    expect(limiter.take('me').ok).toBe(false);
  });
});

describe('createEstimateHandler', () => {
  const OUTPUT: EstimateOutput = {
    items: [],
    questions: [],
    unmatched: [],
    method: 'ai',
    mealName: 'Teh o ais',
    model: 'claude-sonnet-5-5',
    usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
  };

  function setup(overrides: Partial<EstimateHandlerDeps> = {}) {
    const estimate = vi.fn(async (_input: EstimateInput) => OUTPUT);
    const onError = vi.fn();
    const deps: EstimateHandlerDeps = {
      verify: verifyAs('me@example.com'),
      estimate,
      limiter: createRateLimiter({ limit: 2, windowMs: 60_000, now: () => 0 }),
      settings: () => ({ allowedEmails: 'me@example.com', allowedOrigins: APP }),
      onError,
      ...overrides,
    };
    return { handle: createEstimateHandler(deps), estimate, onError };
  }

  const post = (body: string, headers: Record<string, string> = {}) =>
    req({ Origin: APP, Authorization: 'Bearer ok', 'Content-Type': 'application/json', ...headers }, { body });

  it('answers a preflight from an allowed origin', async () => {
    const { handle } = setup();
    const res = await handle(req({ Origin: APP, 'Access-Control-Request-Method': 'POST' }, { method: 'OPTIONS' }));
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(APP);
    expect(res.headers.get('access-control-allow-headers')).toBe(CORS_ALLOW_HEADERS);
  });

  it('gives other origins no CORS allow header', async () => {
    const { handle } = setup();
    const res = await handle(req({ Origin: 'https://evil.example' }, { method: 'OPTIONS' }));
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('refuses methods other than POST', async () => {
    const { handle } = setup();
    const res = await handle(new Request(URL_, { method: 'GET', headers: { Origin: APP } }));
    expect(res.status).toBe(405);
  });

  it('answers 401 notSignedIn with CORS headers so the app can read it', async () => {
    const { handle, estimate } = setup();
    const res = await handle(req({ Origin: APP }, { body: '{"text":"teh o ais"}' }));
    expect(res.status).toBe(401);
    expect(res.headers.get('access-control-allow-origin')).toBe(APP);
    expect(res.headers.get('www-authenticate')).toBe('Bearer');
    await expect(res.json()).resolves.toMatchObject({ code: 'notSignedIn' });
    expect(estimate).not.toHaveBeenCalled();
  });

  it('answers 403 forbidden for a signed-in user who is not allowed', async () => {
    const { handle, estimate } = setup({ verify: verifyAs('stranger@example.com') });
    const res = await handle(post('{"text":"teh o ais"}'));
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: 'forbidden' });
    expect(estimate).not.toHaveBeenCalled();
  });

  it('reads the allow lists on every request', async () => {
    let emails = '';
    const { handle } = setup({ settings: () => ({ allowedEmails: emails, allowedOrigins: APP }) });
    expect((await handle(post('{"text":"teh o ais"}'))).status).toBe(403);
    emails = 'me@example.com';
    expect((await handle(post('{"text":"teh o ais"}'))).status).toBe(200);
  });

  it('estimates for an allowed user and returns the result', async () => {
    const { handle, estimate } = setup();
    const res = await handle(post('{"text":"teh o ais kurang","slot":"lunch"}'));
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(APP);
    await expect(res.json()).resolves.toEqual(OUTPUT);
    expect(estimate).toHaveBeenCalledWith(expect.objectContaining({ text: 'teh o ais kurang', slot: 'lunch' }));
  });

  it('rate-limits per user with a Retry-After the browser may read', async () => {
    const { handle, estimate } = setup();
    await handle(post('{"text":"a"}'));
    await handle(post('{"text":"b"}'));
    const res = await handle(post('{"text":"c"}'));
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('60');
    expect(res.headers.get('access-control-expose-headers')).toContain('Retry-After');
    await expect(res.json()).resolves.toMatchObject({ code: 'rateLimited' });
    expect(estimate).toHaveBeenCalledTimes(2);
  });

  it('answers 400 for a body that is not JSON', async () => {
    const { handle } = setup();
    const res = await handle(post('{not json'));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ code: 'bad_request' });
  });

  it('passes estimate errors through and hides unexpected ones', async () => {
    const refused = setup({ estimate: async () => Promise.reject(new EstimateError('Declined', 422, 'refused')) });
    const res = await refused.handle(post('{"text":"x"}'));
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({ error: 'Declined', code: 'refused' });

    const broken = setup({ estimate: async () => Promise.reject(new Error('secret detail')) });
    const res2 = await broken.handle(post('{"text":"x"}'));
    expect(res2.status).toBe(500);
    const body = (await res2.json()) as { error: string; code: string };
    expect(body.code).toBe('upstream');
    expect(body.error).not.toContain('secret');
    expect(broken.onError).toHaveBeenCalled();
  });
});
