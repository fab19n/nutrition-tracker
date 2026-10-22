/**
 * Your corrections as the estimators and the library read them: which saved ones apply at a
 * Place, how one becomes a review item, and a catalogue entry as you'd have it there. Pure, so
 * the data layer (the top dishes check) and the Log screens share one precedence.
 */
import { byId } from '@/data/catalogue';
import { itemFromCatalogue } from '@/domain/meal';
import type { CatalogueItem, MealItem, PersonalItem, Place } from '@/domain/types';

export function newItemId(): string {
  return globalThis.crypto.randomUUID();
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
export function learnedItem(food: CatalogueItem, ctx: { place?: Place; personal: readonly PersonalItem[] }, id: string = newItemId()): MealItem {
  const mine = applicableCorrections(ctx.personal, ctx.place).filter((p) => p.catalogueId === food.id);
  const chosen = mine.find((p) => p.scope === 'place') ?? mine.find((p) => p.scope === 'dish');
  if (chosen) return itemFromPersonal(chosen, id);
  const learned = ctx.place?.defaultVariants[food.id];
  if (learned !== undefined && food.variants[learned]) return itemFromCatalogue(food, { variant: learned, source: 'yourCorrection', id });
  return itemFromCatalogue(food, { id });
}
