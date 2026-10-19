/**
 * Pots (S26–S28, plan §9.7): cooking a pot, its saved recipes, logging servings out of it and
 * deleting it. A pot works like stock that runs down: "Log 1 serving" takes one out, and the pot
 * clears itself 4 days after it was cooked.
 *
 * Logging goes through `logPotServing` in actions.ts (½ servings included), so a pot serving is
 * the same meal wherever it's logged from (the Log sheet or here).
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { createActions, type PotServingResult, type Undo } from '@/db/actions';
import { db as appDb, newId, type KiraMakanDb } from '@/db/db';
import { getPot, listPlaces, listPots, putPot } from '@/db/repo';
import { getToday } from '@/db/selectors';
import { normaliseName } from '@/data/catalogue';
import { now } from '@/domain/clock';
import { addDays, compareDays } from '@/domain/day';
import type { Id, LogicalDay, Pot, PotIngredient } from '@/domain/types';
import { kcalPerServing, recipeTotal } from '@/estimate/recipe';

/** A pot clears itself this many days after it was cooked (cooked Wed → clears Sun). */
export const POT_KEEPS_DAYS = 4;
export const DEFAULT_SERVINGS = 8;
/** The servings chips on S27; the stepper reaches the rest. */
export const SERVING_CHOICES = [6, 8, 10] as const;
export const SERVINGS_LIMIT = { min: 1, max: 30 } as const;
/** S28's log buttons: ½, 1 and 2 servings. */
export const LOG_SERVING_CHOICES = [0.5, 1, 2] as const;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export type PotState = 'active' | 'clearsToday' | 'cleared';

/** Cleared once it's eaten or past its day; on its last day it "clears today". */
export function potState(pot: Pick<Pot, 'servingsLeft' | 'expiresOn'>, today: LogicalDay): PotState {
  if (pot.servingsLeft <= 0 || compareDays(pot.expiresOn, today) < 0) return 'cleared';
  return pot.expiresOn === today ? 'clearsToday' : 'active';
}

/** kcal in one serving of a pot (its ingredients ÷ servings). */
export function potServingKcal(pot: Pick<Pot, 'ingredients' | 'servings'>): number {
  return kcalPerServing(pot.ingredients, pot.servings);
}

/** A recipe you've cooked before: the newest pot with that name. */
export interface SavedRecipe {
  /** The pot it comes from (Cook again reads it). */
  potId: Id;
  name: string;
  recipeText: string;
  ingredients: PotIngredient[];
  servings: number;
  cookedOn: LogicalDay;
  totalKcal: number;
  kcalPerServing: number;
}

function toRecipe(pot: Pot): SavedRecipe {
  return {
    potId: pot.id,
    name: pot.name,
    recipeText: pot.recipeText,
    ingredients: pot.ingredients,
    servings: pot.servings,
    cookedOn: pot.cookedOn,
    totalKcal: recipeTotal(pot.ingredients).kcal,
    kcalPerServing: potServingKcal(pot),
  };
}

/** Distinct past pots by name (any spelling of "Kari ayam" is one recipe), newest first. */
export async function listSavedRecipesIn(db: KiraMakanDb): Promise<SavedRecipe[]> {
  const seen = new Set<string>();
  const recipes: SavedRecipe[] = [];
  for (const pot of await listPots(db)) {
    const key = normaliseName(pot.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    recipes.push(toRecipe(pot));
  }
  return recipes;
}

export interface PotLookup {
  /** null when there's no pot with that id (deleted, or a stale link). */
  pot: Pot | null;
}

export async function lookupPot(db: KiraMakanDb, id: Id): Promise<PotLookup> {
  return { pot: (await getPot(db, id)) ?? null };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface NewPotInput {
  name: string;
  recipeText: string;
  ingredients: readonly PotIngredient[];
  servings: number;
}

function cleanServings(servings: number): number {
  if (!Number.isFinite(servings)) throw new RangeError(`Servings must be a number: ${servings}`);
  const rounded = Math.round(servings);
  if (rounded < SERVINGS_LIMIT.min || rounded > SERVINGS_LIMIT.max) {
    throw new RangeError(`Servings must be ${SERVINGS_LIMIT.min}–${SERVINGS_LIMIT.max}: ${servings}`);
  }
  return rounded;
}

/** Ingredients as stored: copied, ids unique within the pot. */
function cleanIngredients(ingredients: readonly PotIngredient[], freshIds: boolean): PotIngredient[] {
  const used = new Set<string>();
  return ingredients.map((ingredient) => {
    const id = freshIds || !ingredient.id || used.has(ingredient.id) ? newId() : ingredient.id;
    used.add(id);
    const copy: PotIngredient = {
      id,
      name: ingredient.name.trim() || 'Ingredient',
      amount: ingredient.amount.trim(),
      macros: { ...ingredient.macros },
      source: ingredient.source,
    };
    if (ingredient.isOil) copy.isOil = true;
    return copy;
  });
}

/** Cooks a pot today (by the clock, in the profile's day): all servings left, clears in 4 days. */
export async function createPotIn(db: KiraMakanDb, input: NewPotInput, opts: { freshIds?: boolean } = {}): Promise<Pot> {
  const name = input.name.trim();
  if (!name) throw new RangeError('A pot needs a name');
  if (input.ingredients.length === 0) throw new RangeError('A pot needs at least one ingredient');
  const servings = cleanServings(input.servings);
  const cookedOn = await getToday(db);
  const pot: Pot = {
    id: newId(),
    name,
    recipeText: input.recipeText.trim(),
    ingredients: cleanIngredients(input.ingredients, opts.freshIds ?? false),
    servings,
    servingsLeft: servings,
    cookedOn,
    expiresOn: addDays(cookedOn, POT_KEEPS_DAYS),
    createdAt: now().toISOString(),
  };
  await putPot(db, pot);
  return pot;
}

/** A new pot from a saved recipe (any past pot), with the same ingredients and servings unless changed. */
export async function cookAgainIn(db: KiraMakanDb, recipePotId: Id, changes: Partial<Pick<NewPotInput, 'servings' | 'name'>> = {}): Promise<Pot> {
  const recipe = await getPot(db, recipePotId);
  if (!recipe) throw new Error(`Recipe not found: ${recipePotId}`);
  return createPotIn(
    db,
    {
      name: changes.name ?? recipe.name,
      recipeText: recipe.recipeText,
      ingredients: recipe.ingredients,
      servings: changes.servings ?? recipe.servings,
    },
    { freshIds: true },
  );
}

/**
 * Logs ½, 1 or 2 servings (any positive amount) as a meal with method 'pot', at Home when
 * there's a Home Place. Never takes more than is left: asking for 1 with ½ left logs ½.
 * A pot past its clear day can't be logged from (the meal lands on today's logical day).
 */
export async function logPotServingsIn(db: KiraMakanDb, potId: Id, servings: number): Promise<PotServingResult> {
  if (!Number.isFinite(servings) || servings <= 0) throw new RangeError(`Servings must be positive: ${servings}`);
  const pot = await getPot(db, potId);
  if (!pot) throw new Error(`Pot not found: ${potId}`);
  if (pot.servingsLeft <= 0) throw new RangeError('This pot is finished');
  if (potState(pot, await getToday(db)) === 'cleared') throw new RangeError(`This pot cleared on ${pot.expiresOn}`);
  const taken = Math.min(servings, pot.servingsLeft);
  const home = (await listPlaces(db)).find((p) => p.type === 'home');
  return createActions(db).logPotServing(potId, taken, home ? { placeId: home.id } : {});
}

/** Deletes a pot (meals already logged from it stay). Undo puts it back as it was. */
export async function deletePotIn(db: KiraMakanDb, potId: Id): Promise<Undo> {
  const pot = await db.transaction('rw', db.pots, async () => {
    const found = await getPot(db, potId);
    if (found) await db.pots.delete(potId);
    return found;
  });
  if (!pot) return async () => {};
  return async () => {
    await putPot(db, pot);
  };
}

// ---------------------------------------------------------------------------
// Hooks and app-bound writes
// ---------------------------------------------------------------------------

/** One pot by id: undefined while loading, `{ pot: null }` when it isn't there. */
export function usePotLookup(id: Id | undefined): PotLookup | undefined {
  return useLiveQuery(() => (id ? lookupPot(appDb, id) : { pot: null }), [id]);
}

export function useSavedRecipes(): SavedRecipe[] | undefined {
  return useLiveQuery(() => listSavedRecipesIn(appDb), []);
}

export function createPot(input: NewPotInput): Promise<Pot> {
  return createPotIn(appDb, input);
}

export function cookAgain(recipePotId: Id, changes?: Partial<Pick<NewPotInput, 'servings' | 'name'>>): Promise<Pot> {
  return cookAgainIn(appDb, recipePotId, changes);
}

export function logPotServings(potId: Id, servings: number): Promise<PotServingResult> {
  return logPotServingsIn(appDb, potId, servings);
}

export function deletePot(potId: Id): Promise<Undo> {
  return deletePotIn(appDb, potId);
}
