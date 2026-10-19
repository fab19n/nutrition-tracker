/**
 * Conservative stand-ins for food the catalogue doesn't know (source 'aiGuess'): a typical
 * portion for the kind of food the words suggest, with a wide range and Small / Normal / Big
 * chips so one tap fixes the size.
 */
import { roundTo10 } from '@/domain/format';
import type { Macros, Variant } from '@/domain/types';

export const GUESS_UNCERTAINTY = 0.35;
export const GUESS_QUESTION = 'Roughly how big was it?';
export const GUESS_DEFAULT_KCAL = 300;
/** A whole plate seen only in a photo. */
export const PHOTO_GUESS_KCAL = 600;

/** Energy split as fractions of kcal: [protein, carbs, fat]. */
type EnergySplit = readonly [protein: number, carbs: number, fat: number];

interface GuessCategory {
  kcal: number;
  split: EnergySplit;
  words: ReadonlySet<string>;
}

const MIXED_SPLIT: EnergySplit = [0.15, 0.5, 0.35];

function category(kcal: number, split: EnergySplit, words: readonly string[]): GuessCategory {
  return { kcal, split, words: new Set(words) };
}

/** Typical portions, leaning high: an unknown dish is more often bigger than smaller. */
const CATEGORIES: readonly GuessCategory[] = [
  category(650, [0.14, 0.58, 0.28], ['nasi', 'rice', 'briyani', 'biryani', 'beriani', 'bubur', 'porridge', 'claypot']),
  category(600, [0.15, 0.55, 0.3], [
    'mee', 'mi', 'bihun', 'meehoon', 'kuey', 'kway', 'teow', 'noodle', 'noodles', 'pasta', 'spaghetti',
    'laksa', 'ramen', 'udon', 'pho', 'macaroni', 'lasagna',
  ]),
  category(450, [0.15, 0.48, 0.37], [
    'burger', 'sandwich', 'roti', 'pizza', 'wrap', 'bun', 'pau', 'bread', 'toast', 'kebab', 'shawarma',
    'hotdog', 'pie', 'puff',
  ]),
  category(400, [0.35, 0.1, 0.55], [
    'ayam', 'chicken', 'daging', 'beef', 'lembu', 'kambing', 'mutton', 'lamb', 'ikan', 'fish', 'udang',
    'prawn', 'sotong', 'squid', 'ketam', 'crab', 'steak', 'chop', 'itik', 'duck', 'kerang', 'cockles', 'telur', 'egg',
    'eggs', 'tauhu', 'tofu', 'meat', 'lauk',
  ]),
  category(350, [0.06, 0.55, 0.39], [
    'crepe', 'kek', 'cake', 'waffle', 'pancake', 'pudding', 'puding', 'tart', 'cookie', 'cookies', 'donut',
    'brownie', 'dessert', 'kuih', 'kueh', 'bingsu', 'churros', 'croissant', 'muffin', 'cheesecake', 'jelly',
    'aiskrim', 'icecream',
  ]),
  category(300, [0.3, 0.3, 0.4], ['sup', 'soup', 'sop', 'tomyam']),
  category(250, [0.08, 0.5, 0.42], ['keropok', 'kerepek', 'chips', 'snack', 'crackers', 'popcorn', 'nuts']),
  category(180, [0.05, 0.8, 0.15], [
    'teh', 'tea', 'kopi', 'coffee', 'jus', 'juice', 'drink', 'minuman', 'latte', 'mocha', 'smoothie',
    'milkshake', 'frappe', 'boba', 'soda', 'cincau',
  ]),
  category(150, [0.15, 0.35, 0.5], ['sayur', 'salad', 'vegetable', 'vegetables', 'veggies']),
  category(120, [0.05, 0.9, 0.05], ['buah', 'fruit', 'fruits']),
];

/** True when a word names a kind of food ("chicken", "mee", "kuih"), so the words are worth a guess. */
export function hasFoodWord(words: readonly string[]): boolean {
  return words.some((w) => CATEGORIES.some((c) => c.words.has(w)));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function macrosFromSplit(kcal: number, [protein, carbs, fat]: EnergySplit): Macros {
  return { kcal, proteinG: round1((kcal * protein) / 4), carbsG: round1((kcal * carbs) / 4), fatG: round1((kcal * fat) / 9) };
}

function scaleTo(m: Macros, kcal: number): Macros {
  const f = m.kcal > 0 ? kcal / m.kcal : 0;
  return { kcal, proteinG: round1(m.proteinG * f), carbsG: round1(m.carbsG * f), fatG: round1(m.fatG * f) };
}

/**
 * A Normal-size guess. Takes the larger of what the words suggest ("crepe" → dessert,
 * "nasi dagang" → a rice plate, not the plain scoop "nasi" matched) and the catalogue item they
 * were attached to ("mee goreng daging" keeps mee goreng's ~830); falls back to 300 kcal.
 */
export function guessMacros(words: readonly string[], attached?: Macros): Macros {
  let best: Macros | undefined;
  for (const c of CATEGORIES) {
    if (!words.some((w) => c.words.has(w))) continue;
    if (!best || c.kcal > best.kcal) best = macrosFromSplit(c.kcal, c.split);
  }
  if (attached && attached.kcal > 0 && (!best || attached.kcal > best.kcal)) best = scaleTo(attached, roundTo10(attached.kcal));
  return best ?? macrosFromSplit(GUESS_DEFAULT_KCAL, MIXED_SPLIT);
}

export function guessMacrosFor(kcal: number): Macros {
  return macrosFromSplit(kcal, MIXED_SPLIT);
}

const SIZES: readonly (readonly [label: string, factor: number])[] = [
  ['Small', 0.6],
  ['Normal', 1],
  ['Big', 1.5],
];

export const GUESS_NORMAL_INDEX = 1;
/** Normalised chip labels of a guessed dish, in guessVariants order. */
export const GUESS_LABELS: readonly string[] = SIZES.map(([label]) => label.toLowerCase());

/** Small / Normal / Big chips around a Normal guess, each rounded to 10 kcal. */
export function guessVariants(normal: Macros): Variant[] {
  return SIZES.map(([label, factor]) => ({
    id: label.toLowerCase(),
    label,
    macros: scaleTo(normal, roundTo10(normal.kcal * factor)),
  }));
}
