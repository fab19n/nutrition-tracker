/**
 * Places (S21 Places list, S22 Place detail, plan §9.4): what each Place has learned and how you
 * eat there, plus the edits the detail screen makes.
 *
 * - Stats over the last 30 days: visits (meals there), average kcal here vs elsewhere, spend this
 *   week and in 30 days, last visit.
 * - Usual orders (the Log sheet's listPlaceOrders) and what you've taught it: the Place's learned
 *   portions (defaultVariants) merged with corrections saved for this Place (personal items).
 * - Edits: name and type, oil level, its own spot ("I'm here now": saved once, never a history),
 *   economy-rice trays, typical price, learned defaults (change / remove with undo).
 * - Create, and delete in one transaction that unlinks its meals and Usuals, with an undo that
 *   puts everything back.
 * - Home's "Log 1" on a pot: the same serving rule as the Pots screens (never more than is left).
 *
 * Plain async functions take the database first (`…In`); the bound versions and hooks use the
 * app's database.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { byId, normaliseName } from '@/data/catalogue';
import { createActions, type PotServingResult, type Undo } from '@/db/actions';
import { db as appDb, type KiraMakanDb } from '@/db/db';
import { useToday } from '@/db/hooks';
import { createPlace, listPlaceOrders, setPlaceOilLevel, type LatLng, type OrderOption } from '@/db/logging';
import { findPlaceByName, getPlace, getPot, listMealsInRange, listPersonalItemsForPlace, listPlaces } from '@/db/repo';
import { now } from '@/domain/clock';
import { addDays, compareDays, weekStartOf } from '@/domain/day';
import { itemMacros, mealMacros } from '@/domain/meal';
import type { CatalogueItem, FoodCategory, Id, Instant, LogicalDay, MealLog, OilLevel, PersonalItem, Place, PlaceType, Variant } from '@/domain/types';

/** Stats look back this many days, today included (S22 "14 visits in 30 days"). */
export const STATS_DAYS = 30;
/** Fewer visits than this and the Place is still "Learning your orders". */
export const LEARNING_VISITS = 3;
/** Usual orders shown on the detail screen. */
export const DETAIL_ORDERS = 6;
/** Home-style dishes listed for Home. */
const HOME_DISHES = 5;
/** A typical price above this is a typo, not a meal. */
export const MAX_PRICE_RM = 1000;

const NO_UNDO: Undo = async () => {};

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export interface StatsWindow {
  /** First day counted (today − 29). */
  from: LogicalDay;
  /** Today. */
  to: LogicalDay;
  /** Monday of this budget week, for "spend this week". */
  weekStart: LogicalDay;
}

export function statsWindow(today: LogicalDay): StatsWindow {
  return { from: addDays(today, -(STATS_DAYS - 1)), to: today, weekStart: weekStartOf(today) };
}

export interface PlaceStats {
  /** Meals eaten here in the last 30 days (check-in guesses aren't visits). */
  visits: number;
  /** Average kcal of a meal here in the last 30 days; null without meals. */
  avgKcal: number | null;
  /** Average kcal of a meal anywhere else (or without a Place) in the same 30 days. */
  elsewhereAvgKcal: number | null;
  spendWeekRm: number;
  spend30Rm: number;
  /** The latest meal here, any time. */
  lastVisitAt?: Instant;
  lastVisitDay?: LogicalDay;
}

function average(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function inWindow(day: LogicalDay, from: LogicalDay, to: LogicalDay): boolean {
  return compareDays(day, from) >= 0 && compareDays(day, to) <= 0;
}

function roundCents(rm: number): number {
  return Math.round(rm * 100) / 100;
}

/**
 * One Place's numbers from the meals of the window (every Place) and its latest meal.
 * Meals outside the window are ignored, so callers may pass a wider list.
 */
export function computePlaceStats(placeId: Id, meals: readonly MealLog[], window: StatsWindow, lastVisit?: Pick<MealLog, 'eatenAt' | 'logicalDay'>): PlaceStats {
  const real = meals.filter((m) => !m.isGuess && inWindow(m.logicalDay, window.from, window.to));
  const here = real.filter((m) => m.placeId === placeId);
  const elsewhere = real.filter((m) => m.placeId !== placeId);
  const spend = (list: readonly MealLog[]) => roundCents(list.reduce((sum, m) => sum + (m.priceRm ?? 0), 0));
  const stats: PlaceStats = {
    visits: here.length,
    avgKcal: average(here.map((m) => mealMacros(m).kcal)),
    elsewhereAvgKcal: average(elsewhere.map((m) => mealMacros(m).kcal)),
    spendWeekRm: spend(here.filter((m) => compareDays(m.logicalDay, window.weekStart) >= 0)),
    spend30Rm: spend(here),
  };
  const latest = lastVisit ?? here.at(-1);
  if (latest) {
    stats.lastVisitAt = latest.eatenAt;
    stats.lastVisitDay = latest.logicalDay;
  }
  return stats;
}

/** The latest real meal per Place (meals sorted by eatenAt or not). */
function latestMealByPlace(meals: readonly MealLog[]): Map<Id, MealLog> {
  const latest = new Map<Id, MealLog>();
  for (const meal of meals) {
    if (!meal.placeId || meal.isGuess) continue;
    const current = latest.get(meal.placeId);
    if (!current || meal.eatenAt > current.eatenAt) latest.set(meal.placeId, meal);
  }
  return latest;
}

// ---------------------------------------------------------------------------
// Places list (S21)
// ---------------------------------------------------------------------------

export interface PlaceListEntry {
  place: Place;
  stats: PlaceStats;
}

export type PlaceSort = 'recent' | 'visits';

/**
 * Recent: last eaten at first, Places never used after them (newest first).
 * Most visited: visits in 30 days, then the most recent, then by name.
 */
export function sortPlaces(entries: readonly PlaceListEntry[], sort: PlaceSort): PlaceListEntry[] {
  const byRecent = (a: PlaceListEntry, b: PlaceListEntry): number => {
    const la = a.stats.lastVisitAt;
    const lb = b.stats.lastVisitAt;
    if (la && lb && la !== lb) return lb.localeCompare(la);
    if (la && !lb) return -1;
    if (lb && !la) return 1;
    if (!la && !lb) return b.place.createdAt.localeCompare(a.place.createdAt);
    return 0;
  };
  const byName = (a: PlaceListEntry, b: PlaceListEntry) => a.place.name.localeCompare(b.place.name, 'en', { sensitivity: 'base' });
  return [...entries].sort((a, b) => {
    if (sort === 'visits') return b.stats.visits - a.stats.visits || byRecent(a, b) || byName(a, b);
    return byRecent(a, b) || byName(a, b);
  });
}

/** Case-, accent- and punctuation-insensitive name search. */
export function filterPlaces(entries: readonly PlaceListEntry[], query: string): PlaceListEntry[] {
  const q = normaliseName(query);
  if (!q) return [...entries];
  return entries.filter((e) => normaliseName(e.place.name).includes(q));
}

export async function getPlaceListIn(db: KiraMakanDb, today: LogicalDay): Promise<PlaceListEntry[]> {
  const window = statsWindow(today);
  const places = await listPlaces(db);
  const ids = places.map((p) => p.id);
  const [windowMeals, atPlaces] = await Promise.all([
    listMealsInRange(db, window.from, window.to),
    ids.length > 0 ? db.meals.where('placeId').anyOf(ids).toArray() : Promise.resolve([] as MealLog[]),
  ]);
  const latest = latestMealByPlace(atPlaces);
  return places.map((place) => ({ place, stats: computePlaceStats(place.id, windowMeals, window, latest.get(place.id)) }));
}

/** Every Place with its stats (alphabetical; sort with sortPlaces). Undefined while loading. */
export function usePlaceList(): PlaceListEntry[] | undefined {
  const today = useToday();
  return useLiveQuery(() => getPlaceListIn(appDb, today), [today]);
}

// ---------------------------------------------------------------------------
// What you've taught it (C36)
// ---------------------------------------------------------------------------

export interface LearnedDefault {
  /** The catalogue id, or `personal:<id>` for a saved version without one. */
  key: string;
  catalogueId?: string;
  /** "Rice (nasi kandar)", "Kuah campur". */
  name: string;
  /** "Mamak big"; undefined for a saved version without chips. */
  variantLabel?: string;
  /** kcal change against the catalogue's usual portion, as a whole percent rounded to 10 (+30). */
  changePct?: number;
  /** kcal of one of the learned portion. */
  kcal: number;
  /** The chips Change offers. */
  variants?: Variant[];
  selectedVariant?: number;
  /** Corrections saved for this Place behind this default. */
  personalIds: Id[];
}

function changePctOf(food: CatalogueItem | undefined, variants: readonly Variant[] | undefined, selected: number | undefined): number | undefined {
  if (!food || selected === undefined || selected === food.defaultVariant) return undefined;
  const usual = food.variants[food.defaultVariant]?.macros.kcal;
  const chosen = (variants ?? food.variants)[selected]?.macros.kcal;
  if (!usual || chosen === undefined) return undefined;
  const pct = Math.round(((chosen - usual) / usual) * 10) * 10;
  return pct === 0 ? undefined : pct;
}

/**
 * The Place's learned portions merged with its saved corrections: one row per catalogue item
 * (the correction's chips win, since they are what the estimator uses), then saved versions
 * without a catalogue item. Catalogue order of first appearance is kept: defaults first.
 */
export function learnedDefaultsFor(place: Pick<Place, 'id' | 'defaultVariants'>, personal: readonly PersonalItem[]): LearnedDefault[] {
  const atPlace = personal.filter((p) => p.scope === 'place' && p.placeId === place.id);
  const rows = new Map<string, LearnedDefault>();

  const keys = [
    ...Object.keys(place.defaultVariants),
    ...atPlace.flatMap((p) => (p.catalogueId && !(p.catalogueId in place.defaultVariants) ? [p.catalogueId] : [])),
  ];
  for (const catalogueId of keys) {
    if (rows.has(catalogueId)) continue;
    const food = byId(catalogueId);
    const mine = atPlace.filter((p) => p.catalogueId === catalogueId);
    const withChips = mine.find((p) => p.selectedVariant !== undefined);
    const variants = withChips?.variants ?? food?.variants;
    const selected = withChips?.selectedVariant ?? place.defaultVariants[catalogueId];
    const chosen = selected !== undefined ? variants?.[selected] : undefined;
    const name = food?.name ?? mine[0]?.name;
    if (!name) continue;
    const row: LearnedDefault = {
      key: catalogueId,
      catalogueId,
      name,
      kcal: chosen?.macros.kcal ?? mine[0]?.unitMacros.kcal ?? 0,
      personalIds: mine.map((p) => p.id),
    };
    if (chosen) row.variantLabel = chosen.label;
    const pct = changePctOf(food, variants, selected);
    if (pct !== undefined) row.changePct = pct;
    if (variants && variants.length > 1) row.variants = variants.map((v) => ({ ...v, macros: { ...v.macros } }));
    if (selected !== undefined) row.selectedVariant = selected;
    rows.set(catalogueId, row);
  }

  for (const p of atPlace) {
    if (p.catalogueId) continue;
    const row: LearnedDefault = { key: `personal:${p.id}`, name: p.name, kcal: p.unitMacros.kcal, personalIds: [p.id] };
    const chosen = p.selectedVariant !== undefined ? p.variants?.[p.selectedVariant] : undefined;
    if (chosen) row.variantLabel = chosen.label;
    if (p.variants && p.variants.length > 1 && p.selectedVariant !== undefined) {
      row.variants = p.variants.map((v) => ({ ...v, macros: { ...v.macros } }));
      row.selectedVariant = p.selectedVariant;
    }
    rows.set(row.key, row);
  }
  return [...rows.values()];
}

// ---------------------------------------------------------------------------
// Home-style dishes (S22, Home)
// ---------------------------------------------------------------------------

export interface HomeDish {
  key: string;
  name: string;
  /** Meals it was part of in the window. */
  times: number;
  /** Average kcal of one serving as logged. */
  kcal: number;
}

/** Sides, drinks and bases aren't "dishes" (rice, kuah, kopi, biscuits). */
const NOT_A_DISH: ReadonlySet<FoodCategory> = new Set<FoodCategory>(['rice', 'drinks', 'gravy', 'bread', 'snack', 'kuih', 'fruit']);

/**
 * Family cooking logged like a stall dish (plan §9.7): the dishes eaten at this Place most often,
 * leaving out pot servings (pots show on their own) and sides.
 */
export function homeDishesFrom(meals: readonly MealLog[], limit: number = HOME_DISHES): HomeDish[] {
  const groups = new Map<string, { name: string; times: number; kcal: number[] }>();
  for (const meal of meals) {
    if (meal.isGuess || meal.method === 'pot') continue;
    const seen = new Set<string>();
    for (const item of meal.items) {
      const food = item.catalogueId ? byId(item.catalogueId) : undefined;
      if (food && NOT_A_DISH.has(food.category)) continue;
      const key = item.catalogueId ?? `name:${normaliseName(item.name)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const group = groups.get(key) ?? { name: food?.name ?? item.name, times: 0, kcal: [] };
      group.times += 1;
      group.kcal.push(itemMacros(item).kcal / Math.max(1, item.quantity));
      groups.set(key, group);
    }
  }
  return [...groups.entries()]
    .map(([key, g]) => ({ key, name: g.name, times: g.times, kcal: average(g.kcal) ?? 0 }))
    .sort((a, b) => b.times - a.times || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Place detail (S22)
// ---------------------------------------------------------------------------

export interface PlaceDetail {
  place: Place;
  stats: PlaceStats;
  /** Usuals here, then meals eaten here at least twice. */
  orders: OrderOption[];
  /** Normalised names of the meals eaten here today ("Logged" on an order row). */
  loggedToday: string[];
  learned: LearnedDefault[];
  /** Only for Home Places. */
  homeDishes: HomeDish[];
}

/** `{ detail: null }` once it's clear the Place isn't there. */
export interface PlaceLookup {
  detail: PlaceDetail | null;
}

export async function getPlaceDetailIn(db: KiraMakanDb, id: Id, today: LogicalDay): Promise<PlaceLookup> {
  const place = await getPlace(db, id);
  if (!place) return { detail: null };
  const window = statsWindow(today);
  const [windowMeals, allOrders, personal, atPlace] = await Promise.all([
    listMealsInRange(db, window.from, window.to),
    // A few spare, for the pot meals left out below.
    listPlaceOrders(db, id, DETAIL_ORDERS + 4),
    listPersonalItemsForPlace(db, id),
    db.meals.where('placeId').equals(id).toArray(),
  ]);
  const latest = latestMealByPlace(atPlace).get(id);
  const here = windowMeals.filter((m) => m.placeId === id);
  // A pot serving is logged from its pot (which counts servings down), never as a repeat order.
  const potMeals = new Set(atPlace.filter((m) => m.method === 'pot').map((m) => `order:${m.id}`));
  const orders = allOrders.filter((o) => !potMeals.has(o.id)).slice(0, DETAIL_ORDERS);
  return {
    detail: {
      place,
      stats: computePlaceStats(id, windowMeals, window, latest),
      orders,
      loggedToday: here.filter((m) => m.logicalDay === today && !m.isGuess).map((m) => normaliseName(m.name)),
      learned: learnedDefaultsFor(place, personal),
      homeDishes: place.type === 'home' ? homeDishesFrom(here) : [],
    },
  };
}

/** Undefined while loading; `{ detail: null }` for a missing Place. */
export function usePlaceDetail(id: Id | undefined): PlaceLookup | undefined {
  const today = useToday();
  return useLiveQuery(() => (id ? getPlaceDetailIn(appDb, id, today) : { detail: null }), [id, today]);
}

// ---------------------------------------------------------------------------
// Create, rename, type
// ---------------------------------------------------------------------------

/** Thrown when a rename would give two Places the same name. */
export class PlaceNameTakenError extends Error {
  constructor(readonly existing: Place) {
    super(`There is already a Place called ${existing.name}`);
    this.name = 'PlaceNameTakenError';
  }
}

export function cleanPlaceName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

export interface AddedPlace {
  place: Place;
  /** False when a Place with that name was already there (it is returned unchanged). */
  created: boolean;
}

/** "+ New place": a new Place, or the existing one with that name. Coordinates only when asked for. */
export async function addPlaceIn(db: KiraMakanDb, name: string, type: PlaceType, coords?: LatLng): Promise<AddedPlace> {
  const clean = cleanPlaceName(name);
  if (!clean) throw new RangeError('A Place needs a name');
  const existing = await findPlaceByName(db, clean);
  if (existing) return { place: existing, created: false };
  return { place: await createPlace(db, clean, type, coords), created: true };
}

export async function updatePlaceDetailsIn(db: KiraMakanDb, id: Id, patch: { name?: string; type?: PlaceType }): Promise<Place> {
  return db.transaction('rw', db.places, async () => {
    const place = await getPlace(db, id);
    if (!place) throw new RangeError(`No Place ${id}`);
    const next: Place = { ...place };
    if (patch.name !== undefined) {
      const clean = cleanPlaceName(patch.name);
      if (!clean) throw new RangeError('A Place needs a name');
      const wanted = normaliseName(clean);
      const taken = (await listPlaces(db)).find((p) => p.id !== id && normaliseName(p.name) === wanted);
      if (taken) throw new PlaceNameTakenError(taken);
      next.name = clean;
    }
    if (patch.type !== undefined) next.type = patch.type;
    await db.places.put(next);
    return next;
  });
}

// ---------------------------------------------------------------------------
// Oil, spot, price
// ---------------------------------------------------------------------------

export function setPlaceOilIn(db: KiraMakanDb, id: Id, level: OilLevel): Promise<boolean> {
  return setPlaceOilLevel(db, id, level);
}

function validCoords(c: LatLng): boolean {
  return Number.isFinite(c.lat) && Number.isFinite(c.lng) && Math.abs(c.lat) <= 90 && Math.abs(c.lng) <= 180;
}

/**
 * "I'm here now": replaces the Place's one saved spot (null forgets it, e.g. an undo of the first
 * save). No earlier spot is kept anywhere.
 */
export async function setPlaceCoordsIn(db: KiraMakanDb, id: Id, coords: LatLng | null): Promise<boolean> {
  if (coords !== null && !validCoords(coords)) throw new RangeError('Not a location');
  const updated = await db.places
    .where('id')
    .equals(id)
    .modify((place) => {
      if (coords === null) delete place.coords;
      else place.coords = { lat: coords.lat, lng: coords.lng };
    });
  return updated > 0;
}

/** The usual price here (null clears it). */
export async function setPlaceTypicalPriceIn(db: KiraMakanDb, id: Id, rm: number | null): Promise<boolean> {
  if (rm !== null && (!Number.isFinite(rm) || rm <= 0 || rm > MAX_PRICE_RM)) throw new RangeError('Not a price');
  const updated = await db.places
    .where('id')
    .equals(id)
    .modify((place) => {
      if (rm === null) delete place.typicalPriceRm;
      else place.typicalPriceRm = roundCents(rm);
    });
  return updated > 0;
}

// ---------------------------------------------------------------------------
// Trays (economy rice)
// ---------------------------------------------------------------------------

/** Adds a tray dish (a catalogue item with a plate group) to the stall's trays. */
export async function addPlaceTrayIn(db: KiraMakanDb, id: Id, catalogueId: string): Promise<boolean> {
  if (!byId(catalogueId)?.plateGroup) throw new RangeError(`${catalogueId} isn't a tray dish`);
  const updated = await db.places
    .where('id')
    .equals(id)
    .modify((place) => {
      const trays = place.trays ?? [];
      if (!trays.includes(catalogueId)) place.trays = [...trays, catalogueId];
    });
  return updated > 0;
}

export async function removePlaceTrayIn(db: KiraMakanDb, id: Id, catalogueId: string): Promise<boolean> {
  const updated = await db.places
    .where('id')
    .equals(id)
    .modify((place) => {
      if (place.trays) place.trays = place.trays.filter((t) => t !== catalogueId);
    });
  return updated > 0;
}

// ---------------------------------------------------------------------------
// Learned defaults: change and remove
// ---------------------------------------------------------------------------

interface DefaultSnapshot {
  place: Place;
  personal: PersonalItem[];
}

function keyMatches(key: string, p: PersonalItem): boolean {
  return key.startsWith('personal:') ? `personal:${p.id}` === key : p.catalogueId === key;
}

async function snapshotDefault(db: KiraMakanDb, placeId: Id, key: string): Promise<DefaultSnapshot | undefined> {
  const place = await getPlace(db, placeId);
  if (!place) return undefined;
  const personal = (await listPersonalItemsForPlace(db, placeId)).filter((p) => p.scope === 'place' && keyMatches(key, p));
  return { place, personal };
}

/**
 * The Place's defaults with `key` as it was in `before`, in `before`'s key order (so the row comes
 * back where it was on S22). Other keys keep their current values; ones added since go last.
 */
export function restoredDefaults(current: Readonly<Record<string, number>>, before: Readonly<Record<string, number>>, key: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(before)) {
    if (k === key) out[k] = v;
    else if (k in current) out[k] = current[k] as number;
  }
  for (const [k, v] of Object.entries(current)) {
    if (k !== key && !(k in out)) out[k] = v;
  }
  return out;
}

/** Puts a learned default back exactly as it was (the Place's entry, in its place, and its corrections). */
function restoreDefault(db: KiraMakanDb, key: string, before: DefaultSnapshot): Undo {
  return async () => {
    await db.transaction('rw', [db.places, db.personalItems], async () => {
      const place = await getPlace(db, before.place.id);
      if (place && !key.startsWith('personal:')) {
        await db.places.put({ ...place, defaultVariants: restoredDefaults(place.defaultVariants, before.place.defaultVariants, key) });
      }
      const ids = new Set(before.personal.map((p) => p.id));
      const current = (await listPersonalItemsForPlace(db, before.place.id)).filter((p) => p.scope === 'place' && keyMatches(key, p) && !ids.has(p.id));
      if (current.length > 0) await db.personalItems.bulkDelete(current.map((p) => p.id));
      if (before.personal.length > 0) await db.personalItems.bulkPut(before.personal);
    });
  };
}

/**
 * Change: the learned portion here becomes `variantIndex` (the Place's entry, and its saved
 * corrections' chips and values). Returns an undo.
 */
export async function changeLearnedDefaultIn(db: KiraMakanDb, placeId: Id, key: string, variantIndex: number): Promise<Undo> {
  return db.transaction('rw', [db.places, db.personalItems], async () => {
    const before = await snapshotDefault(db, placeId, key);
    if (!before) return NO_UNDO;
    const catalogueId = key.startsWith('personal:') ? undefined : key;
    const food = catalogueId ? byId(catalogueId) : undefined;
    const variants = before.personal.find((p) => p.variants)?.variants ?? food?.variants;
    const chosen = variants?.[variantIndex];
    if (!chosen) throw new RangeError(`No portion ${variantIndex} for ${key}`);

    if (catalogueId && (food || catalogueId in before.place.defaultVariants)) {
      await db.places.put({ ...before.place, defaultVariants: { ...before.place.defaultVariants, [catalogueId]: variantIndex } });
    }
    const stamp = now().toISOString();
    for (const p of before.personal) {
      const own = p.variants ?? food?.variants;
      const mine = own?.[variantIndex];
      if (!mine) continue;
      await db.personalItems.put({ ...p, selectedVariant: variantIndex, unitMacros: { ...mine.macros }, updatedAt: stamp });
    }
    return restoreDefault(db, key, before);
  });
}

/** Remove: the Place forgets this default and its saved corrections. Returns an undo. */
export async function removeLearnedDefaultIn(db: KiraMakanDb, placeId: Id, key: string): Promise<Undo> {
  return db.transaction('rw', [db.places, db.personalItems], async () => {
    const before = await snapshotDefault(db, placeId, key);
    if (!before) return NO_UNDO;
    const hasEntry = !key.startsWith('personal:') && key in before.place.defaultVariants;
    if (!hasEntry && before.personal.length === 0) return NO_UNDO;
    if (hasEntry) {
      const defaults = { ...before.place.defaultVariants };
      delete defaults[key];
      await db.places.put({ ...before.place, defaultVariants: defaults });
    }
    if (before.personal.length > 0) await db.personalItems.bulkDelete(before.personal.map((p) => p.id));
    return restoreDefault(db, key, before);
  });
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/** A meal whose Place changed is an edit: newer, and a synced one has to go up again (as in actions.ts). */
function touchMeal(meal: MealLog, stamp: Instant): void {
  meal.updatedAt = stamp;
  if (meal.syncState === 'synced') meal.syncState = 'pending';
}

export interface DeletedPlace {
  place: Place;
  mealsUnlinked: number;
  usualsUnlinked: number;
  undo: Undo;
}

/**
 * Deletes the Place in one transaction: its meals and Usuals lose their `placeId` (they stay in
 * the diary and library), and corrections saved only for this Place go with it. Undo puts the
 * Place and its corrections back and relinks the same meals and Usuals.
 */
export async function deletePlaceIn(db: KiraMakanDb, id: Id): Promise<DeletedPlace | undefined> {
  return db.transaction('rw', [db.places, db.meals, db.usuals, db.personalItems], async () => {
    const place = await getPlace(db, id);
    if (!place) return undefined;
    const mealIds = (await db.meals.where('placeId').equals(id).primaryKeys()) as Id[];
    const usualIds = (await db.usuals.where('placeId').equals(id).primaryKeys()) as Id[];
    const personal = await listPersonalItemsForPlace(db, id);
    const stamp = now().toISOString();

    await db.meals.where('placeId').equals(id).modify((meal) => {
      delete meal.placeId;
      touchMeal(meal, stamp);
    });
    await db.usuals.where('placeId').equals(id).modify((usual) => {
      delete usual.placeId;
    });
    if (personal.length > 0) await db.personalItems.bulkDelete(personal.map((p) => p.id));
    await db.places.delete(id);

    const undo: Undo = async () => {
      await db.transaction('rw', [db.places, db.meals, db.usuals, db.personalItems], async () => {
        await db.places.put(place);
        if (personal.length > 0) await db.personalItems.bulkPut(personal);
        // Only rows still without a Place: one moved to another Place since stays there.
        const relinked = now().toISOString();
        await db.meals.where(':id').anyOf(mealIds).modify((meal) => {
          if (meal.placeId) return;
          meal.placeId = id;
          touchMeal(meal, relinked);
        });
        await db.usuals.where(':id').anyOf(usualIds).modify((usual) => {
          if (!usual.placeId) usual.placeId = id;
        });
      });
    };
    return { place, mealsUnlinked: mealIds.length, usualsUnlinked: usualIds.length, undo };
  });
}

// ---------------------------------------------------------------------------
// Pots at Home (S22)
// ---------------------------------------------------------------------------

/**
 * "Log 1" on Home's pots: one serving as a meal at this Place, or what's left when that's less
 * (½ left logs ½, its kcal and the pot's count agree). The same rule as the Pots screens
 * (pots.ts logPotServingsIn), but at the Home being shown.
 */
export async function logPotServingHereIn(db: KiraMakanDb, potId: Id, placeId: Id, servings = 1): Promise<PotServingResult> {
  if (!Number.isFinite(servings) || servings <= 0) throw new RangeError(`Servings must be positive: ${servings}`);
  const pot = await getPot(db, potId);
  if (!pot) throw new Error(`Pot not found: ${potId}`);
  if (pot.servingsLeft <= 0) throw new RangeError('This pot is finished');
  return createActions(db).logPotServing(potId, Math.min(servings, pot.servingsLeft), { placeId });
}

// ---------------------------------------------------------------------------
// Bound to the app's database
// ---------------------------------------------------------------------------

export const addPlace = (name: string, type: PlaceType, coords?: LatLng) => addPlaceIn(appDb, name, type, coords);
export const updatePlaceDetails = (id: Id, patch: { name?: string; type?: PlaceType }) => updatePlaceDetailsIn(appDb, id, patch);
export const setPlaceOil = (id: Id, level: OilLevel) => setPlaceOilIn(appDb, id, level);
export const setPlaceCoords = (id: Id, coords: LatLng | null) => setPlaceCoordsIn(appDb, id, coords);
export const setPlaceTypicalPrice = (id: Id, rm: number | null) => setPlaceTypicalPriceIn(appDb, id, rm);
export const addPlaceTray = (id: Id, catalogueId: string) => addPlaceTrayIn(appDb, id, catalogueId);
export const removePlaceTray = (id: Id, catalogueId: string) => removePlaceTrayIn(appDb, id, catalogueId);
export const changeLearnedDefault = (placeId: Id, key: string, variantIndex: number) => changeLearnedDefaultIn(appDb, placeId, key, variantIndex);
export const removeLearnedDefault = (placeId: Id, key: string) => removeLearnedDefaultIn(appDb, placeId, key);
export const deletePlace = (id: Id) => deletePlaceIn(appDb, id);
export const logPotServingHere = (potId: Id, placeId: Id, servings?: number) => logPotServingHereIn(appDb, potId, placeId, servings);
