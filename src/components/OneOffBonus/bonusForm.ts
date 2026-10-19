/**
 * OneOffBonus (C52) validation. Pure, so the form stays presentational and the messages can be
 * tested on their own.
 */
import { fmtInt } from '@/domain/format';

/** A one-off bonus is for an unusual day (a hike, a tournament), not a second target. */
export const BONUS_LIMITS = { minKcal: 1, maxKcal: 3000, maxReason: 60 } as const;

export interface BonusErrors {
  kcal?: string;
  reason?: string;
}

export interface BonusCheck {
  /** The whole kcal to add, when valid. */
  kcal: number | null;
  /** The reason as it will be saved (trimmed; may be empty). */
  reason: string;
  errors: BonusErrors;
  valid: boolean;
}

/** Digits with optional thousands commas ("1,200"). */
const WHOLE = /^\d{1,3}(,\d{3})*$|^\d+$/;

export function checkBonus(kcalText: string, reasonText: string): BonusCheck {
  const errors: BonusErrors = {};
  const trimmed = kcalText.trim();
  let kcal: number | null = null;

  if (trimmed === '') errors.kcal = 'Enter how many kcal to add.';
  else if (!WHOLE.test(trimmed)) errors.kcal = 'Use a whole number, like 300.';
  else {
    const n = Number(trimmed.replace(/,/g, ''));
    if (n < BONUS_LIMITS.minKcal) errors.kcal = 'Add at least 1 kcal.';
    else if (n > BONUS_LIMITS.maxKcal) errors.kcal = `Up to ${fmtInt(BONUS_LIMITS.maxKcal)} kcal for one day.`;
    else kcal = n;
  }

  const reason = reasonText.trim();
  if (reason.length > BONUS_LIMITS.maxReason) errors.reason = `Keep it to ${fmtInt(BONUS_LIMITS.maxReason)} characters.`;

  return { kcal, reason, errors, valid: kcal !== null && errors.reason === undefined };
}
