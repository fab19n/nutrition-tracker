/**
 * Offline recipe splitter for pots (S27, plan §9.7).
 *
 * Takes a recipe typed the way you'd text it ("1 ekor ayam, 1 tin santan, 3 kentang, 4 sudu
 * minyak, rempah kari, bawang") and turns it into pot ingredients:
 *
 * - Lines split on commas, semicolons, new lines, "+", "&", "dan" and "and". Headings are dropped
 *   ("Bahan-bahan:", "Untuk 8 orang", a title before a colon or on the first line), "Cara:" ends
 *   the list, and "1,5 kg" is a decimal.
 * - Each line's quantity is read from digits ("3", "1.5", "1/2", "½", "2-3"), words ("satu",
 *   "dua", "setengah", "half") or a "se-" unit ("seekor", "secawan"), before or after the name
 *   ("minyak 4 sudu").
 * - Units: ekor / whole, tin / can, kotak / peket / bungkus / pack, sudu / tbsp, sudu kecil / tsp,
 *   cawan / cup, g, kg, ml, l, biji / ketul / potong / pieces, keping, ikat, batang, helai, inci,
 *   ulas / cloves, senduk. Gram and millilitre values come from the portion dictionary
 *   (src/data/portionUnits.ts).
 * - Names match the pot-ingredient catalogue entries first (cooking oil, santan, ayam seekor,
 *   kentang, rempah and bawang, gula, susu pekat), then a few raw ingredients whose catalogue
 *   match is a cooked dish (gula melaka, ikan bilis, mee kuning, tauhu, tempe), then general
 *   catalogue foods. Macros scale by grams where both sides know them, else by count.
 * - Chicken by the piece ("8 ketul", "2 peha", "sayap ayam 10", "ayam 8") counts pieces with
 *   bone, not whole birds.
 * - Oil becomes one `isOil` ingredient (summed in tablespoons, listed last) for the 2 / 4 / 6 tbsp
 *   chips. Spices, onion and garlic share one "Rempah and bawang" line for the whole pot.
 * - Anything else becomes an "AI guess" ingredient with a rough kcal the user can edit.
 *
 * Pure and offline (pots never call AI, ARCHITECTURE.md §10.8). Never throws: unreadable input
 * gives an empty list.
 */
import { CATALOGUE_TERMS, byId, defaultVariantOf, normaliseName } from '@/data/catalogue';
import { portionUnit } from '@/data/portionUnits';
import { fmtInt } from '@/domain/format';
import { scaleMacros, sumMacros } from '@/domain/meal';
import type { CatalogueItem, Macros, PotIngredient, SourceTag } from '@/domain/types';
import { editDistance } from './local/fuzzy';

// ---------------------------------------------------------------------------
// Units
// ---------------------------------------------------------------------------

export type RecipeUnit =
  | 'whole'
  | 'can'
  | 'pack'
  | 'tbsp'
  | 'tsp'
  | 'cup'
  | 'g'
  | 'kg'
  | 'ml'
  | 'l'
  | 'piece'
  | 'slice'
  | 'bunch'
  | 'stalk'
  | 'leaf'
  | 'inch'
  | 'clove'
  | 'senduk';

/** Unit words, longest first so "sudu kecil" wins over "sudu". */
const UNIT_WORDS: readonly (readonly [words: string, unit: RecipeUnit])[] = [
  ['sudu kecil', 'tsp'],
  ['sudu teh', 'tsp'],
  ['sudu besar', 'tbsp'],
  ['sudu makan', 'tbsp'],
  ['teaspoons', 'tsp'],
  ['teaspoon', 'tsp'],
  ['tsp', 'tsp'],
  ['tablespoons', 'tbsp'],
  ['tablespoon', 'tbsp'],
  ['tbsp', 'tbsp'],
  ['tbs', 'tbsp'],
  ['sudu', 'tbsp'],
  ['ekor', 'whole'],
  ['whole', 'whole'],
  ['tin', 'can'],
  ['tins', 'can'],
  ['can', 'can'],
  ['cans', 'can'],
  ['kotak', 'pack'],
  ['pek', 'pack'],
  ['peket', 'pack'],
  ['paket', 'pack'],
  ['pkt', 'pack'],
  ['bungkus', 'pack'],
  ['packet', 'pack'],
  ['packets', 'pack'],
  ['pack', 'pack'],
  ['packs', 'pack'],
  ['cawan', 'cup'],
  ['cups', 'cup'],
  ['cup', 'cup'],
  ['grams', 'g'],
  ['gram', 'g'],
  ['gm', 'g'],
  ['gr', 'g'],
  ['g', 'g'],
  ['kilogram', 'kg'],
  ['kilos', 'kg'],
  ['kilo', 'kg'],
  ['kg', 'kg'],
  ['millilitres', 'ml'],
  ['millilitre', 'ml'],
  ['milliliters', 'ml'],
  ['milliliter', 'ml'],
  ['mililiter', 'ml'],
  ['ml', 'ml'],
  ['litres', 'l'],
  ['litre', 'l'],
  ['liters', 'l'],
  ['liter', 'l'],
  ['l', 'l'],
  ['biji', 'piece'],
  ['buah', 'piece'],
  ['ketul', 'piece'],
  ['potong', 'piece'],
  ['pieces', 'piece'],
  ['piece', 'piece'],
  ['pcs', 'piece'],
  ['pc', 'piece'],
  ['keping', 'slice'],
  ['kpg', 'slice'],
  ['slices', 'slice'],
  ['slice', 'slice'],
  ['ikat', 'bunch'],
  ['bunches', 'bunch'],
  ['bunch', 'bunch'],
  ['batang', 'stalk'],
  ['stalks', 'stalk'],
  ['stalk', 'stalk'],
  ['sticks', 'stalk'],
  ['stick', 'stalk'],
  ['helai', 'leaf'],
  ['inci', 'inch'],
  ['inches', 'inch'],
  ['inch', 'inch'],
  ['ulas', 'clove'],
  ['cloves', 'clove'],
  ['clove', 'clove'],
  ['senduk', 'senduk'],
  ['ladles', 'senduk'],
  ['ladle', 'senduk'],
];

/** Units that mean "one" on their own ("tin santan", "ekor ayam"); counting words like "biji" need a number. */
const BARE_UNITS = new Set<RecipeUnit>(['whole', 'can', 'pack', 'tbsp', 'tsp', 'cup', 'senduk', 'bunch']);

/** Units that count things ("3 biji", "2 keping", "1 ikat") rather than measure them. */
const COUNT_UNITS = new Set<RecipeUnit>(['piece', 'slice', 'bunch', 'stalk', 'leaf', 'inch', 'clove']);

/** Units a raw ingredient is bought or weighed in; a cooked dish never comes "1 ekor" or "500 g" in a recipe. */
const RAW_UNITS = new Set<RecipeUnit>(['whole', 'g', 'kg', 'ml', 'l', 'can', 'pack']);

/** Spoon and cup measures, which need a density to become grams. */
const VOLUME_UNITS = new Set<RecipeUnit>(['tbsp', 'tsp', 'cup']);

/** How each unit reads in an ingredient's amount ("1 ekor", "4 tbsp", "3 biji"). */
const UNIT_LABEL: Record<RecipeUnit, string> = {
  whole: 'ekor',
  can: 'tin',
  pack: 'kotak',
  tbsp: 'tbsp',
  tsp: 'tsp',
  cup: 'cawan',
  g: 'g',
  kg: 'kg',
  ml: 'ml',
  l: 'l',
  piece: 'biji',
  slice: 'keping',
  bunch: 'ikat',
  stalk: 'batang',
  leaf: 'helai',
  inch: 'inci',
  clove: 'ulas',
  senduk: 'senduk',
};

/** Recipe measures from the portion dictionary (with the values it documents as fallbacks). */
const TBSP_ML = portionUnit('tbsp')?.ml ?? 15;
const TSP_ML = portionUnit('tsp')?.ml ?? 5;
const CUP_ML = portionUnit('cup')?.ml ?? 250;
const CAN_G = portionUnit('can-santan')?.grams ?? 400;
const PACK_G = portionUnit('pack-santan')?.grams ?? 200;
const SENDUK_G = portionUnit('senduk')?.grams ?? 150;
const WHOLE_CHICKEN_G = portionUnit('whole-chicken')?.grams ?? 1500;
/** A ketul of chicken with bone (the portion dictionary's chicken piece). */
const CHICKEN_PIECE_G = portionUnit('piece-chicken')?.grams ?? 120;
/** A garlic or shallot clove. Not in the portion dictionary, whose "ulas" is a durian seed. */
const CLOVE_G = 5;

/** grams per millilitre for the liquids recipes measure by the spoon (portionUnits notes: oil 13.5 g, sugar 12 g, condensed milk 19 g a tbsp). */
const DENSITY: Record<string, number> = {
  'minyak-masak': 13.5 / 15,
  gula: 12 / 15,
  'susu-pekat': 19 / 15,
};

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

const NUMBER_WORDS: Record<string, number> = {
  satu: 1,
  dua: 2,
  tiga: 3,
  empat: 4,
  lima: 5,
  enam: 6,
  tujuh: 7,
  lapan: 8,
  sembilan: 9,
  sepuluh: 10,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  setengah: 0.5,
  separuh: 0.5,
  half: 0.5,
  suku: 0.25,
  quarter: 0.25,
};

/** "a can of santan", "an onion": only at the start of a line. */
const ARTICLES = new Set(['a', 'an']);
/** Words between the amount and the name ("2 cups of water", "half a cup"). */
const FILLERS = new Set(['of', 'x', 'a', 'an']);

const POT_INGREDIENT_IDS = {
  oil: 'minyak-masak',
  aromatics: 'rempah-bawang',
  chicken: 'ayam-seekor',
} as const;

/** Display names on a pot (the catalogue names suit a menu, these suit a recipe). */
const RECIPE_NAMES: Record<string, string> = {
  [POT_INGREDIENT_IDS.chicken]: 'Ayam',
  [POT_INGREDIENT_IDS.aromatics]: 'Rempah and bawang',
  [POT_INGREDIENT_IDS.oil]: 'Cooking oil',
};

const AROMATIC_WORDS = [
  'kari',
  'curry',
  'curry paste',
  'rempah ratus',
  'perencah',
  'halia',
  'ginger',
  'serai',
  'lemongrass',
  'lengkuas',
  'galangal',
  'kunyit',
  'turmeric',
  'cili',
  'cili kering',
  'cili padi',
  'chilli',
  'chili',
  'chillies',
  'daun kari',
  'curry leaves',
  'daun pandan',
  'pandan',
  'daun limau purut',
  'kayu manis',
  'cinnamon',
  'bunga lawang',
  'star anise',
  'pelaga',
  'buah pelaga',
  'cardamom',
  'cengkih',
  'cengkeh',
  'jintan',
  'jintan manis',
  'jintan putih',
  'cumin',
  'ketumbar',
  'coriander',
  'lada',
  'lada hitam',
  'lada putih',
  'pepper',
  'black pepper',
  'shallot',
  'shallots',
  'onions',
  'belacan',
  'asam jawa',
  'asam keping',
  'tamarind',
  'herbs',
  'spices',
];

type RecipeTarget = { kind: 'food'; id: string } | { kind: 'raw'; id: string } | { kind: 'zero'; name: string };

/**
 * Raw ingredients whose catalogue match is a cooked dish ("ikan bilis" is the fried side with
 * peanuts, "tempe" is tempe goreng, "mee kuning" is economy-rice mee goreng). A recipe lists the
 * oil on its own line, so the cooked values would count it twice.
 */
interface RawIngredient {
  name: string;
  /** Normalised names and aliases. */
  terms: readonly string[];
  /** Per 100 g as bought. */
  per100g: Macros;
  /** What a bare count means ("tauhu 2" → 2 keping). */
  unit: RecipeUnit;
  /** The amount when the line gives none. */
  usual: number;
  /** Grams in one keping / biji / ikat. */
  pieceG: number;
  /** Grams in a peket / bungkus / kotak. */
  packG: number;
  /** Grams per millilitre, for spoon and cup measures (dried anchovies fill a cup at about 90 g). */
  density: number;
  /** How a unit reads on this ingredient ("1 peket" of noodles, not "1 kotak"). */
  labels?: Partial<Record<RecipeUnit, string>>;
}

const RAW_INGREDIENTS: Readonly<Record<string, RawIngredient>> = {
  'gula-melaka': {
    name: 'Gula melaka',
    terms: ['gula melaka', 'gula merah', 'gula kabung', 'gula aren', 'palm sugar'],
    per100g: { kcal: 380, proteinG: 0.4, carbsG: 94, fatG: 0.1 },
    unit: 'slice',
    usual: 1,
    pieceG: 45,
    packG: 500,
    density: 0.8,
  },
  'ikan-bilis-kering': {
    name: 'Ikan bilis',
    terms: ['ikan bilis', 'ikan bilis kering', 'bilis', 'dried anchovies', 'anchovies', 'anchovy'],
    per100g: { kcal: 280, proteinG: 55, carbsG: 0, fatG: 6.5 },
    unit: 'cup',
    usual: 0.5,
    pieceG: 3,
    packG: 150,
    density: 0.36,
  },
  'mee-kuning': {
    name: 'Mee kuning',
    terms: ['mee kuning', 'mi kuning', 'mee kuning basah', 'mee basah', 'yellow mee', 'yellow noodles'],
    per100g: { kcal: 170, proteinG: 6, carbsG: 33, fatG: 1.5 },
    unit: 'pack',
    usual: 1,
    pieceG: 450,
    packG: 450,
    density: 0.45,
    labels: { pack: 'peket' },
  },
  tauhu: {
    name: 'Tauhu',
    terms: ['tauhu', 'tahu', 'taufu', 'tofu', 'tauhu keras', 'tauhu putih', 'firm tofu'],
    per100g: { kcal: 110, proteinG: 11, carbsG: 2, fatG: 6.5 },
    unit: 'slice',
    usual: 1,
    pieceG: 100,
    packG: 400,
    density: 1,
  },
  tempe: {
    name: 'Tempe',
    terms: ['tempe', 'tempeh'],
    per100g: { kcal: 195, proteinG: 19, carbsG: 8, fatG: 10.5 },
    unit: 'slice',
    usual: 1,
    pieceG: 80,
    packG: 150,
    density: 1,
  },
};

const RAW_TERMS: ReadonlyMap<string, string> = new Map(
  Object.entries(RAW_INGREDIENTS).flatMap(([id, raw]) => raw.terms.map((term) => [normaliseName(term), id] as const)),
);

/** Chicken cuts, bought by the piece with bone: their label on the pot and grams as sold (about 120 g a ketul). */
const CHICKEN_CUTS: ReadonlyMap<string, { label: string; grams: number }> = new Map([
  ['peha', { label: 'peha', grams: 200 }],
  ['paha', { label: 'peha', grams: 200 }],
  ['thigh', { label: 'peha', grams: 200 }],
  ['thighs', { label: 'peha', grams: 200 }],
  ['leg', { label: 'peha', grams: 200 }],
  ['legs', { label: 'peha', grams: 200 }],
  ['drumstick', { label: 'drumstick', grams: 110 }],
  ['drumsticks', { label: 'drumstick', grams: 110 }],
  ['dada', { label: 'dada', grams: 180 }],
  ['breast', { label: 'dada', grams: 180 }],
  ['breasts', { label: 'dada', grams: 180 }],
  ['sayap', { label: 'sayap', grams: 90 }],
  ['kepak', { label: 'kepak', grams: 90 }],
  ['wing', { label: 'sayap', grams: 90 }],
  ['wings', { label: 'sayap', grams: 90 }],
]);

const CHICKEN_WORDS = new Set(['ayam', 'chicken']);

/** Lines that only head a recipe or say how many it feeds ("Bahan-bahan", "Untuk 8 orang"). */
const HEADING_WORDS = new Set([
  'bahan',
  'ingredients',
  'ingredient',
  'resepi',
  'resipi',
  'recipe',
  'sukatan',
  'untuk',
  'for',
  'serves',
  'serving',
  'servings',
  'hidangan',
  'orang',
  'pax',
  'people',
  'persons',
  'person',
]);

/** A heading that starts the method: everything after it is steps, not ingredients ("Cara:", "Method"). */
const METHOD_WORDS = new Set(['cara', 'method', 'langkah', 'steps', 'directions', 'instructions']);
const METHOD_FILLERS = new Set(['masak', 'memasak', 'membuat', 'penyediaan', 'to', 'cook', 'make']);

/** Cooked-dish categories: a first line naming one with no amount is the recipe's title ("Kari ayam"). */
const DISH_CATEGORIES = new Set(['home', 'protein', 'gravy', 'soup', 'rice', 'noodles']);

/** Recipe words the catalogue's names and aliases don't cover (or mean something else on a menu). */
const RECIPE_TERMS: ReadonlyMap<string, RecipeTarget> = new Map<string, RecipeTarget>([
  ['ayam', { kind: 'food', id: POT_INGREDIENT_IDS.chicken }],
  ['chicken', { kind: 'food', id: POT_INGREDIENT_IDS.chicken }],
  ['oil', { kind: 'food', id: POT_INGREDIENT_IDS.oil }],
  ...AROMATIC_WORDS.map((w): [string, RecipeTarget] => [w, { kind: 'food', id: POT_INGREDIENT_IDS.aromatics }]),
  ['air', { kind: 'zero', name: 'Air' }],
  ['water', { kind: 'zero', name: 'Air' }],
  ['ais', { kind: 'zero', name: 'Ais' }],
  ['ice', { kind: 'zero', name: 'Ais' }],
  ['garam', { kind: 'zero', name: 'Garam' }],
  ['salt', { kind: 'zero', name: 'Garam' }],
]);

/** The pot-ingredient entries (category 'other') by normalised name and alias. */
const INGREDIENT_TERMS: ReadonlyMap<string, string> = new Map(
  CATALOGUE_TERMS.filter((t) => byId(t.id)?.category === 'other').map((t) => [t.term, t.id] as const),
);

/** Every catalogue name and alias, first item in catalogue order. */
const FOOD_TERMS: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const t of CATALOGUE_TERMS) if (!map.has(t.term)) map.set(t.term, t.id);
  return map;
})();

/** One-word terms a typo may be one edit away from (recipe words and pot ingredients only: general foods are too many to guess at). */
const FUZZY_TERMS: readonly (readonly [term: string, target: RecipeTarget])[] = [
  ...[...RECIPE_TERMS.entries()].filter(([term]) => !term.includes(' ')),
  ...[...INGREDIENT_TERMS.entries()]
    .filter(([term]) => !term.includes(' '))
    .map(([term, id]): [string, RecipeTarget] => [term, { kind: 'food', id }]),
  ...[...RAW_TERMS.entries()]
    .filter(([term]) => !term.includes(' '))
    .map(([term, id]): [string, RecipeTarget] => [term, { kind: 'raw', id }]),
];

const MIN_FUZZY_LENGTH = 5;

// ---------------------------------------------------------------------------
// Rough guesses for lines the catalogue doesn't know
// ---------------------------------------------------------------------------

/** About what mixed raw ingredients bring per gram (rice and flour ~3.6, meat ~2.5, vegetables ~0.3). */
const GUESS_KCAL_PER_G = 2;
const GUESS_KCAL_PER_PIECE = 100;
/** Counting words that hold less than a piece: a bunch of greens, a stalk, a leaf, an inch of root. */
const GUESS_KCAL_PER_COUNT: Partial<Record<RecipeUnit, number>> = { bunch: 50, stalk: 20, leaf: 1, inch: 5 };
const GUESS_KCAL_WHOLE = 300;
/** No amount at all: a modest line the user is asked to check. */
const GUESS_KCAL_DEFAULT = 150;
/** One guessed line never runs away with the pot. */
const GUESS_KCAL_MAX = 2000;
/** Protein / carbs / fat shares of a guess's kcal. */
const GUESS_SPLIT = { protein: 0.2, carbs: 0.45, fat: 0.35 } as const;

const DEFAULT_OIL_TBSP = 4;

/** The oil chips (S27, C39). */
export const OIL_TBSP_CHOICES = [2, 4, 6] as const;

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

const VULGAR_FRACTIONS: Record<string, string> = { '½': ' 0.5', '¼': ' 0.25', '¾': ' 0.75', '⅓': ' 0.33', '⅔': ' 0.67' };

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function roundMacros(m: Macros): Macros {
  return { kcal: Math.round(m.kcal), proteinG: round1(m.proteinG), carbsG: round1(m.carbsG), fatG: round1(m.fatG) };
}

function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Lowercase words and numbers: "1½ Cawan" → ["1", "0.5", "cawan"], "500g" → ["500", "g"], "2-3" → ["2.5"]. */
function tokenise(text: string): string[] {
  let t = text.toLowerCase().replace(/[½¼¾⅓⅔]/g, (f) => VULGAR_FRACTIONS[f] ?? ' ');
  t = t.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  t = t.replace(/['’`]/g, '');
  t = t.replace(/(\d+)\s*[/⁄]\s*(\d+)/g, (whole, a: string, b: string) => {
    const top = Number(a);
    const bottom = Number(b);
    return bottom > 0 && top > 0 && top < bottom && bottom <= 10 ? ` ${Math.round((top / bottom) * 100) / 100} ` : whole;
  });
  t = t.replace(/(\d+(?:\.\d+)?)\s*(?:-|–|to|hingga)\s*(\d+(?:\.\d+)?)/g, (whole, a: string, b: string) => {
    const low = Number(a);
    const high = Number(b);
    return high > low ? ` ${(low + high) / 2} ` : whole;
  });
  t = t.replace(/(\d)([a-z])/g, '$1 $2').replace(/([a-z])(\d)/g, '$1 $2');
  return t.match(/\d+(?:\.\d+)?|[a-z]+/g) ?? [];
}

/** "2" → 2, "dua" → 2; undefined for anything else. */
function numberAt(tokens: readonly string[], index: number, allowArticles: boolean): number | undefined {
  const token = tokens[index];
  if (token === undefined) return undefined;
  if (/^\d/.test(token)) {
    const n = Number(token);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }
  if (allowArticles && ARTICLES.has(token)) return 1;
  return NUMBER_WORDS[token];
}

function unitAt(tokens: readonly string[], index: number): { unit: RecipeUnit; next: number } | undefined {
  for (const [words, unit] of UNIT_WORDS) {
    const parts = words.split(' ');
    if (parts.every((p, k) => tokens[index + k] === p)) return { unit, next: index + parts.length };
  }
  return undefined;
}

/** "seekor", "secawan", "sesudu": one of that unit. */
function seUnitAt(tokens: readonly string[], index: number): { unit: RecipeUnit; next: number } | undefined {
  const token = tokens[index];
  if (!token || !token.startsWith('se') || token.length < 5) return undefined;
  const rest = token.slice(2);
  const found = UNIT_WORDS.find(([words]) => words === rest);
  return found ? { unit: found[1], next: index + 1 } : undefined;
}

interface Amount {
  quantity: number;
  unit?: RecipeUnit;
  next: number;
}

/** A quantity (with its unit when one follows) starting at `index`. */
function amountAt(tokens: readonly string[], index: number, leading: boolean): Amount | undefined {
  const se = seUnitAt(tokens, index);
  if (se) return { quantity: 1, unit: se.unit, next: se.next };

  let quantity = numberAt(tokens, index, leading);
  if (quantity === undefined) return undefined;
  let next = index + 1;
  // "1 1/2" → 1.5; "dua setengah" → 2.5.
  const fraction = numberAt(tokens, next, false);
  if (fraction !== undefined && fraction < 1 && quantity >= 1) {
    quantity += fraction;
    next += 1;
  }
  while (FILLERS.has(tokens[next] ?? '') && unitAt(tokens, next + 1)) next += 1;
  const unit = unitAt(tokens, next);
  if (unit) return { quantity, unit: unit.unit, next: unit.next };
  return { quantity, next };
}

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

export interface RecipeLine {
  /** The line as typed, trimmed. */
  text: string;
  quantity?: number;
  unit?: RecipeUnit;
  /** What's left for the ingredient name, lowercase. */
  nameTokens: string[];
}

/** Words in a piece of text that could name something (not numbers or connecting words). */
function nameWords(text: string): string[] {
  return tokenise(text).filter((t) => !/^\d/.test(t) && !CONNECTORS.has(t));
}

/** "Bahan-bahan", "Untuk 8 orang", "Serves 8": a heading or a head count, never an ingredient. */
function isHeadingOnly(text: string): boolean {
  const words = nameWords(text);
  return words.length > 0 && words.every((w) => HEADING_WORDS.has(w));
}

/** "Cara:", "Cara memasak", "Method": the steps start here. */
function isMethodHeading(text: string): boolean {
  const words = nameWords(text);
  return words.some((w) => METHOD_WORDS.has(w)) && words.every((w) => METHOD_WORDS.has(w) || METHOD_FILLERS.has(w));
}

/** The first word of every unit ("sudu" for "sudu kecil"), for "Santan: 1 tin" and "1,5 kg". */
const UNIT_FIRST_WORDS: ReadonlySet<string> = new Set(UNIT_WORDS.map(([words]) => words.split(' ')[0] ?? words));

/**
 * One typed line with its colons resolved: "Kari ayam: 1 ekor ayam" drops the title before the
 * colon, "Santan: 1 tin" keeps the name with its amount, and "Cara: …" ends the ingredients (null).
 */
function resolveColons(line: string): string | null {
  const at = line.search(/(?<!\d):|:(?!\d)/);
  if (at < 0) return isMethodHeading(line) ? null : line;
  const head = line.slice(0, at);
  const rest = line.slice(at + 1);
  if (isMethodHeading(head)) return null;
  const headHasAmount = parseRecipeLine(head).quantity !== undefined;
  if (!rest.trim()) return headHasAmount ? head : '';
  // Only an amount after the colon: it belongs to the name before it.
  if (nameWords(rest).every((w) => UNIT_FIRST_WORDS.has(w))) return `${head} ${rest}`;
  const after = resolveColons(rest);
  if (after === null) return headHasAmount ? head : '';
  return headHasAmount ? `${head}\n${after}` : after;
}

/**
 * Splits a recipe into ingredient lines (commas, semicolons, new lines, "+", "&", "dan", "and",
 * full stops). Headings ("Bahan-bahan:", a title before a colon, "Untuk 8 orang") are dropped and
 * a method heading ("Cara:") ends the list. "1,5 kg" reads as 1.5 kg.
 */
export function splitRecipeLines(text: string): string[] {
  try {
    const source = text
      .replace(/(\d),(\d{3})(?!\d)/g, '$1$2')
      .replace(/(\d),(\d{1,2})(?!\d)(\s*)([a-z]+)/gi, (whole: string, a: string, b: string, gap: string, word: string) =>
        UNIT_FIRST_WORDS.has(word.toLowerCase()) ? `${a}.${b}${gap}${word}` : whole,
      );
    const lines: string[] = [];
    for (const typed of source.split(/[\n\r]+/)) {
      const resolved = resolveColons(typed);
      if (resolved === null) break;
      const parts = resolved
        .split(/[\n\r,;+&•·]+|\s+(?:dan|and)\s+|(?<!\d)\.|\.(?!\d)/i)
        .map((part) => part.replace(/^\s*[-*–]+\s*/, '').trim())
        .filter((part) => part.length > 0 && !isHeadingOnly(part));
      lines.push(...parts);
    }
    return lines;
  } catch {
    return [];
  }
}

/** Reads one line's quantity, unit and name ("4 sudu minyak", "minyak 4 sudu", "seekor ayam"). */
export function parseRecipeLine(text: string): RecipeLine {
  const tokens = tokenise(text);
  const line: RecipeLine = { text: text.trim(), nameTokens: tokens };

  const leading = amountAt(tokens, 0, true);
  if (leading) {
    let next = leading.next;
    while (FILLERS.has(tokens[next] ?? '')) next += 1;
    line.quantity = leading.quantity;
    if (leading.unit) line.unit = leading.unit;
    line.nameTokens = tokens.slice(next);
    return line;
  }

  const bare = unitAt(tokens, 0);
  if (bare && BARE_UNITS.has(bare.unit)) {
    let next = bare.next;
    while (FILLERS.has(tokens[next] ?? '')) next += 1;
    line.quantity = 1;
    line.unit = bare.unit;
    line.nameTokens = tokens.slice(next);
    return line;
  }

  // The amount after the name: "minyak 4 sudu", "ayam satu ekor".
  for (let i = 1; i < tokens.length; i += 1) {
    const trailing = amountAt(tokens, i, false);
    if (!trailing) continue;
    line.quantity = trailing.quantity;
    if (trailing.unit) line.unit = trailing.unit;
    line.nameTokens = [...tokens.slice(0, i), ...tokens.slice(trailing.next)].filter((t) => !FILLERS.has(t));
    return line;
  }
  return line;
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/** Words that only describe an ingredient ("telur ayam", "bawang besar dihiris"); anything else next to a dish name means something else ("rendang paste"). */
const DESCRIPTORS = new Set([
  'ayam',
  'besar',
  'kecil',
  'segar',
  'fresh',
  'kampung',
  'potong',
  'dipotong',
  'hiris',
  'dihiris',
  'cincang',
  'dicincang',
  'kisar',
  'dikisar',
  'tumbuk',
  'ditumbuk',
  'sliced',
  'chopped',
  'diced',
  'minced',
  'mentah',
  'raw',
  'frozen',
  'beku',
  'sejuk',
  'putih',
  'biasa',
  'plain',
]);

/** Connecting words left over from a split ("and", "dan"), never a name on their own. */
const CONNECTORS = new Set(['and', 'dan', 'with', 'dengan', 'n', 'of', 'x', 'a', 'an']);

/** Preparation words on their own ("potong 8", "dihiris") name nothing. "ayam" alone still does. */
function isPrepOnly(words: readonly string[]): boolean {
  return words.every((w) => CONNECTORS.has(w) || (w !== 'ayam' && DESCRIPTORS.has(w)));
}

interface NameMatch {
  target: RecipeTarget;
  /** From the general catalogue (a dish or side), not a pot ingredient. */
  general: boolean;
}

function lookup(term: string): NameMatch | undefined {
  const recipe = RECIPE_TERMS.get(term);
  if (recipe) return { target: recipe, general: false };
  const ingredient = INGREDIENT_TERMS.get(term);
  if (ingredient) return { target: { kind: 'food', id: ingredient }, general: false };
  const raw = RAW_TERMS.get(term);
  if (raw) return { target: { kind: 'raw', id: raw }, general: false };
  const food = FOOD_TERMS.get(term);
  return food ? { target: { kind: 'food', id: food }, general: true } : undefined;
}

function isAromatics(target: RecipeTarget): boolean {
  return target.kind === 'food' && target.id === POT_INGREDIENT_IDS.aromatics;
}

/** The longest run of words that `accept` takes, leftmost first. */
function exactMatch(words: readonly string[], accept: (found: NameMatch, others: readonly string[]) => boolean): NameMatch | undefined {
  for (let length = words.length; length >= 1; length -= 1) {
    for (let start = 0; start + length <= words.length; start += 1) {
      const term = normaliseName(words.slice(start, start + length).join(' '));
      const found = term ? lookup(term) : undefined;
      if (found && accept(found, [...words.slice(0, start), ...words.slice(start + length)])) return found;
    }
  }
  return undefined;
}

/**
 * The longest run of words that names something, leftmost first; then a one-letter typo of a
 * pot word. A dish from the general catalogue only counts when the other words just describe it.
 * With a bought amount ("1 ekor", "500 g", "1 tin") a raw pot ingredient on the line wins over a
 * cooked dish or the spice allowance ("Kari ayam 1 ekor ayam" is the chicken).
 */
function matchName(words: readonly string[], boughtAmount = false): NameMatch | undefined {
  if (boughtAmount) {
    const raw = exactMatch(words, (found) => !found.general && !isAromatics(found.target));
    if (raw) return raw;
  }
  const exact = exactMatch(words, (found, others) => !found.general || others.every((w) => DESCRIPTORS.has(w) || CONNECTORS.has(w)));
  if (exact) return exact;
  for (const word of words) {
    if (word.length < MIN_FUZZY_LENGTH) continue;
    const near = FUZZY_TERMS.find(([term]) => term.length >= 4 && editDistance(word, term, 1) <= 1);
    if (near) return { target: near[1], general: false };
  }
  return undefined;
}

/** "2 peha ayam", "chicken wings": the cut, when the line names chicken and a cut of it. */
function chickenCutIn(words: readonly string[]): { label: string; grams: number } | undefined {
  if (!words.some((w) => CHICKEN_WORDS.has(w))) return undefined;
  for (const word of words) {
    const cut = CHICKEN_CUTS.get(word);
    if (cut) return cut;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Amounts → macros
// ---------------------------------------------------------------------------

/** Macros of ONE unit of an item: its "1 piece" / "1 tsp" choice, or its default divided by the count in its label ("4 tbsp" ÷ 4). */
function oneUnitOf(item: CatalogueItem): { macros: Macros; grams?: number } {
  const single = item.variants.find((v) => /^1\s/.test(v.label));
  if (single) return single.grams === undefined ? { macros: single.macros } : { macros: single.macros, grams: single.grams };
  const fallback = defaultVariantOf(item);
  const counted = /^(\d+(?:\.\d+)?)\s+(?!ml\b|g\b|kg\b|l\b)[a-z]/i.exec(fallback.label);
  const count = counted ? Number(counted[1]) : 1;
  const macros = count > 1 ? scaleMacros(fallback.macros, 1 / count) : fallback.macros;
  const grams = fallback.grams === undefined ? undefined : fallback.grams / count;
  return grams === undefined ? { macros } : { macros, grams };
}

/** Macros and grams of a reference portion, for scaling by weight. */
function referenceOf(item: CatalogueItem): { macros: Macros; grams: number } | undefined {
  const chosen = defaultVariantOf(item);
  if (chosen.grams) return { macros: chosen.macros, grams: chosen.grams };
  const weighed = item.variants.find((v) => (v.grams ?? 0) > 0);
  if (weighed?.grams) return { macros: weighed.macros, grams: weighed.grams };
  return undefined;
}

/** Grams for an amount, when the unit says (count units like biji don't). */
function gramsFor(quantity: number, unit: RecipeUnit | undefined, density: number, itemId?: string): number | undefined {
  switch (unit) {
    case 'g':
      return quantity;
    case 'kg':
      return quantity * 1000;
    case 'ml':
      return quantity * density;
    case 'l':
      return quantity * 1000 * density;
    case 'tbsp':
      return quantity * TBSP_ML * density;
    case 'tsp':
      return quantity * TSP_ML * density;
    case 'cup':
      return quantity * CUP_ML * density;
    case 'can':
      return quantity * CAN_G;
    case 'pack':
      return quantity * PACK_G;
    case 'senduk':
      return quantity * SENDUK_G;
    case 'clove':
      return quantity * CLOVE_G;
    case 'whole':
      return itemId === POT_INGREDIENT_IDS.chicken ? quantity * WHOLE_CHICKEN_G : undefined;
    default:
      return undefined;
  }
}

/** The unit a bare count means for an item ("3 kentang" → 3 biji, "santan" → 1 tin). */
function impliedUnit(item: CatalogueItem): RecipeUnit | undefined {
  switch (item.unit) {
    case 'a piece':
    case 'an egg':
      return 'piece';
    case 'a can':
      return 'can';
    case 'a whole chicken':
      return 'whole';
    case 'a tbsp':
      return 'tbsp';
    case 'a tsp':
      return 'tsp';
    case 'a senduk':
      return 'senduk';
    default:
      return undefined;
  }
}

/** 1 → "1", 0.5 → "½", 2.5 → "2½", 1.25 → "1¼", 0.3 → "0.3". */
export function quantityText(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  const whole = Math.floor(n);
  const rest = n - whole;
  const near = (x: number) => Math.abs(rest - x) < 0.02;
  const glyph = near(0.5) ? '½' : near(0.25) ? '¼' : near(0.75) ? '¾' : '';
  if (glyph) return whole === 0 ? glyph : `${fmtInt(whole)}${glyph}`;
  if (rest < 0.02) return fmtInt(whole);
  if (rest > 0.98) return fmtInt(whole + 1);
  return String(round1(n));
}

function amountText(quantity: number, unit: RecipeUnit | undefined, item?: CatalogueItem): string {
  if (unit) return `${quantityText(quantity)} ${UNIT_LABEL[unit]}`;
  if (!item) return quantityText(quantity);
  const word = item.unit.replace(/^an? /, '');
  if (quantity === 1) return `1 ${word}`;
  const plural = /(s|sh|ch)$/.test(word) ? (word === 'bungkus' ? word : `${word}es`) : word === 'senduk' ? word : `${word}s`;
  return `${quantityText(quantity)} ${plural}`;
}

function guessMacros(kcal: number): Macros {
  return roundMacros({
    kcal,
    proteinG: (kcal * GUESS_SPLIT.protein) / 4,
    carbsG: (kcal * GUESS_SPLIT.carbs) / 4,
    fatG: (kcal * GUESS_SPLIT.fat) / 9,
  });
}

/** One serving spoon of oil, from the catalogue's Cooking oil (480 kcal for 4 tbsp). */
function oilPerTbsp(): Macros {
  const oil = byId(POT_INGREDIENT_IDS.oil);
  return oil ? oneUnitOf(oil).macros : { kcal: 120, proteinG: 0, carbsG: 0, fatG: 13.5 };
}

function oilTbspFor(line: RecipeLine): number {
  const q = line.quantity;
  if (q === undefined) return DEFAULT_OIL_TBSP;
  const density = DENSITY[POT_INGREDIENT_IDS.oil] ?? 0.9;
  switch (line.unit) {
    case undefined:
    case 'tbsp':
    case 'piece':
    case 'whole':
      return q;
    case 'tsp':
      return q / 3;
    default: {
      const grams = gramsFor(q, line.unit, density) ?? q * TBSP_ML * density;
      return grams / (TBSP_ML * density);
    }
  }
}

/** A pot's oil line for a number of tablespoons (the 2 / 4 / 6 tbsp chips). */
export function oilIngredient(tbsp: number, id: string): PotIngredient {
  const safe = Number.isFinite(tbsp) && tbsp > 0 ? tbsp : DEFAULT_OIL_TBSP;
  return {
    id,
    name: RECIPE_NAMES[POT_INGREDIENT_IDS.oil] ?? 'Cooking oil',
    amount: `${quantityText(safe)} tbsp`,
    macros: roundMacros(scaleMacros(oilPerTbsp(), safe)),
    source: 'catalogue',
    isOil: true,
  };
}

/** Tablespoons on an oil line ("4 tbsp" → 4); undefined when the amount isn't in tablespoons. */
export function oilTbsp(ingredient: Pick<PotIngredient, 'amount' | 'isOil'>): number | undefined {
  if (!ingredient.isOil) return undefined;
  const line = parseRecipeLine(`${ingredient.amount} oil`);
  if (line.quantity === undefined || (line.unit !== undefined && line.unit !== 'tbsp')) return undefined;
  return line.quantity;
}

type Estimate = Omit<PotIngredient, 'id'> & { target?: RecipeTarget };

/** A raw ingredient by weight, volume (its own density), pack or piece. */
function rawEstimate(raw: RawIngredient, line: RecipeLine, target: RecipeTarget): Estimate {
  const quantity = line.quantity ?? raw.usual;
  const unit = line.unit ?? raw.unit;
  let grams: number;
  if (unit === 'pack' || unit === 'can' || unit === 'whole') grams = quantity * raw.packG;
  else if (COUNT_UNITS.has(unit)) grams = quantity * raw.pieceG;
  else grams = gramsFor(quantity, unit, raw.density) ?? quantity * raw.pieceG;
  const label = raw.labels?.[unit] ?? UNIT_LABEL[unit];
  return {
    name: raw.name,
    amount: `${quantityText(quantity)} ${label}`,
    macros: roundMacros(scaleMacros(raw.per100g, grams / 100)),
    source: 'catalogue',
    target,
  };
}

/**
 * Chicken counted in pieces: "2 ketul", "ayam 8 potong", "2 peha ayam", "sayap ayam 10", or a
 * bare count of 2 or more ("ayam 8"). Each piece weighs as sold, with bone, at the whole bird's
 * kcal a gram. Undefined when the line means whole birds or a weight ("1 ekor", "500 g").
 */
function chickenPieces(item: CatalogueItem, line: RecipeLine, cut: { label: string; grams: number } | undefined, target: RecipeTarget): Estimate | undefined {
  const unit = line.unit;
  const counted = unit !== undefined && COUNT_UNITS.has(unit);
  const bare = unit === undefined && (cut !== undefined || (line.quantity !== undefined && line.quantity >= 2));
  if (!counted && !bare) return undefined;
  const reference = referenceOf(item);
  if (!reference) return undefined;
  const pieces = line.quantity ?? 1;
  const grams = pieces * (cut?.grams ?? CHICKEN_PIECE_G);
  return {
    name: RECIPE_NAMES[item.id] ?? item.name,
    amount: `${quantityText(pieces)} ${cut?.label ?? 'ketul'}`,
    macros: roundMacros(scaleMacros(reference.macros, grams / reference.grams)),
    source: item.source,
    target,
  };
}

function estimateLine(line: RecipeLine): Estimate | undefined {
  const words = line.nameTokens.filter((t) => !/^\d/.test(t));
  if (isPrepOnly(words)) return undefined;
  const cut = chickenCutIn(words);
  const match: NameMatch | undefined = cut
    ? { target: { kind: 'food', id: POT_INGREDIENT_IDS.chicken }, general: false }
    : matchName(words, line.unit !== undefined && RAW_UNITS.has(line.unit));
  const target = match?.target;
  const typedName = sentenceCase(words.join(' '));
  const quantity = line.quantity ?? 1;

  if (!target) {
    const grams = gramsFor(quantity, line.unit, 1);
    const perCount = line.unit ? GUESS_KCAL_PER_COUNT[line.unit] : undefined;
    let kcal: number;
    if (perCount !== undefined) kcal = quantity * perCount;
    else if (grams !== undefined) kcal = grams * GUESS_KCAL_PER_G;
    else if (line.unit === 'whole') kcal = quantity * GUESS_KCAL_WHOLE;
    else if (line.quantity !== undefined) kcal = quantity * GUESS_KCAL_PER_PIECE;
    else kcal = GUESS_KCAL_DEFAULT;
    return {
      name: typedName,
      amount: line.quantity === undefined ? '' : amountText(quantity, line.unit),
      macros: guessMacros(Math.min(GUESS_KCAL_MAX, Math.round(kcal))),
      source: 'aiGuess',
    };
  }

  if (target.kind === 'zero') {
    return {
      name: target.name,
      amount: line.quantity === undefined ? '' : amountText(quantity, line.unit),
      macros: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 },
      source: 'catalogue',
      target,
    };
  }

  if (target.kind === 'raw') {
    const raw = RAW_INGREDIENTS[target.id];
    return raw ? rawEstimate(raw, line, target) : undefined;
  }

  const item = byId(target.id);
  if (!item) return undefined;
  const name = RECIPE_NAMES[item.id] ?? item.name;
  // A cooked dish by the spoon or cup has no density to go on: say it's a guess.
  const source: SourceTag =
    match?.general && line.unit !== undefined && VOLUME_UNITS.has(line.unit) && DENSITY[item.id] === undefined ? 'aiGuess' : item.source;

  if (item.id === POT_INGREDIENT_IDS.chicken) {
    const pieces = chickenPieces(item, line, cut, target);
    if (pieces) return pieces;
  }
  if (item.id === POT_INGREDIENT_IDS.oil) {
    const oil = oilIngredient(oilTbspFor(line), '');
    return { name: oil.name, amount: oil.amount, macros: oil.macros, source: oil.source, isOil: true, target };
  }
  if (item.id === POT_INGREDIENT_IDS.aromatics) {
    // One allowance for the pot's spices, onion and garlic, however they're listed.
    return { name, amount: line.text, macros: roundMacros(defaultVariantOf(item).macros), source, target };
  }

  const unit = line.unit ?? impliedUnit(item);
  const density = DENSITY[item.id] ?? 1;
  const grams = gramsFor(quantity, unit, density, item.id);
  const reference = referenceOf(item);
  const one = oneUnitOf(item);
  let macros: Macros;
  if (grams !== undefined && reference) macros = scaleMacros(reference.macros, grams / reference.grams);
  else if (grams !== undefined && one.grams) macros = scaleMacros(one.macros, grams / one.grams);
  else macros = scaleMacros(one.macros, quantity);

  return { name, amount: amountText(quantity, unit, item), macros: roundMacros(macros), source, target };
}

function toIngredient(estimate: Estimate, id: string): PotIngredient {
  const ingredient: PotIngredient = { id, name: estimate.name, amount: estimate.amount, macros: estimate.macros, source: estimate.source };
  if (estimate.isOil) ingredient.isOil = true;
  return ingredient;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SplitOptions {
  /** Ids for the new ingredients; default "ing-1", "ing-2"… */
  makeId?: (index: number) => string;
  /** The pot's name: a first line that only repeats it is a title, not an ingredient. */
  title?: string;
}

function sameTarget(a: RecipeTarget, b: RecipeTarget): boolean {
  if (a.kind === 'zero' || b.kind === 'zero') return a.kind === 'zero' && b.kind === 'zero' && a.name === b.name;
  return a.kind === b.kind && a.id === b.id;
}

/**
 * A first line with no amount that names the dish rather than an ingredient: the pot's name, a
 * cooked dish of two words or more ("Kari ayam", "Sayur lodeh"), or a pot ingredient a later line
 * gives an amount for ("Ayam masak merah" above "1 ekor ayam").
 */
function isTitleLine(first: RecipeLine, rest: readonly RecipeLine[], title: string | undefined): boolean {
  if (first.quantity !== undefined || rest.length === 0) return false;
  const named = normaliseName(first.text);
  if (title && named && named === normaliseName(title)) return true;
  const words = first.nameTokens.filter((t) => !/^\d/.test(t) && !CONNECTORS.has(t));
  if (chickenCutIn(words)) return false;
  const match = matchName(words);
  if (!match) return false;
  if (match.general) {
    const item = match.target.kind === 'food' ? byId(match.target.id) : undefined;
    return words.length >= 2 && item !== undefined && DISH_CATEGORIES.has(item.category);
  }
  if (isAromatics(match.target)) return false;
  return rest.some((line) => {
    if (line.quantity === undefined) return false;
    const later = matchName(
      line.nameTokens.filter((t) => !/^\d/.test(t)),
      line.unit !== undefined && RAW_UNITS.has(line.unit),
    );
    return later !== undefined && sameTarget(later.target, match.target);
  });
}

/**
 * Splits a typed recipe into pot ingredients. Oil lines merge into one `isOil` ingredient listed
 * last; spice, onion and garlic lines merge into one "Rempah and bawang" allowance. A title line
 * ("Kari ayam" above the ingredients) is skipped. Never throws.
 */
export function splitRecipe(text: string, opts: SplitOptions = {}): PotIngredient[] {
  try {
    const makeId = opts.makeId ?? ((index: number) => `ing-${index + 1}`);
    const rows: Estimate[] = [];
    let oilTbspTotal: number | undefined;
    let aromatics: Estimate | undefined;

    const lines = splitRecipeLines(typeof text === 'string' ? text : '').map(parseRecipeLine);
    const [first, ...rest] = lines;
    const body = first && isTitleLine(first, rest, opts.title) ? rest : lines;

    for (const line of body) {
      const estimate = estimateLine(line);
      if (!estimate) continue;
      if (estimate.isOil) {
        oilTbspTotal = (oilTbspTotal ?? 0) + (oilTbsp(estimate) ?? DEFAULT_OIL_TBSP);
        continue;
      }
      if (estimate.target?.kind === 'food' && estimate.target.id === POT_INGREDIENT_IDS.aromatics) {
        if (aromatics) {
          aromatics.amount = `${aromatics.amount}, ${estimate.amount}`;
          continue;
        }
        aromatics = estimate;
      }
      rows.push(estimate);
    }

    const ingredients = rows.map((row, index) => toIngredient(row, makeId(index)));
    if (oilTbspTotal !== undefined) ingredients.push(oilIngredient(oilTbspTotal, makeId(ingredients.length)));
    return ingredients;
  } catch {
    return [];
  }
}

/**
 * Re-reads an ingredient after its amount was edited ("half ekor", "5 biji"), keeping its id,
 * name and oil flag. A line the catalogue can't read keeps its kcal unless it was a guess.
 */
export function reestimateIngredient(ingredient: PotIngredient, amount: string): PotIngredient {
  try {
    const trimmed = amount.trim();
    if (ingredient.isOil) {
      const tbsp = oilTbspFor(parseRecipeLine(`${trimmed} oil`));
      return { ...oilIngredient(tbsp, ingredient.id), name: ingredient.name };
    }
    const estimate = estimateLine(parseRecipeLine(`${trimmed} ${ingredient.name}`));
    if (!estimate || (estimate.source === 'aiGuess' && ingredient.source !== 'aiGuess')) {
      return { ...ingredient, amount: trimmed };
    }
    if (estimate.target?.kind === 'food' && estimate.target.id === POT_INGREDIENT_IDS.aromatics) {
      return { ...ingredient, amount: trimmed };
    }
    const next: PotIngredient = { ...ingredient, amount: trimmed, macros: estimate.macros, source: estimate.source };
    return next;
  } catch {
    return { ...ingredient, amount };
  }
}

/** Reads one typed line as a new ingredient ("+ Add ingredient"); undefined when there's no name in it. */
export function ingredientFromText(text: string, id: string): PotIngredient | undefined {
  try {
    const estimate = estimateLine(parseRecipeLine(text));
    return estimate ? toIngredient(estimate, id) : undefined;
  } catch {
    return undefined;
  }
}

/** Sets an ingredient's kcal by hand: macros scale to match, and it's tagged as your correction. */
export function withIngredientKcal(ingredient: PotIngredient, kcal: number): PotIngredient {
  const target = Number.isFinite(kcal) ? Math.max(0, Math.round(kcal)) : ingredient.macros.kcal;
  const macros =
    ingredient.macros.kcal > 0 ? roundMacros(scaleMacros(ingredient.macros, target / ingredient.macros.kcal)) : guessMacros(target);
  return { ...ingredient, macros: { ...macros, kcal: target }, source: 'yourCorrection' };
}

/** The whole pot. */
export function recipeTotal(ingredients: readonly Pick<PotIngredient, 'macros'>[]): Macros {
  return sumMacros(ingredients.map((i) => i.macros));
}

/** kcal in one serving (the whole pot ÷ servings); 0 when there are no servings. */
export function kcalPerServing(ingredients: readonly Pick<PotIngredient, 'macros'>[], servings: number): number {
  if (!Number.isFinite(servings) || servings <= 0) return 0;
  return recipeTotal(ingredients).kcal / servings;
}
