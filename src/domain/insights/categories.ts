/**
 * Where calories came from (S31 "Where it came from"): food groups built from catalogue
 * categories, plus small helpers the rules share for reading meal items.
 */
import { byId, findByName } from '@/data/catalogue';
import { FINISHED_FACTOR, itemMacros } from '@/domain/meal';
import type { FoodCategory, MealItem, MealLog, Place } from '@/domain/types';
import type { CategoryGroupId } from './types';

export const CATEGORY_GROUP_LABEL: Record<CategoryGroupId, string> = {
  rice: 'Rice dishes',
  home: 'Home cooking',
  drinks: 'Drinks',
  noodles: 'Noodles',
  snacks: 'Snacks and kuih',
  other: 'Other',
};

/** Display order when shares tie. */
export const CATEGORY_GROUPS: readonly CategoryGroupId[] = ['rice', 'home', 'drinks', 'noodles', 'snacks', 'other'];

/** The catalogue category of an item: its catalogue entry, else an exact name match. */
export function itemCategory(item: Pick<MealItem, 'catalogueId' | 'name'>): FoodCategory | undefined {
  const entry = item.catalogueId ? byId(item.catalogueId) : undefined;
  if (entry) return entry.category;
  return findByName(item.name)[0]?.category;
}

export function isDrink(item: Pick<MealItem, 'catalogueId' | 'name'>): boolean {
  return itemCategory(item) === 'drinks';
}

/** kcal of one item as eaten (quantity and how much of the meal was finished). */
export function itemKcal(item: MealItem, meal: Pick<MealLog, 'finished'>): number {
  return itemMacros(item).kcal * FINISHED_FACTOR[meal.finished];
}

export function itemProtein(item: MealItem, meal: Pick<MealLog, 'finished'>): number {
  return itemMacros(item).proteinG * FINISHED_FACTOR[meal.finished];
}

export function mealKcal(meal: MealLog): number {
  return meal.items.reduce((sum, item) => sum + itemKcal(item, meal), 0);
}

/** The selected chip's label ("Kurang", "Mamak big"), if the item has chips. */
export function variantLabel(item: Pick<MealItem, 'variants' | 'selectedVariant'>): string | undefined {
  if (item.selectedVariant === undefined) return undefined;
  return item.variants?.[item.selectedVariant]?.label;
}

/** A meal cooked at home: at a Place of type home, or served from a pot. */
export function isHomeMeal(meal: Pick<MealLog, 'placeId' | 'method'>, placeById: ReadonlyMap<string, Place>): boolean {
  if (meal.method === 'pot') return true;
  const place = meal.placeId ? placeById.get(meal.placeId) : undefined;
  return place?.type === 'home';
}

const SNACK_CATEGORIES: ReadonlySet<FoodCategory> = new Set(['kuih', 'snack', 'fruit']);

/**
 * The group a meal's food (drinks aside) falls in: home cooking for meals at home, else rice
 * dishes when there's rice on the plate, noodles, snacks and kuih, or other (roti, bread).
 */
function mealFoodGroup(meal: MealLog, placeById: ReadonlyMap<string, Place>): CategoryGroupId {
  if (isHomeMeal(meal, placeById)) return 'home';
  const categories = meal.items.filter((i) => !isDrink(i)).map(itemCategory);
  if (categories.includes('rice')) return 'rice';
  if (categories.includes('noodles')) return 'noodles';
  if (categories.includes('home')) return 'home';
  if (categories.length > 0 && categories.every((c) => c !== undefined && SNACK_CATEGORIES.has(c))) return 'snacks';
  return 'other';
}

/** The group one item of a meal counts toward. */
export function itemGroup(item: MealItem, meal: MealLog, placeById: ReadonlyMap<string, Place>): CategoryGroupId {
  const category = itemCategory(item);
  if (category === 'drinks') return 'drinks';
  if (category !== undefined && SNACK_CATEGORIES.has(category)) return isHomeMeal(meal, placeById) ? 'home' : 'snacks';
  return mealFoodGroup(meal, placeById);
}

export interface CategoryShare {
  id: CategoryGroupId;
  name: string;
  kcal: number;
  /** Share of the period's calories, 0–100, rounded; shares add up to 100. */
  pct: number;
}

/** Rounds shares so they add up to exactly 100 (largest remainder). */
function roundShares(raw: number[]): number[] {
  const floors = raw.map(Math.floor);
  let left = 100 - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => ({ i, rem: v - Math.floor(v) })).sort((a, b) => b.rem - a.rem);
  for (const { i } of order) {
    if (left <= 0) break;
    floors[i] = (floors[i] ?? 0) + 1;
    left -= 1;
  }
  return floors;
}

/** Calories by group, biggest first; empty groups are left out. Guesses have no food detail and are skipped. */
export function categoryShares(meals: MealLog[], places: Place[]): CategoryShare[] {
  const placeById = new Map(places.map((p) => [p.id, p]));
  const totals = new Map<CategoryGroupId, number>();
  for (const meal of meals) {
    if (meal.isGuess) continue;
    for (const item of meal.items) {
      const group = itemGroup(item, meal, placeById);
      totals.set(group, (totals.get(group) ?? 0) + itemKcal(item, meal));
    }
  }
  const total = [...totals.values()].reduce((a, b) => a + b, 0);
  if (total <= 0) return [];
  const present = CATEGORY_GROUPS.filter((g) => (totals.get(g) ?? 0) > 0);
  const pcts = roundShares(present.map((g) => ((totals.get(g) ?? 0) / total) * 100));
  return present
    .map((id, i) => ({ id, name: CATEGORY_GROUP_LABEL[id], kcal: Math.round(totals.get(id) ?? 0), pct: pcts[i] ?? 0 }))
    .sort((a, b) => b.kcal - a.kcal || CATEGORY_GROUPS.indexOf(a.id) - CATEGORY_GROUPS.indexOf(b.id));
}
