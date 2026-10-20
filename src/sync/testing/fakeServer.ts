/**
 * An in-memory account store with the same rules as supabase/sync.sql, for tests only (never
 * imported by app code). Its cases match supabase/sync-selftest.sql.
 *
 * - `call(userId, fn, args)` answers like the RPC over the wire: JSON in, JSON out (keys as
 *   [t, k, rev] arrays, times in Postgres's JSON form), or a FakeRpcError with the HTTP status and
 *   SQLSTATE PostgREST would send. A stubbed fetch can serve it as is.
 * - `remote(options)` is a SyncRemote for one device on top of it: replies parsed into the
 *   ./remote shapes and failures turned into SyncErrors, plus hooks to delay, fail or lose a call.
 * - `wipe`, `rows`, `live` and `seed` set up and inspect the account.
 *
 * Times are kept in microseconds, as Postgres keeps them. A change whose `at` fits the pattern but
 * isn't a real time (30 February), or whose base is past bigint, is refused on its own, as the SQL
 * does. jsonb's text form is approximated for the 256 KB row limit (numbers print as JS prints them).
 */
import { SyncError, toSyncError } from '../errors';
import type { CloudKeys, CloudSummary, PullPage, PushReply, PushResult, RemoteCtx, SyncRemote, WireRow } from '../remote';
import type { JsonObject } from '../rows';

export type SyncFn = 'sync_hello' | 'sync_pull' | 'sync_keys' | 'sync_push';

export interface FakeCall {
  fn: SyncFn;
  userId: string | null;
  args: Record<string, unknown>;
}

/** A row as sync_rows holds it. Times are microseconds since 1970. */
export interface StoredRow {
  tbl: string;
  key: string;
  rev: number;
  deleted: boolean;
  data: JsonObject | null;
  changedAt: bigint;
  deviceId: string;
  nonce: string;
  serverAt: bigint;
}

/** sync_keys as it comes over the wire: each key is [t, k, rev]. */
export interface WireKeys {
  dataset: string | null;
  head: number;
  keys: [string, string, number][];
}

/** A PostgREST error reply: HTTP status plus the body's code, message, details and hint. */
export class FakeRpcError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: string | null;
  readonly hint: string | null = null;

  constructor(status: number, code: string, message: string, details: string | null = null) {
    super(message);
    this.name = 'FakeRpcError';
    this.status = status;
    this.code = code;
    this.details = details;
  }

  /** The JSON body PostgREST sends. */
  toJSON(): { code: string; message: string; details: string | null; hint: string | null } {
    return { code: this.code, message: this.message, details: this.details, hint: this.hint };
  }
}

export interface FakeServerOptions {
  /** The server clock, in ms (Postgres now()). Defaults to Date.now. */
  now?: () => number;
}

export interface FakeRemoteOptions {
  /** This device's clock, which stamps p_sent_at (ms). Defaults to Date.now. */
  clock?: () => number;
  /** Runs before a call reaches the server: throw to fail it, wait to delay it. */
  before?: (call: FakeCall, signal: AbortSignal) => void | Promise<void>;
  /** Runs after the server answered: throw to lose the reply (the server has applied it). */
  after?: (call: FakeCall, reply: unknown) => void | Promise<void>;
}

export interface FakeServer {
  call(userId: string | null, fn: SyncFn, args?: Record<string, unknown>): unknown;
  hello(userId: string | null): CloudSummary;
  pull(userId: string | null, after: unknown, limit?: unknown): PullPage;
  keys(userId: string | null): WireKeys;
  push(userId: string | null, args: { p_dataset: unknown; p_device: unknown; p_sent_at: unknown; p_changes: unknown }): PushReply;
  remote(options?: FakeRemoteOptions): SyncRemote;
  /** Every call, in order (seed and the inspection helpers aren't recorded). */
  readonly calls: FakeCall[];
  /** The account's rows, by revision. */
  rows(userId: string): StoredRow[];
  /** Live rows by table and key, for comparing with a device. */
  live(userId: string): Record<string, Record<string, JsonObject>>;
  head(userId: string): number;
  dataset(userId: string): string | undefined;
  /** Puts rows as if another device pushed them now (data null for a tombstone). */
  seed(userId: string, rows: readonly { t: string; k: string; data: JsonObject | null }[], deviceId?: string): PushReply;
  /** DEPLOY.md's wipe: rows gone, a new dataset, revision 0. */
  wipe(userId: string): void;
}

interface Account {
  dataset: string;
  rev: number;
  rows: Map<string, StoredRow>;
}

const TABLE_PATTERN = /^[a-zA-Z][a-zA-Z0-9]{0,39}$/;
const DEVICE_PATTERN = /^[A-Za-z0-9-]{1,64}$/;
const AT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;
const UUID_PATTERN = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
const TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)?$/;
const BIGINT_LIMIT = 2 ** 63;
const MAX_DATA_BYTES = 262_144;

function rowKey(tbl: string, key: string): string {
  return `${tbl}\u0000${key}`;
}

/** JSON in, JSON out: nothing a test holds is shared with the server. */
function wire<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** jsonb `->`: undefined is SQL NULL (missing key, or not an object). */
function field(value: unknown, name: string): unknown {
  return isObject(value) ? value[name] : undefined;
}

/** jsonb `->>`: strings as they are, JSON null and missing as SQL NULL, anything else as its JSON text. */
function text(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return typeof value === 'string' ? value : jsonbText(value);
}

function charLength(value: string): number {
  return [...value].length;
}

/** Postgres's jsonb text form: ", " and ": " between items. */
function jsonbText(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(jsonbText).join(', ')}]`;
  if (isObject(value)) return `{${Object.keys(value).map((k) => `${JSON.stringify(k)}: ${jsonbText(value[k])}`).join(', ')}}`;
  return JSON.stringify(value) ?? 'null';
}

/** jsonb can't hold \u0000: Postgres refuses the whole argument. */
function hasNul(value: unknown): boolean {
  if (typeof value === 'string') return value.includes('\u0000');
  if (Array.isArray(value)) return value.some(hasNul);
  if (isObject(value)) return Object.entries(value).some(([k, v]) => k.includes('\u0000') || hasNul(v));
  return false;
}

/** Half a UTF-16 surrogate pair, on its own: with the u flag a whole pair is one code point. */
const LONE_SURROGATE = /\p{Cs}/u;

/** Nor can JSON text hold half a surrogate pair: the body is refused before any argument is cast. */
function hasLoneSurrogate(value: unknown): boolean {
  if (typeof value === 'string') return LONE_SURROGATE.test(value);
  if (Array.isArray(value)) return value.some(hasLoneSurrogate);
  if (isObject(value)) return Object.entries(value).some(([k, v]) => LONE_SURROGATE.test(k) || hasLoneSurrogate(v));
  return false;
}

function daysInMonth(year: number, month: number): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month, 0); // day 0 of the next month: the last of this one
  return date.getUTCDate();
}

/** A timestamptz from text, in microseconds, or null where Postgres would refuse the value. */
function parseTimestamptz(value: string): bigint | null {
  const match = TIMESTAMP_PATTERN.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi, s, frac = '', zone = 'Z'] = match;
  const [year, month, day, hour, minute, second] = [y, mo, d, h, mi, s].map(Number) as [number, number, number, number, number, number];
  const micros = Number(frac.padEnd(6, '0') || '0');
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  // Postgres takes 24:00:00 (the next midnight) and a leap second (:60), and rolls them over.
  if (minute > 59 || second > 60 || hour > 24 || (hour === 24 && (minute > 0 || second > 0 || micros > 0))) return null;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  let total = BigInt(date.getTime()) * 1000n + BigInt((hour * 60 + minute) * 60 + second) * 1_000_000n + BigInt(micros);
  if (zone !== 'Z') {
    const sign = zone.startsWith('-') ? -1n : 1n;
    const digits = zone.slice(1).replace(':', '');
    const offset = BigInt(Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4) || '0')) * 60_000_000n;
    total -= sign * offset;
  }
  return total;
}

/** to_json(timestamptz) in a UTC session: 2026-01-01T00:00:00.123+00:00 (trailing zeros dropped). */
function formatTimestamptz(micros: bigint): string {
  let ms = micros / 1000n;
  let rest = micros % 1000n;
  if (rest < 0n) {
    ms -= 1n;
    rest += 1000n;
  }
  const date = new Date(Number(ms));
  const fraction = String(date.getUTCMilliseconds() * 1000 + Number(rest)).padStart(6, '0').replace(/0+$/, '');
  return `${date.toISOString().slice(0, 19)}${fraction ? `.${fraction}` : ''}+00:00`;
}

/** numeric::bigint: rounds half away from zero, and raises past the bigint range. */
function toBigint(value: number): number {
  const rounded = Math.sign(value) * Math.round(Math.abs(value));
  if (!Number.isFinite(rounded) || rounded >= BIGINT_LIMIT || rounded < -BIGINT_LIMIT) throw new RangeError('bigint out of range');
  return rounded;
}

function invalidInput(type: string, value: unknown): FakeRpcError {
  return new FakeRpcError(400, '22P02', `invalid input syntax for type ${type}: "${String(value)}"`);
}

/** A whole-number argument (bigint or integer), null when absent. */
function integerArg(value: unknown, type: string): number | null {
  if (value === undefined || value === null) return null;
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isInteger(number)) throw invalidInput(type, value);
  return number;
}

export function createFakeServer(options: FakeServerOptions = {}): FakeServer {
  const clock = options.now ?? (() => Date.now());
  const accounts = new Map<string, Account>();
  const calls: FakeCall[] = [];

  const nowMicros = (): bigint => BigInt(Math.round(clock())) * 1000n;

  /** sync_caller(): the signed-in user, or a 401. */
  function caller(userId: string | null): string {
    if (!userId) throw new FakeRpcError(401, 'PT401', 'Sign in to sync');
    return userId;
  }

  function record(fn: SyncFn, userId: string | null, args: Record<string, unknown>): void {
    calls.push({ fn, userId, args: wire(args) });
  }

  function helloImpl(userId: string | null): CloudSummary {
    const uid = caller(userId);
    let account = accounts.get(uid);
    if (!account) {
      account = { dataset: globalThis.crypto.randomUUID(), rev: 0, rows: new Map() };
      accounts.set(uid, account);
    }
    const counts: Record<string, number> = {};
    let last: bigint | null = null;
    for (const row of account.rows.values()) {
      if (!row.deleted) counts[row.tbl] = (counts[row.tbl] ?? 0) + 1;
      if (last === null || row.serverAt > last) last = row.serverAt;
    }
    return { dataset: account.dataset, head: account.rev, counts, lastChangeAt: last === null ? null : formatTimestamptz(last) };
  }

  function pullImpl(userId: string | null, afterArg: unknown, limitArg: unknown): PullPage {
    const after = integerArg(afterArg, 'bigint');
    const limit = integerArg(limitArg, 'integer');
    const account = accounts.get(caller(userId));
    const from = Math.max(after ?? 0, 0);
    const take = Math.min(Math.max(limit ?? 500, 1), 1000);
    const rows: WireRow[] = [...(account?.rows.values() ?? [])]
      .filter((r) => r.rev > from)
      .sort((a, b) => a.rev - b.rev)
      .slice(0, take)
      .map((r) => ({ t: r.tbl, k: r.key, rev: r.rev, del: r.deleted, data: r.data, at: formatTimestamptz(r.changedAt) }));
    return { dataset: account?.dataset ?? null, head: account?.rev ?? 0, rows };
  }

  function keysImpl(userId: string | null): WireKeys {
    const account = accounts.get(caller(userId));
    const keys = [...(account?.rows.values() ?? [])]
      .filter((r) => !r.deleted)
      .sort((a, b) => a.rev - b.rev)
      .map((r): [string, string, number] => [r.tbl, r.key, r.rev]);
    return { dataset: account?.dataset ?? null, head: account?.rev ?? 0, keys };
  }

  function pushImpl(
    userId: string | null,
    args: { p_dataset: unknown; p_device: unknown; p_sent_at: unknown; p_changes: unknown },
  ): PushReply {
    // The body is read as JSON, then arguments are cast, before the function runs.
    const { p_dataset: datasetArg, p_device: device, p_sent_at: sentAtArg, p_changes: changes } = args;
    if (hasLoneSurrogate(changes)) {
      throw new FakeRpcError(400, '22P02', 'invalid input syntax for type json', 'Unicode low surrogate must follow a high surrogate.');
    }
    if (datasetArg !== undefined && datasetArg !== null && (typeof datasetArg !== 'string' || !UUID_PATTERN.test(datasetArg))) {
      throw invalidInput('uuid', datasetArg);
    }
    let sentAt: bigint | null = null;
    if (sentAtArg !== undefined && sentAtArg !== null) {
      sentAt = typeof sentAtArg === 'string' ? parseTimestamptz(sentAtArg) : null;
      if (sentAt === null) throw new FakeRpcError(400, '22007', `invalid input syntax for type timestamp with time zone: "${String(sentAtArg)}"`);
    }
    if (hasNul(changes)) throw new FakeRpcError(400, '22P05', 'unsupported Unicode escape sequence');

    const uid = caller(userId);
    const now = nowMicros();
    const skew = sentAt === null ? 0n : now - sentAt;
    if (typeof device !== 'string' || !DEVICE_PATTERN.test(device)) throw new FakeRpcError(400, 'PT400', 'Missing device id');
    if (!Array.isArray(changes) || changes.length > 200) throw new FakeRpcError(400, 'PT400', 'Send at most 200 changes at a time');

    const account = accounts.get(uid);
    const dataset = typeof datasetArg === 'string' ? datasetArg.replace(/-/g, '').toLowerCase() : null;
    if (!account || account.dataset.replace(/-/g, '') !== dataset) {
      throw new FakeRpcError(409, 'PT409', 'The synced copy in this account changed');
    }
    const prevHead = account.rev;
    let head = account.rev;
    const results: PushResult[] = [];

    changes.forEach((change: unknown, i) => {
      const tbl = text(field(change, 't'));
      const key = text(field(change, 'k'));
      const nonce = text(field(change, 'n'));
      const del = field(change, 'del') === true;
      const data = del ? undefined : field(change, 'data');

      // A value that fits the pattern but can't be cast (30 February, a base past bigint) leaves `at` null: invalid.
      let at: bigint | null = null;
      let base: number | null = null;
      try {
        const baseArg = field(change, 'base');
        base = typeof baseArg === 'number' ? toBigint(baseArg) : null;
        const atText = text(field(change, 'at')) ?? '';
        if (AT_PATTERN.test(atText)) {
          const parsed = parseTimestamptz(atText);
          if (parsed === null) throw new RangeError('date/time field value out of range');
          const corrected = parsed + skew;
          // The device's clock offset is removed, and no edit can claim a time after the server's.
          at = corrected < now ? corrected : now;
        }
      } catch {
        at = null;
      }

      // A bad row never fails the batch: it's answered 'invalid' and the rest go through.
      if (
        tbl === null || !TABLE_PATTERN.test(tbl)
        || key === null || charLength(key) < 1 || charLength(key) > 200
        || nonce === null || charLength(nonce) < 1 || charLength(nonce) > 64
        || at === null
        || (!del && (!isObject(data) || new TextEncoder().encode(jsonbText(data)).length > MAX_DATA_BYTES))
        || (tbl === 'profile' && (del || field(data, 'demoMode') === true))
      ) {
        results.push({ i, s: 'invalid' });
        return;
      }

      const current = account.rows.get(rowKey(tbl, key));
      let wins: boolean;
      if (!current) {
        wins = true; // new to the account
      } else if (current.deviceId === device && current.nonce === nonce) {
        // A retry of a push whose answer was lost: already here.
        results.push({ i, s: 'ok', rev: current.rev });
        return;
      } else if (current.deviceId === device || current.rev === base) {
        wins = true; // made on top of the current copy
      } else {
        // Two edits that didn't see each other: the later one wins; a tie goes to the larger device id.
        wins = at > current.changedAt || (at === current.changedAt && device > current.deviceId);
      }

      if (wins) {
        head += 1;
        account.rows.set(rowKey(tbl, key), {
          tbl,
          key,
          rev: head,
          deleted: del,
          data: del ? null : (wire(data) as JsonObject),
          changedAt: at,
          deviceId: device,
          nonce,
          serverAt: now,
        });
        results.push({ i, s: 'ok', rev: head });
      } else if (current) {
        results.push({ i, s: 'lost', rev: current.rev, del: current.deleted, data: current.data === null ? null : wire(current.data) });
      }
    });

    account.rev = head;
    return { dataset: account.dataset, prevHead, head, results };
  }

  const server: FakeServer = {
    calls,

    call(userId, fn, args = {}) {
      switch (fn) {
        case 'sync_hello':
          return server.hello(userId);
        case 'sync_pull':
          return server.pull(userId, args.p_after, args.p_limit);
        case 'sync_keys':
          return server.keys(userId);
        case 'sync_push': {
          const { p_dataset, p_device, p_sent_at, p_changes } = args;
          return server.push(userId, { p_dataset, p_device, p_sent_at, p_changes });
        }
      }
    },

    hello(userId) {
      record('sync_hello', userId, {});
      return wire(helloImpl(userId));
    },

    pull(userId, after, limit) {
      record('sync_pull', userId, { p_after: after, p_limit: limit });
      return wire(pullImpl(userId, after, limit));
    },

    keys(userId) {
      record('sync_keys', userId, {});
      return wire(keysImpl(userId));
    },

    push(userId, args) {
      record('sync_push', userId, args);
      return wire(pushImpl(userId, wire(args)));
    },

    remote(remoteOptions = {}) {
      const deviceClock = remoteOptions.clock ?? (() => Date.now());

      async function invoke<T>(ctx: RemoteCtx, fn: SyncFn, args: Record<string, unknown>, answer: () => T): Promise<T> {
        const call: FakeCall = { fn, userId: ctx.userId, args };
        if (ctx.signal.aborted) throw new SyncError('aborted');
        await remoteOptions.before?.(call, ctx.signal);
        if (ctx.signal.aborted) throw new SyncError('aborted');
        let reply: T;
        try {
          reply = answer();
        } catch (error) {
          if (error instanceof FakeRpcError) throw toSyncError(error.status, error.toJSON());
          throw error;
        }
        await remoteOptions.after?.(call, reply);
        // A reply that lands after the abort is dropped, as fetch drops it.
        if (ctx.signal.aborted) throw new SyncError('aborted');
        return reply;
      }

      return {
        hello: (ctx) => invoke(ctx, 'sync_hello', {}, () => server.hello(ctx.userId)),
        pull: (ctx, after, limit) =>
          invoke(ctx, 'sync_pull', { p_after: after, p_limit: limit }, () => server.pull(ctx.userId, after, limit)),
        keys: (ctx) =>
          invoke(ctx, 'sync_keys', {}, (): CloudKeys => {
            const reply = server.keys(ctx.userId);
            if (reply.dataset === null) throw new SyncError('rejected', 'sync_keys answered without a dataset');
            return { dataset: reply.dataset, head: reply.head, keys: reply.keys.map(([t, k, rev]) => ({ t, k, rev })) };
          }),
        push: (ctx, dataset, deviceId, changes) => {
          const args = { p_dataset: dataset, p_device: deviceId, p_sent_at: new Date(deviceClock()).toISOString(), p_changes: changes };
          return invoke(ctx, 'sync_push', args, () => server.push(ctx.userId, args));
        },
      };
    },

    rows(userId) {
      return [...(accounts.get(userId)?.rows.values() ?? [])].sort((a, b) => a.rev - b.rev).map((r) => ({ ...r, data: r.data && wire(r.data) }));
    },

    live(userId) {
      const out: Record<string, Record<string, JsonObject>> = {};
      for (const row of accounts.get(userId)?.rows.values() ?? []) {
        if (row.deleted || !row.data) continue;
        (out[row.tbl] ??= {})[row.key] = wire(row.data);
      }
      return out;
    },

    head(userId) {
      return accounts.get(userId)?.rev ?? 0;
    },

    dataset(userId) {
      return accounts.get(userId)?.dataset;
    },

    seed(userId, rows, deviceId = 'seed-device') {
      const { dataset } = helloImpl(userId);
      const at = new Date(Number(nowMicros() / 1000n)).toISOString();
      const changes = rows.map(({ t, k, data }) => ({ t, k, del: data === null, data, base: null, at, n: globalThis.crypto.randomUUID() }));
      return wire(pushImpl(userId, { p_dataset: dataset, p_device: deviceId, p_sent_at: at, p_changes: wire(changes) }));
    },

    wipe(userId) {
      const account = accounts.get(userId);
      if (!account) return;
      account.rows.clear();
      account.dataset = globalThis.crypto.randomUUID();
      account.rev = 0;
    },
  };

  return server;
}
