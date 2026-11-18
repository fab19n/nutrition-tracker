import { addDays } from '@/domain/day';
import { fmtDateYear, fmtKg, fmtKgDelta } from '@/domain/format';
import { planProgress, type PlanDay, type PlanInput } from '@/domain/plan';
import type { TrendPoint } from '@/domain/trend';
import { kgText, paceText, planCardModel, planScreenModel, spanText, type PlanModelInput } from './planModel';

const START = '2026-10-05';

function planDay(i: number, over: Partial<PlanDay> = {}): PlanDay {
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

function trendFalling(count: number, perWeek: number, startKg = 80): TrendPoint[] {
  return Array.from({ length: count + 1 }, (_, i) => {
    const kg = startKg - (perWeek * i) / 7;
    return { day: addDays(START, i), kg, trendKg: kg };
  });
}

interface World {
  count?: number;
  perWeek?: number;
  pace?: number;
  day?: Partial<PlanDay> | ((i: number) => Partial<PlanDay>);
  endKg?: number;
  paused?: boolean;
  trend?: TrendPoint[];
}

function model({ count = 28, perWeek = 0.5, pace = 0.5, day = {}, endKg, paused = false, trend }: World = {}): PlanModelInput {
  const input: PlanInput = {
    today: addDays(START, count),
    start: START,
    paceKgPerWeek: pace,
    goal: endKg === undefined ? {} : { endCondition: { weightKg: endKg } },
    days: Array.from({ length: count }, (_, i) => planDay(i, { paceKgPerWeek: pace, ...(typeof day === 'function' ? day(i) : day) })),
    trend: trend ?? trendFalling(count, perWeek),
  };
  return { goal: { name: 'Cut', template: 'cut' }, version: { dailyKcal: 1800 }, start: START, paused, paceKgPerWeek: pace, progress: planProgress(input) };
}

describe('small wording helpers', () => {
  it('reads a pace as the change in weight', () => {
    expect(paceText(0.5)).toBe('−0.5 kg a week');
    expect(paceText(0.25)).toBe('−0.25 kg a week');
    expect(paceText(-0.25)).toBe('+0.25 kg a week');
    expect(paceText(0)).toBe('hold steady');
  });

  it('counts days up to two weeks, then weeks', () => {
    expect([1, 9, 13, 14, 18, 53].map(spanText)).toEqual(['1 day', '9 days', '13 days', '2 weeks', '3 weeks', '8 weeks']);
  });

  it('never prints a lone 0.0 kg', () => {
    expect(kgText(0.3)).toBe('about 0.3 kg');
    expect(kgText(0.04)).toBe('less than 0.1 kg');
  });
});

describe('the screen: weight', () => {
  it('says how far behind or ahead, in the plan\'s direction', () => {
    expect(planScreenModel(model({ perWeek: 0.2 })).weight.headline).toBe('1.2 kg behind plan');
    expect(planScreenModel(model({ perWeek: 0.8 })).weight.headline).toBe('1.2 kg ahead of plan');
    expect(planScreenModel(model({ perWeek: 0.5 })).weight.headline).toBe('On track');
  });

  it('is never amber for being behind: a reading is not a verdict', () => {
    expect(planScreenModel(model({ perWeek: 0.2 })).weight.tone).toBe('neutral');
    expect(planScreenModel(model({ perWeek: 0.8 })).weight.tone).toBe('good');
  });

  it('shows the trend, what the plan expects and the pace', () => {
    const { tiles } = planScreenModel(model({ perWeek: 0.2 })).weight;
    expect(tiles.map((t) => t.label)).toEqual(['Your trend', 'Plan expects', 'Pace a week']);
    expect(tiles[0]).toMatchObject({ value: fmtKgDelta(-0.8), sub: `${fmtKg(79.2)} now` });
    expect(tiles[1]).toMatchObject({ value: fmtKgDelta(-2), sub: 'over 4 weeks' });
    expect(tiles[2]).toMatchObject({ value: '−0.2 kg', sub: 'plan −0.5 kg' });
  });

  it('calls an early stretch early and says how much it has', () => {
    const { headline, note } = planScreenModel(model({ count: 10, perWeek: 0.1 })).weight;
    expect(headline).toBe('Too early to say');
    expect(note).toBe('11 weigh-ins over 10 days so far. A trend needs about two weeks of weigh-ins before it says much.');
  });

  it('asks for weigh-ins when there are none, and shows no tiles or chart', () => {
    const { headline, tiles, chart } = planScreenModel(model({ trend: [] })).weight;
    expect(headline).toBe('No weigh-ins yet');
    expect(tiles).toEqual([]);
    expect(chart).toBeUndefined();
  });

  it('reads a hold by how far the weight has drifted', () => {
    const drift = planScreenModel(model({ pace: 0, perWeek: -0.4 })).weight;
    expect(drift.headline).toBe('Up 1.6 kg');
    expect(planScreenModel(model({ pace: 0, perWeek: 0 })).weight.headline).toBe('Holding steady');
  });

  it('describes the chart for a screen reader', () => {
    const { chart } = planScreenModel(model({ perWeek: 0.2 })).weight;
    expect(chart).toMatchObject({ endLabel: 'today', ariaLabel: 'Weight trend 79.2 kg, 1.2 kg short of the plan.' });
  });

  it('shows the way to an end weight, at the plan\'s pace and at yours', () => {
    const { end } = planScreenModel(model({ perWeek: 0.25, endKg: 75 })).weight;
    expect(end?.title).toBe('Towards 75.0 kg');
    expect(end?.lines).toEqual([
      '4.0 kg to go',
      `At your plan's pace: around ${fmtDateYear(addDays(START, 28 + 56))}`,
      `At your pace now: around ${fmtDateYear(addDays(START, 28 + 112))}`,
    ]);
  });

  it('says plainly when the trend is not moving towards the end weight', () => {
    const { end } = planScreenModel(model({ perWeek: 0, endKg: 75 })).weight;
    expect(end?.lines.at(-1)).toBe("At your pace now: your trend isn't moving that way yet");
  });

  it('says when the end weight is reached', () => {
    expect(planScreenModel(model({ perWeek: 0.5, endKg: 79 })).weight.end?.title).toBe('Reached 79.0 kg');
  });
});

describe('the screen: header', () => {
  it('names the goal, when it began and what it asks for', () => {
    const m = planScreenModel(model());
    expect(m.name).toBe('Cut');
    expect(m.since).toBe(`Since ${fmtDateYear(START)} · 4 weeks in`);
    expect(m.facts).toEqual(['Target 1,800 kcal a day', 'Plan −0.5 kg a week']);
  });

  it('says it starts today on the first day', () => {
    expect(planScreenModel(model({ count: 0 })).since).toBe(`Starts today · ${fmtDateYear(START)}`);
  });

  it('has no target line while paused', () => {
    const m = planScreenModel(model({ paused: true }));
    expect(m.paused).toBe(true);
    expect(m.facts).toEqual([]);
  });
});

describe('the screen: calories against the budget', () => {
  it('shows counted days, days within budget and the result', () => {
    const { energy } = planScreenModel(model({ day: { eatenKcal: 1900 } }));
    expect(energy.tiles).toEqual([
      { label: 'Counted', value: '28 of 28', sub: 'finished days', tone: 'neutral' },
      { label: 'Within budget', value: '0 of 28', sub: 'days', tone: 'neutral' },
      { label: 'Result', value: '2,800', sub: 'over · about 0.4 kg', tone: 'over' },
    ]);
  });

  it('shows an under-budget result in good', () => {
    const { energy } = planScreenModel(model({ day: { eatenKcal: 1700 } }));
    expect(energy.tiles[2]).toMatchObject({ value: '2,800', sub: 'under · about 0.4 kg', tone: 'good' });
  });

  it('lists the weeks newest first, with what workouts added', () => {
    const { energy } = planScreenModel(model({ day: (i) => ({ eatenKcal: 1800, workoutKcal: i === 2 ? 470 : 0 }) }));
    expect(energy.weeks).toHaveLength(4);
    expect(energy.weeks.at(-1)).toMatchObject({ label: '5–11 Oct', sub: '7 days · +470 from workouts', value: '470 under', tone: 'good' });
    expect(energy.weeks[0]).toMatchObject({ label: '26 Oct–1 Nov', sub: '7 days', value: '0 under' });
  });

  it('has an empty note before any day is counted', () => {
    const { energy } = planScreenModel(model({ count: 0 }));
    expect(energy.tiles).toEqual([]);
    expect(energy.empty).toMatch(/No finished days to count yet/);
  });
});

describe('the screen: what workouts changed', () => {
  const withWorkouts = model({ day: (i) => ({ eatenKcal: 1850, workoutKcal: i % 7 === 2 ? 470 : 0 }) });

  it('shows what they added, their share, and the result with and without them', () => {
    const { rows } = planScreenModel(withWorkouts).workouts;
    expect(rows).toEqual([
      { label: 'Added to your budgets', sub: '4 workout days · about 470 a week', value: '+1,880' },
      { label: 'Share of your budgets', sub: 'of all the kcal you were allowed', value: '4%' },
      { label: 'Result, workouts counted', value: '480 under', tone: 'good' },
      { label: 'Same days, no workouts', value: '1,400 over', tone: 'over' },
    ]);
  });

  it('says when no workouts were logged', () => {
    const { rows, empty } = planScreenModel(model()).workouts;
    expect(rows).toEqual([]);
    expect(empty).toMatch(/No workouts logged on the days counted so far/);
  });

  it('always says what a workout kcal figure is', () => {
    expect(planScreenModel(model()).workouts.note).toMatch(/estimated net burn/);
  });
});

describe('the screen: logs against weight', () => {
  it('stays locked below 14 complete days and shows how far along it is', () => {
    const { check } = planScreenModel(model({ count: 10 }));
    expect(check.state).toBe('locked');
    expect(check.body).toMatch(/unlocks after 14 complete days with weigh-ins\. You have 10 so far\./);
    expect(check.progress).toBeCloseTo(10 / 14);
    expect(check.rows).toEqual([]);
  });

  it('agrees when logs and weight tell the same story', () => {
    const { check } = planScreenModel(model({ perWeek: 0.5 }));
    expect(check.state).toBe('ready');
    expect(check.badge).toBeUndefined();
    expect(check.body).toMatch(/^They agree within 150 kcal a day/);
    expect(check.rows.map((r) => r.value)).toEqual(['550 under', '550 under', '0']);
  });

  it('says the logs run ahead of the weight, with the usual reasons', () => {
    const { check } = planScreenModel(model({ perWeek: 0.3 }));
    expect(check.body).toMatch(/^Your logs show a bigger deficit than your weight does/);
    expect(check.body).toMatch(/workout estimates on the high side/);
    // 550 under maintenance in the logs; 0.3 kg a week is 330 a day on the scale.
    expect(check.rows.map((r) => r.value)).toEqual(['550 under', '330 under', '220']);
  });

  it('says the weight runs ahead of the logs the other way round', () => {
    expect(planScreenModel(model({ perWeek: 0.8 })).check.body).toMatch(/^Your weight is falling faster than your logs say/);
  });

  it('marks an early read, and shows the workouts\' share and the half-workouts gap', () => {
    const { check } = planScreenModel(model({ count: 16, perWeek: 0.25, day: { workoutKcal: 100 } }));
    expect(check.state).toBe('early');
    expect(check.badge).toBe('Early read · 16 complete days');
    expect(check.extras[0]).toBe('Workouts supply about 100 kcal a day of the deficit your logs imply.');
    expect(check.extras[1]).toBe('If only half of each workout counted, the gap would be 330 kcal a day more deficit in your logs than on the scale.');
  });

  it('leaves out the workout lines when workouts are a trace', () => {
    const { extras } = planScreenModel(model({ perWeek: 0.25, day: { workoutKcal: 10 } })).check;
    expect(extras.some((line) => line.startsWith('Workouts supply'))).toBe(false);
  });

  it('always says the check never changes a target', () => {
    expect(planScreenModel(model()).check.extras.at(-1)).toMatch(/never changes your target/);
  });
});

describe('the card on Insights', () => {
  it('shows the verdict with the trend and the plan side by side', () => {
    expect(planCardModel(model({ perWeek: 0.2 }))).toEqual({
      label: 'Your plan',
      title: '1.2 kg behind plan',
      sub: `Trend ${fmtKgDelta(-0.8)} · plan ${fmtKgDelta(-2)}`,
    });
  });

  it('invites a first weigh-in when there is no trend', () => {
    expect(planCardModel(model({ trend: [] }))).toMatchObject({ title: 'See where you stand', sub: 'Weigh in to draw your trend against the plan' });
  });

  it('says paused when the goal is paused', () => {
    expect(planCardModel(model({ paused: true }))).toMatchObject({ title: 'Paused' });
  });
});
