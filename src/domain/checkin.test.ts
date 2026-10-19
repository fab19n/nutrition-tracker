import { analyseDay, typicalSlotKcal } from './checkin';
import { addDays, instantAt } from './day';
import { fmtTime } from './format';
import { slotBaselines } from './timing';
import type { MealLog, MealSlot } from './types';

const THU = '2026-10-15';

function meal(day: string, hour: number, minute: number, slot: MealSlot, kcal = 500, extra: Partial<MealLog> = {}): MealLog {
  const eatenAt = instantAt(day, hour, minute);
  return {
    id: `${day}-${hour}${minute}-${slot}`,
    eatenAt,
    logicalDay: day,
    slot,
    name: slot,
    items: [
      {
        id: `${day}-${hour}${minute}-item`,
        name: slot,
        unitMacros: { kcal, proteinG: 20, carbsG: 60, fatG: 15 },
        quantity: 1,
        uncertainty: 0.15,
        source: 'catalogue',
      },
    ],
    method: 'text',
    finished: 'all',
    createdAt: eatenAt,
    updatedAt: eatenAt,
    syncState: 'local',
    ...extra,
  };
}

/** Ten earlier days with breakfast ~10:30, lunch ~2pm and dinner ~9pm. */
const usualHistory: MealLog[] = Array.from({ length: 10 }, (_, i) => {
  const day = addDays(THU, -(i + 1));
  const wobble = [-10, 0, 10, -5, 5][i % 5] ?? 0;
  return [
    meal(day, 10, 30 + wobble, 'breakfast', 420),
    meal(day, 14, 0, 'lunch', 640),
    meal(day, 21, 0 + wobble, 'dinner', 650),
  ];
}).flat();

const baselines = slotBaselines(usualHistory);

describe('analyseDay', () => {
  // Scenario B (design_handoff §9.6): 11:10am and 3:40pm, 1,240 kcal, slept ~1:30am.
  const scenarioB = [meal(THU, 11, 10, 'breakfast', 600), meal(THU, 15, 40, 'lunch', 640)];

  it('spots the missing dinner in scenario B', () => {
    expect(baselines.dinner.samples).toBeGreaterThanOrEqual(5);
    const result = analyseDay(scenarioB, { baselines, sleepAt: instantAt(THU, 25, 30) });
    expect(result.mealCount).toBe(2);
    expect(result.kcal).toBe(1240);
    expect(result.looksIncomplete).toBe(true);
    expect(result.gap).toEqual({
      from: instantAt(THU, 15, 40),
      hours: 9.8,
      missingSlot: 'dinner',
      usualLabel: '9pm',
    });
    expect(fmtTime(result.gap?.from ?? '')).toBe('3:40pm');
    expect(Math.round(result.gap?.hours ?? 0)).toBe(10);
  });

  it('runs the gap to the end of the logical day without a sleep tap', () => {
    const result = analyseDay(scenarioB, { baselines });
    expect(result.looksIncomplete).toBe(true);
    expect(result.gap?.hours).toBe(13.3); // 3:40pm → 5:00am
  });

  it('accepts meals in any order', () => {
    expect(analyseDay([...scenarioB].reverse(), { baselines })).toEqual(analyseDay(scenarioB, { baselines }));
  });

  it('finds a complete day complete', () => {
    const day = [meal(THU, 10, 30, 'breakfast', 420), meal(THU, 14, 0, 'lunch', 640), meal(THU, 21, 0, 'dinner', 700)];
    const result = analyseDay(day, { baselines });
    expect(result).toEqual({ mealCount: 3, kcal: 1760, looksIncomplete: false });
  });

  it('treats a day with nothing logged as incomplete', () => {
    expect(analyseDay([], { baselines })).toEqual({ mealCount: 0, kcal: 0, looksIncomplete: true });
  });

  it('ignores slots without at least 5 days of history', () => {
    const sparse = slotBaselines(usualHistory.filter((m) => m.slot !== 'dinner' || m.logicalDay > addDays(THU, -5)));
    expect(sparse.dinner.samples).toBe(4);
    expect(analyseDay(scenarioB, { baselines: sparse }).looksIncomplete).toBe(false);
  });

  it('ignores an occasional slot, even with 5 days of history', () => {
    const days = Array.from({ length: 28 }, (_, i) => addDays(THU, -(i + 1)));
    const history = days.flatMap((d, i) => [
      meal(d, 9, 30, 'breakfast', 420),
      meal(d, 13, 30, 'lunch', 640),
      meal(d, 20, 30, 'dinner', 650),
      ...(i < 5 ? [meal(d, 16, 0, 'snack', 150)] : []),
    ]);
    const usualDay = [meal(THU, 9, 30, 'breakfast', 420), meal(THU, 13, 30, 'lunch', 640), meal(THU, 20, 30, 'dinner', 650)];
    const result = analyseDay(usualDay, { baselines: slotBaselines(history) });
    expect(result.looksIncomplete).toBe(false);
    expect(result.gap).toBeUndefined();
  });

  it('needs a gap of 6 hours or more', () => {
    const earlyNight = analyseDay(scenarioB, { baselines, sleepAt: instantAt(THU, 20, 0) });
    expect(earlyNight.looksIncomplete).toBe(false);
    expect(earlyNight.gap).toBeUndefined();
  });

  it('ignores a sleep tap before the last meal', () => {
    const result = analyseDay(scenarioB, { baselines, sleepAt: instantAt(THU, 9, 0) });
    expect(result.gap?.hours).toBe(13.3);
  });

  it('spots a long gap between meals too', () => {
    const day = [meal(THU, 9, 0, 'breakfast', 420), meal(THU, 23, 30, 'supper', 300)];
    const result = analyseDay(day, { baselines });
    expect(result.looksIncomplete).toBe(true);
    expect(result.gap).toMatchObject({ from: instantAt(THU, 9, 0), hours: 14.5, missingSlot: 'lunch', usualLabel: '2pm' });
  });

  it('counts kcal after the finished factor', () => {
    const day = [meal(THU, 10, 30, 'breakfast', 420), meal(THU, 14, 0, 'lunch', 640, { finished: 'half' }), meal(THU, 21, 0, 'dinner', 700)];
    expect(analyseDay(day, { baselines }).kcal).toBe(420 + 320 + 700);
  });

  it('rounds the usual time to the half hour for the label', () => {
    const lateDinners = slotBaselines(
      Array.from({ length: 5 }, (_, i) => meal(addDays(THU, -(i + 1)), 21, 20, 'dinner')),
    );
    const result = analyseDay(scenarioB, { baselines: { ...baselines, dinner: lateDinners.dinner } });
    expect(result.gap?.usualLabel).toBe('9:30pm');
  });
});

describe('typicalSlotKcal', () => {
  it('is the median kcal of that slot per day, rounded to 10', () => {
    const dinners = [600, 650, 700, 640, 660].map((kcal, i) => meal(addDays(THU, -i), 21, 0, 'dinner', kcal));
    expect(typicalSlotKcal(dinners, 'dinner')).toBe(650);
    const odd = [601, 643, 700].map((kcal, i) => meal(addDays(THU, -i), 21, 0, 'dinner', kcal));
    expect(typicalSlotKcal(odd, 'dinner')).toBe(640);
  });

  it('adds up several entries in one slot on the same day', () => {
    const meals = [
      meal(THU, 21, 0, 'dinner', 500),
      meal(THU, 21, 10, 'dinner', 150),
      meal(addDays(THU, -1), 21, 0, 'dinner', 650),
      meal(addDays(THU, -2), 21, 0, 'dinner', 660),
    ];
    expect(typicalSlotKcal(meals, 'dinner')).toBe(650);
  });

  it('leaves out guesses and days older than 28 days', () => {
    const meals = [
      meal(THU, 21, 0, 'dinner', 650),
      meal(addDays(THU, -1), 21, 0, 'dinner', 2000, { isGuess: true }),
      meal(addDays(THU, -40), 21, 0, 'dinner', 1500),
      meal(addDays(THU, -41), 21, 0, 'dinner', 1500),
    ];
    expect(typicalSlotKcal(meals, 'dinner')).toBe(650);
  });

  it('works with the usual history', () => {
    expect(typicalSlotKcal(usualHistory, 'dinner')).toBe(650);
    expect(typicalSlotKcal(usualHistory, 'breakfast')).toBe(420);
  });

  it('is null without history for that slot', () => {
    expect(typicalSlotKcal(usualHistory, 'supper')).toBeNull();
    expect(typicalSlotKcal([], 'dinner')).toBeNull();
  });
});
