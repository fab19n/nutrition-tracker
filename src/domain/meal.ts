/**
 * Meal and item maths: macros, ranges and the edits made on the review screen (S11).
 * Items keep a nutrition snapshot, so old meals never change when the catalogue does.
 */
import { roundTo10 } from './format';
import type { CatalogueItem, Finished, KcalRange, Macros, MealItem, MealLog, SourceTag } from './types';

export const FINISHED_FACTOR: Record<Finished, number> = { all: 1, most: 0.75, half: 0.5 };

export function scaleMacros(m: Macros, factor: number): Macros {
  return {
    kcal: m.kcal * factor,
    proteinG: m.proteinG * factor,
    carbsG: m.carbsG * factor,
    fatG: m.fatG * factor,
  };
}

/** unitMacros × quantity. */
export function itemMacros(item: MealItem): Macros {
  return scaleMacros(item.unitMacros, item.quantity);
}

export function sumMacros(list: Macros[]): Macros {
  return list.reduce<Macros>(
    (sum, m) => ({
      kcal: sum.kcal + m.kcal,
      proteinG: sum.proteinG + m.proteinG,
      carbsG: sum.carbsG + m.carbsG,
      fatG: sum.fatG + m.fatG,
    }),
    { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
  );
}

/** Σ items, scaled by how much was finished. */
export function mealMacros(meal: Pick<MealLog, 'items' | 'finished'>): Macros {
  return scaleMacros(sumMacros(meal.items.map(itemMacros)), FINISHED_FACTOR[meal.finished]);
}

function rawRange(item: MealItem): KcalRange {
  const kcal = item.unitMacros.kcal * item.quantity;
  return {
    low: Math.max(0, kcal * (1 - item.uncertainty)),
    high: kcal * (1 + item.uncertainty),
  };
}

/** kcal × (1 ± uncertainty), rounded to 10. */
export function itemRange(item: MealItem): KcalRange {
  const range = rawRange(item);
  return { low: roundTo10(range.low), high: roundTo10(range.high) };
}

/** Σ lows and Σ highs × finished factor, rounded to 10 once at the end (880 → 750–1,010). */
export function itemsRange(items: MealItem[], finished: Finished = 'all'): KcalRange {
  const factor = FINISHED_FACTOR[finished];
  let low = 0;
  let high = 0;
  for (const item of items) {
    const range = rawRange(item);
    low += range.low;
    high += range.high;
  }
  return { low: roundTo10(low * factor), high: roundTo10(high * factor) };
}

export function mealRange(meal: Pick<MealLog, 'items' | 'finished'>): KcalRange {
  return itemsRange(meal.items, meal.finished);
}

function snapshotOf(item: MealItem): NonNullable<MealItem['original']> {
  const snapshot: NonNullable<MealItem['original']> = {
    quantity: item.quantity,
    unitMacros: { ...item.unitMacros },
  };
  if (item.selectedVariant !== undefined) snapshot.selectedVariant = item.selectedVariant;
  return snapshot;
}

/**
 * Applies a user correction. The first correction snapshots the estimate into `original`
 * (kept for audit); `edited` is true while the item differs from that estimate.
 */
function withCorrection(item: MealItem, patch: Pick<Partial<MealItem>, 'selectedVariant' | 'unitMacros' | 'quantity'>): MealItem {
  const original = item.original ?? snapshotOf(item);
  const next: MealItem = { ...item, ...patch, original };
  next.edited =
    next.selectedVariant !== original.selectedVariant ||
    next.quantity !== original.quantity ||
    next.unitMacros.kcal !== original.unitMacros.kcal;
  return next;
}

/** Picks another chip (C22). Out-of-range or unchanged choices return the item as it was. */
export function selectVariant(item: MealItem, index: number): MealItem {
  const variant = item.variants?.[index];
  if (!variant || index === item.selectedVariant) return item;
  return withCorrection(item, { selectedVariant: index, unitMacros: { ...variant.macros } });
}

/** Sets the count (e.g. "Ayam goreng ×2"). Non-positive or non-finite values are ignored. */
export function setQuantity(item: MealItem, quantity: number): MealItem {
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity === item.quantity) return item;
  return withCorrection(item, { quantity });
}

function newId(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * A review-screen item from a catalogue entry, with a snapshot of its chips
 * (show chips only when there is more than one). Pass `id` for deterministic output.
 */
export function itemFromCatalogue(
  c: CatalogueItem,
  opts: { variant?: number; quantity?: number; source?: SourceTag; id?: string } = {},
): MealItem {
  const requested = opts.variant ?? c.defaultVariant;
  const index = c.variants[requested] ? requested : c.variants[c.defaultVariant] ? c.defaultVariant : 0;
  const variant = c.variants[index];
  if (!variant) throw new RangeError(`Catalogue item ${c.id} has no variants`);

  const quantity = opts.quantity !== undefined && Number.isFinite(opts.quantity) && opts.quantity > 0 ? opts.quantity : 1;
  return {
    id: opts.id ?? newId(),
    name: c.name,
    catalogueId: c.id,
    variants: c.variants.map((v) => ({ ...v, macros: { ...v.macros } })),
    selectedVariant: index,
    unitMacros: { ...variant.macros },
    quantity,
    uncertainty: c.uncertainty,
    source: opts.source ?? c.source,
  };
}
