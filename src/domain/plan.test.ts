import { describe, expect, it } from 'vitest';
import { addDays } from './day';
import { CHECK_AGREE_KCAL, planProgress, type PlanDay, type PlanInput } from './plan';
import type { TrendPoint } from './trend';

/** A Monday, so budget weeks line up with the 7-day blocks below. */
const START = '2026-10-05';

function plannedDay(i: number, over: Partial<PlanDay> = {}): PlanDay {
  return {
    day: addDays(START, i),
    targetKcal: 1800,
    eatenKcal: 1800,
    workoutKcal: 0,
    bonusKcal: 0,
    status: 'complete',
    paceKgPerWeek: 0.5,
    maintenanceKcal: 2350,
    ...over,
  };
}

function daysFor(count: number, over: Partial<PlanDay> | ((i: number) => Partial<PlanDay>) = {}): PlanDay[] {
  return Array.from({ length: count }, (_, i) => plannedDay(i, typeof over === 'function' ? over(i) : over));
}

/** One trend point a day from the start, falling `perWeek` kg a week from `startKg`. */
function trendFalling(count: number, perWeek: number, startKg = 80): TrendPoint[] {
  return Array.from({ length: count + 1 }, (_, i) => {
    const kg = startKg - (perWeek * i) / 7;
    return { day: addDays(START, i), kg, trendKg: kg };
  });
}

function input(over: Partial<PlanInput> & { count?: number; perWeek?: number } = {}): PlanInput {
  const { count = 28, perWeek = 0.5, ...rest } = over;
  return {
    today: addDays(START, count),
    start: START,
    paceKgPerWeek: 0.5,
    goal: {},
    days: daysFor(count),
    trend: trendFalling(count, perWeek),
    ...rest,
  };
}

describe('weight against the plan', () => {
  it('is on track when the trend falls as fast as the plan', () => {
    const { weight } = planProgress(input({ perWeek: 0.5 }));
    expect(weight.verdict).toBe('onTrack');
    expect(weight.startKg).toBeCloseTo(80);
    expect(weight.changeKg).toBeCloseTo(-2);
    expect(weight.expectedChangeKg).toBeCloseTo(-2);
    expect(weight.behindKg).toBeCloseTo(0);
    expect(weight.actualPaceKgPerWeek).toBeCloseTo(0.5);
  });

  it('is behind when the trend falls slower, by how far it sits above the plan line', () => {
    const { weight } = planProgress(input({ perWeek: 0.2 }));
    expect(weight.verdict).toBe('behind');
    expect(weight.changeKg).toBeCloseTo(-0.8);
    expect(weight.behindKg).toBeCloseTo(1.2);
    expect(weight.actualPaceKgPerWeek).toBeCloseTo(0.2);
  });

  it('is ahead when the trend falls faster', () => {
    const { weight } = planProgress(input({ perWeek: 0.8 }));
    expect(weight.verdict).toBe('ahead');
    expect(weight.behindKg).toBeCloseTo(-1.2);
  });

  it('leaves a small gap inside the wobble the trend has on its own', () => {
    // 0.45 against 0.5 a week is 0.2 kg off after four weeks, inside the 0.3 kg the trend wobbles by itself.
    expect(planProgress(input({ perWeek: 0.45 })).weight.verdict).toBe('onTrack');
    expect(planProgress(input({ perWeek: 0.4 })).weight.verdict).toBe('behind');
  });

  it('reads an early stretch as early, whatever the numbers say', () => {
    const { weight } = planProgress(input({ count: 10, perWeek: 0.1 }));
    expect(weight.verdict).toBe('early');
    expect(weight.changeKg).toBeDefined();
  });

  it('needs a few weigh-ins before it says more than early', () => {
    const sparse = input({ perWeek: 0.2 });
    sparse.trend = [trendFalling(28, 0.2)[0]!, trendFalling(28, 0.2)[28]!];
    expect(planProgress(sparse).weight.verdict).toBe('early');
  });

  it('has nothing to say without a weigh-in since the start', () => {
    const { weight } = planProgress(input({ trend: [], fallbackStartKg: 80 }));
    expect(weight.verdict).toBe('noData');
    expect(weight.actual).toEqual([]);
  });

  it('starts from the setup weight when no weigh-in sits at the start', () => {
    const later = trendFalling(28, 0.5).slice(5);
    const { weight } = planProgress(input({ trend: later, fallbackStartKg: 81 }));
    // The first trend point since the start stands in for the weight at the start.
    expect(weight.startKg).toBeCloseTo(80 - (0.5 * 5) / 7);
  });

  it('judges a hold by how far the trend drifts either way', () => {
    const hold = input({ paceKgPerWeek: 0, days: daysFor(28, { paceKgPerWeek: 0 }), perWeek: 0 });
    expect(planProgress(hold).weight.verdict).toBe('onTrack');
    const gaining = input({ paceKgPerWeek: 0, days: daysFor(28, { paceKgPerWeek: 0 }), perWeek: -0.4 });
    expect(planProgress(gaining).weight.verdict).toBe('drifting');
  });

  it('judges a gain plan by how far short of the gain the trend is', () => {
    const bulk = input({ paceKgPerWeek: -0.25, days: daysFor(28, { paceKgPerWeek: -0.25 }), perWeek: 0 });
    const { weight } = planProgress(bulk);
    expect(weight.expectedChangeKg).toBeCloseTo(1);
    expect(weight.behindKg).toBeCloseTo(1);
    expect(weight.verdict).toBe('behind');
  });

  it('adds up the plan line day by day when the pace changed on the way', () => {
    const changed = input({ days: daysFor(28, (i) => ({ paceKgPerWeek: i < 14 ? 0.5 : 0.25 })), paceKgPerWeek: 0.25 });
    expect(planProgress(changed).weight.expectedChangeKg).toBeCloseTo(-1.5);
  });

  it('draws the trend and the plan line from the same start', () => {
    const { weight } = planProgress(input({ perWeek: 0.2 }));
    expect(weight.actual[0]).toEqual({ day: START, kg: 80 });
    expect(weight.plan[0]).toEqual({ day: START, kg: 80 });
    expect(weight.plan.at(-1)?.day).toBe(addDays(START, 28));
    expect(weight.plan.at(-1)?.kg).toBeCloseTo(78);
    expect(weight.actual.at(-1)?.kg).toBeCloseTo(79.2);
  });

  describe('towards an end weight', () => {
    it('projects the date at the plan pace and at the pace you are keeping', () => {
      const { weight } = planProgress(input({ perWeek: 0.25, goal: { endCondition: { weightKg: 75 } } }));
      // 80 − 0.25 × 4 = 79 now: 4 kg to go.
      expect(weight.end?.kgToGo).toBeCloseTo(4);
      expect(weight.end?.reached).toBe(false);
      expect(weight.end?.atPlanPace).toBe(addDays(START, 28 + 56)); // 4 kg at 0.5 a week
      expect(weight.end?.atCurrentPace).toBe(addDays(START, 28 + 112)); // 4 kg at 0.25 a week
    });

    it('gives no date at your pace while the trend is not moving that way', () => {
      const { weight } = planProgress(input({ perWeek: 0, goal: { endCondition: { weightKg: 75 } } }));
      expect(weight.end?.atPlanPace).toBeDefined();
      expect(weight.end?.atCurrentPace).toBeUndefined();
    });

    it('says reached once the trend is at or past the end weight', () => {
      const { weight } = planProgress(input({ perWeek: 0.5, goal: { endCondition: { weightKg: 78.5 } } }));
      expect(weight.end).toMatchObject({ reached: true, kgToGo: 0 });
      expect(weight.end?.atPlanPace).toBeUndefined();
    });

    it('has no end for a hold, which has no direction to finish in', () => {
      const hold = input({ paceKgPerWeek: 0, days: daysFor(28, { paceKgPerWeek: 0 }), perWeek: 0, goal: { endCondition: { weightKg: 75 } } });
      expect(planProgress(hold).weight.end).toBeUndefined();
    });
  });
});

describe('energy against the budget', () => {
  it('adds up how far under or over budget the finished days ended', () => {
    const { energy } = planProgress(input({ days: daysFor(28, { eatenKcal: 1900 }) }));
    expect(energy.countedDays).toBe(28);
    expect(energy.budgetKcal).toBe(28 * 1800);
    expect(energy.eatenKcal).toBe(28 * 1900);
    expect(energy.underKcal).toBe(-2800);
    expect(energy.underKg).toBeCloseTo(-2800 / 7700);
    expect(energy.withinBudgetDays).toBe(0);
  });

  it('counts a day as within budget when it ends exactly on it', () => {
    const { energy } = planProgress(input({ days: daysFor(3, (i) => ({ eatenKcal: [1799, 1800, 1801][i]! })), count: 3 }));
    expect(energy.withinBudgetDays).toBe(2);
  });

  it('leaves out days that are paused, unconfirmed or not counted', () => {
    const days = [
      plannedDay(0, { eatenKcal: 1500 }),
      plannedDay(1, { status: 'unconfirmed', eatenKcal: 500 }),
      plannedDay(2, { status: 'notCounted', eatenKcal: 500 }),
      plannedDay(3, { status: 'paused', targetKcal: null, eatenKcal: 900 }),
      plannedDay(4, { status: null }),
      plannedDay(5, { status: 'guess', eatenKcal: 1700 }),
    ];
    const { energy } = planProgress(input({ days, count: 6 }));
    expect(energy.countedDays).toBe(2);
    expect(energy.underKcal).toBe(300 + 100);
  });

  it('groups the days into budget weeks, newest first, and keeps the last eight', () => {
    const { energy } = planProgress(input({ count: 70, days: daysFor(70, (i) => ({ eatenKcal: 1800 + (i < 7 ? 100 : 0) })) }));
    expect(energy.weeks).toHaveLength(8);
    expect(energy.weeks[0]?.weekStart).toBe(addDays(START, 63));
    // Ten weeks have finished; the table keeps the newest eight.
    expect(energy.weeks.at(-1)?.weekStart).toBe(addDays(START, 14));
    expect(energy.weeks.every((w) => w.countedDays === 7)).toBe(true);
  });

  it('puts a part week of counted days in its own row', () => {
    const { energy } = planProgress(input({ count: 10 }));
    expect(energy.weeks.map((w) => w.countedDays)).toEqual([3, 7]);
  });
});

describe('what workouts changed', () => {
  const withWorkouts = (i: number): Partial<PlanDay> => ({ eatenKcal: 1850, workoutKcal: i % 7 === 2 ? 470 : 0 });

  it('shows the workouts as budget added, and the same days without them', () => {
    const { workouts, energy } = planProgress(input({ days: daysFor(28, withWorkouts) }));
    expect(workouts.addedKcal).toBe(4 * 470);
    expect(workouts.days).toBe(4);
    expect(workouts.perWeekKcal).toBeCloseTo(470);
    expect(workouts.shareOfBudget).toBeCloseTo(1880 / (28 * 1800 + 1880));
    // 28 days at 1,850 eaten against 1,800: 50 over each day without workouts, 1,880 of room with them.
    expect(workouts.underWithoutKcal).toBe(-28 * 50);
    expect(workouts.underWithKcal).toBe(-28 * 50 + 1880);
    expect(workouts.underWithKcal).toBe(energy.underKcal);
  });

  it('reads zero with no workouts', () => {
    const { workouts } = planProgress(input());
    expect(workouts).toMatchObject({ addedKcal: 0, days: 0, perWeekKcal: 0, shareOfBudget: 0 });
    expect(workouts.underWithKcal).toBe(workouts.underWithoutKcal);
  });

  it('does not count a one-off bonus as workouts', () => {
    const { workouts, energy } = planProgress(input({ days: daysFor(7, (i) => ({ bonusKcal: i === 0 ? 300 : 0 })), count: 7 }));
    expect(workouts.addedKcal).toBe(0);
    expect(energy.budgetKcal).toBe(7 * 1800 + 300);
  });

  it('reads an empty plan without dividing by zero', () => {
    const { workouts, energy } = planProgress(input({ count: 0, days: [], trend: [] }));
    expect(workouts.perWeekKcal).toBe(0);
    expect(workouts.shareOfBudget).toBe(0);
    expect(energy.countedDays).toBe(0);
  });
});

describe('logs against weight', () => {
  // Maintenance 2,350, eating 1,800: the logs say 550 a day. A trend of −0.5 kg a week says 550 too.
  it('agrees when the logs and the weight tell the same story', () => {
    const { check } = planProgress(input({ perWeek: 0.5 }));
    expect(check.state).toBe('ready');
    expect(check.loggedDeficitKcal).toBeCloseTo(550);
    expect(check.weightDeficitKcal).toBeCloseTo(550);
    expect(Math.abs(check.gapKcal ?? 999)).toBeLessThan(CHECK_AGREE_KCAL);
    expect(check.read).toBe('agree');
  });

  it('says the logs run ahead of the weight when the scale moves less than the logs claim', () => {
    const { check } = planProgress(input({ perWeek: 0.25 }));
    expect(check.weightDeficitKcal).toBeCloseTo(275);
    expect(check.gapKcal).toBeCloseTo(275);
    expect(check.read).toBe('logsAhead');
  });

  it('says the weight runs ahead of the logs when the scale moves more than the logs claim', () => {
    const { check } = planProgress(input({ perWeek: 0.8 }));
    expect(check.gapKcal).toBeLessThan(-CHECK_AGREE_KCAL);
    expect(check.read).toBe('weightAhead');
  });

  it('shows how much of the logged deficit the workouts supplied, and the gap with half of them', () => {
    const { check } = planProgress(input({ perWeek: 0.25, days: daysFor(28, { workoutKcal: 100 }) }));
    // 550 + 100 logged against 275 from the weight.
    expect(check.loggedDeficitKcal).toBeCloseTo(650);
    expect(check.workoutKcalPerDay).toBeCloseTo(100);
    expect(check.gapKcal).toBeCloseTo(375);
    expect(check.gapHalfWorkoutsKcal).toBeCloseTo(325);
  });

  it('is an early read from 14 complete days and ready from 21', () => {
    expect(planProgress(input({ count: 14 })).check.state).toBe('early');
    expect(planProgress(input({ count: 20 })).check.state).toBe('early');
    expect(planProgress(input({ count: 21 })).check.state).toBe('ready');
  });

  it('stays locked below 14 complete days, saying how many there are', () => {
    const { check } = planProgress(input({ count: 13 }));
    expect(check).toMatchObject({ state: 'locked', completeDays: 13, needDays: 14 });
    expect(check.gapKcal).toBeUndefined();
  });

  it('counts only complete days, like the target check', () => {
    const days = daysFor(28, (i) => ({ status: i % 2 === 0 ? 'complete' : 'guess' }));
    expect(planProgress(input({ days })).check).toMatchObject({ state: 'early', completeDays: 14 });
  });

  it('stays locked without a weight trend to compare with', () => {
    expect(planProgress(input({ trend: [] })).check.state).toBe('locked');
  });

  it('reads only the last 28 days', () => {
    const days = daysFor(60, (i) => ({ eatenKcal: i < 30 ? 1000 : 1800 }));
    const { check } = planProgress(input({ count: 60, days, perWeek: 0.5 }));
    expect(check.windowDays).toBe(28);
    expect(check.loggedDeficitKcal).toBeCloseTo(550);
  });
});
