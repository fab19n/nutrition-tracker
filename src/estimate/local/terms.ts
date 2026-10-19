/**
 * Food names the scanner can match: catalogue names and aliases, and the user's own
 * PersonalItems (food-data layer 1). Indexed by first token for greedy longest-match, and by
 * length for the fuzzy pass.
 */
import { CATALOGUE, NAME_INDEX, byId } from '@/data/catalogue';
import type { PersonalItem, Place } from '@/domain/types';
import { matchesAt, tokenise, type TextPiece } from './normalise';

export interface Term<T> {
  tokens: readonly string[];
  /** Everything this name can mean, best first (catalogue ids or personal items). */
  refs: readonly T[];
}

export interface TermIndex<T> {
  byFirst: ReadonlyMap<string, readonly Term<T>[]>;
  byLength: ReadonlyMap<number, readonly Term<T>[]>;
}

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export function buildTermIndex<T>(terms: readonly Term<T>[]): TermIndex<T> {
  const byFirst = new Map<string, Term<T>[]>();
  const byLength = new Map<number, Term<T>[]>();
  for (const term of terms) {
    const first = term.tokens[0];
    if (first === undefined || term.refs.length === 0) continue;
    pushTo(byFirst, first, term);
    pushTo(byLength, term.tokens.length, term);
  }
  for (const list of byFirst.values()) list.sort((a, b) => b.tokens.length - a.tokens.length);
  return { byFirst, byLength };
}

/** The longest name starting at `index`. */
export function longestTermAt<T>(index: TermIndex<T>, tokens: readonly string[], at: number): Term<T> | undefined {
  const first = tokens[at];
  if (first === undefined) return undefined;
  return index.byFirst.get(first)?.find((term) => matchesAt(tokens, at, term.tokens));
}

/** The exact term with these tokens, if any. */
export function exactTerm<T>(index: TermIndex<T>, tokens: readonly string[]): Term<T> | undefined {
  const term = longestTermAt(index, tokens, 0);
  return term && term.tokens.length === tokens.length ? term : undefined;
}

// ---------------------------------------------------------------------------
// Catalogue terms
// ---------------------------------------------------------------------------

/**
 * Plain-rice words mean a different catalogue entry depending on where you eat: an
 * economy-rice scoop, a nasi kandar plate or a home bowl. The Place and the rest of the meal
 * pick one (see resolve.ts).
 */
const GENERIC_RICE_TERMS: ReadonlySet<string> = new Set([
  'nasi',
  'rice',
  'white rice',
  'plain rice',
  'steamed rice',
  'nasi putih',
  'nasi kosong',
]);
const GENERIC_RICE_IDS = ['nasi-putih', 'rice-economy', 'rice-nasi-kandar'] as const;

/**
 * Pot ingredients (santan, cooking oil, gula…) are for splitting a recipe, not for logging a
 * meal: "kari" or "nasi goreng minyak sikit" must never add a can of santan or 4 tbsp of oil.
 */
export function isMealFood(id: string): boolean {
  return byId(id)?.category !== 'other';
}

function catalogueTerms(): Term<string>[] {
  const terms: Term<string>[] = [];
  for (const [name, ids] of NAME_INDEX) {
    const meal = ids.filter(isMealFood);
    const refs = GENERIC_RICE_TERMS.has(name) ? [...new Set([...meal, ...GENERIC_RICE_IDS])] : meal;
    if (refs.length > 0) terms.push({ tokens: tokenise(name), refs });
  }
  for (const name of GENERIC_RICE_TERMS) {
    if (!NAME_INDEX.has(name)) terms.push({ tokens: tokenise(name), refs: [...GENERIC_RICE_IDS] });
  }
  return terms;
}

export const CATALOGUE_TERM_INDEX: TermIndex<string> = buildTermIndex(catalogueTerms());

// ---------------------------------------------------------------------------
// Names written with "," or "+"
// ---------------------------------------------------------------------------

const PUNCTUATED = /[,+]/;

/** Catalogue names and aliases written with a comma or "+" ("Bread, kaya, kopi", "Roti telur + dhal"). */
function punctuatedCatalogueTerms(): Term<string>[] {
  return CATALOGUE.filter((item) => isMealFood(item.id)).flatMap((item) =>
    [item.name, ...item.aliases].filter((name) => PUNCTUATED.test(name)).map((name) => ({ tokens: tokenise(name), refs: [item.id] })),
  );
}

export const PUNCTUATED_TERM_INDEX: TermIndex<string> = buildTermIndex(punctuatedCatalogueTerms());

/** The user's own names written with a comma or "+". */
export function punctuatedPersonalIndex(personal: readonly PersonalItem[]): TermIndex<PersonalItem> {
  return buildTermIndex(personal.filter((p) => PUNCTUATED.test(p.name)).map((p) => ({ tokens: tokenise(p.name), refs: [p] })));
}

function longestSpan(indexes: readonly TermIndex<unknown>[], tokens: readonly string[], at: number): number {
  let longest = 0;
  for (const index of indexes) longest = Math.max(longest, longestTermAt(index, tokens, at)?.tokens.length ?? 0);
  return longest;
}

/**
 * Splits the text into entries, keeping a name that is written with "," or "+" in one entry
 * ("Bread, kaya, kopi" is one usual, not bread + kaya + kopi). Only comma and "+" boundaries
 * can be spanned, and only by such a name.
 */
export function joinNamedPieces(pieces: readonly TextPiece[], indexes: readonly TermIndex<unknown>[]): string[][] {
  const flat: string[] = [];
  /** Token position where a new piece starts → whether a name may span that boundary. */
  const boundaries = new Map<number, boolean>();
  pieces.forEach((piece, i) => {
    if (i > 0) boundaries.set(flat.length, (boundaries.get(flat.length) ?? true) && (pieces[i - 1]?.joinsNext ?? false));
    flat.push(...piece.tokens);
  });

  const spanned = new Set<number>();
  for (let at = 0; at < flat.length; at += 1) {
    const end = at + longestSpan(indexes, flat, at);
    const inside = [...boundaries.keys()].filter((b) => b > at && b < end);
    if (inside.length > 0 && inside.every((b) => boundaries.get(b) === true)) for (const b of inside) spanned.add(b);
  }

  const segments: string[][] = [];
  let current: string[] = [];
  flat.forEach((token, i) => {
    if (i > 0 && boundaries.has(i) && !spanned.has(i)) {
      if (current.length > 0) segments.push(current);
      current = [];
    }
    current.push(token);
  });
  if (current.length > 0) segments.push(current);
  return segments;
}

// ---------------------------------------------------------------------------
// Personal terms
// ---------------------------------------------------------------------------

/** Place-scoped corrections apply only at that Place; dish-scoped ones apply everywhere. */
export function applicablePersonal(personal: readonly PersonalItem[], place: Place | undefined): PersonalItem[] {
  return personal.filter((p) => p.scope === 'dish' || (place !== undefined && p.scope === 'place' && p.placeId === place.id));
}

/** Place corrections first, then the most-corrected, then the most recent. */
export function comparePersonal(a: PersonalItem, b: PersonalItem): number {
  const scopeRank = (p: PersonalItem): number => (p.scope === 'place' ? 0 : 1);
  return scopeRank(a) - scopeRank(b) || b.corrections - a.corrections || b.updatedAt.localeCompare(a.updatedAt);
}

/** The user's own names for their items ("Mak's kari ayam"), best first per name. */
export function personalTermIndex(applicable: readonly PersonalItem[]): TermIndex<PersonalItem> {
  const byName = new Map<string, PersonalItem[]>();
  for (const item of applicable) {
    const tokens = tokenise(item.name);
    if (tokens.length > 0) pushTo(byName, tokens.join(' '), item);
  }
  return buildTermIndex(
    [...byName.values()].map((items) => {
      const refs = [...items].sort(comparePersonal);
      return { tokens: tokenise(refs[0]?.name ?? ''), refs };
    }),
  );
}
