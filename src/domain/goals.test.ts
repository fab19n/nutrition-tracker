import { GOAL_PRESETS } from '@/db/seed/defaults';
import {
  GoalDraftError,
  activeGoalIdAfter,
  comparePeriods,
  endConditionState,
  endKey,
  everInForce,
  goalDraftFor,
  goalWeek,
  inUseAfter,
  periodOn,
  planCancelSwitch,
  planGoalSwitch,
  sameEndCondition,
  uniqueGoalName,
  validateGoalDraft,
  type GoalDraft,
} from './goals';
import type { GoalPeriod } from './types';

const TODAY = '2026-10-16';
const T = '2026-10-17';
const CREATED = '2026-10-16T11:10:00.000Z';

function ids(...list: string[]): () => string {
  const queue = [...list];
  return () => queue.shift() ?? 'extra';
}

const cut: GoalPeriod = { id: 'p-cut', goalId: 'cut', from: '2026-09-28' };

describe('planGoalSwitch', () => {
  it('caps the period in force at tomorrow and starts the new goal then (the demo switch)', () => {
    const plan = planGoalSwitch({ periods: [cut], today: TODAY, goalId: 'festive', newId: ids('n1'), createdAt: CREATED });
    expect(plan).toEqual({
      startsOn: T,
      remove: [],
      put: [
        { ...cut, to: T },
        { id: 'n1', goalId: 'festive', from: T, createdAt: CREATED },
      ],
      added: ['n1'],
    });
  });

  it('replaces a booking: the booked period goes and the capped one stays as it is', () => {
    const periods: GoalPeriod[] = [{ ...cut, to: T }, { id: 'p-fest', goalId: 'festive', from: T, createdAt: CREATED }];
    const plan = planGoalSwitch({ periods, today: TODAY, goalId: 'leanBulk', newId: ids('n1'), createdAt: CREATED });
    expect(plan.remove).toEqual(['p-fest']);
    expect(plan.put).toEqual([{ id: 'n1', goalId: 'leanBulk', from: T, createdAt: CREATED }]);
    expect(plan.added).toEqual(['n1']);
  });

  it('books a dated pause with the goal of today starting again on its last day', () => {
    const plan = planGoalSwitch({
      periods: [cut],
      today: TODAY,
      goalId: 'pause',
      until: '2026-10-19',
      resumeGoalId: 'cut',
      newId: ids('n1', 'n2'),
      createdAt: CREATED,
    });
    expect(plan.put).toEqual([
      { ...cut, to: T },
      { id: 'n1', goalId: 'pause', from: T, to: '2026-10-19', createdAt: CREATED },
      { id: 'n2', goalId: 'cut', from: '2026-10-19', createdAt: CREATED },
    ]);
    expect(plan.added).toEqual(['n1', 'n2']);
  });

  it('refuses an end date that is not 1 to 60 days after the start, or has no goal to resume', () => {
    const base = { periods: [cut], today: TODAY, goalId: 'pause', newId: ids('n1', 'n2'), createdAt: CREATED };
    expect(() => planGoalSwitch({ ...base, until: T, resumeGoalId: 'cut' })).toThrow(RangeError);
    expect(() => planGoalSwitch({ ...base, until: '2026-10-16', resumeGoalId: 'cut' })).toThrow(RangeError);
    expect(() => planGoalSwitch({ ...base, until: '2026-12-17', resumeGoalId: 'cut' })).toThrow(RangeError);
    expect(() => planGoalSwitch({ ...base, until: '2026-12-16', resumeGoalId: 'cut' })).not.toThrow();
    expect(() => planGoalSwitch({ ...base, until: '2026-10-19' })).toThrow(RangeError);
  });

  it('during a dated pause, drops the resume and starts the new goal after the pause', () => {
    const pause: GoalPeriod = { id: 'p-pause', goalId: 'pause', from: T, to: '2026-10-19', createdAt: CREATED };
    const resume: GoalPeriod = { id: 'p-resume', goalId: 'cut', from: '2026-10-19', createdAt: CREATED };
    const plan = planGoalSwitch({ periods: [{ ...cut, to: T }, pause, resume], today: '2026-10-18', goalId: 'festive', newId: ids('n1'), createdAt: CREATED });
    expect(plan.startsOn).toBe('2026-10-19');
    expect(plan.remove).toEqual(['p-resume']);
    expect(plan.put).toEqual([{ id: 'n1', goalId: 'festive', from: '2026-10-19', createdAt: CREATED }]);
  });

  it('caps a pause that runs past tomorrow', () => {
    const pause: GoalPeriod = { id: 'p-pause', goalId: 'pause', from: T, to: '2026-10-25' };
    const plan = planGoalSwitch({ periods: [{ ...cut, to: T }, pause], today: '2026-10-18', goalId: 'festive', newId: ids('n1'), createdAt: CREATED });
    expect(plan.put[0]).toEqual({ ...pause, to: '2026-10-19' });
    expect(plan.remove).toEqual([]);
  });

  it('never changes its inputs', () => {
    const row = Object.freeze({ ...cut });
    const periods = Object.freeze([row]);
    const plan = planGoalSwitch({ periods, today: TODAY, goalId: 'festive', newId: ids('n1'), createdAt: CREATED });
    expect(row).toEqual(cut);
    expect(plan.put[0]).not.toBe(row);
    expect(() => planCancelSwitch(Object.freeze([Object.freeze({ ...cut, to: T })]), TODAY)).not.toThrow();
  });
});

describe('planCancelSwitch', () => {
  it('removes the booking and lets today’s period run on, without an end', () => {
    const plan = planCancelSwitch([{ ...cut, to: T }, { id: 'p-fest', goalId: 'festive', from: T }], TODAY);
    expect(plan?.remove).toEqual(['p-fest']);
    expect(plan?.put).toEqual([cut]);
    expect('to' in (plan?.put[0] ?? {})).toBe(false);
    expect(plan?.added).toEqual([]);
  });

  it('is undefined when nothing is booked', () => {
    expect(planCancelSwitch([cut], TODAY)).toBeUndefined();
  });

  it('keeps a dated pause going, open-ended, without its resume', () => {
    const pause: GoalPeriod = { id: 'p-pause', goalId: 'pause', from: T, to: '2026-10-19' };
    const resume: GoalPeriod = { id: 'p-resume', goalId: 'cut', from: '2026-10-19' };
    const plan = planCancelSwitch([{ ...cut, to: T }, pause, resume], '2026-10-18');
    expect(plan?.remove).toEqual(['p-resume']);
    expect(plan?.put).toEqual([{ id: 'p-pause', goalId: 'pause', from: T }]);
  });
});

describe('which period applies', () => {
  const festive: GoalPeriod = { id: 'b', goalId: 'festive', from: T, createdAt: '2026-10-16T10:00:00.000Z' };
  const leanBulk: GoalPeriod = { id: 'a', goalId: 'leanBulk', from: T, createdAt: '2026-10-16T10:01:00.000Z' };

  it('picks the later booking of two from the same day, whatever the order they come in', () => {
    expect(periodOn([festive, leanBulk], T)?.goalId).toBe('leanBulk');
    expect(periodOn([leanBulk, festive], T)?.goalId).toBe('leanBulk');
    expect(periodOn([{ ...festive, createdAt: '2026-10-16T10:02:00.000Z' }, leanBulk], T)?.goalId).toBe('festive');
  });

  it('sorts a row without createdAt first, and falls back to the id', () => {
    const old: GoalPeriod = { id: 'z', goalId: 'cut', from: T };
    expect(comparePeriods(old, festive)).toBeLessThan(0);
    expect(periodOn([festive, old], T)?.goalId).toBe('festive');
    expect(periodOn([{ ...old, id: 'a' }, { ...old, id: 'b', goalId: 'other' }], T)?.goalId).toBe('other');
    expect(comparePeriods(cut, festive)).toBeLessThan(0);
  });

  it('has an exclusive end', () => {
    expect(periodOn([{ ...cut, to: T }], TODAY)?.id).toBe('p-cut');
    expect(periodOn([{ ...cut, to: T }], T)).toBeUndefined();
    expect(periodOn([cut], '2026-09-27')).toBeUndefined();
  });

  it('knows the goal that stays once bookings start, and which goals were used or are in use', () => {
    expect(activeGoalIdAfter([{ ...cut, to: T }, festive])).toBe('festive');
    expect(activeGoalIdAfter([{ ...cut, to: T }, festive, leanBulk])).toBe('leanBulk');
    expect(activeGoalIdAfter([{ ...cut, to: T }])).toBeUndefined();
    expect(activeGoalIdAfter([])).toBeUndefined();

    const periods = [{ ...cut, to: T }, festive, { id: 'old', goalId: 'old', from: '2026-09-01', to: '2026-09-28' }];
    expect(everInForce(periods, 'cut', TODAY)).toBe(true);
    expect(everInForce(periods, 'old', TODAY)).toBe(true);
    expect(everInForce(periods, 'festive', TODAY)).toBe(false);
    expect(everInForce(periods, 'festive', T)).toBe(true);
    expect(inUseAfter(periods, 'cut', TODAY)).toBe(true);
    expect(inUseAfter(periods, 'festive', TODAY)).toBe(true);
    expect(inUseAfter(periods, 'old', TODAY)).toBe(false);
    expect(inUseAfter(periods, 'cut', T)).toBe(false);
  });

  it('counts the goal’s week from its period', () => {
    expect(goalWeek(cut, TODAY)).toBe(3);
    expect(goalWeek({ from: TODAY }, TODAY)).toBe(1);
    expect(goalWeek({ from: T }, TODAY)).toBe(1);
    expect(goalWeek({ from: '2026-10-09' }, TODAY)).toBe(2);
  });
});

describe('endConditionState', () => {
  const at = { today: TODAY, paceKgPerWeek: 0.5 };

  it('is none without an end', () => {
    expect(endConditionState(undefined, at)).toEqual({ kind: 'none' });
    expect(endConditionState({}, at)).toEqual({ kind: 'none' });
  });

  it('reaches a date on that day', () => {
    expect(endConditionState({ date: '2026-10-31' }, at)).toEqual({ kind: 'date', date: '2026-10-31', reached: false, daysLeft: 15 });
    expect(endConditionState({ date: '2026-10-31' }, { ...at, today: '2026-10-31' })).toMatchObject({ reached: true, daysLeft: 0 });
    expect(endConditionState({ date: '2026-10-31' }, { ...at, today: '2026-11-02' })).toMatchObject({ reached: true, daysLeft: 0 });
  });

  it('reaches a weight by the trend, in the pace’s direction', () => {
    expect(endConditionState({ weightKg: 75 }, { ...at, trendKg: 78 })).toEqual({ kind: 'weight', weightKg: 75, reached: false, trendKg: 78 });
    expect(endConditionState({ weightKg: 75 }, { ...at, trendKg: 74.9 })).toMatchObject({ reached: true });
    expect(endConditionState({ weightKg: 75 }, at)).toEqual({ kind: 'weight', weightKg: 75, reached: false });
    expect(endConditionState({ weightKg: 80 }, { today: TODAY, paceKgPerWeek: -0.25, trendKg: 80.1 })).toMatchObject({ reached: true });
    expect(endConditionState({ weightKg: 80 }, { today: TODAY, paceKgPerWeek: -0.25, trendKg: 79.9 })).toMatchObject({ reached: false });
    expect(endConditionState({ weightKg: 80 }, { today: TODAY, paceKgPerWeek: 0, trendKg: 80 })).toMatchObject({ reached: false });
  });

  it('keys each end once per goal', () => {
    expect(endKey('goal-cut', endConditionState({ date: '2026-10-16' }, at))).toBe('goal-cut:date:2026-10-16');
    expect(endKey('goal-cut', endConditionState({ weightKg: 75 }, at))).toBe('goal-cut:weight:75');
    expect(endKey('goal-cut', { kind: 'none' })).toBeUndefined();
  });
});

describe('goalDraftFor', () => {
  const ctx = { name: 'x', maintenanceKcal: 2350, weightKg: 77.99, dailyMinimumKcal: 1400 };

  it('works out each template’s targets', () => {
    expect(goalDraftFor('cut', ctx)).toEqual({
      name: 'x',
      template: 'cut',
      heroMetric: 'kcalLeft',
      paceKgPerWeek: 0.5,
      dailyKcal: 1800,
      proteinG: 110,
      timing: { maxWindowHours: 12, minHoursBeforeSleep: 2, maxEatingOccasions: 5 },
      insightsOff: [],
    });
    expect(goalDraftFor('festive', ctx)).toMatchObject({
      dailyKcal: 2350,
      proteinG: 110,
      paceKgPerWeek: 0,
      rangePct: 0.1,
      heroMetric: 'daysInRange',
      timing: { maxWindowHours: 14, maxEatingOccasions: 6 },
    });
    expect(goalDraftFor('leanBulk', ctx)).toMatchObject({ dailyKcal: 2550, proteinG: 130, paceKgPerWeek: -0.25, surplusKcal: 200 });
    const pause = goalDraftFor('pause', ctx);
    expect(pause).not.toHaveProperty('dailyKcal');
    expect(pause).not.toHaveProperty('proteinG');
    expect(pause.timing).toEqual({});
    expect(goalDraftFor('custom', ctx)).toMatchObject({ template: 'custom', dailyKcal: 1800, heroMetric: 'kcalLeft' });
    expect(goalDraftFor('cut', { ...ctx, maintenanceKcal: 1700 }).dailyKcal).toBe(1400);
    expect(goalDraftFor('cut', ctx).endCondition).toBeUndefined();
  });

  it('copies the timing, so the presets never change', () => {
    const draft = goalDraftFor('cut', ctx);
    draft.timing.maxWindowHours = 9;
    expect(GOAL_PRESETS.cut.timing.maxWindowHours).toBe(12);
  });
});

describe('validateGoalDraft', () => {
  const ctx = { today: TODAY, dailyMinimumKcal: 1400, kcalChanged: true, endChanged: true };
  const draft = (patch: Partial<GoalDraft> = {}): GoalDraft => ({
    ...goalDraftFor('cut', { name: 'Cut 2', maintenanceKcal: 2350, weightKg: 78, dailyMinimumKcal: 1400 }),
    ...patch,
  });

  it('passes a template’s draft', () => {
    expect(validateGoalDraft(draft(), ctx)).toEqual({});
  });

  it('says what to fix, field by field', () => {
    expect(validateGoalDraft(draft({ name: '  ' }), ctx)).toEqual({ name: 'Give it a name' });
    expect(validateGoalDraft(draft({ name: 'x'.repeat(41) }), ctx)).toEqual({ name: 'Up to 40 characters' });
    expect(validateGoalDraft(draft({ name: ` ${'x'.repeat(40)} ` }), ctx)).toEqual({});
    expect(validateGoalDraft(draft({ dailyKcal: 1350 }), ctx)).toEqual({ dailyKcal: 'At least your 1,400 daily minimum' });
    expect(validateGoalDraft(draft({ dailyKcal: 5050 }), ctx)).toEqual({ dailyKcal: 'Up to 5,000 kcal' });
    expect(validateGoalDraft(draft({ proteinG: 35 }), ctx)).toEqual({ proteinG: 'Between 40 and 250g' });
    expect(validateGoalDraft(draft({ proteinG: 255 }), ctx)).toEqual({ proteinG: 'Between 40 and 250g' });
    expect(validateGoalDraft(draft({ timing: { fixedWindow: { startMin: 600, endMin: 600 } } }), ctx)).toEqual({
      timing: 'Opening and closing times need to differ',
    });
    expect(validateGoalDraft(draft({ endCondition: { date: TODAY } }), ctx)).toEqual({ end: 'Pick a date after today' });
    expect(validateGoalDraft(draft({ endCondition: { date: '2028-10-16' } }), ctx)).toEqual({ end: 'Pick a date within 2 years' });
    expect(validateGoalDraft(draft({ endCondition: { date: '2028-10-15' } }), ctx)).toEqual({});
    expect(validateGoalDraft(draft({ endCondition: { weightKg: Number.NaN } }), ctx)).toEqual({ end: 'Add a weight in kg' });
    expect(validateGoalDraft(draft({ endCondition: { weightKg: 25 } }), ctx)).toEqual({ end: 'Between 30 and 300 kg' });
    expect(validateGoalDraft(draft({ endCondition: { weightKg: 78 } }), { ...ctx, trendKg: 78 })).toEqual({
      end: 'Pick a weight under your 78.0 kg trend',
    });
    expect(validateGoalDraft(draft({ paceKgPerWeek: -0.25, endCondition: { weightKg: 78 } }), { ...ctx, trendKg: 78 })).toEqual({
      end: 'Pick a weight over your 78.0 kg trend',
    });
    // Without a trend the direction can't be checked.
    expect(validateGoalDraft(draft({ endCondition: { weightKg: 79 } }), ctx)).toEqual({});
  });

  it('keeps a stored target under the minimum when the user did not change it', () => {
    expect(validateGoalDraft(draft({ dailyKcal: 1350 }), { ...ctx, kcalChanged: false })).toEqual({});
  });

  it('keeps an end that has passed or been reached while the user did not change it', () => {
    const unchanged = { ...ctx, endChanged: false };
    // The spec's own end date, on the day and after it.
    expect(validateGoalDraft(draft({ endCondition: { date: TODAY } }), unchanged)).toEqual({});
    expect(validateGoalDraft(draft({ endCondition: { date: '2026-10-01' } }), { ...unchanged, today: '2026-10-20' })).toEqual({});
    // A weight end the trend has reached.
    expect(validateGoalDraft(draft({ endCondition: { weightKg: 75 } }), { ...unchanged, trendKg: 74.9 })).toEqual({});
    // Other fields still say what is wrong.
    expect(validateGoalDraft(draft({ name: ' ', endCondition: { date: TODAY } }), unchanged)).toEqual({ name: 'Give it a name' });
    // A changed end gets the full checks.
    expect(validateGoalDraft(draft({ endCondition: { date: TODAY } }), ctx)).toEqual({ end: 'Pick a date after today' });
    expect(validateGoalDraft(draft({ endCondition: { weightKg: 75 } }), { ...ctx, trendKg: 74.9 })).toEqual({
      end: 'Pick a weight under your 74.9 kg trend',
    });
  });

  it('carries the errors on GoalDraftError', () => {
    const error = new GoalDraftError({ name: 'Give it a name' });
    expect(error).toBeInstanceOf(RangeError);
    expect(error.errors).toEqual({ name: 'Give it a name' });
  });
});

describe('sameEndCondition', () => {
  it('compares the date and the weight, with none being none', () => {
    expect(sameEndCondition(undefined, undefined)).toBe(true);
    expect(sameEndCondition({ date: '2026-10-16' }, { date: '2026-10-16' })).toBe(true);
    expect(sameEndCondition({ date: '2026-10-16' }, { date: '2026-10-17' })).toBe(false);
    expect(sameEndCondition({ weightKg: 75 }, { weightKg: 75 })).toBe(true);
    expect(sameEndCondition({ weightKg: 75 }, { weightKg: Number.NaN })).toBe(false);
    expect(sameEndCondition({ weightKg: 75 }, undefined)).toBe(false);
    expect(sameEndCondition(undefined, { date: '2026-10-16' })).toBe(false);
  });
});

describe('uniqueGoalName', () => {
  it('numbers a name that is taken, ignoring case', () => {
    expect(uniqueGoalName('Cut', ['Cut'])).toBe('Cut 2');
    expect(uniqueGoalName('Cut', ['cut', 'Cut 2'])).toBe('Cut 3');
    expect(uniqueGoalName('Pause', [])).toBe('Pause');
  });
});
