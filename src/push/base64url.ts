/**
 * Base64url without padding (RFC 4648 §5), for VAPID keys and push subscription keys. No imports,
 * so the service worker (src/sw/push.ts) bundles it without pulling in the app.
 */

const BASE64URL = /^[A-Za-z0-9_-]*={0,2}$/;

/** Bytes → base64url without padding. */
export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Base64url (padded or not) → bytes, or null when it isn't base64url. */
export function base64UrlToBytes(text: string): Uint8Array | null {
  const trimmed = text.trim();
  if (!BASE64URL.test(trimmed)) return null;
  const plain = trimmed.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
  if (plain.length % 4 === 1) return null;
  try {
    const binary = atob(plain.padEnd(Math.ceil(plain.length / 4) * 4, '='));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** True when both hold the same bytes. */
export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  return a.every((byte, i) => byte === b[i]);
}
