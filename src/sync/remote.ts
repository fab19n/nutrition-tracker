/**
 * The account side of sync: the four `sync_*` functions in supabase/sync.sql, as the engine calls
 * them. Every reply is parsed into these shapes, and every failure is a SyncError (./errors).
 * src/sync/testing/fakeServer.ts implements the same contract in memory for tests.
 *
 * createSupabaseRemote() makes every call the same way:
 * 1. getAuth(): null is 'needsSignIn'; a session that can't be checked is 'offline' or 'unreachable'.
 * 2. A session for another user than the link's is 'aborted', so nothing is read from or sent to
 *    the wrong account.
 * 3. POST /rest/v1/rpc/sync_* with that session's token pinned as the Bearer, cancelled by the
 *    caller's signal or given up after 20 s ('unreachable').
 * 4. The reply is checked by hand: a shape this version doesn't expect is 'rejected'.
 *
 * supabase-js comes from getSupabase(), loaded on first use: only its types are imported here.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getAuth, type AuthInfo } from '@/auth/session';
import { getSupabase } from '@/auth/supabase';
import type { SyncTable } from '@/db/db';
import { isSyncError, SyncError, toSyncError } from './errors';
import type { JsonObject } from './rows';

/** sync_hello: the account's synced copy. `counts` lists only tables with live rows. */
export interface CloudSummary {
  dataset: string;
  head: number;
  counts: Partial<Record<string, number>>;
  /** When the account last took a change (server time, ISO), or null when it holds nothing. */
  lastChangeAt: string | null;
}

/** A row from sync_pull: the current version of `k` in table `t`, or its tombstone (`del`). */
export interface WireRow {
  t: string;
  k: string;
  rev: number;
  del: boolean;
  data: JsonObject | null;
  /** When the edit was made (offset-corrected, server format). */
  at: string;
}

/** Rows after a revision, oldest first. `dataset` is null before the account's first sync_hello. */
export interface PullPage {
  dataset: string | null;
  head: number;
  rows: WireRow[];
}

/** One change for sync_push: the row as it is now on this device (`del` when it's gone). */
export interface PushChange {
  t: SyncTable;
  k: string;
  del: boolean;
  data: JsonObject | null;
  /** The revision this device last had for the row, or null if it never had one. */
  base: number | null;
  /** When the edit was made, on this device's clock (ISO). */
  at: string;
  /** The edit's id: a retried push with the same id is recognised. */
  n: string;
}

/** The answer for change `i`: applied as `rev`, lost to the current version (returned), or refused. */
export type PushResult =
  | { i: number; s: 'ok'; rev: number }
  | { i: number; s: 'lost'; rev: number; del: boolean; data: JsonObject | null }
  | { i: number; s: 'invalid' };

/** `prevHead` to `head` are the revisions this push handed out, all of them to this device. */
export interface PushReply {
  dataset: string;
  prevHead: number;
  head: number;
  results: PushResult[];
}

/** sync_keys: every live key with its revision. */
export interface CloudKeys {
  dataset: string;
  head: number;
  keys: { t: string; k: string; rev: number }[];
}

/** Who the call is for (the linked account) and the signal that cancels it. */
export interface RemoteCtx {
  userId: string;
  signal: AbortSignal;
}

export interface SyncRemote {
  hello(ctx: RemoteCtx): Promise<CloudSummary>;
  pull(ctx: RemoteCtx, after: number, limit: number): Promise<PullPage>;
  push(ctx: RemoteCtx, dataset: string, deviceId: string, changes: readonly PushChange[]): Promise<PushReply>;
  keys(ctx: RemoteCtx): Promise<CloudKeys>;
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

type SyncFn = 'sync_hello' | 'sync_pull' | 'sync_keys' | 'sync_push';

/** A call that hasn't answered by then is given up as 'unreachable'. */
const CALL_TIMEOUT_MS = 20_000;

function abortedError(): SyncError {
  return new SyncError('aborted', 'The sync call was cancelled');
}

/** The promise, or 'aborted' as soon as the signal fires (getAuth can't be cancelled itself). */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortedError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/** The caller's signal or the timeout, whichever fires first. `dispose` stops the timer. */
function timeoutSignal(parent: AbortSignal, ms: number): { signal: AbortSignal; timedOut: () => boolean; dispose: () => void } {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = () => controller.abort(parent.reason);
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ms);
  if (parent.aborted) onAbort();
  else parent.addEventListener('abort', onAbort, { once: true });
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose() {
      clearTimeout(timer);
      parent.removeEventListener('abort', onAbort);
    },
  };
}

/** Checks the session, then calls `fn`. Resolves with the reply's JSON, not yet checked. */
async function call(ctx: RemoteCtx, fn: SyncFn, args: Record<string, unknown>): Promise<unknown> {
  if (ctx.signal.aborted) throw abortedError();
  let auth: AuthInfo | null;
  try {
    auth = await untilAborted(getAuth(), ctx.signal);
  } catch (error) {
    if (isSyncError(error)) throw error;
    // The session couldn't be checked (a refresh that failed on a bad connection).
    throw toSyncError(0, error);
  }
  if (!auth) throw new SyncError('needsSignIn', 'Sign in to sync');
  if (auth.userId !== ctx.userId) throw new SyncError('aborted', 'Signed in to another account');

  let client: SupabaseClient | null;
  try {
    client = await getSupabase();
  } catch (error) {
    throw new SyncError('offline', "supabase-js couldn't load", { cause: error });
  }
  if (!client) throw new SyncError('needsSignIn', "Sign-in isn't set up");
  if (ctx.signal.aborted) throw abortedError();

  const timeout = timeoutSignal(ctx.signal, CALL_TIMEOUT_MS);
  try {
    // postgrest-js answers every failure, a refused fetch included, as { error, status }.
    // The token is pinned: left alone, supabase-js would send whatever session it holds by then.
    const { data, error, status } = await client
      .rpc(fn, args)
      .setHeader('Authorization', `Bearer ${auth.token}`)
      .abortSignal(timeout.signal);
    // A reply that lands after the abort is dropped, as fetch drops it.
    if (ctx.signal.aborted) throw abortedError();
    if (timeout.timedOut()) throw new SyncError('unreachable', `${fn} took too long to answer`);
    if (error) {
      // A 2xx whose body isn't JSON (a proxy's page): not an answer this version can read.
      if (status >= 200 && status < 300) throw new SyncError('rejected', `${fn} answered something that isn't JSON`, { cause: error });
      throw toSyncError(status, error);
    }
    const reply: unknown = data;
    return reply;
  } catch (error) {
    if (isSyncError(error)) throw error;
    if (ctx.signal.aborted) throw abortedError();
    throw new SyncError(timeout.timedOut() ? 'unreachable' : 'failed', undefined, { cause: error });
  } finally {
    timeout.dispose();
  }
}

/** The account's sync functions, called through the shared Supabase client as the signed-in user. */
export function createSupabaseRemote(): SyncRemote {
  return {
    hello: async (ctx) => parseSummary(await call(ctx, 'sync_hello', {})),
    pull: async (ctx, after, limit) => parsePage(await call(ctx, 'sync_pull', { p_after: after, p_limit: limit })),
    keys: async (ctx) => parseKeys(await call(ctx, 'sync_keys', {})),
    push: async (ctx, dataset, deviceId, changes) => {
      const args = { p_dataset: dataset, p_device: deviceId, p_sent_at: new Date().toISOString(), p_changes: changes };
      return parsePushReply(await call(ctx, 'sync_push', args), changes.length);
    },
  };
}

// ---------------------------------------------------------------------------
// Replies
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Any object will do: the reply came from JSON.parse, so everything in it is JSON. */
function isJsonObject(value: unknown): value is JsonObject {
  return isRecord(value);
}

/** A head or a count: a whole number from 0. */
function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isRev(value: unknown): value is number {
  return isCount(value) && value > 0;
}

function isDataset(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

function rejected(fn: SyncFn, what: string): SyncError {
  return new SyncError('rejected', `${fn} answered ${what}`);
}

function parseSummary(reply: unknown): CloudSummary {
  if (!isRecord(reply)) throw rejected('sync_hello', 'something other than an object');
  const { dataset, head, counts, lastChangeAt } = reply;
  if (!isDataset(dataset)) throw rejected('sync_hello', 'without a dataset');
  if (!isCount(head)) throw rejected('sync_hello', 'without a head');
  if (!isRecord(counts)) throw rejected('sync_hello', 'without counts');
  if (lastChangeAt !== null && typeof lastChangeAt !== 'string') throw rejected('sync_hello', 'a bad lastChangeAt');
  const parsed: Partial<Record<string, number>> = {};
  for (const [table, count] of Object.entries(counts)) {
    if (!isCount(count)) throw rejected('sync_hello', `a bad count for ${table}`);
    parsed[table] = count;
  }
  return { dataset, head, counts: parsed, lastChangeAt };
}

function parseRow(value: unknown): WireRow | null {
  if (!isRecord(value)) return null;
  const { t, k, rev, del, data, at } = value;
  if (typeof t !== 'string' || typeof k !== 'string' || !isRev(rev) || typeof del !== 'boolean' || typeof at !== 'string') return null;
  if (data !== null && !isJsonObject(data)) return null;
  return { t, k, rev, del, data, at };
}

function parsePage(reply: unknown): PullPage {
  if (!isRecord(reply)) throw rejected('sync_pull', 'something other than an object');
  const { dataset, head, rows } = reply;
  // Null before the account's first sync_hello.
  if (dataset !== null && !isDataset(dataset)) throw rejected('sync_pull', 'a bad dataset');
  if (!isCount(head)) throw rejected('sync_pull', 'without a head');
  if (!Array.isArray(rows)) throw rejected('sync_pull', 'without rows');
  const list: unknown[] = rows;
  const parsed: WireRow[] = [];
  for (const value of list) {
    const row = parseRow(value);
    if (!row) throw rejected('sync_pull', 'a bad row');
    // The cursor moves to the last row's revision, so the rows must come oldest first.
    const previous = parsed.at(-1);
    if (previous && row.rev <= previous.rev) throw rejected('sync_pull', 'rows out of order');
    parsed.push(row);
  }
  return { dataset, head, rows: parsed };
}

function parseResult(value: unknown, sent: number): PushResult | null {
  if (!isRecord(value)) return null;
  const { i, s, rev, del, data } = value;
  if (!isCount(i) || i >= sent) return null;
  if (s === 'invalid') return { i, s };
  if (!isRev(rev)) return null;
  if (s === 'ok') return { i, s, rev };
  if (s !== 'lost' || typeof del !== 'boolean') return null;
  if (data !== null && !isJsonObject(data)) return null;
  return { i, s, rev, del, data };
}

function parsePushReply(reply: unknown, sent: number): PushReply {
  if (!isRecord(reply)) throw rejected('sync_push', 'something other than an object');
  const { dataset, prevHead, head, results } = reply;
  if (!isDataset(dataset)) throw rejected('sync_push', 'without a dataset');
  if (!isCount(prevHead) || !isCount(head) || head < prevHead) throw rejected('sync_push', 'bad heads');
  if (!Array.isArray(results)) throw rejected('sync_push', 'without results');
  const list: unknown[] = results;
  const parsed: PushResult[] = [];
  for (const value of list) {
    const result = parseResult(value, sent);
    if (!result) throw rejected('sync_push', 'a bad result');
    parsed.push(result);
  }
  return { dataset, prevHead, head, results: parsed };
}

function parseKeys(reply: unknown): CloudKeys {
  if (!isRecord(reply)) throw rejected('sync_keys', 'something other than an object');
  const { dataset, head, keys } = reply;
  // Null only before the account's first sync_hello, which always comes first.
  if (!isDataset(dataset)) throw rejected('sync_keys', 'without a dataset');
  if (!isCount(head)) throw rejected('sync_keys', 'without a head');
  if (!Array.isArray(keys)) throw rejected('sync_keys', 'without keys');
  const list: unknown[] = keys;
  const parsed: CloudKeys['keys'] = [];
  for (const value of list) {
    // Each key is [t, k, rev] on the wire.
    if (!Array.isArray(value) || value.length !== 3) throw rejected('sync_keys', 'a bad key');
    const [t, k, rev]: unknown[] = value;
    if (typeof t !== 'string' || typeof k !== 'string' || !isRev(rev)) throw rejected('sync_keys', 'a bad key');
    parsed.push({ t, k, rev });
  }
  return { dataset, head, keys: parsed };
}
