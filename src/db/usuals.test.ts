// @vitest-environment node
import { createActions } from '@/db/actions';
import { createDb, type KiraMakanDb } from '@/db/db';
import { DEMO_IDS } from '@/db/seed/demo';
import { setDemoClock } from '@/domain/clock';
import type { MealItem, MealLog, Usual } from '@/domain/types';
import {
  clearDismissedSuggestions,
  compareUsuals,
  createUsualFromMealIn,
  createUsualIn,
  dismissUsualSuggestion,
  editUsualIn,
  findUsualSuggestions,
  listOrderedUsualsIn,
  listUsualSuggestionsIn,
  moveUsualIn,
  readDismissedSuggestions,
  removeUsualIn,
  renameUsualIn,
  restoreUsualSuggestion,
  saveSuggestedUsualIn,
  updateUsualItemsIn,
  usualItems,
} from './usuals';

const TODAY = '2026-10-16';
const { usuals: U } = DEMO_IDS;

let db: KiraMakanDb;

beforeEach(async () => {
  db = createDb(`usuals-${crypto.randomUUID()}`);
  await createActions(db).loadDemoData();
  clearDismissedSuggestions();
});

afterEach(async () => {
  setDemoClock(false);
  clearDismissedSuggestions();
  await db.delete();
});

function item(id: string, name: string, kcal: number, extra: Partial<MealItem> = {}): MealItem {
  return { id, name, unitMacros: { kcal, proteinG: 0, carbsG: 0, fatG: 0 }, quantity: 1, uncertainty: 0.15, source: 'catalogue', ...extra };
}

function usual(id: string, name: string, useCount: number, sortIndex?: number): Usual {
  const u: Usual = { id, name, items: [item(`${id}-1`, name, 100)], useCount, createdAt: '2026-10-01T00:00:00.000Z' };
  if (sortIndex !== undefined) u.sortIndex = sortIndex;
  return u;
}

let mealSeq = 0;
function meal(name: string, day: string, extra: Partial<MealLog> = {}): MealLog {
  mealSeq += 1;
  return {
    id: `test-meal-${mealSeq}`,
    eatenAt: `${day}T04:00:00.000Z`,
    logicalDay: day,
    slot: 'lunch',
    name,
    items: [item(`test-item-${mealSeq}`, 'Mee goreng mamak', 620, { catalogueId: 'mee-goreng-mamak' })],
    method: 'text',
    finished: 'all',
    createdAt: `${day}T04:00:00.000Z`,
    updatedAt: `${day}T04:00:00.000Z`,
    syncState: 'local',
    ...extra,
  };
}

const names = (list: readonly Usual[]) => list.map((u) => u.name);

describe('order', () => {
  it('puts a manual order first, then most used, then by name', () => {
    const list = [usual('a', 'Teh', 1), usual('b', 'Kopi', 9), usual('c', 'Bread', 1), usual('d', 'Nasi', 0, 1), usual('e', 'Roti', 0, 0)];
    expect(names([...list].sort(compareUsuals))).toEqual(['Roti', 'Nasi', 'Kopi', 'Bread', 'Teh']);
  });

  it('lists the demo Usuals most used first', async () => {
    expect(names(await listOrderedUsualsIn(db))).toEqual(['Roti canai + teh tarik', 'Bread, kaya, kopi', 'Nasi lemak bungkus', 'Teh o ais kurang']);
  });

  it('moves down and up, writing the whole order back', async () => {
    expect(await moveUsualIn(db, U.rotiCanai, 'down')).toBe(true);
    const moved = await listOrderedUsualsIn(db);
    expect(names(moved)).toEqual(['Bread, kaya, kopi', 'Roti canai + teh tarik', 'Nasi lemak bungkus', 'Teh o ais kurang']);
    expect(moved.map((u) => u.sortIndex)).toEqual([0, 1, 2, 3]);

    // A manual order outranks use counts.
    await db.usuals.update(U.tehOAisKurang, { useCount: 99 });
    expect(names(await listOrderedUsualsIn(db))[3]).toBe('Teh o ais kurang');

    expect(await moveUsualIn(db, U.rotiCanai, 'up')).toBe(true);
    expect(names(await listOrderedUsualsIn(db))).toEqual(['Roti canai + teh tarik', 'Bread, kaya, kopi', 'Nasi lemak bungkus', 'Teh o ais kurang']);
  });

  it("won't move past either end", async () => {
    expect(await moveUsualIn(db, U.rotiCanai, 'up')).toBe(false);
    expect(await moveUsualIn(db, U.tehOAisKurang, 'down')).toBe(false);
    expect(await moveUsualIn(db, 'missing', 'down')).toBe(false);
    expect((await db.usuals.toArray()).every((u) => u.sortIndex === undefined)).toBe(true);
  });

  it('puts new Usuals after a manual order', async () => {
    await moveUsualIn(db, U.nasiLemak, 'up');
    const { usual: created } = await createUsualIn(db, { name: 'Mee goreng mamak', items: [item('x', 'Mee goreng mamak', 620)] });
    expect(names(await listOrderedUsualsIn(db)).at(-1)).toBe(created.name);
  });
});

describe('create, edit, delete', () => {
  it('creates from scratch, unused, with clean items; undo removes it', async () => {
    const edited = item('i1', 'Teh tarik', 140, { edited: true, original: { quantity: 1, unitMacros: { kcal: 200, proteinG: 0, carbsG: 0, fatG: 0 } }, question: 'Sugar?' });
    const { usual: created, undo } = await createUsualIn(db, { name: '  Teh tarik   kurang ', items: [edited], slot: 'snack' });
    expect(created).toMatchObject({ name: 'Teh tarik kurang', useCount: 0, slot: 'snack' });
    expect(created.items[0]).not.toHaveProperty('edited');
    expect(created.items[0]).not.toHaveProperty('original');
    expect(created.items[0]).not.toHaveProperty('question');
    expect(await db.usuals.get(created.id)).toBeDefined();
    await undo();
    expect(await db.usuals.get(created.id)).toBeUndefined();
  });

  it('needs a name and at least one item', async () => {
    await expect(createUsualIn(db, { name: '  ', items: [item('i', 'Kopi', 80)] })).rejects.toThrow(RangeError);
    await expect(createUsualIn(db, { name: 'Kopi', items: [] })).rejects.toThrow(RangeError);
    expect(() => usualItems([])).toThrow(RangeError);
  });

  it('creates from a past meal', async () => {
    const { usual: created } = await createUsualFromMealIn(db, DEMO_IDS.meals.todayLunch);
    expect(created).toMatchObject({ name: 'Economy rice', placeId: DEMO_IDS.places.kedai, slot: 'lunch', useCount: 1 });
    await expect(createUsualFromMealIn(db, 'nope')).rejects.toThrow(RangeError);
  });

  it('renames and replaces items, with undo', async () => {
    const undoRename = await renameUsualIn(db, U.rotiCanai, 'Roti canai pagi');
    expect((await db.usuals.get(U.rotiCanai))?.name).toBe('Roti canai pagi');

    const before = await db.usuals.get(U.rotiCanai);
    const first = before?.items[0];
    if (!first) throw new Error('missing item');
    await updateUsualItemsIn(db, U.rotiCanai, [first]);
    expect((await db.usuals.get(U.rotiCanai))?.items.map((i) => i.name)).toEqual(['Roti canai + dhal']);

    await undoRename?.();
    // Undo puts back the version before that edit (the rename's undo restores the original).
    expect((await db.usuals.get(U.rotiCanai))?.name).toBe('Roti canai + teh tarik');
    expect(await editUsualIn(db, 'missing', { name: 'x' })).toBeUndefined();
    await expect(renameUsualIn(db, U.rotiCanai, '')).rejects.toThrow(RangeError);
  });

  it('deletes with an undo that restores the same row', async () => {
    await moveUsualIn(db, U.nasiLemak, 'up');
    const before = await db.usuals.get(U.nasiLemak);
    const undo = await removeUsualIn(db, U.nasiLemak);
    expect(await db.usuals.get(U.nasiLemak)).toBeUndefined();
    await undo();
    expect(await db.usuals.get(U.nasiLemak)).toEqual(before);
    await expect(removeUsualIn(db, 'missing')).resolves.toBeTypeOf('function');
  });

  it('undo puts a Usual back at its place in your order after moves in between, with no shared index', async () => {
    await moveUsualIn(db, U.rotiCanai, 'down');
    // Bread, kaya, kopi · Roti canai + teh tarik · Nasi lemak bungkus · Teh o ais kurang
    const undo = await removeUsualIn(db, U.rotiCanai);
    await moveUsualIn(db, U.tehOAisKurang, 'up');
    expect(names(await listOrderedUsualsIn(db))).toEqual(['Bread, kaya, kopi', 'Teh o ais kurang', 'Nasi lemak bungkus']);

    await undo();
    const restored = await listOrderedUsualsIn(db);
    expect(names(restored)).toEqual(['Bread, kaya, kopi', 'Roti canai + teh tarik', 'Teh o ais kurang', 'Nasi lemak bungkus']);
    expect(restored.map((u) => u.sortIndex)).toEqual([0, 1, 2, 3]);
    expect((await db.usuals.get(U.rotiCanai))?.useCount).toBe(6);
  });

  it('undo after deleting the first Usual of a manual order puts it first again', async () => {
    await moveUsualIn(db, U.breadKayaKopi, 'up');
    const undo = await removeUsualIn(db, U.breadKayaKopi);
    await moveUsualIn(db, U.tehOAisKurang, 'up');
    await undo();
    const restored = await listOrderedUsualsIn(db);
    expect(names(restored)).toEqual(['Bread, kaya, kopi', 'Roti canai + teh tarik', 'Teh o ais kurang', 'Nasi lemak bungkus']);
    expect(new Set(restored.map((u) => u.sortIndex)).size).toBe(4);
  });

  it('undo with no manual order puts the same row back and keeps the order by use', async () => {
    const before = await db.usuals.get(U.breadKayaKopi);
    const undo = await removeUsualIn(db, U.breadKayaKopi);
    await undo();
    expect(await db.usuals.get(U.breadKayaKopi)).toEqual(before);
    expect((await db.usuals.toArray()).every((u) => u.sortIndex === undefined)).toBe(true);
    expect(names(await listOrderedUsualsIn(db))).toEqual(['Roti canai + teh tarik', 'Bread, kaya, kopi', 'Nasi lemak bungkus', 'Teh o ais kurang']);
  });

  it('undo keeps a Usual created after the manual order after it', async () => {
    await moveUsualIn(db, U.nasiLemak, 'up');
    const { usual: created } = await createUsualIn(db, { name: 'Mee goreng mamak', items: [item('x', 'Mee goreng mamak', 620)] });
    const undo = await removeUsualIn(db, U.tehOAisKurang);
    await undo();
    const restored = await listOrderedUsualsIn(db);
    expect(names(restored)).toEqual(['Roti canai + teh tarik', 'Nasi lemak bungkus', 'Bread, kaya, kopi', 'Teh o ais kurang', 'Mee goreng mamak']);
    expect((await db.usuals.get(created.id))?.sortIndex).toBeUndefined();
  });
});

describe('suggested Usuals', () => {
  it('suggests the demo nasi kandar dinner, not plates, pots or names that are already Usuals', async () => {
    const found = await listUsualSuggestionsIn(db, TODAY);
    expect(found.map((s) => s.name)).toEqual(['Nasi kandar ayam goreng']);
    const [first] = found;
    expect(first?.times).toBeGreaterThanOrEqual(3);
    expect(first?.meal.placeId).toBe(DEMO_IDS.places.nasiKandar);
  });

  it('needs 3 meals with the same name within 60 days', async () => {
    await db.meals.bulkPut([meal('Mee goreng mamak', '2026-10-14'), meal('mee goreng MAMAK!', '2026-10-15')]);
    expect((await listUsualSuggestionsIn(db, TODAY)).map((s) => s.name)).not.toContain('Mee goreng mamak');

    // One more, but 60 days back is outside the window.
    await db.meals.put(meal('Mee goreng mamak', '2026-08-17'));
    expect((await listUsualSuggestionsIn(db, TODAY)).map((s) => s.name)).not.toContain('Mee goreng mamak');

    await db.meals.put(meal('Mee goreng mamak', '2026-08-18', { eatenAt: '2026-08-18T04:00:00.000Z' }));
    const found = (await listUsualSuggestionsIn(db, TODAY)).find((s) => s.key === 'mee goreng mamak');
    expect(found).toMatchObject({ times: 3, kcal: 620 });
    // The latest meal is the one to copy.
    expect(found?.meal.logicalDay).toBe('2026-10-15');
  });

  it('skips guesses, plates, pots and meals logged from a Usual', () => {
    const meals = [
      meal('Economy rice', '2026-10-10', { method: 'plate' }),
      meal('Economy rice', '2026-10-11', { method: 'plate' }),
      meal('Economy rice', '2026-10-12', { method: 'plate' }),
      meal('Dinner', '2026-10-10', { isGuess: true }),
      meal('Dinner', '2026-10-11', { isGuess: true }),
      meal('Dinner', '2026-10-12', { method: 'guess' }),
      meal('Kari ayam', '2026-10-10', { method: 'pot' }),
      meal('Kari ayam', '2026-10-11', { method: 'pot' }),
      meal('Kari ayam', '2026-10-12', { method: 'pot' }),
    ];
    expect(findUsualSuggestions(meals, [])).toEqual([]);
  });

  it('treats a Usual with the same items as a match even under another name', () => {
    const meals = ['2026-10-10', '2026-10-11', '2026-10-12'].map((d) => meal('Mee goreng', d));
    const sameItems: Usual = { ...usual('u', 'My mee', 3), items: meals[0]?.items ?? [] };
    expect(findUsualSuggestions(meals, [sameItems])).toEqual([]);
    expect(findUsualSuggestions(meals, [usual('u2', 'MEE GORENG', 1)])).toEqual([]);
    expect(findUsualSuggestions(meals, [])).toHaveLength(1);
  });

  it('saves a suggestion as a Usual counted as often as it was logged', async () => {
    const [suggestion] = await listUsualSuggestionsIn(db, TODAY);
    if (!suggestion) throw new Error('no suggestion');
    const { usual: saved, undo } = await saveSuggestedUsualIn(db, suggestion);
    expect(saved).toMatchObject({ name: 'Nasi kandar ayam goreng', placeId: DEMO_IDS.places.nasiKandar, useCount: suggestion.times });
    expect(await listUsualSuggestionsIn(db, TODAY)).toEqual([]);
    await undo();
    expect((await listUsualSuggestionsIn(db, TODAY)).map((s) => s.name)).toEqual(['Nasi kandar ayam goreng']);
  });

  it('remembers "Not now" by normalised name, with undo', () => {
    expect(readDismissedSuggestions().size).toBe(0);
    dismissUsualSuggestion('Nasi kandar ayam goreng!');
    expect(readDismissedSuggestions().has('nasi kandar ayam goreng')).toBe(true);
    const meals = ['2026-10-10', '2026-10-11', '2026-10-12'].map((d) => meal('Nasi kandar ayam goreng', d));
    expect(findUsualSuggestions(meals, [], { dismissed: readDismissedSuggestions() })).toEqual([]);
    restoreUsualSuggestion('nasi kandar ayam goreng');
    expect(readDismissedSuggestions().size).toBe(0);
  });
});
