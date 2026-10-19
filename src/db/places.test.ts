// @vitest-environment node
import { createActions } from '@/db/actions';
import { createDb, type KiraMakanDb } from '@/db/db';
import { DEMO_IDS } from '@/db/seed/demo';
import { setDemoClock } from '@/domain/clock';
import type { MealLog, PersonalItem } from '@/domain/types';
import {
  PlaceNameTakenError,
  addPlaceIn,
  addPlaceTrayIn,
  changeLearnedDefaultIn,
  computePlaceStats,
  deletePlaceIn,
  filterPlaces,
  getPlaceDetailIn,
  getPlaceListIn,
  homeDishesFrom,
  learnedDefaultsFor,
  logPotServingHereIn,
  removeLearnedDefaultIn,
  removePlaceTrayIn,
  restoredDefaults,
  setPlaceCoordsIn,
  setPlaceOilIn,
  setPlaceTypicalPriceIn,
  sortPlaces,
  statsWindow,
  updatePlaceDetailsIn,
} from './places';

const TODAY = '2026-10-16';
const { nasiKandar, kedai, medanSelera, home } = DEMO_IDS.places;

let db: KiraMakanDb;

beforeEach(async () => {
  db = createDb(`places-${crypto.randomUUID()}`);
  await createActions(db).loadDemoData();
});

afterEach(async () => {
  setDemoClock(false);
  await db.delete();
});

function meal(id: string, day: string, kcal: number, extra: Partial<MealLog> = {}): MealLog {
  return {
    id,
    eatenAt: `${day}T04:00:00.000Z`,
    logicalDay: day,
    slot: 'lunch',
    name: id,
    items: [{ id: `${id}-1`, name: 'Dish', unitMacros: { kcal, proteinG: 0, carbsG: 0, fatG: 0 }, quantity: 1, uncertainty: 0.15, source: 'catalogue' }],
    method: 'text',
    finished: 'all',
    createdAt: `${day}T04:00:00.000Z`,
    updatedAt: `${day}T04:00:00.000Z`,
    syncState: 'local',
    ...extra,
  };
}

describe('computePlaceStats', () => {
  it('counts visits, averages here and elsewhere, and spend in the window', () => {
    const window = statsWindow(TODAY);
    expect(window).toEqual({ from: '2026-09-17', to: TODAY, weekStart: '2026-10-12' });
    const meals = [
      meal('old', '2026-09-16', 2000, { placeId: 'p', priceRm: 50 }),
      meal('a', '2026-10-05', 900, { placeId: 'p', priceRm: 12 }),
      meal('b', '2026-10-13', 700, { placeId: 'p', priceRm: 10.5 }),
      meal('guess', '2026-10-14', 650, { placeId: 'p', isGuess: true }),
      meal('c', '2026-10-14', 400),
      meal('d', '2026-10-15', 600, { placeId: 'q', priceRm: 8 }),
    ];
    const stats = computePlaceStats('p', meals, window);
    expect(stats).toMatchObject({ visits: 2, avgKcal: 800, elsewhereAvgKcal: 500, spendWeekRm: 10.5, spend30Rm: 22.5, lastVisitDay: '2026-10-13' });
  });

  it('has no averages without meals', () => {
    const stats = computePlaceStats('p', [], statsWindow(TODAY));
    expect(stats).toEqual({ visits: 0, avgKcal: null, elsewhereAvgKcal: null, spendWeekRm: 0, spend30Rm: 0 });
  });
});

describe('Places list', () => {
  it('reads every demo Place with its 30-day stats', async () => {
    const list = await getPlaceListIn(db, TODAY);
    const byId = new Map(list.map((e) => [e.place.id, e.stats]));
    expect(byId.get(nasiKandar)).toMatchObject({ visits: 11, spendWeekRm: 16.8, lastVisitDay: TODAY });
    expect(Math.round(byId.get(nasiKandar)?.avgKcal ?? 0)).toBe(787);
    expect(Math.round(byId.get(nasiKandar)?.elsewhereAvgKcal ?? 0)).toBe(477);
    expect(byId.get(kedai)).toMatchObject({ visits: 9, spendWeekRm: 27 });
    expect(byId.get(medanSelera)).toMatchObject({ visits: 2, lastVisitDay: '2026-10-15' });
    expect(byId.get(home)?.spend30Rm).toBe(0);
  });

  it('sorts by recent and by visits, and searches by name', async () => {
    const list = await getPlaceListIn(db, TODAY);
    expect(sortPlaces(list, 'recent').map((e) => e.place.name)).toEqual(['Kedai near home', 'Nasi kandar near home', 'Medan selera nearby', 'Home']);
    expect(sortPlaces(list, 'visits').map((e) => e.place.name)).toEqual(['Home', 'Nasi kandar near home', 'Kedai near home', 'Medan selera nearby']);
    expect(filterPlaces(list, 'NEAR').map((e) => e.place.name).sort()).toEqual(['Kedai near home', 'Medan selera nearby', 'Nasi kandar near home']);
    expect(filterPlaces(list, '  ')).toHaveLength(4);
    expect(filterPlaces(list, 'kopitiam')).toHaveLength(0);
  });

  it('puts Places never eaten at after the rest, newest first', async () => {
    await addPlaceIn(db, 'Kopitiam lama', 'kopitiam');
    const list = sortPlaces(await getPlaceListIn(db, TODAY), 'recent');
    expect(list.at(-1)?.place.name).toBe('Kopitiam lama');
    expect(list.at(-1)?.stats.visits).toBe(0);
  });
});

describe('Place detail', () => {
  it('shows the nasi kandar stall: usual orders, logged today and the two learned defaults', async () => {
    const { detail } = await getPlaceDetailIn(db, nasiKandar, TODAY);
    expect(detail?.orders.map((o) => [o.name, o.times, o.method])).toEqual([
      ['Roti canai + teh tarik', 6, 'usual'],
      ['Nasi kandar ayam goreng', 8, 'placeOrder'],
    ]);
    expect(detail?.loggedToday).toEqual(['roti canai teh tarik']);
    expect(detail?.learned.map((l) => [l.name, l.variantLabel, l.changePct, l.personalIds.length])).toEqual([
      ['Rice (nasi kandar)', 'Mamak big', 30, 1],
      ['Kuah campur', 'Banjir', 80, 1],
    ]);
    expect(detail?.homeDishes).toEqual([]);
  });

  it('lists home-style dishes for Home, leaving out pots and sides', async () => {
    const { detail } = await getPlaceDetailIn(db, home, TODAY);
    const names = detail?.homeDishes.map((d) => d.name) ?? [];
    expect(names[0]).toBe('Ikan goreng');
    expect(names).toContain('Ayam masak kicap');
    expect(names.some((n) => /rice|kopi|kari ayam/i.test(n))).toBe(false);
    // Pot servings are logged from the pot, not offered as a usual order.
    expect(detail?.orders.map((o) => o.name)).toContain('Bread, kaya, kopi');
    expect(detail?.orders.some((o) => o.name === 'Kari ayam + rice')).toBe(false);
  });

  it('is null for a missing Place', async () => {
    expect(await getPlaceDetailIn(db, 'nope', TODAY)).toEqual({ detail: null });
  });
});

describe('learnedDefaultsFor', () => {
  const personal = (p: Partial<PersonalItem> & Pick<PersonalItem, 'id'>): PersonalItem => ({
    name: 'Item',
    scope: 'place',
    placeId: 'p',
    unitMacros: { kcal: 300, proteinG: 0, carbsG: 0, fatG: 0 },
    uncertainty: 0.15,
    corrections: 2,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...p,
  });

  it('maps a default to the catalogue item and its chip, with the change against the usual portion', () => {
    const rows = learnedDefaultsFor({ id: 'p', defaultVariants: { 'kuah-campur': 0 } }, []);
    expect(rows).toEqual([
      expect.objectContaining({ key: 'kuah-campur', name: 'Kuah campur', variantLabel: 'Sikit', changePct: -50, kcal: 60, personalIds: [] }),
    ]);
  });

  it('adds corrections saved for the Place, and versions without a catalogue item', () => {
    const rows = learnedDefaultsFor({ id: 'p', defaultVariants: {} }, [
      personal({ id: 'x', catalogueId: 'kuah-campur', selectedVariant: 2 }),
      personal({ id: 'y', name: 'Kari ayam, home style' }),
      personal({ id: 'z', catalogueId: 'kuah-campur', placeId: 'other', selectedVariant: 0 }),
      personal({ id: 'w', catalogueId: 'kuah-campur', scope: 'dish', placeId: undefined, selectedVariant: 0 }),
    ]);
    expect(rows.map((r) => [r.key, r.variantLabel, r.personalIds])).toEqual([
      ['kuah-campur', 'Banjir', ['x']],
      ['personal:y', undefined, ['y']],
    ]);
    expect(rows[1]?.kcal).toBe(300);
  });
});

describe('homeDishesFrom', () => {
  it('counts each dish once per meal and skips guesses', () => {
    const withItems = (id: string, catalogueIds: string[], extra: Partial<MealLog> = {}) =>
      meal(id, '2026-10-10', 0, {
        items: catalogueIds.map((c, i) => ({ id: `${id}-${i}`, name: c, catalogueId: c, unitMacros: { kcal: 100, proteinG: 0, carbsG: 0, fatG: 0 }, quantity: 1, uncertainty: 0.15, source: 'catalogue' })),
        ...extra,
      });
    const dishes = homeDishesFrom([
      withItems('a', ['ayam-kicap', 'ayam-kicap', 'rice-economy']),
      withItems('b', ['ayam-kicap']),
      withItems('c', ['ayam-kicap'], { isGuess: true }),
      withItems('d', ['ayam-kicap'], { method: 'pot' }),
    ]);
    expect(dishes).toEqual([{ key: 'ayam-kicap', name: 'Ayam masak kicap', times: 2, kcal: 100 }]);
  });
});

describe('edits', () => {
  it('creates a Place once per name, with its spot only when given', async () => {
    const first = await addPlaceIn(db, '  Kopitiam   Ah Seng ', 'kopitiam', { lat: 3.15, lng: 101.7 });
    expect(first.created).toBe(true);
    expect(first.place).toMatchObject({ name: 'Kopitiam Ah Seng', type: 'kopitiam', coords: { lat: 3.15, lng: 101.7 }, defaultVariants: {} });
    const again = await addPlaceIn(db, 'kopitiam ah seng', 'other');
    expect(again).toEqual({ place: first.place, created: false });
    await expect(addPlaceIn(db, '   ', 'other')).rejects.toThrow(RangeError);
  });

  it('renames and changes type, refusing a name another Place has', async () => {
    const renamed = await updatePlaceDetailsIn(db, medanSelera, { name: ' Medan selera Taman ', type: 'kopitiam' });
    expect(renamed).toMatchObject({ name: 'Medan selera Taman', type: 'kopitiam' });
    await expect(updatePlaceDetailsIn(db, medanSelera, { name: 'HOME' })).rejects.toBeInstanceOf(PlaceNameTakenError);
    await expect(updatePlaceDetailsIn(db, medanSelera, { name: '' })).rejects.toThrow(RangeError);
    // Its own name in another case is fine.
    expect((await updatePlaceDetailsIn(db, medanSelera, { name: 'medan selera taman' })).name).toBe('medan selera taman');
  });

  it('sets oil level, replaces the one saved spot and sets or clears the typical price', async () => {
    await setPlaceOilIn(db, kedai, 'high');
    await setPlaceCoordsIn(db, medanSelera, { lat: 3.2, lng: 101.6 });
    await setPlaceCoordsIn(db, medanSelera, { lat: 3.21, lng: 101.61 });
    await setPlaceTypicalPriceIn(db, medanSelera, 11.456);
    let place = await db.places.get(medanSelera);
    expect(place).toMatchObject({ coords: { lat: 3.21, lng: 101.61 }, typicalPriceRm: 11.46 });
    expect((await db.places.get(kedai))?.oilLevel).toBe('high');
    await setPlaceTypicalPriceIn(db, medanSelera, null);
    place = await db.places.get(medanSelera);
    expect(place && 'typicalPriceRm' in place).toBe(false);
    await setPlaceCoordsIn(db, medanSelera, null);
    place = await db.places.get(medanSelera);
    expect(place && 'coords' in place).toBe(false);
    await expect(setPlaceTypicalPriceIn(db, medanSelera, -1)).rejects.toThrow(RangeError);
    await expect(setPlaceCoordsIn(db, medanSelera, { lat: 200, lng: 0 })).rejects.toThrow(RangeError);
  });

  it('adds and removes tray dishes, only plate-builder dishes', async () => {
    await removePlaceTrayIn(db, kedai, 'taugeh');
    expect((await db.places.get(kedai))?.trays).not.toContain('taugeh');
    await addPlaceTrayIn(db, kedai, 'taugeh');
    await addPlaceTrayIn(db, kedai, 'taugeh');
    expect((await db.places.get(kedai))?.trays?.filter((t) => t === 'taugeh')).toHaveLength(1);
    await addPlaceTrayIn(db, medanSelera, 'ikan-goreng');
    expect((await db.places.get(medanSelera))?.trays).toEqual(['ikan-goreng']);
    await expect(addPlaceTrayIn(db, kedai, 'teh-tarik')).rejects.toThrow(RangeError);
  });
});

describe('learned defaults: change and remove', () => {
  it('changes the portion here and in the saved correction, with undo', async () => {
    const undo = await changeLearnedDefaultIn(db, nasiKandar, 'rice-nasi-kandar', 1);
    expect((await db.places.get(nasiKandar))?.defaultVariants['rice-nasi-kandar']).toBe(1);
    const personal = await db.personalItems.get('personal-nasi-kandar-rice');
    expect(personal).toMatchObject({ selectedVariant: 1, unitMacros: { kcal: 330 } });
    const { detail } = await getPlaceDetailIn(db, nasiKandar, TODAY);
    expect(detail?.learned[0]).toMatchObject({ variantLabel: 'Normal' });
    expect(detail?.learned[0]?.changePct).toBeUndefined();

    await undo();
    expect((await db.places.get(nasiKandar))?.defaultVariants['rice-nasi-kandar']).toBe(2);
    expect(await db.personalItems.get('personal-nasi-kandar-rice')).toMatchObject({ selectedVariant: 2, unitMacros: { kcal: 430 } });
    await expect(changeLearnedDefaultIn(db, nasiKandar, 'rice-nasi-kandar', 9)).rejects.toThrow(RangeError);
  });

  it('removes a default and its correction, and undo restores both', async () => {
    const undo = await removeLearnedDefaultIn(db, nasiKandar, 'kuah-campur');
    expect((await db.places.get(nasiKandar))?.defaultVariants).toEqual({ 'rice-nasi-kandar': 2 });
    expect(await db.personalItems.get('personal-nasi-kandar-kuah')).toBeUndefined();
    expect((await getPlaceDetailIn(db, nasiKandar, TODAY)).detail?.learned.map((l) => l.name)).toEqual(['Rice (nasi kandar)']);
    // The everywhere correction for teh o ais is untouched.
    expect(await db.personalItems.get('personal-teh-o-ais')).toBeDefined();

    await undo();
    expect((await db.places.get(nasiKandar))?.defaultVariants).toEqual({ 'rice-nasi-kandar': 2, 'kuah-campur': 2 });
    expect(await db.personalItems.get('personal-nasi-kandar-kuah')).toMatchObject({ selectedVariant: 2 });
    expect((await getPlaceDetailIn(db, nasiKandar, TODAY)).detail?.learned).toHaveLength(2);
  });

  it('undo puts a removed default back in its place in the list', async () => {
    const undo = await removeLearnedDefaultIn(db, nasiKandar, 'rice-nasi-kandar');
    await undo();
    expect(Object.keys((await db.places.get(nasiKandar))?.defaultVariants ?? {})).toEqual(['rice-nasi-kandar', 'kuah-campur']);
    expect((await getPlaceDetailIn(db, nasiKandar, TODAY)).detail?.learned.map((l) => l.key)).toEqual(['rice-nasi-kandar', 'kuah-campur']);
  });

  it('restores one key in its old order, keeping later changes to the others', () => {
    const before = { a: 1, b: 2, c: 3 };
    // b removed; c changed since; d added since.
    expect(Object.entries(restoredDefaults({ a: 1, c: 0, d: 4 }, before, 'b'))).toEqual([
      ['a', 1],
      ['b', 2],
      ['c', 0],
      ['d', 4],
    ]);
    // a removed since b was: it stays removed.
    expect(Object.keys(restoredDefaults({ c: 3 }, before, 'b'))).toEqual(['b', 'c']);
    // A key that wasn't there before goes again.
    expect(restoredDefaults({ a: 1, x: 2 }, { a: 1 }, 'x')).toEqual({ a: 1 });
  });

  it('does nothing for a default that isn’t there', async () => {
    const undo = await removeLearnedDefaultIn(db, kedai, 'kuah-campur');
    await undo();
    expect((await db.places.get(kedai))?.defaultVariants).toEqual({});
  });
});

describe('deletePlaceIn', () => {
  it('unlinks meals and Usuals in one go and undo puts everything back', async () => {
    const mealsBefore = await db.meals.where('placeId').equals(nasiKandar).count();
    const deleted = await deletePlaceIn(db, nasiKandar);
    expect(deleted).toMatchObject({ mealsUnlinked: mealsBefore, usualsUnlinked: 1 });
    expect(await db.places.get(nasiKandar)).toBeUndefined();
    expect(await db.meals.where('placeId').equals(nasiKandar).count()).toBe(0);
    expect(await db.meals.get(DEMO_IDS.meals.todayBreakfast)).toBeDefined();
    expect((await db.meals.get(DEMO_IDS.meals.todayBreakfast))?.placeId).toBeUndefined();
    expect((await db.usuals.get(DEMO_IDS.usuals.rotiCanai))?.placeId).toBeUndefined();
    expect(await db.personalItems.where('placeId').equals(nasiKandar).count()).toBe(0);

    await deleted?.undo();
    expect((await db.places.get(nasiKandar))?.name).toBe('Nasi kandar near home');
    expect(await db.meals.where('placeId').equals(nasiKandar).count()).toBe(mealsBefore);
    expect((await db.usuals.get(DEMO_IDS.usuals.rotiCanai))?.placeId).toBe(nasiKandar);
    expect(await db.personalItems.where('placeId').equals(nasiKandar).count()).toBe(2);
  });

  it('marks the meals it unlinks (and relinks on undo) as edited, so synced ones go up again', async () => {
    const ids = (await db.meals.where('placeId').equals(nasiKandar).primaryKeys()) as string[];
    const [synced, local] = ids;
    await db.meals.update(synced as string, { syncState: 'synced', updatedAt: '2026-10-01T00:00:00.000Z' });
    await db.meals.update(local as string, { syncState: 'local', updatedAt: '2026-10-01T00:00:00.000Z' });

    const deleted = await deletePlaceIn(db, nasiKandar);
    const afterDelete = await db.meals.get(synced as string);
    expect(afterDelete).toMatchObject({ syncState: 'pending' });
    expect((afterDelete?.updatedAt ?? '') > '2026-10-01T00:00:00.000Z').toBe(true);
    // Local rows stay local until their first sync.
    expect((await db.meals.get(local as string))?.syncState).toBe('local');

    await db.meals.update(synced as string, { syncState: 'synced', updatedAt: '2026-10-01T00:00:00.000Z' });
    await deleted?.undo();
    const afterUndo = await db.meals.get(synced as string);
    expect(afterUndo).toMatchObject({ placeId: nasiKandar, syncState: 'pending' });
    expect((afterUndo?.updatedAt ?? '') > '2026-10-01T00:00:00.000Z').toBe(true);
  });

  it('returns undefined for a missing Place', async () => {
    expect(await deletePlaceIn(db, 'nope')).toBeUndefined();
  });
});

describe('logPotServingHereIn', () => {
  it('logs one serving at this Place, or only what is left when that is less', async () => {
    const kari = DEMO_IDS.pots.kariAyam;
    const one = await logPotServingHereIn(db, kari, home);
    expect(one.meal).toMatchObject({ method: 'pot', placeId: home });
    expect(one.meal.items[0]?.quantity).toBe(1);
    expect(one.pot.servingsLeft).toBe(2);

    await db.pots.update(kari, { servingsLeft: 0.5 });
    const half = await logPotServingHereIn(db, kari, home);
    // The meal and the pot agree: half a serving, half the kcal.
    expect(half.meal.items[0]?.quantity).toBe(0.5);
    expect(half.meal.items[0]?.unitMacros.kcal).toBeCloseTo(one.meal.items[0]?.unitMacros.kcal ?? 0);
    expect(half.pot.servingsLeft).toBe(0);
    await expect(logPotServingHereIn(db, kari, home)).rejects.toThrow(RangeError);

    await half.undo();
    expect((await db.pots.get(kari))?.servingsLeft).toBe(0.5);
    expect(await db.meals.get(half.meal.id)).toBeUndefined();
    await expect(logPotServingHereIn(db, 'no-pot', home)).rejects.toThrow();
  });
});
