/**
 * Words the local estimator understands besides food names: portion and sugar modifiers,
 * quantities, separators and filler. Malay and English, as people type them at a stall.
 */
import type { FoodCategory } from '@/domain/types';
import { matchesAt, tokenise } from './normalise';

/** What a modifier asks for; see `variants.ts` for how each kind maps onto an item's chips. */
export type ModifierKind =
  | 'less'
  | 'kurang'
  | 'kosong'
  | 'banjir'
  | 'more'
  | 'large'
  | 'mamakBig'
  | 'normal'
  | 'half'
  /** An ice request on a hot drink: it was the iced one ("teh o kurang ais"). */
  | 'iced';

/**
 * Which neighbour a modifier usually describes. Malay modifiers follow the food
 * ("teh tarik kurang", "nasi kandar besar"); English ones lead ("big nasi lemak", "extra kuah").
 */
export type Side = 'previous' | 'next';

export interface ModifierPhrase {
  tokens: readonly string[];
  kind: ModifierKind;
  side: Side;
  /** Only items of this category can take it ("kurang nasi" is about the rice). */
  target?: FoodCategory;
  /**
   * Catalogue term to add when nothing in the meal can take the modifier ("extra kuah" with no
   * kuah listed). `whenSegmentHas` limits it to entries that mention that category
   * ("nasi kandar banjir" means rice with plenty of kuah; "mee goreng banjir" doesn't).
   */
  implies?: { term: string; whenSegmentHas?: FoodCategory };
}

type PhraseExtras = Pick<ModifierPhrase, 'target' | 'implies'>;

function phrases(kind: ModifierKind, side: Side, texts: readonly string[], extras: PhraseExtras = {}): ModifierPhrase[] {
  return texts.map((text) => ({ tokens: tokenise(text), kind, side, ...extras }));
}

const ABOUT_RICE: PhraseExtras = { target: 'rice', implies: { term: 'nasi' } };
const ABOUT_DRINKS: PhraseExtras = { target: 'drinks' };
const ABOUT_KUAH: PhraseExtras = { implies: { term: 'kuah' } };

export const MODIFIER_PHRASES: readonly ModifierPhrase[] = [
  ...phrases('kosong', 'previous', [
    'kosong',
    'no sugar',
    'without sugar',
    'sugar free',
    'zero sugar',
    'unsweetened',
    'gula kosong',
    'tak nak gula',
    'tak mau gula',
    'tak letak gula',
    'tak manis',
    'tanpa gula',
    'tiada gula',
    'x nak gula',
    'x manis',
  ]),
  ...phrases('kurang', 'previous', [
    'kurang',
    'kurang manis',
    'kurang gula',
    'less sugar',
    'less sweet',
    'half sugar',
    'separuh manis',
    'separuh gula',
    'sikit manis',
    'manis sikit',
    'sikit gula',
    'gula sikit',
    'siu dai',
  ]),
  // Sweeter than usual is the Normal chip: the sweetest one there is.
  ...phrases('normal', 'previous', [
    'extra sugar',
    'more sugar',
    'lebih manis',
    'manis lebih',
    'extra manis',
    'tambah gula',
    'lebih gula',
    'gula lebih',
    'gula tambah',
  ]),
  ...phrases('banjir', 'previous', ['banjir'], { implies: { term: 'kuah', whenSegmentHas: 'rice' } }),
  ...phrases('banjir', 'previous', ['kuah lebih', 'kuah banyak', 'kuah extra', 'kuah tambah'], ABOUT_KUAH),
  ...phrases(
    'banjir',
    'next',
    ['extra kuah', 'tambah kuah', 'lebih kuah', 'banyak kuah', 'more kuah', 'extra gravy', 'more gravy'],
    ABOUT_KUAH,
  ),
  ...phrases('less', 'previous', ['sikit', 'sedikit', 'kecil', 'sikit je', 'sikit sahaja']),
  ...phrases('less', 'next', ['small', 'less', 'little', 'a little', 'smaller', 'small portion']),
  ...phrases('less', 'previous', ['nasi sikit', 'nasi sedikit', 'nasi kurang', 'nasi separuh', 'nasi half'], ABOUT_RICE),
  ...phrases('less', 'next', ['kurang nasi', 'sikit nasi', 'separuh nasi', 'less rice', 'half rice'], ABOUT_RICE),
  ...phrases('more', 'next', ['extra', 'tambah', 'lebih', 'more', 'double']),
  ...phrases('more', 'previous', ['nasi tambah', 'nasi lebih', 'nasi banyak', 'nasi extra'], ABOUT_RICE),
  ...phrases('more', 'next', ['tambah nasi', 'lebih nasi', 'banyak nasi', 'extra nasi', 'extra rice', 'more rice'], ABOUT_RICE),
  ...phrases('large', 'previous', ['besar', 'jumbo', 'saiz besar', 'size besar', 'upsize']),
  ...phrases('large', 'previous', ['nasi besar', 'nasi jumbo'], ABOUT_RICE),
  ...phrases('large', 'next', ['big rice', 'large rice'], ABOUT_RICE),
  ...phrases('large', 'previous', ['ikat tepi'], ABOUT_DRINKS),
  ...phrases(
    'iced',
    'previous',
    ['kurang ais', 'less ice', 'ais sikit', 'sikit ais', 'ais kurang', 'extra ice', 'lebih ais', 'ais lebih', 'banyak ais'],
    ABOUT_DRINKS,
  ),
  ...phrases('large', 'next', ['big', 'large', 'extra large', 'xl']),
  ...phrases('mamakBig', 'previous', ['mamak', 'mamak big']),
  ...phrases('normal', 'previous', ['normal', 'biasa', 'regular', 'medium', 'sedang', 'standard']),
  ...phrases('half', 'next', ['half', 'separuh', 'setengah', 'half portion', 'half plate', 'separuh pinggan']),
];

const PHRASES_BY_FIRST = new Map<string, ModifierPhrase[]>();
for (const phrase of MODIFIER_PHRASES) {
  const first = phrase.tokens[0];
  if (first === undefined) continue;
  const list = PHRASES_BY_FIRST.get(first) ?? [];
  list.push(phrase);
  PHRASES_BY_FIRST.set(first, list);
}
for (const list of PHRASES_BY_FIRST.values()) list.sort((a, b) => b.tokens.length - a.tokens.length);

/** The longest modifier phrase starting at `index`, at most `maxLength` words long. */
export function modifierAt(tokens: readonly string[], index: number, maxLength = Infinity): ModifierPhrase | undefined {
  const first = tokens[index];
  if (first === undefined) return undefined;
  return PHRASES_BY_FIRST.get(first)?.find((phrase) => phrase.tokens.length <= maxLength && matchesAt(tokens, index, phrase.tokens));
}

/** One-word modifiers ("kurang", "kosong", "banjir"), for reading their typos. */
export const SINGLE_WORD_MODIFIERS: readonly ModifierPhrase[] = MODIFIER_PHRASES.filter((p) => p.tokens.length === 1);

// ---------------------------------------------------------------------------
// Quantities
// ---------------------------------------------------------------------------

const NUMBER_WORDS: ReadonlyMap<string, number> = new Map([
  ['satu', 1], ['one', 1], ['dua', 2], ['two', 2], ['tiga', 3], ['three', 3], ['empat', 4], ['four', 4],
  ['lima', 5], ['five', 5], ['enam', 6], ['six', 6], ['tujuh', 7], ['seven', 7], ['lapan', 8], ['eight', 8],
  ['sembilan', 9], ['nine', 9], ['sepuluh', 10], ['ten', 10], ['suku', 0.25],
]);

/** Counting words that may follow a number: "2 ketul", "3 pieces", "2 cawan". */
const UNIT_WORDS: ReadonlySet<string> = new Set([
  'ketul', 'keping', 'biji', 'buah', 'piece', 'pieces', 'pc', 'pcs', 'pinggan', 'plate', 'plates',
  'mangkuk', 'bowl', 'bowls', 'cawan', 'cup', 'cups', 'gelas', 'glass', 'glasses', 'scoop', 'scoops',
  'senduk', 'sendok', 'bungkus', 'packet', 'packets', 'pack', 'packs', 'peket', 'slice', 'slices',
  'potong', 'stick', 'sticks', 'cucuk', 'ulas', 'seed', 'seeds', 'tin', 'tins', 'can', 'cans', 'botol',
  'bottle', 'bottles', 'mug', 'mugs', 'set', 'sets', 'roll', 'rolls', 'gulung', 'kotak', 'box', 'boxes',
  'portion', 'portions', 'serving', 'servings',
]);

/** Malay "se-" counting words mean one: seketul, secawan, sepinggan… */
const ONE_WORDS: ReadonlySet<string> = new Set([
  'seketul', 'sekeping', 'sebiji', 'sepinggan', 'secawan', 'segelas', 'semangkuk', 'sebungkus',
  'sepotong', 'secucuk', 'seulas', 'sebotol', 'sesenduk', 'sepeket', 'sekotak', 'setin',
]);

const MAX_QUANTITY = 20;
/** Sticks, seeds and pieces run higher ("satay 30"); such counts only go to items with counted chips. */
export const MAX_COUNT = 60;

export interface QuantityMatch {
  value: number;
  length: number;
  /** True when the match includes a unit word (so a food name starting there may claim it back). */
  hasUnit: boolean;
}

/** More than a plain serving count: only an item with counted chips can take it. */
export function isLargeCount(value: number): boolean {
  return value > MAX_QUANTITY;
}

function numberValue(token: string | undefined): number | undefined {
  if (token === undefined) return undefined;
  if (/^\d+(\.\d+)?$/.test(token)) return Number(token);
  return NUMBER_WORDS.get(token);
}

function plausible(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value <= MAX_COUNT;
}

/** "2", "dua", "x2", "2x", "x 2", "2 ketul", "2pcs", "seketul". */
export function quantityAt(tokens: readonly string[], index: number): QuantityMatch | undefined {
  const token = tokens[index];
  if (token === undefined) return undefined;
  if (ONE_WORDS.has(token)) return { value: 1, length: 1, hasUnit: false };

  if (token === 'x') {
    const value = numberValue(tokens[index + 1]);
    return value !== undefined && plausible(value) ? { value, length: 2, hasUnit: false } : undefined;
  }
  const glued = /^x(\d+)$/.exec(token) ?? /^(\d+)(?:x|pcs|pc|ketul|biji|keping)$/.exec(token);
  if (glued?.[1] !== undefined) {
    const value = Number(glued[1]);
    return plausible(value) ? { value, length: 1, hasUnit: false } : undefined;
  }

  const value = numberValue(token);
  if (value === undefined || !plausible(value)) return undefined;
  const next = tokens[index + 1];
  if (next === 'x') return { value, length: 2, hasUnit: false };
  if (next !== undefined && UNIT_WORDS.has(next)) return { value, length: 2, hasUnit: true };
  return { value, length: 1, hasUnit: false };
}

// ---------------------------------------------------------------------------
// Separators and filler
// ---------------------------------------------------------------------------

/** Soft separators: they split items unless a food name spans them ("roti canai with dhal"). */
const SEPARATORS: ReadonlySet<string> = new Set(['and', 'dan', 'dengan', 'ngan', 'with', 'n', 'plus', 'also', 'serta']);

/** Words that carry no food or portion meaning in a meal description. */
const FILLERS: ReadonlySet<string> = new Set([
  'a', 'an', 'the', 'of', 'some', 'my', 'i', 'im', 'we', 'had', 'have', 'has', 'ate', 'eat', 'eating',
  'drank', 'just', 'only', 'then', 'for', 'at', 'in', 'on', 'from', 'kat', 'di', 'dekat', 'dari', 'untuk',
  'je', 'jer', 'ja', 'sahaja', 'saja', 'sekali', 'juga', 'pun', 'lah', 'la', 'kot', 'tadi', 'semalam',
  'today', 'yesterday', 'tonight', 'lunch', 'dinner', 'breakfast', 'brunch', 'supper', 'sarapan',
  'tengahari', 'makan', 'minum', 'malam', 'pagi', 'petang', 'pastu', 'lepas', 'tu', 'itu', 'ini', 'this',
  'that', 'about', 'around', 'roughly', 'approx', 'maybe', 'mungkin', 'like', 'hot', 'cold', 'warm',
  'panas', 'sejuk', 'suam', 'pedas', 'spicy', 'manis', 'sweet', 'bungkus', 'tapau', 'takeaway', 'dine',
  'sini', 'side', 'order', 'ordered', 'got', 'rm', 'am', 'pm', 'tak', 'tidak', 'no', 'not', 'x', 'ice', 'ais',
  'peng', 'nak', 'mau', 'mahu', 'tanpa', 'without', 'takde', 'tiada',
  // Praise and chatter around a meal: "nasi lemak sedap gila", "it was quite filling actually".
  'sedap', 'best', 'gila', 'sangat', 'sgt', 'betul', 'memang', 'very', 'so', 'really', 'quite', 'nice', 'good',
  'delicious', 'yummy', 'tasty', 'filling', 'actually', 'it', 'was', 'is', 'are', 'were', 'too', 'again',
  'lagi', 'before', 'after', 'near', 'office', 'pejabat', 'opis', 'work', 'kerja', 'morning', 'afternoon', 'evening',
  'night', 'noon', 'early', 'late', 'lewat', 'awal', 'dalam',
  // Strength and dilution change little we count: "kopi kaw", "teh o po".
  'kaw', 'kau', 'po', 'cair', 'pekat', 'thick', 'strong',
  // Garnish and cooking words that don't change the dish's chips.
  'bawang', 'onion', 'onions', 'garlic', 'cili', 'chilli', 'chili',
  ...UNIT_WORDS,
]);

/**
 * Ice, spice and dine-in requests change nothing we count. Listed as phrases so "less ice"
 * isn't read as less sugar and "tak pedas" doesn't look like part of a dish name.
 */
const FILLER_PHRASES: readonly (readonly string[])[] = [
  'no ice', 'tak nak ais', 'tanpa ais',
  'tak pedas', 'kurang pedas', 'less spicy', 'not spicy',
  'no spicy', 'pedas sikit', 'sikit pedas', 'extra pedas', 'lebih pedas', 'extra spicy', 'makan sini', 'dine in',
  'take away', 'bungkus balik',
  // Oil and onion requests don't add an item: "nasi goreng minyak sikit", "less oil".
  'minyak sikit', 'sikit minyak', 'kurang minyak', 'minyak kurang', 'less oil', 'little oil', 'no oil', 'tak nak minyak',
  'tanpa minyak', 'no onion', 'no onions', 'tak nak bawang', 'tanpa bawang', 'less salt', 'kurang garam',
].map(tokenise);

/** Words that drop the food after them: "no egg", "tak nak dhal", "tanpa sambal". */
const NEGATIONS: readonly (readonly string[])[] = [
  'no', 'tak nak', 'tak mau', 'tak mahu', 'x nak', 'x mau', 'tanpa', 'without', 'takde', 'tak de', 'tiada',
  'tak letak', 'jangan', 'minus', 'hold the', 'no need',
].map(tokenise);

/** Length of the longest negation at `index`, or 0. */
export function negationLength(tokens: readonly string[], index: number): number {
  let longest = 0;
  for (const phrase of NEGATIONS) {
    if (phrase.length > longest && matchesAt(tokens, index, phrase)) longest = phrase.length;
  }
  return longest;
}

/** "kat mamak", "at the mamak", "from the kedai": after these, a place noun is where, not what. */
const PLACE_PREPOSITIONS: ReadonlySet<string> = new Set(['kat', 'dekat', 'di', 'at', 'from', 'the', 'in', 'ke', 'near', 'dari', 'to']);
const PLACE_WORDS: ReadonlySet<string> = new Set([
  'mamak', 'kedai', 'restoran', 'restaurant', 'warung', 'gerai', 'stall', 'cafe', 'kafe', 'office', 'opis', 'pejabat',
  'rumah', 'home', 'kantin', 'canteen', 'foodcourt', 'medan', 'pasar', 'kopitiam', 'hawker', 'mall',
]);

/** A place noun right after a preposition ("nasi goreng kat mamak"): never a size or a dish. */
export function isPlaceWord(tokens: readonly string[], index: number): boolean {
  const token = tokens[index];
  const previous = tokens[index - 1];
  return token !== undefined && previous !== undefined && PLACE_WORDS.has(token) && PLACE_PREPOSITIONS.has(previous);
}

export function isSeparator(token: string): boolean {
  return SEPARATORS.has(token);
}

/** Filler words, and leftover numbers that aren't quantities ("2026", "50%"); "100plus" is a name, not a number. */
export function isFiller(token: string): boolean {
  return FILLERS.has(token) || /^\d+(\.\d+)?%?$/.test(token);
}

/** Length of the longest filler phrase at `index`, or 0. */
export function fillerPhraseLength(tokens: readonly string[], index: number): number {
  let longest = 0;
  for (const phrase of FILLER_PHRASES) {
    if (phrase.length > longest && matchesAt(tokens, index, phrase)) longest = phrase.length;
  }
  return longest;
}

/** Prices and clock times are not food: "rm 12", "rm9.50", "7.30 pm", "8am". */
export function priceOrTimeLength(tokens: readonly string[], index: number): number {
  const token = tokens[index];
  if (token === undefined) return 0;
  if (/^rm\d+(\.\d+)?$/.test(token) || /^\d+(\.\d+)?(am|pm)$/.test(token)) return 1;
  const next = tokens[index + 1];
  if (token === 'rm' && next !== undefined && /^\d+(\.\d+)?$/.test(next)) return 2;
  if (/^\d+(\.\d+)?$/.test(token) && (next === 'am' || next === 'pm')) return 2;
  return 0;
}
