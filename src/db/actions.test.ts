// @vitest-environment node
import { createDb, type KiraMakanDb } from '@/db/db';
import { DEMO_EXPECTED, DEMO_IDS } from '@/db/seed/demo';
import { isDemoClock, setDemoClock } from '@/domain/clock';
import { logicalDayOf } from '@/domain/day';
import { mealMacros } from '@/domain/meal';
import { dailyTargetFor, startingMaintenance } from '@/domain/targets';
import type { MealItem } from '@/domain/types';
import type { ReviewDraft } from '@/state/ui';
import { createActions, defaultMealName, mealNameFromText, type Actions, type SetupInput } from './actions';
import { recordUpload } from './driveQueue';
import { getCheckIn, getDaySummary, getWeekBudget } from './selectors';

let db: KiraMakanDb;
let actions: Actions;

const TODAY = DEMO_EXPECTED.today.day;
const YESTERDAY = '2026-10-15';

function item(id: string, name: string, kcal: number, extra: Partial<MealItem> = {}): MealItem {
  return {
    id,
    name,
    unitMacros: { kcal, proteinG: Math.round(kcal / 20), carbsG: Math.round(kcal / 8), fatG: Math.round(kcal / 30) },
    quantity: 1,
    uncertainty: 0.15,
    source: 'catalogue',
    ...extra,
  };
}

function draft(items: MealItem[], meta: Partial<ReviewDraft['meta']> = {}): ReviewDraft {
  return { flow: 'text', title: 'Check your meal', items, meta: { method: 'text', ...meta } };
}

/** 8:30pm MYT on the demo Friday. */
const DINNER_AT = '2026-10-16T12:30:00.000Z';

async function budget() {
  const view = await getWeekBudget(db);
  if (!view) throw new Error('No week budget');
  return view.budget;
}

beforeEach(() => {
  db = createDb(`actions-${crypto.randomUUID()}`);
  actions = createActions(db);
});

afterEach(async () => {
  setDemoClock(false);
  await db.delete();
});

describe('with the demo world', () => {
  beforeEach(async () => {
    await actions.loadDemoData();
  });

  it('loads the demo and pins the clock', async () => {
    expect(isDemoClock()).toBe(true);
    expect((await db.profile.get('me'))?.demoMode).toBe(true);
    expect((await budget()).leftTodayKcal).toBe(DEMO_EXPECTED.leftTodayKcal);
  });

  it('saving an 880 kcal dinner goes 310 over, covered by savings', async () => {
    const { meal } = await actions.saveMeal(draft([item('d1', 'Nasi kandar', 880)], { eatenAt: DINNER_AT, slot: 'dinner' }));
    expect(meal.logicalDay).toBe(TODAY);
    expect(meal.syncState).toBe('local');
    expect(meal.name).toBe('Nasi kandar');
    expect(meal.items[0]?.original).toEqual({ quantity: 1, unitMacros: meal.items[0]?.unitMacros });

    const b = await budget();
    expect(b.leftTodayKcal).toBe(-310);
    expect(b.overTodayKcal).toBe(310);
    expect(b.coveredBySavings).toBe(true);
    expect(b.makanRoomKcal).toBe(2140);
  });

  it('puts a 2am supper on the previous logical day and suggests the slot', async () => {
    const { meal } = await actions.saveMeal(draft([item('s1', 'Maggi goreng', 450), item('s2', 'Teh tarik', 200)], { eatenAt: '2026-10-16T18:00:00.000Z' }));
    expect(meal.logicalDay).toBe(TODAY);
    expect(meal.slot).toBe('supper');
    expect(meal.name).toBe('Maggi goreng + teh tarik');
  });

  it('deleteMeal returns an undo that restores the meal', async () => {
    const lunchId = DEMO_EXPECTED.today.lunch.id;
    const before = await db.meals.get(lunchId);
    const undo = await actions.deleteMeal(lunchId);
    expect(await db.meals.get(lunchId)).toBeUndefined();
    expect((await budget()).leftTodayKcal).toBe(DEMO_EXPECTED.leftTodayKcal + DEMO_EXPECTED.today.lunch.kcal);

    await undo();
    expect(await db.meals.get(lunchId)).toEqual(before);
    expect((await budget()).leftTodayKcal).toBe(DEMO_EXPECTED.leftTodayKcal);
  });

  it('updates a meal and moves it to the right day when the time changes', async () => {
    const id = DEMO_EXPECTED.today.breakfast.id;
    const updated = await actions.updateMeal(id, { eatenAt: '2026-10-15T01:00:00.000Z', priceRm: undefined });
    expect(updated?.logicalDay).toBe(YESTERDAY);
    expect(updated && 'priceRm' in updated).toBe(false);
    expect((await db.meals.get(id))?.logicalDay).toBe(YESTERDAY);
    expect(await actions.updateMeal('missing', { name: 'x' })).toBeUndefined();
  });

  it('edits the meal named in the draft instead of adding one', async () => {
    const id = DEMO_EXPECTED.today.lunch.id;
    const count = await db.meals.count();
    const { meal: saved } = await actions.saveMeal(
      draft([item('e1', 'Economy rice', 600)], { editingMealId: id, eatenAt: '2026-10-16T06:15:00.000Z', method: 'plate', name: 'Economy rice' }),
    );
    expect(saved.id).toBe(id);
    expect(await db.meals.count()).toBe(count);
    expect(Math.round(mealMacros(saved).kcal)).toBe(600);
  });

  it('saving an edit of a meal deleted meanwhile (on another device) brings it back under its own id', async () => {
    const id = DEMO_EXPECTED.today.lunch.id;
    await db.meals.delete(id);
    const count = await db.meals.count();
    const { meal, undo } = await actions.saveMeal(
      draft([item('e1', 'Economy rice', 600)], { editingMealId: id, eatenAt: '2026-10-16T06:15:00.000Z', method: 'plate', name: 'Economy rice' }),
    );
    expect(meal).toMatchObject({ id, name: 'Economy rice', logicalDay: TODAY, slot: 'lunch' });
    expect(await db.meals.count()).toBe(count + 1);
    expect(await db.meals.get(id)).toEqual(meal);

    await undo();
    expect(await db.meals.get(id)).toBeUndefined();
  });

  it('an edit that only carries items keeps the meal’s day, time, slot, name, Place and price', async () => {
    const id = 'meal-2026-10-13-lunch';
    const before = (await db.meals.get(id))!;
    const items = before.items.map((i) => ({ ...i }));
    const { meal, undo } = await actions.saveMeal(draft(items, { method: 'plate', editingMealId: id }));
    expect(meal).toMatchObject({
      id,
      logicalDay: '2026-10-13',
      eatenAt: before.eatenAt,
      slot: 'lunch',
      name: 'Economy rice',
      placeId: DEMO_IDS.places.kedai,
      priceRm: 7.5,
      finished: 'all',
    });
    expect((await budget()).days[1]?.eatenKcal).toBe(DEMO_EXPECTED.thisWeekDayKcal['2026-10-13']);

    // Naming a key with no value clears it.
    const cleared = await actions.saveMeal(draft(items, { method: 'plate', editingMealId: id, priceRm: undefined, placeId: undefined }));
    expect(cleared.meal.priceRm).toBeUndefined();
    expect(cleared.meal.placeId).toBeUndefined();

    await cleared.undo();
    await undo();
    expect(await db.meals.get(id)).toEqual(before);
  });

  it('editing a typical-one guess turns it into a real meal that a later check-in keeps', async () => {
    await db.meals.delete('meal-2026-10-15-dinner');
    await db.days.put({ logicalDay: YESTERDAY, status: 'unconfirmed' });
    const { guess } = await actions.confirmDay(YESTERDAY, 'fillTypical');
    const { meal } = await actions.saveMeal(
      draft([item('ng', 'Nasi goreng', 700)], { method: 'guess', editingMealId: guess!.id, name: 'Nasi goreng' }),
    );
    expect(meal.isGuess).toBeUndefined();
    expect(meal.method).toBe('manual');
    expect(meal.logicalDay).toBe(YESTERDAY);
    expect(meal.eatenAt).toBe(guess!.eatenAt);
    expect((await getDaySummary(db, YESTERDAY)).tags[meal.id]).toBeDefined();

    await actions.confirmDay(YESTERDAY, 'complete');
    expect(await db.meals.get(meal.id)).toBeDefined();
  });

  it('undo of a new meal takes back what it taught: the Usual count, the Place price and a new Place', async () => {
    const usualBefore = await db.usuals.get(DEMO_IDS.usuals.rotiCanai);
    const placeBefore = await db.places.get(DEMO_IDS.places.nasiKandar);
    const saved = await actions.saveMeal(
      draft([item('u1', 'Roti canai', 360), item('u2', 'Teh tarik', 200)], {
        method: 'usual',
        name: 'Roti canai + teh tarik',
        placeId: DEMO_IDS.places.nasiKandar,
        priceRm: 30,
        eatenAt: DINNER_AT,
      }),
    );
    expect((await db.places.get(DEMO_IDS.places.nasiKandar))?.typicalPriceRm).not.toBe(placeBefore?.typicalPriceRm);
    await saved.undo();
    expect(await db.meals.get(saved.meal.id)).toBeUndefined();
    expect(await db.usuals.get(DEMO_IDS.usuals.rotiCanai)).toEqual(usualBefore);
    expect(await db.places.get(DEMO_IDS.places.nasiKandar)).toEqual(placeBefore);

    const places = await db.places.count();
    const atNewPlace = await actions.saveMeal(draft([item('p1', 'Laksa', 500)], { placeName: 'Laksa stall', eatenAt: DINNER_AT }));
    expect(await db.places.count()).toBe(places + 1);
    await atNewPlace.undo();
    expect(await db.places.count()).toBe(places);
  });

  it('duplicating a guess logs a real meal', async () => {
    await db.meals.delete('meal-2026-10-15-dinner');
    const { guess } = await actions.confirmDay(YESTERDAY, 'fillTypical');
    const copy = await actions.duplicateMeal(guess!.id);
    expect(copy).toMatchObject({ method: 'manual', logicalDay: TODAY });
    expect(copy?.isGuess).toBeUndefined();
  });

  it('duplicates a meal as a new entry now', async () => {
    const copy = await actions.duplicateMeal(DEMO_EXPECTED.today.breakfast.id);
    expect(copy).toBeDefined();
    expect(copy?.id).not.toBe(DEMO_EXPECTED.today.breakfast.id);
    expect(copy?.eatenAt).toBe(DEMO_EXPECTED.now);
    expect(copy?.slot).toBe('dinner');
    expect((await budget()).leftTodayKcal).toBe(DEMO_EXPECTED.leftTodayKcal - DEMO_EXPECTED.today.breakfast.kcal);
  });

  it('confirmDay notCounted on an under-budget day removes its savings, and undo brings them back', async () => {
    // Monday ate 1,620 of 1,800: +180 saved.
    const result = await actions.confirmDay(DEMO_EXPECTED.weekStart, 'notCounted');
    expect(result.record?.status).toBe('notCounted');
    expect((await budget()).savedKcal).toBe(DEMO_EXPECTED.savedThisWeekKcal - 180);

    await result.undo();
    expect((await db.days.get(DEMO_EXPECTED.weekStart))?.status).toBe('complete');
    expect((await budget()).savedKcal).toBe(DEMO_EXPECTED.savedThisWeekKcal);
  });

  it('an unconfirmed yesterday holds its savings until the check-in', async () => {
    await db.days.delete(YESTERDAY);
    let b = await budget();
    expect(b.pendingSavedKcal).toBe(120);
    expect(b.savedKcal).toBe(DEMO_EXPECTED.savedThisWeekKcal - 120);
    expect((await getCheckIn(db)).needed).toBe(true);

    await actions.confirmDay(YESTERDAY, 'complete');
    b = await budget();
    expect(b.pendingSavedKcal).toBe(0);
    expect(b.savedKcal).toBe(DEMO_EXPECTED.savedThisWeekKcal);
    expect((await getCheckIn(db)).needed).toBe(false);
  });

  it('fillTypical adds a guess dinner and marks the day as a guess', async () => {
    await db.meals.delete('meal-2026-10-15-dinner');
    await db.days.put({ logicalDay: YESTERDAY, status: 'unconfirmed' });
    const checkIn = await getCheckIn(db);
    expect(checkIn.guess?.slot).toBe('dinner');

    const result = await actions.confirmDay(YESTERDAY, 'fillTypical');
    expect(result.record?.status).toBe('guess');
    expect(result.guess).toMatchObject({ isGuess: true, method: 'guess', slot: 'dinner', logicalDay: YESTERDAY, name: 'Typical dinner' });
    expect(Math.round(mealMacros(result.guess!).kcal)).toBe(checkIn.guess?.kcal);
    expect(logicalDayOf(result.guess!.eatenAt)).toBe(YESTERDAY);

    const yesterday = (await budget()).days[3];
    expect(yesterday?.status).toBe('guess');
    expect(yesterday?.eatenKcal).toBe(checkIn.kcal + (checkIn.guess?.kcal ?? 0));

    // Answering again replaces the guess rather than stacking a second one.
    await actions.confirmDay(YESTERDAY, 'fillTypical', checkIn.guess);
    expect((await db.meals.where('logicalDay').equals(YESTERDAY).toArray()).filter((m) => m.isGuess)).toHaveLength(1);

    const again = await actions.confirmDay(YESTERDAY, 'complete');
    expect((await db.meals.where('logicalDay').equals(YESTERDAY).toArray()).some((m) => m.isGuess)).toBe(false);
    await again.undo();
    expect((await db.meals.where('logicalDay').equals(YESTERDAY).toArray()).filter((m) => m.isGuess)).toHaveLength(1);
    expect((await db.days.get(YESTERDAY))?.status).toBe('guess');
  });

  it('addMore leaves the day for the light check-in', async () => {
    await db.days.delete(YESTERDAY);
    const result = await actions.confirmDay(YESTERDAY, 'addMore');
    expect(result.record).toBeUndefined();
    expect(await db.days.get(YESTERDAY)).toBeUndefined();
  });

  it('records and clears the sleep tap', async () => {
    const at = '2026-10-16T17:30:00.000Z';
    expect((await actions.setSleepTap(TODAY, at)).sleepAt).toBe(at);
    expect((await actions.setSleepTap(TODAY, null)).sleepAt).toBeUndefined();
  });

  it('logPotServing takes a serving out of the pot and logs it', async () => {
    const result = await actions.logPotServing(DEMO_IDS.pots.kariAyam, 1, { eatenAt: DINNER_AT, slot: 'dinner' });
    expect(result.pot.servingsLeft).toBe(DEMO_EXPECTED.pot.servingsLeft - 1);
    expect((await db.pots.get(DEMO_IDS.pots.kariAyam))?.servingsLeft).toBe(DEMO_EXPECTED.pot.servingsLeft - 1);
    expect(result.meal).toMatchObject({ method: 'pot', name: 'Kari ayam', logicalDay: TODAY, slot: 'dinner' });
    expect(Math.round(mealMacros(result.meal).kcal)).toBe(Math.round(DEMO_EXPECTED.pot.totalKcal / DEMO_EXPECTED.pot.servings));
    expect(result.meal.items[0]?.source).toBe('myfcd');

    await result.undo();
    expect((await db.pots.get(DEMO_IDS.pots.kariAyam))?.servingsLeft).toBe(DEMO_EXPECTED.pot.servingsLeft);
    expect(await db.meals.get(result.meal.id)).toBeUndefined();
  });

  it('logPotServing never logs more than the pot has, and refuses an empty or cleared pot', async () => {
    const POT = DEMO_IDS.pots.kariAyam;
    const perServing = DEMO_EXPECTED.pot.totalKcal / DEMO_EXPECTED.pot.servings;
    await db.pots.update(POT, { servingsLeft: 0.5 });

    // "Log 1" with half a serving left: the meal records the half the pot gave.
    const { meal, pot } = await actions.logPotServing(POT, 1, { eatenAt: DINNER_AT });
    expect(meal.items[0]?.quantity).toBe(0.5);
    expect(meal.fromPot).toEqual({ potId: POT, servings: 0.5 });
    expect(Math.round(mealMacros(meal).kcal)).toBe(Math.round(perServing / 2));
    expect(pot.servingsLeft).toBe(0);

    await expect(actions.logPotServing(POT, 1, { eatenAt: DINNER_AT })).rejects.toThrow('This pot is empty.');

    // A pot past its clear day gives nothing, even with servings left.
    await db.pots.update(POT, { servingsLeft: 3, expiresOn: '2026-10-15' });
    await expect(actions.logPotServing(POT, 1, { eatenAt: DINNER_AT })).rejects.toThrow('This pot has cleared.');
    expect((await db.pots.get(POT))?.servingsLeft).toBe(3);
  });

  describe('pot servings in the diary', () => {
    const POT = DEMO_IDS.pots.kariAyam;
    const left = async () => (await db.pots.get(POT))?.servingsLeft;

    it('links a pot serving to its pot', async () => {
      const { meal } = await actions.logPotServing(POT, 0.5, { eatenAt: DINNER_AT });
      expect(meal.fromPot).toEqual({ potId: POT, servings: 0.5 });
      expect((await db.meals.get(meal.id))?.fromPot).toEqual({ potId: POT, servings: 0.5 });
    });

    it('deleting a pot serving puts it back in the pot, and the undo takes it again', async () => {
      const { meal } = await actions.logPotServing(POT, 1, { eatenAt: DINNER_AT });
      expect(await left()).toBe(2);

      const undo = await actions.deleteMeal(meal.id);
      expect(await db.meals.get(meal.id)).toBeUndefined();
      expect(await left()).toBe(3);

      await undo();
      expect(await db.meals.get(meal.id)).toEqual(meal);
      expect(await left()).toBe(2);
    });

    it("the log toast's undo doesn't return servings twice after a delete from the diary", async () => {
      const logged = await actions.logPotServing(POT, 1, { eatenAt: DINNER_AT });
      await actions.deleteMeal(logged.meal.id);
      expect(await left()).toBe(3);
      await logged.undo();
      expect(await left()).toBe(3);
    });

    it('never puts back more than the pot holds', async () => {
      const { meal } = await actions.logPotServing(POT, 2, { eatenAt: DINNER_AT });
      expect(await left()).toBe(1);
      await db.pots.update(POT, { servingsLeft: 7 });
      const undo = await actions.deleteMeal(meal.id);
      expect(await left()).toBe(8);
      await undo();
      // Only the one serving that went back is taken again.
      expect(await left()).toBe(7);
    });

    it('duplicating a pot serving takes another one out of the pot; deleting the copy returns it', async () => {
      const { meal } = await actions.logPotServing(POT, 0.5, { eatenAt: DINNER_AT });
      expect(await left()).toBe(2.5);

      const copy = await actions.duplicateMeal(meal.id);
      expect(copy?.fromPot).toEqual({ potId: POT, servings: 0.5 });
      expect(await left()).toBe(2);

      await actions.deleteMeal(copy!.id);
      expect(await left()).toBe(2.5);
    });

    it('a duplicate takes only what is left, and nothing from a finished, cleared or deleted pot', async () => {
      const { meal } = await actions.logPotServing(POT, 2, { eatenAt: DINNER_AT });
      expect(await left()).toBe(1);
      await db.pots.update(POT, { servingsLeft: 0.5 });
      const partial = await actions.duplicateMeal(meal.id);
      expect(partial?.fromPot).toEqual({ potId: POT, servings: 0.5 });
      expect(await left()).toBe(0);

      // Finished: the copy is a plain meal, still logged.
      const fromEmpty = await actions.duplicateMeal(meal.id);
      expect(fromEmpty).toBeDefined();
      expect(fromEmpty?.fromPot).toBeUndefined();
      expect(await left()).toBe(0);

      // Cleared (past its day): no servings taken.
      await db.pots.update(POT, { servingsLeft: 3, expiresOn: YESTERDAY });
      expect((await actions.duplicateMeal(meal.id))?.fromPot).toBeUndefined();
      expect(await left()).toBe(3);

      // Deleted pot: duplicate and delete still work and touch nothing.
      await db.pots.delete(POT);
      const orphan = await actions.duplicateMeal(meal.id);
      expect(orphan?.fromPot).toBeUndefined();
      const undo = await actions.deleteMeal(meal.id);
      expect(await db.pots.get(POT)).toBeUndefined();
      await undo();
      expect(await db.meals.get(meal.id)).toEqual(meal);
    });

    it("leaves the pot alone for pot meals with no link (the demo's earlier kari ayam dinners)", async () => {
      const older = (await db.meals.toArray()).find((m) => m.method === 'pot' && !m.fromPot);
      expect(older).toBeDefined();
      const copy = await actions.duplicateMeal(older!.id);
      expect(copy?.fromPot).toBeUndefined();
      expect(await left()).toBe(DEMO_EXPECTED.pot.servingsLeft);
      await actions.deleteMeal(older!.id);
      expect(await left()).toBe(DEMO_EXPECTED.pot.servingsLeft);
    });
  });

  it('adds a workout with net kcal from the latest weight', async () => {
    const workout = await actions.addWorkout('futsal', 'moderate', 60);
    expect(workout.logicalDay).toBe(TODAY);
    // (7 − 1) × 77.8 kg × 1 h = 466.8 → 470.
    expect(workout.netKcal).toBe(470);
    const b = await budget();
    expect(b.workoutsKcal).toBe(470);
    expect(b.leftTodayKcal).toBe(DEMO_EXPECTED.leftTodayKcal + 470);

    const undo = await actions.deleteWorkout(workout.id);
    expect((await budget()).workoutsKcal).toBe(0);
    await undo();
    expect((await budget()).workoutsKcal).toBe(470);
  });

  it('adds a one-off bonus to the day', async () => {
    const bonus = await actions.addBonus(300, 'Hike at Bukit Gasing');
    expect(bonus).toMatchObject({ logicalDay: TODAY, kcal: 300 });
    expect((await budget()).bonusKcal).toBe(300);
    await expect(actions.addBonus(0, 'nothing')).rejects.toThrow(RangeError);
  });

  it('adds a weight on the logical day it was measured', async () => {
    const weight = await actions.addWeight(77.6);
    expect(weight).toMatchObject({ logicalDay: TODAY, kg: 77.6, measuredAt: DEMO_EXPECTED.now });
    await expect(actions.addWeight(Number.NaN)).rejects.toThrow(RangeError);
  });

  it('plans and clears the makan day, and sets the weekly focus', async () => {
    await actions.planMakanDay(DEMO_EXPECTED.weekStart, '2026-10-18');
    expect((await budget()).makanDay).toBe('2026-10-18');
    await actions.planMakanDay(DEMO_EXPECTED.weekStart, null);
    const b = await budget();
    expect(b.makanDay).toBeUndefined();
    expect(b.makanRoomKcal).toBeUndefined();
    await expect(actions.planMakanDay(DEMO_EXPECTED.weekStart, '2026-10-19')).rejects.toThrow(RangeError);
    // A finished day can't take this week's savings any more; today still can.
    await expect(actions.planMakanDay(DEMO_EXPECTED.weekStart, '2026-10-13')).rejects.toThrow(RangeError);
    expect((await actions.planMakanDay(DEMO_EXPECTED.weekStart, TODAY)).makanDay).toBe(TODAY);

    const focus = { label: 'Kurang manis for drinks', sub: 'About 300 kcal a week less' };
    expect((await actions.setWeeklyFocus(DEMO_EXPECTED.weekStart, focus)).focus).toEqual(focus);
    expect((await actions.setWeeklyFocus(DEMO_EXPECTED.weekStart, null)).focus).toBeUndefined();
  });

  it('counts a Usual use and learns the Place price', async () => {
    const before = await db.usuals.get(DEMO_IDS.usuals.rotiCanai);
    await actions.saveMeal(
      draft([item('u1', 'Roti canai', 360), item('u2', 'Teh tarik', 200)], {
        method: 'usual',
        name: 'Roti canai + teh tarik',
        placeId: DEMO_IDS.places.nasiKandar,
        priceRm: 4.8,
        eatenAt: DINNER_AT,
      }),
    );
    expect((await db.usuals.get(DEMO_IDS.usuals.rotiCanai))?.useCount).toBe((before?.useCount ?? 0) + 1);
    expect((await db.places.get(DEMO_IDS.places.nasiKandar))?.typicalPriceRm).toBeGreaterThan(0);
  });

  it('creates a Place the first time a name is typed', async () => {
    const { meal } = await actions.saveMeal(draft([item('p1', 'Nasi kandar', 900)], { placeName: '  Nasi Kandar Pelita ', eatenAt: DINNER_AT }));
    const place = meal.placeId ? await db.places.get(meal.placeId) : undefined;
    expect(place).toMatchObject({ name: 'Nasi Kandar Pelita', type: 'mamak' });

    const { meal: again } = await actions.saveMeal(draft([item('p2', 'Teh o ais', 60)], { placeName: 'nasi kandar pelita', eatenAt: DINNER_AT }));
    expect(again.placeId).toBe(meal.placeId);
  });

  it('remembers a correction for a Place and teaches the Place its default', async () => {
    const rice: MealItem = {
      ...item('r1', 'Rice', 200, { catalogueId: 'rice-white' }),
      variants: [
        { id: 'half', label: 'Half', macros: { kcal: 100, proteinG: 2, carbsG: 22, fatG: 0 } },
        { id: 'one', label: '1 scoop', macros: { kcal: 200, proteinG: 4, carbsG: 44, fatG: 0 } },
      ],
      selectedVariant: 0,
    };
    const first = await actions.rememberCorrection(rice, DEMO_IDS.places.kedai, 'place');
    expect(first).toMatchObject({ scope: 'place', placeId: DEMO_IDS.places.kedai, corrections: 1, catalogueId: 'rice-white' });
    expect((await db.places.get(DEMO_IDS.places.kedai))?.defaultVariants['rice-white']).toBe(0);

    const second = await actions.rememberCorrection(rice, DEMO_IDS.places.kedai, 'place');
    expect(second.id).toBe(first.id);
    expect(second.corrections).toBe(2);

    const dish = await actions.rememberCorrection(rice, undefined, 'dish');
    expect(dish.id).not.toBe(first.id);
    expect(dish.placeId).toBeUndefined();
    await expect(actions.rememberCorrection(rice, undefined, 'place')).rejects.toThrow(RangeError);
  });

  it('switching demo mode off clears the demo data and unpins the clock', async () => {
    await actions.setDemoMode(false);
    expect(isDemoClock()).toBe(false);
    expect(await db.profile.get('me')).toBeUndefined();
    expect(await db.meals.count()).toBe(0);
  });

  it('resetAll deletes everything', async () => {
    await actions.resetAll();
    expect(isDemoClock()).toBe(false);
    expect(await db.meals.count()).toBe(0);
    expect(await db.places.count()).toBe(0);
  });
});

describe('completeSetup', () => {
  const input: SetupInput = {
    age: 30,
    sex: 'male',
    heightCm: 172,
    weightKg: 78.6,
    activity: 'light',
    paceKgPerWeek: 0.5,
    dailyMinimumKcal: 1400,
    regulars: ['roti-canai', 'not-a-food'],
    places: [
      { name: 'Home', type: 'home' },
      { name: 'Nasi kandar near home', type: 'mamak' },
      { name: 'home', type: 'home' },
    ],
    rolloverHour: 5,
    timeZone: 'Asia/Kuala_Lumpur',
  };

  it('creates a profile, an active Cut goal with its version and period, Usuals and Places', async () => {
    const result = await actions.completeSetup(input);
    const today = logicalDayOf(new Date());

    expect(result.profile).toMatchObject({
      id: 'me',
      age: 30,
      sex: 'male',
      heightCm: 172,
      weightKgAtSetup: 78.6,
      activity: 'light',
      dailyMinimumKcal: 1400,
      rolloverHour: 5,
      timeZone: 'Asia/Kuala_Lumpur',
      weekStartsOn: 1,
      startedOn: today,
      demoMode: false,
    });
    expect(result.profile.setupCompletedAt).toBeDefined();

    expect(result.goal).toMatchObject({ template: 'cut', status: 'active', paceKgPerWeek: 0.5 });
    const maintenance = startingMaintenance({ sex: 'male', weightKg: 78.6, heightCm: 172, age: 30, activity: 'light' });
    expect(result.version).toMatchObject({
      goalId: result.goal.id,
      effectiveFrom: today,
      maintenanceKcal: maintenance,
      dailyKcal: dailyTargetFor(result.goal, maintenance, 1400),
      reason: 'setup',
    });
    expect(result.version.proteinG).toBeGreaterThan(100);
    expect(result.period).toMatchObject({ goalId: result.goal.id, from: today });

    expect(await db.goals.count()).toBe(4);
    expect((await db.goals.where('status').equals('active').toArray()).map((g) => g.id)).toEqual([result.goal.id]);
    const usuals = await db.usuals.toArray();
    expect(usuals).toHaveLength(1);
    expect(usuals[0]?.items[0]?.catalogueId).toBe('roti-canai');
    expect((await db.places.toArray()).map((p) => p.name).sort()).toEqual(['Home', 'Nasi kandar near home']);
    expect(await db.weights.count()).toBe(1);

    const view = await getWeekBudget(db);
    expect(view?.goal.id).toBe(result.goal.id);
    expect(view?.budget.todayBaseKcal).toBe(result.version.dailyKcal);
  });

  it('replaces demo data, and a second call changes nothing', async () => {
    await actions.loadDemoData();
    const first = await actions.completeSetup(input);
    expect(isDemoClock()).toBe(false);
    expect(first.profile.startedOn).toBe(logicalDayOf(new Date()));
    expect(await db.meals.count()).toBe(0);
    expect(await db.pots.count()).toBe(0);

    const second = await actions.completeSetup({ ...input, age: 45 });
    expect(second.goal.id).toBe(first.goal.id);
    expect((await db.profile.get('me'))?.age).toBe(30);
  });

  it('rejects impossible numbers', async () => {
    await expect(actions.completeSetup({ ...input, heightCm: 0 })).rejects.toThrow(RangeError);
    await expect(actions.completeSetup({ ...input, rolloverHour: 24 })).rejects.toThrow(RangeError);
  });
});

describe('defaultMealName', () => {
  it('joins item names in sentence case', () => {
    expect(defaultMealName([])).toBe('Meal');
    expect(defaultMealName([{ name: 'Roti canai' }])).toBe('Roti canai');
    expect(defaultMealName([{ name: 'Roti canai' }, { name: 'Teh tarik' }])).toBe('Roti canai + teh tarik');
    expect(defaultMealName([{ name: 'Rice' }, { name: 'Ayam masak kicap' }, { name: 'Sayur' }])).toBe('Rice, ayam masak kicap, sayur');
    expect(defaultMealName([{ name: 'Rice' }, { name: 'Ayam' }, { name: 'Sayur' }, { name: 'Telur' }, { name: 'Kuah' }])).toBe(
      'Rice, ayam, sayur + 2 more',
    );
  });
});

describe('mealNameFromText', () => {
  it('names a typed meal by its first part', () => {
    expect(mealNameFromText('nasi kandar ayam goreng, kubis, kuah campur, teh o ais')).toBe('Nasi kandar ayam goreng');
    expect(mealNameFromText('roti canai 2 + teh o ais kosong')).toBe('Roti canai 2');
    expect(mealNameFromText('  mee   goreng mamak  ')).toBe('Mee goreng mamak');
    expect(mealNameFromText('')).toBeUndefined();
    expect(mealNameFromText(undefined)).toBeUndefined();
    expect(mealNameFromText('a'.repeat(60))).toHaveLength(48);
  });

  it('never cuts an emoji in half (the account refuses half of one)', () => {
    expect(mealNameFromText(`${'a'.repeat(46)}🍜🍜🍜 malam`)).toBe(`A${'a'.repeat(45)}🍜…`);
    expect(mealNameFromText(`${'🍜'.repeat(30)}, teh`)).toBe('🍜'.repeat(30));
  });

  it('is used when a text meal is saved without a name', async () => {
    const { meal } = await actions.saveMeal({
      flow: 'text',
      title: 'Check your meal',
      items: [
        { id: 'i1', name: 'Rice (nasi kandar)', unitMacros: { kcal: 330, proteinG: 6, carbsG: 72, fatG: 1 }, quantity: 1, uncertainty: 0.15, source: 'catalogue' },
        { id: 'i2', name: 'Ayam goreng', unitMacros: { kcal: 300, proteinG: 25, carbsG: 8, fatG: 19 }, quantity: 1, uncertainty: 0.15, source: 'catalogue' },
      ],
      meta: { method: 'text', text: 'nasi kandar ayam goreng, kuah banjir' },
    });
    expect(meal.name).toBe('Nasi kandar ayam goreng');
  });
});

describe('meal photos and the Google Drive queue (§10.18)', () => {
  const FILE = 'drive-file-0001';
  const THUMB = 'data:image/jpeg;base64,/9j/4AAQ';

  function photoDraft(photoId: string, meta: Partial<ReviewDraft['meta']> = {}): ReviewDraft {
    return draft([item('p1', 'Nasi kandar', 700)], { method: 'photo', photoId, eatenAt: '2026-10-16T12:30:00.000Z', ...meta });
  }

  async function connectDrive() {
    await db.driveMeta.put({ id: 'drive', connectedAt: Date.now() });
  }

  beforeEach(() => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '123-abc.apps.googleusercontent.com');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('saving a photo meal queues its upload when connected, and the undo drops it', async () => {
    await connectDrive();
    const { meal, undo } = await actions.saveMeal(photoDraft('p1'));
    expect(await db.driveJobs.get('upload:p1')).toMatchObject({ kind: 'upload', photoId: 'p1', mealId: meal.id, attempts: 0 });
    await undo();
    expect(await db.driveJobs.count()).toBe(0);
  });

  it('the undo of a photo meal whose upload already finished sends the file to the trash', async () => {
    await connectDrive();
    const { meal, undo } = await actions.saveMeal(photoDraft('p1'));
    const job = await db.driveJobs.get('upload:p1');
    if (job?.kind !== 'upload') throw new Error('No upload job');
    // The engine uploaded the photo within the toast's few seconds and wrote the pointer.
    expect(await recordUpload(db, job, { fileId: FILE })).toBe('saved');

    const before = Date.now();
    await undo();
    expect(await db.meals.get(meal.id)).toBeUndefined();
    expect(await db.driveJobs.get('upload:p1')).toBeUndefined();
    const trash = await db.driveJobs.get(`file:${FILE}`);
    expect(trash).toMatchObject({ kind: 'file', fileId: FILE, trashed: true, attempts: 0 });
    expect(trash?.notBefore).toBeGreaterThanOrEqual(before + 60_000);
  });

  it('queues nothing when not connected, or under the demo clock', async () => {
    await actions.saveMeal(photoDraft('p1'));
    expect(await db.driveJobs.count()).toBe(0);
    await connectDrive();
    setDemoClock(true);
    await actions.saveMeal(photoDraft('p2'));
    expect(await db.driveJobs.count()).toBe(0);
  });

  it('an edit keeps the Drive pointer; another photo drops it and queues the new one', async () => {
    const { meal } = await actions.saveMeal(photoDraft('p1'));
    await db.meals.update(meal.id, { photoDrive: { fileId: FILE, thumb: THUMB } });
    await connectDrive();

    const edited = await actions.saveMeal({ ...photoDraft('p1', { editingMealId: meal.id, name: 'Nasi kandar banjir' }) });
    expect(edited.meal.photoDrive).toEqual({ fileId: FILE, thumb: THUMB });
    expect((await db.meals.get(meal.id))?.photoDrive).toEqual({ fileId: FILE, thumb: THUMB });

    const swapped = await actions.saveMeal(photoDraft('p2', { editingMealId: meal.id }));
    expect(swapped.meal.photoId).toBe('p2');
    expect(swapped.meal.photoDrive).toBeUndefined();
    expect(await db.driveJobs.get('upload:p2')).toMatchObject({ mealId: meal.id });

    await db.meals.update(meal.id, { photoDrive: { fileId: FILE } });
    const patched = await actions.updateMeal(meal.id, { photoId: 'p3' });
    expect(patched?.photoDrive).toBeUndefined();
    expect(await db.driveJobs.get('upload:p3')).toMatchObject({ mealId: meal.id });
    const renamed = await actions.updateMeal(meal.id, { name: 'Still p3' });
    expect(renamed?.photoId).toBe('p3');
  });

  it('delete trashes the Drive file a minute later and drops the upload; undo puts both back', async () => {
    await connectDrive();
    const { meal } = await actions.saveMeal(photoDraft('p1'));
    await db.meals.update(meal.id, { photoDrive: { fileId: FILE } });
    const job = await db.driveJobs.get('upload:p1');

    const before = Date.now();
    const undo = await actions.deleteMeal(meal.id);
    const after = Date.now();
    expect(await db.driveJobs.get('upload:p1')).toBeUndefined();
    const trash = await db.driveJobs.get(`file:${FILE}`);
    expect(trash).toMatchObject({ kind: 'file', fileId: FILE, trashed: true, attempts: 0 });
    expect(trash?.notBefore).toBeGreaterThanOrEqual(before + 60_000);
    expect(trash?.notBefore).toBeLessThanOrEqual(after + 60_000);

    await undo();
    expect(await db.meals.get(meal.id)).toBeDefined();
    expect(await db.driveJobs.get(`file:${FILE}`)).toBeUndefined();
    expect(await db.driveJobs.get('upload:p1')).toEqual(job);
  });

  it('undo after the trash ran restores the file', async () => {
    const { meal } = await actions.saveMeal(photoDraft('p1'));
    await db.meals.update(meal.id, { photoDrive: { fileId: FILE } });
    const undo = await actions.deleteMeal(meal.id);
    // The engine ran the trash and removed its job.
    await db.driveJobs.delete(`file:${FILE}`);

    await undo();
    expect(await db.driveJobs.get(`file:${FILE}`)).toMatchObject({ kind: 'file', trashed: false, attempts: 0 });
  });

  it('a delete under the demo clock queues nothing', async () => {
    const { meal } = await actions.saveMeal(photoDraft('p1'));
    await db.meals.update(meal.id, { photoDrive: { fileId: FILE } });
    setDemoClock(true);
    await actions.deleteMeal(meal.id);
    expect(await db.driveJobs.count()).toBe(0);
  });

  it('a duplicate has neither the photo nor its pointer', async () => {
    const { meal } = await actions.saveMeal(photoDraft('p1'));
    await db.meals.update(meal.id, { photoDrive: { fileId: FILE, thumb: THUMB } });
    const copy = await actions.duplicateMeal(meal.id);
    expect(copy?.photoId).toBeUndefined();
    expect(copy?.photoDrive).toBeUndefined();
    expect((await db.meals.get(copy?.id ?? ''))?.photoDrive).toBeUndefined();
  });
});
