/**
 * Who may call the estimate function, and how often. Runtime-agnostic (fetch-era globals only,
 * no imports) so the Edge Function (Deno, ./index.ts) and the Node tests share it.
 *
 * - The caller sends the signed-in user's Supabase access token: `Authorization: Bearer <jwt>`.
 * - `verify(token)` is injected: index.ts verifies the JWT with supabase-js (auth.getClaims).
 * - Only emails on ALLOWED_EMAILS get through; an empty list lets nobody in.
 * - CORS echoes the request Origin only when it is on ALLOWED_ORIGIN.
 * - A per-user in-memory limiter is a best-effort guard; the Anthropic console spend limit is the
 *   real cap, because Edge Function instances are short-lived and don't share memory.
 */

/** A verified caller. */
export interface Identity {
  email: string;
}

/** Verifies an access token; null when it isn't a valid signed-in user. May throw when the check itself fails. */
export type VerifyToken = (token: string) => Promise<Identity | null>;

export type AuthResult =
  | { ok: true; email: string }
  | { ok: false; status: 401; code: 'notSignedIn'; error: string }
  | { ok: false; status: 403; code: 'forbidden'; error: string }
  | { ok: false; status: 503; code: 'upstream'; error: string };

/** A comma-separated env value (ALLOWED_EMAILS, ALLOWED_ORIGIN) or a ready list, trimmed, blanks dropped. */
export type ListSetting = string | readonly string[] | undefined;

export function parseList(raw: ListSetting): string[] {
  const parts = typeof raw === 'string' ? raw.split(',') : (raw ?? []);
  return parts.map((part) => part.trim()).filter((part) => part !== '');
}

// ---------------------------------------------------------------------------
// Who
// ---------------------------------------------------------------------------

/** The token from `Authorization: Bearer <token>`, or null when the header is missing or malformed. */
export function readBearer(req: Request): string | null {
  const header = req.headers.get('authorization');
  if (!header) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header.trim());
  return match?.[1] ?? null;
}

/** Case-insensitive, trimmed match against the allow list. An empty list allows nobody. */
export function isAllowedEmail(email: string | null | undefined, allowList: ListSetting): boolean {
  const wanted = email?.trim().toLowerCase();
  if (!wanted) return false;
  return parseList(allowList).some((allowed) => allowed.toLowerCase() === wanted);
}

/**
 * The identity in verified JWT claims: only signed-in users (role "authenticated") with an email.
 * Rejects the anon/service-role keys and anonymous sign-ins, which have no email.
 */
export function identityFromClaims(claims: unknown): Identity | null {
  if (!claims || typeof claims !== 'object') return null;
  const { role, email } = claims as { role?: unknown; email?: unknown };
  if (role !== 'authenticated' || typeof email !== 'string' || email.trim() === '') return null;
  return { email: email.trim() };
}

export async function authorize(req: Request, verify: VerifyToken, allowedEmails: ListSetting): Promise<AuthResult> {
  const token = readBearer(req);
  if (!token) return { ok: false, status: 401, code: 'notSignedIn', error: 'Sign in to use AI estimates.' };

  let identity: Identity | null;
  try {
    identity = await verify(token);
  } catch {
    return { ok: false, status: 503, code: 'upstream', error: 'Sign-in could not be checked. Try again shortly.' };
  }
  if (!identity) return { ok: false, status: 401, code: 'notSignedIn', error: 'Sign in again to use AI estimates.' };
  if (!isAllowedEmail(identity.email, allowedEmails)) {
    return { ok: false, status: 403, code: 'forbidden', error: "This account can't use AI estimates." };
  }
  return { ok: true, email: identity.email.trim().toLowerCase() };
}

/**
 * The anon/publishable key the platform gives Edge Functions: the "default" entry of
 * SUPABASE_PUBLISHABLE_KEYS (a JSON object keyed by name), else SUPABASE_PUBLISHABLE_KEY (local
 * CLI), else the legacy SUPABASE_ANON_KEY.
 */
export function publicKeyFromEnv(get: (name: string) => string | undefined): string | undefined {
  const raw = get('SUPABASE_PUBLISHABLE_KEYS');
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
  return get('SUPABASE_PUBLISHABLE_KEY') || get('SUPABASE_ANON_KEY') || undefined;
}

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

export const CORS_ALLOW_HEADERS = 'authorization, apikey, content-type, x-client-info';
export const CORS_ALLOW_METHODS = 'POST, OPTIONS';

function normaliseOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, '').toLowerCase();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Whether `origin` is on the allow list. Entries are exact origins ("https://kira-makan.vercel.app",
 * "http://localhost:5173"); a `*` stands for part of one host label, so
 * "https://kira-makan-*-fabian.vercel.app" covers Vercel preview URLs but never crosses a dot.
 */
export function isAllowedOrigin(origin: string | null | undefined, allowList: ListSetting): boolean {
  if (!origin || origin === 'null') return false;
  const wanted = normaliseOrigin(origin);
  return parseList(allowList).some((entry) => {
    const allowed = normaliseOrigin(entry);
    if (!allowed.includes('*')) return allowed === wanted;
    const pattern = allowed.split('*').map(escapeRegExp).join('[a-z0-9-]+');
    return new RegExp(`^${pattern}$`).test(wanted);
  });
}

/** CORS headers for a response: the request Origin is echoed back only when it's allowed. */
export function corsHeaders(origin: string | null | undefined, allowList: ListSetting): Record<string, string> {
  if (!origin || !isAllowedOrigin(origin, allowList)) return { Vary: 'Origin' };
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': CORS_ALLOW_HEADERS,
    'Access-Control-Allow-Methods': CORS_ALLOW_METHODS,
    'Access-Control-Expose-Headers': 'Retry-After',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

// ---------------------------------------------------------------------------
// Rate limit
// ---------------------------------------------------------------------------

export type RateDecision = { ok: true; remaining: number } | { ok: false; retryAfterSeconds: number };

export interface RateLimiter {
  /** Counts one request for `key` if it's under the limit. */
  take(key: string): RateDecision;
}

export interface RateLimiterOptions {
  limit: number;
  windowMs: number;
  now?: () => number;
  /** Above this many tracked keys, keys with no recent requests are dropped. */
  maxKeys?: number;
}

export const ESTIMATES_PER_HOUR = 30;

/**
 * Sliding-window limiter held in memory. Best effort only: each Edge Function instance has its
 * own memory and instances are recycled, so the true cap is the Anthropic console spend limit.
 */
export function createRateLimiter({ limit, windowMs, now = Date.now, maxKeys = 1000 }: RateLimiterOptions): RateLimiter {
  const hits = new Map<string, number[]>();

  function sweep(at: number): void {
    for (const [key, times] of hits) {
      const newest = times[times.length - 1];
      if (newest === undefined || at - newest >= windowMs) hits.delete(key);
    }
  }

  return {
    take(key) {
      const at = now();
      const recent = (hits.get(key) ?? []).filter((t) => at - t < windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        const oldest = recent[0] ?? at;
        return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - at) / 1000)) };
      }
      recent.push(at);
      hits.set(key, recent);
      if (hits.size > maxKeys) sweep(at);
      return { ok: true, remaining: limit - recent.length };
    },
  };
}
