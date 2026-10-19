// @vitest-environment node
import { DB_NAME, clearAllTables, createDb, db as singleton, newId, type KiraMakanDb } from './db';

let db: KiraMakanDb;
beforeEach(() => {
  db = createDb(`test-${crypto.randomUUID()}`);
});
afterEach(() => db.delete());

describe('database schema', () => {
  it('is kira-makan version 1', () => {
    expect(singleton.name).toBe(DB_NAME);
    expect(DB_NAME).toBe('kira-makan');
    expect(db.verno).toBe(1);
  });

  it('has exactly the tables and indexes of ARCHITECTURE.md §6', async () => {
    await db.open();
    const schema = Object.fromEntries(
      db.tables.map((t) => [t.name, [t.schema.primKey.keyPath, ...t.schema.indexes.map((i) => i.keyPath)].join(', ')]),
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
    });
  });

  it('clears every table at once', async () => {
    await db.weekPlans.put({ weekStart: '2026-10-12', makanDay: '2026-10-17' });
    await db.insightFeedback.put({ ruleId: 'drinks', feedback: 'useful', at: '2026-10-11T14:00:00.000Z' });
    await clearAllTables(db);
    expect(await db.weekPlans.count()).toBe(0);
    expect(await db.insightFeedback.count()).toBe(0);
  });

  it('makes unique ids', () => {
    const ids = new Set(Array.from({ length: 100 }, newId));
    expect(ids.size).toBe(100);
  });
});
