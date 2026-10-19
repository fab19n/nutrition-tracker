/**
 * Picks one catalogue entry when a name means several ("ayam goreng" is both the economy-rice
 * tray piece and the nasi kandar piece; "kuah" is kuah campur or kuah on rice). The Place, the
 * user's corrections and the rest of the meal decide; ties keep catalogue order.
 */
import { byId } from '@/data/catalogue';
import { ECONOMY_RICE } from '@/data/foods/economyRice';
import { HAWKER } from '@/data/foods/hawker';
import { HOME } from '@/data/foods/home';
import { KOPITIAM } from '@/data/foods/kopitiam';
import { MAMAK } from '@/data/foods/mamak';
import { NASI_LEMAK } from '@/data/foods/nasiLemak';
import type { CatalogueItem, PersonalItem, Place, PlaceType } from '@/domain/types';

/** The kind of stall an entry belongs to. 'general' (drinks, kuih, fruit…) is sold everywhere. */
export type Family = 'economyRice' | 'mamak' | 'nasiLemak' | 'hawker' | 'kopitiam' | 'home' | 'general';

const FAMILY_OF = new Map<string, Family>();
const FAMILY_LISTS: [Family, readonly CatalogueItem[]][] = [
  ['economyRice', ECONOMY_RICE],
  ['mamak', MAMAK],
  ['nasiLemak', NASI_LEMAK],
  ['hawker', HAWKER],
  ['kopitiam', KOPITIAM],
  ['home', HOME],
];
for (const [family, items] of FAMILY_LISTS) for (const item of items) FAMILY_OF.set(item.id, family);

export function familyOf(id: string): Family {
  return FAMILY_OF.get(id) ?? 'general';
}

const PLACE_FAMILIES: Record<PlaceType, readonly Family[]> = {
  mamak: ['mamak', 'nasiLemak'],
  economyRice: ['economyRice'],
  kopitiam: ['kopitiam', 'hawker'],
  hawker: ['hawker', 'nasiLemak'],
  home: ['home'],
  other: [],
};

export interface ResolveContext {
  place?: Place;
  /** PersonalItems that apply here (already filtered for the Place). */
  personal: readonly PersonalItem[];
  /** How many unambiguous items of each family the meal already has. */
  familyCounts: ReadonlyMap<Family, number>;
}

const MAX_CONTEXT_BONUS = 3;

/**
 * Names that set the kind of meal on their own: a nasi kandar plate is eaten with tray-looking
 * dishes (telur dadar, bendi), but its ayam goreng and kuah are still the nasi kandar ones.
 * What the user typed outranks where they are: "nasi kandar ayam goreng" logged at an economy-rice
 * stall is still the nasi kandar piece, so an anchor's bonus beats every Place signal combined.
 */
const ANCHOR_COUNT = 10;
const ANCHOR_BONUS = 10;
const ANCHOR_WEIGHT: Readonly<Record<string, number>> = { 'rice-nasi-kandar': ANCHOR_COUNT };

function score(id: string, ctx: ResolveContext): number {
  const family = familyOf(id);
  const { place } = ctx;
  let total = 0;
  if (place) {
    if (PLACE_FAMILIES[place.type].includes(family)) total += 3;
    if (place.trays?.includes(id)) total += 2;
    if (place.defaultVariants[id] !== undefined) total += 2;
  }
  if (ctx.personal.some((p) => p.catalogueId === id)) total += 2;
  if (family !== 'general') {
    const count = ctx.familyCounts.get(family) ?? 0;
    total += count >= ANCHOR_COUNT ? ANCHOR_BONUS : Math.min(count, MAX_CONTEXT_BONUS);
  }
  return total;
}

/** The best catalogue entry for an ambiguous name; unknown ids are skipped. */
export function pickCandidate(ids: readonly string[], ctx: ResolveContext): CatalogueItem | undefined {
  let best: { item: CatalogueItem; score: number } | undefined;
  for (const id of ids) {
    const item = byId(id);
    if (!item) continue;
    const s = ids.length === 1 ? 0 : score(id, ctx);
    if (!best || s > best.score) best = { item, score: s };
  }
  return best?.item;
}

/**
 * Counts the families of names that mean exactly one entry, for context in `pickCandidate`.
 * An anchor ("nasi kandar") counts as much as a whole plate of other names.
 */
export function countFamilies(idLists: readonly (readonly string[])[]): Map<Family, number> {
  const counts = new Map<Family, number>();
  for (const ids of idLists) {
    const only = ids.length === 1 ? ids[0] : undefined;
    if (only === undefined) continue;
    const family = familyOf(only);
    if (family !== 'general') counts.set(family, (counts.get(family) ?? 0) + (ANCHOR_WEIGHT[only] ?? 1));
  }
  return counts;
}
