// @vitest-environment node
// Web Push for the send-reminders function: VAPID and aes128gcm with WebCrypto, checked against
// RFC 8291's Appendix A, a decrypting round trip and a fake push service.
import { describe, expect, it, vi } from 'vitest';
import {
  MAX_PAYLOAD_BYTES,
  base64UrlDecode,
  base64UrlEncode,
  createWebPushSender,
  encryptPayload,
  importEcdhKeyPair,
  readVapidConfig,
  vapidAuthorization,
  type PushTarget,
  type VapidConfig,
} from '../supabase/functions/send-reminders/webpush';

const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** A fresh VAPID pair as `npm run push:keys` prints it. */
async function vapidPair(subject = 'https://kira-makan.vercel.app'): Promise<VapidConfig> {
  const pair = await crypto.subtle.generateKey(ECDSA, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const publicKey = base64UrlEncode(concat(new Uint8Array([4]), base64UrlDecode(jwk.x ?? ''), base64UrlDecode(jwk.y ?? '')));
  return { publicKey, privateKey: jwk.d ?? '', subject };
}

/** A browser's subscription keys, with the private half to decrypt. */
async function browserKeys(): Promise<{ target: { p256dh: string; auth: string }; privateKey: CryptoKey; publicRaw: Uint8Array<ArrayBuffer>; auth: Uint8Array<ArrayBuffer> }> {
  const pair = await crypto.subtle.generateKey(ECDH, true, ['deriveBits']);
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { target: { p256dh: base64UrlEncode(publicRaw), auth: base64UrlEncode(auth) }, privateKey: pair.privateKey, publicRaw, auth };
}

async function hkdf(salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, length: number) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

/** RFC 8291 §3.4 and RFC 8188, the browser's side. */
async function decrypt(body: Uint8Array, ua: { privateKey: CryptoKey; publicRaw: Uint8Array<ArrayBuffer>; auth: Uint8Array<ArrayBuffer> }) {
  const salt = body.slice(0, 16);
  const recordSize = new DataView(body.buffer, body.byteOffset).getUint32(16);
  const idLength = body[20] ?? 0;
  const asPublic = body.slice(21, 21 + idLength);
  const ciphertext = body.slice(21 + idLength);
  const asKey = await crypto.subtle.importKey('raw', asPublic, ECDH, true, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256));
  const ikm = await hkdf(ua.auth, ecdh, concat(encoder.encode('WebPush: info\0'), ua.publicRaw, asPublic), 32);
  const cek = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const padded = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, key, ciphertext));
  expect(padded.at(-1)).toBe(2);
  return { recordSize, idLength, plaintext: decoder.decode(padded.slice(0, -1)) };
}

describe('base64url', () => {
  it('round-trips bytes, padded or not', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    const text = base64UrlEncode(bytes);
    expect(text).not.toMatch(/[+/=]/);
    expect(base64UrlDecode(text)).toEqual(bytes);
    expect(base64UrlDecode(base64UrlEncode(new Uint8Array([1, 2])) + '==')).toEqual(new Uint8Array([1, 2]));
    expect(base64UrlDecode('')).toEqual(new Uint8Array(0));
  });

  it('throws on anything else', () => {
    expect(() => base64UrlDecode('abc$')).toThrow(RangeError);
    expect(() => base64UrlDecode('a+b/')).toThrow(RangeError);
    expect(() => base64UrlDecode('abcde')).toThrow(RangeError);
  });
});

describe('readVapidConfig', () => {
  it('reads a generated pair', async () => {
    const vapid = await vapidPair();
    const env: Record<string, string> = { VAPID_PUBLIC_KEY: ` ${vapid.publicKey} `, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: vapid.subject };
    expect(readVapidConfig((name) => env[name])).toEqual(vapid);
    expect(readVapidConfig((name) => ({ ...env, VAPID_SUBJECT: 'mailto:me@example.com' })[name])?.subject).toBe('mailto:me@example.com');
  });

  it('refuses wrong lengths, a missing 0x04, a bad subject or a missing value', async () => {
    const vapid = await vapidPair();
    const pub = base64UrlDecode(vapid.publicKey);
    const cases: Record<string, string | undefined>[] = [
      { VAPID_PUBLIC_KEY: base64UrlEncode(pub.slice(0, 64)) },
      { VAPID_PUBLIC_KEY: base64UrlEncode(concat(new Uint8Array([3]), pub.slice(1))) },
      { VAPID_PRIVATE_KEY: base64UrlEncode(new Uint8Array(31)) },
      { VAPID_PRIVATE_KEY: 'not base64!' },
      { VAPID_SUBJECT: 'http://kira-makan.vercel.app' },
      { VAPID_SUBJECT: 'me@example.com' },
      { VAPID_SUBJECT: undefined },
    ];
    for (const patch of cases) {
      const env: Record<string, string | undefined> = { VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: vapid.subject, ...patch };
      expect(readVapidConfig((name) => env[name])).toBeNull();
    }
  });
});

describe('vapidAuthorization', () => {
  it('signs a 12-hour JWT for the push service that verifies with the public key', async () => {
    const vapid = await vapidPair();
    const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc:def', vapid, 1_800_000_000);
    const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
    expect(match).not.toBeNull();
    const [, h, c, s, k] = match as unknown as [string, string, string, string, string];
    expect(k).toBe(vapid.publicKey);
    expect(JSON.parse(decoder.decode(base64UrlDecode(h)))).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(JSON.parse(decoder.decode(base64UrlDecode(c)))).toEqual({ aud: 'https://fcm.googleapis.com', exp: 1_800_043_200, sub: vapid.subject });
    const signature = base64UrlDecode(s);
    expect(signature).toHaveLength(64);
    const pub = await crypto.subtle.importKey('raw', base64UrlDecode(vapid.publicKey), ECDSA, false, ['verify']);
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, signature, encoder.encode(`${h}.${c}`))).toBe(true);
  });
});

describe('encryptPayload', () => {
  it('matches RFC 8291 Appendix A exactly', async () => {
    const asPublic = base64UrlDecode('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8');
    const serverKeys = await importEcdhKeyPair(base64UrlDecode('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'), asPublic);
    const body = await encryptPayload(
      encoder.encode('When I grow up, I want to be a watermelon'),
      { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' },
      { salt: base64UrlDecode('DGv6ra1nlYgDCS1FRnbzlw'), serverKeys },
    );
    const expected =
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN';
    expect(base64UrlEncode(body)).toBe(expected);
    expect(body).toHaveLength(144);
  });

  it('is read back by the browser it was meant for', async () => {
    const ua = await browserKeys();
    const message = JSON.stringify({ v: 1, kind: 'checkIn', title: 'Quick check', body: "Was yesterday's log complete?", url: '/?sheet=checkin' });
    const body = await encryptPayload(encoder.encode(message), ua.target);
    const opened = await decrypt(body, ua);
    expect(opened).toEqual({ recordSize: 4096, idLength: 65, plaintext: message });
    // A fresh server key and salt every time.
    const again = await encryptPayload(encoder.encode(message), ua.target);
    expect(base64UrlEncode(again)).not.toBe(base64UrlEncode(body));
  });

  it('refuses a payload over 3000 bytes and keys that are not a subscription', async () => {
    const ua = await browserKeys();
    await expect(encryptPayload(new Uint8Array(MAX_PAYLOAD_BYTES + 1), ua.target)).rejects.toThrow(RangeError);
    await expect(encryptPayload(new Uint8Array(10), { ...ua.target, auth: base64UrlEncode(new Uint8Array(8)) })).rejects.toThrow(RangeError);
  });
});

describe('createWebPushSender', () => {
  async function setup(answer: () => Response | Promise<Response>) {
    const vapid = await vapidPair();
    const ua = await browserKeys();
    const target: PushTarget = { endpoint: 'https://fcm.googleapis.com/fcm/send/device-1', ...ua.target, vapidKey: vapid.publicKey };
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => answer());
    const sender = createWebPushSender(vapid, { fetch: fetchMock as unknown as typeof fetch, nowMs: () => 1_800_000_000_000, timeoutMs: 50 });
    return { vapid, ua, target, fetchMock, sender };
  }

  it('posts the encrypted message with the push headers', async () => {
    const { vapid, ua, target, fetchMock, sender } = await setup(() => new Response(null, { status: 201 }));
    const report = await sender.send(target, '{"v":1}', { ttl: 14400, topic: 'km-checkIn', urgency: 'high' });
    expect(report).toEqual({ endpoint: target.endpoint, outcome: 'ok', status: 201 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(target.endpoint);
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers).toMatchObject({
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      TTL: '14400',
      Urgency: 'high',
      Topic: 'km-checkIn',
    });
    expect(headers.Authorization).toMatch(new RegExp(`^vapid t=[^,]+, k=${vapid.publicKey}$`));
    expect(init.body).toBeInstanceOf(Uint8Array);
    expect((await decrypt(init.body as Uint8Array, ua)).plaintext).toBe('{"v":1}');
  });

  it('leaves out a topic the push service would refuse', async () => {
    const { target, fetchMock, sender } = await setup(() => new Response(null, { status: 201 }));
    await sender.send(target, '{}', { ttl: 60, topic: 'km check-in!' });
    const headers = (fetchMock.mock.calls[0] as [string, RequestInit])[1].headers as Record<string, string>;
    expect(headers.Topic).toBeUndefined();
    expect(headers.Urgency).toBeUndefined();
  });

  it.each([
    [200, { outcome: 'ok' }],
    [202, { outcome: 'ok' }],
    [404, { outcome: 'gone' }],
    [410, { outcome: 'gone' }],
    [429, { outcome: 'failed', error: 'http 429', transient: true }],
    [503, { outcome: 'failed', error: 'http 503', transient: true }],
    [403, { outcome: 'failed', error: 'http 403', transient: false }],
    [413, { outcome: 'failed', error: 'http 413', transient: false }],
  ])('maps %i', async (status, expected) => {
    const { target, sender } = await setup(() => new Response('{}', { status }));
    expect(await sender.send(target, '{}', { ttl: 60 })).toMatchObject({ endpoint: target.endpoint, status, ...expected });
  });

  it.each([
    ['another site', 'https://evil.example/collect'],
    ['a look-alike host', 'https://fcm.googleapis.com.evil.example/fcm/send/device-1'],
    ['a user and password before the host', 'https://fcm.googleapis.com@evil.example/fcm/send/device-1'],
  ])('never posts to %s, even for a row saved before the rule', async (_name, endpoint) => {
    const { target, fetchMock, sender } = await setup(() => new Response(null, { status: 201 }));
    const report = await sender.send({ ...target, endpoint }, '{}', { ttl: 60 });
    expect(report).toEqual({ endpoint, outcome: 'skipped', error: 'host' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a network failure and a timeout as worth retrying', async () => {
    const refused = await setup(() => Promise.reject(new TypeError('fetch failed')));
    expect(await refused.sender.send(refused.target, '{}', { ttl: 60 })).toEqual({ endpoint: refused.target.endpoint, outcome: 'failed', error: 'network', transient: true });
    const slow = await setup(() => new Promise<Response>(() => undefined));
    const vapid = await vapidPair();
    const hanging = createWebPushSender(vapid, {
      fetch: ((_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason)))) as unknown as typeof fetch,
      nowMs: () => Date.now(),
      timeoutMs: 20,
    });
    expect(await hanging.send(slow.target, '{}', { ttl: 60 })).toMatchObject({ outcome: 'failed', error: 'network', transient: true });
  });
});
