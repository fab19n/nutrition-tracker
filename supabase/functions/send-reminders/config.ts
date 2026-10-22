/**
 * The function's settings, read from its environment on every request (so changed secrets apply
 * without a redeploy). Runtime-agnostic: `get` is Deno.env.get in ./index.ts and a map in the tests.
 */
import { publicKeyFromEnv, type ListSetting } from '../estimate/auth.ts';
import { readVapidConfig, type VapidConfig } from './webpush.ts';

export interface ServerSettings {
  url?: string;
  publishableKey?: string;
  /** The service role's key: only the job's RPCs use it. */
  secretKey?: string;
  vapid: VapidConfig | null;
  /** Missing when unset or shorter than 32 characters. */
  cronSecret?: string;
  allowedOrigins: ListSetting;
}

/** A shorter cron secret counts as none: `npm run push:keys` makes 64 hex characters. */
const MIN_CRON_SECRET = 32;

/**
 * The project's secret key: the "default" entry of SUPABASE_SECRET_KEYS (a JSON object keyed by name),
 * else its first, else SUPABASE_SECRET_KEY (local CLI), else the legacy SUPABASE_SERVICE_ROLE_KEY.
 */
export function secretKeyFromEnv(get: (name: string) => string | undefined): string | undefined {
  const raw = get('SUPABASE_SECRET_KEYS');
  if (raw) {
    try {
      const keys: unknown = JSON.parse(raw);
      if (keys && typeof keys === 'object') {
        const named = keys as Record<string, unknown>;
        const chosen = typeof named.default === 'string' ? named.default : Object.values(named).find((v) => typeof v === 'string');
        if (typeof chosen === 'string' && chosen !== '') return chosen;
      }
    } catch {
      // Not JSON: fall through to the single-key variables.
    }
  }
  return get('SUPABASE_SECRET_KEY') || get('SUPABASE_SERVICE_ROLE_KEY') || undefined;
}

export function readServerSettings(get: (name: string) => string | undefined): ServerSettings {
  const settings: ServerSettings = { vapid: readVapidConfig(get), allowedOrigins: get('ALLOWED_ORIGIN') };
  const url = get('SUPABASE_URL')?.trim().replace(/\/+$/, '');
  const publishableKey = publicKeyFromEnv(get);
  const secretKey = secretKeyFromEnv(get);
  const cronSecret = get('CRON_SECRET')?.trim();
  if (url) settings.url = url;
  if (publishableKey) settings.publishableKey = publishableKey;
  if (secretKey) settings.secretKey = secretKey;
  if (cronSecret && cronSecret.length >= MIN_CRON_SECRET) settings.cronSecret = cronSecret;
  return settings;
}
