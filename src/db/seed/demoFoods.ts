import type { Id, Macros, MealItem, SourceTag, Variant } from '@/domain/types';

/**
 * Nutrition snapshots for the demo world. Meals store their own copies (plan §18 rule 1), so
 * these values never depend on the live catalogue. Catalogue ids follow the starter catalogue's
 * kebab-case scheme; DEMO_CATALOGUE_IDS lists every id referenced.
 */

const m = (kcal: number, proteinG: number, carbsG: number, fatG: number): Macros => ({ kcal, proteinG, carbsG, fatG });

/** Default ±15%; oily mixed dishes are harder to judge. */
const USUAL = 0.15;
const OILY_MIXED = 0.25;

interface FoodBase {
  name: string;
  catalogueId?: string;
  uncertainty: number;
  source: SourceTag;
}

interface FixedFood extends FoodBase {
  macros: Macros;
}

interface ChipFood extends FoodBase {
  variants: Variant[];
}

export type DemoFood = FixedFood | ChipFood;

const v = (id: string, label: string, macros: Macros): Variant => ({ id, label, macros });

export const DEMO_FOODS = {
  // Mamak and nasi kandar
  nasiKandarRice: {
    name: 'Nasi kandar rice',
    catalogueId: 'rice-nasi-kandar',
    uncertainty: USUAL,
    source: 'catalogue',
    variants: [
      v('small', 'Small', m(250, 5, 55, 0.5)),
      v('normal', 'Normal', m(330, 6, 73, 0.6)),
      v('big', 'Mamak big', m(430, 8, 95, 0.8)),
    ],
  },
  ayamGorengMamak: {
    name: 'Ayam goreng',
    catalogueId: 'ayam-goreng-mamak',
    uncertainty: USUAL,
    source: 'myfcd',
    variants: [v('one', '1 piece', m(300, 22, 10, 19)), v('two', '2 pieces', m(600, 44, 20, 38))],
  },
  kuahCampur: {
    name: 'Kuah campur',
    catalogueId: 'kuah-campur',
    uncertainty: OILY_MIXED,
    source: 'catalogue',
    variants: [
      v('sikit', 'Sikit', m(60, 1, 4, 4.5)),
      v('normal', 'Normal', m(120, 2, 8, 9)),
      v('banjir', 'Banjir', m(220, 4, 14, 16)),
    ],
  },
  rotiCanai: { name: 'Roti canai + dhal', catalogueId: 'roti-canai-dhal', uncertainty: USUAL, source: 'catalogue', macros: m(360, 8, 42, 16) },
  rotiTelur: { name: 'Roti telur + dhal', catalogueId: 'roti-telur-dhal', uncertainty: USUAL, source: 'catalogue', macros: m(420, 14, 44, 21) },
  meeRebus: {
    name: 'Mee rebus',
    catalogueId: 'mee-rebus',
    uncertainty: OILY_MIXED,
    source: 'catalogue',
    variants: [
      v('small', 'Small', m(450, 16.1, 65.9, 13.7)),
      v('normal', 'Normal', m(560, 20, 82, 17)),
      v('big', 'Mamak big', m(700, 25, 102.5, 21.3)),
    ],
  },
  bihunGoreng: {
    name: 'Bihun goreng',
    catalogueId: 'bihun-goreng-mamak',
    uncertainty: OILY_MIXED,
    source: 'catalogue',
    variants: [
      v('small', 'Small', m(480, 13.6, 68, 17.2)),
      v('normal', 'Normal', m(600, 17, 85, 21.5)),
      v('big', 'Mamak big', m(760, 21.5, 107.7, 27.2)),
    ],
  },
  maggiKari: { name: 'Maggi kari', catalogueId: 'maggi-home', uncertainty: USUAL, source: 'catalogue', macros: m(380, 8, 50, 16) },

  // Drinks
  tehTarik: {
    name: 'Teh tarik',
    catalogueId: 'teh-tarik',
    uncertainty: USUAL,
    source: 'catalogue',
    // Same chips as the catalogue; Normal keeps the design's breakfast macros (14 / 70 / 22g with roti canai).
    variants: [
      v('kosong', 'Kosong', m(70, 3.5, 6, 3.5)),
      v('kurang', 'Kurang', m(140, 3.5, 21, 4.5)),
      v('normal', 'Normal', m(200, 6, 28, 6)),
    ],
  },
  miloAis: {
    name: 'Milo ais',
    catalogueId: 'milo-ais',
    uncertainty: USUAL,
    source: 'catalogue',
    variants: [
      v('kosong', 'Kosong', m(130, 5, 18, 4.5)),
      v('kurang', 'Kurang', m(190, 7, 26, 7)),
      v('normal', 'Normal', m(250, 7, 40, 7)),
    ],
  },
  tehOAis: {
    name: 'Teh o ais',
    catalogueId: 'teh-o-ais',
    uncertainty: USUAL,
    source: 'catalogue',
    variants: [
      v('kosong', 'Kosong', m(5, 0, 1.2, 0)),
      v('kurang', 'Kurang', m(60, 0, 15, 0)),
      v('normal', 'Normal', m(110, 0, 27, 0)),
    ],
  },

  // Kopitiam and bungkus
  breadKayaKopi: { name: 'Bread, kaya, kopi', catalogueId: 'kaya-toast-kopi', uncertainty: USUAL, source: 'catalogue', macros: m(380, 8, 55, 14) },
  rotiBakarKaya: { name: 'Roti bakar kaya', catalogueId: 'kaya-toast', uncertainty: USUAL, source: 'catalogue', macros: m(250, 5, 32, 11) },
  nasiLemakBungkus: { name: 'Nasi lemak bungkus', catalogueId: 'nasi-lemak-bungkus', uncertainty: OILY_MIXED, source: 'catalogue', macros: m(490, 12, 60, 22) },

  // Economy rice (the plate builder's trays)
  rice: {
    name: 'Rice',
    catalogueId: 'rice-economy',
    uncertainty: USUAL,
    source: 'catalogue',
    variants: [
      v('half', 'Half', m(100, 2, 22.5, 0.2)),
      v('one', '1 scoop', m(200, 4, 45, 0.4)),
      v('oneHalf', '1.5 scoops', m(300, 6, 67.5, 0.6)),
    ],
  },
  ayamGorengTray: { name: 'Ayam goreng', catalogueId: 'ayam-goreng-tray', uncertainty: USUAL, source: 'catalogue', macros: m(280, 20, 9, 18) },
  ayamMasakMerah: { name: 'Ayam masak merah', catalogueId: 'ayam-masak-merah', uncertainty: USUAL, source: 'catalogue', macros: m(250, 18, 12, 15) },
  ikanGoreng: { name: 'Ikan goreng', catalogueId: 'ikan-goreng', uncertainty: USUAL, source: 'catalogue', macros: m(200, 20, 3, 12) },
  telurDadar: { name: 'Telur dadar', catalogueId: 'telur-dadar', uncertainty: USUAL, source: 'catalogue', macros: m(180, 10, 2, 15) },
  kangkungBelacan: { name: 'Kangkung belacan', catalogueId: 'kangkung-belacan', uncertainty: USUAL, source: 'catalogue', macros: m(90, 3, 7, 6) },
  kubisGoreng: { name: 'Kubis goreng', catalogueId: 'kubis-goreng', uncertainty: USUAL, source: 'catalogue', macros: m(70, 2, 7, 4) },
  terungSambal: { name: 'Terung sambal', catalogueId: 'terung-sambal', uncertainty: USUAL, source: 'catalogue', macros: m(120, 2, 10, 8) },
  taugeh: { name: 'Taugeh', catalogueId: 'taugeh', uncertainty: USUAL, source: 'catalogue', macros: m(60, 3, 5, 3) },
  tauhuGoreng: { name: 'Tauhu goreng', catalogueId: 'tauhu-goreng', uncertainty: USUAL, source: 'catalogue', macros: m(110, 7, 3, 8) },
  kuahOnRice: {
    name: 'Kuah on rice',
    catalogueId: 'kuah-on-rice',
    uncertainty: USUAL,
    source: 'catalogue',
    variants: [v('none', 'None', m(0, 0, 0, 0)), v('some', 'Some', m(60, 1, 4, 4.6)), v('banjir', 'Banjir', m(140, 2, 10, 10))],
  },

  // Hawker
  charKueyTeow: {
    name: 'Char kuey teow',
    catalogueId: 'char-kuey-teow',
    uncertainty: OILY_MIXED,
    source: 'catalogue',
    variants: [
      v('small', 'Small', m(600, 18.6, 64.9, 29.2)),
      v('normal', 'Normal', m(740, 23, 80, 36)),
      v('big', 'Big', m(900, 28, 97.3, 43.8)),
    ],
  },
  ayamBakar: { name: 'Ayam bakar', catalogueId: 'ayam-bakar', uncertainty: USUAL, source: 'catalogue', macros: m(290, 30, 4, 17) },
  ulamSambal: { name: 'Ulam + sambal', catalogueId: 'ulam-sambal', uncertainty: USUAL, source: 'catalogue', macros: m(150, 3, 10, 11) },

  // Snacks and kuih
  karipap: { name: 'Karipap', catalogueId: 'karipap', uncertainty: USUAL, source: 'catalogue', macros: m(130, 3, 15, 6.5) },
  kuihLapis: { name: 'Kuih lapis', catalogueId: 'kuih-lapis', uncertainty: USUAL, source: 'catalogue', macros: m(110, 0.5, 19, 3.5) },
  creamCrackers: { name: 'Cream crackers', catalogueId: 'biskut', uncertainty: USUAL, source: 'catalogue', macros: m(150, 3, 20, 6) },

  // Home style: home versions of catalogue dishes, a little off the stall values
  ayamMasakKicap: { name: 'Ayam masak kicap', catalogueId: 'ayam-kicap', uncertainty: USUAL, source: 'catalogue', macros: m(230, 18, 8, 14) },
  ikanGorengKunyit: { name: 'Ikan goreng kunyit', catalogueId: 'ikan-goreng', uncertainty: USUAL, source: 'catalogue', macros: m(190, 19, 3, 11) },
  sayurGoreng: { name: 'Sayur goreng', catalogueId: 'sayur-goreng', uncertainty: USUAL, source: 'catalogue', macros: m(130, 3, 10, 9) },
  /** Not in the catalogue: the AI estimated it the first time it was typed. */
  supSayur: { name: 'Sup sayur', uncertainty: OILY_MIXED, source: 'aiGuess', macros: m(90, 3, 10, 4) },
  telurGoreng: { name: 'Telur goreng', catalogueId: 'telur-mata', uncertainty: USUAL, source: 'catalogue', macros: m(120, 6, 0.5, 10) },
  /** One serving of the kari ayam pot (~4,030 kcal ÷ 8), rounded to 10 like every estimate. */
  kariAyamServing: { name: 'Kari ayam', uncertainty: USUAL, source: 'catalogue', macros: m(500, 27, 16, 37) },
} satisfies Record<string, DemoFood>;

export type DemoFoodKey = keyof typeof DEMO_FOODS;

export const DEMO_CATALOGUE_IDS: readonly string[] = [
  ...new Set(
    Object.values(DEMO_FOODS as Record<string, DemoFood>)
      .map((food) => food.catalogueId)
      .filter((id): id is string => id !== undefined),
  ),
];

export interface ItemSpec {
  food: DemoFoodKey;
  /** Variant label for chip foods, e.g. 'Mamak big'. Omitted = the first variant. */
  variant?: string;
  quantity?: number;
  source?: SourceTag;
  uncertainty?: number;
  /** The estimate before the user changed the portion (variant label). Marks the item edited. */
  editedFrom?: string;
}

function variantIndex(food: ChipFood, label: string | undefined): number {
  if (label === undefined) return 0;
  const index = food.variants.findIndex((variant) => variant.label === label);
  if (index < 0) throw new Error(`${food.name} has no "${label}" portion`);
  return index;
}

function copyVariant(variant: Variant): Variant {
  return { ...variant, macros: { ...variant.macros } };
}

/** A MealItem snapshot for one food line. */
export function demoItem(id: Id, spec: ItemSpec | DemoFoodKey): MealItem {
  const s: ItemSpec = typeof spec === 'string' ? { food: spec } : spec;
  const food: DemoFood = DEMO_FOODS[s.food];
  const quantity = s.quantity ?? 1;
  const item: MealItem = {
    id,
    name: food.name,
    unitMacros: m(0, 0, 0, 0),
    quantity,
    uncertainty: s.uncertainty ?? food.uncertainty,
    source: s.source ?? food.source,
  };
  if (food.catalogueId) item.catalogueId = food.catalogueId;

  if ('variants' in food) {
    const selected = variantIndex(food, s.variant);
    const chosen = food.variants[selected];
    if (!chosen) throw new Error(`${food.name} variant ${selected} is missing`);
    item.variants = food.variants.map(copyVariant);
    item.selectedVariant = selected;
    item.unitMacros = { ...chosen.macros };
    if (s.editedFrom !== undefined) {
      const originalIndex = variantIndex(food, s.editedFrom);
      const original = food.variants[originalIndex];
      if (!original) throw new Error(`${food.name} variant ${originalIndex} is missing`);
      item.original = { selectedVariant: originalIndex, quantity, unitMacros: { ...original.macros } };
      item.edited = true;
    }
  } else {
    if (s.variant !== undefined || s.editedFrom !== undefined) throw new Error(`${food.name} has no portions`);
    item.unitMacros = { ...food.macros };
  }
  return item;
}
