// @vitest-environment node
import { createDb, type KiraMakanDb } from '@/db/db';
import type { MealLog } from '@/domain/types';
import {
  bulkPutMeals,
  countMeals,
  deleteBonus,
  deleteDayRecord,
  deleteMeal,
  deleteWeight,
  deleteWorkout,
  getBonus,
  getDayRecord,
  getMeal,
  getWeight,
  getWorkout,
  latestWeight,
  listBonusesInRange,
  listDayRecordsByStatus,
  listDayRecordsInRange,
  listMealsAtPlace,
  listMealsForDay,
  listMealsInRange,
  listMealsSince,
  listRecentMeals,
  listWeights,
  listWeightsInRange,
  listWorkouts,
  listWorkoutsForDay,
  listWorkoutsInRange,
  putBonus,
  putDayRecord,
  putMeal,
  putWeight,
  putWorkout,
  setDayStatus,
  setSleepAt,
  updateBonus,
  updateMeal,
  updateWeight,
  updateWorkout,
} from '.';

let db: KiraMakanDb;
beforeEach(() => {
  db = createDb(`test-${crypto.randomUUID()}`);
});
afterEach(() => db.delete());

function meal(id: string, logicalDay: string, eatenAt: string, extra: Partial<MealLog> = {}): MealLog {
  return {
    id,
    eatenAt,
    logicalDay,
    slot: 'lunch',
    name: 'Economy rice',
    items: [
      {
        id: `${id}-1`,
        name: 'Rice',
        unitMacros: { kcal: 200, proteinG: 4, carbsG: 45, fatG: 0.4 },
        quantity: 1,
        uncertainty: 0.15,
        source: 'catalogue',
      },
    ],
    method: 'plate',
    finished: 'all',
    createdAt: eatenAt,
    updatedAt: eatenAt,
    syncState: 'local',
    ...extra,
  };
}

describe('meals repo', () => {
  // A 12:30am supper on Sat belongs to Fri's logical day.
  const friLunch = meal('fri-lunch', '2026-10-09', '2026-10-09T05:20:00.000Z', { placeId: 'kedai' });
  const friSupper = meal('fri-supper', '2026-10-09', '2026-10-09T16:30:00.000Z', { slot: 'supper' });
  const satBreakfast = meal('sat-breakfast', '2026-10-10', '2026-10-10T02:30:00.000Z', { slot: 'breakfast' });
  const monLunch = meal('mon-lunch', '2026-10-12', '2026-10-12T05:30:00.000Z', { placeId: 'kedai' });

  it('round-trips, updates and deletes with the row returned for undo', async () => {
    await putMeal(db, friLunch);
    expect(await getMeal(db, friLunch.id)).toEqual(friLunch);

    expect(await updateMeal(db, friLunch.id, { name: 'Nasi campur', priceRm: 9.5 })).toBe(true);
    expect(await getMeal(db, friLunch.id)).toMatchObject({ name: 'Nasi campur', priceRm: 9.5 });
    expect(await updateMeal(db, 'missing', { name: 'x' })).toBe(false);

    const removed = await deleteMeal(db, friLunch.id);
    expect(removed?.name).toBe('Nasi campur');
    expect(await getMeal(db, friLunch.id)).toBeUndefined();
    expect(await deleteMeal(db, friLunch.id)).toBeUndefined();

    if (removed) await putMeal(db, removed);
    expect(await countMeals(db)).toBe(1);
  });

  it('queries by logical day and range, in eating order', async () => {
    await bulkPutMeals(db, [monLunch, satBreakfast, friSupper, friLunch]);

    expect((await listMealsForDay(db, '2026-10-09')).map((m) => m.id)).toEqual(['fri-lunch', 'fri-supper']);
    expect((await listMealsForDay(db, '2026-10-11')).map((m) => m.id)).toEqual([]);
    expect((await listMealsInRange(db, '2026-10-09', '2026-10-10')).map((m) => m.id)).toEqual(['fri-lunch', 'fri-supper', 'sat-breakfast']);
    expect((await listMealsInRange(db, '2026-10-05', '2026-10-11')).length).toBe(3);
    expect((await listMealsAtPlace(db, 'kedai')).map((m) => m.id)).toEqual(['fri-lunch', 'mon-lunch']);
    expect((await listMealsSince(db, '2026-10-10T00:00:00.000Z')).map((m) => m.id)).toEqual(['sat-breakfast', 'mon-lunch']);
    expect((await listRecentMeals(db, 2)).map((m) => m.id)).toEqual(['mon-lunch', 'sat-breakfast']);
  });
});

describe('weights repo', () => {
  it('round-trips and queries weigh-ins', async () => {
    await putWeight(db, { id: 'w2', measuredAt: '2026-10-16T00:05:00.000Z', logicalDay: '2026-10-16', kg: 77.8 });
    await putWeight(db, { id: 'w1', measuredAt: '2026-10-15T00:05:00.000Z', logicalDay: '2026-10-15', kg: 77.7 });
    expect((await getWeight(db, 'w1'))?.kg).toBe(77.7);
    expect((await listWeights(db)).map((w) => w.id)).toEqual(['w1', 'w2']);
    expect((await listWeightsInRange(db, '2026-10-16', '2026-10-18')).map((w) => w.id)).toEqual(['w2']);
    expect((await latestWeight(db))?.kg).toBe(77.8);

    expect(await updateWeight(db, 'w2', { kg: 77.9 })).toBe(true);
    expect((await latestWeight(db))?.kg).toBe(77.9);
    await deleteWeight(db, 'w2');
    expect((await latestWeight(db))?.id).toBe('w1');
  });
});

describe('workouts and bonuses repos', () => {
  it('round-trips workouts and queries by day', async () => {
    const futsal = { id: 'futsal', logicalDay: '2026-10-06', type: 'futsal', minutes: 60, intensity: 'moderate', netKcal: 470, createdAt: '2026-10-06T12:10:00.000Z' } as const;
    const walk = { id: 'walk', logicalDay: '2026-10-13', type: 'walking', minutes: 30, intensity: 'easy', netKcal: 90, createdAt: '2026-10-13T11:00:00.000Z' } as const;
    await putWorkout(db, walk);
    await putWorkout(db, futsal);
    expect(await getWorkout(db, 'futsal')).toEqual(futsal);
    expect((await listWorkoutsInRange(db, '2026-10-05', '2026-10-11')).map((w) => w.id)).toEqual(['futsal']);
    expect((await listWorkoutsForDay(db, '2026-10-13')).map((w) => w.id)).toEqual(['walk']);
    expect((await listWorkouts(db)).map((w) => w.id)).toEqual(['walk', 'futsal']);

    expect(await updateWorkout(db, 'walk', { minutes: 45 })).toBe(true);
    expect((await getWorkout(db, 'walk'))?.minutes).toBe(45);
    await deleteWorkout(db, 'walk');
    expect(await getWorkout(db, 'walk')).toBeUndefined();
  });

  it('round-trips one-off bonuses', async () => {
    const bonus = { id: 'b1', logicalDay: '2026-10-17', kcal: 300, reason: 'Hiking day', createdAt: '2026-10-16T10:00:00.000Z' };
    await putBonus(db, bonus);
    expect(await getBonus(db, 'b1')).toEqual(bonus);
    expect((await listBonusesInRange(db, '2026-10-12', '2026-10-18')).map((b) => b.id)).toEqual(['b1']);
    expect(await listBonusesInRange(db, '2026-10-05', '2026-10-11')).toEqual([]);
    expect(await updateBonus(db, 'b1', { kcal: 250 })).toBe(true);
    expect((await getBonus(db, 'b1'))?.kcal).toBe(250);
    await deleteBonus(db, 'b1');
    expect(await getBonus(db, 'b1')).toBeUndefined();
  });
});

describe('days repo', () => {
  it('round-trips day records and queries by range and status', async () => {
    await putDayRecord(db, { logicalDay: '2026-10-11', status: 'notCounted', confirmedAt: '2026-10-12T01:00:00.000Z' });
    await putDayRecord(db, { logicalDay: '2026-10-10', status: 'complete' });
    expect((await getDayRecord(db, '2026-10-11'))?.status).toBe('notCounted');
    expect((await listDayRecordsInRange(db, '2026-10-05', '2026-10-11')).map((d) => d.logicalDay)).toEqual(['2026-10-10', '2026-10-11']);
    expect((await listDayRecordsByStatus(db, 'complete')).map((d) => d.logicalDay)).toEqual(['2026-10-10']);
    await deleteDayRecord(db, '2026-10-10');
    expect(await getDayRecord(db, '2026-10-10')).toBeUndefined();
  });

  it('sets a status while keeping the sleep tap', async () => {
    await setSleepAt(db, '2026-10-15', '2026-10-15T17:30:00.000Z');
    expect(await getDayRecord(db, '2026-10-15')).toEqual({ logicalDay: '2026-10-15', status: 'unconfirmed', sleepAt: '2026-10-15T17:30:00.000Z' });

    const confirmed = await setDayStatus(db, '2026-10-15', 'guess', '2026-10-16T01:00:00.000Z');
    expect(confirmed).toEqual({ logicalDay: '2026-10-15', status: 'guess', confirmedAt: '2026-10-16T01:00:00.000Z', sleepAt: '2026-10-15T17:30:00.000Z' });
    expect(await getDayRecord(db, '2026-10-15')).toEqual(confirmed);

    await setSleepAt(db, '2026-10-15', null);
    expect((await getDayRecord(db, '2026-10-15'))?.sleepAt).toBeUndefined();
    expect((await getDayRecord(db, '2026-10-15'))?.status).toBe('guess');
  });
});
