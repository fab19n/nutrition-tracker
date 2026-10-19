import {
  FINISHED_FACTOR,
  itemFromCatalogue,
  itemMacros,
  itemRange,
  itemsRange,
  mealMacros,
  mealRange,
  selectVariant,
  setQuantity,
  sumMacros,
} from './meal';
import type { CatalogueItem, Macros, MealItem } from './types';

function macros(kcal: number, proteinG = 0, carbsG = 0, fatG = 0): Macros {
  return { kcal, proteinG, carbsG, fatG };
}

function item(kcal: number, extra: Partial<MealItem> = {}): MealItem {
  return {
    id: `item-${kcal}`,
    name: 'Item',
    unitMacros: macros(kcal, 10, 20, 5),
    quantity: 1,
    uncertainty: 0.15,
    source: 'catalogue',
    ...extra,
  };
}

const rice: CatalogueItem = {
  id: 'rice-white',
  name: 'Rice',
  aliases: ['nasi putih'],
  category: 'rice',
  unit: 'a scoop',
  variants: [
    { id: 'half', label: 'Half', macros: macros(100, 2, 22, 0) },
    { id: 'scoop', label: '1 scoop', macros: macros(200, 4, 44, 0) },
    { id: 'mamak', label: 'Mamak big', macros: macros(430, 8, 95, 1) },
  ],
  defaultVariant: 1,
  uncertainty: 0.15,
  source: 'myfcd',
};

describe('FINISHED_FACTOR', () => {
  it('scales all, most and half', () => {
    expect(FINISHED_FACTOR).toEqual({ all: 1, most: 0.75, half: 0.5 });
  });
});

describe('macros', () => {
  it('multiplies unit macros by quantity', () => {
    expect(itemMacros(item(280, { quantity: 2 }))).toEqual(macros(560, 20, 40, 10));
  });

  it('sums a list of macros', () => {
    expect(sumMacros([macros(360, 8, 50, 14), macros(200, 4, 30, 6)])).toEqual(macros(560, 12, 80, 20));
    expect(sumMacros([])).toEqual(macros(0));
  });

  it('applies the finished factor to a meal', () => {
    const items = [item(360), item(200)];
    expect(mealMacros({ items, finished: 'all' }).kcal).toBe(560);
    expect(mealMacros({ items, finished: 'most' })).toEqual(macros(420, 15, 30, 7.5));
    expect(mealMacros({ items, finished: 'half' }).kcal).toBe(280);
  });
});

describe('ranges', () => {
  it('gives an item ±uncertainty rounded to 10', () => {
    expect(itemRange(item(880))).toEqual({ low: 750, high: 1010 });
    expect(itemRange(item(200))).toEqual({ low: 170, high: 230 });
    expect(itemRange(item(280, { quantity: 2 }))).toEqual({ low: 480, high: 640 });
  });

  it('gives a meal of 880 kcal the range 750–1,010', () => {
    const meal = [item(450), item(230), item(200)];
    expect(itemsRange(meal)).toEqual({ low: 750, high: 1010 });
    expect(mealRange({ items: meal, finished: 'all' })).toEqual({ low: 750, high: 1010 });
  });

  it('rounds once at the end, not per item', () => {
    // Per-item rounding would give 30 + 30 + 30 = 90 for the low end.
    const meal = [item(33), item(33), item(33)];
    expect(itemsRange(meal)).toEqual({ low: 80, high: 110 });
  });

  it('scales the range by how much was finished', () => {
    const meal = [item(450), item(230), item(200)];
    expect(itemsRange(meal, 'half')).toEqual({ low: 370, high: 510 });
    expect(itemsRange(meal, 'most')).toEqual({ low: 560, high: 760 });
  });

  it('uses each item’s own uncertainty', () => {
    const meal = [item(400, { uncertainty: 0.35 }), item(200)];
    expect(itemsRange(meal)).toEqual({ low: 430, high: 770 });
  });

  it('never goes below zero', () => {
    expect(itemRange(item(100, { uncertainty: 1.5 }))).toEqual({ low: 0, high: 250 });
  });
});

describe('itemFromCatalogue', () => {
  it('uses the default variant and snapshots the chips', () => {
    const it1 = itemFromCatalogue(rice, { id: 'a' });
    expect(it1).toEqual({
      id: 'a',
      name: 'Rice',
      catalogueId: 'rice-white',
      variants: rice.variants,
      selectedVariant: 1,
      unitMacros: macros(200, 4, 44, 0),
      quantity: 1,
      uncertainty: 0.15,
      source: 'myfcd',
    });
    expect(it1.variants).not.toBe(rice.variants);
    expect(it1.variants?.[1]?.macros).not.toBe(rice.variants[1]?.macros);
    expect(it1.unitMacros).not.toBe(rice.variants[1]?.macros);
  });

  it('takes a variant, quantity and source', () => {
    const it1 = itemFromCatalogue(rice, { id: 'b', variant: 2, quantity: 2, source: 'yourCorrection' });
    expect(it1.selectedVariant).toBe(2);
    expect(it1.unitMacros.kcal).toBe(430);
    expect(it1.quantity).toBe(2);
    expect(it1.source).toBe('yourCorrection');
    expect(itemMacros(it1).kcal).toBe(860);
  });

  it('falls back to the default variant for an unknown index and to 1 for a bad quantity', () => {
    const it1 = itemFromCatalogue(rice, { id: 'c', variant: 9, quantity: 0 });
    expect(it1.selectedVariant).toBe(1);
    expect(it1.quantity).toBe(1);
  });

  it('generates an id when none is given', () => {
    const a = itemFromCatalogue(rice);
    const b = itemFromCatalogue(rice);
    expect(a.id).toMatch(/\S+/);
    expect(a.id).not.toBe(b.id);
  });

  it('does not set an original or edited flag', () => {
    const it1 = itemFromCatalogue(rice, { id: 'd' });
    expect(it1.original).toBeUndefined();
    expect(it1.edited).toBeUndefined();
  });

  it('throws for an entry without variants', () => {
    expect(() => itemFromCatalogue({ ...rice, variants: [] })).toThrow(RangeError);
  });
});

describe('selectVariant', () => {
  const base = itemFromCatalogue(rice, { id: 'r' });

  it('switches macros, sets edited and keeps the original estimate', () => {
    const big = selectVariant(base, 2);
    expect(big.selectedVariant).toBe(2);
    expect(big.unitMacros).toEqual(macros(430, 8, 95, 1));
    expect(big.edited).toBe(true);
    expect(big.original).toEqual({ selectedVariant: 1, quantity: 1, unitMacros: macros(200, 4, 44, 0) });
    expect(base.selectedVariant).toBe(1);
  });

  it('keeps the first original across several corrections', () => {
    const half = selectVariant(selectVariant(base, 2), 0);
    expect(half.unitMacros.kcal).toBe(100);
    expect(half.original?.selectedVariant).toBe(1);
    expect(half.original?.unitMacros.kcal).toBe(200);
    expect(half.edited).toBe(true);
  });

  it('clears edited when going back to the estimate, but keeps original for audit', () => {
    const back = selectVariant(selectVariant(base, 2), 1);
    expect(back.edited).toBe(false);
    expect(back.original?.selectedVariant).toBe(1);
  });

  it('ignores unknown or unchanged choices', () => {
    expect(selectVariant(base, 7)).toBe(base);
    expect(selectVariant(base, 1)).toBe(base);
    expect(selectVariant(item(100), 0)).toEqual(item(100));
  });
});

describe('setQuantity', () => {
  const base = itemFromCatalogue(rice, { id: 'q' });

  it('sets the count and marks the item edited', () => {
    const two = setQuantity(base, 2);
    expect(two.quantity).toBe(2);
    expect(two.edited).toBe(true);
    expect(two.original).toEqual({ selectedVariant: 1, quantity: 1, unitMacros: macros(200, 4, 44, 0) });
    expect(itemMacros(two).kcal).toBe(400);
  });

  it('combines with variant changes against one original', () => {
    const edited = setQuantity(selectVariant(base, 0), 3);
    expect(edited.original?.quantity).toBe(1);
    expect(edited.original?.selectedVariant).toBe(1);
    expect(itemMacros(edited).kcal).toBe(300);
    expect(setQuantity(selectVariant(edited, 1), 1).edited).toBe(false);
  });

  it('ignores zero, negative, non-finite and unchanged values', () => {
    expect(setQuantity(base, 0)).toBe(base);
    expect(setQuantity(base, -1)).toBe(base);
    expect(setQuantity(base, Number.NaN)).toBe(base);
    expect(setQuantity(base, 1)).toBe(base);
  });
});
