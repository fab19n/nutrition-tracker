/**
 * Reads one entry of a meal list ("nasi kandar ayam goreng 2 ketul") into parts: food names by
 * greedy longest match, chip labels of the food just named, modifiers, quantities, separators
 * and filler. Words left over are retried with typo tolerance, then become an unknown dish
 * when they look like food, or are passed on as unmatched words when they don't.
 */
import { byId } from '@/data/catalogue';
import type { CatalogueItem, PersonalItem, Variant } from '@/domain/types';
import { fuzzyModifier, fuzzyTerm } from './fuzzy';
import { hasFoodWord } from './guess';
import {
  SINGLE_WORD_MODIFIERS,
  fillerPhraseLength,
  isFiller,
  isPlaceWord,
  isSeparator,
  modifierAt,
  negationLength,
  priceOrTimeLength,
  quantityAt,
  type ModifierPhrase,
} from './lexicon';
import { isForeignToken, matchesAt } from './normalise';
import { CATALOGUE_TERM_INDEX, longestTermAt, type TermIndex } from './terms';
import { labelsOf } from './variants';

export type ItemRef =
  /**
   * `candidates`: every entry the typed name could mean (more than one when ambiguous).
   * `term`: the name as matched ("garlic naan"), which can pick a chip on its own.
   */
  | { kind: 'catalogue'; item: CatalogueItem; candidates: readonly string[]; term?: string }
  /** Matched by the user's own name for it (may still point at a catalogue entry). */
  | { kind: 'personal'; personal: PersonalItem; item?: CatalogueItem }
  /** Not in the library or catalogue. `attached` is a catalogue item the words were stuck to. */
  | { kind: 'guess'; words: readonly string[]; unknownWords: readonly string[]; attached?: ItemRef };

interface Span {
  start: number;
  end: number;
}

export interface ItemPart extends Span {
  type: 'item';
  key: number;
  ref: ItemRef;
}

export type Part =
  | ItemPart
  | (Span & { type: 'label'; itemKey: number; label: string })
  | (Span & { type: 'modifier'; phrase: ModifierPhrase })
  | (Span & { type: 'quantity'; value: number })
  /** Words that don't look like food and sit next to none: reported, never estimated. */
  | (Span & { type: 'unmatched' })
  | (Span & { type: 'separator' | 'filler' | 'unknown' });

export interface ScanEnv {
  personalTerms: TermIndex<PersonalItem>;
  pick: (ids: readonly string[]) => CatalogueItem | undefined;
  nextKey: () => number;
}

/** A guessed dish never takes more words than this; longer runs are passed on as unmatched. */
const MAX_GUESS_WORDS = 6;

export function refCatalogueItem(ref: ItemRef): CatalogueItem | undefined {
  return ref.kind === 'guess' ? undefined : ref.item;
}

/** A correction's own chips, or the catalogue entry's when it saved none. */
export function personalVariants(personal: PersonalItem, item: CatalogueItem | undefined): Variant[] | undefined {
  return personal.variants?.length ? personal.variants : item?.variants;
}

export function refLabels(ref: ItemRef): string[] {
  if (ref.kind === 'catalogue') return labelsOf(ref.item.variants);
  if (ref.kind === 'personal') return labelsOf(personalVariants(ref.personal, ref.item));
  return [];
}

function personalRef(personal: PersonalItem): ItemRef {
  const item = personal.catalogueId === undefined ? undefined : byId(personal.catalogueId);
  return item ? { kind: 'personal', personal, item } : { kind: 'personal', personal };
}

/** A personal name beats a catalogue name of the same length: your library comes first. */
function itemAt(tokens: readonly string[], at: number, env: ScanEnv): { ref: ItemRef; length: number } | undefined {
  const personal = longestTermAt(env.personalTerms, tokens, at);
  const catalogue = longestTermAt(CATALOGUE_TERM_INDEX, tokens, at);
  const personalLength = personal?.tokens.length ?? 0;
  if (personal && personalLength >= (catalogue?.tokens.length ?? 0)) {
    const first = personal.refs[0];
    if (first) return { ref: personalRef(first), length: personalLength };
  }
  if (!catalogue) return undefined;
  const item = env.pick(catalogue.refs);
  if (!item) return undefined;
  return {
    ref: { kind: 'catalogue', item, candidates: catalogue.refs, term: catalogue.tokens.join(' ') },
    length: catalogue.tokens.length,
  };
}

/** "0%", "25%": the chip with that sugar level, else the nearest one (ties go to the sweeter). */
function percentLabel(token: string, labels: readonly string[]): string | undefined {
  const typed = /^(\d+)%$/.exec(token)?.[1];
  if (typed === undefined) return undefined;
  let best: { label: string; distance: number; pct: number } | undefined;
  for (const label of labels) {
    const pct = /^(\d+)% /.exec(label)?.[1];
    if (pct === undefined) continue;
    const distance = Math.abs(Number(pct) - Number(typed));
    if (!best || distance < best.distance || (distance === best.distance && Number(pct) > best.pct)) {
      best = { label, distance, pct: Number(pct) };
    }
  }
  return best?.label;
}

function labelAt(tokens: readonly string[], at: number, current: ItemPart | undefined): { label: string; length: number } | undefined {
  if (!current) return undefined;
  const labels = refLabels(current.ref);
  let best: { label: string; length: number } | undefined;
  for (const label of labels) {
    const words = label.split(' ');
    if (matchesAt(tokens, at, words) && words.length > (best?.length ?? 0)) best = { label, length: words.length };
  }
  if (best) return best;
  const token = tokens[at];
  const percent = token === undefined ? undefined : percentLabel(token, labels);
  return percent ? { label: percent, length: 1 } : undefined;
}

function isDrinkPart(part: Part | undefined): boolean {
  return part?.type === 'item' && refCatalogueItem(part.ref)?.category === 'drinks';
}

/**
 * Rice phrases that lead ("kurang nasi", "separuh nasi") lose to a shorter reading when their
 * last word starts a longer food name ("separuh nasi lemak" is half a nasi lemak), or when they
 * follow a drink whose own chip the first word is ("teh o ais kurang nasi lebih").
 */
function riceLeadYields(
  phrase: ModifierPhrase,
  tokens: readonly string[],
  at: number,
  previous: Part | undefined,
  hasLabel: boolean,
  env: ScanEnv,
): boolean {
  if (phrase.target !== 'rice' || phrase.side !== 'next' || phrase.tokens.length < 2) return false;
  const lastAt = at + phrase.tokens.length - 1;
  const nameFromLast = itemAt(tokens, lastAt, env);
  if (nameFromLast && nameFromLast.length > 1) return true;
  return hasLabel && isDrinkPart(previous);
}

/**
 * The longest reading at `at`. Equal lengths go label > food name > modifier > quantity >
 * filler phrase, so "2 pieces" after roti canai is its chip, "kuah lebih" is a modifier (not
 * kuah + "lebih") and "less ice" is filler (not "less").
 */
function bestPartAt(
  tokens: readonly string[],
  at: number,
  current: ItemPart | undefined,
  previous: Part | undefined,
  env: ScanEnv,
): Part | undefined {
  const options: Part[] = [];
  const label = labelAt(tokens, at, current);
  if (label && current) options.push({ type: 'label', start: at, end: at + label.length, itemKey: current.key, label: label.label });

  const item = itemAt(tokens, at, env);
  if (item) options.push({ type: 'item', start: at, end: at + item.length, key: env.nextKey(), ref: item.ref });

  let phrase = modifierAt(tokens, at);
  if (phrase && riceLeadYields(phrase, tokens, at, previous, label !== undefined, env)) {
    phrase = modifierAt(tokens, at, phrase.tokens.length - 1);
  }
  if (phrase) options.push({ type: 'modifier', start: at, end: at + phrase.tokens.length, phrase });

  const quantity = quantityAt(tokens, at);
  if (quantity) {
    // "2 buah potong": the unit word starts a food name, so the number stands alone.
    const nameAfter = quantity.hasUnit ? itemAt(tokens, at + 1, env) : undefined;
    const length = nameAfter && nameAfter.length > 1 ? 1 : quantity.length;
    options.push({ type: 'quantity', start: at, end: at + length, value: quantity.value });
  }

  const filler = fillerPhraseLength(tokens, at);
  if (filler > 0) options.push({ type: 'filler', start: at, end: at + filler });

  let best: Part | undefined;
  for (const option of options) {
    if (!best || option.end - option.start > best.end - best.start) best = option;
  }
  return best;
}

/** "no egg", "tak nak dhal": the negation and the food it names are dropped together. */
function negatedFoodLength(tokens: readonly string[], at: number, env: ScanEnv): number {
  const negation = negationLength(tokens, at);
  if (negation === 0) return 0;
  const food = itemAt(tokens, at + negation, env);
  return food ? negation + food.length : 0;
}

export function scanSegment(tokens: readonly string[], env: ScanEnv): Part[] {
  const parts: Part[] = [];
  let current: ItemPart | undefined;
  let at = 0;
  while (at < tokens.length) {
    const skip = priceOrTimeLength(tokens, at) || (isPlaceWord(tokens, at) ? 1 : 0);
    if (skip > 0) {
      parts.push({ type: 'filler', start: at, end: at + skip });
      at += skip;
      continue;
    }
    const part = bestPartAt(tokens, at, current, parts[parts.length - 1], env);
    const negated = negatedFoodLength(tokens, at, env);
    if (negated > 0 && negated > (part ? part.end - part.start : 0)) {
      parts.push({ type: 'filler', start: at, end: at + negated });
      at += negated;
      continue;
    }
    if (part) {
      parts.push(part);
      if (part.type === 'item') current = part;
      at = part.end;
      continue;
    }
    const token = tokens[at] ?? '';
    if (isSeparator(token)) {
      parts.push({ type: 'separator', start: at, end: at + 1 });
      current = undefined;
    } else {
      parts.push({ type: isFiller(token) ? 'filler' : 'unknown', start: at, end: at + 1 });
    }
    at += 1;
  }
  return parts;
}

// ---------------------------------------------------------------------------
// Leftover words
// ---------------------------------------------------------------------------

function knownItemAt(parts: readonly Part[], index: number): ItemPart | undefined {
  const part = parts[index];
  return part?.type === 'item' && part.ref.kind !== 'guess' ? part : undefined;
}

function fuzzyRef(window: readonly string[], env: ScanEnv): ItemRef | undefined {
  const personal = fuzzyTerm(env.personalTerms, window);
  const catalogue = fuzzyTerm(CATALOGUE_TERM_INDEX, window);
  if (personal && (!catalogue || personal.cost <= catalogue.cost)) {
    const first = personal.term.refs[0];
    if (first) return personalRef(first);
  }
  if (!catalogue) return undefined;
  const item = env.pick(catalogue.term.refs);
  return item ? { kind: 'catalogue', item, candidates: catalogue.term.refs, term: catalogue.term.tokens.join(' ') } : undefined;
}

/** A one-word modifier or chip label right after the run, which may finish a longer name ("mee gorng mamak"). */
function oneWordModifierAt(parts: readonly Part[], index: number): boolean {
  const part = parts[index];
  return (part?.type === 'modifier' || part?.type === 'label') && part.end - part.start === 1;
}

/**
 * Retries an unknown run with typo tolerance, alone or together with the food names right next
 * to it ("nasi kandr" → Rice (nasi kandar)), and with a one-word modifier after it that may
 * complete the name ("mee gorng mamak" is mee goreng mamak, not a Mamak big mee goreng).
 * Chip labels that pointed at a replaced food move to the new one. Returns the part range it replaced.
 */
function tryFuzzy(parts: Part[], first: number, last: number, tokens: readonly string[], env: ScanEnv): number | undefined {
  const hasLeft = knownItemAt(parts, first - 1) !== undefined;
  const hasRight = knownItemAt(parts, last + 1) !== undefined;
  const modifierAfter = oneWordModifierAt(parts, last + 1);
  const windows: [number, number][] = [];
  if (hasLeft && modifierAfter) windows.push([first - 1, last + 1]);
  if (hasLeft && hasRight) windows.push([first - 1, last + 1]);
  if (hasLeft) windows.push([first - 1, last]);
  if (hasRight) windows.push([first, last + 1]);
  if (modifierAfter) windows.push([first, last + 1]);
  windows.push([first, last]);

  for (const [from, to] of windows) {
    const start = parts[from]?.start ?? 0;
    const end = parts[to]?.end ?? start;
    const ref = fuzzyRef(tokens.slice(start, end), env);
    if (!ref) continue;
    const replacedKeys = new Set(parts.slice(from, to + 1).flatMap((p) => (p.type === 'item' ? [p.key] : [])));
    const key = env.nextKey();
    parts.splice(from, to - from + 1, { type: 'item', start, end, key, ref });
    for (const part of parts) if (part.type === 'label' && replacedKeys.has(part.itemKey)) part.itemKey = key;
    return from;
  }
  return undefined;
}

/** A typo of a one-word modifier ("kopi o ais kurng"). Returns the part index it replaced. */
function tryFuzzyModifier(parts: Part[], index: number, tokens: readonly string[]): number | undefined {
  const part = parts[index];
  const word = part ? tokens[part.start] : undefined;
  if (!part || word === undefined || part.end - part.start !== 1) return undefined;
  const phrase = fuzzyModifier(SINGLE_WORD_MODIFIERS, word);
  if (!phrase) return undefined;
  parts.splice(index, 1, { type: 'modifier', start: part.start, end: part.end, phrase });
  return index;
}

/**
 * Words the catalogue doesn't know usually describe the food next to them: "durian crepe" is a
 * crepe, not durian plus something. The run takes the food name on its left (or else its
 * right) and the whole phrase becomes one guessed dish. Words in another script stand alone.
 */
function absorb(parts: Part[], first: number, last: number, tokens: readonly string[], env: ScanEnv, foreign: boolean): number {
  const left = foreign ? undefined : knownItemAt(parts, first - 1);
  const right = left || foreign ? undefined : knownItemAt(parts, last + 1);
  const from = left ? first - 1 : first;
  const to = right ? last + 1 : last;
  const start = parts[from]?.start ?? 0;
  const end = parts[to]?.end ?? start;
  const unknownStart = parts[first]?.start ?? start;
  const unknownEnd = parts[last]?.end ?? end;
  const attached = (left ?? right)?.ref;
  const ref: ItemRef = {
    kind: 'guess',
    words: tokens.slice(start, end),
    unknownWords: tokens.slice(unknownStart, unknownEnd),
    ...(attached ? { attached } : {}),
  };
  parts.splice(from, to - from + 1, { type: 'item', start, end, key: env.nextKey(), ref });
  return from;
}

/**
 * Whether an unknown run should become a guessed dish: words in another script (food we can't
 * read), a run next to a food name, one that names a kind of food ("chicken chop"), or the
 * only thing in its entry ("lontong"). Chatter in a sentence ("near my office") is not food.
 */
function looksLikeFood(parts: readonly Part[], first: number, last: number, words: readonly string[]): boolean {
  if (words.some(isForeignToken)) return true;
  if (words.length > MAX_GUESS_WORDS && !hasFoodWord(words)) return false;
  if (knownItemAt(parts, first - 1) || knownItemAt(parts, last + 1)) return true;
  if (hasFoodWord(words)) return true;
  return !parts.some((p, i) => (i < first || i > last) && (p.type === 'item' || p.type === 'modifier' || p.type === 'label'));
}

/**
 * Resolves every run of unknown words: a food-name typo first, then a modifier typo, otherwise
 * a guessed dish when it looks like food, or unmatched words when it doesn't.
 */
export function resolveUnknown(scanned: readonly Part[], tokens: readonly string[], env: ScanEnv): Part[] {
  const parts = [...scanned];
  let index = 0;
  while (index < parts.length) {
    if (parts[index]?.type !== 'unknown') {
      index += 1;
      continue;
    }
    let last = index;
    while (parts[last + 1]?.type === 'unknown') last += 1;
    const start = parts[index]?.start ?? 0;
    const words = tokens.slice(start, parts[last]?.end ?? start);
    const foreign = words.some(isForeignToken);

    const fixed =
      (foreign ? undefined : tryFuzzy(parts, index, last, tokens, env)) ??
      (!foreign && last === index ? tryFuzzyModifier(parts, index, tokens) : undefined);
    if (fixed !== undefined) {
      index = fixed + 1;
      continue;
    }
    if (!looksLikeFood(parts, index, last, words)) {
      parts.splice(index, last - index + 1, { type: 'unmatched', start, end: parts[last]?.end ?? start });
      index += 1;
      continue;
    }
    index = absorb(parts, index, last, tokens, env, foreign) + 1;
  }
  return parts;
}
