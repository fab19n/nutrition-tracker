/**
 * Web Push with WebCrypto only (Node 20+ and Deno): VAPID (RFC 8292) to name this server to the push
 * service, and aes128gcm message encryption (RFC 8291 over RFC 8188) so only the browser that
 * subscribed can read a reminder. No dependency: server/webpush.test.ts checks it against RFC 8291's
 * Appendix A vector. Only browser push services are ever sent to (../_shared/pushHosts.ts).
 */
import { isAllowedPushEndpoint } from '../_shared/pushHosts.ts';

export interface VapidConfig {
  /** 65-byte uncompressed P-256 point, base64url (starts with B). */
  publicKey: string;
  /** The 32-byte private scalar d, base64url. */
  privateKey: string;
  /** https://… or mailto:… */
  subject: string;
}

const encoder = new TextEncoder();
const BASE64URL = /^[A-Za-z0-9_-]*={0,2}$/;
const ECDH = { name: 'ECDH', namedCurve: 'P-256' } as const;
const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const TOPIC = /^[A-Za-z0-9_-]{1,32}$/;
/** RFC 8188 record size: one record holds the whole message. */
const RECORD_SIZE = 4096;

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Padded or unpadded base64url → bytes. Throws on anything else. */
export function base64UrlDecode(text: string): Uint8Array<ArrayBuffer> {
  const trimmed = text.trim();
  if (!BASE64URL.test(trimmed)) throw new RangeError('Not base64url');
  const plain = trimmed.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
  if (plain.length % 4 === 1) throw new RangeError('Not base64url');
  const binary = atob(plain.padEnd(Math.ceil(plain.length / 4) * 4, '='));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function decodeOrNull(text: string | undefined): Uint8Array<ArrayBuffer> | null {
  if (!text) return null;
  try {
    return base64UrlDecode(text);
  } catch {
    return null;
  }
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** The VAPID secrets, or null unless all three are there and well formed. */
export function readVapidConfig(get: (name: string) => string | undefined): VapidConfig | null {
  const publicKey = get('VAPID_PUBLIC_KEY')?.trim();
  const privateKey = get('VAPID_PRIVATE_KEY')?.trim();
  const subject = get('VAPID_SUBJECT')?.trim();
  const pub = decodeOrNull(publicKey);
  const priv = decodeOrNull(privateKey);
  if (!publicKey || !privateKey || !subject || !pub || !priv) return null;
  if (pub.length !== 65 || pub[0] !== 0x04 || priv.length !== 32) return null;
  if (!/^(https:\/\/\S+|mailto:\S+)$/.test(subject)) return null;
  return { publicKey, privateKey, subject };
}

/** An EC P-256 JSON Web Key (spelled out: Node's types have no global JsonWebKey). */
interface EcJwk {
  kty: 'EC';
  crv: 'P-256';
  x: string;
  y: string;
  d?: string;
  ext: boolean;
}

function jwkFor(publicKey: Uint8Array, privateD?: Uint8Array): EcJwk {
  const jwk: EcJwk = {
    kty: 'EC',
    crv: 'P-256',
    x: base64UrlEncode(publicKey.slice(1, 33)),
    y: base64UrlEncode(publicKey.slice(33, 65)),
    ext: true,
  };
  if (privateD) jwk.d = base64UrlEncode(privateD);
  return jwk;
}

const signingKeys = new Map<string, Promise<CryptoKey>>();

function signingKey(vapid: VapidConfig): Promise<CryptoKey> {
  const cacheKey = `${vapid.publicKey}:${vapid.privateKey}`;
  let key = signingKeys.get(cacheKey);
  if (!key) {
    const jwk = jwkFor(base64UrlDecode(vapid.publicKey), base64UrlDecode(vapid.privateKey));
    key = crypto.subtle.importKey('jwk', jwk, ECDSA, false, ['sign']);
    signingKeys.set(cacheKey, key);
  }
  return key;
}

function segment(value: unknown): string {
  return base64UrlEncode(encoder.encode(JSON.stringify(value)));
}

/**
 * `vapid t=<jwt>, k=<publicKey>`: a JWT (ES256) for the endpoint's push service, valid 12 hours.
 * WebCrypto's ECDSA signature is already the JWS form (r ‖ s, 64 bytes).
 */
export async function vapidAuthorization(endpoint: string, vapid: VapidConfig, nowSeconds: number): Promise<string> {
  const input = `${segment({ typ: 'JWT', alg: 'ES256' })}.${segment({ aud: new URL(endpoint).origin, exp: nowSeconds + 43_200, sub: vapid.subject })}`;
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await signingKey(vapid), encoder.encode(input)));
  return `vapid t=${input}.${base64UrlEncode(signature)}, k=${base64UrlEncode(base64UrlDecode(vapid.publicKey))}`;
}

/** Push services take 4,096 bytes; a reminder is far smaller. */
export const MAX_PAYLOAD_BYTES = 3000;

/** A server key pair from known bytes (the RFC's test vector). */
export async function importEcdhKeyPair(privateD: Uint8Array, publicKey: Uint8Array): Promise<{ privateKey: CryptoKey; publicKey: Uint8Array }> {
  const privateKey = await crypto.subtle.importKey('jwk', jwkFor(publicKey, privateD), ECDH, false, ['deriveBits']);
  return { privateKey, publicKey: new Uint8Array(publicKey) };
}

async function hkdf(salt: Uint8Array<ArrayBuffer>, ikm: Uint8Array<ArrayBuffer>, info: Uint8Array<ArrayBuffer>, length: number): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

/**
 * RFC 8291 aes128gcm: an ECDH secret with the browser's key, HKDF with its auth secret, then one
 * AES-128-GCM record. Body = salt ‖ uint32be(4096) ‖ 65 ‖ server public key ‖ ciphertext.
 * A fresh server key pair and salt per message unless given (tests).
 */
export async function encryptPayload(
  plaintext: Uint8Array,
  target: { p256dh: string; auth: string },
  opts: { salt?: Uint8Array; serverKeys?: { privateKey: CryptoKey; publicKey: Uint8Array } } = {},
): Promise<Uint8Array<ArrayBuffer>> {
  if (plaintext.length > MAX_PAYLOAD_BYTES) throw new RangeError('The message is too long for a push');
  const uaPublic = base64UrlDecode(target.p256dh);
  const authSecret = base64UrlDecode(target.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 0x04 || authSecret.length !== 16) throw new RangeError('Not a push subscription');

  let server = opts.serverKeys;
  if (!server) {
    const pair = await crypto.subtle.generateKey(ECDH, true, ['deriveBits']);
    server = { privateKey: pair.privateKey, publicKey: new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)) };
  }
  const asPublic = new Uint8Array(server.publicKey);
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, ECDH, true, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, server.privateKey, 256));

  const ikm = await hkdf(authSecret, ecdhSecret, concat(encoder.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = opts.salt ? new Uint8Array(opts.salt) : crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode('Content-Encoding: nonce\0'), 12);
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // 0x02: the last (and only) record's padding delimiter.
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, concat(plaintext, new Uint8Array([2]))));

  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  return concat(header, asPublic, ciphertext);
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
  /** The VAPID public key it was subscribed with. */
  vapidKey: string;
}

export type DeliveryOutcome = 'ok' | 'gone' | 'failed' | 'skipped';

export interface DeliveryReport {
  endpoint: string;
  outcome: DeliveryOutcome;
  error?: string;
  /** Worth trying again later (network, 429, 5xx). */
  transient?: boolean;
  status?: number;
}

export interface SendOptions {
  /** Seconds the push service keeps it for an offline device. */
  ttl: number;
  /** Replaces an undelivered message with the same topic. */
  topic?: string;
  urgency?: 'very-low' | 'low' | 'normal' | 'high';
}

export interface PushSender {
  send(target: PushTarget, payload: string, opts: SendOptions): Promise<DeliveryReport>;
}

export function createWebPushSender(vapid: VapidConfig, deps: { fetch: typeof fetch; nowMs: () => number; timeoutMs?: number }): PushSender {
  return {
    async send(target, payload, opts) {
      const endpoint = target.endpoint;
      // push.sql refuses these when they're saved; this holds even for a row saved before that rule.
      if (!isAllowedPushEndpoint(endpoint)) return { endpoint, outcome: 'skipped', error: 'host' };
      let body: Uint8Array<ArrayBuffer>;
      let authorization: string;
      try {
        body = await encryptPayload(encoder.encode(payload), target);
        authorization = await vapidAuthorization(endpoint, vapid, Math.floor(deps.nowMs() / 1000));
      } catch {
        return { endpoint, outcome: 'failed', error: 'encrypt', transient: false };
      }
      const headers: Record<string, string> = {
        'Content-Type': 'application/octet-stream',
        'Content-Encoding': 'aes128gcm',
        TTL: String(Math.max(0, Math.round(opts.ttl))),
        Authorization: authorization,
      };
      if (opts.urgency) headers.Urgency = opts.urgency;
      if (opts.topic && TOPIC.test(opts.topic)) headers.Topic = opts.topic;

      let response: Response;
      try {
        response = await deps.fetch(endpoint, { method: 'POST', headers, body, signal: AbortSignal.timeout(deps.timeoutMs ?? 10_000) });
      } catch {
        return { endpoint, outcome: 'failed', error: 'network', transient: true };
      }
      const status = response.status;
      // The body isn't needed; reading it frees the connection.
      await response.body?.cancel().catch(() => undefined);
      if (status === 200 || status === 201 || status === 202) return { endpoint, outcome: 'ok', status };
      if (status === 404 || status === 410) return { endpoint, outcome: 'gone', status };
      const transient = status === 429 || status >= 500;
      return { endpoint, outcome: 'failed', error: `http ${status}`, transient, status };
    },
  };
}
