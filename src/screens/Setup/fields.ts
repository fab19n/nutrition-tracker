import { PROFILE_LIMITS, type NumberLimit } from '@/db/settings';
import { fmtInt, fmtKgDelta } from '@/domain/format';

const MINUS = '−';

/**
 * A goal's pace as weight change: 0.5 (lose) → '−0.5 kg', −0.25 (gain) → '+0.25 kg'.
 * fmtKgDelta rounds to one decimal, which would turn the 0.25 / 0.75 paces into 0.3 / 0.8.
 */
export function fmtPaceKg(paceKgPerWeek: number): string {
  const change = -paceKgPerWeek;
  if (Number.isInteger(Math.round(change * 1000) / 100)) return fmtKgDelta(change);
  const text = Math.abs(change).toFixed(2);
  return `${change < 0 ? MINUS : '+'}${text} kg`;
}

/**
 * Parsing and checking the typed numbers in setup (S02) and settings (S19).
 * Inputs are text fields with a numeric keyboard, so "78,6" is read as 78.6.
 */

export type BodyField = 'age' | 'heightCm' | 'weightKg';

export function parseNumber(text: string): number | null {
  const clean = text.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(clean)) return null;
  const value = Number(clean);
  return Number.isFinite(value) ? value : null;
}

const COPY: Record<BodyField, { empty: string; range: (l: NumberLimit) => string }> = {
  age: { empty: 'Add your age', range: (l) => `Age between ${l.min} and ${l.max}` },
  heightCm: { empty: 'Add your height', range: (l) => `Height between ${fmtInt(l.min)} and ${fmtInt(l.max)} cm` },
  weightKg: { empty: "Add today's weight", range: (l) => `Weight between ${fmtInt(l.min)} and ${fmtInt(l.max)} kg` },
};

/** The error line for a field, or null when the value is fine. Age must be a whole number. */
export function fieldError(field: BodyField, text: string): string | null {
  if (!text.trim()) return COPY[field].empty;
  const value = parseNumber(text);
  const limit = PROFILE_LIMITS[field];
  if (value === null || value < limit.min || value > limit.max) return COPY[field].range(limit);
  if (field === 'age' && !Number.isInteger(value)) return 'Age in whole years';
  return null;
}

/** The parsed value when valid, else null. */
export function fieldValue(field: BodyField, text: string): number | null {
  return fieldError(field, text) === null ? parseNumber(text) : null;
}
