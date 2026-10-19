import type { CatalogueItem } from '@/domain/types';
import { dish, macros, scaled } from '../define';

/** Kopitiam breakfast and bread. Kopitiam drinks live in drinks.ts. */
export const KOPITIAM: CatalogueItem[] = [
  dish({
    id: 'kaya',
    name: 'Kaya',
    aliases: ['seri kaya', 'kaya spread', 'coconut jam'],
    category: 'snack',
    unit: 'a tbsp',
    variants: scaled(macros(60, 0.8, 9, 2.3), [
      ['1 tbsp', 60, 20],
      ['2 tbsp', 120, 40],
    ]),
    note: 'Coconut and egg jam, about 20 g a tablespoon.',
  }),
  dish({
    id: 'kaya-toast-kopi',
    name: 'Bread, kaya, kopi',
    aliases: ['bread kaya kopi', 'kaya toast set', 'roti bakar set', 'roti kaya kopi', 'roti bakar kopi', 'kopitiam set'],
    category: 'bread',
    unit: 'a set',
    variants: scaled(macros(380, 8, 55, 14), [['1 set', 380]]),
    uncertainty: 0.2,
    note: 'Two slices of toast with kaya and butter, and a kopi with condensed milk.',
    swaps: ['half-boiled-eggs'],
  }),
  dish({
    id: 'kaya-toast',
    name: 'Roti bakar kaya',
    aliases: ['kaya toast', 'roti bakar', 'roti kaya', 'roti bakar kaya butter', 'kaya butter toast', 'roti kahwin'],
    category: 'bread',
    unit: 'a slice',
    variants: scaled(macros(250, 5, 32, 11), [
      ['2 slices', 250, 80],
      ['4 slices', 500, 160],
    ]),
    uncertainty: 0.2,
    note: 'Toast with kaya and a slab of butter, about 125 kcal a slice.',
  }),
  dish({
    id: 'half-boiled-eggs',
    name: 'Telur separuh masak',
    aliases: ['half boiled eggs', 'half-boiled eggs', 'half boiled egg', 'soft boiled eggs', 'telur setengah masak'],
    category: 'tofuEgg',
    unit: 'an egg',
    variants: scaled(macros(150, 12.5, 1.5, 10.5), [
      ['1 egg', 75, 50],
      ['2 eggs', 150, 100],
    ]),
    defaultVariant: 1,
    note: 'Soft-boiled eggs with a dash of soy sauce and pepper.',
  }),
  dish({
    id: 'roti-putih',
    name: 'Roti putih',
    aliases: ['bread', 'white bread', 'sandwich bread', 'gardenia', 'roti gardenia', 'toast', 'plain toast', 'roti bakar kosong'],
    category: 'bread',
    unit: 'a slice',
    variants: scaled(macros(75, 2.5, 14, 0.9), [
      ['1 slice', 75, 30],
      ['2 slices', 150, 60],
    ]),
    defaultVariant: 1,
    note: 'Plain sandwich bread, about 30 g a slice. Spreads not included.',
  }),
  dish({
    id: 'roti-wholemeal',
    name: 'Roti wholemeal',
    aliases: ['wholemeal bread', 'whole wheat bread', 'roti gandum', 'brown bread'],
    category: 'bread',
    unit: 'a slice',
    variants: scaled(macros(70, 3, 12, 1), [
      ['1 slice', 70, 30],
      ['2 slices', 140, 60],
    ]),
    defaultVariant: 1,
    note: 'Wholemeal sandwich bread, about 30 g a slice. Spreads not included.',
  }),
];
