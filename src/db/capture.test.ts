// @vitest-environment node
import Dexie, { liveQuery } from 'dexie';
import { setDemoClock } from '@/domain/clock';
import type { DayRecord, GoalPeriod, WeightLog } from '@/domain/types';
import { createActions, type SetupInput } from './actions';
import { markUncaptured } from './capture';
import { createDb, SYNC_TABLES, TABLE_NAMES, type KiraMakanDb } from './db';
import { exportAll, importAll } from './export';
import { loadDemo } from './seed/demo';

let db: KiraMakanDb;

beforeEach(() => {
  db = createDb(`capture-${crypto.randomUUID()}`, { capture: () => true });
});

afterEach(async () => {
  setDemoClock(false);
  vi.restoreAllMocks();
  await db.delete();
});

const weight = (id: string, kg = 78): WeightLog => ({ id, kg, measuredAt: '2026-10-16T00:05:00.000Z', logicalDay: '2026-10-16' });
const period = (id: string, goalId: string): GoalPeriod => ({ id, goalId, from: '2026-10-12' });
const day = (logicalDay: string): DayRecord => ({ logicalDay, status: 'complete' });
/** w000, w001, … so key ranges and sort order agree. */
const weights = (n: number): WeightLog[] => Array.from({ length: n }, (_, i) => weight(`w${String(i).padStart(3, '0')}`));
const photo = (id: string) => ({ id, blob: new Blob(['a']), thumb: new Blob(['b']), createdAt: '2026-10-16T06:16:00.000Z' });

/** The outbox as sorted "table/key" strings. */
async function queued(database: KiraMakanDb = db): Promise<string[]> {
  return (await database.syncOutbox.toArray()).map((e) => `${e.table}/${e.key}`).sort();
}

/** Rows written before the case runs, with the outbox emptied after. */
async function seed(fn: () => Promise<unknown>): Promise<void> {
  await fn();
  await db.syncOutbox.clear();
}

describe('what each write shape records', () => {
  const cases: { name: string; seed?: () => Promise<unknown>; write: () => Promise<unknown>; expected: string[] }[] = [
    { name: 'put', write: () => db.weights.put(weight('a')), expected: ['weights/a'] },
    { name: 'add', write: () => db.weights.add(weight('a')), expected: ['weights/a'] },
    { name: 'bulkPut', write: () => db.weights.bulkPut([weight('a'), weight('b')]), expected: ['weights/a', 'weights/b'] },
    { name: 'a natural key', write: () => db.days.put(day('2026-10-16')), expected: ['days/2026-10-16'] },
    {
      name: 'update',
      seed: () => db.weights.bulkPut([weight('a'), weight('b')]),
      write: () => db.weights.update('a', { kg: 77 }),
      expected: ['weights/a'],
    },
    { name: 'update of a missing row', write: () => db.weights.update('nope', { kg: 77 }), expected: [] },
    {
      name: 'modify with a function',
      seed: () => db.weights.bulkPut([weight('a'), { ...weight('b'), logicalDay: '2026-10-15' }]),
      write: () => db.weights.where('logicalDay').equals('2026-10-16').modify((w) => { w.kg = 70; }),
      expected: ['weights/a'],
    },
    {
      name: 'bulkUpdate',
      seed: () => db.weights.bulkPut([weight('a'), weight('b')]),
      write: () => db.weights.bulkUpdate([{ key: 'a', changes: { kg: 1 } }, { key: 'nope', changes: { kg: 2 } }]),
      expected: ['weights/a'],
    },
    { name: 'delete', seed: () => db.weights.put(weight('a')), write: () => db.weights.delete('a'), expected: ['weights/a'] },
    {
      name: 'bulkDelete',
      seed: () => db.weights.bulkPut([weight('a'), weight('b'), weight('c')]),
      write: () => db.weights.bulkDelete(['a', 'b']),
      expected: ['weights/a', 'weights/b'],
    },
    {
      name: "where('goalId').equals().delete()",
      seed: () => db.goalPeriods.bulkPut([period('p1', 'g1'), period('p2', 'g1'), period('p3', 'g2')]),
      write: () => db.goalPeriods.where('goalId').equals('g1').delete(),
      expected: ['goalPeriods/p1', 'goalPeriods/p2'],
    },
    {
      name: "where(':id').between().delete() lists the keys first",
      seed: () => db.weights.bulkPut(weights(5)),
      write: () => db.weights.where(':id').between('w001', 'w003').delete(),
      expected: ['weights/w001', 'weights/w002'],
    },
    {
      name: "where(':id').equals().delete()",
      seed: () => db.weights.bulkPut(weights(3)),
      write: () => db.weights.where(':id').equals('w001').delete(),
      expected: ['weights/w001'],
    },
  ];

  it.each(cases)('$name', async ({ seed: before, write, expected }) => {
    if (before) await seed(before);
    await write();
    expect(await queued()).toEqual(expected);
  });

  it('modify over 250 rows records every row (Dexie writes it in chunks of 200)', async () => {
    await seed(() => db.weights.bulkPut(weights(250)));
    expect(await db.weights.toCollection().modify({ kg: 70 })).toBe(250);
    expect(await queued()).toEqual(weights(250).map((w) => `weights/${w.id}`));
  });

  it('coalesces repeat writes of a key into one entry with a new nonce and time', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000);
    await db.weights.put(weight('a'));
    const [first] = await db.syncOutbox.toArray();
    now.mockReturnValue(2_000);
    await db.weights.put(weight('a', 77));
    const entries = await db.syncOutbox.toArray();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ table: 'weights', key: 'a', changedAt: 2_000 });
    expect(first?.changedAt).toBe(1_000);
    expect(entries[0]?.nonce).not.toBe(first?.nonce);
  });

  it('never records clear(), or a delete of the whole table', async () => {
    await seed(() => db.weights.bulkPut([weight('a'), weight('b')]));
    await db.weights.clear();
    await db.goalPeriods.bulkPut([period('p1', 'g1')]);
    await db.syncOutbox.clear();
    await db.goalPeriods.toCollection().delete();
    expect(await db.weights.count()).toBe(0);
    expect(await db.goalPeriods.count()).toBe(0);
    expect(await queued()).toEqual([]);
  });

  it('never records photos', async () => {
    await db.photos.put(photo('photo-1'));
    await db.photos.bulkDelete(['photo-1']);
    expect(await queued()).toEqual([]);
  });

  it('records only the rows a caught bulkAdd error let through', async () => {
    await seed(() => db.weights.put(weight('b', 90)));
    await db.transaction('rw', db.weights, async () => {
      await expect(db.weights.bulkAdd([weight('a'), weight('b'), weight('c')])).rejects.toBeInstanceOf(Dexie.BulkError);
    });
    expect(await queued()).toEqual(['weights/a', 'weights/c']);
    expect((await db.weights.get('b'))?.kg).toBe(90);

    // Outside a transaction the rows that went in stay too.
    await db.syncOutbox.clear();
    await expect(db.weights.bulkAdd([weight('d'), weight('b')])).rejects.toBeInstanceOf(Dexie.BulkError);
    expect(await queued()).toEqual(['weights/d']);
  });

  it('records nothing for a write that fails', async () => {
    await seed(() => db.weights.put(weight('a')));
    await expect(db.weights.add(weight('a'))).rejects.toMatchObject({ name: 'ConstraintError' });
    expect(await queued()).toEqual([]);
  });
});

describe('transactions', () => {
  it('drops the markers with an aborted transaction', async () => {
    await expect(
      db.transaction('rw', db.weights, db.days, async () => {
        await db.weights.put(weight('a'));
        await db.days.put(day('2026-10-16'));
        throw new Error('stop');
      }),
    ).rejects.toThrow('stop');
    expect(await db.weights.count()).toBe(0);
    expect(await queued()).toEqual([]);
  });

  it('captures in auto, explicit, nested and non-async transactions, and in parallel writes', async () => {
    await db.weights.put(weight('auto'));
    await db.transaction('rw', db.weights, () => db.weights.put(weight('sync-scope')));
    await db.transaction('rw', [db.weights, db.days], async () => {
      await db.transaction('rw', db.weights, async () => {
        await db.weights.put(weight('nested'));
      });
      await Promise.all([db.days.put(day('2026-10-16')), db.weights.bulkPut([weight('p1'), weight('p2')]), db.weights.update('auto', { kg: 1 })]);
    });
    expect(await queued()).toEqual(['days/2026-10-16', 'weights/auto', 'weights/nested', 'weights/p1', 'weights/p2', 'weights/sync-scope']);
  });

  it('keeps reads and writes in a transaction that never named the outbox working', async () => {
    const kg = await db.transaction('rw', db.weights, async () => {
      await db.weights.put(weight('a', 71));
      return (await db.weights.get('a'))?.kg;
    });
    expect(kg).toBe(71);
    expect(await db.transaction('r', db.weights, () => db.weights.count())).toBe(1);
    expect(await queued()).toEqual(['weights/a']);
  });

  it('honours markUncaptured, in nested transactions too, and only for that transaction', async () => {
    await db.transaction('rw', [db.weights, db.days], async () => {
      markUncaptured();
      await db.weights.put(weight('a'));
      await db.transaction('rw', db.days, async () => {
        await db.days.put(day('2026-10-16'));
      });
    });
    await db.transaction('rw', [db.weights, db.days], async () => {
      await db.transaction('rw', db.weights, async () => {
        markUncaptured();
        await db.weights.put(weight('b'));
      });
      await db.days.put(day('2026-10-15'));
    });
    expect(await queued()).toEqual([]);

    await db.weights.put(weight('c'));
    expect(await queued()).toEqual(['weights/c']);
  });

  it('throws when markUncaptured runs outside a transaction', () => {
    expect(() => markUncaptured()).toThrow('markUncaptured() runs inside a transaction');
  });
});

describe('when capture is off', () => {
  it('records nothing in demo mode', async () => {
    setDemoClock(true);
    await db.weights.put(weight('a'));
    await db.weights.delete('a');
    expect(await queued()).toEqual([]);
  });

  it('is off unless the database asks for it', async () => {
    const plain = createDb(`capture-off-${crypto.randomUUID()}`);
    try {
      await plain.weights.put(weight('a'));
      await plain.weights.delete('a');
      expect(await queued(plain)).toEqual([]);
    } finally {
      await plain.delete();
    }
  });

  it('asks on every write', async () => {
    let on = false;
    const toggled = createDb(`capture-toggle-${crypto.randomUUID()}`, { capture: () => on });
    try {
      await toggled.weights.put(weight('a'));
      on = true;
      await toggled.weights.put(weight('b'));
      expect(await queued(toggled)).toEqual(['weights/b']);
    } finally {
      await toggled.delete();
    }
  });
});

describe('call sites', () => {
  it('loadDemo writes no entries and clears the sync tables', async () => {
    await db.syncRevs.put({ table: 'weights', key: 'old', rev: 3 });
    await db.syncMeta.put({ id: 'sync', lastSyncedAt: 1 });
    await db.weights.put(weight('old'));
    expect(await queued()).toEqual(['weights/old']);

    await loadDemo(db);
    expect(await db.meals.count()).toBeGreaterThan(0);
    expect(await db.weights.get('old')).toBeUndefined();
    expect(await db.syncOutbox.count()).toBe(0);
    expect(await db.syncRevs.count()).toBe(0);
    expect(await db.syncMeta.count()).toBe(0);
  });

  it('setup clears the sync state and records every row it writes', async () => {
    await db.syncRevs.put({ table: 'weights', key: 'old', rev: 3 });
    await db.syncMeta.put({ id: 'sync', lastSyncedAt: 1 });
    await db.weights.put(weight('old'));
    const input: SetupInput = {
      age: 30,
      sex: 'male',
      heightCm: 172,
      weightKg: 78.6,
      activity: 'light',
      paceKgPerWeek: 0.5,
      dailyMinimumKcal: 1400,
      regulars: ['roti-canai'],
      places: [{ name: 'Home', type: 'home' }],
      rolloverHour: 5,
      timeZone: 'Asia/Kuala_Lumpur',
    };
    await createActions(db).completeSetup(input);

    const expected: string[] = [];
    for (const table of SYNC_TABLES) {
      const keys = await db.table(table).toCollection().primaryKeys();
      expected.push(...keys.map((k) => `${table}/${String(k)}`));
    }
    expect(expected).toContain('profile/me');
    expect(expected).not.toContain('weights/old');
    expect(await queued()).toEqual(expected.sort());
    expect(await db.syncRevs.count()).toBe(0);
    expect(await db.syncMeta.count()).toBe(0);
  });

  it('importAll records a tombstone for each row the file lacks and a put for each row it has', async () => {
    const source = createDb(`capture-src-${crypto.randomUUID()}`);
    try {
      await loadDemo(source);
      await db.weights.put(weight('stale'));
      await db.photos.put(photo('local'));
      await db.syncOutbox.clear();

      await importAll(db, await exportAll(source));
      expect(await db.weights.get('stale')).toBeUndefined();
      expect(await db.photos.count()).toBe(1);

      const expected: string[] = ['weights/stale'];
      for (const table of SYNC_TABLES) {
        const keys = await source.table(table).toCollection().primaryKeys();
        expected.push(...keys.map((k) => `${table}/${String(k)}`));
      }
      expect(await queued()).toEqual(expected.sort());
      expect(TABLE_NAMES.filter((t) => !(SYNC_TABLES as readonly string[]).includes(t))).toEqual(['photos']);
    } finally {
      await source.delete();
    }
  });
});

describe('observers', () => {
  it('a liveQuery on the outbox fires after a capture', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(5_000);
    const seen: (number | undefined)[] = [];
    const subscription = liveQuery(() => db.syncOutbox.orderBy('changedAt').lastKey()).subscribe((key) => {
      seen.push(key as number | undefined);
    });
    try {
      await vi.waitFor(() => expect(seen).toEqual([undefined]));
      await db.weights.put(weight('a'));
      await vi.waitFor(() => expect(seen.at(-1)).toBe(5_000));
      now.mockReturnValue(6_000);
      await db.transaction('rw', db.weights, async () => {
        await db.weights.put(weight('b'));
      });
      await vi.waitFor(() => expect(seen.at(-1)).toBe(6_000));
    } finally {
      subscription.unsubscribe();
    }
  });

  it('a liveQuery on a synced table still sees writes while capture runs', async () => {
    const seen: number[] = [];
    const subscription = liveQuery(() => db.weights.toArray()).subscribe((rows) => {
      seen.push(rows.length);
    });
    try {
      await vi.waitFor(() => expect(seen).toEqual([0]));
      await db.weights.put(weight('a'));
      await vi.waitFor(() => expect(seen.at(-1)).toBe(1));
      await db.weights.bulkPut([weight('b'), weight('c')]);
      await vi.waitFor(() => expect(seen.at(-1)).toBe(3));
      expect(await queued()).toEqual(['weights/a', 'weights/b', 'weights/c']);
    } finally {
      subscription.unsubscribe();
    }
  });
});
