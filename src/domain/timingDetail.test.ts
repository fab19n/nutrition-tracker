import { addDays, instantAt } from './day';
import { dayTimingMetrics } from './timingDetail';
import { slotBaselines, type SlotBaselines } from './timing';
import type { MealLog, MealSlot, TimingRules } from './types';

const THU = '2026-10-15';
const FRI = '2026-10-16';
const CUT: TimingRules = { maxWindowHours: 12, minHoursBeforeSleep: 2, maxEatingOccasions: 5 };
const TZ = 'Asia/Kuala_Lumpur';

type TimedMeal = Pick<MealLog, 'eatenAt' | 'slot' | 'isGuess'>;

function at(day: string, hour: number, minute: number, slot: MealSlot, isGuess?: boolean): TimedMeal {
  return isGuess === undefined ? { eatenAt: instantAt(day, hour, minute), slot } : { eatenAt: instantAt(day, hour, minute), slot, isGuess };
}

/** Five days of a 9:30 breakfast, 1:30pm lunch and 8:45pm dinner before Thursday. */
const baselines: SlotBaselines = slotBaselines(
  Array.from({ length: 6 }, (_, i) => addDays(THU, -(i + 1))).flatMap((day) => [
    { logicalDay: day, ...at(day, 9, 30, 'breakfast') },
    { logicalDay: day, ...at(day, 13, 30, 'lunch') },
    { logicalDay: day, ...at(day, 20, 45, 'dinner') },
  ]),
  TZ,
  5,
);
const noHistory = slotBaselines([]);

const thursday: TimedMeal[] = [at(THU, 9, 30, 'breakfast'), at(THU, 13, 30, 'lunch'), at(THU, 20, 45, 'dinner')];

function metrics(meals: readonly TimedMeal[], extra: Partial<Parameters<typeof dayTimingMetrics>[0]> = {}) {
  return dayTimingMetrics({ meals, rules: CUT, baselines, tz: TZ, rolloverHour: 5, ...extra });
}

describe('dayTimingMetrics', () => {
  it('reads the demo Thursday: 9:30, 1:30pm and 8:45pm', () => {
    const m = metrics(thursday);
    expect(m.mealCount).toBe(3);
    expect(m.first).toEqual({ at: thursday[0]?.eatenAt, slot: 'breakfast' });
    expect(m.last).toEqual({ at: thursday[2]?.eatenAt, slot: 'dinner' });
    expect(m.windowHours).toBeCloseTo(11.25, 6);
    expect(m.occasions).toBe(3);
    expect(m.windowOk).toBe(true);
    expect(m.occasionsOk).toBe(true);
    expect(m.sleepTapped).toBe(false);
    expect(m.beforeSleepHours).toBeUndefined();
    expect(m.sleepOk).toBeUndefined();
    expect(m.mealsAfterSleep).toBe(0);
  });

  it('puts the first meal against your usual time once that slot has 5 days', () => {
    const late = metrics([at(FRI, 10, 40, 'breakfast'), at(FRI, 14, 15, 'lunch')]);
    expect(late.firstOffsetMin).toBe(70);
    expect(late.usualFirstMin).toBe(9 * 60 + 30);
    const early = metrics([at(FRI, 8, 50, 'breakfast')]);
    expect(early.firstOffsetMin).toBe(-40);
  });

  it('leaves the first-meal offset out under 5 days of that slot', () => {
    const m = metrics([at(FRI, 10, 40, 'breakfast'), at(FRI, 14, 15, 'lunch')], { baselines: noHistory });
    expect(m.firstOffsetMin).toBeUndefined();
    expect(m.usualFirstMin).toBeUndefined();
    expect(m.first?.slot).toBe('breakfast');
  });

  it('measures the last meal before a Going to sleep tap at 1:30am', () => {
    const m = metrics(thursday, { sleepAt: instantAt(THU, 25, 30) });
    expect(m.sleepTapped).toBe(true);
    expect(m.beforeSleepHours).toBeCloseTo(4.75, 6);
    expect(m.sleepOk).toBe(true);
    expect(m.mealsAfterSleep).toBe(0);
  });

  it('flags a night when the last meal was close to sleep', () => {
    const m = metrics([...thursday, at(THU, 23, 45, 'supper')], { sleepAt: instantAt(THU, 25, 0) });
    expect(m.beforeSleepHours).toBeCloseTo(1.25, 6);
    expect(m.sleepOk).toBe(false);
  });

  it('meets the rule at exactly the minimum', () => {
    const m = metrics(thursday, { sleepAt: instantAt(THU, 22, 45) });
    expect(m.beforeSleepHours).toBeCloseTo(2, 9);
    expect(m.sleepOk).toBe(true);
  });

  it('counts meals logged after the tap and leaves them out of the hours', () => {
    const m = metrics([...thursday, at(THU, 25, 30, 'supper')], { sleepAt: instantAt(THU, 24, 0) });
    expect(m.mealsAfterSleep).toBe(1);
    expect(m.beforeSleepHours).toBeCloseTo(3.25, 6);
    expect(m.sleepOk).toBe(true);
    // The window still runs to the last meal, tap or not.
    expect(m.windowHours).toBeCloseTo(16, 6);
    expect(m.windowOk).toBe(false);
  });

  it('has no hours when every meal came after the tap', () => {
    const m = metrics([at(THU, 25, 30, 'supper')], { sleepAt: instantAt(THU, 24, 0) });
    expect(m.sleepTapped).toBe(true);
    expect(m.beforeSleepHours).toBeUndefined();
    expect(m.sleepOk).toBeUndefined();
    expect(m.mealsAfterSleep).toBe(1);
  });

  it('reads a meal at the very moment of the tap as before it', () => {
    const m = metrics([at(THU, 23, 0, 'dinner')], { sleepAt: instantAt(THU, 23, 0) });
    expect(m.beforeSleepHours).toBe(0);
    expect(m.mealsAfterSleep).toBe(0);
    expect(m.sleepOk).toBe(false);
  });

  it('does not judge a day without a tap', () => {
    const m = metrics(thursday);
    expect(m.sleepTapped).toBe(false);
    expect(m.sleepOk).toBeUndefined();
  });

  it('has no window with one meal, but one occasion', () => {
    const m = metrics([at(THU, 13, 30, 'lunch')]);
    expect(m.mealCount).toBe(1);
    expect(m.windowHours).toBeUndefined();
    expect(m.windowOk).toBeUndefined();
    expect(m.occasions).toBe(1);
    expect(m.occasionsOk).toBe(true);
    expect(m.first).toEqual(m.last);
  });

  it('has nothing to say without meals', () => {
    const m = metrics([], { sleepAt: instantAt(THU, 25, 0) });
    expect(m).toEqual({ mealCount: 0, occasions: 0, sleepTapped: true, mealsAfterSleep: 0 });
  });

  it('ignores guess entries', () => {
    const m = metrics([at(THU, 7, 0, 'breakfast', true), ...thursday, at(THU, 23, 59, 'supper', true)]);
    expect(m.mealCount).toBe(3);
    expect(m.first?.slot).toBe('breakfast');
    expect(m.first?.at).toBe(thursday[0]?.eatenAt);
    expect(m.windowHours).toBeCloseTo(11.25, 6);
    expect(metrics([at(THU, 13, 30, 'lunch', true)]).mealCount).toBe(0);
  });

  it('counts meals within 30 minutes of an occasion’s first bite as one occasion', () => {
    const m = metrics([at(THU, 9, 30, 'breakfast'), at(THU, 9, 50, 'breakfast'), at(THU, 10, 15, 'snack'), at(THU, 13, 30, 'lunch')]);
    expect(m.occasions).toBe(3);
  });

  it('flags a window over the limit and too many occasions', () => {
    const grazing = [9, 11, 13, 15, 17, 19].map((h) => at(THU, h, 0, 'snack'));
    const m = metrics(grazing);
    expect(m.occasions).toBe(6);
    expect(m.occasionsOk).toBe(false);
    expect(m.windowHours).toBe(10);
    expect(m.windowOk).toBe(true);
    const long = metrics([at(THU, 8, 0, 'breakfast'), at(THU, 20, 30, 'dinner')]);
    expect(long.windowHours).toBe(12.5);
    expect(long.windowOk).toBe(false);
    // Exactly 12 h is within the limit.
    expect(metrics([at(THU, 8, 0, 'breakfast'), at(THU, 20, 0, 'dinner')]).windowOk).toBe(true);
  });

  it('judges only the rules the goal has', () => {
    const m = metrics(thursday, { rules: {}, sleepAt: instantAt(THU, 25, 30) });
    expect(m.windowHours).toBeCloseTo(11.25, 6);
    expect(m.occasions).toBe(3);
    expect(m.beforeSleepHours).toBeCloseTo(4.75, 6);
    expect(m.windowOk).toBeUndefined();
    expect(m.occasionsOk).toBeUndefined();
    expect(m.sleepOk).toBeUndefined();
  });

  it('has no hours limit for a fixed-window goal', () => {
    const m = metrics(thursday, { rules: { fixedWindow: { startMin: 10 * 60, endMin: 20 * 60 }, minHoursBeforeSleep: 2 }, sleepAt: instantAt(THU, 25, 30) });
    expect(m.windowHours).toBeCloseTo(11.25, 6);
    expect(m.windowOk).toBeUndefined();
    expect(m.sleepOk).toBe(true);
    const both = metrics(thursday, { rules: { fixedWindow: { startMin: 10 * 60, endMin: 20 * 60 }, maxWindowHours: 8 } });
    expect(both.windowOk).toBeUndefined();
  });

  it('sorts meals that arrive out of order', () => {
    const m = metrics([thursday[2] as TimedMeal, thursday[0] as TimedMeal, thursday[1] as TimedMeal]);
    expect(m.first?.slot).toBe('breakfast');
    expect(m.last?.slot).toBe('dinner');
  });
});
