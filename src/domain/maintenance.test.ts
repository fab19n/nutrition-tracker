import { buildDemoWorld, DEMO_EXPECTED } from '@/db/seed/demo';
import { buildMaintenanceWorld, MAINTENANCE_WORLD, targetCheckInput, type MaintenanceWorldOptions } from '@/test/maintenanceWorld';
import { addDays } from './day';
import { adaptiveMaintenance, checkTarget, maintenanceWorking, targetSuggestion, type TargetCheck } from './maintenance';
import type { DayStatusKind } from './types';

const END = '2026-10-15';

interface DayRow {
  day: string;
  eatenKcal: number;
  workoutKcal: number;
  status: DayStatusKind | null;
}

/** `count` days ending on `end`, newest last. */
function days(count: number, row: Partial<DayRow> = {}, end = END): DayRow[] {
  return Array.from({ length: count }, (_, i) => ({
    day: addDays(end, i - count + 1),
    eatenKcal: 1820,
    workoutKcal: 0,
    status: 'complete' as const,
    ...row,
  }));
}

/** A straight trend line losing `kgPerWeek` (negative = gaining), one point per day. */
function trend(kgPerWeek: number, count = 28, end = END): { day: string; trendKg: number }[] {
  return Array.from({ length: count }, (_, i) => ({
    day: addDays(end, i - count + 1),
    trendKg: 80 - (kgPerWeek / 7) * i,
  }));
}

describe('adaptiveMaintenance', () => {
  it('logged ~1,820 a day and the trend dropped 0.25 kg a week → about 2,100', () => {
    const result = adaptiveMaintenance({ days: days(28), trend: trend(0.25) });
    expect(result).not.toBeNull();
    expect(Math.abs((result?.maintenanceKcal ?? 0) - 2100)).toBeLessThanOrEqual(10);
    expect((result?.maintenanceKcal ?? 1) % 10).toBe(0);
    expect(result?.avgEatenKcal).toBe(1820);
    expect(result?.avgWorkoutKcal).toBe(0);
    expect(result?.trendKgPerWeek).toBeCloseTo(-0.25, 6);
    expect(result?.daysUsed).toBe(28);
  });

  it('works from exactly 21 complete days', () => {
    const result = adaptiveMaintenance({ days: days(21), trend: trend(0.25, 21) });
    expect(Math.abs((result?.maintenanceKcal ?? 0) - 2100)).toBeLessThanOrEqual(10);
    expect(result?.daysUsed).toBe(21);
  });

  it('subtracts workout calories so they are not counted twice', () => {
    const result = adaptiveMaintenance({ days: days(28, { workoutKcal: 200 }), trend: trend(0.25) });
    expect(result?.avgWorkoutKcal).toBe(200);
    expect(Math.abs((result?.maintenanceKcal ?? 0) - 1895)).toBeLessThanOrEqual(10);
  });

  it('uses complete days only', () => {
    const complete = days(21, {}, '2026-10-08');
    const others = [
      ...days(3, { eatenKcal: 3000, status: 'guess' }, '2026-10-11'),
      ...days(2, { eatenKcal: 900, status: 'unconfirmed' }, '2026-10-13'),
      { day: '2026-10-14', eatenKcal: 400, workoutKcal: 0, status: 'notCounted' as const },
      { day: '2026-10-15', eatenKcal: 2500, workoutKcal: 0, status: null },
    ];
    const result = adaptiveMaintenance({ days: [...complete, ...others], trend: trend(0.25) });
    expect(result?.daysUsed).toBe(21);
    expect(result?.avgEatenKcal).toBe(1820);
    expect(Math.abs((result?.maintenanceKcal ?? 0) - 2100)).toBeLessThanOrEqual(10);
  });

  it('is null with fewer than 21 complete days', () => {
    const mixed = [...days(20), ...days(8, { status: 'notCounted' }, '2026-10-23')];
    expect(adaptiveMaintenance({ days: days(20), trend: trend(0.25) })).toBeNull();
    expect(adaptiveMaintenance({ days: mixed, trend: trend(0.25, 36, '2026-10-23') })).toBeNull();
    expect(adaptiveMaintenance({ days: [], trend: trend(0.25) })).toBeNull();
  });

  it('accepts a lower minimum', () => {
    expect(adaptiveMaintenance({ days: days(14), trend: trend(0.25, 14), minCompleteDays: 14 })).not.toBeNull();
  });

  it('only looks at the last 28 days', () => {
    const old = days(20, { eatenKcal: 2600 }, '2026-09-10');
    const recent = days(21);
    const result = adaptiveMaintenance({ days: [...old, ...recent], trend: trend(0.25, 60) });
    expect(result?.daysUsed).toBe(21);
    expect(result?.avgEatenKcal).toBe(1820);
  });

  it('is null without a usable trend', () => {
    expect(adaptiveMaintenance({ days: days(28), trend: [] })).toBeNull();
    expect(adaptiveMaintenance({ days: days(28), trend: trend(0.25, 3) })).toBeNull();
  });

  it('goes below intake when the trend is rising', () => {
    const result = adaptiveMaintenance({ days: days(28), trend: trend(-0.25) });
    expect(Math.abs((result?.maintenanceKcal ?? 0) - 1545)).toBeLessThanOrEqual(10);
    expect(result?.trendKgPerWeek).toBeCloseTo(0.25, 6);
  });
});

describe('targetSuggestion', () => {
  const cut = { template: 'cut' as const, paceKgPerWeek: 0.5 };
  const current = { maintenanceKcal: 2350, dailyKcal: 1800 };

  it('suggests a new target with a slower-pace alternative (S37)', () => {
    expect(targetSuggestion(current, { maintenanceKcal: 2100 }, cut, 1400)).toEqual({
      suggestedDailyKcal: 1550,
      newMaintenanceKcal: 2100,
      altSlowerPace: { paceKgPerWeek: 0.25, dailyKcal: 1825 },
    });
  });

  it('is null when maintenance moved by 100 kcal or less', () => {
    expect(targetSuggestion(current, { maintenanceKcal: 2260 }, cut, 1400)).toBeNull();
    expect(targetSuggestion(current, { maintenanceKcal: 2250 }, cut, 1400)).toBeNull();
    expect(targetSuggestion(current, { maintenanceKcal: 2450 }, cut, 1400)).toBeNull();
    expect(targetSuggestion(current, { maintenanceKcal: 2249 }, cut, 1400)).not.toBeNull();
  });

  it('offers no slower pace when the target goes up', () => {
    const up = targetSuggestion(current, { maintenanceKcal: 2500 }, cut, 1400);
    expect(up).toEqual({ suggestedDailyKcal: 1950, newMaintenanceKcal: 2500 });
  });

  it('offers no slower pace at the slowest pace or for other goals', () => {
    expect(targetSuggestion(current, { maintenanceKcal: 2100 }, { template: 'cut', paceKgPerWeek: 0.25 }, 1400)?.altSlowerPace).toBeUndefined();
    expect(
      targetSuggestion({ maintenanceKcal: 2350, dailyKcal: 2350 }, { maintenanceKcal: 2100 }, { template: 'festive', paceKgPerWeek: 0 }, 1400),
    ).toEqual({ suggestedDailyKcal: 2100, newMaintenanceKcal: 2100 });
  });

  it('steps down from 0.75 to 0.5', () => {
    const fast = targetSuggestion({ maintenanceKcal: 2350, dailyKcal: 1525 }, { maintenanceKcal: 2200 }, { template: 'cut', paceKgPerWeek: 0.75 }, 1300);
    expect(fast?.suggestedDailyKcal).toBe(1375);
    expect(fast?.altSlowerPace).toEqual({ paceKgPerWeek: 0.5, dailyKcal: 1650 });
  });

  it('never suggests below the daily minimum', () => {
    const low = targetSuggestion(current, { maintenanceKcal: 1800 }, { template: 'cut', paceKgPerWeek: 0.75 }, 1400);
    expect(low?.suggestedDailyKcal).toBe(1400);
    expect(low?.altSlowerPace?.dailyKcal).toBe(1400);
  });
});

// ---------------------------------------------------------------------------
// The weekly target check
// ---------------------------------------------------------------------------

type CheckInput = Parameters<typeof checkTarget>[0];

const checkInput = targetCheckInput;

function worldInput(opts: MaintenanceWorldOptions = {}, today?: string): CheckInput {
  return checkInput(buildMaintenanceWorld(opts), today);
}

function suggestionOf(check: TargetCheck): Extract<TargetCheck, { kind: 'suggestion' }> {
  if (check.kind !== 'suggestion') throw new Error(`Expected a suggestion, got ${check.kind}`);
  return check;
}

function estimateOf(check: TargetCheck) {
  if (check.kind !== 'suggestion' && check.kind !== 'kept' && check.kind !== 'onTrack') throw new Error(`No estimate: ${check.kind}`);
  return check.estimate;
}

/** The input with one day's eaten kcal changed. */
function withEaten(input: CheckInput, day: string, eatenKcal: number): CheckInput {
  return { ...input, days: input.days.map((d) => (d.day === day ? { ...d, eatenKcal } : d)) };
}

describe('checkTarget', () => {
  const W = MAINTENANCE_WORLD;

  it('suggests 1,550 on Fri 30 Oct from the 28 days to last Sunday (the design numbers)', () => {
    const check = suggestionOf(checkTarget(worldInput()));
    expect(check.estimate).toMatchObject({
      window: W.window,
      basis: 'weekly',
      maintenanceKcal: 2100,
      avgEatenKcal: 1822,
      daysUsed: 28,
      nextCheckOn: '2026-11-02',
    });
    expect(check.estimate.trendKgPerWeek).toBeCloseTo(-0.25, 2);
    expect(check.current).toMatchObject({ goalId: W.ids.cut, versionId: W.ids.setupVersion, maintenanceKcal: 2350, dailyKcal: 1800, paceKgPerWeek: 0.5, dailyMinimumKcal: 1400 });
    expect(check.proposal).toEqual({
      newMaintenanceKcal: 2100,
      suggested: { paceKgPerWeek: 0.5, dailyKcal: 1550, rawDailyKcal: 1550, atMinimum: false },
      slowerPace: { paceKgPerWeek: 0.25, dailyKcal: 1825, rawDailyKcal: 1825, atMinimum: false },
      noticeKey: 'version-cut-setup:2026-10-26',
    });
  });

  it('gives the same number all week, Mon to Sun', () => {
    const friday = estimateOf(checkTarget(worldInput()));
    expect(estimateOf(checkTarget(worldInput({}, '2026-10-26')))).toEqual(friday);
    expect(estimateOf(checkTarget(worldInput({}, '2026-11-01')))).toEqual(friday);

    // A 3,000 kcal complete day this week changes nothing until next Monday's read.
    for (const today of ['2026-10-28', '2026-10-30', '2026-11-01']) {
      expect(estimateOf(checkTarget(withEaten(worldInput({}, today), '2026-10-27', 3000)))).toEqual(friday);
    }
    const nextMonday = estimateOf(checkTarget(withEaten(worldInput({}, '2026-11-02'), '2026-10-27', 3000)));
    expect(nextMonday.window).toEqual({ from: '2026-10-05', to: '2026-11-01' });
    expect(nextMonday.avgEatenKcal).toBeGreaterThan(1822);
  });

  it('reads the same window weekly and daily on a Monday', () => {
    const check = suggestionOf(checkTarget(worldInput({}, '2026-10-26')));
    expect(check.estimate.window).toEqual({ from: '2026-09-28', to: '2026-10-25' });
    expect(check.estimate.basis).toBe('weekly');
    expect(check.proposal.noticeKey).toBe('version-cut-setup:2026-10-26');
  });

  it('falls back to the 28 days to yesterday while the weekly read is short of days', () => {
    const input = worldInput({ startedOn: '2026-10-08', weighInsFrom: '2026-09-07' });
    const weekly = input.days.filter((d) => d.day >= '2026-09-28' && d.day <= '2026-10-25' && d.status === 'complete');
    expect(weekly).toHaveLength(18);
    const check = suggestionOf(checkTarget(input));
    expect(check.estimate).toMatchObject({ basis: 'daily', window: { from: '2026-10-02', to: '2026-10-29' }, daysUsed: 22, nextCheckOn: '2026-11-02' });
  });

  it('is too early with fewer than 21 complete days', () => {
    // Started Sat 10 Oct: 20 complete days to yesterday.
    expect(checkTarget(worldInput({ startedOn: '2026-10-10' }))).toMatchObject({
      kind: 'tooEarly',
      completeDays: 20,
      needDays: 21,
      window: { from: '2026-10-02', to: '2026-10-29' },
    });
    // The demo Friday is day 19 with 17 complete days.
    const demo = checkTarget(checkInput(buildDemoWorld(), DEMO_EXPECTED.today.day));
    expect(demo).toMatchObject({ kind: 'tooEarly', completeDays: 17, needDays: 21 });
  });

  it.each(['guess', 'notCounted', 'unconfirmed', 'paused', null] as const)('leaves %s days out', (status) => {
    // 28 complete days 2–29 Oct; 8 of them as `status` leaves 20.
    const input = worldInput({ startedOn: '2026-10-02' });
    const days = input.days.map((d) => (d.day >= '2026-10-02' && d.day <= '2026-10-09' ? { ...d, status } : d));
    expect(checkTarget({ ...input, days })).toMatchObject({ kind: 'tooEarly', completeDays: 20 });
  });

  it('needs at least 8 weigh-ins, spread over at least 2 weeks', () => {
    expect(checkTarget(worldInput({ weighInEvery: 7 }))).toMatchObject({ kind: 'needWeighIns', weighIns: 4, needWeighIns: 8, firstWeighIn: '2026-10-05' });
    expect(checkTarget(worldInput({ weighInsFrom: '2026-10-20' }))).toMatchObject({
      kind: 'needWeighIns',
      weighIns: 10,
      spanDays: 9,
      needSpanDays: 14,
      firstWeighIn: '2026-10-20',
    });
    const none = checkTarget(worldInput({ weighInsFrom: '2026-11-30' }));
    expect(none).toMatchObject({ kind: 'needWeighIns', weighIns: 0, spanDays: 0 });
    expect(none).not.toHaveProperty('firstWeighIn');
  });

  describe('lets the trend settle after its first reading', () => {
    /** A new user: setup on Fri 2 Oct with `setupKg` typed in, then 80.0 kg every morning, eating the setup estimate. */
    function newUser(setupKg: number, today?: string): CheckInput {
      const world = buildMaintenanceWorld({ startedOn: '2026-10-02', eatenKcal: 2350, kgPerWeek: 0 });
      const weights = world.weights.map((w) => (w.logicalDay === '2026-10-02' ? { ...w, kg: setupKg } : w));
      return checkInput({ ...world, weights }, today);
    }

    it.each([81, 79, 80.5])('a setup weight of %s kg next to 80.0 every morning leaves the target alone', (setupKg) => {
      // Fri 30 Oct: the weekly window (28 Sep – 25 Oct) starts with the setup reading.
      const weekly = checkTarget(newUser(setupKg));
      expect(weekly).toMatchObject({ kind: 'onTrack', estimate: { basis: 'weekly', window: W.window, daysUsed: 24 } });
      expect(Math.abs(estimateOf(weekly).maintenanceKcal - 2350)).toBeLessThanOrEqual(50);
      expect(Math.abs(estimateOf(weekly).trendKgPerWeek)).toBeLessThan(0.05);
      // Fri 23 Oct, day 22: the first daily read.
      const daily = checkTarget(newUser(setupKg, '2026-10-23'));
      expect(daily).toMatchObject({ kind: 'onTrack', estimate: { basis: 'daily', daysUsed: 21 } });
      expect(Math.abs(estimateOf(daily).maintenanceKcal - 2350)).toBeLessThanOrEqual(50);
    });

    it('gives the same as a setup weight that matched the scale', () => {
      expect(checkTarget(newUser(80))).toMatchObject({ kind: 'onTrack', estimate: { maintenanceKcal: 2350, trendKgPerWeek: 0 } });
    });

    it('starts over after a gap of 10 days or more', () => {
      // Weighing since 7 Sep, then none from 6 to 15 Oct; back on Fri 16 Oct 1 kg up (travel), then 80.0 again.
      const world = buildMaintenanceWorld({ eatenKcal: 2350, kgPerWeek: 0 });
      const weights = world.weights
        .filter((w) => w.logicalDay < '2026-10-06' || w.logicalDay > '2026-10-15')
        .map((w) => (w.logicalDay === '2026-10-16' ? { ...w, kg: 81 } : w));
      const check = checkTarget(checkInput({ ...world, weights }));
      expect(check).toMatchObject({ kind: 'onTrack', estimate: { basis: 'weekly' } });
      expect(Math.abs(estimateOf(check).maintenanceKcal - 2350)).toBeLessThanOrEqual(40);
    });

    it('waits for a trend that started too recently, counting from its first day', () => {
      // First weigh-in Wed 14 Oct: 16 by Thu 29 Oct, but only 24–29 Oct have settled.
      expect(checkTarget(worldInput({ weighInsFrom: '2026-10-14' }))).toEqual(
        expect.objectContaining({ kind: 'needWeighIns', weighIns: 16, spanDays: 15, needSpanDays: 17, firstWeighIn: '2026-10-14', window: { from: '2026-10-02', to: '2026-10-29' } }),
      );
      // From Mon 12 Oct, the settled points (22–29 Oct) span a week.
      expect(checkTarget(worldInput({ weighInsFrom: '2026-10-12' }))).toMatchObject({ kind: 'suggestion', estimate: { basis: 'daily' } });
    });
  });

  it('is on track when maintenance moved by 100 kcal or less', () => {
    expect(checkTarget(worldInput({ maintenanceKcal: 2060 }))).toMatchObject({ kind: 'onTrack', sameTarget: false, atMinimum: false });
  });

  it('compares with the newest version, even one that starts tomorrow', () => {
    const pending = { id: 'version-pending', maintenanceKcal: 2100, dailyKcal: 1550, paceKgPerWeek: 0.5 };
    const check = checkTarget({ ...worldInput(), latest: pending });
    expect(check.kind).toBe('onTrack');
    expect(check.kind === 'onTrack' ? check.current.versionId : undefined).toBe('version-pending');
  });

  it('never suggests below the daily minimum, and says when it holds the target up', () => {
    const check = suggestionOf(checkTarget(worldInput({ dailyMinimumKcal: 1600 })));
    expect(check.proposal.suggested).toEqual({ paceKgPerWeek: 0.5, dailyKcal: 1600, rawDailyKcal: 1550, atMinimum: true });
    expect(check.proposal.slowerPace?.dailyKcal).toBe(1825);
  });

  it('has nothing to approve when the target would stay the same', () => {
    // Held at the 1,600 minimum before and after: the target doesn't drop, so no slower pace either.
    const held = checkTarget(worldInput({ dailyKcal: 1600, dailyMinimumKcal: 1600 }));
    expect(held).toMatchObject({ kind: 'onTrack', sameTarget: true, atMinimum: true, rawDailyKcal: 1550 });
    expect(held.kind === 'onTrack' ? held.estimate.maintenanceKcal : 0).toBe(2100);
  });

  it('offers no slower pace when the target goes up', () => {
    const check = suggestionOf(checkTarget(worldInput({ maintenanceKcal: 1950, dailyKcal: 1400 })));
    expect(check.proposal.suggested.dailyKcal).toBe(1550);
    expect(check.proposal.slowerPace).toBeUndefined();
  });

  it('suggests maintenance for Festive maintain and maintenance + surplus for Lean bulk', () => {
    const festive = suggestionOf(checkTarget(worldInput({ template: 'festive', maintenanceKcal: 2350, dailyKcal: 2350 })));
    expect(festive.proposal.suggested).toMatchObject({ dailyKcal: 2100, paceKgPerWeek: 0 });
    expect(festive.proposal.slowerPace).toBeUndefined();
    const bulk = suggestionOf(checkTarget(worldInput({ template: 'leanBulk', maintenanceKcal: 2350, dailyKcal: 2550 })));
    expect(bulk.proposal.suggested.dailyKcal).toBe(2300);
    expect(bulk.current.surplusKcal).toBe(200);
  });

  it('reads the pace from the newest version', () => {
    const latest = { id: 'version-slower', maintenanceKcal: 2350, dailyKcal: 2075, paceKgPerWeek: 0.25 };
    const check = suggestionOf(checkTarget({ ...worldInput(), latest }));
    expect(check.current.paceKgPerWeek).toBe(0.25);
    expect(check.proposal.suggested).toMatchObject({ paceKgPerWeek: 0.25, dailyKcal: 1825 });
    expect(check.proposal.slowerPace).toBeUndefined();
  });

  it('takes workouts off what was eaten', () => {
    const without = estimateOf(checkTarget(worldInput()));
    const withWorkouts = estimateOf(checkTarget(worldInput({ workoutKcal: 70 })));
    expect(withWorkouts.avgWorkoutKcal).toBe(70);
    expect(withWorkouts.maintenanceKcal).toBe(without.maintenanceKcal - 70);
    expect(withWorkouts.maintenanceKcal).toBe(2030);
    expect(maintenanceWorking(withWorkouts)).toBe('You logged ~1,820 a day, workouts added ~70 a day, and your trend dropped 0.25 kg a week.');
  });

  it('has no target without a goal, while paused, or with a switch booked for tomorrow', () => {
    const { goal: _goal, ...noGoal } = worldInput();
    expect(checkTarget(noGoal)).toEqual({ kind: 'noTarget', reason: 'noGoal' });
    const { latest: _latest, ...noVersion } = worldInput();
    expect(checkTarget(noVersion)).toEqual({ kind: 'noTarget', reason: 'noGoal' });
    expect(checkTarget({ ...noVersion, goal: { id: W.ids.pause, template: 'pause', paceKgPerWeek: 0 } })).toEqual({ kind: 'noTarget', reason: 'paused' });
    expect(checkTarget({ ...worldInput(), switching: true })).toEqual({ kind: 'noTarget', reason: 'switching' });
  });

  it('stays quiet after Keep current until its day, a new move of over 100 kcal or a new target', () => {
    const kept = { keptOn: W.today, until: W.expected.keptUntil, maintenanceKcal: 2100, versionId: W.ids.setupVersion };
    expect(checkTarget({ ...worldInput(), kept })).toMatchObject({ kind: 'kept', kept, proposal: { suggested: { dailyKcal: 1550 } } });
    // On its `until` day it comes back (here: kept 4 weeks ago, back today).
    expect(checkTarget({ ...worldInput(), kept: { ...kept, keptOn: '2026-10-02', until: W.today } }).kind).toBe('suggestion');
    expect(checkTarget({ ...worldInput(), kept: { ...kept, keptOn: '2026-10-03', until: W.tomorrow } }).kind).toBe('kept');
    expect(checkTarget({ ...worldInput(), kept: { ...kept, maintenanceKcal: 2250 } }).kind).toBe('suggestion');
    expect(checkTarget({ ...worldInput(), kept: { ...kept, versionId: 'another-version' } }).kind).toBe('suggestion');
  });

  it('never changes its inputs', () => {
    const input = worldInput();
    const frozen: CheckInput = {
      ...input,
      days: Object.freeze(input.days.map((d) => Object.freeze({ ...d }))),
      trend: Object.freeze([...input.trend].reverse().map((p) => Object.freeze({ ...p }))),
      ...(input.goal ? { goal: Object.freeze({ ...input.goal }) } : {}),
      ...(input.latest ? { latest: Object.freeze({ ...input.latest }) } : {}),
    };
    expect(suggestionOf(checkTarget(frozen)).estimate.maintenanceKcal).toBe(2100);
  });
});

describe('maintenanceWorking', () => {
  const design = { avgEatenKcal: 1822, avgWorkoutKcal: 0, trendKgPerWeek: -0.2508 };

  it('says what was logged and how the trend moved', () => {
    expect(maintenanceWorking(design)).toBe('You logged ~1,820 a day, and your trend dropped 0.25 kg a week.');
    expect(maintenanceWorking({ avgEatenKcal: 1950, avgWorkoutKcal: 70, trendKgPerWeek: -0.5 })).toBe(
      'You logged ~1,950 a day, workouts added ~70 a day, and your trend dropped 0.5 kg a week.',
    );
    expect(maintenanceWorking({ ...design, trendKgPerWeek: 0.01 })).toBe('You logged ~1,820 a day, and your trend held steady.');
    expect(maintenanceWorking({ ...design, trendKgPerWeek: 0.1 })).toBe('You logged ~1,820 a day, and your trend rose 0.1 kg a week.');
  });
});
