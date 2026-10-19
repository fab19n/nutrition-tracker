import type { CatalogueItem } from '@/domain/types';
import { dish, macros, scaled } from '../define';

/**
 * Cooking ingredients for pots (S27), so a recipe like "1 ekor ayam, 1 tin santan, 3 kentang,
 * 4 sudu minyak" can be split offline. Not meant for logging a meal directly.
 */
export const INGREDIENTS: CatalogueItem[] = [
  dish({
    id: 'minyak-masak',
    name: 'Cooking oil',
    aliases: ['minyak', 'minyak masak', 'minyak sayur', 'oil', 'palm oil', 'sudu minyak'],
    category: 'other',
    unit: 'a tbsp',
    variants: scaled(macros(480, 0, 0, 54), [
      ['2 tbsp', 240, 27],
      ['4 tbsp', 480, 54],
      ['6 tbsp', 720, 81],
    ]),
    defaultVariant: 1,
    uncertainty: 0.2,
    note: 'Palm oil, about 120 kcal a tablespoon.',
  }),
  dish({
    id: 'santan',
    name: 'Santan',
    aliases: ['coconut milk', 'tin santan', 'santan kotak', 'santan pekat', 'kara'],
    category: 'other',
    unit: 'a can',
    variants: scaled(macros(800, 8, 11, 80), [
      ['65 ml pack', 130, 65],
      ['200 ml pack', 400, 200],
      ['400 ml can', 800, 400],
    ]),
    defaultVariant: 2,
    note: 'Full-fat coconut milk, about 200 kcal per 100 ml.',
  }),
  dish({
    id: 'ayam-seekor',
    name: 'Ayam seekor',
    aliases: ['seekor ayam', '1 ekor ayam', 'ekor ayam', 'whole chicken'],
    category: 'other',
    unit: 'a whole chicken',
    variants: scaled(macros(2150, 186, 0, 153), [
      ['Half', 1075, 750],
      ['1 ekor', 2150, 1500],
    ]),
    defaultVariant: 1,
    uncertainty: 0.2,
    note: 'About 1.5 kg as sold and 1 kg edible with skin.',
  }),
  dish({
    id: 'kentang',
    name: 'Kentang',
    aliases: ['potato', 'potatoes', 'ubi kentang'],
    category: 'other',
    unit: 'a piece',
    variants: scaled(macros(115, 3, 26, 0.2), [
      ['1 piece', 115, 150],
      ['3 pieces', 345, 450],
    ]),
    note: 'Medium potato, about 150 g.',
  }),
  dish({
    id: 'rempah-bawang',
    name: 'Rempah, bawang',
    aliases: ['rempah', 'rempah kari', 'serbuk kari', 'curry powder', 'bawang', 'bawang merah', 'bawang putih', 'onion', 'garlic', 'cili kisar'],
    category: 'other',
    unit: 'a pot',
    variants: scaled(macros(250, 8, 40, 6.5), [['1 pot', 250]]),
    uncertainty: 0.3,
    note: 'Curry powder, onion, garlic and chilli paste for a family pot, not counting the oil.',
  }),
  dish({
    id: 'gula',
    name: 'Gula',
    aliases: ['sugar', 'gula pasir', 'gula putih', 'white sugar'],
    category: 'other',
    unit: 'a tsp',
    variants: scaled(macros(16, 0, 4, 0), [
      ['1 tsp', 16, 4],
      ['1 tbsp', 48, 12],
    ]),
    note: 'White sugar, 4 kcal a gram.',
  }),
  dish({
    id: 'susu-pekat',
    name: 'Susu pekat',
    aliases: ['condensed milk', 'susu manis', 'susu pekat manis', 'sweetened condensed milk'],
    category: 'other',
    unit: 'a tbsp',
    variants: scaled(macros(60, 1.5, 10, 1.6), [
      ['1 tbsp', 60, 19],
      ['2 tbsp', 120, 38],
    ]),
    note: 'Sweetened condensed milk or creamer, about 19 g a tablespoon.',
  }),
];
