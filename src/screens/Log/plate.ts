/**
 * Economy-rice plate (S24): rice chips, tray dishes counted 0 → 1 → 2, kuah on rice.
 * The builder starts from the last plate at this Place; with none, from the Place's learned
 * portions and the catalogue defaults.
 */
import type { DishCount } from '@/components/DishTile/DishTile';
import { byId, trayDishes, type PlateGroup } from '@/data/catalogue';
import type { PlateHistory } from '@/db/logging';
import { itemFromCatalogue } from '@/domain/meal';
import type { CatalogueItem, MealItem, Place } from '@/domain/types';

export const RICE_ID = 'rice-economy';
export const KUAH_ID = 'kuah-on-rice';

export const PLATE_GROUPS: readonly { group: PlateGroup; label: string }[] = [
  { group: 'protein', label: 'Protein' },
  { group: 'vegetables', label: 'Vegetables' },
  { group: 'tofuEgg', label: 'Tofu and egg' },
];

export interface PlateSelection {
  riceIdx: number;
  kuahIdx: number;
  /** Catalogue id → count on the plate. */
  counts: Record<string, DishCount>;
  /** Dishes added by search that aren't on this stall's trays. */
  extras: string[];
}

function food(id: string): CatalogueItem {
  const item = byId(id);
  if (!item) throw new Error(`Catalogue item ${id} is missing`);
  return item;
}

export const RICE = food(RICE_ID);
export const KUAH = food(KUAH_ID);

function toCount(quantity: number): DishCount {
  return quantity >= 2 ? 2 : quantity > 0 ? 1 : 0;
}

/** Rice, kuah and dish counts read back from saved plate items (a previous plate, or the draft). */
export function selectionFromItems(items: readonly MealItem[], place?: Place): PlateSelection {
  const base = emptySelection(place);
  const rice = items.find((i) => i.catalogueId === RICE_ID);
  const kuah = items.find((i) => i.catalogueId === KUAH_ID);
  const counts: Record<string, DishCount> = {};
  for (const item of items) {
    if (!item.catalogueId || !byId(item.catalogueId)?.plateGroup) continue;
    counts[item.catalogueId] = toCount((counts[item.catalogueId] ?? 0) + item.quantity);
  }
  return {
    riceIdx: rice?.selectedVariant ?? base.riceIdx,
    // A plate saved without kuah had none.
    kuahIdx: kuah ? (kuah.selectedVariant ?? base.kuahIdx) : 0,
    counts,
    extras: [],
  };
}

export function emptySelection(place?: Place): PlateSelection {
  const rice = place?.defaultVariants[RICE_ID];
  const kuah = place?.defaultVariants[KUAH_ID];
  return {
    riceIdx: rice !== undefined && RICE.variants[rice] ? rice : RICE.defaultVariant,
    kuahIdx: kuah !== undefined && KUAH.variants[kuah] ? kuah : KUAH.defaultVariant,
    counts: {},
    extras: [],
  };
}

export function defaultSelection(place: Place | undefined, history: PlateHistory | undefined): PlateSelection {
  return history?.last ? selectionFromItems(history.last.items, place) : emptySelection(place);
}

/** The grid's dishes: the stall's trays (else every tray dish), plus anything already on the plate or added. */
export function gridDishIds(place: Place | undefined, selection: PlateSelection): string[] {
  const base = place?.trays?.length ? place.trays : trayDishes().map((d) => d.id);
  const ids = [...base];
  for (const id of [...Object.keys(selection.counts), ...selection.extras]) {
    if (!ids.includes(id) && byId(id)?.plateGroup) ids.push(id);
  }
  return ids;
}

export function groupDishes(ids: readonly string[], group: PlateGroup): CatalogueItem[] {
  return ids.flatMap((id) => {
    const dish = byId(id);
    return dish && dish.plateGroup === group ? [dish] : [];
  });
}

/** Rice, then the dishes in grid order, then kuah. Pass `newId` for the review; ids default to catalogue ids. */
export function plateItems(selection: PlateSelection, ids: readonly string[], newId?: () => string): MealItem[] {
  const id = (fallback: string) => (newId ? newId() : fallback);
  const dishes = PLATE_GROUPS.flatMap(({ group }) => groupDishes(ids, group))
    .filter((dish) => (selection.counts[dish.id] ?? 0) > 0)
    .map((dish) => itemFromCatalogue(dish, { quantity: selection.counts[dish.id] ?? 1, id: id(dish.id) }));
  return [
    itemFromCatalogue(RICE, { variant: selection.riceIdx, id: id(RICE_ID) }),
    ...dishes,
    itemFromCatalogue(KUAH, { variant: selection.kuahIdx, id: id(KUAH_ID) }),
  ];
}
