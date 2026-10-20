/**
 * The sync engine's local transactions (ARCHITECTURE.md §6.2). Each is one Dexie transaction that
 * reads syncMeta inside it, so a wipe, a sign-out or another tab that got there first is seen
 * before anything is written; a link that changed throws SyncError 'aborted' and writes nothing.
 * Every one that writes calls markUncaptured() first: what it writes came from (or is already in)
 * the account, so it must never be queued to go back.
 *
 * Rules, per row (`table`, `key`):
 * - The outbox entry says the row changed here; the push reads the row as it is then (present:
 *   put, missing: tombstone). syncRevs holds the account's revision this device last saw or sent,
 *   with the hash of that version, so a write that changes nothing that syncs never pushes.
 * - A pulled row with a real pending change here is left for the push to decide: the server weighs
 *   the two edits and a loss comes back with the winner. When another tab's pull skipped rows this
 *   way while our push was out, acknowledging the push moves the cursor back to fetch them again.
 *   The entry notes the revision it was left (`seenRev`); if the change then comes to nothing (an
 *   undo), nothing is sent and acknowledging that moves the cursor back to fetch it again too.
 * - The profile is never deleted by sync, and a demo profile never links.
 */
import { markUncaptured } from '@/db/capture';
import { SYNC_PROTOCOL, SYNC_TABLES, type KiraMakanDb, type SyncTable } from '@/db/db';
import type { OutboxEntry, RowRev, SyncErrorKind, SyncLink, SyncMeta } from '@/db/syncTypes';
import { SyncError } from './errors';
import type { CloudKeys, CloudSummary, PullPage, PushChange, PushReply, WireRow } from './remote';
import { canonicalJson, fromServerRow, hashJson, isRealChange, isSyncTable, toServerRow, wireHash, type DeviceDefaults } from './rows';

/** sync_push takes at most 200 changes. */
export const PUSH_ROWS = 200;
/** About this much JSON per push; a single larger row still goes alone. */
export const PUSH_BYTES = 512 * 1024;

/** The synced tables and the bookkeeping: the scope of every transaction that applies or acknowledges. */
const SYNC_SCOPE: string[] = [...SYNC_TABLES, 'syncOutbox', 'syncRevs', 'syncMeta'];

/** What collectPush gathered: `sent[i]` is where `changes[i]` came from. */
export interface PushBatch {
  changes: PushChange[];
  /** The entry each change came from (its nonce at collection) and the hash of what was sent. */
  sent: { table: SyncTable; key: string; nonce: string; hash: string }[];
  /** Entries with nothing to send (the account already has this version): dropped on acknowledgement. */
  noops: { table: string; key: string; nonce: string }[];
}

/** Everything the account holds, for a restore: the latest version of each key, tombstones included. */
export interface RestoreSnapshot {
  dataset: string;
  head: number;
  rows: readonly WireRow[];
}

/** A restore found the device in a state it can't replace (a profile appeared, or the account has none). */
export class RestoreConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RestoreConflict';
  }
}

type RowId = string;

function rowId(table: string, key: string): RowId {
  return `${table}\u0000${key}`;
}

function sameLink(stored: SyncLink | undefined, link: SyncLink): stored is SyncLink {
  return stored !== undefined && stored.userId === link.userId && stored.dataset === link.dataset && stored.deviceId === link.deviceId;
}

async function metaIn(db: KiraMakanDb): Promise<SyncMeta> {
  return (await db.syncMeta.get('sync')) ?? { id: 'sync' };
}

/** The stored link, when it is still the one the caller worked from. */
async function currentLink(db: KiraMakanDb, link: SyncLink): Promise<{ meta: SyncMeta; link: SyncLink }> {
  const meta = await metaIn(db);
  if (!sameLink(meta.link, link)) throw new SyncError('aborted', 'The sync link changed');
  return { meta, link: meta.link };
}

function queueEntry(table: string, key: string, changedAt: number): OutboxEntry {
  return { table, key, changedAt, nonce: globalThis.crypto.randomUUID() };
}

const GOAL_TABLES: ReadonlySet<string> = new Set<SyncTable>(['goals', 'goalVersions', 'goalPeriods']);

/**
 * When linking queues a row: the profile first, the goal next, then the rest (the push sends the
 * oldest first), so an upload cut short still leaves the account a diary a restore can open.
 */
function linkQueuedAt(table: string, now: number): number {
  if (table === 'profile') return now - 2;
  return GOAL_TABLES.has(table) ? now - 1 : now;
}

function newLink(a: { userId: string; email?: string }, dataset: string, cursor: number, now: number): SyncLink {
  return {
    userId: a.userId,
    ...(a.email ? { email: a.email } : {}),
    dataset,
    deviceId: globalThis.crypto.randomUUID(),
    cursor,
    protocol: SYNC_PROTOCOL,
    linkedAt: now,
  };
}

/** Linking needs a real profile and no link yet. */
async function assertCanLink(db: KiraMakanDb, meta: SyncMeta): Promise<void> {
  const profile = await db.profile.get('me');
  if (!profile || profile.demoMode || meta.link) throw new SyncError('aborted', 'This device can’t link now');
}

/** The local rows for these keys, in order (undefined where missing or not a synced table). */
async function readRows(db: KiraMakanDb, keys: readonly { table: string; key: string }[]): Promise<(unknown | undefined)[]> {
  const rows: (unknown | undefined)[] = keys.map(() => undefined);
  const byTable = new Map<SyncTable, { index: number; key: string }[]>();
  keys.forEach(({ table, key }, index) => {
    if (!isSyncTable(table)) return;
    const list = byTable.get(table) ?? [];
    list.push({ index, key });
    byTable.set(table, list);
  });
  for (const [table, list] of byTable) {
    const found = await db.table<unknown, string>(table).bulkGet(list.map((item) => item.key));
    list.forEach(({ index }, i) => {
      rows[index] = found[i];
    });
  }
  return rows;
}

async function allKeys(db: KiraMakanDb, table: SyncTable): Promise<string[]> {
  const keys = await db.table(table).toCollection().primaryKeys();
  return keys.filter((key): key is string => typeof key === 'string');
}

/** Puts and deletes per table, after the per-row decisions. */
async function writeRows(db: KiraMakanDb, writes: ReadonlyMap<RowId, { table: SyncTable; key: string; row: unknown | undefined }>): Promise<void> {
  const byTable = new Map<SyncTable, { puts: unknown[]; deletes: string[] }>();
  for (const { table, key, row } of writes.values()) {
    const group = byTable.get(table) ?? { puts: [], deletes: [] };
    if (row === undefined) group.deletes.push(key);
    else group.puts.push(row);
    byTable.set(table, group);
  }
  for (const [table, { puts, deletes }] of byTable) {
    const target = db.table<unknown, string>(table);
    if (deletes.length > 0) await target.bulkDelete(deletes);
    if (puts.length > 0) await target.bulkPut(puts);
  }
}

// ---------------------------------------------------------------------------
// Reading the state
// ---------------------------------------------------------------------------

export async function readMeta(db: KiraMakanDb): Promise<SyncMeta> {
  return metaIn(db);
}

/** Changes waiting here: `pending` will be sent, `failed` were refused and wait for the next app start. */
export async function pendingSummary(db: KiraMakanDb): Promise<{ pending: number; failed: number; mealKeys: string[] }> {
  const entries = await db.syncOutbox.toArray();
  let failed = 0;
  const mealKeys: string[] = [];
  for (const entry of entries) {
    if (entry.failedAt !== undefined) failed += 1;
    if (entry.table === 'meals') mealKeys.push(entry.key);
  }
  return { pending: entries.length - failed, failed, mealKeys };
}

// ---------------------------------------------------------------------------
// Linking
// ---------------------------------------------------------------------------

/**
 * Links to an account that holds no live rows, and queues every row here: the first upload,
 * which also covers the rows written before sync existed. Pulling starts after the account's head.
 * The link starts unchecked (`checkPending`): nothing is pushed until a pull from that head finds
 * no other device got there first (clearCheckPending), however many cycles that takes.
 */
export function linkEmptyAccount(
  db: KiraMakanDb,
  a: { userId: string; email?: string; summary: CloudSummary; now: number },
): Promise<{ queued: number }> {
  return db.transaction('rw', SYNC_SCOPE, async () => {
    markUncaptured();
    const meta = await metaIn(db);
    await assertCanLink(db, meta);
    const entries: OutboxEntry[] = [];
    for (const table of SYNC_TABLES) {
      for (const key of await allKeys(db, table)) entries.push(queueEntry(table, key, linkQueuedAt(table, a.now)));
    }
    await db.syncRevs.clear();
    await db.syncOutbox.bulkPut(entries);
    await db.syncMeta.put({ ...meta, link: { ...newLink(a, a.summary.dataset, a.summary.head, a.now), checkPending: true } });
    return { queued: entries.length };
  });
}

/** 'aborted' unless the stored link is still unchecked, at the cursor the check pulled from. */
function stillUnchecked(stored: SyncLink, link: SyncLink): void {
  if (!stored.checkPending || stored.cursor !== link.cursor) throw new SyncError('aborted', 'The sync link changed');
}

/**
 * The check after linkEmptyAccount passed: a pull from `link.cursor` found nothing, so no other
 * device uploaded first and this one may push. Returns the link as stored now. A link already
 * cleared (another tab checked it) comes back as it is; one that changed otherwise is 'aborted'.
 */
export function clearCheckPending(db: KiraMakanDb, link: SyncLink): Promise<SyncLink> {
  return db.transaction('rw', 'syncMeta', async () => {
    markUncaptured();
    const { meta, link: stored } = await currentLink(db, link);
    if (!stored.checkPending) return stored;
    stillUnchecked(stored, link);
    const next: SyncLink = { ...stored };
    delete next.checkPending;
    await db.syncMeta.put({ ...meta, link: next });
    return next;
  });
}

/**
 * The check after linkEmptyAccount found another device's rows: forgets this link, the queue and
 * the revisions, keeping the data, so the link flow can ask which copy to keep. Only while the link
 * is still unchecked as the caller saw it; a link another tab cleared or changed is 'aborted'.
 */
export function unlinkUnchecked(db: KiraMakanDb, link: SyncLink): Promise<void> {
  return db.transaction('rw', ['syncOutbox', 'syncRevs', 'syncMeta'], async () => {
    markUncaptured();
    const { meta, link: stored } = await currentLink(db, link);
    stillUnchecked(stored, link);
    await db.syncOutbox.clear();
    await db.syncRevs.clear();
    const next: SyncMeta = { id: 'sync' };
    if (meta.paused) next.paused = true;
    await db.syncMeta.put(next);
  });
}

/**
 * "Keep this device's data": links on top of the account's current revisions and queues every row
 * here, plus a tombstone for every account row this device doesn't have (never the profile).
 * Each push is then made on the current copy, so all of them apply.
 */
export function linkKeepingDevice(
  db: KiraMakanDb,
  a: { userId: string; email?: string; keys: CloudKeys; now: number },
): Promise<{ queued: number }> {
  return db.transaction('rw', SYNC_SCOPE, async () => {
    markUncaptured();
    const meta = await metaIn(db);
    await assertCanLink(db, meta);
    // Keys of tables this version doesn't sync are left alone: a protocol bump pulls them later.
    const cloud = a.keys.keys.filter(({ t }) => isSyncTable(t));
    await db.syncRevs.clear();
    await db.syncRevs.bulkPut(cloud.map(({ t, k, rev }): RowRev => ({ table: t, key: k, rev })));

    const queued = new Map<RowId, OutboxEntry>();
    for (const table of SYNC_TABLES) {
      for (const key of await allKeys(db, table)) queued.set(rowId(table, key), queueEntry(table, key, linkQueuedAt(table, a.now)));
    }
    for (const { t, k } of cloud) {
      if (t !== 'profile' && !queued.has(rowId(t, k))) queued.set(rowId(t, k), queueEntry(t, k, linkQueuedAt(t, a.now)));
    }
    await db.syncOutbox.bulkPut([...queued.values()]);
    await db.syncMeta.put({ ...meta, link: newLink(a, a.keys.dataset, a.keys.head, a.now) });
    return { queued: queued.size };
  });
}

/** Forgets the link, the queue and the revisions. The data stays; `pause` turns sync off here. */
export function unlinkKeepingData(db: KiraMakanDb, a: { pause?: boolean } = {}): Promise<void> {
  return db.transaction('rw', ['syncOutbox', 'syncRevs', 'syncMeta'], async () => {
    markUncaptured();
    await db.syncOutbox.clear();
    await db.syncRevs.clear();
    await db.syncMeta.put(a.pause ? { id: 'sync', paused: true } : { id: 'sync' });
  });
}

export function setPaused(db: KiraMakanDb, paused: boolean): Promise<void> {
  return db.transaction('rw', 'syncMeta', async () => {
    markUncaptured();
    const next: SyncMeta = { ...(await metaIn(db)) };
    if (paused) next.paused = true;
    else delete next.paused;
    await db.syncMeta.put(next);
  });
}

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------

/**
 * The next batch to push, oldest change first: up to 200 changes or about 512 KB of JSON. Entries
 * refused earlier (failedAt) wait for the next app start. Null when there is nothing to do.
 */
export function collectPush(db: KiraMakanDb, link: SyncLink, limits: { rows?: number; bytes?: number } = {}): Promise<PushBatch | null> {
  const maxRows = Math.max(1, Math.min(limits.rows ?? PUSH_ROWS, PUSH_ROWS));
  const maxBytes = limits.bytes ?? PUSH_BYTES;
  return db.transaction('r', SYNC_SCOPE, async () => {
    await currentLink(db, link);
    const entries = (await db.syncOutbox.orderBy('changedAt').toArray()).filter((e) => e.failedAt === undefined);
    const batch: PushBatch = { changes: [], sent: [], noops: [] };
    let bytes = 0;
    let full = false;
    for (let start = 0; start < entries.length && !full; start += maxRows) {
      const chunk = entries.slice(start, start + maxRows);
      const rows = await readRows(db, chunk);
      const revs = await db.syncRevs.bulkGet(chunk.map((e): [string, string] => [e.table, e.key]));
      for (const [i, entry] of chunk.entries()) {
        const { table, key, nonce } = entry;
        const row = rows[i];
        if (!isSyncTable(table) || !isRealChange(table, row, revs[i])) {
          batch.noops.push({ table, key, nonce });
          continue;
        }
        const change: PushChange = {
          t: table,
          k: key,
          del: row === undefined,
          data: row === undefined ? null : toServerRow(table, row),
          base: revs[i]?.rev ?? null,
          at: new Date(entry.changedAt).toISOString(),
          n: nonce,
        };
        const size = JSON.stringify(change).length;
        if (batch.changes.length > 0 && bytes + size > maxBytes) {
          full = true;
          break;
        }
        bytes += size;
        batch.changes.push(change);
        batch.sent.push({ table, key, nonce, hash: wireHash(table, row) });
        if (batch.changes.length >= maxRows) {
          full = true;
          break;
        }
      }
    }
    return batch.changes.length === 0 && batch.noops.length === 0 ? null : batch;
  });
}

/**
 * Records the answer to a push. An entry is dropped only when it is the one that was sent (same
 * nonce): a row edited while the push was out stays queued, now on top of the new revision.
 */
export function ackPush(
  db: KiraMakanDb,
  link: SyncLink,
  batch: PushBatch,
  reply: PushReply,
  defaults: DeviceDefaults,
): Promise<{ ok: number; lost: number; invalid: number }> {
  return db.transaction('rw', SYNC_SCOPE, async () => {
    markUncaptured();
    const { meta, link: stored } = await currentLink(db, link);
    if (reply.dataset !== stored.dataset) throw new SyncError('cloudReset', 'The synced copy in this account changed');
    const counts = { ok: 0, lost: 0, invalid: 0 };

    const drop: [string, string][] = [];
    const noopKeys = batch.noops.map((n): [string, string] => [n.table, n.key]);
    const noopEntries = await db.syncOutbox.bulkGet(noopKeys);
    const noopRevs = await db.syncRevs.bulkGet(noopKeys);
    // The oldest revision a pull left to a change that has since come to nothing (an undo).
    let leftBehind = Infinity;
    batch.noops.forEach((noop, i) => {
      const entry = noopEntries[i];
      if (entry?.nonce !== noop.nonce) return;
      drop.push([noop.table, noop.key]);
      if (entry.seenRev !== undefined && entry.seenRev > (noopRevs[i]?.rev ?? 0)) leftBehind = Math.min(leftBehind, entry.seenRev);
    });

    const sentKeys = batch.sent.map((s): [string, string] => [s.table, s.key]);
    const entries = await db.syncOutbox.bulkGet(sentKeys);
    const known = await db.syncRevs.bulkGet(sentKeys);
    const locals = await readRows(db, batch.sent);
    const revs: RowRev[] = [];
    const failed: OutboxEntry[] = [];
    const writes = new Map<RowId, { table: SyncTable; key: string; row: unknown | undefined }>();

    for (const result of reply.results) {
      const sent = batch.sent[result.i];
      if (!sent) continue;
      const { table, key } = sent;
      const entry = entries[result.i];
      const unchanged = entry?.nonce === sent.nonce;
      const knownRev = known[result.i]?.rev;
      counts[result.s] += 1;
      // A newer revision already arrived here (another tab pulled it): this answer is stale.
      if (result.s !== 'invalid' && knownRev !== undefined && knownRev > result.rev) continue;

      if (result.s === 'ok') {
        revs.push({ table, key, rev: result.rev, hash: sent.hash });
        if (unchanged) drop.push([table, key]);
      } else if (result.s === 'lost') {
        // A row edited again since stays queued on its old base, and the next push weighs it by time.
        if (!unchanged) continue;
        drop.push([table, key]);
        if (result.del && table === 'profile') continue; // never deleted by sync
        if (result.del) {
          revs.push({ table, key, rev: result.rev, hash: 'deleted' });
          if (locals[result.i] !== undefined) writes.set(rowId(table, key), { table, key, row: undefined });
          continue;
        }
        revs.push({ table, key, rev: result.rev, hash: hashJson(result.data) });
        const next = fromServerRow(table, key, result.data, locals[result.i], defaults);
        if (next !== null && canonicalJson(next) !== canonicalJson(locals[result.i])) {
          writes.set(rowId(table, key), { table, key, row: next });
        }
      } else if (unchanged && entry) {
        // Refused (a bad row): set aside until the next app start, so it never blocks the queue.
        failed.push({ ...entry, failedAt: Date.now() });
      }
    }

    await writeRows(db, writes);
    if (revs.length > 0) await db.syncRevs.bulkPut(revs);
    if (drop.length > 0) await db.syncOutbox.bulkDelete(drop);
    if (failed.length > 0) await db.syncOutbox.bulkPut(failed);
    let cursor = stored.cursor;
    // The push held the account's lock: every revision from prevHead to head is one of ours.
    if (reply.prevHead === stored.cursor) cursor = reply.head;
    // Another tab pulled past this push while it was out. Its pull left newer versions of the rows
    // we pushed to this answer (they were queued), and the answer can't apply them: pull them again.
    else if (stored.cursor > reply.head) cursor = reply.head;
    // A pull left a newer version of a row to a change that came to nothing: nothing was sent, so
    // nothing comes back, and the pull fetches that version again. (Sending the undone row instead
    // could beat that version with an edit that changes nothing.)
    if (leftBehind <= cursor) cursor = leftBehind - 1;
    if (cursor !== stored.cursor) await db.syncMeta.put({ ...meta, link: { ...stored, cursor } });
    return counts;
  });
}

// ---------------------------------------------------------------------------
// Pull
// ---------------------------------------------------------------------------

/**
 * Applies one page of pulled rows and moves the cursor, in one transaction. `expectedCursor` is the
 * cursor the page was asked from: if another tab moved it meanwhile, the page is dropped unread.
 * `applied` counts rows that changed something here; `skipped` counts rows this version can't use
 * (unknown table, bad data, a profile tombstone).
 */
export function applyPage(
  db: KiraMakanDb,
  link: SyncLink,
  expectedCursor: number,
  page: PullPage,
  limit: number,
  defaults: DeviceDefaults,
): Promise<{ applied: number; skipped: number; cursor: number }> {
  return db.transaction('rw', SYNC_SCOPE, async () => {
    markUncaptured();
    const { meta, link: stored } = await currentLink(db, link);
    if (page.dataset !== stored.dataset) throw new SyncError('cloudReset', 'The synced copy in this account changed');
    if (stored.cursor !== expectedCursor) return { applied: 0, skipped: 0, cursor: stored.cursor };

    const keys = page.rows.map(({ t, k }) => ({ table: t, key: k }));
    const tupleKeys = keys.map(({ table, key }): [string, string] => [table, key]);
    const localRows = await readRows(db, keys);
    const storedRevs = await db.syncRevs.bulkGet(tupleKeys);
    const storedEntries = await db.syncOutbox.bulkGet(tupleKeys);

    // The state as the page is applied, row by row (a key could come twice).
    const locals = new Map<RowId, unknown | undefined>();
    const revs = new Map<RowId, RowRev | undefined>();
    const queued = new Map<RowId, OutboxEntry | undefined>();
    keys.forEach(({ table, key }, i) => {
      const id = rowId(table, key);
      if (locals.has(id)) return;
      locals.set(id, localRows[i]);
      revs.set(id, storedRevs[i]);
      queued.set(id, storedEntries[i]);
    });
    const writes = new Map<RowId, { table: SyncTable; key: string; row: unknown | undefined }>();
    const revWrites = new Map<RowId, RowRev>();
    const drop = new Map<RowId, [string, string]>();
    const notes = new Map<RowId, OutboxEntry>();
    let applied = 0;
    let skipped = 0;

    for (const remote of page.rows) {
      const { t: table, k: key } = remote;
      // From a newer version of the app, or a profile tombstone (a pull never sends the app back to setup).
      if (!isSyncTable(table) || (table === 'profile' && remote.del)) {
        skipped += 1;
        continue;
      }
      const id = rowId(table, key);
      const rev = revs.get(id);
      if (rev && rev.rev >= remote.rev) continue; // an echo of our push, or already applied
      const local = locals.get(id);
      const next = remote.del ? undefined : fromServerRow(table, key, remote.data, local, defaults);
      if (next === null) {
        skipped += 1;
        continue;
      }
      const entry = queued.get(id);
      if (entry) {
        if (isRealChange(table, local, rev)) {
          // The push decides; revs stay as they were. The entry notes the revision it was left, in
          // case the change comes to nothing before it goes (ackPush then pulls it again).
          if ((entry.seenRev ?? 0) < remote.rev) {
            const noted: OutboxEntry = { ...entry, seenRev: remote.rev };
            queued.set(id, noted);
            notes.set(id, noted);
          }
          continue;
        }
        queued.set(id, undefined); // nothing to send: the pulled row replaces it
        drop.set(id, [table, key]);
        notes.delete(id);
      }
      const seen: RowRev = { table, key, rev: remote.rev, hash: remote.del ? 'deleted' : hashJson(remote.data) };
      revs.set(id, seen);
      revWrites.set(id, seen);
      if (next === undefined) {
        if (local === undefined) continue;
        writes.set(id, { table, key, row: undefined });
        locals.set(id, undefined);
        applied += 1;
      } else if (canonicalJson(local) !== canonicalJson(next)) {
        writes.set(id, { table, key, row: next });
        locals.set(id, next);
        applied += 1;
      }
    }

    await writeRows(db, writes);
    if (revWrites.size > 0) await db.syncRevs.bulkPut([...revWrites.values()]);
    if (drop.size > 0) await db.syncOutbox.bulkDelete([...drop.values()]);
    if (notes.size > 0) await db.syncOutbox.bulkPut([...notes.values()]);

    // Head and rows come from one snapshot, so a short page has seen everything up to head.
    const last = page.rows.at(-1)?.rev;
    const reached = page.rows.length >= limit ? (last ?? stored.cursor) : Math.max(page.head, last ?? 0);
    const cursor = Math.max(stored.cursor, reached);
    if (cursor !== stored.cursor) await db.syncMeta.put({ ...meta, link: { ...stored, cursor } });
    return { applied, skipped, cursor };
  });
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

/**
 * Replaces this device's synced data with the account's and links to it, in one commit, so the
 * profile never shows without the rest. `noProfile`: a new device before setup. `replace`: "Use the
 * account's data" on a set-up device (its theme and location permission stay). Photos no restored
 * meal uses are deleted.
 */
export function applyRestore(
  db: KiraMakanDb,
  snap: RestoreSnapshot,
  a: { userId: string; email?: string; expect: 'noProfile' | 'replace'; defaults: DeviceDefaults; now: number },
): Promise<{ meals: number }> {
  return db.transaction('rw', db.tables, async () => {
    markUncaptured();
    const meta = await metaIn(db);
    const profile = await db.profile.get('me');
    if (meta.link) throw new RestoreConflict('This device is already linked');
    if (a.expect === 'noProfile' && profile) throw new RestoreConflict('This device has been set up');
    if (a.expect === 'replace' && (!profile || profile.demoMode)) throw new RestoreConflict('This device has no diary to replace');

    // The latest version of each key.
    const latest = new Map<RowId, WireRow & { t: SyncTable }>();
    for (const row of snap.rows) {
      if (!isSyncTable(row.t)) continue;
      const id = rowId(row.t, row.k);
      const seen = latest.get(id);
      if (!seen || seen.rev < row.rev) latest.set(id, { ...row, t: row.t });
    }
    const rows = [...latest.values()];
    if (!rows.some((r) => r.t === 'profile' && !r.del)) throw new RestoreConflict('The account has no profile');

    const puts = new Map<SyncTable, unknown[]>();
    for (const row of rows) {
      if (row.del) continue;
      const next = fromServerRow(row.t, row.k, row.data, row.t === 'profile' ? profile : undefined, a.defaults);
      if (next === null) continue;
      const list = puts.get(row.t) ?? [];
      list.push(next);
      puts.set(row.t, list);
    }

    await Promise.all([...SYNC_TABLES.map((t) => db.table(t).clear()), db.syncOutbox.clear(), db.syncRevs.clear()]);
    for (const [table, list] of puts) await db.table<unknown, string>(table).bulkPut(list);
    await db.syncRevs.bulkPut(
      rows.map((r): RowRev => ({ table: r.t, key: r.k, rev: r.rev, hash: r.del ? 'deleted' : hashJson(r.data) })),
    );

    const meals = await db.meals.toArray();
    const used = new Set(meals.flatMap((m) => (m.photoId ? [m.photoId] : [])));
    const photoIds = await db.photos.toCollection().primaryKeys();
    const orphans = photoIds.filter((id) => !used.has(id));
    if (orphans.length > 0) await db.photos.bulkDelete(orphans);

    await db.syncMeta.put({ id: 'sync', link: newLink(a, snap.dataset, snap.head, a.now), lastSyncedAt: a.now });
    return { meals: meals.length };
  });
}

// ---------------------------------------------------------------------------
// Status and upkeep
// ---------------------------------------------------------------------------

/** A cycle finished: when, and no error. Nothing is written if the link changed meanwhile. */
export function recordSuccess(db: KiraMakanDb, link: SyncLink, now: number): Promise<void> {
  return db.transaction('rw', 'syncMeta', async () => {
    markUncaptured();
    const meta = await metaIn(db);
    if (!sameLink(meta.link, link)) return;
    const next: SyncMeta = { ...meta, lastSyncedAt: now };
    delete next.lastError;
    await db.syncMeta.put(next);
  });
}

/** Kept in syncMeta, so every tab shows it. */
export function recordError(db: KiraMakanDb, kind: SyncErrorKind, now: number): Promise<void> {
  return db.transaction('rw', 'syncMeta', async () => {
    markUncaptured();
    await db.syncMeta.put({ ...(await metaIn(db)), lastError: { kind, at: now } });
  });
}

/** Once per app start: rows the server refused get another try. */
export function clearFailedMarks(db: KiraMakanDb): Promise<void> {
  return db.transaction('rw', 'syncOutbox', async () => {
    markUncaptured();
    const failed = await db.syncOutbox.filter((e) => e.failedAt !== undefined).toArray();
    if (failed.length === 0) return;
    await db.syncOutbox.bulkPut(
      failed.map((entry) => {
        const retry: OutboxEntry = { ...entry };
        delete retry.failedAt;
        return retry;
      }),
    );
  });
}

/** A device linked by an older version pulls everything again once, for the tables that started syncing since. */
export function bumpProtocolIfNeeded(db: KiraMakanDb): Promise<void> {
  return db.transaction('rw', 'syncMeta', async () => {
    markUncaptured();
    const meta = await metaIn(db);
    if (!meta.link || meta.link.protocol >= SYNC_PROTOCOL) return;
    await db.syncMeta.put({ ...meta, link: { ...meta.link, cursor: 0, protocol: SYNC_PROTOCOL } });
  });
}
