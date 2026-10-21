/**
 * Search (S49): find any meal you have logged by name, item or Place. Pure: the data layer
 * (src/db/search.ts) reads the meals, this indexes and matches them.
 *
 * - One index entry per meal holds every string it can be found by, normalised once.
 * - A query is token-AND and order-free; a 1–2 letter word must start a word, and the words run
 *   together are tried too, from the start of a word ("tehtarik" finds "Teh tarik"; "ikan" does not
 *   find "Nasi kandar").
 * - Results are newest first by the stored logical day; there is no relevance ranking.
 */
import { byId } from '@/data/catalogue';
import { compareDays } from './day';
import { mealMacros } from './meal';
import { clipText } from './text';
import type { Finished, Id, Instant, LogicalDay, MealLog, MealSlot, Place } from './types';

/** Characters kept of a typed query (the URL param too). */
export const SEARCH_QUERY_MAX = 80;
/** "Often logged" shows this many items and Places, each logged at least OFTEN_MIN_COUNT times. */
export const OFTEN_ITEMS = 6;
export const OFTEN_PLACES = 3;
export const OFTEN_MIN_COUNT = 2;
/** Characters of the typed text that are searched. */
const TEXT_MAX = 500;
/** Characters of the typed text shown in a "You typed" note. */
const NOTE_TEXT_MAX = 40;

/**
 * Lowercase, accents and marks dropped, apostrophes dropped, "&" read as "and", every other run of
 * non-letters/digits one space. Unlike normaliseName it keeps non-Latin letters (叉烧饭). For ASCII input it is
 * identical to normaliseName ("Teh-O  Ais" → "teh o ais", "F&N" → "f and n").
 */
export function normaliseForSearch(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// The index
// ---------------------------------------------------------------------------

export interface SearchItem {
  /** As saved on the meal ("Teh tarik"). */
  name: string;
  /** The selected portion's label ("Kurang", "Banjir", "Mamak big"), if any. */
  variant?: string;
  catalogueId?: string;
  nameNorm: string;
  variantNorm: string;
  /** nameNorm + variantNorm + (catalogue name and aliases, normalised). What the item can be found by. */
  norm: string;
}

export interface MealSearchEntry {
  id: Id;
  logicalDay: LogicalDay;
  eatenAt: Instant;
  /** Date.parse(eatenAt); 0 when unparsable. Sort key. */
  at: number;
  slot: MealSlot;
  /** meal.name.trim(), else the first item's name, else 'Meal'. */
  name: string;
  placeId?: Id;
  placeName?: string;
  priceRm?: number;
  photoId?: Id;
  finished: Finished;
  isGuess: boolean;
  /** mealMacros(meal).kcal: items × quantity × the finished factor. Round with roundTo10 to show. */
  kcal: number;
  items: SearchItem[];
  /** The typed text, clipped to 500 characters. */
  text?: string;
  nameNorm: string;
  textNorm: string;
  placeNorm: string;
  /** Every searchable string joined by one space (duplicates removed). */
  hay: string;
  /** hay without spaces: a quick check before the spacing tolerance looks at word starts. */
  flat: string;
}

const aliasCache = new Map<string, string>();

/** A catalogue food's name and aliases, normalised ("teh o ais teh o peng …"); '' for an unknown id. */
function aliasesOf(catalogueId: string | undefined): string {
  if (!catalogueId) return '';
  const cached = aliasCache.get(catalogueId);
  if (cached !== undefined) return cached;
  const food = byId(catalogueId);
  const norm = food ? [food.name, ...food.aliases].map(normaliseForSearch).filter(Boolean).join(' ') : '';
  aliasCache.set(catalogueId, norm);
  return norm;
}

function indexItem(item: MealLog['items'][number]): SearchItem {
  const variant = item.selectedVariant !== undefined ? item.variants?.[item.selectedVariant]?.label : undefined;
  const nameNorm = normaliseForSearch(item.name);
  const variantNorm = variant ? normaliseForSearch(variant) : '';
  const entry: SearchItem = {
    name: item.name,
    nameNorm,
    variantNorm,
    norm: [nameNorm, variantNorm, aliasesOf(item.catalogueId)].filter(Boolean).join(' '),
  };
  if (variant) entry.variant = variant;
  if (item.catalogueId) entry.catalogueId = item.catalogueId;
  return entry;
}

/** One meal as the search sees it. `placeName` is the name of its Place, when it has one. */
export function indexMeal(meal: MealLog, placeName?: string): MealSearchEntry {
  const items = meal.items.map(indexItem);
  const name = meal.name.trim() || meal.items[0]?.name || 'Meal';
  const text = meal.text ? clipText(meal.text, TEXT_MAX) : undefined;
  const nameNorm = normaliseForSearch(name);
  const textNorm = text ? normaliseForSearch(text) : '';
  const placeNorm = placeName ? normaliseForSearch(placeName) : '';
  const hay = [...new Set([nameNorm, ...items.map((i) => i.norm), textNorm, placeNorm].filter(Boolean))].join(' ');
  const parsed = Date.parse(meal.eatenAt);

  const entry: MealSearchEntry = {
    id: meal.id,
    logicalDay: meal.logicalDay,
    eatenAt: meal.eatenAt,
    at: Number.isFinite(parsed) ? parsed : 0,
    slot: meal.slot,
    name,
    finished: meal.finished,
    isGuess: meal.isGuess === true,
    kcal: mealMacros(meal).kcal,
    items,
    nameNorm,
    textNorm,
    placeNorm,
    hay,
    flat: hay.replaceAll(' ', ''),
  };
  if (meal.placeId) entry.placeId = meal.placeId;
  if (placeName) entry.placeName = placeName;
  if (meal.priceRm !== undefined) entry.priceRm = meal.priceRm;
  if (meal.photoId) entry.photoId = meal.photoId;
  if (text) entry.text = text;
  return entry;
}

/** Newest logical day first, then the latest meal first inside a day; ties break by id. */
export function sortNewestFirst(entries: readonly MealSearchEntry[]): MealSearchEntry[] {
  return [...entries].sort((a, b) => compareDays(b.logicalDay, a.logicalDay) || b.at - a.at || b.id.localeCompare(a.id));
}

/** Every meal indexed, newest first. A meal whose Place is gone (or unnamed) has no placeName. */
export function buildMealIndex(meals: readonly MealLog[], places: readonly Pick<Place, 'id' | 'name'>[]): MealSearchEntry[] {
  const names = new Map(places.map((p) => [p.id, p.name]));
  return sortNewestFirst(meals.map((meal) => indexMeal(meal, meal.placeId ? names.get(meal.placeId) : undefined)));
}

// ---------------------------------------------------------------------------
// Query and matching
// ---------------------------------------------------------------------------

export interface ParsedQuery {
  /** Distinct normalised words, in the order typed. Empty = no text. */
  tokens: string[];
  /** The tokens joined with no spaces ("tehtarik"). */
  flat: string;
}

export function parseQuery(raw: string): ParsedQuery {
  const norm = normaliseForSearch(clipText(raw, SEARCH_QUERY_MAX));
  const tokens = norm ? [...new Set(norm.split(' '))] : [];
  return { tokens, flat: tokens.join('') };
}

export const isEmptyQuery = (q: ParsedQuery): boolean => q.tokens.length === 0;

const NON_ASCII = /[^\x00-\x7f]/;

/** A word of 3+ characters (or any non-Latin word) is found anywhere; a 1–2 character word must start a word. */
function tokenMatches(hay: string, token: string): boolean {
  if (token.length > 2 || NON_ASCII.test(token)) return hay.includes(token);
  return hay.startsWith(token) || hay.includes(` ${token}`);
}

/** The pattern for the words run together, kept for the query being typed (every row of a search shares it). */
let flatPattern: { flat: string; re: RegExp } | undefined;

/**
 * The words run together are in `hay` run together, starting where a word of `hay` starts ("tehtarik" in
 * "teh tarik"). A hit that starts inside a word is not one: "nasikandar" holds "ikan", "nasi kandar" does
 * not. Only for 4+ characters, so "a b" never uses it. `flatHay` (hay without spaces), when the caller has
 * it, rules out most rows with one `includes`.
 */
function flatMatches(hay: string, q: ParsedQuery, flatHay?: string): boolean {
  if (q.flat.length < 4) return false;
  if (flatHay !== undefined && !flatHay.includes(q.flat)) return false;
  if (flatPattern?.flat !== q.flat) {
    // A query holds only letters and digits, so its characters need no escaping. hay has single spaces.
    flatPattern = { flat: q.flat, re: new RegExp(`(?:^| )${[...q.flat].join(' ?')}`, 'u') };
  }
  return flatPattern.re.test(hay);
}

/** Every word is in `hay`, or (spacing tolerance) the words run together are in `hay` run together. */
function textMatches(hay: string, q: ParsedQuery): boolean {
  return q.tokens.every((t) => tokenMatches(hay, t)) || flatMatches(hay, q);
}

/** Some word of the query is in `hay`, or the words run together are. */
function anyWord(hay: string, q: ParsedQuery): boolean {
  return q.tokens.some((t) => tokenMatches(hay, t)) || flatMatches(hay, q);
}

export function matchesQuery(entry: MealSearchEntry, q: ParsedQuery): boolean {
  if (isEmptyQuery(q)) return true;
  // entry.flat is precomputed, so the common case allocates nothing.
  return q.tokens.every((t) => tokenMatches(entry.hay, t)) || flatMatches(entry.hay, q, entry.flat);
}

export interface SearchFilter {
  slot?: MealSlot;
  placeId?: Id;
}

/** The index (already newest first) narrowed by the text and the filters. Order is kept. */
export function searchMeals(index: readonly MealSearchEntry[], q: ParsedQuery, filter: SearchFilter = {}): MealSearchEntry[] {
  return index.filter(
    (e) => (filter.slot === undefined || e.slot === filter.slot) && (filter.placeId === undefined || e.placeId === filter.placeId) && matchesQuery(e, q),
  );
}

// ---------------------------------------------------------------------------
// Why a row matched
// ---------------------------------------------------------------------------

/** A short line saying why the row matched when the visible name doesn't show it; undefined when it does (or the Place line does). */
export function matchNote(entry: MealSearchEntry, q: ParsedQuery): string | undefined {
  if (isEmptyQuery(q)) return undefined;
  if (textMatches(entry.nameNorm, q)) return undefined;

  const labels: string[] = [];
  for (const item of entry.items) {
    if (!anyWord(item.norm, q)) continue;
    const label = item.variant && anyWord(item.variantNorm, q) ? `${item.name} ${item.variant.toLowerCase()}` : item.name;
    if (!labels.includes(label)) labels.push(label);
  }
  const [first, second] = labels;
  if (first !== undefined) {
    if (second === undefined) return `Includes ${first}`;
    if (labels.length === 2) return `Includes ${first}, ${second}`;
    return `Includes ${first}, ${second} and ${labels.length - 2} more`;
  }

  if (entry.text && entry.textNorm && anyWord(entry.textNorm, q)) {
    return `You typed “${clipText(entry.text, NOTE_TEXT_MAX, '…')}”`;
  }
  // A Place-only match: the Place is already in the row's meta line.
  return undefined;
}

// ---------------------------------------------------------------------------
// Grouping and suggestions
// ---------------------------------------------------------------------------

export interface DayGroup {
  day: LogicalDay;
  entries: MealSearchEntry[];
}

/** Contiguous groups of the (newest-first) entries by logicalDay. The screen groups the slice it draws, so a page boundary never splits a day. */
export function groupByDay(entries: readonly MealSearchEntry[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const entry of entries) {
    const last = groups.at(-1);
    if (last && last.day === entry.logicalDay) last.entries.push(entry);
    else groups.push({ day: entry.logicalDay, entries: [entry] });
  }
  return groups;
}

export interface Suggestion {
  label: string;
  count: number;
  placeId?: Id;
}

export interface OftenLogged {
  items: Suggestion[];
  places: Suggestion[];
}

interface OftenOptions {
  items?: number;
  places?: number;
  minCount?: number;
}

/** The most frequent suggestions of `counts` (a Map keeps encounter order, so ties go to the most recent), at least `minCount` times. */
function topSuggestions(counts: Map<string, Suggestion>, limit: number, minCount: number): Suggestion[] {
  return [...counts.values()]
    .filter((s) => s.count >= minCount)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/**
 * What you log most, from the meals themselves (newest first in, so ties go to the latest):
 * items by name (a tray "Ayam goreng" and the mamak one are one thing to you; rice and gravy are
 * skipped as they're on every plate) and Places. Check-in guesses don't count.
 */
export function oftenLogged(index: readonly MealSearchEntry[], opts: OftenOptions = {}): OftenLogged {
  const { items: itemLimit = OFTEN_ITEMS, places: placeLimit = OFTEN_PLACES, minCount = OFTEN_MIN_COUNT } = opts;
  const itemCounts = new Map<string, Suggestion>();
  const placeCounts = new Map<Id, Suggestion>();

  for (const entry of index) {
    if (entry.isGuess) continue;
    const seen = new Set<string>();
    for (const item of entry.items) {
      const key = item.nameNorm;
      if (!key || seen.has(key)) continue;
      const category = item.catalogueId ? byId(item.catalogueId)?.category : undefined;
      if (category === 'rice' || category === 'gravy') continue;
      seen.add(key);
      const found = itemCounts.get(key);
      if (found) found.count += 1;
      else itemCounts.set(key, { label: item.name, count: 1 });
    }
    if (entry.placeId && entry.placeName) {
      const found = placeCounts.get(entry.placeId);
      if (found) found.count += 1;
      else placeCounts.set(entry.placeId, { label: entry.placeName, count: 1, placeId: entry.placeId });
    }
  }

  return { items: topSuggestions(itemCounts, itemLimit, minCount), places: topSuggestions(placeCounts, placeLimit, minCount) };
}
