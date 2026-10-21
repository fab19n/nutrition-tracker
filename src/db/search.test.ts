// @vitest-environment node
import { createActions } from '@/db/actions';
import { createDb, TABLE_NAMES, type KiraMakanDb } from '@/db/db';
import { DEMO_IDS } from '@/db/seed/demo';
import { setDemoClock } from '@/domain/clock';
import { addDays, compareDays } from '@/domain/day';
import { roundTo10 } from '@/domain/format';
import { mealMacros } from '@/domain/meal';
import { parseQuery, searchMeals, type MealSearchEntry } from '@/domain/search';
import type { MealLog } from '@/domain/types';
import { deletePlaceIn } from './places';
import { INDEX_CHUNK, loadSearchIndexIn } from './search';

const { nasiKandar, kedai, medanSelera, home } = DEMO_IDS.places;

let db: KiraMakanDb;

beforeEach(async () => {
  db = createDb(`search-${crypto.randomUUID()}`);
  await createActions(db).loadDemoData();
});

afterEach(async () => {
  setDemoClock(false);
  await db.delete();
});

const find = (index: readonly MealSearchEntry[], query: string, filter: Parameters<typeof searchMeals>[2] = {}) =>
  searchMeals(index, parseQuery(query), filter);
const ids = (list: readonly MealSearchEntry[]) => list.map((e) => e.id);

/** Everything a person could read on a meal, for an oracle that does not use the index. */
function readable(meal: MealLog): string {
  return [meal.name, meal.text ?? '', ...meal.items.map((i) => i.name)].join(' ').toLowerCase();
}

describe('loadSearchIndexIn on the demo world', () => {
  it('indexes every meal, newest first, with the Place name and the kcal the Diary shows', async () => {
    const index = await loadSearchIndexIn(db);
    const meals = await db.meals.toArray();
    expect(index).toHaveLength(meals.length);
    expect(new Set(ids(index))).toEqual(new Set(meals.map((m) => m.id)));

    const first = index[0];
    expect(first).toMatchObject({ id: DEMO_IDS.meals.todayLunch, name: 'Economy rice', placeName: 'Kedai near home', logicalDay: '2026-10-16' });
    expect(roundTo10(first?.kcal ?? 0)).toBe(670);
    expect(ids(index).slice(0, 2)).toEqual([DEMO_IDS.meals.todayLunch, DEMO_IDS.meals.todayBreakfast]);

    for (let i = 1; i < index.length; i += 1) {
      const a = index[i - 1] as MealSearchEntry;
      const b = index[i] as MealSearchEntry;
      expect(compareDays(a.logicalDay, b.logicalDay) > 0 || (a.logicalDay === b.logicalDay && a.at >= b.at)).toBe(true);
    }

    const byId = new Map(meals.map((m) => [m.id, m]));
    for (const entry of index) expect(entry.kcal).toBe(mealMacros(byId.get(entry.id) as MealLog).kcal);
  });

  it('finds what an independent scan of the meals finds', async () => {
    const index = await loadSearchIndexIn(db);
    const meals = await db.meals.toArray();
    const oracle = (needle: string) => meals.filter((m) => readable(m).includes(needle)).map((m) => m.id).sort();

    expect(find(index, 'teh tarik')).toHaveLength(12);
    expect(ids(find(index, 'teh tarik')).sort()).toEqual(oracle('teh tarik'));
    expect(ids(find(index, 'tehtarik'))).toEqual(ids(find(index, 'teh tarik')));
    expect(ids(find(index, 'TÉH  Tarik')).sort()).toEqual(oracle('teh tarik'));

    expect(ids(find(index, 'kangkung'))).toEqual([
      'meal-2026-10-16-lunch',
      'meal-2026-10-12-lunch',
      'meal-2026-09-30-lunch',
      'meal-2026-09-28-lunch',
    ]);
    expect(ids(find(index, 'kangkung')).sort()).toEqual(oracle('kangkung'));

    expect(ids(find(index, 'medan'))).toEqual(['meal-2026-10-15-dinner', 'meal-2026-10-10-dinner']);
    expect(ids(find(index, 'medan')).sort()).toEqual(
      meals.filter((m) => m.placeId === medanSelera).map((m) => m.id).sort(),
    );

    expect(ids(find(index, 'banjir')).sort()).toEqual([
      'meal-2026-10-04-dinner',
      'meal-2026-10-05-dinner',
      'meal-2026-10-06-dinner',
      'meal-2026-10-07-dinner',
      'meal-2026-10-08-dinner',
    ]);
  });

  it('finds "ikan" in fish meals, not in "Nasi kandar" where the words meet', async () => {
    const index = await loadSearchIndexIn(db);
    const meals = await db.meals.toArray();
    const fish = meals.filter((m) => readable(m).includes('ikan')).map((m) => m.id).sort();

    expect(fish.length).toBeGreaterThan(0);
    expect(ids(find(index, 'ikan')).sort()).toEqual(fish);
    // The most-used Place has "kandar" in its name, so every meal there would show if "nasikandar" counted.
    expect(meals.some((m) => m.placeId === nasiKandar && !fish.includes(m.id))).toBe(true);
  });

  it('filters by slot, and by Place id exactly', async () => {
    const index = await loadSearchIndexIn(db);
    const meals = await db.meals.toArray();

    expect(ids(find(index, '', { slot: 'supper' }))).toEqual(['meal-2026-10-10-supper', 'meal-2026-10-09-supper']);
    expect(find(index, '', { slot: 'supper' })).toHaveLength(meals.filter((m) => m.slot === 'supper').length);

    const atHome = find(index, '', { placeId: home });
    expect(ids(atHome).sort()).toEqual(meals.filter((m) => m.placeId === home).map((m) => m.id).sort());
    expect(atHome.length).toBeGreaterThan(0);
    expect(atHome.every((e) => e.placeName === 'Home')).toBe(true);
  });

  it('finds "nasi kandar" by Place name and by item, and nothing at the other Places unless the meal says so', async () => {
    const index = await loadSearchIndexIn(db);
    const meals = await db.meals.toArray();
    const found = find(index, 'nasi kandar');
    const foundIds = new Set(ids(found));

    for (const meal of meals) {
      const says = /nasi kandar/i.test(readable(meal));
      if (meal.placeId === nasiKandar || says) expect(foundIds.has(meal.id)).toBe(true);
    }
    const elsewhere: string[] = [home, kedai, medanSelera];
    for (const entry of found) {
      const meal = meals.find((m) => m.id === entry.id) as MealLog;
      if (elsewhere.includes(meal.placeId ?? '')) expect(readable(meal)).toMatch(/nasi kandar/i);
    }
    // Home is not "Nasi kandar near home": the exact Place filter keeps them apart.
    const homeOnly = find(index, 'nasi kandar', { placeId: home });
    expect(homeOnly.every((e) => e.placeId === home)).toBe(true);
  });
});

describe('Places in the index', () => {
  it('shows a renamed Place by its new name on the next load', async () => {
    await db.places.update(nasiKandar, { name: 'Mamak Ali' });
    const index = await loadSearchIndexIn(db);
    const names = new Set(index.filter((e) => e.placeId === nasiKandar).map((e) => e.placeName));
    expect(names).toEqual(new Set(['Mamak Ali']));
    expect(find(index, 'mamak ali').length).toBeGreaterThan(0);
    expect(find(index, 'kandar near')).toHaveLength(0);
  });

  it('leaves the meals of a deleted Place without a Place name', async () => {
    const before = await loadSearchIndexIn(db);
    const atKedai = ids(before.filter((e) => e.placeId === kedai));
    expect(atKedai.length).toBeGreaterThan(0);

    await deletePlaceIn(db, kedai);
    const after = await loadSearchIndexIn(db);
    expect(after).toHaveLength(before.length);
    for (const id of atKedai) {
      const entry = after.find((e) => e.id === id);
      expect(entry).toBeDefined();
      expect(entry?.placeName).toBeUndefined();
      expect(entry?.placeId).toBeUndefined();
    }
    expect(find(after, 'kedai near home')).toHaveLength(0);
  });
});

describe('chunking', () => {
  it('indexes in slices and yields between them, with the same entries as one pass', async () => {
    const meals = await db.meals.count();
    const yieldFn = vi.fn(async () => {});
    const chunked = await loadSearchIndexIn(db, { chunk: 2, yieldFn });
    expect(yieldFn).toHaveBeenCalledTimes(Math.ceil(meals / 2) - 1);

    const whole = await loadSearchIndexIn(db);
    expect(ids(chunked)).toEqual(ids(whole));
    expect(chunked).toEqual(whole);
  });

  it('does not yield when everything fits in one slice', async () => {
    const yieldFn = vi.fn(async () => {});
    await loadSearchIndexIn(db, { chunk: INDEX_CHUNK, yieldFn });
    expect(yieldFn).not.toHaveBeenCalled();
    expect(INDEX_CHUNK).toBe(400);
  });
});

describe('Search only reads', () => {
  it('queues and changes nothing, even with sync capture on', async () => {
    await db.delete();
    db = createDb(`search-capture-${crypto.randomUUID()}`, { capture: () => true });
    await createActions(db).loadDemoData();
    await db.syncOutbox.clear();
    const counts = async () => Object.fromEntries(await Promise.all(TABLE_NAMES.map(async (t) => [t, await db[t].count()])));
    const before = await counts();
    const mealsBefore = await db.meals.toArray();

    const index = await loadSearchIndexIn(db);
    for (const query of ['teh tarik', 'kangkung', 'medan', '', 'zzzz']) find(index, query);
    find(index, 'teh', { slot: 'dinner', placeId: home });

    expect(await db.syncOutbox.count()).toBe(0);
    expect(await counts()).toEqual(before);
    expect(await db.meals.toArray()).toEqual(mealsBefore);
  });
});

describe('a large history', () => {
  it('indexes 5,000 meals in order and searches them in one pass', async () => {
    const base = '2021-01-01';
    const bulk: MealLog[] = Array.from({ length: 5000 }, (_, i) => {
      const day = addDays(base, i % 1700);
      const eatenAt = `${day}T0${i % 8}:00:00.000Z`;
      const tea = i % 10 === 0;
      return {
        id: `bulk-${String(i).padStart(5, '0')}`,
        eatenAt,
        logicalDay: day,
        slot: 'lunch',
        name: tea ? 'Lunch with tea' : 'Lunch',
        items: [
          { id: `bulk-${i}-1`, name: 'Nasi lemak', unitMacros: { kcal: 400, proteinG: 8, carbsG: 60, fatG: 14 }, quantity: 1, uncertainty: 0.15, source: 'catalogue' },
          { id: `bulk-${i}-2`, name: tea ? 'Teh tarik' : 'Telur goreng', unitMacros: { kcal: 100, proteinG: 4, carbsG: 2, fatG: 8 }, quantity: 1, uncertainty: 0.15, source: 'catalogue' },
          { id: `bulk-${i}-3`, name: 'Kuih lapis', unitMacros: { kcal: 90, proteinG: 1, carbsG: 20, fatG: 1 }, quantity: 1, uncertainty: 0.2, source: 'catalogue' },
        ],
        method: 'text',
        finished: 'all',
        createdAt: eatenAt,
        updatedAt: eatenAt,
        syncState: 'local',
      } satisfies MealLog;
    });
    await db.meals.bulkPut(bulk);

    const demoMeals = (await db.meals.count()) - 5000;
    const chunks: number[] = [];
    const index = await loadSearchIndexIn(db, { yieldFn: async () => void chunks.push(1) });
    expect(index).toHaveLength(5000 + demoMeals);
    expect(chunks).toHaveLength(Math.ceil(index.length / INDEX_CHUNK) - 1);

    for (let i = 1; i < index.length; i += 1) {
      const a = index[i - 1] as MealSearchEntry;
      const b = index[i] as MealSearchEntry;
      const order = compareDays(b.logicalDay, a.logicalDay) || b.at - a.at || b.id.localeCompare(a.id);
      expect(order).toBeLessThan(0);
    }

    const tea = find(index, 'teh tarik');
    const meals = await db.meals.toArray();
    expect(tea).toHaveLength(meals.filter((m) => readable(m).includes('teh tarik')).length);
    expect(tea).toHaveLength(500 + 12);
    expect(find(index, 'tehtarik')).toHaveLength(tea.length);
    expect(find(index, '')).toHaveLength(index.length);
    expect(find(index, 'zzzz')).toHaveLength(0);
  }, 60_000);
});
