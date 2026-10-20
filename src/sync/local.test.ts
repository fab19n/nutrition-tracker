// @vitest-environment node
import { liveQuery } from 'dexie';
import { createDb, SYNC_TABLES, type KiraMakanDb, type SyncTable } from '@/db/db';
import type { SyncLink } from '@/db/syncTypes';
import type { MealLog, Profile, WeightLog } from '@/domain/types';
import { SyncError } from './errors';
import {
  ackPush,
  applyPage,
  applyRestore,
  bumpProtocolIfNeeded,
  clearCheckPending,
  clearFailedMarks,
  collectPush,
  linkEmptyAccount,
  linkKeepingDevice,
  pendingSummary,
  readMeta,
  recordError,
  recordSuccess,
  RestoreConflict,
  setPaused,
  unlinkKeepingData,
  unlinkUnchecked,
  type PushBatch,
} from './local';
import type { CloudSummary, PullPage, PushReply, PushResult, WireRow } from './remote';
import { hashJson, primaryKeyField, toServerRow, wireHash } from './rows';

const DATASET = '6f9619ff-8b86-d011-b42d-00c04fc964ff';
const USER = 'user-1';
const DEFAULTS = { theme: 'system' as const };

let db: KiraMakanDb;

beforeEach(() => {
  db = createDb(`local-${crypto.randomUUID()}`, { capture: () => true });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await db.delete();
});

const profile = (patch: Partial<Profile> = {}): Profile => ({
  id: 'me',
  age: 34,
  sex: 'male',
  heightCm: 172,
  weightKgAtSetup: 78.6,
  activity: 'light',
  timeZone: 'Asia/Kuala_Lumpur',
  rolloverHour: 5,
  weekStartsOn: 1,
  dailyMinimumKcal: 1400,
  theme: 'dark',
  keepPhotos: true,
  useLocation: true,
  startedOn: '2026-10-01',
  demoMode: false,
  ...patch,
});
const weight = (id: string, kg = 78, note?: string): WeightLog & { note?: string } => ({
  id,
  kg,
  measuredAt: '2026-10-16T00:05:00.000Z',
  logicalDay: '2026-10-16',
  ...(note ? { note } : {}),
});
const meal = (id: string, patch: Partial<MealLog> = {}): MealLog => ({
  id,
  eatenAt: '2026-10-16T04:30:00.000Z',
  logicalDay: '2026-10-16',
  slot: 'lunch',
  name: 'Economy rice',
  items: [],
  method: 'manual',
  finished: 'all',
  createdAt: '2026-10-16T04:31:00.000Z',
  updatedAt: '2026-10-16T04:31:00.000Z',
  syncState: 'local',
  ...patch,
});
const summary = (head = 0): CloudSummary => ({ dataset: DATASET, head, counts: {}, lastChangeAt: null });
/** A pulled row: the account's copy of `data` (null for a tombstone). */
const wireRow = (t: string, k: string, rev: number, data: object | null): WireRow => ({
  t,
  k,
  rev,
  del: data === null,
  data: data === null ? null : toServerRow(t as SyncTable, data),
  at: '2026-10-16T11:00:00+00:00',
});
const page = (rows: WireRow[], head = rows.at(-1)?.rev ?? 0): PullPage => ({ dataset: DATASET, head, rows });
const reply = (results: PushResult[], prevHead = 0, head = prevHead): PushReply => ({ dataset: DATASET, prevHead, head, results });

/** The outbox as sorted "table/key" strings. */
async function queued(): Promise<string[]> {
  return (await db.syncOutbox.toArray()).map((e) => `${e.table}/${e.key}`).sort();
}

/** A real profile, linked to an empty account, with nothing queued. */
async function linked(head = 0): Promise<SyncLink> {
  await db.profile.put(profile());
  await linkEmptyAccount(db, { userId: USER, email: 'me@example.com', summary: summary(head), now: 1_000 });
  await db.syncOutbox.clear();
  await db.syncRevs.put({ table: 'profile', key: 'me', rev: 1, hash: wireHash('profile', profile()) });
  return currentLink();
}

async function currentLink(): Promise<SyncLink> {
  const link = (await readMeta(db)).link;
  if (!link) throw new Error('not linked');
  return link;
}

/** Writes rows as if they had synced at these revisions, with nothing queued. */
async function synced(table: SyncTable, rows: { row: unknown; rev: number }[]): Promise<void> {
  const target = db.table(table);
  await target.bulkPut(rows.map((r) => r.row));
  await db.syncRevs.bulkPut(
    rows.map(({ row, rev }) => ({ table, key: String((row as Record<string, unknown>)[primaryKeyField(table)]), rev, hash: wireHash(table, row) })),
  );
  await db.syncOutbox.clear();
}

async function batchOf(link: SyncLink): Promise<PushBatch> {
  const batch = await collectPush(db, link);
  if (!batch) throw new Error('nothing to push');
  return batch;
}

describe('reading the state', () => {
  it('reads an empty meta and summary on a new device', async () => {
    expect(await readMeta(db)).toEqual({ id: 'sync' });
    expect(await pendingSummary(db)).toEqual({ pending: 0, failed: 0, mealKeys: [] });
  });

  it('counts pending and refused changes and lists the meals', async () => {
    await db.meals.bulkPut([meal('m1'), meal('m2')]);
    await db.weights.put(weight('w1'));
    await db.syncOutbox.update(['meals', 'm2'], { failedAt: 5 });
    expect(await pendingSummary(db)).toEqual({ pending: 2, failed: 1, mealKeys: ['m1', 'm2'] });
  });
});

describe('collectPush', () => {
  it('sends a row as it is now, on the revision this device last had', async () => {
    const link = await linked();
    await synced('meals', [{ row: meal('m1'), rev: 4 }]);
    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-16T11:00:00.000Z'));
    await db.meals.update('m1', { name: 'Nasi lemak' });
    await db.meals.put(meal('m2'));
    now.mockRestore();
    const entries = await db.syncOutbox.toArray();

    const batch = await batchOf(link);
    expect(batch.changes).toEqual([
      {
        t: 'meals',
        k: 'm1',
        del: false,
        data: toServerRow('meals', meal('m1', { name: 'Nasi lemak' })),
        base: 4,
        at: '2026-10-16T11:00:00.000Z',
        n: entries.find((e) => e.key === 'm1')?.nonce,
      },
      expect.objectContaining({ k: 'm2', base: null, del: false }),
    ]);
    expect(batch.changes[0]?.data).not.toHaveProperty('syncState');
    expect(batch.sent[0]).toMatchObject({ table: 'meals', key: 'm1', hash: wireHash('meals', meal('m1', { name: 'Nasi lemak' })) });
    expect(batch.noops).toEqual([]);
  });

  it('sends a tombstone for a synced row that is gone, and drops one that never synced', async () => {
    const link = await linked();
    await synced('weights', [{ row: weight('w1'), rev: 3 }]);
    await db.weights.delete('w1');
    await db.weights.put(weight('w2'));
    await db.weights.delete('w2');
    const batch = await batchOf(link);
    expect(batch.changes).toEqual([expect.objectContaining({ t: 'weights', k: 'w1', del: true, data: null, base: 3 })]);
    expect(batch.sent[0]?.hash).toBe('deleted');
    expect(batch.noops.map((n) => n.key)).toEqual(['w2']);
  });

  it('sends nothing for a write that changes nothing that syncs', async () => {
    const link = await linked();
    await synced('meals', [{ row: meal('m1'), rev: 2 }]);
    await db.profile.update('me', { theme: 'light', useLocation: false });
    await db.meals.update('m1', { syncState: 'synced' });
    const batch = await batchOf(link);
    expect(batch.changes).toEqual([]);
    expect(batch.noops.map((n) => `${n.table}/${n.key}`).sort()).toEqual(['meals/m1', 'profile/me']);
  });

  it('never sends a profile tombstone', async () => {
    const link = await linked();
    await db.profile.delete('me');
    const batch = await batchOf(link);
    expect(batch.changes).toEqual([]);
    expect(batch.noops.map((n) => n.table)).toEqual(['profile']);
  });

  it('sends the oldest change first', async () => {
    const link = await linked();
    await db.weights.bulkPut([weight('a'), weight('b'), weight('c')]);
    await db.syncOutbox.update(['weights', 'a'], { changedAt: 30 });
    await db.syncOutbox.update(['weights', 'b'], { changedAt: 10 });
    await db.syncOutbox.update(['weights', 'c'], { changedAt: 20 });
    expect((await batchOf(link)).changes.map((c) => c.k)).toEqual(['b', 'c', 'a']);
  });

  it('takes at most 200 rows, or fewer when asked', async () => {
    const link = await linked();
    await db.weights.bulkPut(Array.from({ length: 250 }, (_, i) => weight(`w${String(i).padStart(3, '0')}`)));
    expect((await batchOf(link)).changes).toHaveLength(200);
    expect((await collectPush(db, link, { rows: 500 }))?.changes).toHaveLength(200);
    expect((await collectPush(db, link, { rows: 2 }))?.changes).toHaveLength(2);
  });

  it('takes about 512 KB at most, but always one row', async () => {
    const link = await linked();
    const big = 'x'.repeat(200_000);
    await db.weights.bulkPut([weight('a', 1, big), weight('b', 2, big), weight('c', 3, big)]);
    expect((await batchOf(link)).changes.map((c) => c.k)).toEqual(['a', 'b']);
    expect((await collectPush(db, link, { bytes: 1_000 }))?.changes.map((c) => c.k)).toEqual(['a']);
  });

  it('skips entries the server refused until the marks are cleared', async () => {
    const link = await linked();
    await db.weights.bulkPut([weight('a'), weight('b')]);
    await db.syncOutbox.update(['weights', 'a'], { failedAt: 5 });
    expect((await batchOf(link)).changes.map((c) => c.k)).toEqual(['b']);
    await clearFailedMarks(db);
    expect((await db.syncOutbox.get(['weights', 'a']))?.failedAt).toBeUndefined();
    expect((await batchOf(link)).changes.map((c) => c.k)).toEqual(['a', 'b']);
  });

  it('answers null with nothing queued, and aborted for a link that changed', async () => {
    const link = await linked();
    expect(await collectPush(db, link)).toBeNull();
    await expect(collectPush(db, { ...link, deviceId: 'other' })).rejects.toMatchObject({ kind: 'aborted' });
  });
});

describe('ackPush', () => {
  it('ok records the revision and hash and drops the entry', async () => {
    const link = await linked(5);
    await db.weights.put(weight('w1'));
    const batch = await batchOf(link);
    expect(await ackPush(db, link, batch, reply([{ i: 0, s: 'ok', rev: 6 }], 5, 6), DEFAULTS)).toEqual({ ok: 1, lost: 0, invalid: 0 });
    expect(await db.syncRevs.get(['weights', 'w1'])).toEqual({ table: 'weights', key: 'w1', rev: 6, hash: wireHash('weights', weight('w1')) });
    expect(await queued()).toEqual([]);
    expect(await collectPush(db, link)).toBeNull();
  });

  it('keeps an entry edited during the push, now on the new revision', async () => {
    const link = await linked();
    await db.weights.put(weight('w1', 70));
    const batch = await batchOf(link);
    await db.weights.put(weight('w1', 71));
    await ackPush(db, link, batch, reply([{ i: 0, s: 'ok', rev: 1 }], 0, 1), DEFAULTS);
    expect(await queued()).toEqual(['weights/w1']);
    expect((await batchOf(link)).changes).toEqual([expect.objectContaining({ k: 'w1', base: 1, data: toServerRow('weights', weight('w1', 71)) })]);
  });

  it('lost applies the winner without queueing it', async () => {
    const link = await linked();
    await synced('weights', [{ row: weight('w1', 70), rev: 2 }, { row: weight('w2', 70), rev: 3 }]);
    await db.weights.put(weight('w1', 71));
    await db.weights.put(weight('w2', 72));
    const batch = await batchOf(link);
    const winner = toServerRow('weights', weight('w1', 90));
    const counts = await ackPush(
      db,
      link,
      batch,
      reply([
        { i: 0, s: 'lost', rev: 7, del: false, data: winner },
        { i: 1, s: 'lost', rev: 8, del: true, data: null },
      ]),
      DEFAULTS,
    );
    expect(counts).toEqual({ ok: 0, lost: 2, invalid: 0 });
    expect(await db.weights.get('w1')).toEqual(weight('w1', 90));
    expect(await db.weights.get('w2')).toBeUndefined();
    expect(await queued()).toEqual([]);
    expect(await db.syncRevs.get(['weights', 'w1'])).toMatchObject({ rev: 7, hash: hashJson(winner) });
    expect(await db.syncRevs.get(['weights', 'w2'])).toMatchObject({ rev: 8, hash: 'deleted' });
  });

  it('lost keeps an entry edited since, on its old base', async () => {
    const link = await linked();
    await synced('weights', [{ row: weight('w1', 70), rev: 2 }]);
    await db.weights.put(weight('w1', 71));
    const batch = await batchOf(link);
    await db.weights.put(weight('w1', 72));
    await ackPush(db, link, batch, reply([{ i: 0, s: 'lost', rev: 7, del: false, data: toServerRow('weights', weight('w1', 90)) }]), DEFAULTS);
    expect(await db.weights.get('w1')).toEqual(weight('w1', 72));
    expect(await db.syncRevs.get(['weights', 'w1'])).toMatchObject({ rev: 2 });
    expect((await batchOf(link)).changes).toEqual([expect.objectContaining({ k: 'w1', base: 2 })]);
  });

  it('invalid sets the entry aside until the next app start', async () => {
    const link = await linked();
    await db.weights.bulkPut([weight('bad'), weight('good')]);
    const batch = await batchOf(link);
    const counts = await ackPush(db, link, batch, reply([{ i: 0, s: 'invalid' }, { i: 1, s: 'ok', rev: 1 }], 0, 1), DEFAULTS);
    expect(counts).toEqual({ ok: 1, lost: 0, invalid: 1 });
    expect((await db.syncOutbox.get(['weights', 'bad']))?.failedAt).toEqual(expect.any(Number));
    expect(await pendingSummary(db)).toMatchObject({ pending: 0, failed: 1 });
    expect(await collectPush(db, link)).toBeNull();
  });

  it('drops noops only when they are unchanged', async () => {
    const link = await linked();
    await synced('weights', [{ row: weight('w1'), rev: 2 }]);
    await db.profile.update('me', { theme: 'light' });
    await db.weights.put(weight('w1'));
    const batch = await batchOf(link);
    expect(batch.noops.map((n) => n.table)).toEqual(['profile', 'weights']);
    await db.weights.put(weight('w1', 60));
    await ackPush(db, link, batch, reply([]), DEFAULTS);
    expect(await queued()).toEqual(['weights/w1']);
  });

  it('moves the cursor only when the push started from it', async () => {
    const link = await linked(5);
    await db.weights.bulkPut([weight('a'), weight('b')]);
    await ackPush(db, link, await batchOf(link), reply([{ i: 0, s: 'ok', rev: 6 }, { i: 1, s: 'ok', rev: 7 }], 5, 7), DEFAULTS);
    expect((await currentLink()).cursor).toBe(7);

    await db.weights.put(weight('c'));
    await ackPush(db, link, await batchOf(link), reply([{ i: 0, s: 'ok', rev: 9 }], 8, 9), DEFAULTS);
    expect((await currentLink()).cursor).toBe(7); // revision 8 came from elsewhere: the pull fetches it
  });

  it('moves the cursor back when another tab pulled past the push while it was out', async () => {
    const link = await linked(5);
    await synced('weights', [{ row: weight('w1', 70), rev: 5 }]);
    await db.weights.put(weight('w1', 71));
    const batch = await batchOf(link);
    // The push got revision 6; meanwhile another tab pulled 7 (a newer edit from elsewhere) and left it to this push.
    await applyPage(db, link, 5, page([wireRow('weights', 'w1', 7, weight('w1', 72))]), 500, DEFAULTS);
    expect((await currentLink()).cursor).toBe(7);
    await ackPush(db, link, batch, reply([{ i: 0, s: 'ok', rev: 6 }], 5, 6), DEFAULTS);
    expect((await currentLink()).cursor).toBe(6);

    // So the next pull brings revision 7 in.
    await applyPage(db, link, 6, page([wireRow('weights', 'w1', 7, weight('w1', 72))]), 500, DEFAULTS);
    expect(await db.weights.get('w1')).toEqual(weight('w1', 72));
    expect(await queued()).toEqual([]);
  });

  it('moves the cursor back to a revision a pull left to a change that then came to nothing', async () => {
    const link = await linked(5);
    await synced('weights', [{ row: weight('w1', 70), rev: 5 }]);
    await db.weights.put(weight('w1', 71));
    const pulled = page([wireRow('weights', 'w1', 7, weight('w1', 72)), wireRow('weights', 'w2', 9, weight('w2'))]);
    await applyPage(db, link, 5, pulled, 500, DEFAULTS);
    expect((await currentLink()).cursor).toBe(9);

    await db.weights.put(weight('w1', 70)); // undone: as it last synced
    const batch = await batchOf(link);
    expect(batch.changes).toEqual([]);
    await ackPush(db, link, batch, reply([], 9, 9), DEFAULTS);
    expect(await queued()).toEqual([]);
    expect((await currentLink()).cursor).toBe(6);

    // So the next pull brings revision 7 in.
    await applyPage(db, link, 6, pulled, 500, DEFAULTS);
    expect(await db.weights.get('w1')).toEqual(weight('w1', 72));
    expect((await currentLink()).cursor).toBe(9);
  });

  it('leaves the cursor when the revision a pull left is already here', async () => {
    const link = await linked(9);
    await synced('weights', [{ row: weight('w1', 70), rev: 8 }]);
    await db.weights.put(weight('w1', 70));
    await db.syncOutbox.update(['weights', 'w1'], { seenRev: 7 });
    await ackPush(db, link, await batchOf(link), reply([], 9, 9), DEFAULTS);
    expect(await queued()).toEqual([]);
    expect((await currentLink()).cursor).toBe(9);
  });

  it('throws aborted and writes nothing when the link changed', async () => {
    const link = await linked();
    await db.weights.put(weight('w1'));
    const batch = await batchOf(link);
    await unlinkKeepingData(db);
    await linkEmptyAccount(db, { userId: USER, summary: summary(), now: 2_000 });
    const before = { outbox: await db.syncOutbox.toArray(), revs: await db.syncRevs.toArray(), meta: await readMeta(db) };
    const error = await ackPush(db, link, batch, reply([{ i: 0, s: 'ok', rev: 1 }], 0, 1), DEFAULTS).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SyncError);
    expect(error).toMatchObject({ kind: 'aborted' });
    expect({ outbox: await db.syncOutbox.toArray(), revs: await db.syncRevs.toArray(), meta: await readMeta(db) }).toEqual(before);
  });

  it('ignores an answer older than a revision already here', async () => {
    const link = await linked();
    await synced('weights', [{ row: weight('w1', 70), rev: 2 }]);
    await db.weights.put(weight('w1', 71));
    const batch = await batchOf(link);
    await db.syncRevs.put({ table: 'weights', key: 'w1', rev: 9, hash: 'h' });
    await ackPush(db, link, batch, reply([{ i: 0, s: 'lost', rev: 5, del: false, data: toServerRow('weights', weight('w1', 1)) }]), DEFAULTS);
    expect(await db.weights.get('w1')).toEqual(weight('w1', 71));
    expect(await db.syncRevs.get(['weights', 'w1'])).toMatchObject({ rev: 9 });
  });
});

describe('applyPage', () => {
  it('applies puts and deletes without queueing them, and moves the cursor', async () => {
    const link = await linked();
    await synced('weights', [{ row: weight('w2'), rev: 1 }]);
    const result = await applyPage(db, link, 0, page([wireRow('weights', 'w1', 2, weight('w1', 80)), wireRow('weights', 'w2', 3, null)], 3), 500, DEFAULTS);
    expect(result).toEqual({ applied: 2, skipped: 0, cursor: 3 });
    expect(await db.weights.toArray()).toEqual([weight('w1', 80)]);
    expect(await queued()).toEqual([]);
    expect(await db.syncRevs.get(['weights', 'w1'])).toMatchObject({ rev: 2, hash: wireHash('weights', weight('w1', 80)) });
    expect(await db.syncRevs.get(['weights', 'w2'])).toMatchObject({ rev: 3, hash: 'deleted' });
    expect((await currentLink()).cursor).toBe(3);
  });

  it("keeps this device's own fields on a pulled profile and meal", async () => {
    const link = await linked();
    await synced('meals', [{ row: meal('m1', { syncState: 'pending' }), rev: 2 }]);
    await applyPage(
      db,
      link,
      0,
      page([wireRow('profile', 'me', 3, profile({ rolloverHour: 4, theme: 'light', useLocation: false })), wireRow('meals', 'm1', 4, meal('m1', { name: 'Mee goreng' }))]),
      500,
      DEFAULTS,
    );
    expect(await db.profile.get('me')).toEqual(profile({ rolloverHour: 4 }));
    expect(await db.meals.get('m1')).toEqual(meal('m1', { name: 'Mee goreng', syncState: 'pending' }));
  });

  it('skips revisions it already has', async () => {
    const link = await linked();
    await synced('weights', [{ row: weight('w1', 70), rev: 5 }]);
    expect(await applyPage(db, link, 0, page([wireRow('weights', 'w1', 4, weight('w1', 60)), wireRow('weights', 'w1', 5, weight('w1', 61))]), 500, DEFAULTS)).toEqual({
      applied: 0,
      skipped: 0,
      cursor: 5,
    });
    expect(await db.weights.get('w1')).toEqual(weight('w1', 70));
  });

  it('leaves a row with a real change pending to the push, revision untouched', async () => {
    const link = await linked();
    await synced('weights', [{ row: weight('w1', 70), rev: 2 }]);
    await db.weights.put(weight('w1', 71));
    await applyPage(db, link, 0, page([wireRow('weights', 'w1', 6, weight('w1', 90))]), 500, DEFAULTS);
    expect(await db.weights.get('w1')).toEqual(weight('w1', 71));
    expect(await queued()).toEqual(['weights/w1']);
    expect(await db.syncRevs.get(['weights', 'w1'])).toMatchObject({ rev: 2 });
    expect((await currentLink()).cursor).toBe(6);
  });

  it('notes on the pending entry the newest revision it was left, through later edits', async () => {
    const link = await linked();
    await synced('weights', [{ row: weight('w1', 70), rev: 2 }]);
    await db.weights.put(weight('w1', 71));
    const entry = await db.syncOutbox.get(['weights', 'w1']);
    await applyPage(db, link, 0, page([wireRow('weights', 'w1', 6, weight('w1', 90)), wireRow('weights', 'w1', 8, weight('w1', 91))]), 500, DEFAULTS);
    expect(await db.syncOutbox.get(['weights', 'w1'])).toEqual({ ...entry, seenRev: 8 });

    // An edit replaces the entry (a new nonce, so a push of the old one is told apart) and keeps the note.
    await db.weights.put(weight('w1', 72));
    const edited = await db.syncOutbox.get(['weights', 'w1']);
    expect(edited).toMatchObject({ seenRev: 8 });
    expect(edited?.nonce).not.toBe(entry?.nonce);
    // An older revision never lowers it.
    await db.syncMeta.put({ id: 'sync', link: { ...link, cursor: 0 } });
    await applyPage(db, link, 0, page([wireRow('weights', 'w1', 7, weight('w1', 93))]), 500, DEFAULTS);
    expect(await db.syncOutbox.get(['weights', 'w1'])).toEqual(edited);
  });

  it('drops a pending entry with nothing to send and applies the pulled row', async () => {
    const link = await linked();
    await synced('meals', [{ row: meal('m1'), rev: 2 }]);
    await db.meals.update('m1', { syncState: 'synced' });
    expect(await queued()).toEqual(['meals/m1']);
    await applyPage(db, link, 0, page([wireRow('meals', 'm1', 6, meal('m1', { name: 'Nasi lemak' }))]), 500, DEFAULTS);
    expect(await db.meals.get('m1')).toEqual(meal('m1', { name: 'Nasi lemak', syncState: 'synced' }));
    expect(await queued()).toEqual([]);
    expect(await db.syncRevs.get(['meals', 'm1'])).toMatchObject({ rev: 6 });
  });

  it('skips rows of tables this version does not sync, bad rows, and a profile tombstone', async () => {
    const link = await linked();
    const result = await applyPage(
      db,
      link,
      0,
      page([
        wireRow('photos', 'p1', 1, { id: 'p1' }),
        { t: 'somethingNew', k: 'x', rev: 2, del: false, data: { id: 'x' }, at: '' },
        { t: 'weights', k: 'w1', rev: 3, del: false, data: { id: 'other' }, at: '' },
        { t: 'profile', k: 'me', rev: 4, del: true, data: null, at: '' },
      ]),
      500,
      DEFAULTS,
    );
    expect(result).toEqual({ applied: 0, skipped: 4, cursor: 4 });
    expect(await db.profile.get('me')).toEqual(profile());
    expect(await db.weights.count()).toBe(0);
  });

  it('writes nothing for a row that is already the same here', async () => {
    const link = await linked();
    await synced('weights', [{ row: weight('w1', 70), rev: 2 }]);
    let runs = 0;
    const subscription = liveQuery(() => {
      runs += 1;
      return db.weights.toArray();
    }).subscribe(() => {});
    try {
      await vi.waitFor(() => expect(runs).toBe(1));
      const result = await applyPage(db, link, 0, page([wireRow('weights', 'w1', 5, weight('w1', 70))]), 500, DEFAULTS);
      expect(result.applied).toBe(0);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(runs).toBe(1);
      await db.weights.put(weight('w2'));
      await vi.waitFor(() => expect(runs).toBe(2));
    } finally {
      subscription.unsubscribe();
    }
    expect(await db.syncRevs.get(['weights', 'w1'])).toMatchObject({ rev: 5 });
  });

  it('leaves everything as it was when the page fails part way', async () => {
    const link = await linked();
    vi.spyOn(db.syncRevs, 'bulkPut').mockRejectedValueOnce(new Error('disk full'));
    await expect(applyPage(db, link, 0, page([wireRow('weights', 'w1', 2, weight('w1'))]), 500, DEFAULTS)).rejects.toThrow('disk full');
    expect(await db.weights.count()).toBe(0);
    expect((await currentLink()).cursor).toBe(0);
  });

  it('throws aborted when the link went while the page was on its way', async () => {
    const link = await linked();
    const pulled = page([wireRow('weights', 'w1', 2, weight('w1'))]);
    await unlinkKeepingData(db);
    await expect(applyPage(db, link, 0, pulled, 500, DEFAULTS)).rejects.toMatchObject({ kind: 'aborted' });
    expect(await db.weights.count()).toBe(0);
  });

  it('throws cloudReset for a page from another dataset', async () => {
    const link = await linked();
    await expect(applyPage(db, link, 0, { ...page([]), dataset: crypto.randomUUID() }, 500, DEFAULTS)).rejects.toMatchObject({ kind: 'cloudReset' });
  });

  it('drops a page another tab already applied', async () => {
    const link = await linked();
    const pulled = page([wireRow('weights', 'w1', 2, weight('w1', 70))]);
    await applyPage(db, link, 0, pulled, 500, DEFAULTS);
    await db.weights.put(weight('w1', 75));
    expect(await applyPage(db, link, 0, pulled, 500, DEFAULTS)).toEqual({ applied: 0, skipped: 0, cursor: 2 });
    expect(await db.weights.get('w1')).toEqual(weight('w1', 75));
  });

  it('moves the cursor to the last row of a full page, and to the head after a short one', async () => {
    const link = await linked();
    const rows = [wireRow('weights', 'a', 1, weight('a')), wireRow('weights', 'b', 2, weight('b'))];
    expect((await applyPage(db, link, 0, page(rows, 9), 2, DEFAULTS)).cursor).toBe(2);
    expect((await applyPage(db, link, 2, page([], 9), 2, DEFAULTS)).cursor).toBe(9);
  });
});

describe('linking', () => {
  /** One row in every synced table, plus a photo. */
  async function oneOfEach(): Promise<void> {
    for (const table of SYNC_TABLES) {
      await db.table(table).put(table === 'profile' ? profile() : { [primaryKeyField(table)]: `${table}-1` });
    }
    await db.photos.put({ id: 'photo-1', blob: new Blob(['a']), thumb: new Blob(['b']), createdAt: '2026-10-16T06:16:00.000Z' });
    await db.syncOutbox.clear();
  }

  it('linkEmptyAccount queues every row of the 16 synced tables, and no photo', async () => {
    await oneOfEach();
    await db.syncRevs.put({ table: 'weights', key: 'old', rev: 3 });
    const result = await linkEmptyAccount(db, { userId: USER, email: 'me@example.com', summary: summary(4), now: 1_000 });
    expect(result).toEqual({ queued: 16 });
    expect(await queued()).toEqual(SYNC_TABLES.map((t) => (t === 'profile' ? 'profile/me' : `${t}/${t}-1`)).sort());
    // The profile goes first and the goal next, then the rest.
    const at = (await db.syncOutbox.toArray()).map((e) => [e.table, e.changedAt] as const);
    expect(at.filter(([, t]) => t !== 1_000).sort()).toEqual([['goalPeriods', 999], ['goalVersions', 999], ['goals', 999], ['profile', 998]]);
    expect(await db.syncRevs.count()).toBe(0);
    expect(await currentLink()).toEqual({
      userId: USER,
      email: 'me@example.com',
      dataset: DATASET,
      deviceId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      cursor: 4,
      protocol: 1,
      linkedAt: 1_000,
      checkPending: true,
    });
  });

  it('clearCheckPending clears the flag on the same unchecked link, and only there', async () => {
    await db.profile.put(profile());
    await linkEmptyAccount(db, { userId: USER, summary: summary(4), now: 1_000 });
    const unchecked = await currentLink();
    await db.syncMeta.update('sync', { lastSyncedAt: 5 });

    const cleared = await clearCheckPending(db, unchecked);
    expect(cleared.checkPending).toBeUndefined();
    expect(await readMeta(db)).toEqual({ id: 'sync', lastSyncedAt: 5, link: cleared });
    expect(cleared).toEqual({ ...unchecked, checkPending: undefined });
    // Another tab cleared it first: it comes back as it is.
    expect(await clearCheckPending(db, unchecked)).toEqual(cleared);
    expect(await queued()).toEqual(['profile/me']);

    // Another link, or an unchecked one at another cursor: nothing is written.
    await expect(clearCheckPending(db, { ...unchecked, deviceId: 'other' })).rejects.toMatchObject({ kind: 'aborted' });
    await db.syncMeta.put({ id: 'sync', link: { ...unchecked, cursor: 9 } });
    await expect(clearCheckPending(db, unchecked)).rejects.toMatchObject({ kind: 'aborted' });
    expect((await currentLink()).checkPending).toBe(true);
  });

  it('unlinkUnchecked forgets an unchecked link and its queue, keeping the data, and only that link', async () => {
    await db.profile.put(profile());
    await db.weights.put(weight('w1'));
    await linkEmptyAccount(db, { userId: USER, summary: summary(4), now: 1_000 });
    const unchecked = await currentLink();

    // Checked by another tab meanwhile, or at another cursor: it stays.
    await clearCheckPending(db, unchecked);
    await expect(unlinkUnchecked(db, unchecked)).rejects.toMatchObject({ kind: 'aborted' });
    await db.syncMeta.put({ id: 'sync', link: { ...unchecked, cursor: 9 } });
    await expect(unlinkUnchecked(db, unchecked)).rejects.toMatchObject({ kind: 'aborted' });
    expect(await queued()).toEqual(['profile/me', 'weights/w1']);

    await db.syncMeta.put({ id: 'sync', paused: true, lastSyncedAt: 5, link: unchecked });
    await db.syncRevs.put({ table: 'weights', key: 'w1', rev: 3 });
    await unlinkUnchecked(db, unchecked);
    expect(await readMeta(db)).toEqual({ id: 'sync', paused: true });
    expect(await db.syncOutbox.count()).toBe(0);
    expect(await db.syncRevs.count()).toBe(0);
    expect(await db.weights.get('w1')).toEqual(weight('w1'));
    expect(await db.profile.get('me')).toEqual(profile());
  });

  it.each([
    { name: 'without a profile', setup: async () => {} },
    { name: 'in demo mode', setup: () => db.profile.put(profile({ demoMode: true })) },
    {
      name: 'when already linked',
      setup: async () => {
        await db.profile.put(profile());
        await linkEmptyAccount(db, { userId: USER, summary: summary(), now: 1 });
      },
    },
  ])('refuses to link $name', async ({ setup }) => {
    await setup();
    await expect(linkEmptyAccount(db, { userId: USER, summary: summary(), now: 2 })).rejects.toMatchObject({ kind: 'aborted' });
    await expect(linkKeepingDevice(db, { userId: USER, keys: { dataset: DATASET, head: 0, keys: [] }, now: 2 })).rejects.toMatchObject({
      kind: 'aborted',
    });
  });

  it('linkKeepingDevice builds on the account and deletes what this device lacks', async () => {
    await db.profile.put(profile());
    await db.weights.bulkPut([weight('w1'), weight('w2')]);
    await db.syncOutbox.clear();
    const result = await linkKeepingDevice(db, {
      userId: USER,
      keys: {
        dataset: DATASET,
        head: 9,
        keys: [
          { t: 'weights', k: 'w1', rev: 4 },
          { t: 'weights', k: 'w9', rev: 5 },
          { t: 'profile', k: 'me', rev: 6 },
          { t: 'somethingNew', k: 'x', rev: 7 },
        ],
      },
      now: 1_000,
    });
    expect(result).toEqual({ queued: 4 });
    expect((await db.syncRevs.toArray()).map((r) => `${r.table}/${r.key}:${r.rev}:${r.hash ?? '-'}`).sort()).toEqual([
      'profile/me:6:-',
      'weights/w1:4:-',
      'weights/w9:5:-',
    ]);
    const link = await currentLink();
    expect(link).toMatchObject({ dataset: DATASET, cursor: 9 });
    const changes = (await batchOf(link)).changes.map((c) => `${c.t}/${c.k}:${c.del ? 'del' : 'put'}:${c.base ?? '-'}`).sort();
    expect(changes).toEqual(['profile/me:put:6', 'weights/w1:put:4', 'weights/w2:put:-', 'weights/w9:del:5']);
  });

  it.each([
    { name: 'linkEmptyAccount', link: () => linkEmptyAccount(db, { userId: USER, summary: summary(), now: 1_000 }) },
    {
      name: 'linkKeepingDevice',
      link: () => linkKeepingDevice(db, { userId: USER, keys: { dataset: DATASET, head: 3, keys: [{ t: 'meals', k: 'gone', rev: 3 }] }, now: 1_000 }),
    },
  ])('$name sends the profile and the goal in the first push, whatever else there is', async ({ link }) => {
    await db.profile.put(profile());
    await db.meals.bulkPut(Array.from({ length: 260 }, (_, i) => meal(`m${String(i).padStart(3, '0')}`)));
    for (const [table, id] of [['goals', 'g1'], ['goalVersions', 'gv1'], ['goalPeriods', 'gp1']] as const) await db.table(table).put({ id, goalId: 'g1' });
    await db.syncOutbox.clear();
    await link();
    const first = (await batchOf(await currentLink())).changes;
    expect(first).toHaveLength(200);
    expect(first.slice(0, 4).map((c) => `${c.t}/${c.k}`)).toEqual(['profile/me', 'goalPeriods/gp1', 'goalVersions/gv1', 'goals/g1']);
  });

  it('unlinkKeepingData forgets the link and the queue but keeps the data', async () => {
    const link = await linked();
    await db.weights.put(weight('w1'));
    await recordSuccess(db, link, 5);
    await unlinkKeepingData(db);
    expect(await readMeta(db)).toEqual({ id: 'sync' });
    expect(await db.syncOutbox.count()).toBe(0);
    expect(await db.syncRevs.count()).toBe(0);
    expect(await db.weights.get('w1')).toEqual(weight('w1'));
    expect(await db.profile.get('me')).toEqual(profile());

    await unlinkKeepingData(db, { pause: true });
    expect(await readMeta(db)).toEqual({ id: 'sync', paused: true });
  });
});

describe('applyRestore', () => {
  const snapshot = (rows: WireRow[], head = 20) => ({ dataset: DATASET, head, rows });
  const account = () =>
    snapshot([
      wireRow('profile', 'me', 1, profile({ rolloverHour: 4 })),
      ...Array.from({ length: 30 }, (_, i) => wireRow('meals', `m${i}`, i + 2, meal(`m${i}`, i === 0 ? { photoId: 'p-kept' } : {}))),
      wireRow('weights', 'w-gone', 40, null),
      wireRow('somethingNew', 'x', 41, { id: 'x' }),
    ]);

  it('restores in one commit, so an observer never sees the profile without its meals', async () => {
    const seen: { profile: boolean; meals: number }[] = [];
    const subscription = liveQuery(async () => ({ profile: (await db.profile.get('me')) !== undefined, meals: await db.meals.count() })).subscribe(
      (state) => {
        seen.push(state);
      },
    );
    try {
      await vi.waitFor(() => expect(seen).toHaveLength(1));
      expect(await applyRestore(db, account(), { userId: USER, expect: 'noProfile', defaults: { theme: 'light' }, now: 7_000 })).toEqual({ meals: 30 });
      await vi.waitFor(() => expect(seen.at(-1)).toEqual({ profile: true, meals: 30 }));
    } finally {
      subscription.unsubscribe();
    }
    expect(seen.every((s) => !s.profile || s.meals === 30)).toBe(true);
    expect(await db.profile.get('me')).toEqual({ ...profile({ rolloverHour: 4, theme: 'light', useLocation: false }), demoMode: undefined });
    expect(await queued()).toEqual([]);
    expect(await db.syncRevs.get(['weights', 'w-gone'])).toMatchObject({ rev: 40, hash: 'deleted' });
    expect(await db.syncRevs.get(['somethingNew', 'x'])).toBeUndefined();
    expect(await readMeta(db)).toEqual({ id: 'sync', lastSyncedAt: 7_000, link: expect.objectContaining({ userId: USER, dataset: DATASET, cursor: 20, linkedAt: 7_000 }) });
  });

  it('deletes photos no restored meal uses', async () => {
    const photo = (id: string) => ({ id, blob: new Blob(['a']), thumb: new Blob(['b']), createdAt: '2026-10-16T06:16:00.000Z' });
    await db.photos.bulkPut([photo('p-kept'), photo('p-orphan')]);
    await applyRestore(db, account(), { userId: USER, expect: 'noProfile', defaults: DEFAULTS, now: 1 });
    expect(await db.photos.toCollection().primaryKeys()).toEqual(['p-kept']);
  });

  it('replaces a set-up device, keeping its theme and location permission', async () => {
    await db.profile.put(profile({ theme: 'dark', useLocation: true }));
    await db.meals.put(meal('local-only'));
    await applyRestore(db, account(), { userId: USER, expect: 'replace', defaults: DEFAULTS, now: 1 });
    expect(await db.meals.get('local-only')).toBeUndefined();
    expect(await db.meals.count()).toBe(30);
    expect(await db.profile.get('me')).toMatchObject({ rolloverHour: 4, theme: 'dark', useLocation: true });
    expect(await queued()).toEqual([]);
  });

  it.each([
    { name: 'a profile appeared before a restore', expect: 'noProfile' as const, setup: () => db.profile.put(profile()) },
    { name: 'there is no diary to replace', expect: 'replace' as const, setup: async () => {} },
    { name: 'the diary to replace is the demo', expect: 'replace' as const, setup: () => db.profile.put(profile({ demoMode: true })) },
  ])('throws RestoreConflict and writes nothing when $name', async ({ expect: mode, setup }) => {
    await setup();
    const before = await db.profile.get('me');
    await expect(applyRestore(db, account(), { userId: USER, expect: mode, defaults: DEFAULTS, now: 1 })).rejects.toBeInstanceOf(RestoreConflict);
    expect(await db.profile.get('me')).toEqual(before);
    expect(await db.meals.count()).toBe(0);
    expect((await readMeta(db)).link).toBeUndefined();
  });

  it('throws RestoreConflict when the account has no profile', async () => {
    await expect(
      applyRestore(db, snapshot([wireRow('meals', 'm1', 1, meal('m1'))]), { userId: USER, expect: 'noProfile', defaults: DEFAULTS, now: 1 }),
    ).rejects.toBeInstanceOf(RestoreConflict);
    expect(await db.meals.count()).toBe(0);
  });
});

describe('status and upkeep', () => {
  it('records success and errors in syncMeta', async () => {
    const link = await linked();
    await recordError(db, 'unreachable', 10);
    expect((await readMeta(db)).lastError).toEqual({ kind: 'unreachable', at: 10 });
    await recordSuccess(db, link, 20);
    expect(await readMeta(db)).toMatchObject({ lastSyncedAt: 20 });
    expect((await readMeta(db)).lastError).toBeUndefined();
    await recordSuccess(db, { ...link, deviceId: 'other' }, 30);
    expect((await readMeta(db)).lastSyncedAt).toBe(20);
  });

  it('pauses and resumes', async () => {
    await setPaused(db, true);
    expect(await readMeta(db)).toEqual({ id: 'sync', paused: true });
    await setPaused(db, false);
    expect(await readMeta(db)).toEqual({ id: 'sync' });
  });

  it('pulls everything again once after a protocol bump', async () => {
    const link = await linked(8);
    await db.syncMeta.put({ id: 'sync', link: { ...link, protocol: 0 } });
    await bumpProtocolIfNeeded(db);
    expect(await currentLink()).toMatchObject({ cursor: 0, protocol: 1 });
    await applyPage(db, link, 0, page([], 8), 500, DEFAULTS);
    await bumpProtocolIfNeeded(db);
    expect((await currentLink()).cursor).toBe(8);
  });
});
