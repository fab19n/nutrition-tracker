/**
 * Reminders' public settings (decision §10.19): the VAPID public key from VITE_VAPID_PUBLIC_KEY (public
 * by design: it names the server to the browser's push service) and the send-reminders function's
 * address on the Supabase project. Without Supabase or the key, reminders aren't set up in this build.
 * Env only: no database or network.
 */
import { readSupabaseConfig } from '@/auth/supabase';
import { base64UrlToBytes } from './base64url';

export const PUSH_FUNCTION_PATH = '/functions/v1/send-reminders';

/** The trimmed key when it is a P-256 public key (65 bytes starting 0x04) in base64url, else null. */
export function readVapidPublicKey(): string | null {
  const value: unknown = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (typeof value !== 'string') return null;
  const key = value.trim();
  const bytes = base64UrlToBytes(key);
  return bytes !== null && bytes.length === 65 && bytes[0] === 0x04 ? key : null;
}

/** The key's bytes, for PushManager.subscribe's applicationServerKey. */
export function vapidKeyBytes(key: string): Uint8Array<ArrayBuffer> {
  const bytes = base64UrlToBytes(key);
  if (!bytes) throw new RangeError('Not a VAPID public key');
  return new Uint8Array(bytes);
}

export function isPushConfigured(): boolean {
  return readSupabaseConfig() !== null && readVapidPublicKey() !== null;
}

/** https://<ref>.supabase.co/functions/v1/send-reminders, or null without Supabase. */
export function pushFunctionUrl(): string | null {
  const config = readSupabaseConfig();
  return config ? `${config.url}${PUSH_FUNCTION_PATH}` : null;
}
