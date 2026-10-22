/**
 * The numbers on S35 Timing detail for one day: the first and last meal, the eating window, the
 * eating occasions and the last meal before the "Going to sleep" tap, each against the goal's own
 * rules. Pure; guess entries have no real time, so they never count. A missing tap is never read
 * as a late meal: the sleep numbers just aren't there.
 */
import { eatingWindow, MIN_BASELINE_SAMPLES, slotOffsetMinutes, usualSlotMinute, type SlotBaselines } from './timing';
import type { Instant, MealLog, MealSlot, TimingRules } from './types';

const MS_PER_HOUR = 3_600_000;
/** Float slack for comparing hours against a rule, the same as the insights use. */
const EPSILON = 1e-9;

export interface TimingMetricsInput {
  meals: readonly Pick<MealLog, 'eatenAt' | 'slot' | 'isGuess'>[];
  /** The goal's timing rules. */
  rules: TimingRules;
  baselines: SlotBaselines;
  sleepAt?: Instant;
  tz: string;
  rolloverHour: number;
}

export interface DayTimingMetrics {
  /** Real (non-guess) meals. */
  mealCount: number;
  first?: { at: Instant; slot: MealSlot };
  last?: { at: Instant; slot: MealSlot };
  /** First bite to last bite, in hours; unset with fewer than two meals. */
  windowHours?: number;
  /** Meals within 30 minutes of an occasion's first bite count as one. */
  occasions: number;
  /** Minutes the first meal sits from your usual time for its slot (positive = later), once that slot has 5 days of history. */
  firstOffsetMin?: number;
  /** That usual time, minutes after midnight (same condition). */
  usualFirstMin?: number;
  sleepTapped: boolean;
  /** Hours from the last meal at or before the sleep tap to the tap; unset without a tap or a meal before it. */
  beforeSleepHours?: number;
  /** Meals logged after the sleep tap (left out of beforeSleepHours). */
  mealsAfterSleep: number;
  /** Rule results; unset when the goal has no such rule or there is nothing to judge. */
  windowOk?: boolean;
  occasionsOk?: boolean;
  sleepOk?: boolean;
}

export function dayTimingMetrics(input: TimingMetricsInput): DayTimingMetrics {
  const { rules, baselines, sleepAt } = input;
  const meals = input.meals
    .filter((m) => !m.isGuess)
    .map((m) => ({ eatenAt: m.eatenAt, slot: m.slot, ms: Date.parse(m.eatenAt) }))
    .filter((m) => Number.isFinite(m.ms))
    .sort((a, b) => a.ms - b.ms);
  const first = meals[0];
  const last = meals[meals.length - 1];

  const metrics: DayTimingMetrics = {
    mealCount: meals.length,
    occasions: eatingWindow(meals, rules, { tz: input.tz, rolloverHour: input.rolloverHour }).occasions,
    sleepTapped: sleepAt !== undefined,
    mealsAfterSleep: 0,
  };
  if (first && last) {
    metrics.first = { at: first.eatenAt, slot: first.slot };
    metrics.last = { at: last.eatenAt, slot: last.slot };
    if (meals.length >= 2) metrics.windowHours = (last.ms - first.ms) / MS_PER_HOUR;
    if (baselines[first.slot].samples >= MIN_BASELINE_SAMPLES) {
      metrics.usualFirstMin = usualSlotMinute(first.slot, baselines);
      metrics.firstOffsetMin = slotOffsetMinutes(first, baselines, input.tz);
    }
  }

  const sleepMs = sleepAt === undefined ? NaN : Date.parse(sleepAt);
  if (Number.isFinite(sleepMs)) {
    metrics.mealsAfterSleep = meals.filter((m) => m.ms > sleepMs).length;
    const lastBefore = meals.filter((m) => m.ms <= sleepMs).at(-1);
    if (lastBefore) metrics.beforeSleepHours = (sleepMs - lastBefore.ms) / MS_PER_HOUR;
  }

  // A fixed window (custom goals) has no hours limit; the screen shows the window itself.
  if (rules.maxWindowHours !== undefined && rules.fixedWindow === undefined && metrics.windowHours !== undefined) {
    metrics.windowOk = metrics.windowHours <= rules.maxWindowHours + EPSILON;
  }
  if (rules.maxEatingOccasions !== undefined && metrics.mealCount > 0) {
    metrics.occasionsOk = metrics.occasions <= rules.maxEatingOccasions;
  }
  if (rules.minHoursBeforeSleep !== undefined && metrics.beforeSleepHours !== undefined) {
    metrics.sleepOk = metrics.beforeSleepHours >= rules.minHoursBeforeSleep - EPSILON;
  }
  return metrics;
}
