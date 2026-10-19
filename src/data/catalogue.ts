/**
 * Starter food catalogue (layer 2 of the four food-data layers, plan §14).
 *
 * About 200 typical Malaysian dishes, drinks and pot ingredients, each with portion choices
 * (absolute macros per choice), a range, a note on what the values assume and lighter swaps.
 * Values are typical-portion estimates (source 'catalogue'), not yet verified against MyFCD.
 * Meals snapshot their values at log time, so editing an entry never changes past meals.
 */
import type { CatalogueItem, Variant } from '@/domain/types';
import { DRINKS } from './foods/drinks';
import { ECONOMY_RICE, PLATE_BASE_IDS } from './foods/economyRice';
import { FRUIT } from './foods/fruit';
import { HAWKER } from './foods/hawker';
import { HOME } from './foods/home';
import { INGREDIENTS } from './foods/ingredients';
import { KOPITIAM } from './foods/kopitiam';
import { KUIH } from './foods/kuih';
import { MAMAK } from './foods/mamak';
import { NASI_LEMAK } from './foods/nasiLemak';
import { SNACKS } from './foods/snacks';

export { PLATE_BASE_IDS };

export type PlateGroup = NonNullable<CatalogueItem['plateGroup']>;

/** Order matters: ties in search and the plate builder grid follow this order. */
export const CATALOGUE: CatalogueItem[] = [
  ...ECONOMY_RICE,
  ...MAMAK,
  ...NASI_LEMAK,
  ...HAWKER,
  ...KOPITIAM,
  ...HOME,
  ...KUIH,
  ...SNACKS,
  ...FRUIT,
  ...DRINKS,
  ...INGREDIENTS,
];

const BY_ID = new Map(CATALOGUE.map((item) => [item.id, item]));

export function byId(id: string): CatalogueItem | undefined {
  return BY_ID.get(id);
}

/**
 * Lowercase, no accents, apostrophes dropped, "&" read as "and", any other punctuation or
 * run of spaces becomes one space: "Teh-O  Ais" → "teh o ais", "F&N" → "f and n".
 */
export function normaliseName(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export interface CatalogueTerm {
  /** Normalised name or alias. */
  term: string;
  id: string;
  isName: boolean;
}

/** Every normalised name and alias with the item it belongs to, in catalogue order. */
export const CATALOGUE_TERMS: readonly CatalogueTerm[] = CATALOGUE.flatMap((item) => [
  { term: normaliseName(item.name), id: item.id, isName: true },
  ...item.aliases.map((alias) => ({ term: normaliseName(alias), id: item.id, isName: false })),
]).filter((t) => t.term.length > 0);

function buildNameIndex(terms: readonly CatalogueTerm[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const { term, id } of terms) {
    const ids = index.get(term);
    if (!ids) index.set(term, [id]);
    else if (!ids.includes(id)) ids.push(id);
  }
  return index;
}

/**
 * Normalised name or alias → catalogue ids. One term can name several items
 * ("ayam goreng" is both the economy-rice tray piece and the nasi kandar piece); the caller
 * picks using the Place type.
 */
export const NAME_INDEX: ReadonlyMap<string, readonly string[]> = buildNameIndex(CATALOGUE_TERMS);

/** Exact match on a normalised name or alias. */
export function findByName(text: string): CatalogueItem[] {
  const ids = NAME_INDEX.get(normaliseName(text)) ?? [];
  return ids.flatMap((id) => BY_ID.get(id) ?? []);
}

/** 0 exact · 1 starts with · 2 a word starts with · 3 contains. */
function matchRank(term: string, query: string): number | undefined {
  if (term === query) return 0;
  if (term.startsWith(query)) return 1;
  if (` ${term}`.includes(` ${query}`)) return 2;
  if (term.includes(query)) return 3;
  return undefined;
}

/**
 * Instant matches while typing (S09). Ranks exact, then prefix, then word-prefix, then substring
 * matches; a name beats an alias at the same rank; ties keep catalogue order.
 */
export function searchCatalogue(query: string, limit = 8): CatalogueItem[] {
  const q = normaliseName(query);
  if (!q || limit <= 0) return [];
  const best = new Map<string, number>();
  for (const { term, id, isName } of CATALOGUE_TERMS) {
    const rank = matchRank(term, q);
    if (rank === undefined) continue;
    const score = rank * 2 + (isName ? 0 : 1);
    const previous = best.get(id);
    if (previous === undefined || score < previous) best.set(id, score);
  }
  return [...best.entries()]
    .sort((a, b) => a[1] - b[1])
    .slice(0, limit)
    .flatMap(([id]) => BY_ID.get(id) ?? []);
}

/** The portion chosen when nothing else is known. */
export function defaultVariantOf(item: CatalogueItem): Variant {
  const chosen = item.variants[item.defaultVariant] ?? item.variants[0];
  if (!chosen) throw new Error(`Catalogue item ${item.id} has no variants`);
  return chosen;
}

/** Economy-rice tray dishes for the plate builder, in grid order; all groups when none is given. */
export function trayDishes(group?: PlateGroup): CatalogueItem[] {
  return CATALOGUE.filter((item) => item.plateGroup !== undefined && (group === undefined || item.plateGroup === group));
}
