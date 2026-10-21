import { describe, expect, it } from 'vitest';
import type { ActiveGoal } from '@/db/selectors';
import { buildGoal } from '@/db/seed/defaults';
import { computeWeekBudget, type BudgetDayInput } from '@/domain/budget';
import { checkTarget } from '@/domain/maintenance';
import { slotBaselines } from '@/domain/timing';
import type { GoalTemplate, GoalVersion } from '@/domain/types';
import { joinNames, shortfallLine, soFarRange, targetsBreakdown, targetsTotal, weekdayLong } from './budgetText';
import {
  eatenCaption,
  goalEndNotice,
  goalPillLabel,
  heroFigures,
  makanCaption,
  nextMainSlot,
  nextWeekendDay,
  nudgeLine,
  sleepTapVisible,
  targetNotice,
  weekBarsFor,
} from './todayModel';
import { buildMaintenanceWorld, MAINTENANCE_WORLD, targetCheckInput, type MaintenanceWorldOptions } from '@/test/maintenanceWorld';

const WEEK = ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'];
const TODAY = '2026-10-16';
const NOW = new Date('2026-10-16T11:10:00.000Z'); // 7:10pm MYT

function inputs(eaten: number[], extra: Partial<BudgetDayInput> = {}): BudgetDayInput[] {
  return WEEK.map((day, i) => ({
    day,
    targetKcal: 1800,
    eatenKcal: eaten[i] ?? 0,
    workoutKcal: 0,
    bonusKcal: 0,
    status: i < 4 ? 'complete' : null,
    ...extra,
  }));
}

const DEMO_EATEN = [1620, 1710, 1540, 1680, 1230];

function week(eaten: number[], makanDay?: string, today = TODAY) {
  return computeWeekBudget({ days: inputs(eaten), today, dailyMinimumKcal: 1400, ...(makanDay ? { makanDay } : {}) });
}

const version: GoalVersion = {
  id: 'v',
  goalId: 'g',
  effectiveFrom: '2026-09-28',
  dailyKcal: 1800,
  proteinG: 110,
  carbsG: 180,
  fatG: 60,
  maintenanceKcal: 2350,
  reason: 'setup',
  createdAt: '2026-09-28T01:00:00.000Z',
};

function active(template: Exclude<GoalTemplate, 'custom'>, extra: Partial<GoalVersion> = {}, to?: string): ActiveGoal {
  const goal = buildGoal(template, { id: template, createdAt: version.createdAt, status: 'active' });
  return {
    goal,
    version: { ...version, ...extra },
    period: { id: 'p', goalId: goal.id, from: '2026-09-28', ...(to ? { to } : {}) },
    paused: template === 'pause',
  };
}

describe('goalPillLabel', () => {
  it('names each goal with its key target', () => {
    expect(goalPillLabel(active('cut'), TODAY)).toBe('Cut · 1,800');
    expect(goalPillLabel(active('leanBulk', { proteinG: 130 }), TODAY)).toBe('Lean bulk · 130g');
    expect(goalPillLabel(active('festive', { dailyKcal: 2100 }), TODAY)).toBe('Festive · 2,100');
    expect(goalPillLabel(active('pause', {}, '2026-10-19'), TODAY)).toBe('Paused until Mon');
    expect(goalPillLabel(active('pause', {}, '2026-11-02'), TODAY)).toBe('Paused until Mon 2 Nov');
    expect(goalPillLabel(active('pause'), TODAY)).toBe('Paused');
  });
});

describe('heroFigures', () => {
  const cut = active('cut').goal;

  it('under: 570 left, +650 saved, 4,820 left this week', () => {
    const figures = heroFigures({ view: { budget: week(DEMO_EATEN, '2026-10-17'), goal: cut }, paused: false });
    expect(figures).toMatchObject({ label: 'Left today', value: '570', savedLabel: '+650', savedTone: 'good', leftWeekLabel: '4,820' });
    expect(figures.note).toBeUndefined();
  });

  it('near: 10% or less left', () => {
    const figures = heroFigures({ view: { budget: week([1620, 1710, 1540, 1680, 1650]), goal: cut }, paused: false });
    expect(figures).toMatchObject({ value: '150', valueTone: 'near', note: "Close to today's budget" });
  });

  it('over and covered by savings', () => {
    const figures = heroFigures({ view: { budget: week([1620, 1710, 1540, 1680, 2110]), goal: cut }, paused: false });
    expect(figures).toMatchObject({ label: 'Over today', value: '+310', valueTone: 'over', note: 'Covered by your +650 saved' });
  });

  it('over and not covered: the rest of the week adjusts, or a fresh start on Sunday', () => {
    const figures = heroFigures({ view: { budget: week([1800, 1800, 1800, 1800, 2300]), goal: cut }, paused: false });
    expect(figures.note).toBe('The rest of the week adjusts to cover it');
    const sunday = computeWeekBudget({
      days: inputs([1800, 1800, 1800, 1800, 1800, 1800, 2300]).map((d, i) => ({ ...d, status: i < 6 ? 'complete' : null })),
      today: '2026-10-18',
      dailyMinimumKcal: 1400,
    });
    expect(heroFigures({ view: { budget: sunday, goal: cut }, paused: false }).note).toBe('Fresh start on Monday');
  });

  it('says when savings are waiting for the check-in', () => {
    const days = inputs(DEMO_EATEN).map((d) => (d.day === '2026-10-15' ? { ...d, status: null } : d));
    const budget = computeWeekBudget({ days, today: TODAY, dailyMinimumKcal: 1400 });
    expect(heroFigures({ view: { budget, goal: cut }, paused: false })).toMatchObject({
      savedLabel: '+530',
      note: '+120 waiting for check-in',
      noteTone: 'muted',
    });
  });

  it('lean bulk, festive and pause show their own figure', () => {
    const budget = week(DEMO_EATEN);
    const bulk = heroFigures({
      view: { budget, goal: active('leanBulk').goal },
      paused: false,
      proteinLeft: { targetG: 130, eatenG: 42, leftG: 88 },
    });
    expect(bulk).toMatchObject({ label: 'Protein left', value: '88g' });

    const festive = heroFigures({
      view: { budget, goal: active('festive').goal },
      paused: false,
      festive: { inRange: 3, days: 4, lowKcal: 1890, highKcal: 2310 },
    });
    expect(festive).toMatchObject({ label: 'Days in range', value: '3 of 4', note: 'In range: 1,890–2,310 kcal' });

    const pause = heroFigures({ view: { budget, goal: active('pause').goal }, paused: true });
    expect(pause).toMatchObject({ label: 'Budget off', value: '—', valueTone: 'muted', note: 'Logging is optional this week', savedLabel: '—' });
  });
});

describe('week bars and captions', () => {
  it('maps the budget days to bars: logged, today with its fill, makan and planned', () => {
    const bars = weekBarsFor({ budget: week(DEMO_EATEN, '2026-10-17'), version }, false);
    expect(bars.targetKcal).toBe(1800);
    expect(bars.bars.map((b) => [b.label, b.kind, b.valueKcal, b.fillKcal])).toEqual([
      ['M', 'logged', 1620, undefined],
      ['T', 'logged', 1710, undefined],
      ['W', 'logged', 1540, undefined],
      ['T', 'logged', 1680, undefined],
      ['F', 'today', 1800, 1230],
      ['S', 'makan', 2450, undefined],
      ['S', 'planned', 1800, undefined],
    ]);
  });

  it('reads the window and the makan day', () => {
    const closesAt = '2026-10-16T14:40:00.000Z';
    expect(eatenCaption({ mealCount: 2, kcal: 1230, closesAt, now: NOW, tz: 'Asia/Kuala_Lumpur' })).toBe('1,230 eaten · window closes 10:40pm');
    expect(eatenCaption({ mealCount: 2, kcal: 1230, closesAt, now: new Date('2026-10-16T15:00:00.000Z'), tz: 'Asia/Kuala_Lumpur' })).toBe(
      '1,230 eaten · window closed 10:40pm',
    );
    expect(eatenCaption({ mealCount: 0, kcal: 0, now: NOW, tz: 'Asia/Kuala_Lumpur' })).toBe('Nothing logged yet');

    expect(makanCaption(week(DEMO_EATEN, '2026-10-17'))).toBe('Sat: 2,450 room');
    expect(makanCaption(week(DEMO_EATEN))).toBe('Sat: not planned');
    expect(makanCaption(week(DEMO_EATEN, undefined, '2026-10-17'))).toBe('Sun: not planned');
    expect(makanCaption(week(DEMO_EATEN, undefined, '2026-10-18'))).toBeUndefined();
    expect(nextWeekendDay('2026-10-12')).toBe('2026-10-17');
  });
});

describe('next slot, nudge and sleep tap', () => {
  const baselines = slotBaselines([]);

  it('offers the next main slot after the last one logged, skipping a long-gone lunch', () => {
    expect(nextMainSlot([{ slot: 'breakfast' }, { slot: 'lunch' }], baselines, 19 * 60 + 10, 5)).toBe('dinner');
    expect(nextMainSlot([], baselines, 8 * 60, 5)).toBe('breakfast');
    expect(nextMainSlot([], baselines, 12 * 60, 5)).toBe('lunch');
    expect(nextMainSlot([{ slot: 'breakfast' }], baselines, 19 * 60, 5)).toBe('dinner');
    expect(nextMainSlot([{ slot: 'breakfast' }, { slot: 'snack' }], baselines, 14 * 60, 5)).toBe('lunch');
    expect(nextMainSlot([{ slot: 'dinner' }], baselines, 21 * 60, 5)).toBeUndefined();
  });

  it('nudges about protein until dinner is logged', () => {
    const tz = 'Asia/Kuala_Lumpur';
    const closesAt = '2026-10-16T14:40:00.000Z';
    expect(
      nudgeLine({ meals: [{ slot: 'breakfast' }, { slot: 'lunch' }], proteinBehind: true, proteinLeftG: 68, nextSlot: 'dinner', closesAt, now: NOW, tz }),
    ).toBe('Protein is behind: ~68g left. A protein-heavy dinner helps.');
    expect(nudgeLine({ meals: [{ slot: 'lunch' }, { slot: 'dinner' }], proteinBehind: true, proteinLeftG: 20, closesAt, now: NOW, tz })).toBe(
      'Dinner logged. Window closes 10:40pm.',
    );
    expect(nudgeLine({ meals: [{ slot: 'lunch' }], proteinBehind: false, proteinLeftG: 20, nextSlot: 'dinner', now: NOW, tz })).toBeUndefined();
  });

  it('shows the sleep tap from 10pm, or an hour before your usual sleep time', () => {
    const at = (h: number, m = 0) => ((h * 60 + m - 5 * 60 + 1440) % 1440);
    expect(sleepTapVisible(at(19, 10), null, 5)).toBe(false);
    expect(sleepTapVisible(at(22, 5), null, 5)).toBe(true);
    expect(sleepTapVisible(at(1, 0), null, 5)).toBe(true);
    // Usually asleep at 1:30am: shows from 12:30am.
    expect(sleepTapVisible(at(23, 30), at(1, 30), 5)).toBe(false);
    expect(sleepTapVisible(at(0, 40), at(1, 30), 5)).toBe(true);
  });
});

describe('budget sheet text', () => {
  it('breaks the targets down and names the days', () => {
    expect(targetsBreakdown(inputs([]))).toBe('7 × 1,800');
    const switched = inputs([]).map((d, i) => (i >= 4 ? { ...d, targetKcal: 2100 } : d));
    expect(targetsBreakdown(switched)).toBe('4 × 1,800 + 3 × 2,100');
    expect(targetsTotal(switched)).toBe(13500);
    expect(soFarRange('2026-10-12', TODAY)).toBe('Mon–Fri');
    expect(soFarRange('2026-10-12', '2026-10-12')).toBe('Mon');
    expect(joinNames(['Thu', 'Fri', 'Sat'])).toBe('Thu, Fri and Sat');
    expect(weekdayLong('2026-10-17')).toBe('Saturday');
  });

  it('explains how a shortfall spreads, and what doesn’t fit', () => {
    expect(shortfallLine(week(DEMO_EATEN), 1400)).toBeUndefined();
    expect(shortfallLine(week([1620, 1710, 1540, 1680, 3230]), 1400)).toBe('Sat and Sun allowance: 1,410 each, never below your 1,400 minimum.');
    expect(shortfallLine(week([1800, 1800, 1800, 1800, 3000]), 1400)).toBe(
      "Sat and Sun allowance: 1,400 each, never below your 1,400 minimum. 400 kcal can't fit into the days left. It isn't carried into next week.",
    );
  });
});

describe('targetNotice (S40, in-app)', () => {
  const check = (opts: MaintenanceWorldOptions = {}) => checkTarget(targetCheckInput(buildMaintenanceWorld(opts)));

  it('tells about a waiting suggestion once per key', () => {
    expect(targetNotice(check(), null)).toEqual({
      key: MAINTENANCE_WORLD.expected.noticeKey,
      lead: 'New target suggestion',
      rest: 'based on 4 weeks of data.',
    });
    expect(targetNotice(check(), 'version-cut-setup:2026-10-19')?.key).toBe(MAINTENANCE_WORLD.expected.noticeKey);
    expect(targetNotice(check(), MAINTENANCE_WORLD.expected.noticeKey)).toBeUndefined();
  });

  it('counts whole weeks of data', () => {
    // 23 complete days in the 28 to yesterday.
    const young = check({ startedOn: '2026-10-07', weighInsFrom: '2026-09-07' });
    expect(young.kind === 'suggestion' ? young.estimate.daysUsed : 0).toBe(23);
    expect(targetNotice(young, null)?.rest).toBe('based on 3 weeks of data.');
  });

  it('says nothing for a kept suggestion, an on-track target or no check yet', () => {
    const input = targetCheckInput(buildMaintenanceWorld());
    const kept = checkTarget({ ...input, kept: { keptOn: '2026-10-30', until: '2026-11-27', maintenanceKcal: 2100, versionId: 'version-cut-setup' } });
    expect(kept.kind).toBe('kept');
    expect(targetNotice(kept, null)).toBeUndefined();
    expect(targetNotice(check({ maintenanceKcal: 2060 }), null)).toBeUndefined();
    expect(targetNotice(undefined, null)).toBeUndefined();
  });
});

describe('goalEndNotice', () => {
  const cut = buildGoal('cut', { id: 'goal-cut', createdAt: NOW.toISOString(), status: 'active' });

  it('says the goal reached its end date, once per key', () => {
    const end = { goal: cut, state: { kind: 'date' as const, date: TODAY, reached: true as const, daysLeft: 0 }, key: 'goal-cut:date:2026-10-16' };
    expect(goalEndNotice(end, null)).toEqual({
      key: 'goal-cut:date:2026-10-16',
      lead: 'Your Cut goal reached its end date.',
      rest: 'Pick what comes next.',
    });
    expect(goalEndNotice(end, 'goal-cut:date:2026-10-16')).toBeUndefined();
    expect(goalEndNotice(end, 'goal-cut:date:2026-10-09')).toBeDefined();
  });

  it('says the trend reached the weight', () => {
    const end = { goal: cut, state: { kind: 'weight' as const, weightKg: 75, reached: true as const, trendKg: 74.9 }, key: 'goal-cut:weight:75' };
    expect(goalEndNotice(end, null)?.lead).toBe('Your trend reached 75.0 kg.');
  });

  it('is undefined without a reached end', () => {
    expect(goalEndNotice(undefined, null)).toBeUndefined();
  });
});
