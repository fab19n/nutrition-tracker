/**
 * The Supabase client, created on first use from VITE_SUPABASE_URL and VITE_SUPABASE_KEY (the
 * project's publishable key or legacy anon key; both are public by design). Without them there
 * is no client and the app runs without an account.
 *
 * supabase-js is imported on first use, so it stays out of the app's first load (the service worker
 * still precaches its chunk for offline use). Nothing else imports a value from it: everywhere
 * else takes the client from getSupabase(). It serves sign-in (./session), whose token also
 * protects the AI estimate function (ARCHITECTURE.md §7), and the account's synced copy of the
 * diary (src/sync/remote.ts over supabase/sync.sql, §6.2).
 */
import type { SupabaseClient, SupportedStorage } from '@supabase/supabase-js';

export interface SupabaseConfig {
  /** Project URL without a trailing slash: https://<ref>.supabase.co */
  url: string;
  /** Publishable (sb_publishable_…) or legacy anon key. */
  key: string;
}

function envString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/** The project's URL and key, or null when either is missing or the URL isn't http(s). */
export function readSupabaseConfig(): SupabaseConfig | null {
  const url = envString(import.meta.env.VITE_SUPABASE_URL);
  const key = envString(import.meta.env.VITE_SUPABASE_KEY);
  if (!url || !key) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  } catch {
    return null;
  }
  return { url: url.replace(/\/+$/, ''), key };
}

/**
 * Where this project's session lives in localStorage: "kira-makan:sb-<ref>-auth" for a hosted
 * project, the host and port for a local one, so two projects never share a session.
 */
export function storageKeyFor(url: string): string {
  const { hostname, host } = new URL(url);
  const ref = hostname.endsWith('.supabase.co') ? hostname.split('.')[0] : host.replace(/[^a-z0-9]+/gi, '-');
  return `kira-makan:sb-${ref || 'project'}-auth`;
}

/*
 * localStorage that never throws: in private mode or with storage blocked the session is kept in
 * memory instead, so signing in still works until the app closes.
 */
const memory = new Map<string, string>();

export const sessionStorageAdapter = {
  getItem(key: string): string | null {
    try {
      const stored = window.localStorage.getItem(key);
      if (stored !== null) return stored;
    } catch {
      // Storage blocked: fall back to memory.
    }
    return memory.get(key) ?? null;
  },
  setItem(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value);
      memory.delete(key);
    } catch {
      memory.set(key, value);
    }
  },
  removeItem(key: string): void {
    memory.delete(key);
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Nothing stored there.
    }
  },
} satisfies SupportedStorage;

let clientPromise: Promise<SupabaseClient | null> | null = null;

async function createSupabase(config: SupabaseConfig): Promise<SupabaseClient> {
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(config.url, config.key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // Sign-in is by password in the app, never by emailed link, so nothing arrives in the URL.
      detectSessionInUrl: false,
      storage: sessionStorageAdapter,
      storageKey: storageKeyFor(config.url),
    },
  });
}

/**
 * The shared client, or null when Supabase isn't configured. If supabase-js can't load (offline
 * before it was ever cached) the call rejects and the next call tries again.
 */
export function getSupabase(): Promise<SupabaseClient | null> {
  const config = readSupabaseConfig();
  if (!config) return Promise.resolve(null);
  if (!clientPromise) {
    clientPromise = createSupabase(config).catch((error: unknown) => {
      clientPromise = null;
      throw error;
    });
  }
  return clientPromise;
}

/**
 * True while this project's session is stored. A refresh that fails on a bad connection keeps it;
 * a refresh token the server refused, or signing out, removes it.
 */
export function hasStoredSession(): boolean {
  const config = readSupabaseConfig();
  return config !== null && sessionStorageAdapter.getItem(storageKeyFor(config.url)) !== null;
}

/**
 * Removes this project's stored session directly. Used when signing out can't reach the server
 * and the client refuses to forget a session whose token has run out, and by Delete everything.
 */
export function clearStoredSession(): void {
  const config = readSupabaseConfig();
  if (!config) return;
  const key = storageKeyFor(config.url);
  sessionStorageAdapter.removeItem(key);
  sessionStorageAdapter.removeItem(`${key}-user`);
}

/** Tests only: forget the client so the next call builds a new one. */
export function resetSupabaseForTests(): void {
  clientPromise = null;
  memory.clear();
}
