/** Keys on the C50 number pad. */
export type WeightKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '.' | 'backspace';

export const KEYPAD_LAYOUT: readonly WeightKey[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'backspace'];

const MAX_INT_DIGITS = 3;
const MAX_DECIMALS = 1;

/**
 * Applies one key press to the typed weight. kg to one decimal, at most 3 digits before the point.
 * `fresh` (the previous value was just saved) makes the next key start a new entry.
 * Keys that would make the value invalid are ignored, so the result is always a valid prefix.
 */
export function applyWeightKey(current: string, key: WeightKey, fresh = false): string {
  const value = fresh ? '' : current;
  if (key === 'backspace') return value.slice(0, -1);

  const dot = value.indexOf('.');
  if (key === '.') {
    if (dot !== -1) return value;
    return value === '' ? '0.' : `${value}.`;
  }

  if (dot !== -1) {
    return value.length - dot - 1 >= MAX_DECIMALS ? value : value + key;
  }
  if (value === '0') return key; // no leading zeros: "0" then "7" → "7"
  return value.length >= MAX_INT_DIGITS ? value : value + key;
}

/** Maps a physical keyboard key to a pad key ("," also types the decimal point). */
export function keyFromKeyboard(key: string): WeightKey | null {
  if (key === ',') return '.';
  if (key === 'Backspace') return 'backspace';
  return KEYPAD_LAYOUT.find((k) => k !== 'backspace' && k === key) ?? null;
}

/** A complete entry worth saving: 1–3 digits, optional single decimal, above zero. */
export function isSavableWeight(value: string): boolean {
  return /^\d{1,3}(\.\d)?$/.test(value) && Number(value) > 0;
}
