/**
 * User intents. Each one is a Dexie transaction; the ones a toast can take back return an
 * `undo()` that restores exactly what was there before (optimistic undo: the change happens
 * now, undo reverses it).
 *
 * `createActions(db)` binds them to a database (tests use a throwaway one); the named exports
 * are bound to the app's database.
 */
import { clearAllTables, db as appDb, newId, type KiraMakanDb, type PhotoRecord } from '@/db/db';
import {
  findPlaceByName,
  getDayRecord,
  getMeal,
  getPhoto,
  getPlace,
  getPot,
  latestWeight,
  listMealsAtPlace,
  listMealsForDay,
  listPersonalItems,
  listUsuals,
  putDayRecord,
  putPersonalItem,
  putPlace,
  recordUsualUse,
  setDayStatus,
  setPlaceDefaultVariant,
  setSleepAt,
  takePotServings,
  updatePlace,
  upsertWeekPlan,
} from '@/db/repo';
import { buildStarterGoals } from '@/db/seed/defaults';
import { loadDemo, type DemoWorld } from '@/db/seed/demo';
import { byId, normaliseName } from '@/data/catalogue';
import { isDemoClock, now, setDemoClock } from '@/domain/clock';
import { compareDays, logicalDayOf, weekStartOf } from '@/domain/day';
import { itemFromCatalogue, scaleMacros, sumMacros } from '@/domain/meal';
import { dailyTargetFor, defaultMacroTargets, startingMaintenance } from '@/domain/targets';
import { clipText } from '@/domain/text';
import { suggestSlot } from '@/domain/timing';
import { netWorkoutKcal } from '@/domain/workout';
import type {
  ActivityLevel,
  DayRecord,
  DayStatusKind,
  Goal,
  GoalPeriod,
  GoalVersion,
  Id,
  Instant,
  Intensity,
  LogicalDay,
  MealItem,
  MealLog,
  MealSlot,
  OneOffBonus,
  PersonalItem,
  Place,
  PlaceType,
  Pot,
  Profile,
  Sex,
  SourceTag,
  Usual,
  WeekPlan,
  WeightLog,
  Workout,
  WorkoutType,
} from '@/domain/types';
import type { ReviewDraft } from '@/state/ui';
import { getTypicalGuess, loadSettings, todayFor, type CheckInChoice, type CheckInGuess, type Settings } from './selectors';

export type { CheckInChoice, CheckInGuess } from './selectors';

export type Undo = () => Promise<void>;

const NO_UNDO: Undo = async () => {};

/** A typical portion is a rough guess; a pot serving is known from its ingredients. */
const GUESS_UNCERTAINTY = 0.35;
const POT_UNCERTAINTY = 0.15;
/** Typical price at a Place = median of its last few priced meals. */
const PRICE_SAMPLE = 10;
const MIN_WEIGHT_KG = 20;
const MAX_WEIGHT_KG = 400;

function stampNow(): Instant {
  return now().toISOString();
}

function dayOf(at: Instant, settings: Settings): LogicalDay {
  return logicalDayOf(at, settings.tz, settings.rolloverHour);
}

/** Drops keys whose value is undefined, so a patch can clear an optional field. */
function withoutUndefined<T extends object>(row: T): T {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined)) as T;
}

/** An edit to a synced row has to go up again; local rows stay local until the first sync. */
function touchedSyncState(state: MealLog['syncState']): MealLog['syncState'] {
  return state === 'synced' ? 'pending' : state;
}

// ---------------------------------------------------------------------------
// Meals
// ---------------------------------------------------------------------------

/** Every saved item keeps the estimate it started from (S14 "Original estimate ~820 · edited by you"). */
function withOriginal(item: MealItem): MealItem {
  if (item.original) return item;
  const original: NonNullable<MealItem['original']> = { quantity: item.quantity, unitMacros: { ...item.unitMacros } };
  if (item.selectedVariant !== undefined) original.selectedVariant = item.selectedVariant;
  return { ...item, original };
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** "Roti canai + teh tarik"; "Rice, ayam masak kicap, sayur + 2 more". */
export function defaultMealName(items: Pick<MealItem, 'name'>[]): string {
  const names = items.map((i) => i.name.trim()).filter((n) => n.length > 0);
  const [first, ...rest] = names;
  if (!first) return 'Meal';
  const tail = rest.map(lowerFirst);
  if (tail.length === 0) return first;
  if (tail.length === 1) return `${first} + ${tail[0] ?? ''}`;
  const shown = [first, ...tail.slice(0, 2)].join(', ');
  return tail.length > 2 ? `${shown} + ${tail.length - 2} more` : shown;
}

const TEXT_PARTS = /[,+;\n|]/;

/**
 * A ledger name from what the user typed: the first part, the way they'd say it
 * ("nasi kandar ayam goreng, kubis, kuah campur" → "Nasi kandar ayam goreng").
 */
export function mealNameFromText(text: string | undefined): string | undefined {
  const first = text?.split(TEXT_PARTS)[0]?.replace(/\s+/g, ' ').trim();
  if (!first) return undefined;
  const capped = clipText(first, 48, '…');
  return capped.charAt(0).toUpperCase() + capped.slice(1);
}

function guessPlaceType(name: string, method: MealLog['method']): PlaceType {
  if (method === 'plate') return 'economyRice';
  const n = normaliseName(name);
  if (/^(home|rumah)$/.test(n)) return 'home';
  if (/mamak|nasi kandar/.test(n)) return 'mamak';
  if (/kopitiam/.test(n)) return 'kopitiam';
  if (/economy rice|nasi campur|chap fan/.test(n)) return 'economyRice';
  if (/hawker|medan selera|food court|gerai/.test(n)) return 'hawker';
  return 'other';
}

/** A Place is created the first time a name is typed into "Where?" (plan §9.4). */
async function ensurePlace(
  db: KiraMakanDb,
  name: string,
  method: MealLog['method'],
  stamp: Instant,
): Promise<{ place: Place; created: boolean }> {
  const existing = await findPlaceByName(db, name);
  if (existing) return { place: existing, created: false };
  const place: Place = {
    id: newId(),
    name: name.trim().replace(/\s+/g, ' '),
    type: guessPlaceType(name, method),
    defaultVariants: {},
    createdAt: stamp,
  };
  await putPlace(db, place);
  return { place, created: true };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid] ?? 0;
  return sorted.length % 2 === 1 ? upper : ((sorted[mid - 1] ?? upper) + upper) / 2;
}

/** The rows a save taught something to, as they were before (so the save's undo can put them back). */
interface LearnedFrom {
  usual?: Usual;
  place?: Place;
}

/** Usual use counts, the Place's typical price and its economy-rice trays. Runs after the meal is stored. */
async function learnFromMeal(db: KiraMakanDb, meal: MealLog): Promise<LearnedFrom> {
  const before: LearnedFrom = {};
  if (meal.method === 'usual' || meal.method === 'placeOrder') {
    const wanted = normaliseName(meal.name);
    const usual = (await listUsuals(db)).find(
      (u) => normaliseName(u.name) === wanted && (u.placeId === undefined || u.placeId === meal.placeId),
    );
    if (usual) {
      before.usual = usual;
      await recordUsualUse(db, usual.id);
    }
  }

  if (!meal.placeId) return before;
  const place = await getPlace(db, meal.placeId);
  if (!place) return before;
  const patch: Partial<Place> = {};
  if (meal.priceRm !== undefined) {
    const prices = (await listMealsAtPlace(db, place.id))
      .filter((m) => m.priceRm !== undefined && !m.isGuess)
      .slice(-PRICE_SAMPLE)
      .map((m) => m.priceRm ?? 0);
    if (prices.length > 0) patch.typicalPriceRm = Math.round(median(prices) * 10) / 10;
  }
  if (meal.method === 'plate') {
    const trays = new Set(place.trays ?? []);
    for (const item of meal.items) {
      if (item.catalogueId && byId(item.catalogueId)?.plateGroup) trays.add(item.catalogueId);
    }
    if (trays.size !== (place.trays?.length ?? 0)) patch.trays = [...trays];
  }
  if (Object.keys(patch).length > 0) {
    before.place = place;
    await updatePlace(db, place.id, patch);
  }
  return before;
}

export type MealPatch = Partial<
  Pick<MealLog, 'eatenAt' | 'slot' | 'name' | 'items' | 'method' | 'placeId' | 'priceRm' | 'photoId' | 'text' | 'finished' | 'isGuess'>
>;

async function updateMealIn(db: KiraMakanDb, id: Id, patch: MealPatch): Promise<MealLog | undefined> {
  const settings = await loadSettings(db);
  return db.transaction('rw', db.meals, async () => {
    const meal = await getMeal(db, id);
    if (!meal) return undefined;
    const next: MealLog = withoutUndefined({
      ...meal,
      ...patch,
      items: patch.items ? patch.items.map(withOriginal) : meal.items,
      updatedAt: stampNow(),
      syncState: touchedSyncState(meal.syncState),
    });
    if (patch.eatenAt) next.logicalDay = dayOf(patch.eatenAt, settings);
    if (next.items.length === 0) throw new RangeError('A meal needs at least one item');
    await db.meals.put(next);
    return next;
  });
}

export interface SavedMeal {
  meal: MealLog;
  /**
   * Takes the save back ("Saved · ~560 kcal · Undo"). A new meal is removed with what it
   * taught (Usual count, Place price and trays, a Place it created); an edit gets its previous
   * version back.
   */
  undo: Undo;
}

/**
 * Saves the review draft (S11) as a meal, or updates the meal being edited (S14).
 *
 * In edit mode the draft only changes what it carries: a field it leaves out keeps the stored
 * meal's value, so an edit of the items never moves a meal to today or drops its Place.
 * Place, price and photo are cleared by naming the key with no value (`{ priceRm: undefined }`).
 */
async function saveMealIn(db: KiraMakanDb, draft: ReviewDraft): Promise<SavedMeal> {
  if (draft.items.length === 0) throw new RangeError('A meal needs at least one item');
  const { meta } = draft;
  const settings = await loadSettings(db);
  const stamp = stampNow();
  const items = draft.items.map(withOriginal);

  return db.transaction('rw', [db.meals, db.places, db.usuals], async () => {
    let createdPlaceId: Id | undefined;
    const draftPlaceId = async (): Promise<Id | undefined> => {
      if (meta.placeId) return meta.placeId;
      if (!meta.placeName?.trim()) return undefined;
      const { place, created } = await ensurePlace(db, meta.placeName, meta.method, stamp);
      if (created) createdPlaceId = place.id;
      return place.id;
    };
    const removeCreatedPlace = async (): Promise<void> => {
      if (createdPlaceId) await db.places.delete(createdPlaceId);
    };

    const editing = meta.editingMealId ? await getMeal(db, meta.editingMealId) : undefined;
    if (editing) {
      const placeChosen = 'placeId' in meta || 'placeName' in meta;
      const updated: MealLog = withoutUndefined({
        ...editing,
        eatenAt: meta.eatenAt ?? editing.eatenAt,
        logicalDay: meta.eatenAt ? dayOf(meta.eatenAt, settings) : editing.logicalDay,
        slot: meta.slot ?? editing.slot,
        name: meta.name?.trim() || editing.name,
        items,
        // Saving an edited "typical one" makes it a real entry: timed, in your history, and kept by a later check-in.
        method: meta.method === 'guess' ? 'manual' : meta.method,
        isGuess: undefined,
        placeId: placeChosen ? await draftPlaceId() : editing.placeId,
        priceRm: 'priceRm' in meta ? meta.priceRm : editing.priceRm,
        photoId: 'photoId' in meta ? meta.photoId : editing.photoId,
        text: meta.text?.trim() || editing.text,
        finished: meta.finished ?? editing.finished,
        updatedAt: stamp,
        syncState: touchedSyncState(editing.syncState),
      });
      await db.meals.put(updated);
      const undo: Undo = async () => {
        await db.transaction('rw', [db.meals, db.places], async () => {
          await db.meals.put(editing);
          await removeCreatedPlace();
        });
      };
      return { meal: updated, undo };
    }

    const eatenAt = meta.eatenAt ?? stamp;
    const meal: MealLog = withoutUndefined({
      // An edit of a meal that was deleted meanwhile (on another device) saves it again under its own id.
      id: meta.editingMealId ?? newId(),
      eatenAt,
      logicalDay: dayOf(eatenAt, settings),
      slot: meta.slot ?? suggestSlot(eatenAt, settings.tz, settings.rolloverHour),
      name:
        meta.name?.trim() ||
        // A listed meal is named by its first part (the main dish); a single phrase that was added
        // to on the review screen is better named from its items.
        ((meta.method === 'text' || meta.method === 'photo') && meta.text && TEXT_PARTS.test(meta.text)
          ? mealNameFromText(meta.text)
          : undefined) ||
        defaultMealName(items),
      items,
      method: meta.method,
      placeId: await draftPlaceId(),
      priceRm: meta.priceRm,
      photoId: meta.photoId,
      text: meta.text?.trim() || undefined,
      finished: meta.finished ?? 'all',
      createdAt: stamp,
      updatedAt: stamp,
      syncState: 'local' as const,
    });
    await db.meals.put(meal);
    const learned = await learnFromMeal(db, meal);
    const undo: Undo = async () => {
      await db.transaction('rw', [db.meals, db.places, db.usuals], async () => {
        await db.meals.delete(meal.id);
        if (learned.usual) await db.usuals.put(learned.usual);
        if (learned.place) await db.places.put(learned.place);
        await removeCreatedPlace();
      });
    };
    return { meal, undo };
  });
}

/**
 * Takes up to `servings` out of a pot that's still in the fridge on `day` (cooked, not cleared,
 * not finished). Returns how many it took: 0 when the pot is gone, cleared or empty.
 * Call inside a transaction that includes `db.pots`.
 */
async function takeFromPot(db: KiraMakanDb, potId: Id, servings: number, day: LogicalDay): Promise<number> {
  const before = await getPot(db, potId);
  if (!before || before.servingsLeft <= 0) return 0;
  if (compareDays(before.cookedOn, day) > 0 || compareDays(before.expiresOn, day) < 0) return 0;
  const after = await takePotServings(db, potId, servings);
  return after ? before.servingsLeft - after.servingsLeft : 0;
}

/**
 * Puts a pot meal's servings back in its pot (never above the pot's total). Returns how many
 * went back: 0 for meals not from a pot, or when the pot was deleted.
 * Call inside a transaction that includes `db.pots`.
 */
async function returnToPot(db: KiraMakanDb, meal: MealLog): Promise<number> {
  if (!meal.fromPot || meal.fromPot.servings <= 0) return 0;
  const before = await getPot(db, meal.fromPot.potId);
  if (!before) return 0;
  const after = await takePotServings(db, meal.fromPot.potId, -meal.fromPot.servings);
  return after ? after.servingsLeft - before.servingsLeft : 0;
}

/**
 * Deletes a meal (and its photo). A pot serving goes back into its pot. The undo puts all of
 * it back as it was.
 */
async function deleteMealIn(db: KiraMakanDb, id: Id): Promise<Undo> {
  const removed = await db.transaction('rw', [db.meals, db.photos, db.pots], async () => {
    const meal = await getMeal(db, id);
    if (!meal) return undefined;
    const photo: PhotoRecord | undefined = meal.photoId ? await getPhoto(db, meal.photoId) : undefined;
    await db.meals.delete(id);
    if (photo) await db.photos.delete(photo.id);
    const returned = await returnToPot(db, meal);
    return { meal, photo, returned };
  });
  if (!removed) return NO_UNDO;
  return async () => {
    await db.transaction('rw', [db.meals, db.photos, db.pots], async () => {
      await db.meals.put(removed.meal);
      if (removed.photo) await db.photos.put(removed.photo);
      const pot = removed.meal.fromPot;
      if (pot && removed.returned > 0) await takePotServings(db, pot.potId, removed.returned);
    });
  };
}

/**
 * Logs the same meal again, now (or at `at`). The copy gets new ids, a fresh slot and no
 * photo. A copied "typical one" is a meal you logged yourself, so it's no longer a guess.
 * A pot serving takes the same servings out of its pot again while the pot is still in the
 * fridge (as many as are left); otherwise the copy is a plain meal with no pot link.
 */
async function duplicateMealIn(db: KiraMakanDb, id: Id, at?: Instant): Promise<MealLog | undefined> {
  const settings = await loadSettings(db);
  return db.transaction('rw', [db.meals, db.pots], async () => {
    const source = await getMeal(db, id);
    if (!source) return undefined;
    const stamp = stampNow();
    const eatenAt = at ?? stamp;
    const { photoId: _photo, isGuess: _guess, fromPot, ...rest } = source;
    const copy: MealLog = {
      ...rest,
      method: source.method === 'guess' ? 'manual' : source.method,
      id: newId(),
      eatenAt,
      logicalDay: dayOf(eatenAt, settings),
      slot: suggestSlot(eatenAt, settings.tz, settings.rolloverHour),
      items: source.items.map((item) => ({ ...item, id: newId() })),
      createdAt: stamp,
      updatedAt: stamp,
      syncState: 'local',
    };
    if (fromPot) {
      const taken = await takeFromPot(db, fromPot.potId, fromPot.servings, copy.logicalDay);
      if (taken > 0) copy.fromPot = { potId: fromPot.potId, servings: taken };
    }
    await db.meals.put(copy);
    return copy;
  });
}

// ---------------------------------------------------------------------------
// Days: check-in and sleep taps
// ---------------------------------------------------------------------------

export interface ConfirmDayResult {
  record?: DayRecord;
  /** The guess entry "Fill in a typical one" added. */
  guess?: MealLog;
  undo: Undo;
}

const CHOICE_STATUS: Record<Exclude<CheckInChoice, 'addMore'>, DayStatusKind> = {
  complete: 'complete',
  fillTypical: 'guess',
  notCounted: 'notCounted',
};

function guessMeal(day: LogicalDay, guess: CheckInGuess, stamp: Instant): MealLog {
  return {
    id: newId(),
    eatenAt: guess.eatenAt,
    logicalDay: day,
    slot: guess.slot,
    name: guess.name,
    items: [
      withOriginal({
        id: newId(),
        name: guess.name,
        unitMacros: { ...guess.macros },
        quantity: 1,
        uncertainty: GUESS_UNCERTAINTY,
        // CONTRACT: SourceTag has no "your typical" value; aiGuess reads as an estimate.
        source: 'aiGuess',
      }),
    ],
    method: 'guess',
    finished: 'all',
    isGuess: true,
    createdAt: stamp,
    updatedAt: stamp,
    syncState: 'local',
  };
}

/**
 * Answers the morning check-in for `day`. Any earlier guess for the day is replaced, so
 * answering twice never stacks guesses. "Let me add it" changes nothing: the day stays
 * unconfirmed until the light check-in ("All there?") is answered after logging.
 */
async function confirmDayIn(db: KiraMakanDb, day: LogicalDay, choice: CheckInChoice, guess?: CheckInGuess): Promise<ConfirmDayResult> {
  if (choice === 'addMore') {
    const record = await getDayRecord(db, day);
    return record ? { record, undo: NO_UNDO } : { undo: NO_UNDO };
  }
  const typical = choice === 'fillTypical' ? (guess ?? (await getTypicalGuess(db, day))) : undefined;
  if (choice === 'fillTypical' && !typical) throw new RangeError(`No typical meal to fill in for ${day}`);
  const stamp = stampNow();

  const result = await db.transaction('rw', [db.days, db.meals], async () => {
    const previousRecord = await getDayRecord(db, day);
    const previousGuesses = (await listMealsForDay(db, day)).filter((m) => m.isGuess);
    await db.meals.bulkDelete(previousGuesses.map((m) => m.id));
    const added = typical ? guessMeal(day, typical, stamp) : undefined;
    if (added) await db.meals.put(added);
    const record = await setDayStatus(db, day, CHOICE_STATUS[choice], stamp);
    return { previousRecord, previousGuesses, added, record };
  });

  const undo: Undo = async () => {
    await db.transaction('rw', [db.days, db.meals], async () => {
      if (result.added) await db.meals.delete(result.added.id);
      await db.meals.bulkPut(result.previousGuesses);
      if (result.previousRecord) await putDayRecord(db, result.previousRecord);
      else await db.days.delete(day);
    });
  };
  return result.added ? { record: result.record, guess: result.added, undo } : { record: result.record, undo };
}

// ---------------------------------------------------------------------------
// Weight, workouts, bonuses
// ---------------------------------------------------------------------------

async function addWeightIn(db: KiraMakanDb, kg: number, at?: Instant): Promise<WeightLog> {
  if (!Number.isFinite(kg) || kg < MIN_WEIGHT_KG || kg > MAX_WEIGHT_KG) throw new RangeError(`Weight out of range: ${kg}`);
  const settings = await loadSettings(db);
  const measuredAt = at ?? stampNow();
  const weight: WeightLog = { id: newId(), measuredAt, logicalDay: dayOf(measuredAt, settings), kg: Math.round(kg * 100) / 100 };
  await db.weights.put(weight);
  return weight;
}

/** Net workout kcal from the MET table and the latest weigh-in (else the setup weight). */
async function addWorkoutIn(
  db: KiraMakanDb,
  type: WorkoutType,
  intensity: Intensity,
  minutes: number,
  day?: LogicalDay,
): Promise<Workout> {
  if (!Number.isFinite(minutes) || minutes <= 0) throw new RangeError(`Workout minutes must be positive: ${minutes}`);
  const settings = await loadSettings(db);
  const weightKg = (await latestWeight(db))?.kg ?? settings.profile?.weightKgAtSetup;
  if (weightKg === undefined) throw new Error('Add a weight before logging a workout');
  const workout: Workout = {
    id: newId(),
    logicalDay: day ?? todayFor(settings.profile),
    type,
    minutes: Math.round(minutes),
    intensity,
    netKcal: netWorkoutKcal(type, intensity, minutes, weightKg),
    createdAt: stampNow(),
  };
  await db.workouts.put(workout);
  return workout;
}

async function addBonusIn(db: KiraMakanDb, kcal: number, reason: string, day?: LogicalDay): Promise<OneOffBonus> {
  if (!Number.isFinite(kcal) || kcal <= 0) throw new RangeError(`Bonus kcal must be positive: ${kcal}`);
  const settings = await loadSettings(db);
  const bonus: OneOffBonus = {
    id: newId(),
    logicalDay: day ?? todayFor(settings.profile),
    kcal: Math.round(kcal),
    reason: reason.trim(),
    createdAt: stampNow(),
  };
  await db.bonuses.put(bonus);
  return bonus;
}

type RemovableTable = 'weights' | 'workouts' | 'bonuses';

/** Deletes one weight, workout or bonus; the undo puts it back. */
async function removeRow(db: KiraMakanDb, tableName: RemovableTable, id: Id): Promise<Undo> {
  const table = db.table<WeightLog | Workout | OneOffBonus, Id>(tableName);
  const row = await db.transaction('rw', table, async () => {
    const existing = await table.get(id);
    if (existing) await table.delete(id);
    return existing;
  });
  if (!row) return NO_UNDO;
  return async () => {
    await table.put(row);
  };
}

// ---------------------------------------------------------------------------
// Week planning
// ---------------------------------------------------------------------------

/** Sets (or clears, with null) the day this week's savings go to: today or a day still ahead. */
async function planMakanDayIn(db: KiraMakanDb, weekStart: LogicalDay, day: LogicalDay | null): Promise<WeekPlan> {
  const monday = weekStartOf(weekStart);
  if (day !== null) {
    if (weekStartOf(day) !== monday) throw new RangeError(`${day} is not in the week of ${monday}`);
    const today = todayFor((await loadSettings(db)).profile);
    if (compareDays(day, today) < 0) throw new RangeError(`${day} has already finished`);
  }
  return upsertWeekPlan(db, monday, { makanDay: day });
}

async function setWeeklyFocusIn(
  db: KiraMakanDb,
  weekStart: LogicalDay,
  focus: NonNullable<WeekPlan['focus']> | null,
): Promise<WeekPlan> {
  return upsertWeekPlan(db, weekStartOf(weekStart), { focus });
}

// ---------------------------------------------------------------------------
// Pots and corrections
// ---------------------------------------------------------------------------

export interface PotServingResult {
  meal: MealLog;
  pot: Pot;
  undo: Undo;
}

/** The source of the ingredient that brings the most kcal (a pot of kari ayam is mostly ayam). */
function dominantSource(pot: Pot): SourceTag {
  const top = [...pot.ingredients].sort((a, b) => b.macros.kcal - a.macros.kcal)[0];
  return top?.source ?? 'catalogue';
}

/** Takes servings (½ allowed) out of a pot and logs them as a meal. */
async function logPotServingIn(
  db: KiraMakanDb,
  potId: Id,
  servings: number,
  opts: { eatenAt?: Instant; slot?: MealSlot; placeId?: Id } = {},
): Promise<PotServingResult> {
  if (!Number.isFinite(servings) || servings <= 0) throw new RangeError(`Servings must be positive: ${servings}`);
  const settings = await loadSettings(db);
  const stamp = stampNow();
  const eatenAt = opts.eatenAt ?? stamp;

  const eatenDay = dayOf(eatenAt, settings);

  const { meal, pot } = await db.transaction('rw', [db.pots, db.meals], async () => {
    const before = await getPot(db, potId);
    if (!before || before.servings <= 0) throw new Error(`Pot not found: ${potId}`);
    // A pot can't give more than it has, and it clears itself after its last day (plan §9.7).
    if (before.servingsLeft <= 0) throw new RangeError('This pot is empty.');
    if (compareDays(eatenDay, before.expiresOn) > 0) throw new RangeError('This pot has cleared.');
    const requested = Math.min(servings, before.servingsLeft);
    const after = (await takePotServings(db, potId, requested)) ?? before;
    const taken = before.servingsLeft - after.servingsLeft;
    const perServing = scaleMacros(sumMacros(before.ingredients.map((i) => i.macros)), 1 / before.servings);
    const logged: MealLog = withoutUndefined({
      id: newId(),
      eatenAt,
      logicalDay: eatenDay,
      slot: opts.slot ?? suggestSlot(eatenAt, settings.tz, settings.rolloverHour),
      name: before.name,
      items: [
        withOriginal({
          id: newId(),
          name: before.name,
          unitMacros: perServing,
          // What the pot actually gave, so the calories and the pot always agree.
          quantity: taken,
          uncertainty: POT_UNCERTAINTY,
          source: dominantSource(before),
        }),
      ],
      method: 'pot' as const,
      placeId: opts.placeId,
      finished: 'all' as const,
      // The link lets a delete from the diary put the servings back, and Duplicate take more.
      fromPot: taken > 0 ? { potId, servings: taken } : undefined,
      createdAt: stamp,
      updatedAt: stamp,
      syncState: 'local' as const,
    });
    await db.meals.put(logged);
    return { meal: logged, pot: after };
  });

  const undo: Undo = async () => {
    await db.transaction('rw', [db.pots, db.meals], async () => {
      // Already deleted (from the diary, which put the servings back): nothing more to return.
      const current = await getMeal(db, meal.id);
      if (!current) return;
      await db.meals.delete(meal.id);
      await returnToPot(db, current);
    });
  };
  return { meal, pot, undo };
}

/**
 * Saves a correction as layer-1 food data (C28 "Make this the default here?"). Scope 'place'
 * also teaches the Place its default portion for that catalogue item.
 */
async function rememberCorrectionIn(
  db: KiraMakanDb,
  item: MealItem,
  placeId: Id | undefined,
  scope: PersonalItem['scope'],
): Promise<PersonalItem> {
  if (scope === 'place' && !placeId) throw new RangeError('A Place correction needs a Place');
  const stamp = stampNow();
  return db.transaction('rw', [db.personalItems, db.places], async () => {
    const sameTarget = (p: PersonalItem): boolean =>
      p.scope === scope &&
      (scope === 'dish' || p.placeId === placeId) &&
      (item.catalogueId ? p.catalogueId === item.catalogueId : !p.catalogueId && normaliseName(p.name) === normaliseName(item.name));
    const existing = (await listPersonalItems(db)).find(sameTarget);

    const personal: PersonalItem = withoutUndefined({
      id: existing?.id ?? newId(),
      name: item.name,
      catalogueId: item.catalogueId,
      scope,
      placeId: scope === 'place' ? placeId : undefined,
      variants: item.variants?.map((v) => ({ ...v, macros: { ...v.macros } })),
      selectedVariant: item.selectedVariant,
      unitMacros: { ...item.unitMacros },
      uncertainty: item.uncertainty,
      corrections: (existing?.corrections ?? 0) + 1,
      createdAt: existing?.createdAt ?? stamp,
      updatedAt: stamp,
    });
    await putPersonalItem(db, personal);
    if (scope === 'place' && placeId && item.catalogueId && item.selectedVariant !== undefined) {
      await setPlaceDefaultVariant(db, placeId, item.catalogueId, item.selectedVariant);
    }
    return personal;
  });
}

// ---------------------------------------------------------------------------
// Setup, demo and reset
// ---------------------------------------------------------------------------

export interface SetupInput {
  age: number;
  sex: Sex;
  heightCm: number;
  weightKg: number;
  activity: ActivityLevel;
  paceKgPerWeek: number;
  dailyMinimumKcal: number;
  /** Catalogue ids that become Usuals (S05). */
  regulars: string[];
  places: { name: string; type: PlaceType }[];
  rolloverHour: number;
  timeZone: string;
}

export interface SetupResult {
  profile: Profile;
  goal: Goal;
  version: GoalVersion;
  period: GoalPeriod;
}

function assertSetupInput(input: SetupInput): void {
  const positive: [string, number][] = [
    ['age', input.age],
    ['heightCm', input.heightCm],
    ['weightKg', input.weightKg],
    ['dailyMinimumKcal', input.dailyMinimumKcal],
  ];
  for (const [field, value] of positive) {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError(`Setup: ${field} must be a positive number`);
  }
  if (!Number.isFinite(input.paceKgPerWeek)) throw new RangeError('Setup: pace must be a number');
  if (!Number.isInteger(input.rolloverHour) || input.rolloverHour < 0 || input.rolloverHour > 23) {
    throw new RangeError('Setup: rollover hour must be 0–23');
  }
}

/**
 * Creates the profile, the goal library (Cut active), the first Cut version and its period
 * from today, the setup weigh-in, Usuals from the regulars and the main Places. Demo data is
 * cleared first. Running it again after a real setup changes nothing and returns what's there.
 */
async function completeSetupIn(db: KiraMakanDb, input: SetupInput): Promise<SetupResult> {
  assertSetupInput(input);
  // Real use starts on the real today, not on the demo Friday.
  const wasDemo = isDemoClock();
  setDemoClock(false);
  try {
    return await writeSetup(db, input);
  } catch (error) {
    setDemoClock(wasDemo);
    throw error;
  }
}

async function writeSetup(db: KiraMakanDb, input: SetupInput): Promise<SetupResult> {
  const at = now();
  const stamp = at.toISOString();
  const today = logicalDayOf(at, input.timeZone, input.rolloverHour);

  return db.transaction('rw', db.tables, async () => {
    const current = await db.profile.get('me');
    if (current?.setupCompletedAt && !current.demoMode) {
      // Never wipe a real diary: a second tap on Done just returns the first setup.
      const existing = await existingSetup(db, current);
      if (existing) return existing;
      throw new Error('Setup is already done but has no active goal');
    }
    await Promise.all(db.tables.map((table) => table.clear()));

    const profile: Profile = {
      id: 'me',
      age: Math.round(input.age),
      sex: input.sex,
      heightCm: input.heightCm,
      weightKgAtSetup: input.weightKg,
      activity: input.activity,
      timeZone: input.timeZone,
      rolloverHour: input.rolloverHour,
      weekStartsOn: 1,
      dailyMinimumKcal: Math.round(input.dailyMinimumKcal),
      theme: 'system',
      keepPhotos: true,
      // Location is asked for the first time Log opens (plan §16.1).
      useLocation: false,
      startedOn: today,
      setupCompletedAt: stamp,
      demoMode: false,
    };

    const goals = buildStarterGoals('cut', stamp, () => newId());
    const cut = goals.find((g) => g.template === 'cut');
    if (!cut) throw new Error('Starter goals have no Cut');
    cut.paceKgPerWeek = input.paceKgPerWeek;

    const maintenanceKcal = startingMaintenance({
      sex: input.sex,
      weightKg: input.weightKg,
      heightCm: input.heightCm,
      age: input.age,
      activity: input.activity,
    });
    const dailyKcal = dailyTargetFor(cut, maintenanceKcal, profile.dailyMinimumKcal);
    const version: GoalVersion = {
      id: newId(),
      goalId: cut.id,
      effectiveFrom: today,
      dailyKcal,
      ...defaultMacroTargets(dailyKcal, input.weightKg, 'cut'),
      maintenanceKcal,
      reason: 'setup',
      createdAt: stamp,
    };
    const period: GoalPeriod = { id: newId(), goalId: cut.id, from: today };

    const usuals: Usual[] = [...new Set(input.regulars)].flatMap((catalogueId) => {
      const food = byId(catalogueId);
      if (!food) return [];
      return [{ id: newId(), name: food.name, items: [withOriginal(itemFromCatalogue(food))], useCount: 0, createdAt: stamp }];
    });

    const seen = new Set<string>();
    const places: Place[] = input.places.flatMap(({ name, type }) => {
      const clean = name.trim().replace(/\s+/g, ' ');
      const key = normaliseName(clean);
      if (!key || seen.has(key)) return [];
      seen.add(key);
      return [{ id: newId(), name: clean, type, defaultVariants: {}, createdAt: stamp }];
    });

    await db.profile.put(profile);
    await db.goals.bulkPut(goals);
    await db.goalVersions.put(version);
    await db.goalPeriods.put(period);
    await db.weights.put({ id: newId(), measuredAt: stamp, logicalDay: today, kg: input.weightKg });
    await db.usuals.bulkPut(usuals);
    await db.places.bulkPut(places);
    return { profile, goal: cut, version, period };
  });
}

async function existingSetup(db: KiraMakanDb, profile: Profile): Promise<SetupResult | undefined> {
  const goal = await db.goals.where('status').equals('active').first();
  if (!goal) return undefined;
  const versions = await db.goalVersions.where('goalId').equals(goal.id).sortBy('effectiveFrom');
  const periods = await db.goalPeriods.where('goalId').equals(goal.id).sortBy('from');
  const version = versions.at(-1);
  const period = periods.at(-1);
  return version && period ? { profile, goal, version, period } : undefined;
}

/** Replaces everything with the design's sample world and pins the clock to its Friday. */
async function loadDemoDataIn(db: KiraMakanDb): Promise<DemoWorld> {
  const world = await loadDemo(db);
  setDemoClock(true);
  return world;
}

/**
 * On: loads the demo world. Off: clears the demo data (only when the data is the demo's,
 * so a real diary is never wiped) and unpins the clock.
 */
async function setDemoModeIn(db: KiraMakanDb, enabled: boolean): Promise<void> {
  if (enabled) {
    await loadDemoDataIn(db);
    return;
  }
  const profile = await db.profile.get('me');
  if (profile?.demoMode) await clearAllTables(db);
  setDemoClock(false);
}

/** Pins or unpins the clock to match the stored profile. Call once at start-up. */
async function syncDemoClockIn(db: KiraMakanDb): Promise<boolean> {
  const demo = (await db.profile.get('me'))?.demoMode === true;
  setDemoClock(demo);
  return demo;
}

/** Deletes everything on this device. */
async function resetAllIn(db: KiraMakanDb): Promise<void> {
  await clearAllTables(db);
  setDemoClock(false);
}

// ---------------------------------------------------------------------------
// Binding
// ---------------------------------------------------------------------------

export function createActions(db: KiraMakanDb) {
  return {
    saveMeal: (draft: ReviewDraft) => saveMealIn(db, draft),
    updateMeal: (id: Id, patch: MealPatch) => updateMealIn(db, id, patch),
    deleteMeal: (id: Id) => deleteMealIn(db, id),
    duplicateMeal: (id: Id, at?: Instant) => duplicateMealIn(db, id, at),
    confirmDay: (day: LogicalDay, choice: CheckInChoice, guess?: CheckInGuess) => confirmDayIn(db, day, choice, guess),
    setSleepTap: (day: LogicalDay, at: Instant | null) => setSleepAt(db, day, at),
    addWeight: (kg: number, at?: Instant) => addWeightIn(db, kg, at),
    deleteWeight: (id: Id) => removeRow(db, 'weights', id),
    planMakanDay: (weekStart: LogicalDay, day: LogicalDay | null) => planMakanDayIn(db, weekStart, day),
    setWeeklyFocus: (weekStart: LogicalDay, focus: NonNullable<WeekPlan['focus']> | null) => setWeeklyFocusIn(db, weekStart, focus),
    addWorkout: (type: WorkoutType, intensity: Intensity, minutes: number, day?: LogicalDay) =>
      addWorkoutIn(db, type, intensity, minutes, day),
    deleteWorkout: (id: Id) => removeRow(db, 'workouts', id),
    addBonus: (kcal: number, reason: string, day?: LogicalDay) => addBonusIn(db, kcal, reason, day),
    deleteBonus: (id: Id) => removeRow(db, 'bonuses', id),
    logPotServing: (potId: Id, servings: number, opts?: { eatenAt?: Instant; slot?: MealSlot; placeId?: Id }) =>
      logPotServingIn(db, potId, servings, opts),
    rememberCorrection: (item: MealItem, placeId: Id | undefined, scope: PersonalItem['scope']) =>
      rememberCorrectionIn(db, item, placeId, scope),
    completeSetup: (input: SetupInput) => completeSetupIn(db, input),
    loadDemoData: () => loadDemoDataIn(db),
    setDemoMode: (enabled: boolean) => setDemoModeIn(db, enabled),
    syncDemoClock: () => syncDemoClockIn(db),
    resetAll: () => resetAllIn(db),
  };
}

export type Actions = ReturnType<typeof createActions>;

export const {
  saveMeal,
  updateMeal,
  deleteMeal,
  duplicateMeal,
  confirmDay,
  setSleepTap,
  addWeight,
  deleteWeight,
  planMakanDay,
  setWeeklyFocus,
  addWorkout,
  deleteWorkout,
  addBonus,
  deleteBonus,
  logPotServing,
  rememberCorrection,
  completeSetup,
  loadDemoData,
  setDemoMode,
  syncDemoClock,
  resetAll,
} = createActions(appDb);
