import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createActions } from '@/db/actions';
import { createDb, type KiraMakanDb } from '@/db/db';
import { listActivePots } from '@/db/repo';
import { DEMO_EXPECTED, DEMO_IDS } from '@/db/seed/demo';
import { mealMacros } from '@/domain/meal';
import { splitRecipe } from '@/estimate/recipe';
import {
  cookAgainIn,
  createPotIn,
  deletePotIn,
  listSavedRecipesIn,
  logPotServingsIn,
  lookupPot,
  potServingKcal,
  potState,
} from './pots';

const KARI_AYAM = DEMO_IDS.pots.kariAyam;
/** The demo clock: Fri 16 Oct 2026. */
const TODAY = '2026-10-16';
const RECIPE = '1 ekor ayam, 1 tin santan, 3 kentang, 4 sudu minyak, rempah kari, bawang';

let db: KiraMakanDb;
let seq = 0;

beforeEach(async () => {
  seq += 1;
  db = createDb(`pots-test-${seq}`);
  await createActions(db).loadDemoData();
});

afterEach(async () => {
  db.close();
  await db.delete();
});

describe('createPot', () => {
  it('cooks a pot today with every serving left, clearing in 4 days', async () => {
    const pot = await createPotIn(db, { name: '  Kari ayam ', recipeText: RECIPE, ingredients: splitRecipe(RECIPE), servings: 8 });
    expect(pot).toMatchObject({ name: 'Kari ayam', servings: 8, servingsLeft: 8, cookedOn: TODAY, expiresOn: '2026-10-20' });
    expect(Math.round(potServingKcal(pot) / 10) * 10).toBe(500);
    expect(await db.pots.get(pot.id)).toEqual(pot);
    expect((await listActivePots(db, TODAY)).map((p) => p.id)).toContain(pot.id);
  });

  it('keeps ingredient ids unique and rounds servings', async () => {
    const [a, b] = splitRecipe('ayam, santan');
    const pot = await createPotIn(db, { name: 'Test', recipeText: '', ingredients: [a!, { ...b!, id: a!.id }], servings: 6.4 });
    expect(pot.servings).toBe(6);
    expect(new Set(pot.ingredients.map((i) => i.id)).size).toBe(2);
  });

  it('needs a name, an ingredient and 1–30 servings', async () => {
    const ingredients = splitRecipe('ayam');
    await expect(createPotIn(db, { name: ' ', recipeText: '', ingredients, servings: 8 })).rejects.toThrow(RangeError);
    await expect(createPotIn(db, { name: 'Pot', recipeText: '', ingredients: [], servings: 8 })).rejects.toThrow(RangeError);
    await expect(createPotIn(db, { name: 'Pot', recipeText: '', ingredients, servings: 0 })).rejects.toThrow(RangeError);
    await expect(createPotIn(db, { name: 'Pot', recipeText: '', ingredients, servings: 31 })).rejects.toThrow(RangeError);
    await expect(createPotIn(db, { name: 'Pot', recipeText: '', ingredients, servings: Number.NaN })).rejects.toThrow(RangeError);
  });
});

describe('saved recipes and cook again', () => {
  it('lists the demo kari ayam as a recipe', async () => {
    const recipes = await listSavedRecipesIn(db);
    expect(recipes).toHaveLength(1);
    expect(recipes[0]).toMatchObject({ potId: KARI_AYAM, name: 'Kari ayam', servings: 8, cookedOn: '2026-10-14' });
    expect(recipes[0]?.totalKcal).toBe(DEMO_EXPECTED.pot.totalKcal);
    expect(Math.round((recipes[0]?.kcalPerServing ?? 0) / 10) * 10).toBe(DEMO_EXPECTED.pot.kcalPerServing);
  });

  it('keeps one recipe per name, newest first', async () => {
    await db.pots.put({
      id: 'pot-old-lodeh',
      name: 'Sayur lodeh',
      recipeText: 'santan, sayur',
      ingredients: splitRecipe('santan, sayur'),
      servings: 6,
      servingsLeft: 0,
      cookedOn: '2026-10-01',
      expiresOn: '2026-10-05',
      createdAt: '2026-10-01T10:00:00.000Z',
    });
    const again = await cookAgainIn(db, KARI_AYAM);
    const recipes = await listSavedRecipesIn(db);
    expect(recipes.map((r) => [r.name, r.potId])).toEqual([
      ['Kari ayam', again.id],
      ['Sayur lodeh', 'pot-old-lodeh'],
    ]);
  });

  it('cooks a recipe again as a new pot with fresh ingredient ids', async () => {
    const source = await db.pots.get(KARI_AYAM);
    const pot = await cookAgainIn(db, KARI_AYAM, { servings: 10 });
    expect(pot.id).not.toBe(KARI_AYAM);
    expect(pot).toMatchObject({ name: 'Kari ayam', servings: 10, servingsLeft: 10, cookedOn: TODAY, expiresOn: '2026-10-20' });
    expect(pot.recipeText).toBe(source?.recipeText);
    expect(pot.ingredients.map((i) => i.name)).toEqual(source?.ingredients.map((i) => i.name));
    expect(pot.ingredients.some((i) => source?.ingredients.some((s) => s.id === i.id))).toBe(false);
    // The old pot is untouched.
    expect((await db.pots.get(KARI_AYAM))?.servingsLeft).toBe(3);
    await expect(cookAgainIn(db, 'pot-missing')).rejects.toThrow(/not found/);
  });
});

describe('logPotServings', () => {
  it('logs 1 serving at Home and undo puts it back', async () => {
    const result = await logPotServingsIn(db, KARI_AYAM, 1);
    expect(result.pot.servingsLeft).toBe(2);
    expect(result.meal).toMatchObject({ method: 'pot', name: 'Kari ayam', logicalDay: TODAY, placeId: DEMO_IDS.places.home });
    expect(Math.round(mealMacros(result.meal).kcal / 10) * 10).toBe(500);

    await result.undo();
    expect((await db.pots.get(KARI_AYAM))?.servingsLeft).toBe(3);
    expect(await db.meals.get(result.meal.id)).toBeUndefined();
  });

  it('logs half a serving', async () => {
    const result = await logPotServingsIn(db, KARI_AYAM, 0.5);
    expect(result.pot.servingsLeft).toBe(2.5);
    expect(result.meal.items[0]?.quantity).toBe(0.5);
    expect(Math.round(mealMacros(result.meal).kcal / 10) * 10).toBe(250);
  });

  it('logs 2 servings, and never more than is left', async () => {
    const two = await logPotServingsIn(db, KARI_AYAM, 2);
    expect(two.pot.servingsLeft).toBe(1);
    await logPotServingsIn(db, KARI_AYAM, 0.5);
    const last = await logPotServingsIn(db, KARI_AYAM, 2);
    expect(last.meal.items[0]?.quantity).toBe(0.5);
    expect(last.pot.servingsLeft).toBe(0);
    expect(potState(last.pot, TODAY)).toBe('cleared');
    await expect(logPotServingsIn(db, KARI_AYAM, 1)).rejects.toThrow(/finished/);
  });

  it('refuses a pot past its clear day, but logs on its last day', async () => {
    const meals = await db.meals.count();
    await db.pots.update(KARI_AYAM, { expiresOn: '2026-10-15' });
    await expect(logPotServingsIn(db, KARI_AYAM, 1)).rejects.toThrow(/cleared/);
    expect((await db.pots.get(KARI_AYAM))?.servingsLeft).toBe(3);
    expect(await db.meals.count()).toBe(meals);

    await db.pots.update(KARI_AYAM, { expiresOn: TODAY });
    const result = await logPotServingsIn(db, KARI_AYAM, 1);
    expect(result.pot.servingsLeft).toBe(2);
  });

  it('logs without a Place when there is no Home', async () => {
    await db.places.delete(DEMO_IDS.places.home);
    const result = await logPotServingsIn(db, KARI_AYAM, 1);
    expect(result.meal.placeId).toBeUndefined();
  });

  it('rejects odd amounts and missing pots', async () => {
    await expect(logPotServingsIn(db, KARI_AYAM, 0)).rejects.toThrow(RangeError);
    await expect(logPotServingsIn(db, KARI_AYAM, Number.NaN)).rejects.toThrow(RangeError);
    await expect(logPotServingsIn(db, 'pot-missing', 1)).rejects.toThrow(/not found/);
  });
});

describe('deletePot', () => {
  it('deletes with undo and leaves logged meals alone', async () => {
    const logged = await logPotServingsIn(db, KARI_AYAM, 1);
    const before = await db.pots.get(KARI_AYAM);
    const undo = await deletePotIn(db, KARI_AYAM);
    expect(await lookupPot(db, KARI_AYAM)).toEqual({ pot: null });
    expect(await db.meals.get(logged.meal.id)).toBeDefined();
    await undo();
    expect(await db.pots.get(KARI_AYAM)).toEqual(before);
  });

  it('does nothing for a pot that is already gone', async () => {
    const undo = await deletePotIn(db, 'pot-missing');
    await undo();
    expect(await db.pots.count()).toBe(1);
  });
});

describe('potState', () => {
  it('tells active, clears today and cleared apart', () => {
    expect(potState({ servingsLeft: 3, expiresOn: '2026-10-18' }, TODAY)).toBe('active');
    expect(potState({ servingsLeft: 3, expiresOn: TODAY }, TODAY)).toBe('clearsToday');
    expect(potState({ servingsLeft: 3, expiresOn: '2026-10-15' }, TODAY)).toBe('cleared');
    expect(potState({ servingsLeft: 0, expiresOn: '2026-10-18' }, TODAY)).toBe('cleared');
  });

  it('works out a serving from the ingredients', () => {
    expect(potServingKcal({ ingredients: [], servings: 0 })).toBe(0);
    expect(potServingKcal({ ingredients: splitRecipe(RECIPE), servings: 8 })).toBeCloseTo(4025 / 8, 5);
  });
});
