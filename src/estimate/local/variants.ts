/**
 * Turns modifier words and quantities into an item's portion chips (C22): "kurang" picks
 * Kurang, "besar" the largest portion, "2" the "2 pieces" chip, "half" the Half chip or half
 * a portion.
 */
import { byId } from '@/data/catalogue';
import type { CatalogueItem, Variant } from '@/domain/types';
import type { ModifierKind } from './lexicon';
import { normaliseText } from './normalise';

/** Chip labels each kind looks for, best first (normalised). */
const PREFERRED_LABELS: Record<ModifierKind, readonly string[]> = {
  less: ['sikit', 'small', 'half', 'some', 'kurang'],
  kurang: ['kurang', '50% sugar', 'sikit', 'small', 'half'],
  kosong: ['kosong', '0% sugar', 'zero sugar'],
  banjir: ['banjir'],
  more: ['banjir', 'tambah nasi', 'double', 'mamak big', 'big', 'large', '1.5 scoops'],
  large: ['mamak big', 'big', 'large', 'double', 'tambah nasi', '1.5 scoops'],
  mamakBig: ['mamak big', 'big', 'large'],
  normal: ['normal', 'regular', '1 scoop', 'some'],
  half: ['half'],
  iced: [],
};

/** Drinks with a separate besar entry ("teh tarik" → "teh tarik besar") switch to it. */
const LARGER_SIBLING_SUFFIX = '-besar';

/** Hot drinks and the iced entry an ice request means ("teh o kurang ais" is a teh o ais). */
const ICED_SIBLING: Readonly<Record<string, string>> = {
  'teh-tarik': 'teh-ais',
  'teh-o': 'teh-o-ais',
  kopi: 'kopi-ais',
  'kopi-o': 'kopi-o-ais',
  'milo-panas': 'milo-ais',
};

export type KindResult =
  | { type: 'variant'; index: number }
  | { type: 'sibling'; item: CatalogueItem }
  /** No Half chip: eat half of the portion instead. */
  | { type: 'factor'; factor: number }
  /** "normal" on an item without a Normal chip: the catalogue default, said explicitly. */
  | { type: 'default' };

export function labelsOf(variants: readonly Variant[] | undefined): string[] {
  return (variants ?? []).map((v) => normaliseText(v.label));
}

/**
 * What a modifier means for an item with these chip labels, or undefined when it can't apply
 * (sugar words on rice, "banjir" on fried chicken).
 */
export function resolveKind(kind: ModifierKind, labels: readonly string[], item?: CatalogueItem): KindResult | undefined {
  for (const wanted of PREFERRED_LABELS[kind]) {
    const index = labels.indexOf(wanted);
    if (index >= 0) return { type: 'variant', index };
  }
  if (kind === 'large' && item) {
    const sibling = byId(item.id + LARGER_SIBLING_SUFFIX);
    if (sibling) return { type: 'sibling', item: sibling };
  }
  if (kind === 'iced' && item) {
    const iced = ICED_SIBLING[item.id];
    const sibling = iced === undefined ? undefined : byId(iced);
    if (sibling) return { type: 'sibling', item: sibling };
  }
  if (kind === 'half') return { type: 'factor', factor: 0.5 };
  if (kind === 'normal') return { type: 'default' };
  return undefined;
}

/** "2 pieces" → 2, "1.5 scoops" → 1.5, "Normal" → undefined. */
export function countOf(label: string): number | undefined {
  const match = /^(\d+(?:\.\d+)?) [a-z]/.exec(label);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

/**
 * A typed quantity on an item with counted chips: "2" picks "2 pieces"; "3" with only
 * "1 piece / 2 pieces" picks "1 piece" × 3; counts with no single-unit chip scale the nearest
 * chip ("20 cucuk" → "10 sticks" × 2, "4 ulas" → "3 seeds" × 4/3). Undefined when the item has
 * no counted chips, or when another word already picked a chip that isn't a count.
 */
export function countedChoice(
  labels: readonly string[],
  quantity: number,
  current: number | undefined,
): { index: number; quantity: number } | undefined {
  const counts = labels.map(countOf);
  if (!counts.some((c) => c !== undefined)) return undefined;
  if (current !== undefined && counts[current] === undefined) return undefined;

  const exact = counts.indexOf(quantity);
  if (exact >= 0) return { index: exact, quantity: 1 };
  const single = counts.indexOf(1);
  if (single >= 0) return { index: single, quantity };

  let nearest = -1;
  counts.forEach((count, index) => {
    if (count === undefined) return;
    const best = nearest >= 0 ? counts[nearest] : undefined;
    if (best === undefined || Math.abs(count - quantity) < Math.abs(best - quantity)) nearest = index;
  });
  const chipCount = counts[nearest];
  if (nearest < 0 || chipCount === undefined) return undefined;
  return { index: nearest, quantity: Math.round((quantity / chipCount) * 100) / 100 };
}

/** A count past 20 only makes sense for small things: a satay stick, a durian seed, a yong tau foo piece. */
const MAX_KCAL_PER_COUNTED_UNIT = 100;

/** True when the item is counted in small units ("5 sticks" at ~46 kcal a stick), so "30" can be a count. */
export function takesLargeCounts(variants: readonly Variant[] | undefined): boolean {
  return (variants ?? []).some((v) => {
    const count = countOf(normaliseText(v.label));
    return count !== undefined && count > 0 && v.macros.kcal / count <= MAX_KCAL_PER_COUNTED_UNIT;
  });
}

/** max − min kcal across the chips: how much answering a question can move the total. */
export function variantSpread(variants: readonly Variant[] | undefined): number {
  if (!variants || variants.length < 2) return 0;
  const kcal = variants.map((v) => v.macros.kcal);
  return Math.max(...kcal) - Math.min(...kcal);
}
