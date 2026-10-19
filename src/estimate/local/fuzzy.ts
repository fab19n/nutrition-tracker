/**
 * Typo tolerance for names typed with one thumb: "nasi kandr", "teh tarek", "rotti canai".
 * A typed word of 5+ letters may be one edit (insert, delete, substitute or swap) away from a
 * known word of 4+ letters; shorter words and numbers must match exactly, so everyday 4-letter
 * words ("kuih", "paru", "gila") never turn into a different food. At most 2 edits per name.
 */
import type { ModifierPhrase } from './lexicon';
import { isForeignToken } from './normalise';
import type { Term, TermIndex } from './terms';

const MIN_TYPED_LENGTH = 5;
const MIN_KNOWN_LENGTH = 4;
const MAX_EDITS_PER_NAME = 2;

/** Optimal string alignment distance, stopping early once it exceeds `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prevPrev: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min((prev[j] ?? Infinity) + 1, (row[j - 1] ?? Infinity) + 1, (prev[j - 1] ?? Infinity) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, (prevPrev[j - 2] ?? Infinity) + 1);
      }
      row.push(value);
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > max) return max + 1;
    prevPrev = prev;
    prev = row;
  }
  return prev[b.length] ?? max + 1;
}

function wordCost(typed: string, known: string): number {
  if (typed === known) return 0;
  if (typed.length < MIN_TYPED_LENGTH || known.length < MIN_KNOWN_LENGTH || /\d/.test(typed) || isForeignToken(typed)) {
    return Infinity;
  }
  return editDistance(typed, known, 1) <= 1 ? 1 : Infinity;
}

function termCost(window: readonly string[], term: readonly string[]): number {
  let total = 0;
  for (let i = 0; i < window.length; i += 1) {
    total += wordCost(window[i] ?? '', term[i] ?? '');
    if (total > MAX_EDITS_PER_NAME) return Infinity;
  }
  return total;
}

/** The closest name with exactly as many words as `window`, if it's within the edit budget. */
export function fuzzyTerm<T>(index: TermIndex<T>, window: readonly string[]): { term: Term<T>; cost: number } | undefined {
  let best: { term: Term<T>; cost: number } | undefined;
  for (const term of index.byLength.get(window.length) ?? []) {
    const cost = termCost(window, term.tokens);
    if (cost > 0 && Number.isFinite(cost) && (!best || cost < best.cost)) best = { term, cost };
  }
  return best;
}

/** A one-word modifier one edit away from `word` ("kurng" → kurang, "banjr" → banjir). */
export function fuzzyModifier(phrases: readonly ModifierPhrase[], word: string): ModifierPhrase | undefined {
  return phrases.find((phrase) => {
    const known = phrase.tokens[0];
    return known !== undefined && wordCost(word, known) === 1;
  });
}
