// @vitest-environment node
import Dexie from 'dexie';
import {
  DB_NAME,
  DRIVE_STORES,
  SCHEMA_V1,
  SYNC_PROTOCOL,
  SYNC_STORES,
  SYNC_TABLES,
  TABLE_NAMES,
  clearAllTables,
  createDb,
  db as singleton,
  newId,
  type KiraMakanDb,
} from './db';

// The app database must load without supabase-js: it is only imported when someone signs in.
const loaded = vi.hoisted(() => ({ supabase: false }));
vi.mock('@supabase/supabase-js', () => {
  loaded.supabase = true;
  return {};
});

let db: KiraMakanDb;
beforeEach(() => {
  db = createDb(`test-${crypto.randomUUID()}`);
});
afterEach(() => db.delete());

describe('database schema', () => {
  it('is kira-makan version 3', () => {
    expect(singleton.name).toBe(DB_NAME);
    expect(DB_NAME).toBe('kira-makan');
    expect(db.verno).toBe(3);
  });

  it('keeps the 17 data tables of version 1 for export and import', () => {
    expect(TABLE_NAMES).toHaveLength(17);
    expect(Object.keys(SCHEMA_V1)).toEqual(TABLE_NAMES);
    expect(TABLE_NAMES.some((t) => t in SYNC_STORES)).toBe(false);
    expect(TABLE_NAMES.some((t) => t in DRIVE_STORES)).toBe(false);
  });

  it('keeps the Drive bookkeeping out of sync, with no protocol bump', () => {
    expect(Object.keys(DRIVE_STORES)).toEqual(['driveJobs', 'driveMeta']);
    expect(SYNC_TABLES.some((t) => t in DRIVE_STORES)).toBe(false);
    expect(SYNC_PROTOCOL).toBe(1);
  });

  it('has exactly the tables and indexes of ARCHITECTURE.md §6', async () => {
    await db.open();
    const schema = Object.fromEntries(
      db.tables.map((t) => [t.name, [t.schema.primKey.src, ...t.schema.indexes.map((i) => i.src)].join(', ')]),
    );
    expect(schema).toEqual({
      profile: 'id',
      goals: 'id, status',
      goalVersions: 'id, goalId, effectiveFrom',
      goalPeriods: 'id, goalId, from',
      meals: 'id, logicalDay, eatenAt, placeId, slot',
      weights: 'id, logicalDay, measuredAt',
      workouts: 'id, logicalDay',
      bonuses: 'id, logicalDay',
      days: 'logicalDay, status',
      weekPlans: 'weekStart',
      places: 'id, name',
      usuals: 'id, placeId',
      pots: 'id, expiresOn',
      photos: 'id',
      insightFeedback: 'ruleId',
      suggestionEvents: 'id, at',
      personalItems: 'id, catalogueId, placeId',
      syncOutbox: '[table+key], changedAt',
      syncRevs: '[table+key]',
      syncMeta: 'id',
      driveJobs: 'id, notBefore',
      driveMeta: 'id',
    });
    expect(db.tables).toHaveLength(22);
  });

  it('syncs every data table but photos, each keyed by one string field', async () => {
    await db.open();
    expect(SYNC_TABLES).toEqual(TABLE_NAMES.filter((t) => t !== 'photos'));
    expect(SYNC_TABLES).toHaveLength(16);
    for (const name of SYNC_TABLES) {
      const { primKey } = db.table(name).schema;
      expect({ name, keyPath: typeof primKey.keyPath, auto: primKey.auto, compound: primKey.compound }).toEqual({
        name,
        keyPath: 'string',
        auto: false,
        compound: false,
      });
    }
  });

  it('clears every table at once, sync and Drive bookkeeping included', async () => {
    await db.weekPlans.put({ weekStart: '2026-10-12', makanDay: '2026-10-17' });
    await db.insightFeedback.put({ ruleId: 'drinks', feedback: 'useful', at: '2026-10-11T14:00:00.000Z' });
    await db.syncOutbox.put({ table: 'weekPlans', key: '2026-10-12', changedAt: 1, nonce: 'n1' });
    await db.syncRevs.put({ table: 'weekPlans', key: '2026-10-12', rev: 4, hash: 'abc' });
    await db.syncMeta.put({ id: 'sync', lastSyncedAt: 1 });
    await db.driveJobs.put({ id: 'upload:p1', kind: 'upload', photoId: 'p1', mealId: 'm1', createdAt: 1, notBefore: 1, attempts: 0 });
    await db.driveMeta.put({ id: 'drive', connectedAt: 1, email: 'you@example.com' });
    await clearAllTables(db);
    expect(await db.weekPlans.count()).toBe(0);
    expect(await db.insightFeedback.count()).toBe(0);
    expect(await db.syncOutbox.count()).toBe(0);
    expect(await db.syncRevs.count()).toBe(0);
    expect(await db.syncMeta.count()).toBe(0);
    expect(await db.driveJobs.count()).toBe(0);
    expect(await db.driveMeta.count()).toBe(0);
  });

  it('never records the Drive bookkeeping for sync', async () => {
    const captured = createDb(`drive-${crypto.randomUUID()}`, { capture: () => true });
    try {
      await captured.driveJobs.put({ id: 'file:abc', kind: 'file', fileId: 'abcdefghijkl', trashed: true, createdAt: 1, notBefore: 1, attempts: 0 });
      await captured.driveMeta.put({ id: 'drive', connectedAt: 1 });
      await captured.transaction('rw', [captured.driveJobs, captured.driveMeta], async () => {
        await captured.driveJobs.delete('file:abc');
        await captured.driveMeta.update('drive', { folderId: 'folder' });
      });
      expect(await captured.syncOutbox.count()).toBe(0);
    } finally {
      await captured.delete();
    }
  });

  it('upgrades a version 1 database in place, with the sync tables empty', async () => {
    const name = `upgrade-${crypto.randomUUID()}`;
    const v1 = new Dexie(name);
    v1.version(1).stores(SCHEMA_V1);
    await v1.table('weekPlans').put({ weekStart: '2026-10-12', makanDay: '2026-10-17' });
    await v1.table('weights').put({ id: 'w1', kg: 78.6, measuredAt: '2026-10-03T00:05:00.000Z', logicalDay: '2026-10-03' });
    v1.close();

    const upgraded = createDb(name, { capture: () => true });
    try {
      await upgraded.open();
      expect(upgraded.verno).toBe(3);
      expect(await upgraded.weekPlans.toArray()).toEqual([{ weekStart: '2026-10-12', makanDay: '2026-10-17' }]);
      expect(await upgraded.weights.get('w1')).toMatchObject({ kg: 78.6 });
      expect(await upgraded.syncOutbox.count()).toBe(0);
      expect(await upgraded.syncRevs.count()).toBe(0);
      expect(await upgraded.syncMeta.count()).toBe(0);

      // Rows from before version 2 are queued when the device links; new writes are captured.
      await upgraded.weekPlans.put({ weekStart: '2026-10-19' });
      expect(await upgraded.syncOutbox.toArray()).toMatchObject([{ table: 'weekPlans', key: '2026-10-19' }]);
    } finally {
      await upgraded.delete();
    }
  });

  it('upgrades a version 2 database in place, with the Drive tables empty', async () => {
    const name = `upgrade-v2-${crypto.randomUUID()}`;
    const v2 = new Dexie(name);
    v2.version(1).stores(SCHEMA_V1);
    v2.version(2).stores(SYNC_STORES);
    await v2.table('meals').put({ id: 'm1', photoId: 'p1', logicalDay: '2026-10-16', eatenAt: '2026-10-16T11:00:00.000Z', slot: 'dinner' });
    await v2.table('photos').put({ id: 'p1', blob: new Blob(['a']), thumb: new Blob(['b']), createdAt: '2026-10-16T11:00:00.000Z' });
    await v2.table('syncMeta').put({ id: 'sync', lastSyncedAt: 5 });
    v2.close();

    const upgraded = createDb(name, { capture: () => true });
    try {
      await upgraded.open();
      expect(upgraded.verno).toBe(3);
      expect(await upgraded.meals.get('m1')).toMatchObject({ photoId: 'p1' });
      expect(await upgraded.photos.count()).toBe(1);
      expect(await upgraded.syncMeta.get('sync')).toMatchObject({ lastSyncedAt: 5 });
      expect(await upgraded.driveJobs.count()).toBe(0);
      expect(await upgraded.driveMeta.count()).toBe(0);
    } finally {
      await upgraded.delete();
    }
  });

  it('makes unique ids', () => {
    const ids = new Set(Array.from({ length: 100 }, newId));
    expect(ids.size).toBe(100);
  });
});

describe('the app database', () => {
  afterEach(async () => {
    vi.unstubAllEnvs();
    await clearAllTables(singleton);
  });

  it('records changes for sync only when Supabase is configured', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_KEY', '');
    await singleton.weekPlans.put({ weekStart: '2026-10-12' });
    expect(await singleton.syncOutbox.count()).toBe(0);

    vi.stubEnv('VITE_SUPABASE_URL', 'https://abcdefgh.supabase.co');
    vi.stubEnv('VITE_SUPABASE_KEY', 'sb_publishable_test_key');
    await singleton.weekPlans.put({ weekStart: '2026-10-19' });
    expect(await singleton.syncOutbox.toArray()).toMatchObject([{ table: 'weekPlans', key: '2026-10-19' }]);
  });

  it('loads without supabase-js', () => {
    expect(loaded.supabase).toBe(false);
  });
});
