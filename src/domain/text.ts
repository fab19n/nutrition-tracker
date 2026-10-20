/**
 * Cutting typed text to a length. Characters are counted by code point, so a cut never leaves
 * half an emoji behind: a lone UTF-16 surrogate, which the account refuses to store.
 */

/**
 * `text` cut to at most `max` characters, `ellipsis` included. A cut drops the spaces it leaves
 * at the end; text that fits comes back as it is.
 */
export function clipText(text: string, max: number, ellipsis = ''): string {
  // No more code units than `max` means no more characters either: the usual case, without counting.
  if (text.length <= max) return text;
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  const keep = Math.max(0, max - Array.from(ellipsis).length);
  return `${chars.slice(0, keep).join('').trimEnd()}${ellipsis}`;
}
