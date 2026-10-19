/**
 * Reads and writes for the logging screens (S09 Log, S10 Estimating, S11 Review, S24 Plate)
 * that the shared actions don't cover: recent Places, a Place's usual orders, plate history,
 * repeated corrections, photos and "Also save as a Usual". Framework-free, database first,
 * built on the repository functions.
 */
import { newId, type KiraMakanDb } from '@/db/db';
import {
  deletePhoto,
  deleteUsual,
  findPlaceByName,
  getPlace,
  listMealsAtPlace,
  listPersonalItems,
  listPlaces,
  listRecentMeals,
  listUsualsAtPlace,
  putPhoto,
  putPlace,
  putUsual,
  updatePlace,
  updateProfile,
} from '@/db/repo';
import { byId, normaliseName } from '@/data/catalogue';
import { now } from '@/domain/clock';
import { mealMacros } from '@/domain/meal';
import type { Id, MealItem, MealLog, OilLevel, PersonalItem, Place, PlaceType, Usual } from '@/domain/types';

/** Log pre-selects the nearest saved Place within this distance (plan §9.4). */
export const NEARBY_METRES = 150;
/** How many recent meals decide which Places were used last. */
const RECENT_MEALS = 300;
/** Plate history looks at this many of the Place's latest plates. */
const PLATE_SAMPLE = 10;
/** A dish is "picked often" after this many plates in the sample… */
const OFTEN_MIN_PICKS = 3;
/** …and only the top few are marked. */
const OFTEN_MAX = 3;
/** A past order shows under "At <place>" once it has been eaten this many times. */
const ORDER_MIN_TIMES = 2;

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance in metres. */
export function distanceMetres(a: LatLng, b: LatLng): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The nearest Place with saved coordinates within `maxMetres` of `at`. */
export function nearestPlace(places: readonly Place[], at: LatLng, maxMetres: number = NEARBY_METRES): Place | undefined {
  let best: { place: Place; metres: number } | undefined;
  for (const place of places) {
    if (!place.coords) continue;
    const metres = distanceMetres(place.coords, at);
    if (metres <= maxMetres && (!best || metres < best.metres)) best = { place, metres };
  }
  return best?.place;
}

// ---------------------------------------------------------------------------
// Places
// ---------------------------------------------------------------------------

export interface RecentPlaces {
  /** Most recently eaten at first; Places never used follow, newest first. */
  places: Place[];
  /** The Place of the latest meal that had one. */
  mostRecentId?: Id;
}

export async function listPlacesByRecent(db: KiraMakanDb): Promise<RecentPlaces> {
  const [places, recent] = await Promise.all([listPlaces(db), listRecentMeals(db, RECENT_MEALS)]);
  const lastUsed = new Map<Id, string>();
  for (const meal of recent) {
    if (meal.placeId && !lastUsed.has(meal.placeId)) lastUsed.set(meal.placeId, meal.eatenAt);
  }
  const sorted = [...places].sort((a, b) => {
    const la = lastUsed.get(a.id);
    const lb = lastUsed.get(b.id);
    if (la && lb) return lb.localeCompare(la);
    if (la) return -1;
    if (lb) return 1;
    return b.createdAt.localeCompare(a.createdAt);
  });
  const mostRecent = sorted.find((p) => lastUsed.has(p.id));
  return mostRecent ? { places: sorted, mostRecentId: mostRecent.id } : { places: sorted };
}

/** A Place typed into "Where?": an existing one with that name, else a new one (with its spot, when known). */
export async function createPlace(db: KiraMakanDb, name: string, type: PlaceType, coords?: LatLng): Promise<Place> {
  const clean = name.trim().replace(/\s+/g, ' ');
  if (!clean) throw new RangeError('A Place needs a name');
  const existing = await findPlaceByName(db, clean);
  if (existing) return existing;
  const place: Place = { id: newId(), name: clean, type, defaultVariants: {}, createdAt: now().toISOString() };
  if (coords) place.coords = { lat: coords.lat, lng: coords.lng };
  await putPlace(db, place);
  return place;
}

/** A best guess at the kind of Place from its name ("Kedai…" stays 'other'; the user can change it later). */
export function guessPlaceType(name: string): PlaceType {
  const n = normaliseName(name);
  if (/^(home|rumah)$/.test(n)) return 'home';
  if (/mamak|nasi kandar/.test(n)) return 'mamak';
  if (/kopitiam/.test(n)) return 'kopitiam';
  if (/economy rice|nasi campur|chap fan/.test(n)) return 'economyRice';
  if (/hawker|medan selera|food court|gerai/.test(n)) return 'hawker';
  return 'other';
}

export async function setPlaceOilLevel(db: KiraMakanDb, placeId: Id, oilLevel: OilLevel): Promise<boolean> {
  return updatePlace(db, placeId, { oilLevel });
}

/** Turns location pre-select on or off (asked the first time Log opens). */
export async function setUseLocation(db: KiraMakanDb, enabled: boolean): Promise<boolean> {
  return updateProfile(db, { useLocation: enabled });
}

// ---------------------------------------------------------------------------
// Usual orders at a Place
// ---------------------------------------------------------------------------

/** A one-tap order: a saved Usual or a meal eaten at the Place again and again. */
export interface OrderOption {
  id: string;
  name: string;
  items: MealItem[];
  /** Times eaten (or used, for a Usual). */
  times: number;
  kcal: number;
  method: 'usual' | 'placeOrder';
  placeId?: Id;
  usualId?: Id;
}

function itemsKcal(items: MealItem[]): number {
  return mealMacros({ items, finished: 'all' }).kcal;
}

export function usualOption(usual: Usual): OrderOption {
  const option: OrderOption = {
    id: `usual:${usual.id}`,
    name: usual.name,
    items: usual.items,
    times: usual.useCount,
    kcal: itemsKcal(usual.items),
    method: 'usual',
    usualId: usual.id,
  };
  if (usual.placeId) option.placeId = usual.placeId;
  return option;
}

/**
 * What you usually have at a Place: its Usuals, then the meals you've eaten there at least
 * twice (most often first), each with its latest items.
 */
export async function listPlaceOrders(db: KiraMakanDb, placeId: Id, limit = 4): Promise<OrderOption[]> {
  const [usuals, meals] = await Promise.all([listUsualsAtPlace(db, placeId), listMealsAtPlace(db, placeId)]);
  const groups = new Map<string, { latest: MealLog; times: number }>();
  for (const meal of meals) {
    if (meal.isGuess) continue;
    const key = normaliseName(meal.name);
    if (!key) continue;
    const group = groups.get(key);
    // Meals come oldest first, so the last one seen is the latest.
    groups.set(key, { latest: meal, times: (group?.times ?? 0) + 1 });
  }

  const fromUsuals = usuals.map((usual) => {
    const option = usualOption(usual);
    const eaten = groups.get(normaliseName(usual.name))?.times ?? 0;
    return { ...option, times: Math.max(option.times, eaten) };
  });
  const usualNames = new Set(usuals.map((u) => normaliseName(u.name)));
  const fromHistory: OrderOption[] = [...groups.entries()]
    .filter(([key, g]) => !usualNames.has(key) && g.times >= ORDER_MIN_TIMES)
    .sort((a, b) => b[1].times - a[1].times || b[1].latest.eatenAt.localeCompare(a[1].latest.eatenAt))
    .map(([, g]) => ({
      id: `order:${g.latest.id}`,
      name: g.latest.name,
      items: g.latest.items,
      times: g.times,
      kcal: itemsKcal(g.latest.items),
      method: 'placeOrder' as const,
      placeId,
    }));
  return [...fromUsuals, ...fromHistory].slice(0, limit);
}

// ---------------------------------------------------------------------------
// Plate builder history
// ---------------------------------------------------------------------------

export interface PlateHistory {
  /** The latest plate built at this Place (the builder starts from it). */
  last?: MealLog;
  /** Catalogue ids of the dishes picked most often here. */
  often: string[];
  plates: number;
}

export async function getPlateHistory(db: KiraMakanDb, placeId: Id): Promise<PlateHistory> {
  const plates = (await listMealsAtPlace(db, placeId)).filter((m) => m.method === 'plate' && !m.isGuess).slice(-PLATE_SAMPLE);
  const picks = new Map<string, number>();
  for (const plate of plates) {
    const seen = new Set<string>();
    for (const item of plate.items) {
      if (!item.catalogueId || seen.has(item.catalogueId) || !byId(item.catalogueId)?.plateGroup) continue;
      seen.add(item.catalogueId);
      picks.set(item.catalogueId, (picks.get(item.catalogueId) ?? 0) + 1);
    }
  }
  const often = [...picks.entries()]
    .filter(([, n]) => n >= OFTEN_MIN_PICKS)
    .sort((a, b) => b[1] - a[1])
    .slice(0, OFTEN_MAX)
    .map(([id]) => id);
  const last = plates.at(-1);
  return last ? { last, often, plates: plates.length } : { often, plates: plates.length };
}

// ---------------------------------------------------------------------------
// Repeated corrections (C28)
// ---------------------------------------------------------------------------

export interface RepeatedCorrection {
  item: MealItem;
  placeId: Id;
  placeName: string;
  /** Times this exact correction has now been made here, this save included. */
  times: number;
}

/** A chip the user picked over what the estimate gave, and not the catalogue's default. */
function correctedVariant(item: MealItem): number | undefined {
  if (!item.catalogueId || item.selectedVariant === undefined) return undefined;
  const changed = item.edited === true || (item.original !== undefined && item.original.selectedVariant !== item.selectedVariant);
  if (!changed || item.original?.selectedVariant === item.selectedVariant) return undefined;
  const food = byId(item.catalogueId);
  if (food && food.defaultVariant === item.selectedVariant) return undefined;
  return item.selectedVariant;
}

/**
 * The first item in `meal` whose correction was already made at least once before at the same
 * Place (same catalogue item, same non-default chip), unless the Place already uses it.
 */
export async function findRepeatedCorrection(db: KiraMakanDb, meal: MealLog): Promise<RepeatedCorrection | undefined> {
  if (!meal.placeId) return undefined;
  const corrected = meal.items.flatMap((item) => {
    const variant = correctedVariant(item);
    return variant === undefined ? [] : [{ item, variant }];
  });
  if (corrected.length === 0) return undefined;
  const [place, history, personal] = await Promise.all([getPlace(db, meal.placeId), listMealsAtPlace(db, meal.placeId), listPersonalItems(db)]);
  if (!place) return undefined;

  const learned = (catalogueId: string, variant: number): boolean =>
    place.defaultVariants[catalogueId] === variant ||
    personal.some(
      (p: PersonalItem) => p.catalogueId === catalogueId && p.scope === 'place' && p.placeId === place.id && p.selectedVariant === variant,
    );

  for (const { item, variant } of corrected) {
    const catalogueId = item.catalogueId ?? '';
    if (learned(catalogueId, variant)) continue;
    const before = history.filter(
      (m) => m.id !== meal.id && m.items.some((i) => i.catalogueId === catalogueId && correctedVariant(i) === variant),
    ).length;
    if (before >= 1) return { item, placeId: place.id, placeName: place.name, times: before + 1 };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Usuals and photos
// ---------------------------------------------------------------------------

export interface SavedUsual {
  usual: Usual;
  undo: () => Promise<void>;
}

/** "Also save as a Usual": the meal's items as a one-tap meal (counted as used once). */
export async function saveUsualFromMeal(db: KiraMakanDb, meal: MealLog): Promise<SavedUsual> {
  const usual: Usual = {
    id: newId(),
    name: meal.name,
    slot: meal.slot,
    items: meal.items.map((item) => {
      const { original: _original, edited: _edited, question: _question, pendingEstimate: _pending, ...rest } = item;
      return { ...rest, id: newId() };
    }),
    useCount: 1,
    createdAt: now().toISOString(),
  };
  if (meal.placeId) usual.placeId = meal.placeId;
  await putUsual(db, usual);
  return { usual, undo: () => deleteUsual(db, usual.id) };
}

export async function storePhoto(db: KiraMakanDb, blob: Blob, thumb: Blob): Promise<Id> {
  const id = newId();
  await putPhoto(db, { id, blob, thumb, createdAt: now().toISOString() });
  return id;
}

/** A photo that never made it into a saved meal (the flow was cancelled). */
export async function discardPhoto(db: KiraMakanDb, id: Id): Promise<void> {
  const used = await db.meals.filter((m) => m.photoId === id).count();
  if (used === 0) await deletePhoto(db, id);
}

/** What the estimator needs: the Place and every saved correction. */
export async function loadEstimateContext(db: KiraMakanDb, placeId?: Id): Promise<{ place?: Place; personal: PersonalItem[] }> {
  const [place, personal] = await Promise.all([placeId ? getPlace(db, placeId) : Promise.resolve(undefined), listPersonalItems(db)]);
  return place ? { place, personal } : { personal };
}
