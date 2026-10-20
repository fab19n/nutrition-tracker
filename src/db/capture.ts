/**
 * Change capture for sync (ARCHITECTURE.md §6.2): a DBCore middleware that writes one marker per
 * changed `[table+key]` into `syncOutbox`, in the same transaction as the write, so the marker
 * commits or rolls back with it. No call site changes.
 *
 * - The outbox is coalesced: one entry per `[table+key]`, replaced on every write with a new
 *   `changedAt` and nonce (a `seenRev` it held is kept). The push reads the row as it is at push
 *   time: present means put, missing means delete. Undo closures and double puts need nothing
 *   special (an undo is a new write).
 * - `Table.clear()` (and a delete of a whole table, `toCollection().delete()`) is a local wipe and
 *   never recorded. Code that needs a deletion to reach other devices uses `delete`, `bulkDelete`
 *   or `where(…).delete()`.
 * - Nothing is recorded while capture is off (no Supabase, or a test database), in demo mode, for
 *   photos and the sync tables, or in a transaction that called `markUncaptured()`.
 */
import Dexie, { type DBCore, type DBCoreMutateRequest, type DBCoreMutateResponse, type DBCoreTable, type Middleware } from 'dexie';
import { isDemoClock } from '@/domain/clock';
import type { OutboxEntry } from './syncTypes';

export const OUTBOX = 'syncOutbox';
/** DBCoreRangeType.Any (a const enum in dexie.d.ts, not importable): what Table.clear() sends. */
const ANY_RANGE = 3;
const uncaptured = new WeakSet<object>();

/** First line inside db.transaction() for writes that must not sync: pull and push answers, restore, link, demo load. Nested transactions share it. */
export function markUncaptured(): void {
  const tx = Dexie.currentTransaction;
  if (!tx) throw new Error('markUncaptured() runs inside a transaction');
  uncaptured.add(tx.idbtrans);
}

export function createCaptureMiddleware(opts: { tables: ReadonlySet<string>; enabled: () => boolean }): Middleware<DBCore> {
  return {
    stack: 'dbcore', name: 'kiraMakanSyncCapture', level: 10,
    create(down) {
      // Dexie builds the stack on the old schema while it upgrades a version 1 database, before the
      // outbox exists: nothing is captured there, and the stack is built again once the db is open.
      if (!down.schema.tables.some((t) => t.name === OUTBOX)) return {};
      return {
        ...down,
        // Every write transaction on a synced table also opens the outbox, so the marker commits or
        // rolls back with the write (auto, explicit and nested transactions alike).
        transaction(stores, mode, options) {
          const widen = mode === 'readwrite' && !stores.includes(OUTBOX) && stores.some((s) => opts.tables.has(s));
          return down.transaction(widen ? [...stores, OUTBOX] : stores, mode, options);
        },
        table(name) {
          const table = down.table(name);
          if (!opts.tables.has(name)) return table; // photos and the sync tables pass through
          const outbox = down.table(OUTBOX);
          return { ...table, mutate: (req) => capture(table, outbox, name, req, opts.enabled) };
        },
      };
    },
  };
}

/*
 * Continuations chain on Dexie.Promise rather than native await: the layers below read the current
 * transaction from Dexie's zone on every call, and a Dexie.Promise callback always runs in the zone
 * it was chained in (native await keeps it only through Dexie's best-effort zone echo).
 */
function capture(table: DBCoreTable, outbox: DBCoreTable, name: string, req: DBCoreMutateRequest, enabled: () => boolean): Promise<DBCoreMutateResponse> {
  if (!enabled() || uncaptured.has(req.trans) || isDemoClock()) return table.mutate(req);
  if (req.type !== 'deleteRange') return record(table, outbox, name, req, req.type === 'delete' ? req.keys : undefined);
  // Table.clear() is always a local wipe (Delete everything, Leave demo, setup, demo load): never a cloud delete.
  if (req.range.type === ANY_RANGE) return table.mutate(req);
  // A key range (where(':id').between(…).delete()) doesn't say which rows went, so they're listed first.
  const listing = table.query({ trans: req.trans, values: false, query: { index: table.schema.primaryKey, range: req.range } });
  return Dexie.Promise.resolve(listing).then(({ result }) => record(table, outbox, name, req, result));
}

/** Runs the write, then puts a marker for each key it changed. */
function record(
  table: DBCoreTable,
  outbox: DBCoreTable,
  name: string,
  req: DBCoreMutateRequest,
  knownKeys: readonly unknown[] | undefined,
): Promise<DBCoreMutateResponse> {
  return Dexie.Promise.resolve(table.mutate(req)).then((res) => {
    // put and add answer with the keys they wrote (undefined where an item failed).
    const keys: readonly unknown[] = knownKeys
      ?? res.results
      ?? (req.type === 'put' || req.type === 'add' ? req.values.map((v: unknown) => table.schema.primaryKey.extractKey?.(v)) : []);
    // A range delete is one request: it fails as a whole.
    const failed = (i: number): boolean => (req.type === 'deleteRange' ? res.numFailures > 0 : res.failures[i] !== undefined);
    const changedAt = Date.now(); // the real clock, never domain now() (pinned in demo mode)
    const values = keys.flatMap((key, i): OutboxEntry[] =>
      typeof key === 'string' && !failed(i) ? [{ table: name, key, changedAt, nonce: globalThis.crypto.randomUUID() }] : []);
    if (values.length === 0) return res;
    // A revision a pull left to the change being replaced stays noted (`seenRev`, src/sync/local.ts).
    const before = outbox.getMany({ trans: req.trans, keys: values.map((v) => [v.table, v.key]) });
    return Dexie.Promise.resolve(before)
      .then((entries: readonly (OutboxEntry | undefined)[]) => {
        values.forEach((value, i) => {
          const seenRev = entries[i]?.seenRev;
          if (seenRev !== undefined) value.seenRev = seenRev;
        });
        return outbox.mutate({ type: 'put', trans: req.trans, values });
      })
      .then(() => res);
  });
}
