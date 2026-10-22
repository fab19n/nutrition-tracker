/**
 * The top dishes check (S34): the dishes you log most, the number each would start at now, and
 * what an answer ("Looks right", "Usually more", "Usually less") teaches the app. Pure: the
 * data layer reads the meals and writes the answers (src/db/dishCheck.ts).
 *
 * A dish is a catalogue item (or a typed or AI-guessed name), counted once per meal. The value
 * shown is what the estimators would start from today: your correction for the Place, your
 * correction for the dish, the Place's learned portion, else the catalogue's own number.
 */
import { byId, normaliseName } from '@/data/catalogue';
import { roundTo5 } from '@/domain/format';
import { countOf } from '@/estimate/local/variants';
import { applicableCorrections, itemFromPersonal, learnedItem } from '@/domain/learned';
import type { Id, Instant, Macros, MealItem, MealLog, PersonalItem, Place, SourceTag, Variant } from '@/domain/types';

/** The row id of the top dishes check in `insightFeedback`. */
export const DISH_CHECK_ID = 'topDishes';
/** Days with a real meal before the check is offered. */
export const DISH_CHECK_MIN_DAYS = 14;
export const DISH_CHECK_LIMIT = 30;
/** A dish needs this many logs to be listed. */
export const DISH_CHECK_MIN_TIMES = 2;
/** Fewer listable dishes than this is "not enough repeats yet". */
export const DISH_CHECK_MIN_DISHES = 5;
/** Today and the 55 days before. */
export const DISH_CHECK_HISTORY_DAYS = 56;
/** "Not now" hides the card this long. */
export const DISH_CHECK_HIDE_DAYS = 28;
/** A dish belongs to a Place when that Place holds at least this share of its logs (and 2+). */
export const PLACE_SHARE = 0.6;
export const MORE_FACTOR = 1.25;
export const LESS_FACTOR = 0.8;
/** A value you confirmed is a ±20% estimate, not an AI guess's wide range. */
export const CHECKED_UNCERTAINTY = 0.2;

export type DishAnswer = 'right' | 'more' | 'less';

/** The four tags of S34: catalogue (with its own MyFCD, SG FoodID or USDA label), your correction, Place default, AI guess. */
export type DishSource = SourceTag | 'placeDefault';

export interface DishStat {
  key: string;
  /** The catalogue name when the catalogue has it, else the logged item's name. */
  name: string;
  catalogueId?: string;
  /** Meals containing it (once per meal). */
  times: number;
  /** The Place holding at least 60% of its logs (and 2+), when it still exists. */
  placeId?: Id;
  /** The newest logged item of this dish (a snapshot). */
  latest: MealItem;
  lastEatenAt: Instant;
}

/** The catalogue id, or `name:` + the normalised name for a dish the catalogue doesn't have. */
export function dishKeyOf(item: Pick<MealItem, 'catalogueId' | 'name'>): string {
  return item.catalogueId ?? `name:${normaliseName(item.name)}`;
}

/** Items that make a dish: a real, estimated amount that isn't a pot's whole serving or one of its ingredients. */
function countsAsDish(item: MealItem, meal: MealLog): boolean {
  if (item.pendingEstimate || item.unitMacros.kcal <= 0) return false;
  if (item.catalogueId !== undefined && byId(item.catalogueId)?.category === 'other') return false;
  // A pot serving is one line for the whole pot; a catalogue item beside it (rice) still counts.
  if (meal.method === 'pot' && item.catalogueId === undefined) return false;
  return true;
}

interface PlaceTally {
  count: number;
  lastEatenAt: Instant;
}

/** The dishes in `meals`, one stat each. Guess entries have no real dishes, so they stay out. */
export function dishStats(meals: readonly MealLog[], places: readonly Place[]): DishStat[] {
  const sorted = [...meals].sort((a, b) => Date.parse(a.eatenAt) - Date.parse(b.eatenAt) || a.id.localeCompare(b.id));
  const byKey = new Map<string, DishStat>();
  const tallies = new Map<string, Map<Id, PlaceTally>>();

  for (const meal of sorted) {
    if (meal.isGuess) continue;
    const seen = new Set<string>();
    for (const item of meal.items) {
      if (!countsAsDish(item, meal)) continue;
      const key = dishKeyOf(item);
      if (seen.has(key)) continue;
      seen.add(key);

      const food = item.catalogueId !== undefined ? byId(item.catalogueId) : undefined;
      const stat: DishStat = byKey.get(key) ?? { key, name: food?.name ?? item.name, times: 0, latest: item, lastEatenAt: meal.eatenAt };
      stat.times += 1;
      stat.latest = item;
      stat.lastEatenAt = meal.eatenAt;
      if (item.catalogueId !== undefined) stat.catalogueId = item.catalogueId;
      if (!food) stat.name = item.name;
      byKey.set(key, stat);

      if (meal.placeId !== undefined) {
        const tally = tallies.get(key) ?? new Map<Id, PlaceTally>();
        const entry = tally.get(meal.placeId) ?? { count: 0, lastEatenAt: meal.eatenAt };
        entry.count += 1;
        entry.lastEatenAt = meal.eatenAt;
        tally.set(meal.placeId, entry);
        tallies.set(key, tally);
      }
    }
  }

  const placeIds = new Set(places.map((p) => p.id));
  for (const stat of byKey.values()) {
    // Highest count; a tie goes to the Place used most recently, then the smaller id.
    const top = [...(tallies.get(stat.key) ?? [])]
      .sort(([idA, a], [idB, b]) => b.count - a.count || Date.parse(b.lastEatenAt) - Date.parse(a.lastEatenAt) || idA.localeCompare(idB))
      .at(0);
    if (top && top[1].count >= DISH_CHECK_MIN_TIMES && top[1].count / stat.times >= PLACE_SHARE && placeIds.has(top[0])) {
      stat.placeId = top[0];
    }
  }
  return [...byKey.values()];
}

/** Days with at least one real (non-guess) meal. */
export function loggedDayCount(meals: readonly MealLog[]): number {
  return new Set(meals.filter((m) => !m.isGuess).map((m) => m.logicalDay)).size;
}

/** Dishes logged twice or more: most often first, then the newest, then by name. At most `limit`. */
export function topDishes(stats: readonly DishStat[], limit: number = DISH_CHECK_LIMIT): DishStat[] {
  return stats
    .filter((s) => s.times >= DISH_CHECK_MIN_TIMES)
    .sort(
      (a, b) =>
        b.times - a.times ||
        Date.parse(b.lastEatenAt) - Date.parse(a.lastEatenAt) ||
        a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) ||
        a.key.localeCompare(b.key),
    )
    .slice(0, limit);
}

export interface DishEstimate {
  /** One portion as the app would start it now. */
  item: MealItem;
  source: DishSource;
  /** Where an answer is kept. */
  scope: 'place' | 'dish';
  /** Set when scope is 'place'. */
  placeId?: Id;
  /** item.unitMacros.kcal. */
  kcal: number;
  /** The chip label when the item has chips, else the catalogue unit ("a piece"), else "1 portion". */
  portion: string;
}

function copyVariants(variants: readonly Variant[]): Variant[] {
  return variants.map((v) => ({ ...v, macros: { ...v.macros } }));
}

function portionOf(item: MealItem, unit: string | undefined): string {
  if (item.variants && item.variants.length > 1 && item.selectedVariant !== undefined) {
    const label = item.variants[item.selectedVariant]?.label;
    if (label) return label;
  }
  return unit ?? '1 portion';
}

/**
 * The number this dish would start at now, where it comes from, and where an answer is kept.
 * A row with no Place (`stat.placeId` unset) never looks at Place learning.
 */
export function dishEstimate(stat: DishStat, ctx: { personal: readonly PersonalItem[]; places: readonly Place[] }): DishEstimate {
  const place = stat.placeId !== undefined ? ctx.places.find((p) => p.id === stat.placeId) : undefined;
  const food = stat.catalogueId !== undefined ? byId(stat.catalogueId) : undefined;
  const applicable = applicableCorrections(ctx.personal, place);

  if (food) {
    const item = learnedItem(food, place ? { place, personal: ctx.personal } : { personal: ctx.personal }, stat.key);
    const placeOwn = applicable.find((p) => p.scope === 'place' && p.catalogueId === food.id);
    const dishOwn = applicable.find((p) => p.scope === 'dish' && p.catalogueId === food.id);
    const learnedAtPlace = place?.defaultVariants[food.id];
    let source: DishSource;
    let scope: DishEstimate['scope'] = 'dish';
    if (placeOwn) {
      source = 'placeDefault';
      scope = 'place';
    } else if (dishOwn) {
      source = 'yourCorrection';
    } else if (learnedAtPlace !== undefined && food.variants[learnedAtPlace]) {
      source = 'placeDefault';
      scope = 'place';
    } else {
      source = item.source;
    }
    return finish(item, source, scope, place, food.unit);
  }

  // Not in the catalogue: a typed or guessed dish (or a catalogue id that has since gone).
  const mine = applicable.filter((p) =>
    stat.catalogueId !== undefined ? p.catalogueId === stat.catalogueId : !p.catalogueId && normaliseName(p.name) === normaliseName(stat.name),
  );
  const placeOwn = mine.find((p) => p.scope === 'place');
  const own = placeOwn ?? mine.find((p) => p.scope === 'dish');
  if (own) return finish(itemFromPersonal(own, stat.key), placeOwn ? 'placeDefault' : 'yourCorrection', placeOwn ? 'place' : 'dish', place, undefined);

  const latest = stat.latest;
  const item: MealItem = { ...latest, id: stat.key, quantity: 1, unitMacros: { ...latest.unitMacros } };
  if (latest.variants) item.variants = copyVariants(latest.variants);
  return finish(item, latest.source, 'dish', place, undefined);
}

function finish(item: MealItem, source: DishSource, scope: DishEstimate['scope'], place: Place | undefined, unit: string | undefined): DishEstimate {
  const estimate: DishEstimate = { item, source, scope, kcal: item.unitMacros.kcal, portion: portionOf(item, unit) };
  if (scope === 'place' && place) estimate.placeId = place.id;
  return estimate;
}

/**
 * The neighbouring chip by kcal, not by position: the cheapest one strictly above (more) or the
 * dearest strictly below (less). A tie goes to the lower index. Undefined at either end.
 */
export function stepVariant(variants: readonly Variant[], selected: number, direction: 'more' | 'less'): number | undefined {
  const current = variants[selected];
  if (!current) return undefined;
  const base = current.macros.kcal;
  let best: number | undefined;
  variants.forEach((variant, index) => {
    const kcal = variant.macros.kcal;
    const bestKcal = best === undefined ? undefined : variants[best]?.macros.kcal;
    if (direction === 'more') {
      if (kcal > base + 0.5 && (bestKcal === undefined || kcal < bestKcal)) best = index;
    } else if (kcal < base - 0.5 && (bestKcal === undefined || kcal > bestKcal)) {
      best = index;
    }
  });
  return best;
}

export interface DishChange {
  /**
   * none: nothing to remember · confirm: an AI guess you said looks right · variant: the next or
   * previous chip · scale: your own number, ×1.25 or ×0.8.
   */
  kind: 'none' | 'confirm' | 'variant' | 'scale';
  /** What to remember; unset for 'none'. */
  item?: MealItem;
  fromKcal: number;
  toKcal: number;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

function scaled(m: Macros, factor: number): Macros {
  return {
    kcal: Math.max(5, roundTo5(m.kcal * factor)),
    proteinG: round1(m.proteinG * factor),
    carbsG: round1(m.carbsG * factor),
    fatG: round1(m.fatG * factor),
  };
}

/**
 * A step that doubles or halves a count ("1 piece" → "2 pieces") says how many, not how big.
 * "Usually more" on "1 piece" means a bigger piece: how many you had is picked when you log
 * ("2 roti canai"), and stepping would double every later "roti canai". Finer counts ("1 scoop"
 * → "1.5 scoops") are portion sizes and still step.
 */
function isCountJump(from: string | undefined, to: string): boolean {
  const a = countOf(from ?? '');
  const b = countOf(to);
  return a !== undefined && b !== undefined && a > 0 && b > 0 && Math.max(a / b, b / a) >= 2;
}

/** Confirming or correcting an AI guess makes it your own value, with a tighter range. */
function tightened(item: MealItem, source: DishSource): MealItem {
  return source === 'aiGuess' ? { ...item, uncertainty: Math.min(item.uncertainty, CHECKED_UNCERTAINTY) } : item;
}

/**
 * What an answer changes. "Looks right" changes nothing, except that an AI guess becomes your
 * own value. "Usually more" and "Usually less" move to the next or previous chip, or scale the
 * number by ×1.25 or ×0.8 when there isn't one.
 */
export function planDishAnswer(estimate: DishEstimate, answer: DishAnswer): DishChange {
  const { item, source, kcal } = estimate;
  if (answer === 'right') {
    if (source !== 'aiGuess') return { kind: 'none', fromKcal: kcal, toKcal: kcal };
    return { kind: 'confirm', item: tightened(item, source), fromKcal: kcal, toKcal: kcal };
  }

  const direction = answer;
  const hasChips = item.variants !== undefined && item.variants.length > 1 && item.selectedVariant !== undefined;
  let counted = false;
  if (hasChips && item.variants && item.selectedVariant !== undefined) {
    const index = stepVariant(item.variants, item.selectedVariant, direction);
    const chip = index === undefined ? undefined : item.variants[index];
    const current = item.variants[item.selectedVariant]?.label;
    // With no chip to step to, a piece that has a "2 pieces" sibling is still resized with it.
    counted = chip
      ? isCountJump(current, chip.label)
      : item.variants.some((variant, i) => i !== item.selectedVariant && isCountJump(current, variant.label));
    if (index !== undefined && chip && !counted) {
      const next: MealItem = { ...item, variants: copyVariants(item.variants), selectedVariant: index, unitMacros: { ...chip.macros } };
      return { kind: 'variant', item: tightened(next, source), fromKcal: kcal, toKcal: next.unitMacros.kcal };
    }
  }

  const factor = direction === 'more' ? MORE_FACTOR : LESS_FACTOR;
  const macros = scaled(item.unitMacros, factor);
  const { variants: _variants, selectedVariant: _selected, ...rest } = item;
  const next: MealItem = { ...rest, unitMacros: macros };
  if (hasChips && item.variants && item.selectedVariant !== undefined) {
    // The chip in use is scaled and stays equal to unitMacros. With counted chips, every count is
    // resized the same way, so "2 pieces" stays two of the resized piece.
    const variants = copyVariants(item.variants);
    if (counted) {
      variants.forEach((variant) => {
        if (countOf(variant.label) !== undefined) variant.macros = scaled(variant.macros, factor);
      });
    }
    const chip = variants[item.selectedVariant];
    if (chip) chip.macros = { ...macros };
    next.variants = variants;
    next.selectedVariant = item.selectedVariant;
  }
  return { kind: 'scale', item: tightened(next, source), fromKcal: kcal, toKcal: macros.kcal };
}
