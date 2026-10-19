import { addDays, instantAt } from './day';
import { fmtTime } from './format';
import {
  DEFAULT_SLOT_TIMES,
  MEAL_SLOTS,
  eatingWindow,
  isUsualSlot,
  slotBaselines,
  suggestSlot,
  timingTag,
  type SlotBaselines,
} from './timing';
import type { MealLog, MealSlot } from './types';

const FRI = '2026-10-16';

type HistoryMeal = Pick<MealLog, 'eatenAt' | 'slot' | 'logicalDay'>;

/** A meal at a wall-clock time on a logical day (hour ≥ 24 = after midnight). */
function at(day: string, hour: number, minute: number, slot: MealSlot): HistoryMeal {
  return { eatenAt: instantAt(day, hour, minute), slot, logicalDay: day };
}

/** One meal a day on the days before Friday, at the given [hour, minute] times. */
function history(slot: MealSlot, times: [number, number][]): HistoryMeal[] {
  return times.map(([h, m], i) => at(addDays(FRI, -(i + 1)), h, m, slot));
}

const noHistory = slotBaselines([]);

describe('DEFAULT_SLOT_TIMES', () => {
  it('matches the contract', () => {
    expect(DEFAULT_SLOT_TIMES).toEqual({ breakfast: 570, lunch: 810, dinner: 1230, snack: 960, supper: 1410 });
    expect(MEAL_SLOTS).toEqual(['breakfast', 'lunch', 'snack', 'dinner', 'supper']);
  });
});

describe('eatingWindow', () => {
  const today = [at(FRI, 14, 15, 'lunch'), at(FRI, 10, 40, 'breakfast'), at(FRI, 10, 45, 'breakfast')];

  it('opens at the first meal and closes 12 hours later', () => {
    const w = eatingWindow(today, { maxWindowHours: 12 });
    expect(w.opensAt).toBe('2026-10-16T02:40:00.000Z');
    expect(w.closesAt).toBe('2026-10-16T14:40:00.000Z');
    expect(fmtTime(w.closesAt ?? '')).toBe('10:40pm');
  });

  it('measures first bite to last bite and counts eating occasions', () => {
    const w = eatingWindow(today, {});
    expect(w.lengthHours).toBeCloseTo(3 + 35 / 60, 10);
    // roti canai at 10:40 and teh tarik at 10:45 are one occasion
    expect(w.occasions).toBe(2);
  });

  it('defaults to 12 hours and respects a custom length', () => {
    expect(eatingWindow(today, {}).closesAt).toBe('2026-10-16T14:40:00.000Z');
    expect(fmtTime(eatingWindow(today, { maxWindowHours: 10 }).closesAt ?? '')).toBe('8:40pm');
  });

  it('counts grazing as separate occasions', () => {
    const grazing = [10, 11, 12, 13, 14, 15].map((h) => at(FRI, h, 0, 'snack'));
    expect(eatingWindow(grazing, {}).occasions).toBe(6);
    expect(eatingWindow(grazing, {}).lengthHours).toBe(5);
  });

  it('is empty without meals', () => {
    expect(eatingWindow([], {})).toEqual({ lengthHours: 0, occasions: 0 });
  });

  it('counts grazing every 25 minutes as separate occasions', () => {
    const grazing = [0, 25, 50, 75, 100, 125, 150].map((m) => at(FRI, 15, m, 'snack'));
    // 3:00 · 3:50 · 4:40 · 5:30pm start new occasions; the ones between join them.
    expect(eatingWindow(grazing, {}).occasions).toBe(4);
    expect(eatingWindow([at(FRI, 15, 0, 'snack'), at(FRI, 15, 30, 'snack')], {}).occasions).toBe(1);
  });

  it('uses a fixed window when the goal sets one', () => {
    const w = eatingWindow(today, { maxWindowHours: 12, fixedWindow: { startMin: 12 * 60, endMin: 20 * 60 } });
    expect(fmtTime(w.opensAt ?? '')).toBe('12:00pm');
    expect(fmtTime(w.closesAt ?? '')).toBe('8:00pm');
    expect(w.closesAt).toBe('2026-10-16T12:00:00.000Z');
    const late = eatingWindow(today, { fixedWindow: { startMin: 18 * 60, endMin: 2 * 60 } });
    expect(late.closesAt).toBe('2026-10-16T18:00:00.000Z'); // 2am on Saturday
    expect(timingTag(at(FRI, 10, 40, 'breakfast'), { baselines: noHistory, window: w })).toBe('outsideWindow');
    expect(timingTag(at(FRI, 14, 15, 'lunch'), { baselines: noHistory, window: w })).toBe('onTime');
  });
});

describe('slotBaselines', () => {
  it('gives the median and median absolute deviation per slot', () => {
    const b = slotBaselines(history('dinner', [[20, 0], [20, 30], [21, 0], [21, 30], [22, 0]]));
    expect(b.dinner).toEqual({ medianMin: 21 * 60, spreadMin: 30, samples: 5, share: 1 });
  });

  it('falls back to the default time for slots without history', () => {
    const b = slotBaselines(history('dinner', [[21, 0]]));
    expect(b.breakfast).toEqual({ medianMin: 570, spreadMin: 0, samples: 0, share: 0 });
    expect(noHistory.supper).toEqual({ medianMin: 1410, spreadMin: 0, samples: 0, share: 0 });
  });

  it('averages the middle two of an even count', () => {
    const b = slotBaselines(history('dinner', [[20, 0], [20, 30], [21, 0], [21, 30]]));
    expect(b.dinner.medianMin).toBe(20 * 60 + 45);
  });

  it('measures supper across midnight', () => {
    // 11:30pm, 12:30am, 12:00am → median midnight, not 12:30am
    const b = slotBaselines(history('supper', [[23, 30], [24, 30], [24, 0]]));
    expect(b.supper).toEqual({ medianMin: 0, spreadMin: 30, samples: 3, share: 1 });
  });

  it('takes one sample per day: the earliest meal in that slot', () => {
    const meals = [...history('dinner', [[21, 0], [21, 0], [21, 0], [21, 0]]), at(addDays(FRI, -1), 20, 0, 'dinner')];
    const b = slotBaselines(meals);
    expect(b.dinner.samples).toBe(4);
    expect(b.dinner.medianMin).toBe(21 * 60);
    // the day with both 9pm and 8pm counts as 8pm
    const sorted = slotBaselines([at(FRI, 21, 0, 'dinner'), at(FRI, 20, 0, 'dinner')]);
    expect(sorted.dinner).toMatchObject({ medianMin: 20 * 60, samples: 1 });
  });

  it('only uses the last 28 days', () => {
    const recent = history('dinner', [[21, 0], [21, 0], [21, 0], [21, 0], [21, 0]]);
    const old = [40, 41, 42].map((n) => at(addDays(FRI, -n), 18, 0, 'dinner' as const));
    expect(slotBaselines([...recent, ...old]).dinner).toEqual({ medianMin: 21 * 60, spreadMin: 0, samples: 5, share: 1 });
  });
});

describe('isUsualSlot', () => {
  it('needs 5 days of history on at least half the days', () => {
    const days = Array.from({ length: 28 }, (_, i) => addDays(FRI, -(i + 1)));
    const meals = [
      ...days.map((d) => at(d, 13, 30, 'lunch')),
      ...days.slice(0, 5).map((d) => at(d, 16, 0, 'snack')),
    ];
    const b = slotBaselines(meals);
    expect(b.snack).toMatchObject({ samples: 5, share: 5 / 28 });
    expect(isUsualSlot(b.snack)).toBe(false);
    expect(isUsualSlot(b.lunch)).toBe(true);
    expect(isUsualSlot(slotBaselines(history('dinner', [[21, 0], [21, 0], [21, 0], [21, 0]])).dinner)).toBe(false);
  });
});

describe('timingTag', () => {
  const tight: SlotBaselines = slotBaselines(history('breakfast', [[9, 25], [9, 30], [9, 30], [9, 35], [9, 30]]));

  it('flags a 10:40am breakfast as late against a tight 9:30am habit', () => {
    expect(tight.breakfast.medianMin).toBe(570);
    expect(timingTag(at(FRI, 10, 40, 'breakfast'), { baselines: tight })).toBe('lateForYou');
  });

  it('flags early meals and keeps near ones on time', () => {
    expect(timingTag(at(FRI, 10, 25, 'breakfast'), { baselines: tight })).toBe('onTime');
    expect(timingTag(at(FRI, 8, 15, 'breakfast'), { baselines: tight })).toBe('earlyForYou');
  });

  it('allows twice the spread when your times vary a lot', () => {
    const loose = slotBaselines(history('breakfast', [[8, 30], [9, 0], [9, 30], [10, 0], [10, 30], [11, 0]]));
    expect(loose.breakfast).toMatchObject({ medianMin: 585, spreadMin: 45 });
    expect(timingTag(at(FRI, 10, 40, 'breakfast'), { baselines: loose })).toBe('onTime');
    expect(timingTag(at(FRI, 11, 20, 'breakfast'), { baselines: loose })).toBe('lateForYou');
  });

  it('flags a meal after the window closes', () => {
    const window = eatingWindow([at(FRI, 10, 40, 'breakfast')], { maxWindowHours: 12 });
    const dinners = slotBaselines(history('dinner', [[22, 30], [22, 45], [23, 0], [22, 50], [22, 40]]));
    expect(timingTag(at(FRI, 22, 50, 'dinner'), { baselines: dinners, window })).toBe('outsideWindow');
    expect(timingTag(at(FRI, 22, 30, 'dinner'), { baselines: dinners, window })).toBe('onTime');
    expect(timingTag(at(FRI, 26, 0, 'supper'), { baselines: noHistory, window })).toBe('outsideWindow');
  });

  it('marks a usual 2:00am supper as after midnight', () => {
    const lateSuppers = slotBaselines(history('supper', [[25, 30], [25, 45], [26, 0], [26, 15], [26, 30]]));
    expect(lateSuppers.supper.medianMin).toBe(120);
    expect(timingTag(at(FRI, 26, 0, 'supper'), { baselines: lateSuppers })).toBe('afterMidnight');
  });

  it('calls a 2:00am supper late when 11:30pm is the usual (default) time', () => {
    expect(timingTag(at(FRI, 26, 0, 'supper'), { baselines: noHistory })).toBe('lateForYou');
    expect(timingTag(at(FRI, 24, 15, 'supper'), { baselines: noHistory })).toBe('afterMidnight');
  });

  it('uses DEFAULT_SLOT_TIMES ± 60 with fewer than 5 days of history', () => {
    const few = slotBaselines(history('breakfast', [[7, 0], [7, 0], [7, 0], [7, 0]]));
    expect(few.breakfast.samples).toBe(4);
    expect(timingTag(at(FRI, 9, 30, 'breakfast'), { baselines: few })).toBe('onTime');
    expect(timingTag(at(FRI, 7, 0, 'breakfast'), { baselines: few })).toBe('earlyForYou');
    expect(timingTag(at(FRI, 10, 40, 'breakfast'), { baselines: noHistory })).toBe('lateForYou');
    expect(timingTag(at(FRI, 14, 15, 'lunch'), { baselines: noHistory })).toBe('onTime');
  });

  it('respects the time zone and rollover hour', () => {
    const london = { eatenAt: '2026-10-16T09:30:00.000Z', slot: 'breakfast' as const }; // 10:30am BST
    expect(timingTag(london, { baselines: noHistory, tz: 'Europe/London' })).toBe('onTime');
    expect(timingTag(at(FRI, 24, 15, 'supper'), { baselines: noHistory, rolloverHour: 0 })).toBe('onTime');
  });
});

describe('suggestSlot', () => {
  it('suggests a slot from the wall-clock time', () => {
    expect(suggestSlot(instantAt(FRI, 5, 0))).toBe('breakfast');
    expect(suggestSlot(instantAt(FRI, 10, 40))).toBe('breakfast');
    expect(suggestSlot(instantAt(FRI, 11, 10))).toBe('lunch');
    expect(suggestSlot(instantAt(FRI, 14, 15))).toBe('lunch');
    expect(suggestSlot(instantAt(FRI, 15, 40))).toBe('lunch');
    expect(suggestSlot(instantAt(FRI, 16, 30))).toBe('snack');
    expect(suggestSlot(new Date(instantAt(FRI, 19, 10)))).toBe('dinner');
    expect(suggestSlot(instantAt(FRI, 23, 0))).toBe('supper');
    expect(suggestSlot(instantAt(FRI, 26, 0))).toBe('supper');
  });
});
