/**
 * One normal form for typed meals, catalogue names and variant labels, so they can be compared
 * token by token. Compatible with `normaliseName` in src/data/catalogue.ts, but keeps decimal
 * numbers ("1.5 scoops") and percentages ("50% sugar") whole, reads "1/2" and "½" as 0.5, and
 * keeps words in other scripts ("鸡饭") as tokens of their own so they're never lost.
 */

/**
 * A word with at least one letter ("teh", "7up", "x2"), a number ("2", "1.5", "50%"), or a run
 * of letters from another script.
 */
const TOKEN_PATTERN = /[a-z0-9]*[a-z][a-z0-9]*|\d+(?:\.\d+)?%?|(?:(?![a-z0-9])[\p{L}\p{M}])+/gu;

/**
 * Characters that always end an entry in a meal list. Full stops count unless they sit inside a
 * number. "&", "and", "dan", "dengan" and "with" are soft separators handled by the scanner, so
 * names such as "F&N" or "Roti canai with dhal" still match.
 */
const HARD_SEPARATOR = /[,;+|\n\r]+|(?<!\d)\.|\.(?!\d)/g;
/** A separator made of only commas and plus signs: a name can span it ("Bread, kaya, kopi", "Roti telur + dhal"). */
const JOINABLE_SEPARATOR = /^[,+]+$/;

/** "1/2" → "0.5": proper fractions with a small denominator only, so dates like 16/10 stay apart. */
function fractionsToDecimals(text: string): string {
  return text.replace(/(\d+)\s*[/⁄]\s*(\d+)/g, (whole, a: string, b: string) => {
    const top = Number(a);
    const bottom = Number(b);
    if (bottom < 2 || bottom > 10 || top <= 0 || top >= bottom) return whole;
    return String(Math.round((top / bottom) * 100) / 100);
  });
}

/** Lowercase, accents and apostrophes dropped, "&" read as "and", "×" as "x". */
function fold(text: string): string {
  return fractionsToDecimals(
    text
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/['’`]/g, '')
      .replace(/&/g, ' and ')
      .replace(/×/g, ' x '),
  );
}

export function tokenise(text: string): string[] {
  return fold(text).match(TOKEN_PATTERN) ?? [];
}

/** A token in a script other than Latin ("鸡饭"): food we can't read, passed on as typed. */
export function isForeignToken(token: string): boolean {
  return /^[^a-z0-9]/.test(token);
}

/** "  Teh-O  Ais!! " → "teh o ais". */
export function normaliseText(text: string): string {
  return tokenise(text).join(' ');
}

export interface TextPiece {
  tokens: string[];
  /** The separator after this piece was only commas or "+", so a name may run on into the next piece. */
  joinsNext: boolean;
}

/** Splits on hard separators and tokenises each piece, remembering which separators a name may span. */
export function splitPieces(text: string): TextPiece[] {
  const pieces: TextPiece[] = [];
  let start = 0;
  for (const match of text.matchAll(HARD_SEPARATOR)) {
    pieces.push({ tokens: tokenise(text.slice(start, match.index)), joinsNext: JOINABLE_SEPARATOR.test(match[0]) });
    start = match.index + match[0].length;
  }
  pieces.push({ tokens: tokenise(text.slice(start)), joinsNext: false });
  return pieces;
}

/** Splits on hard separators and tokenises each entry; empty entries are dropped. */
export function splitSegments(text: string): string[][] {
  return splitPieces(text)
    .map((piece) => piece.tokens)
    .filter((tokens) => tokens.length > 0);
}

export function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** True when `phrase` appears in `tokens` starting at `index`. */
export function matchesAt(tokens: readonly string[], index: number, phrase: readonly string[]): boolean {
  if (phrase.length === 0 || index + phrase.length > tokens.length) return false;
  return phrase.every((word, offset) => tokens[index + offset] === word);
}
