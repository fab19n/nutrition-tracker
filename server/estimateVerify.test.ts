// @vitest-environment node
// The Edge Function's sign-in check with a real supabase-js client (auth.getClaims) and a fake
// fetch standing in for the Auth server, wired through the request handler.
import { describe, expect, it, vi } from 'vitest';
import { createRateLimiter } from '../supabase/functions/estimate/auth';
import type { EstimateInput, EstimateOutput } from '../supabase/functions/estimate/core';
import { createEstimateHandler } from '../supabase/functions/estimate/handler';
import { createTokenVerifier, createVerifierClient } from '../supabase/functions/estimate/verify';

const PROJECT = 'https://ref.supabase.co';
const JWKS_URL = `${PROJECT}/auth/v1/.well-known/jwks.json`;
const USER_URL = `${PROJECT}/auth/v1/user`;
const APP = 'https://kira-makan.vercel.app';
const KID = 'ec-key';

const OUTPUT: EstimateOutput = {
  items: [],
  questions: [],
  unmatched: [],
  method: 'ai',
  mealName: 'Roti canai',
  model: 'claude-sonnet-5-5',
  usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
};

const ES256 = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGN = { name: 'ECDSA', hash: 'SHA-256' } as const;

async function keyPair() {
  return crypto.subtle.generateKey(ES256, true, ['sign', 'verify']);
}

const signingKeys = await keyPair();
const otherKeys = await keyPair();
const publicJwk = { ...(await crypto.subtle.exportKey('jwk', signingKeys.publicKey)), kid: KID, alg: 'ES256', use: 'sig' };

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

function segment(value: unknown): string {
  return b64url(new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)));
}

const hour = () => Math.floor(Date.now() / 1000) + 3600;
const claims = (extra: Record<string, unknown> = {}) => ({ sub: 'u1', role: 'authenticated', email: 'me@example.com', exp: hour(), ...extra });

async function sign(header: unknown, payload: unknown, key: CryptoKey = signingKeys.privateKey): Promise<string> {
  const input = `${segment(header)}.${segment(payload)}`;
  const signature = new Uint8Array(await crypto.subtle.sign(SIGN, key, new TextEncoder().encode(input)));
  return `${input}.${b64url(signature)}`;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type Route = () => Response | Promise<Response>;

function setup(routes: { jwks?: Route; user?: Route } = {}) {
  const fakeFetch = vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url === JWKS_URL) return (routes.jwks ?? (() => json({ keys: [publicJwk] })))();
    if (url === USER_URL) return (routes.user ?? (() => json({ msg: 'invalid JWT', error_code: 'bad_jwt' }, 403)))();
    throw new Error(`unexpected fetch ${url}`);
  });
  const client = createVerifierClient(PROJECT, 'sb_publishable_test', fakeFetch as unknown as typeof fetch);
  const onError = vi.fn();
  const estimate = vi.fn(async (_input: EstimateInput) => OUTPUT);
  const handle = createEstimateHandler({
    verify: createTokenVerifier(() => client.auth, onError),
    estimate,
    limiter: createRateLimiter({ limit: 100, windowMs: 60_000 }),
    settings: () => ({ allowedEmails: 'me@example.com', allowedOrigins: APP }),
  });
  const post = async (token: string) => {
    const res = await handle(
      new Request(`${PROJECT}/functions/v1/estimate`, {
        method: 'POST',
        headers: { Origin: APP, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: '{"text":"roti canai"}',
      }),
    );
    return { status: res.status, body: (await res.json()) as { code?: string } };
  };
  return { post, fakeFetch, onError, estimate };
}

describe('estimate sign-in check (supabase-js getClaims)', () => {
  it('lets a token signed with the project key through', async () => {
    const { post, estimate } = setup();
    const res = await post(await sign({ alg: 'ES256', typ: 'JWT', kid: KID }, claims()));
    expect(res.status).toBe(200);
    expect(estimate).toHaveBeenCalledTimes(1);
  });

  it('answers 403 for a verified user who is not on the list', async () => {
    const { post } = setup();
    const res = await post(await sign({ alg: 'ES256', kid: KID }, claims({ email: 'stranger@example.com' })));
    expect(res).toMatchObject({ status: 403, body: { code: 'forbidden' } });
  });

  it('answers 401 for forged, expired and garbage tokens', async () => {
    const { post, onError, estimate } = setup();
    const forged = await sign({ alg: 'ES256', kid: KID }, claims(), otherKeys.privateKey);
    const expired = await sign({ alg: 'ES256', kid: KID }, claims({ exp: Math.floor(Date.now() / 1000) - 60 }));
    for (const token of [forged, expired, 'not-a-jwt', 'sb_publishable_test']) {
      expect(await post(token)).toMatchObject({ status: 401, body: { code: 'notSignedIn' } });
    }
    expect(onError).not.toHaveBeenCalled();
    expect(estimate).not.toHaveBeenCalled();
  });

  it('answers 401, not 503, for crafted tokens that make getClaims throw', async () => {
    const { post, onError, estimate } = setup();
    const signature = segment('sig');
    const crafted = [
      `${segment('not json')}.${segment(claims())}.${signature}`, // SyntaxError from JSON.parse
      `${segment({ alg: 'ES256', kid: KID })}.${segment('null')}.${signature}`, // returned as AuthInvalidJwtError
      await sign({ alg: 'none', kid: KID }, claims()), // Error('Invalid alg claim')
      await sign({ alg: 'RS256', kid: KID }, claims()), // DOMException: RSA alg with an EC key
    ];
    for (const token of crafted) {
      expect(await post(token)).toMatchObject({ status: 401, body: { code: 'notSignedIn' } });
    }
    expect(onError).not.toHaveBeenCalled();
    expect(estimate).not.toHaveBeenCalled();
  });

  it('checks legacy HS256 tokens with the Auth server', async () => {
    const accepted = setup({ user: () => json({ id: 'u1', email: 'me@example.com', aud: 'authenticated', role: 'authenticated' }) });
    const token = `${segment({ alg: 'HS256', typ: 'JWT' })}.${segment(claims())}.${segment('mac')}`;
    expect((await accepted.post(token)).status).toBe(200);
    expect(accepted.fakeFetch).toHaveBeenCalledWith(USER_URL, expect.anything());

    const refused = setup();
    expect(await refused.post(token)).toMatchObject({ status: 401, body: { code: 'notSignedIn' } });
  });

  it('answers 503 when the Auth server fails or the keys cannot be fetched', async () => {
    const hs256 = `${segment({ alg: 'HS256' })}.${segment(claims())}.${segment('mac')}`;
    const down = setup({ user: () => json({ msg: 'internal error' }, 500) });
    expect(await down.post(hs256)).toMatchObject({ status: 503, body: { code: 'upstream' } });
    expect(down.onError).toHaveBeenCalledTimes(1);

    // auth-js shares its JWKS cache across clients, so use a key id it hasn't cached (a rotated key).
    const offline = setup({
      jwks: () => {
        throw new TypeError('fetch failed');
      },
    });
    const rotated = await sign({ alg: 'ES256', kid: 'rotated-key' }, claims());
    expect(await offline.post(rotated)).toMatchObject({ status: 503, body: { code: 'upstream' } });
    expect(offline.onError).toHaveBeenCalledTimes(1);
    expect(offline.estimate).not.toHaveBeenCalled();
  });

  it('answers 503 when the function has no project URL or key', async () => {
    const onError = vi.fn();
    const verify = createTokenVerifier(() => {
      throw new Error('SUPABASE_URL is missing');
    }, onError);
    await expect(verify('token')).rejects.toThrow('SUPABASE_URL is missing');
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('SUPABASE_URL is missing'));
  });
});
