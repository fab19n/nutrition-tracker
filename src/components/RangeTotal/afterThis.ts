import { fmtInt, fmtSigned } from '@/domain/format';

export interface AfterThisInput {
  /** Already eaten today, before this meal. */
  eatenTodayKcal: number;
  /** This meal's best guess. */
  mealKcal: number;
  /** Today's allowance left before this meal (negative when already over). */
  leftTodayKcal: number;
  /** Saved this week from finished days. */
  savedKcal: number;
}

export interface AfterThis {
  /** Left today once this meal is counted (negative = over). */
  afterKcal: number;
  /** The part of this meal that fits in today's allowance. */
  fitKcal: number;
  /** The part of this meal beyond today's allowance. */
  overKcal: number;
  /** Today's total overspend after this meal (0 when within budget). */
  overTodayKcal: number;
  coveredBySavings: boolean;
  /** "After this: 120 kcal left today" · "After this: 310 over today · covered by your +650 saved". */
  line: string;
}

/** The effect of saving this meal on today, for the Review footer's bar and line. */
export function afterThis({ mealKcal, leftTodayKcal, savedKcal }: AfterThisInput): AfterThis {
  const meal = Math.max(0, mealKcal);
  const afterKcal = leftTodayKcal - meal;
  const fitKcal = Math.min(meal, Math.max(0, leftTodayKcal));
  const overKcal = meal - fitKcal;
  const overTodayKcal = Math.max(0, -afterKcal);
  const coveredBySavings = overTodayKcal > 0 && savedKcal >= overTodayKcal;

  let line: string;
  if (overTodayKcal === 0) line = `After this: ${fmtInt(afterKcal)} kcal left today`;
  else if (coveredBySavings) line = `After this: ${fmtInt(overTodayKcal)} over today · covered by your ${fmtSigned(savedKcal)} saved`;
  else line = `After this: ${fmtInt(overTodayKcal)} over today`;

  return { afterKcal, fitKcal, overKcal, overTodayKcal, coveredBySavings, line };
}
