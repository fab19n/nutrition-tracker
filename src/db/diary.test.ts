// @vitest-environment node
import { createActions } from '@/db/actions';
import { createDb, type KiraMakanDb } from '@/db/db';
import { DEMO_IDS } from '@/db/seed/demo';
import { getWeekBudget, getWeightTrend } from '@/db/selectors';
import { setDemoClock } from '@/domain/clock';
import { budgetUnderTarget, findMatchingUsual, getWeekGoals, lookupMeal, saveMealAsUsualIn, saveWeighInIn, usualFromMeal } from './diary';

let db: KiraMakanDb;

beforeEach(async () => {
  db = createDb(`diary-${crypto.randomUUID()}`);
  await createActions(db).loadDemoData();
});

afterEach(async () => {
  setDemoClock(false);
  await db.delete();
});

describe('lookupMeal', () => {
  it('tells a missing meal apart from a found one', async () => {
    expect((await lookupMeal(db, DEMO_IDS.meals.todayLunch)).meal?.name).toBe('Economy rice');
    expect(await lookupMeal(db, 'nope')).toEqual({ meal: null });
  });
});

describe('Save as Usual', () => {
  it('copies name, Place, slot and items without correction history', async () => {
    const meal = (await lookupMeal(db, 'meal-2026-10-13-dinner')).meal;
    if (!meal) throw new Error('missing demo meal');
    const usual = usualFromMeal(meal, '2026-10-16T11:10:00.000Z', 'usual-x');
    expect(usual).toMatchObject({ id: 'usual-x', name: meal.name, placeId: meal.placeId, slot: 'dinner', useCount: 1 });
    expect(usual.items).toHaveLength(meal.items.length);
    expect(usual.items.some((i) => i.original !== undefined || i.edited !== undefined)).toBe(false);
    expect(usual.items.map((i) => i.id)).not.toEqual(meal.items.map((i) => i.id));
  });

  it('creates once, then finds the existing Usual; undo removes it', async () => {
    const before = await db.usuals.count();
    const first = await saveMealAsUsualIn(db, DEMO_IDS.meals.todayLunch);
    expect(first.created).toBe(true);
    expect(await db.usuals.count()).toBe(before + 1);

    const again = await saveMealAsUsualIn(db, DEMO_IDS.meals.todayLunch);
    expect(again.created).toBe(false);
    expect(again.usual.id).toBe(first.usual.id);

    await first.undo();
    expect(await db.usuals.count()).toBe(before);
  });

  it('matches by name and Place', async () => {
    const usuals = await db.usuals.toArray();
    expect(findMatchingUsual(usuals, { name: 'roti canai + TEH TARIK', placeId: DEMO_IDS.places.nasiKandar })?.id).toBe(DEMO_IDS.usuals.rotiCanai);
    expect(findMatchingUsual(usuals, { name: 'Roti canai + teh tarik', placeId: DEMO_IDS.places.kedai })).toBeUndefined();
  });
});

describe('budgetUnderTarget', () => {
  it('re-budgets the week with one target and leaves the meals alone', async () => {
    const view = await getWeekBudget(db);
    if (!view) throw new Error('no budget');
    const same = budgetUnderTarget(view, 1800);
    expect(same.savedKcal).toBe(view.budget.savedKcal);
    expect(same.makanRoomKcal).toBe(view.budget.makanRoomKcal);

    const higher = budgetUnderTarget(view, 2000);
    expect(higher.savedKcal).toBe(650 + 4 * 200);
    expect(higher.eatenSoFarKcal).toBe(view.budget.eatenSoFarKcal);

    const paused = budgetUnderTarget(view, null);
    expect(paused.days.every((d) => d.kind === 'paused')).toBe(true);
  });
});

describe('getWeekGoals', () => {
  it('flags the day a goal switch took effect', async () => {
    const plain = await getWeekGoals(db, '2026-10-12');
    expect(plain.every((d) => d.goal?.name === 'Cut' && !d.switched)).toBe(true);

    await db.goalPeriods.put({ id: DEMO_IDS.goalPeriods.cut, goalId: DEMO_IDS.goals.cut, from: '2026-09-28', to: '2026-10-14' });
    await db.goalPeriods.put({ id: 'festive-period', goalId: DEMO_IDS.goals.festive, from: '2026-10-14' });
    const switched = await getWeekGoals(db, '2026-10-12');
    expect(switched.filter((d) => d.switched).map((d) => d.day)).toEqual(['2026-10-14']);
    expect(switched[2]?.goal?.name).toBe('Festive maintain');
  });
});

describe('saveWeighInIn', () => {
  it('returns the trend with the new reading in', async () => {
    const saved = await saveWeighInIn(db, 77.5);
    const view = await getWeightTrend(db);
    expect(saved.weight.kg).toBe(77.5);
    expect(saved.trendKg).toBeCloseTo(view.latest?.trendKg ?? 0, 6);
    await expect(saveWeighInIn(db, 5)).rejects.toBeInstanceOf(RangeError);
  });
});
