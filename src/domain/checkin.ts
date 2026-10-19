/**
 * Morning check-in (plan §10.2): spot a finished day that looks incomplete, so a missed
 * dinner doesn't turn into fake savings, and offer a typical portion as the guess.
 */
import { DEFAULT_ROLLOVER_HOUR, DEFAULT_TZ, addDays, compareDays, instantAt } from './day';
import { fmtClock, roundTo10 } from './format';
import { mealMacros } from './meal';
import { MEAL_SLOTS, isUsualSlot, type SlotBaselines } from './timing';
import type { Instant, LogicalDay, MealLog, MealSlot } from './types';

/** A gap at least this long, where a usual meal would sit, makes a day look incomplete. */
export const INCOMPLETE_GAP_HOURS = 6;
const HISTORY_WINDOW_DAYS = 28;
const MS_PER_HOUR = 3_600_000;
/** "You usually have dinner around 9pm": the usual time is rounded to the half hour. */
const USUAL_LABEL_STEP_MIN = 30;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid] ?? 0;
  if (sorted.length % 2 === 1) return upper;
  return ((sorted[mid - 1] ?? upper) + upper) / 2;
}

/**
 * Median kcal of that slot per day over the last 28 days of history, rounded to 10.
 * Several entries in one slot on one day are added up; earlier guesses are left out.
 */
export function typicalSlotKcal(history: MealLog[], slot: MealSlot): number | null {
  const logged = history.filter((m) => !m.isGuess);
  const latest = logged.reduce<LogicalDay | undefined>(
    (max, m) => (max === undefined || compareDays(m.logicalDay, max) > 0 ? m.logicalDay : max),
    undefined,
  );
  if (latest === undefined) return null;
  const start = addDays(latest, -(HISTORY_WINDOW_DAYS - 1));

  const perDay = new Map<LogicalDay, number>();
  for (const meal of logged) {
    if (meal.slot !== slot || compareDays(meal.logicalDay, start) < 0) continue;
    perDay.set(meal.logicalDay, (perDay.get(meal.logicalDay) ?? 0) + mealMacros(meal).kcal);
  }
  if (perDay.size === 0) return null;
  return roundTo10(median([...perDay.values()]));
}

export interface DayGap {
  /** The last meal before the gap. */
  from: Instant;
  hours: number;
  missingSlot: MealSlot;
  /** '9pm', '9:30pm'. */
  usualLabel: string;
}

export interface DayAnalysis {
  mealCount: number;
  kcal: number;
  looksIncomplete: boolean;
  gap?: DayGap;
}

/** The usual time of a slot on that logical day (times before the rollover fall on the next date). */
function usualInstantMs(day: LogicalDay, medianMin: number, tz: string, rolloverHour: number): number {
  const hour = Math.floor(medianMin / 60) + (medianMin < rolloverHour * 60 ? 24 : 0);
  return Date.parse(instantAt(day, hour, medianMin % 60, tz));
}

function usualLabel(medianMin: number): string {
  const rounded = Math.round(medianMin / USUAL_LABEL_STEP_MIN) * USUAL_LABEL_STEP_MIN;
  return fmtClock(rounded, { compact: true });
}

/**
 * Looks at one finished logical day. It looks incomplete when nothing was logged, or when a
 * usual slot (≥ 5 days of history, on at least half the days) has no meal and its usual time falls inside a gap of 6 h or
 * more: between two meals, or after the last meal until the "Going to sleep" tap (else the
 * end of the logical day).
 */
export function analyseDay(
  meals: MealLog[],
  ctx: { baselines: SlotBaselines; tz?: string; rolloverHour?: number; sleepAt?: Instant },
): DayAnalysis {
  const tz = ctx.tz ?? DEFAULT_TZ;
  const rolloverHour = ctx.rolloverHour ?? DEFAULT_ROLLOVER_HOUR;
  const sorted = [...meals].sort((a, b) => Date.parse(a.eatenAt) - Date.parse(b.eatenAt));
  const kcal = Math.round(sorted.reduce((sum, m) => sum + mealMacros(m).kcal, 0));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return { mealCount: 0, kcal: 0, looksIncomplete: true };

  const day = first.logicalDay;
  const lastMs = Date.parse(last.eatenAt);
  const sleepMs = ctx.sleepAt === undefined ? NaN : Date.parse(ctx.sleepAt);
  const endMs = Number.isFinite(sleepMs) && sleepMs > lastMs ? sleepMs : Date.parse(instantAt(day, rolloverHour + 24, 0, tz));

  const missing = MEAL_SLOTS.filter(
    (slot) => isUsualSlot(ctx.baselines[slot]) && !sorted.some((m) => m.slot === slot),
  ).map((slot) => ({ slot, atMs: usualInstantMs(day, ctx.baselines[slot].medianMin, tz, rolloverHour) }));

  const times = sorted.map((m) => Date.parse(m.eatenAt));
  const gaps = sorted.map((meal, i) => ({
    from: meal.eatenAt,
    startMs: times[i] ?? lastMs,
    endMs: times[i + 1] ?? endMs,
  }));

  let best: DayGap | undefined;
  let bestHours = 0;
  for (const gap of gaps) {
    const hours = (gap.endMs - gap.startMs) / MS_PER_HOUR;
    if (!(hours >= INCOMPLETE_GAP_HOURS) || hours <= bestHours) continue;
    const slotInGap = missing
      .filter((s) => s.atMs > gap.startMs && s.atMs < gap.endMs)
      .sort((a, b) => a.atMs - b.atMs)[0];
    if (!slotInGap) continue;
    bestHours = hours;
    best = {
      from: gap.from,
      hours: Math.round(hours * 10) / 10,
      missingSlot: slotInGap.slot,
      usualLabel: usualLabel(ctx.baselines[slotInGap.slot].medianMin),
    };
  }

  const analysis: DayAnalysis = { mealCount: sorted.length, kcal, looksIncomplete: best !== undefined };
  if (best) analysis.gap = best;
  return analysis;
}
