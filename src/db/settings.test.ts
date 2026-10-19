import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createActions } from '@/db/actions';
import { createDb, type KiraMakanDb } from '@/db/db';
import { DEMO_EXPECTED } from '@/db/seed/demo';
import { dailyTargetFor, startingMaintenance } from '@/domain/targets';
import {
  addRegulars,
  clearLastExport,
  defaultDailyMinimum,
  finishSetup,
  getMoreSummary,
  readLastExport,
  updateProfileSettings,
  writeLastExport,
} from './settings';

let db: KiraMakanDb;
let seq = 0;

beforeEach(() => {
  seq += 1;
  db = createDb(`settings-test-${seq}`);
});

afterEach(async () => {
  db.close();
  await db.delete();
});

const SETUP = {
  age: 30,
  sex: 'male' as const,
  heightCm: 172,
  weightKg: 78.6,
  activity: 'light' as const,
  paceKgPerWeek: 0.5,
  dailyMinimumKcal: 1400,
  places: [{ name: 'Home', type: 'home' as const }],
  rolloverHour: 5,
  timeZone: 'Asia/Kuala_Lumpur',
};

describe('updateProfileSettings', () => {
  it('writes profile fields and leaves goal versions alone', async () => {
    await createActions(db).loadDemoData();
    const before = await db.goalVersions.toArray();

    const profile = await updateProfileSettings({ age: 31, heightCm: 174, theme: 'dark', dailyMinimumKcal: 1450 }, db);

    expect(profile).toMatchObject({ age: 31, heightCm: 174, theme: 'dark', dailyMinimumKcal: 1450 });
    expect(await db.goalVersions.toArray()).toEqual(before);
  });

  it('rejects values out of range and needs a profile', async () => {
    await expect(updateProfileSettings({ age: 31 }, db)).rejects.toThrow(/no profile/);
    await createActions(db).loadDemoData();
    await expect(updateProfileSettings({ age: 7 }, db)).rejects.toThrow(RangeError);
    await expect(updateProfileSettings({ age: 30.5 }, db)).rejects.toThrow(RangeError);
    await expect(updateProfileSettings({ heightCm: 400 }, db)).rejects.toThrow(RangeError);
    await expect(updateProfileSettings({ dailyMinimumKcal: 500 }, db)).rejects.toThrow(RangeError);
    await expect(updateProfileSettings({ rolloverHour: 24 }, db)).rejects.toThrow(RangeError);
  });
});

describe('regulars', () => {
  it('saves combos as one Usual each and skips names already there', async () => {
    const regulars = [
      { name: 'Roti canai + teh tarik', foods: [{ catalogueId: 'roti-canai-dhal' }, { catalogueId: 'teh-tarik' }], slot: 'breakfast' as const },
      { name: 'Unknown', foods: [{ catalogueId: 'not-a-food' }] },
    ];
    const added = await addRegulars(regulars, db);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ name: 'Roti canai + teh tarik', slot: 'breakfast', useCount: 0 });
    expect(added[0]?.items.map((i) => [i.catalogueId, i.original?.quantity])).toEqual([
      ['roti-canai-dhal', 1],
      ['teh-tarik', 1],
    ]);

    expect(await addRegulars(regulars, db)).toHaveLength(0);
    expect(await db.usuals.count()).toBe(1);
  });

  it('finishSetup creates the Cut goal and the Usuals', async () => {
    const result = await finishSetup(SETUP, [{ name: 'Teh o ais', foods: [{ catalogueId: 'teh-o-ais' }] }], db);
    expect(result.goal).toMatchObject({ template: 'cut', status: 'active' });
    const maintenance = startingMaintenance(SETUP);
    expect(result.version).toMatchObject({ maintenanceKcal: maintenance, dailyKcal: dailyTargetFor({ template: 'cut', paceKgPerWeek: 0.5 }, maintenance, 1400) });
    expect((await db.usuals.toArray()).map((u) => u.name)).toEqual(['Teh o ais']);
  });

  it('defaults the daily minimum by sex', () => {
    expect(defaultDailyMinimum('male')).toBe(1400);
    expect(defaultDailyMinimum('female')).toBe(1200);
    expect(defaultDailyMinimum(null)).toBe(1400);
  });
});

describe('getMoreSummary', () => {
  it('summarises the demo library', async () => {
    await createActions(db).loadDemoData();
    const summary = await getMoreSummary(DEMO_EXPECTED.today.day, db);
    expect(summary.placeCount).toBe(DEMO_EXPECTED.counts.places);
    expect(summary.usualCount).toBe(DEMO_EXPECTED.counts.usuals);
    expect(summary.topPlace?.name).toBeDefined();
    expect(summary.pot).toMatchObject({ name: 'Kari ayam', servingsLeft: 3, servings: 8 });
    expect(summary.lastWorkout).toMatchObject({ type: 'futsal', netKcal: 470 });
    expect(summary.goals).toHaveLength(DEMO_EXPECTED.counts.goals);
  });
});

describe('last export', () => {
  afterEach(() => clearLastExport());

  it('round-trips through localStorage and ignores junk', () => {
    expect(readLastExport()).toBeNull();
    writeLastExport({ at: '2026-10-16T11:10:00.000Z', kind: 'json' });
    expect(readLastExport()).toEqual({ at: '2026-10-16T11:10:00.000Z', kind: 'json' });
    window.localStorage.setItem('kira-makan:last-export', '{"at":"nope","kind":"json"}');
    expect(readLastExport()).toBeNull();
  });
});
