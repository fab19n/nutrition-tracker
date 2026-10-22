/**
 * The account side of reminders (decision §10.19): the push_* functions in supabase/push.sql, called
 * as the signed-in user, and the send-reminders function's test notification.
 *
 * The RPCs are made the way src/sync/remote.ts makes them: getAuth() first (null is 'needsSignIn'),
 * the token pinned as the Bearer, given up after 15 s ('unreachable'), every failure a SyncError
 * through toSyncError (a missing function is 'notSetUp'), and every reply checked by hand (a shape
 * this version doesn't expect is 'rejected'). test() never throws: it answers with an outcome.
 *
 * supabase-js comes from getSupabase(), loaded on first use: only its types are imported here.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAuth, type AuthInfo } from '@/auth/session';
import { getSupabase, readSupabaseConfig } from '@/auth/supabase';
import type { SyncErrorKind } from '@/db/syncTypes';
import { isSyncError, SyncError, toSyncError } from '@/sync/errors';
import { pushFunctionUrl } from './config';

export interface PushSubscriptionWire {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** What the account says about this device's subscription (push_device). Never its keys. */
export interface PushDeviceInfo {
  found: boolean;
  lastOkAt?: string;
  lastError?: string;
  failures: number;
  vapidKey?: string;
}

export type TestOutcome =
  | { ok: true }
  | { ok: false; kind: SyncErrorKind | 'notSubscribed' | 'gone' | 'rateLimited' | 'keyMismatch' | 'pushFailed' };

export interface PushRemote {
  /** Saves (or moves) this device's subscription for the signed-in user. Throws a SyncError. */
  subscribe(sub: PushSubscriptionWire, opts: { vapidKey: string; label?: string; replaces?: string }): Promise<void>;
  /** Removes it. Throws a SyncError. */
  unsubscribe(endpoint: string): Promise<void>;
  /** Throws a SyncError. */
  device(endpoint: string): Promise<PushDeviceInfo>;
  /** A test notification to this device only. Never throws. */
  test(endpoint: string): Promise<TestOutcome>;
}

type PushFn = 'push_subscribe' | 'push_unsubscribe' | 'push_device';

/** A call that hasn't answered by then is given up as 'unreachable'. */
const CALL_TIMEOUT_MS = 15_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rejected(fn: string, what: string): SyncError {
  return new SyncError('rejected', `${fn} answered ${what}`);
}

/** The signed-in user's token, or a SyncError: 'needsSignIn', or the connection when it couldn't be checked. */
async function authOrThrow(): Promise<AuthInfo> {
  let auth: AuthInfo | null;
  try {
    auth = await getAuth();
  } catch (error) {
    if (isSyncError(error)) throw error;
    throw toSyncError(0, error);
  }
  if (!auth) throw new SyncError('needsSignIn', 'Sign in to turn on reminders');
  return auth;
}

/** Checks the session, then calls `fn` with the token pinned. Resolves with the reply's JSON, not yet checked. */
async function call(fn: PushFn, args: Record<string, unknown>): Promise<unknown> {
  const auth = await authOrThrow();
  let client: SupabaseClient | null;
  try {
    client = await getSupabase();
  } catch (error) {
    throw new SyncError('offline', "supabase-js couldn't load", { cause: error });
  }
  if (!client) throw new SyncError('needsSignIn', "Sign-in isn't set up");

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, CALL_TIMEOUT_MS);
  try {
    const { data, error, status } = await client.rpc(fn, args).setHeader('Authorization', `Bearer ${auth.token}`).abortSignal(controller.signal);
    if (timedOut) throw new SyncError('unreachable', `${fn} took too long to answer`);
    if (error) {
      if (status >= 200 && status < 300) throw new SyncError('rejected', `${fn} answered something that isn't JSON`, { cause: error });
      throw toSyncError(status, error);
    }
    const reply: unknown = data;
    return reply;
  } catch (error) {
    if (isSyncError(error)) throw error;
    throw new SyncError(timedOut ? 'unreachable' : 'failed', undefined, { cause: error });
  } finally {
    clearTimeout(timer);
  }
}

function parseSaved(reply: unknown): void {
  if (!isRecord(reply) || reply.saved !== true) throw rejected('push_subscribe', 'without saved: true');
}

function parseRemoved(reply: unknown): void {
  if (!isRecord(reply) || typeof reply.removed !== 'number') throw rejected('push_unsubscribe', 'without a count');
}

function parseDevice(reply: unknown): PushDeviceInfo {
  if (!isRecord(reply) || typeof reply.found !== 'boolean') throw rejected('push_device', 'without found');
  if (!reply.found) return { found: false, failures: 0 };
  const { lastOkAt, lastError, failures, vapidKey } = reply;
  if (typeof failures !== 'number' || !Number.isInteger(failures) || failures < 0) throw rejected('push_device', 'a bad failure count');
  const info: PushDeviceInfo = { found: true, failures };
  if (typeof lastOkAt === 'string') info.lastOkAt = lastOkAt;
  if (typeof lastError === 'string') info.lastError = lastError;
  if (typeof vapidKey === 'string') info.vapidKey = vapidKey;
  return info;
}

function offlineOrUnreachable(): TestOutcome {
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  return { ok: false, kind: offline ? 'offline' : 'unreachable' };
}

async function codeOf(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.json();
    return isRecord(body) && typeof body.code === 'string' ? body.code : undefined;
  } catch {
    return undefined;
  }
}

/** The function's answer to a test, as an outcome (see supabase/functions/send-reminders/handler.ts). */
async function testOutcome(response: Response): Promise<TestOutcome> {
  const { status } = response;
  if (status >= 200 && status < 300) return { ok: true };
  if (status === 401) return { ok: false, kind: 'needsSignIn' };
  // The gateway's answer when the function isn't deployed.
  if (status === 404) return { ok: false, kind: 'notSetUp' };
  if (status === 409) {
    const code = await codeOf(response);
    if (code === 'notSubscribed' || code === 'keyMismatch') return { ok: false, kind: code };
    return { ok: false, kind: 'failed' };
  }
  if (status === 410) return { ok: false, kind: 'gone' };
  if (status === 429) return { ok: false, kind: 'rateLimited' };
  if (status === 502) return { ok: false, kind: 'pushFailed' };
  if (status === 503 && (await codeOf(response)) === 'notConfigured') return { ok: false, kind: 'notSetUp' };
  if (status >= 500) return { ok: false, kind: 'unavailable' };
  if (status === 400) return { ok: false, kind: 'rejected' };
  return { ok: false, kind: 'failed' };
}

async function sendTest(endpoint: string): Promise<TestOutcome> {
  const url = pushFunctionUrl();
  const config = readSupabaseConfig();
  if (!url || !config) return { ok: false, kind: 'notSetUp' };
  let auth: AuthInfo;
  try {
    auth = await authOrThrow();
  } catch (error) {
    return { ok: false, kind: isSyncError(error) ? error.kind : 'failed' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${auth.token}`, apikey: config.key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'test', endpoint }),
      signal: controller.signal,
    });
    return await testOutcome(response);
  } catch {
    return offlineOrUnreachable();
  } finally {
    clearTimeout(timer);
  }
}

/** The push functions, called through the shared Supabase client as the signed-in user. */
export function createSupabasePushRemote(): PushRemote {
  return {
    subscribe: async (sub, opts) => {
      const args = {
        p_endpoint: sub.endpoint,
        p_p256dh: sub.p256dh,
        p_auth: sub.auth,
        p_vapid_key: opts.vapidKey,
        p_label: opts.label ?? null,
        p_replaces: opts.replaces ?? null,
      };
      parseSaved(await call('push_subscribe', args));
    },
    unsubscribe: async (endpoint) => parseRemoved(await call('push_unsubscribe', { p_endpoint: endpoint })),
    device: async (endpoint) => parseDevice(await call('push_device', { p_endpoint: endpoint })),
    test: sendTest,
  };
}
