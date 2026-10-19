import { computeWeekBudget, daysInRange, spreadShortfall, type BudgetDayInput } from './budget';
import { weekDays } from './day';
import type { DayStatusKind } from './types';

const [MON, TUE, WED, THU, FRI, SAT, SUN] = weekDays('2026-10-12') as [string, string, string, string, string, string, string];
const MIN = 1400;

function day(dayId: string, eatenKcal: number, status: DayStatusKind | null, extra: Partial<BudgetDayInput> = {}): BudgetDayInput {
  return { day: dayId, targetKcal: 1800, eatenKcal, workoutKcal: 0, bonusKcal: 0, status, ...extra };
}

/** The design's sample week: Mon–Thu complete, today Friday. */
function sampleWeek(fridayEaten = 1230, overrides: Partial<Record<string, Partial<BudgetDayInput>>> = {}): BudgetDayInput[] {
  const base = [
    day(MON, 1620, 'complete'),
    day(TUE, 1710, 'complete'),
    day(WED, 1540, 'complete'),
    day(THU, 1680, 'complete'),
    day(FRI, fridayEaten, null),
    day(SAT, 0, null),
    day(SUN, 0, null),
  ];
  return base.map((d) => ({ ...d, ...overrides[d.day] }));
}

function byDay(budget: ReturnType<typeof computeWeekBudget>, id: string) {
  const found = budget.days.find((d) => d.day === id);
  if (!found) throw new Error(`no ${id}`);
  return found;
}

describe('computeWeekBudget: the design’s worked example', () => {
  const budget = computeWeekBudget({ days: sampleWeek(), today: FRI, dailyMinimumKcal: MIN, makanDay: SAT });

  it('matches every number on Today and the budget breakdown', () => {
    expect(budget.savedKcal).toBe(650);
    expect(budget.leftTodayKcal).toBe(570);
    expect(budget.leftThisWeekKcal).toBe(4820);
    expect(budget.weeklyBudgetKcal).toBe(12600);
    expect(budget.eatenSoFarKcal).toBe(7780);
    expect(budget.makanRoomKcal).toBe(2450);
    expect(budget.makanDay).toBe(SAT);
  });

  it('has no overspend, pending savings or unabsorbed shortfall', () => {
    expect(budget.todayBaseKcal).toBe(1800);
    expect(budget.overTodayKcal).toBe(0);
    expect(budget.coveredBySavings).toBe(false);
    expect(budget.pendingSavedKcal).toBe(0);
    expect(budget.unabsorbedKcal).toBe(0);
    expect(budget.workoutsKcal).toBe(0);
    expect(budget.bonusKcal).toBe(0);
  });

  it('describes each day', () => {
    expect(budget.weekStart).toBe(MON);
    expect(budget.today).toBe(FRI);
    expect(budget.days.map((d) => d.kind)).toEqual(['logged', 'logged', 'logged', 'logged', 'today', 'makan', 'planned']);
    expect(budget.days.map((d) => d.savedKcal)).toEqual([180, 90, 260, 120, 0, 0, 0]);
    expect(budget.days.map((d) => d.countedKcal)).toEqual([1620, 1710, 1540, 1680, 0, 0, 0]);
    expect(budget.days.map((d) => d.plannedKcal)).toEqual([0, 0, 0, 0, 1800, 2450, 1800]);
    expect(byDay(budget, FRI)).toMatchObject({ isToday: true, isFinished: false, baseKcal: 1800, eatenKcal: 1230 });
    expect(byDay(budget, THU)).toMatchObject({ isToday: false, isFinished: true, status: 'complete' });
  });

  it('keeps savings unallocated when no makan day is planned', () => {
    const plain = computeWeekBudget({ days: sampleWeek(), today: FRI, dailyMinimumKcal: MIN });
    expect(byDay(plain, SAT)).toMatchObject({ kind: 'planned', plannedKcal: 1800 });
    expect(plain.makanDay).toBeUndefined();
    expect(plain.makanRoomKcal).toBeUndefined();
    expect(plain.leftThisWeekKcal).toBe(4820);
  });

  it('accepts days in any order', () => {
    const shuffled = computeWeekBudget({
      days: [...sampleWeek()].reverse(),
      today: FRI,
      dailyMinimumKcal: MIN,
      makanDay: SAT,
    });
    expect(shuffled).toEqual(budget);
  });
});

describe('computeWeekBudget: over today', () => {
  const budget = computeWeekBudget({ days: sampleWeek(2110), today: FRI, dailyMinimumKcal: MIN, makanDay: SAT });

  it('shows the overspend as covered by savings', () => {
    expect(budget.leftTodayKcal).toBe(-310);
    expect(budget.overTodayKcal).toBe(310);
    expect(budget.coveredBySavings).toBe(true);
    expect(budget.makanRoomKcal).toBe(2140);
    expect(budget.leftThisWeekKcal).toBe(3940);
    expect(budget.eatenSoFarKcal).toBe(8660);
  });

  it('is not covered when savings are smaller than the overspend', () => {
    const big = computeWeekBudget({ days: sampleWeek(2600), today: FRI, dailyMinimumKcal: MIN, makanDay: SAT });
    expect(big.overTodayKcal).toBe(800);
    expect(big.coveredBySavings).toBe(false);
    // net = 650 − 800 = −150, spread over Sat and Sun
    expect(byDay(big, SAT).plannedKcal).toBe(1725);
    expect(byDay(big, SUN).plannedKcal).toBe(1725);
    expect(big.makanRoomKcal).toBe(1725);
  });
});

describe('computeWeekBudget: day statuses', () => {
  it('holds back savings on an unconfirmed day under budget', () => {
    for (const status of [null, 'unconfirmed'] as const) {
      const budget = computeWeekBudget({
        days: sampleWeek(1230, { [THU]: { eatenKcal: 1240, status } }),
        today: FRI,
        dailyMinimumKcal: MIN,
        makanDay: SAT,
      });
      const thu = byDay(budget, THU);
      expect(thu).toMatchObject({ countedKcal: 1800, savedKcal: 0, kind: 'logged' });
      expect(budget.pendingSavedKcal).toBe(560);
      expect(budget.savedKcal).toBe(530);
      expect(budget.makanRoomKcal).toBe(2330);
      // The held-back 560 isn't spendable yet.
      expect(budget.leftThisWeekKcal).toBe(12600 - (1620 + 1710 + 1540 + 1800) - 1230);
    }
  });

  it('counts overspend on an unconfirmed day straight away', () => {
    const budget = computeWeekBudget({
      days: sampleWeek(1230, { [THU]: { eatenKcal: 2000, status: null } }),
      today: FRI,
      dailyMinimumKcal: MIN,
    });
    expect(byDay(budget, THU)).toMatchObject({ countedKcal: 2000, savedKcal: -200, kind: 'over' });
    expect(budget.pendingSavedKcal).toBe(0);
    expect(budget.savedKcal).toBe(330);
  });

  it('counts a guess day as logged', () => {
    const budget = computeWeekBudget({
      days: sampleWeek(1230, { [THU]: { eatenKcal: 1890, status: 'guess' } }),
      today: FRI,
      dailyMinimumKcal: MIN,
    });
    expect(byDay(budget, THU)).toMatchObject({ countedKcal: 1890, savedKcal: -90, kind: 'over' });
    expect(budget.savedKcal).toBe(440);
  });

  it('counts a not-counted day as exactly its base', () => {
    for (const eaten of [900, 2600]) {
      const budget = computeWeekBudget({
        days: sampleWeek(1230, { [THU]: { eatenKcal: eaten, status: 'notCounted' } }),
        today: FRI,
        dailyMinimumKcal: MIN,
      });
      expect(byDay(budget, THU)).toMatchObject({ countedKcal: 1800, savedKcal: 0, kind: 'notCounted' });
      expect(budget.savedKcal).toBe(530);
      expect(budget.pendingSavedKcal).toBe(0);
    }
  });

  it('leaves paused days out of the week', () => {
    const budget = computeWeekBudget({
      days: sampleWeek(1230, {
        [MON]: { targetKcal: null, eatenKcal: 2500, workoutKcal: 300 },
        [TUE]: { status: 'paused', eatenKcal: 2400 },
      }),
      today: FRI,
      dailyMinimumKcal: MIN,
    });
    expect(byDay(budget, MON)).toMatchObject({ kind: 'paused', baseKcal: 0, countedKcal: 0, savedKcal: 0, plannedKcal: 0 });
    expect(byDay(budget, TUE)).toMatchObject({ kind: 'paused', baseKcal: 0 });
    expect(budget.weeklyBudgetKcal).toBe(5 * 1800);
    expect(budget.workoutsKcal).toBe(0);
    expect(budget.savedKcal).toBe(260 + 120);
    expect(budget.eatenSoFarKcal).toBe(1540 + 1680 + 1230);
    expect(budget.leftThisWeekKcal).toBe(9000 - (1540 + 1680) - 1230);
  });

  it('shows a paused today and future days as paused, with no budget', () => {
    const budget = computeWeekBudget({
      days: sampleWeek(1230, { [FRI]: { targetKcal: null }, [SUN]: { targetKcal: null } }),
      today: FRI,
      dailyMinimumKcal: MIN,
      makanDay: SUN,
    });
    expect(byDay(budget, FRI)).toMatchObject({ kind: 'paused', isToday: true, plannedKcal: 0 });
    expect(byDay(budget, SUN)).toMatchObject({ kind: 'paused', plannedKcal: 0 });
    expect(budget.todayBaseKcal).toBe(0);
    expect(budget.leftTodayKcal).toBe(0);
    expect(budget.overTodayKcal).toBe(0);
    expect(budget.eatenSoFarKcal).toBe(6550);
    expect(budget.makanRoomKcal).toBeUndefined();
  });
});

describe('computeWeekBudget: workouts and bonuses', () => {
  it('adds workouts and a one-off bonus to the day’s base and the week', () => {
    const budget = computeWeekBudget({
      days: sampleWeek(1230, {
        [TUE]: { workoutKcal: 470 },
        [FRI]: { workoutKcal: 300 },
        [SAT]: { bonusKcal: 500 },
      }),
      today: FRI,
      dailyMinimumKcal: MIN,
      makanDay: SAT,
    });
    expect(byDay(budget, TUE)).toMatchObject({ baseKcal: 2270, savedKcal: 560 });
    expect(budget.weeklyBudgetKcal).toBe(12600 + 470 + 300 + 500);
    expect(budget.workoutsKcal).toBe(770);
    expect(budget.bonusKcal).toBe(500);
    expect(budget.savedKcal).toBe(650 + 470);
    expect(budget.todayBaseKcal).toBe(2100);
    expect(budget.leftTodayKcal).toBe(870);
    expect(budget.makanRoomKcal).toBe(2300 + 1120);
    expect(budget.leftThisWeekKcal).toBe(13870 - 6550 - 1230);
  });
});

describe('computeWeekBudget: shortfall', () => {
  it('spreads a shortfall evenly over the remaining days', () => {
    // Mon–Thu each 75 over: −300 saved; "Sat and Sun allowance: 1,650 each"
    const days = [MON, TUE, WED, THU].map((d) => day(d, 1875, 'complete'));
    const budget = computeWeekBudget({
      days: [...days, day(FRI, 1800, null), day(SAT, 0, null), day(SUN, 0, null)],
      today: FRI,
      dailyMinimumKcal: MIN,
      makanDay: SAT,
    });
    expect(budget.savedKcal).toBe(-300);
    expect(byDay(budget, SAT)).toMatchObject({ kind: 'makan', plannedKcal: 1650 });
    expect(byDay(budget, SUN)).toMatchObject({ kind: 'planned', plannedKcal: 1650 });
    expect(budget.makanRoomKcal).toBe(1650);
    expect(budget.unabsorbedKcal).toBe(0);
  });

  it('includes today’s overspend in the shortfall', () => {
    const days = [MON, TUE, WED, THU].map((d) => day(d, 1800, 'complete'));
    const budget = computeWeekBudget({
      days: [...days, day(FRI, 2400, null), day(SAT, 0, null), day(SUN, 0, null)],
      today: FRI,
      dailyMinimumKcal: MIN,
    });
    expect(budget.overTodayKcal).toBe(600);
    expect(budget.coveredBySavings).toBe(false);
    expect(byDay(budget, SAT).plannedKcal).toBe(1500);
    expect(byDay(budget, SUN).plannedKcal).toBe(1500);
  });

  it('never goes below the daily minimum and reports what is left over', () => {
    const days = [MON, TUE, WED, THU].map((d) => day(d, 2600, 'complete'));
    const budget = computeWeekBudget({
      days: [...days, day(FRI, 1800, null), day(SAT, 0, null), day(SUN, 0, null)],
      today: FRI,
      dailyMinimumKcal: MIN,
    });
    expect(budget.savedKcal).toBe(-3200);
    expect(byDay(budget, SAT).plannedKcal).toBe(1400);
    expect(byDay(budget, SUN).plannedKcal).toBe(1400);
    expect(budget.unabsorbedKcal).toBe(2400);
    expect(budget.leftThisWeekKcal).toBe(400);
  });

  it('takes from the biggest allowance first (water-filling)', () => {
    const days = [MON, TUE, WED, THU].map((d) => day(d, 1875, 'complete'));
    const small = computeWeekBudget({
      days: [...days, day(FRI, 1800, null), day(SAT, 0, null, { workoutKcal: 470 }), day(SUN, 0, null)],
      today: FRI,
      dailyMinimumKcal: MIN,
    });
    expect(byDay(small, SAT).plannedKcal).toBe(1970);
    expect(byDay(small, SUN).plannedKcal).toBe(1800);

    const bigger = computeWeekBudget({
      days: [...[MON, TUE, WED, THU].map((d) => day(d, 1950, 'complete')), day(FRI, 1800, null), day(SAT, 0, null, { workoutKcal: 470 }), day(SUN, 0, null)],
      today: FRI,
      dailyMinimumKcal: MIN,
    });
    expect(byDay(bigger, SAT).plannedKcal).toBe(1735);
    expect(byDay(bigger, SUN).plannedKcal).toBe(1735);
  });

  it('keeps whole kcal that add up exactly', () => {
    const budget = computeWeekBudget({
      days: [day(MON, 2101, 'complete'), day(TUE, 1800, null), day(WED, 0, null), day(THU, 0, null)],
      today: TUE,
      dailyMinimumKcal: MIN,
    });
    const planned = [WED, THU].map((d) => byDay(budget, d).plannedKcal);
    expect(planned.every(Number.isInteger)).toBe(true);
    expect(planned.reduce((a, b) => a + b, 0)).toBe(3600 - 301);
    expect(Math.max(...planned) - Math.min(...planned)).toBeLessThanOrEqual(1);
  });

  it('puts the whole shortfall in unabsorbed on the last day of the week', () => {
    const days = [MON, TUE, WED, THU, FRI, SAT].map((d) => day(d, 1900, 'complete'));
    const budget = computeWeekBudget({ days: [...days, day(SUN, 1800, null)], today: SUN, dailyMinimumKcal: MIN });
    expect(budget.savedKcal).toBe(-600);
    expect(budget.unabsorbedKcal).toBe(600);
  });

  it('skips paused future days when spreading', () => {
    const days = [MON, TUE, WED, THU].map((d) => day(d, 1875, 'complete'));
    const budget = computeWeekBudget({
      days: [...days, day(FRI, 1800, null), day(SAT, 0, null, { targetKcal: null }), day(SUN, 0, null)],
      today: FRI,
      dailyMinimumKcal: MIN,
    });
    expect(byDay(budget, SAT).plannedKcal).toBe(0);
    expect(byDay(budget, SUN).plannedKcal).toBe(1500);
  });
});

describe('computeWeekBudget: bar kinds and week position', () => {
  it('gives every bar kind', () => {
    const budget = computeWeekBudget({
      days: [
        day(MON, 1620, 'complete'),
        day(TUE, 2000, 'complete'),
        day(WED, 700, 'notCounted'),
        day(THU, 0, null, { targetKcal: null }),
        day(FRI, 1230, null),
        day(SAT, 0, null),
        day(SUN, 0, null),
      ],
      today: FRI,
      dailyMinimumKcal: MIN,
      makanDay: SAT,
    });
    expect(budget.days.map((d) => d.kind)).toEqual(['logged', 'over', 'notCounted', 'paused', 'today', 'makan', 'planned']);
  });

  it('treats every day as finished for a past week', () => {
    const lastWeek = weekDays('2026-10-05');
    const days = lastWeek.map((d, i) => day(d, i === 6 ? 0 : 1850, i === 6 ? 'notCounted' : 'complete'));
    const budget = computeWeekBudget({ days, today: FRI, dailyMinimumKcal: MIN });
    expect(budget.weekStart).toBe('2026-10-05');
    expect(budget.days.every((d) => d.isFinished)).toBe(true);
    expect(budget.savedKcal).toBe(-300);
    expect(budget.todayBaseKcal).toBe(0);
    expect(budget.leftTodayKcal).toBe(0);
    expect(budget.unabsorbedKcal).toBe(300);
    expect(budget.leftThisWeekKcal).toBe(12600 - (6 * 1850 + 1800));
  });

  it('plans every day for a future week', () => {
    const next = weekDays('2026-10-19').map((d) => day(d, 0, null));
    const budget = computeWeekBudget({ days: next, today: FRI, dailyMinimumKcal: MIN, makanDay: '2026-10-24' });
    expect(budget.days.every((d) => !d.isFinished && !d.isToday)).toBe(true);
    expect(budget.leftThisWeekKcal).toBe(12600);
    expect(budget.makanRoomKcal).toBe(1800);
  });

  it('gives the makan day’s room on the day itself, and none once it has passed', () => {
    const onSat = computeWeekBudget({
      days: sampleWeek(1800, { [FRI]: { status: 'complete' } }),
      today: SAT,
      dailyMinimumKcal: MIN,
      makanDay: SAT,
    });
    expect(byDay(onSat, SAT).kind).toBe('today');
    expect(onSat.makanRoomKcal).toBe(1800 + 650);

    const passed = computeWeekBudget({
      days: sampleWeek(1800, { [FRI]: { status: 'complete' } }),
      today: SUN,
      dailyMinimumKcal: MIN,
      makanDay: SAT,
    });
    expect(passed.makanDay).toBe(SAT);
    expect(passed.makanRoomKcal).toBeUndefined();
  });

  it('rounds fractional inputs to whole kcal', () => {
    const budget = computeWeekBudget({
      days: [day(MON, 1620.4, 'complete'), day(TUE, 337.5, null)],
      today: TUE,
      dailyMinimumKcal: MIN,
    });
    expect(budget.savedKcal).toBe(180);
    expect(budget.leftTodayKcal).toBe(1800 - 338);
  });

  it('handles an empty week', () => {
    const budget = computeWeekBudget({ days: [], today: FRI, dailyMinimumKcal: MIN });
    expect(budget.weekStart).toBe(MON);
    expect(budget.weeklyBudgetKcal).toBe(0);
    expect(budget.days).toEqual([]);
  });
});

describe('spreadShortfall', () => {
  it('returns the bases when there is nothing to spread', () => {
    expect(spreadShortfall([{ base: 1800, floor: 1400 }], 0)).toEqual({ planned: [1800], unabsorbedKcal: 0 });
  });

  it('leaves days already at or below their floor alone', () => {
    const result = spreadShortfall(
      [
        { base: 1300, floor: 1300 },
        { base: 1800, floor: 1400 },
      ],
      200,
    );
    expect(result).toEqual({ planned: [1300, 1600], unabsorbedKcal: 0 });
  });

  it('reports everything as unabsorbed with no days left', () => {
    expect(spreadShortfall([], 500)).toEqual({ planned: [], unabsorbedKcal: 500 });
  });
});

describe('daysInRange', () => {
  it('counts logged days within maintenance ± range', () => {
    const days = [
      { eatenKcal: 2000, status: 'complete' as const },
      { eatenKcal: 2400, status: 'complete' as const },
      { eatenKcal: 1890, status: 'complete' as const },
      { eatenKcal: 2310, status: 'guess' as const },
      { eatenKcal: 1900, status: 'notCounted' as const },
      { eatenKcal: 2000, status: 'paused' as const },
      { eatenKcal: 2050, status: null },
      { eatenKcal: 1500, status: 'unconfirmed' as const },
    ];
    expect(daysInRange(days, 2100, 0.1)).toBe(4);
  });

  it('is 0 for no days', () => {
    expect(daysInRange([], 2100, 0.1)).toBe(0);
  });
});
