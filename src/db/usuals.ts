/**
 * Usuals (S23) reads and writes the shared data layer doesn't have (plan §9.5):
 *
 * - The list in your own order: a manual `sortIndex` first, then most used, then by name.
 * - Move up / move down (keyboard-friendly reordering that rewrites `sortIndex`).
 * - Rename, change items, create from scratch or from a past meal, delete with undo.
 * - Suggested Usuals: a meal logged 3 or more times in the last 60 days under the same name,
 *   with no Usual for it yet ("You've logged Bread, kaya, kopi 4 times. Save as a Usual?").
 *   "Not now" is remembered per device in localStorage (wrapped, so blocked storage only means
 *   it is remembered for this session).
 *
 * Plain async functions take the database first (`…In`); the bound versions and hooks use the
 * app's database.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useSyncExternalStore } from 'react';
import { normaliseName } from '@/data/catalogue';
import type { Undo } from '@/db/actions';
import { db as appDb, newId, type KiraMakanDb } from '@/db/db';
import { useToday } from '@/db/hooks';
import { saveUsualFromMeal } from '@/db/logging';
import { deleteUsual, getMeal, getUsual, listMealsInRange, listUsuals, putUsual } from '@/db/repo';
import { now } from '@/domain/clock';
import { addDays } from '@/domain/day';
import { mealMacros } from '@/domain/meal';
import type { Id, LogicalDay, LogMethod, MealItem, MealLog, MealSlot, Usual } from '@/domain/types';

// ---------------------------------------------------------------------------
// Order
// ---------------------------------------------------------------------------

/** Manual order first (lower sortIndex first; unset after set), then most used, then by name. */
export function compareUsuals(a: Usual, b: Usual): number {
  const sa = a.sortIndex;
  const sb = b.sortIndex;
  if (sa !== undefined && sb !== undefined && sa !== sb) return sa - sb;
  if (sa !== undefined && sb === undefined) return -1;
  if (sa === undefined && sb !== undefined) return 1;
  return b.useCount - a.useCount || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.id.localeCompare(b.id);
}

export function orderUsuals(usuals: readonly Usual[]): Usual[] {
  return [...usuals].sort(compareUsuals);
}

/** Every Usual in the order the Usuals screen shows them. */
export async function listOrderedUsualsIn(db: KiraMakanDb): Promise<Usual[]> {
  return orderUsuals(await listUsuals(db));
}

export type MoveDirection = 'up' | 'down';

/**
 * Swaps a Usual with its neighbour and writes the whole order back as sortIndex 0…n−1, so the
 * manual order sticks. False when it is already first (up) or last (down), or not found.
 */
export async function moveUsualIn(db: KiraMakanDb, id: Id, direction: MoveDirection): Promise<boolean> {
  return db.transaction('rw', db.usuals, async () => {
    const ordered = await listOrderedUsualsIn(db);
    const from = ordered.findIndex((u) => u.id === id);
    const to = direction === 'up' ? from - 1 : from + 1;
    const moving = ordered[from];
    const other = ordered[to];
    if (from < 0 || !moving || !other) return false;
    ordered[from] = other;
    ordered[to] = moving;
    await Promise.all(
      ordered.map((usual, index) => (usual.sortIndex === index ? Promise.resolve(0) : db.usuals.update(usual.id, { sortIndex: index }))),
    );
    return true;
  });
}

// ---------------------------------------------------------------------------
// Create, edit, delete
// ---------------------------------------------------------------------------

/** The longest name a Usual keeps (the card wraps; this only stops runaway pastes). */
export const USUAL_NAME_MAX = 60;

function cleanName(name: string): string {
  const clean = name.trim().replace(/\s+/g, ' ');
  if (!clean) throw new RangeError('A Usual needs a name');
  return clean.length > USUAL_NAME_MAX ? clean.slice(0, USUAL_NAME_MAX).trimEnd() : clean;
}

/** Items as a Usual keeps them: no correction history or open questions (a new log starts fresh). */
export function usualItems(items: readonly MealItem[]): MealItem[] {
  if (items.length === 0) throw new RangeError('A Usual needs at least one item');
  return items.map((item) => {
    const { original: _original, edited: _edited, question: _question, pendingEstimate: _pending, ...rest } = item;
    const copy: MealItem = { ...rest, unitMacros: { ...item.unitMacros } };
    if (item.variants) copy.variants = item.variants.map((v) => ({ ...v, macros: { ...v.macros } }));
    return copy;
  });
}

export interface NewUsualInput {
  name: string;
  items: readonly MealItem[];
  placeId?: Id;
  slot?: MealSlot;
}

export interface CreatedUsual {
  usual: Usual;
  /** Removes the Usual this call created. */
  undo: Undo;
}

/** "+ New Usual": a name and its items, not used yet. */
export async function createUsualIn(db: KiraMakanDb, input: NewUsualInput): Promise<CreatedUsual> {
  const usual: Usual = {
    id: newId(),
    name: cleanName(input.name),
    items: usualItems(input.items),
    useCount: 0,
    createdAt: now().toISOString(),
  };
  if (input.placeId) usual.placeId = input.placeId;
  if (input.slot) usual.slot = input.slot;
  await putUsual(db, usual);
  return { usual, undo: () => deleteUsual(db, usual.id) };
}

/** A past meal as a Usual (its name, Place, slot and items; counted as used once). */
export async function createUsualFromMealIn(db: KiraMakanDb, mealId: Id): Promise<CreatedUsual> {
  const meal = await getMeal(db, mealId);
  if (!meal) throw new RangeError(`No meal ${mealId}`);
  return saveUsualFromMeal(db, meal);
}

export interface UsualEdits {
  name?: string;
  items?: readonly MealItem[];
}

/**
 * Renames a Usual and/or replaces its items. Resolves to an undo that puts the previous
 * version back, or undefined when there is no such Usual.
 */
export async function editUsualIn(db: KiraMakanDb, id: Id, edits: UsualEdits): Promise<Undo | undefined> {
  const patch: Partial<Usual> = {};
  if (edits.name !== undefined) patch.name = cleanName(edits.name);
  if (edits.items !== undefined) patch.items = usualItems(edits.items);
  return db.transaction('rw', db.usuals, async () => {
    const before = await getUsual(db, id);
    if (!before) return undefined;
    await putUsual(db, { ...before, ...patch });
    return () => putUsual(db, before);
  });
}

export function renameUsualIn(db: KiraMakanDb, id: Id, name: string): Promise<Undo | undefined> {
  return editUsualIn(db, id, { name });
}

export function updateUsualItemsIn(db: KiraMakanDb, id: Id, items: readonly MealItem[]): Promise<Undo | undefined> {
  return editUsualIn(db, id, { items });
}

/**
 * Deletes a Usual; the undo puts it back where it was in the list (same id, use count and
 * place in your order, even after other moves in between).
 */
export async function removeUsualIn(db: KiraMakanDb, id: Id): Promise<Undo> {
  return db.transaction('rw', db.usuals, async () => {
    const ordered = await listOrderedUsualsIn(db);
    const position = ordered.findIndex((u) => u.id === id);
    const before = ordered[position];
    if (!before) return async () => {};
    await deleteUsual(db, id);
    return () => restoreUsualIn(db, before, position);
  });
}

/**
 * Undo for a delete. A Usual in your manual order goes back at its old position and the manual
 * order is written back as sortIndex 0…n−1 (as a move does), so no two Usuals share an index.
 * One without a sortIndex is ordered by use count, so the row going back is enough.
 */
async function restoreUsualIn(db: KiraMakanDb, usual: Usual, position: number): Promise<void> {
  await db.transaction('rw', db.usuals, async () => {
    if (usual.sortIndex === undefined) {
      await putUsual(db, usual);
      return;
    }
    // The manual order comes first in the list; Usuals without a sortIndex stay after it.
    const manual = (await listOrderedUsualsIn(db)).filter((u) => u.id !== usual.id && u.sortIndex !== undefined);
    const order = [...manual];
    order.splice(Math.min(Math.max(position, 0), manual.length), 0, usual);
    await Promise.all(
      order.map((u, index) => {
        if (u.id === usual.id) return putUsual(db, { ...usual, sortIndex: index });
        return u.sortIndex === index ? Promise.resolve() : db.usuals.update(u.id, { sortIndex: index }).then(() => undefined);
      }),
    );
  });
}

// ---------------------------------------------------------------------------
// Suggested Usuals
// ---------------------------------------------------------------------------

/** Logged this many times… */
export const SUGGEST_MIN_TIMES = 3;
/** …within this many logical days (today included). */
export const SUGGEST_WINDOW_DAYS = 60;

/**
 * Ways in that don't make a meal worth a Usual: a plate is named "Economy rice" whatever is on
 * it, pots have their own one-tap serving, guesses aren't meals you chose, and a meal logged
 * from a Usual already has one.
 */
const NOT_SUGGESTED: ReadonlySet<LogMethod> = new Set<LogMethod>(['plate', 'pot', 'guess', 'usual']);

export interface UsualSuggestion {
  /** The normalised meal name: what "Not now" remembers. */
  key: string;
  /** The latest meal's name, as it was logged. */
  name: string;
  /** Times logged in the window. */
  times: number;
  /** The latest of those meals (Save copies its items, Place and slot). */
  meal: MealLog;
  kcal: number;
}

/** "roti-canai-dhal:-:1|teh-tarik:1:1": the same food, chips and amounts in any order. */
function itemSignature(items: readonly MealItem[]): string {
  return items
    .map((i) => `${i.catalogueId ?? normaliseName(i.name)}:${i.selectedVariant ?? '-'}:${i.quantity}`)
    .sort()
    .join('|');
}

/**
 * Meals worth saving as a Usual: logged at least `minTimes` times under the same name
 * (ignoring case and punctuation), with no Usual of that name or with the same items.
 * Most often first, then most recent.
 */
export function findUsualSuggestions(
  meals: readonly MealLog[],
  usuals: readonly Usual[],
  opts: { minTimes?: number; dismissed?: ReadonlySet<string> } = {},
): UsualSuggestion[] {
  const minTimes = opts.minTimes ?? SUGGEST_MIN_TIMES;
  const usualNames = new Set(usuals.map((u) => normaliseName(u.name)));
  const usualSignatures = new Set(usuals.map((u) => itemSignature(u.items)));

  const groups = new Map<string, { latest: MealLog; times: number }>();
  for (const meal of meals) {
    if (meal.isGuess || NOT_SUGGESTED.has(meal.method) || meal.items.length === 0) continue;
    const key = normaliseName(meal.name);
    if (!key) continue;
    const group = groups.get(key);
    const latest = !group || meal.eatenAt.localeCompare(group.latest.eatenAt) >= 0 ? meal : group.latest;
    groups.set(key, { latest, times: (group?.times ?? 0) + 1 });
  }

  const suggestions: UsualSuggestion[] = [];
  for (const [key, { latest, times }] of groups) {
    if (times < minTimes || usualNames.has(key) || opts.dismissed?.has(key)) continue;
    if (usualSignatures.has(itemSignature(latest.items))) continue;
    suggestions.push({ key, name: latest.name, times, meal: latest, kcal: mealMacros({ items: latest.items, finished: 'all' }).kcal });
  }
  return suggestions.sort((a, b) => b.times - a.times || b.meal.eatenAt.localeCompare(a.meal.eatenAt));
}

/** Suggestions from the meals of the last 60 days up to `today` (dismissals not applied). */
export async function listUsualSuggestionsIn(db: KiraMakanDb, today: LogicalDay): Promise<UsualSuggestion[]> {
  const [meals, usuals] = await Promise.all([listMealsInRange(db, addDays(today, -(SUGGEST_WINDOW_DAYS - 1)), today), listUsuals(db)]);
  return findUsualSuggestions(meals, usuals);
}

/** "Save" on a suggestion: the latest meal as a Usual, counted as used as often as it was logged. */
export async function saveSuggestedUsualIn(db: KiraMakanDb, suggestion: Pick<UsualSuggestion, 'meal' | 'times'>): Promise<CreatedUsual> {
  return db.transaction('rw', db.usuals, async () => {
    const saved = await saveUsualFromMeal(db, suggestion.meal);
    const usual: Usual = { ...saved.usual, useCount: Math.max(saved.usual.useCount, suggestion.times) };
    await putUsual(db, usual);
    return { usual, undo: saved.undo };
  });
}

// ---------------------------------------------------------------------------
// "Not now": remembered per device (localStorage, with an in-memory fallback)
// ---------------------------------------------------------------------------

const DISMISSED_KEY = 'kira-makan:usual-suggestions-dismissed';
const EMPTY: ReadonlySet<string> = new Set();

let dismissedCache: ReadonlySet<string> | null = null;
const dismissedListeners = new Set<() => void>();

function loadDismissed(): ReadonlySet<string> {
  try {
    const raw = window.localStorage.getItem(DISMISSED_KEY);
    if (!raw) return EMPTY;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return EMPTY;
    return new Set(parsed.filter((v): v is string => typeof v === 'string'));
  } catch {
    return EMPTY;
  }
}

function writeDismissed(next: ReadonlySet<string>): void {
  dismissedCache = next;
  try {
    if (next.size === 0) window.localStorage.removeItem(DISMISSED_KEY);
    else window.localStorage.setItem(DISMISSED_KEY, JSON.stringify([...next]));
  } catch {
    // Private mode or storage blocked: remembered for this session only.
  }
  for (const listener of dismissedListeners) listener();
}

/** Normalised names of the suggestions answered "Not now". */
export function readDismissedSuggestions(): ReadonlySet<string> {
  dismissedCache ??= loadDismissed();
  return dismissedCache;
}

/** Hides a suggestion for good (by its meal name, so the same name never comes back). */
export function dismissUsualSuggestion(name: string): void {
  const key = normaliseName(name);
  const current = readDismissedSuggestions();
  if (!key || current.has(key)) return;
  writeDismissed(new Set([...current, key]));
}

/** Undo for "Not now". */
export function restoreUsualSuggestion(name: string): void {
  const key = normaliseName(name);
  const current = readDismissedSuggestions();
  if (!current.has(key)) return;
  const next = new Set(current);
  next.delete(key);
  writeDismissed(next);
}

/** Forgets every "Not now" (tests, a fresh start). */
export function clearDismissedSuggestions(): void {
  writeDismissed(EMPTY);
}

function subscribeDismissed(listener: () => void): () => void {
  dismissedListeners.add(listener);
  return () => {
    dismissedListeners.delete(listener);
  };
}

export function useDismissedSuggestions(): ReadonlySet<string> {
  return useSyncExternalStore(subscribeDismissed, readDismissedSuggestions, readDismissedSuggestions);
}

// ---------------------------------------------------------------------------
// Hooks and bound actions (the app's database)
// ---------------------------------------------------------------------------

/** The Usuals in the screen's order; undefined while loading. */
export function useOrderedUsuals(): Usual[] | undefined {
  return useLiveQuery(() => listOrderedUsualsIn(appDb), []);
}

/** Suggested Usuals still to answer; undefined while loading. */
export function useUsualSuggestions(): UsualSuggestion[] | undefined {
  const today = useToday();
  const dismissed = useDismissedSuggestions();
  const all = useLiveQuery(() => listUsualSuggestionsIn(appDb, today), [today]);
  return useMemo(() => all?.filter((s) => !dismissed.has(s.key)), [all, dismissed]);
}

export function createUsualsActions(db: KiraMakanDb) {
  return {
    listOrderedUsuals: () => listOrderedUsualsIn(db),
    moveUsual: (id: Id, direction: MoveDirection) => moveUsualIn(db, id, direction),
    createUsual: (input: NewUsualInput) => createUsualIn(db, input),
    createUsualFromMeal: (mealId: Id) => createUsualFromMealIn(db, mealId),
    editUsual: (id: Id, edits: UsualEdits) => editUsualIn(db, id, edits),
    renameUsual: (id: Id, name: string) => renameUsualIn(db, id, name),
    updateUsualItems: (id: Id, items: readonly MealItem[]) => updateUsualItemsIn(db, id, items),
    removeUsual: (id: Id) => removeUsualIn(db, id),
    listUsualSuggestions: (today: LogicalDay) => listUsualSuggestionsIn(db, today),
    saveSuggestedUsual: (suggestion: Pick<UsualSuggestion, 'meal' | 'times'>) => saveSuggestedUsualIn(db, suggestion),
  };
}

export const {
  listOrderedUsuals,
  moveUsual,
  createUsual,
  createUsualFromMeal,
  editUsual,
  renameUsual,
  updateUsualItems,
  removeUsual,
  listUsualSuggestions,
  saveSuggestedUsual,
} = createUsualsActions(appDb);
