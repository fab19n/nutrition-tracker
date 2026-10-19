/**
 * Your library as the logging screens search it: corrections (layer 1), Usuals and the
 * starter catalogue, with the Place's learned defaults applied. Used by the Log sheet's
 * instant matches, the Review "Add item" / "Swap item" search and the S47 fallback.
 */
import { SOURCE_LABEL } from '@/components/SourceTag/SourceTag';
import { byId, normaliseName, searchCatalogue } from '@/data/catalogue';
import type { OrderOption } from '@/db/logging';
import { itemFromCatalogue } from '@/domain/meal';
import type { CatalogueItem, MealItem, PersonalItem, Place, SourceTag, Usual } from '@/domain/types';
import { GUESS_DEFAULT_KCAL, GUESS_NORMAL_INDEX, GUESS_QUESTION, GUESS_UNCERTAINTY, guessMacrosFor, guessVariants } from '@/estimate/local/guess';
import { estimateLocally } from '@/estimate/localEstimator';

export function newItemId(): string {
  return globalThis.crypto.randomUUID();
}

export interface LibraryContext {
  place?: Place;
  personal: readonly PersonalItem[];
  usuals?: readonly Usual[];
}

/** Corrections that apply here: everywhere ones, and ones saved for this Place. */
export function applicableCorrections(personal: readonly PersonalItem[], place: Place | undefined): PersonalItem[] {
  return personal.filter((p) => p.scope === 'dish' || (place !== undefined && p.placeId === place.id));
}

/** A review item from a saved correction. */
export function itemFromPersonal(p: PersonalItem, id: string = newItemId()): MealItem {
  const food = p.catalogueId ? byId(p.catalogueId) : undefined;
  const variants = p.variants ?? food?.variants;
  const item: MealItem = {
    id,
    name: p.name || food?.name || 'Item',
    unitMacros: { ...p.unitMacros },
    quantity: 1,
    uncertainty: p.uncertainty,
    source: 'yourCorrection',
  };
  if (p.catalogueId) item.catalogueId = p.catalogueId;
  if (variants && p.selectedVariant !== undefined && variants[p.selectedVariant]) {
    item.variants = variants.map((v) => ({ ...v, macros: { ...v.macros } }));
    item.selectedVariant = p.selectedVariant;
  }
  return item;
}

/**
 * A catalogue entry as you'd have it here: your correction for this Place, then for the dish,
 * then the Place's learned portion, else the catalogue default.
 */
export function learnedItem(food: CatalogueItem, ctx: Pick<LibraryContext, 'place' | 'personal'>, id: string = newItemId()): MealItem {
  const mine = applicableCorrections(ctx.personal, ctx.place).filter((p) => p.catalogueId === food.id);
  const chosen = mine.find((p) => p.scope === 'place') ?? mine.find((p) => p.scope === 'dish');
  if (chosen) return itemFromPersonal(chosen, id);
  const learned = ctx.place?.defaultVariants[food.id];
  if (learned !== undefined && food.variants[learned]) return itemFromCatalogue(food, { variant: learned, source: 'yourCorrection', id });
  return itemFromCatalogue(food, { id });
}

/** Copies of saved items for a new meal: new ids, no audit trail or open state carried over. */
export function freshItems(items: readonly MealItem[]): MealItem[] {
  return items.map((item) => {
    const { original: _original, edited: _edited, question: _question, ...rest } = item;
    return { ...rest, id: newItemId(), unitMacros: { ...item.unitMacros } };
  });
}

/** "your correction", "Catalogue", "MyFCD". */
export function sourceDetail(source: SourceTag): string {
  return source === 'yourCorrection' ? 'your correction' : SOURCE_LABEL[source];
}

/** "Teh o ais kurang": the item name plus a chip that isn't the usual one. */
export function itemDisplayName(item: MealItem): string {
  const food = item.catalogueId ? byId(item.catalogueId) : undefined;
  const label = item.selectedVariant !== undefined ? item.variants?.[item.selectedVariant]?.label : undefined;
  if (!label || !food || food.defaultVariant === item.selectedVariant || food.variants.length < 2) return item.name;
  if (/^\d/.test(label)) return item.name;
  return `${item.name} ${label.toLocaleLowerCase()}`;
}

export function itemsKcal(items: readonly MealItem[]): number {
  return items.reduce((sum, item) => sum + item.unitMacros.kcal * item.quantity, 0);
}

export interface LibraryResult {
  id: string;
  name: string;
  /** "your correction", "your usual", "Catalogue". */
  detail: string;
  kcal: number;
  /** The items this pick adds (a Usual adds all of its items). */
  build: () => MealItem[];
}

function matchesQuery(name: string, q: string): boolean {
  if (!q) return true;
  const n = normaliseName(name);
  return n.startsWith(q) || n.includes(` ${q}`) || (q.length >= 3 && n.includes(q));
}

/** Search results for ItemSearch: corrections, then Usuals, then the catalogue. */
export function searchLibrary(query: string, ctx: LibraryContext, limit = 8): LibraryResult[] {
  const q = normaliseName(query);
  const results: LibraryResult[] = [];
  const seenCatalogue = new Set<string>();

  for (const p of applicableCorrections(ctx.personal, ctx.place)) {
    if (!matchesQuery(p.name, q)) continue;
    // A correction for this Place hides the everywhere one for the same food.
    if (p.catalogueId && seenCatalogue.has(p.catalogueId)) continue;
    const item = p.catalogueId && byId(p.catalogueId) ? learnedItem(byId(p.catalogueId) as CatalogueItem, ctx) : itemFromPersonal(p);
    if (p.catalogueId) seenCatalogue.add(p.catalogueId);
    results.push({ id: `personal:${p.id}`, name: itemDisplayName(item), detail: 'your correction', kcal: item.unitMacros.kcal, build: () => [{ ...item, id: newItemId() }] });
  }

  const usuals = ctx.usuals ?? [];
  const shownUsuals = q ? usuals.filter((u) => matchesQuery(u.name, q)) : usuals.slice(0, 3);
  for (const usual of shownUsuals) {
    results.push({
      id: `usual:${usual.id}`,
      name: usual.name,
      detail: usual.placeId && usual.placeId === ctx.place?.id ? 'your usual here' : 'your usual',
      kcal: itemsKcal(usual.items),
      build: () => freshItems(usual.items),
    });
  }

  if (q) {
    for (const food of searchCatalogue(q, limit)) {
      if (seenCatalogue.has(food.id)) continue;
      seenCatalogue.add(food.id);
      const item = learnedItem(food, ctx);
      results.push({
        id: `catalogue:${food.id}`,
        name: itemDisplayName(item),
        detail: sourceDetail(item.source),
        kcal: item.unitMacros.kcal,
        build: () => [{ ...item, id: newItemId() }],
      });
    }
  }
  return results.slice(0, limit);
}

/**
 * Something the library doesn't have ("Add 'roti tisu'"): the local estimator reads it, and
 * anything it can't place becomes an AI guess with a wide range and a size question.
 */
export function customItems(name: string, ctx: Pick<LibraryContext, 'place' | 'personal'>): MealItem[] {
  const clean = name.trim().replace(/\s+/g, ' ');
  if (!clean) return [];
  const local = estimateLocally({ text: clean }, ctx.place ? { place: ctx.place, personal: [...ctx.personal] } : { personal: [...ctx.personal] });
  if (local.items.length > 0) return local.items;
  const variants = guessVariants(guessMacrosFor(GUESS_DEFAULT_KCAL));
  const normal = variants[GUESS_NORMAL_INDEX];
  return [
    {
      id: newItemId(),
      name: clean.charAt(0).toLocaleUpperCase() + clean.slice(1),
      variants,
      selectedVariant: GUESS_NORMAL_INDEX,
      unitMacros: { ...(normal?.macros ?? guessMacrosFor(GUESS_DEFAULT_KCAL)) },
      quantity: 1,
      uncertainty: GUESS_UNCERTAINTY,
      source: 'aiGuess',
      question: GUESS_QUESTION,
    },
  ];
}

/** "Enter kcal yourself" (S47): your own number, so it counts as your correction. */
export function manualItem(name: string, kcal: number): MealItem {
  const clean = name.trim().replace(/\s+/g, ' ') || 'Meal';
  return {
    id: newItemId(),
    name: clean.charAt(0).toLocaleUpperCase() + clean.slice(1),
    unitMacros: { kcal: Math.round(kcal), proteinG: 0, carbsG: 0, fatG: 0 },
    quantity: 1,
    uncertainty: 0.15,
    source: 'yourCorrection',
  };
}

// ---------------------------------------------------------------------------
// Instant matches under the Log input (S09)
// ---------------------------------------------------------------------------

export type LogMatch =
  | { kind: 'order'; id: string; name: string; detail: string; kcal: number; order: OrderOption }
  | { kind: 'item'; id: string; name: string; detail: string; kcal: number; item: MealItem };

/** Pieces of a typed meal: "a, b + c dan d" → ["a", "b", "c", "d"]. */
function pieces(text: string): string[] {
  return text
    .split(/,|\+|\n|\band\b|\bdan\b|\bdengan\b|\bwith\b/i)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function orderMatches(name: string, q: string): boolean {
  const n = normaliseName(name);
  if (!n || q.length < 2) return false;
  return n.startsWith(q) || n.includes(` ${q}`) || q.startsWith(n);
}

/**
 * While typing: whole orders (Usuals and the Place's usual orders) matching the start of the
 * text, then foods matching the piece being typed, read by the local estimator so portion
 * words and your corrections apply. No AI.
 */
export function buildLogMatches(
  text: string,
  ctx: { place?: Place; personal: readonly PersonalItem[]; orders: readonly OrderOption[] },
  limit = 4,
): LogMatch[] {
  const parts = pieces(text);
  const first = normaliseName(parts[0] ?? '');
  const last = parts.at(-1) ?? '';
  const lastQ = normaliseName(last);
  if (first.length < 2) return [];

  const matches: LogMatch[] = [];
  const seenOrders = new Set<string>();
  for (const order of ctx.orders) {
    const key = normaliseName(order.name);
    if (seenOrders.has(key) || !orderMatches(order.name, first)) continue;
    seenOrders.add(key);
    const here = order.placeId !== undefined && order.placeId === ctx.place?.id;
    matches.push({ kind: 'order', id: order.id, name: order.name, detail: here ? 'your usual here' : 'your usual', kcal: order.kcal, order });
    if (matches.length >= 2) break;
  }

  if (lastQ.length >= 2) {
    const estimateCtx = ctx.place ? { place: ctx.place, personal: [...ctx.personal] } : { personal: [...ctx.personal] };
    const seen = new Set<string>();
    const read = estimateLocally({ text: last }, estimateCtx).items.filter((i) => i.source !== 'aiGuess');
    const prefix = searchCatalogue(lastQ, limit).map((food) => learnedItem(food, ctx));
    for (const item of [...read, ...prefix]) {
      const key = item.catalogueId ?? normaliseName(item.name);
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push({
        kind: 'item',
        id: `item:${key}`,
        name: itemDisplayName(item),
        detail: sourceDetail(item.source),
        kcal: item.unitMacros.kcal * item.quantity,
        item,
      });
      if (matches.length >= limit) break;
    }
  }
  return matches.slice(0, limit);
}
