/**
 * Search (S49): every meal indexed for text matching. It only reads: no write, no capture, no
 * network. The matching itself is pure and lives in src/domain/search.ts.
 *
 * Dexie has no substring or accent-insensitive index, so the meals (and the Places that name
 * them) are read once and indexed in memory, in slices that give the browser room to paint and
 * take input, so a long history never freezes the screen.
 *
 * Plain async functions take the database first (`…In`); the hook uses the app's database.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { db as appDb, type KiraMakanDb } from '@/db/db';
import { indexMeal, sortNewestFirst, type MealSearchEntry } from '@/domain/search';

/** Meals indexed between two yields to the browser. */
export const INDEX_CHUNK = 400;

export interface IndexOptions {
  chunk?: number;
  /** What runs between two chunks; tests pass a counter. */
  yieldFn?: () => Promise<void>;
}

/** Lets the browser paint and take input between chunks. */
export function yieldToMain(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  return scheduler?.yield ? scheduler.yield() : new Promise((resolve) => setTimeout(resolve, 0));
}

/** Every meal indexed and newest first. */
export async function loadSearchIndexIn(db: KiraMakanDb, opts: IndexOptions = {}): Promise<MealSearchEntry[]> {
  // All Dexie reads first. Nothing touches the database after a yield (a live query's tracking doesn't survive a macrotask).
  const [meals, places] = await Promise.all([db.meals.toArray(), db.places.toArray()]);
  const names = new Map(places.map((p) => [p.id, p.name]));
  const chunk = opts.chunk ?? INDEX_CHUNK;
  const yieldFn = opts.yieldFn ?? yieldToMain;
  const entries: MealSearchEntry[] = [];
  for (let i = 0; i < meals.length; i += chunk) {
    for (const meal of meals.slice(i, i + chunk)) entries.push(indexMeal(meal, meal.placeId ? names.get(meal.placeId) : undefined));
    if (i + chunk < meals.length) await yieldFn();
  }
  return sortNewestFirst(entries);
}

/** Every meal, indexed and newest first. Undefined while loading; re-runs when meals or Places change (an edit, a sync, a restore). */
export function useSearchIndex(): MealSearchEntry[] | undefined {
  return useLiveQuery(() => loadSearchIndexIn(appDb), []);
}
