// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { BudgetDay } from '@/domain/budget';
import type { MealItem, MealLog } from '@/domain/types';
import {
  budgetDayBadge,
  dayBadgeFor,
  dayForWeek,
  dayMonth,
  dayRowKcal,
  dayTitle,
  diaryDayPath,
  diaryWeekPath,
  itemDetail,
  kgNumber,
  originalEstimateKcal,
  parseDayParam,
  parseWeekParam,
  targetCaption,
  timelineFor,
  weekTitle,
} from './diaryModel';

const TZ = 'Asia/Kuala_Lumpur';
const TODAY = '2026-10-16';
const THIS_WEEK = '2026-10-12';

function budgetDay(patch: Partial<BudgetDay>): BudgetDay {
  return {
    day: '2026-10-14',
    kind: 'logged',
    isToday: false,
    isFinished: true,
    status: 'complete',
    baseKcal: 1800,
    eatenKcal: 1540,
    countedKcal: 1540,
    savedKcal: 260,
    plannedKcal: 0,
    ...patch,
  };
}

function meal(id: string, eatenAt: string, kcal: number, extra: Partial<MealLog> = {}): MealLog {
  return {
    id,
    eatenAt,
    logicalDay: TODAY,
    slot: 'lunch',
    name: id,
    items: [{ id: `${id}-1`, name: id, unitMacros: { kcal, proteinG: 0, carbsG: 0, fatG: 0 }, quantity: 1, uncertainty: 0.15, source: 'catalogue' }],
    method: 'text',
    finished: 'all',
    createdAt: eatenAt,
    updatedAt: eatenAt,
    syncState: 'local',
    ...extra,
  };
}

describe('params and paths', () => {
  it('parses ?day= within first use and today', () => {
    expect(parseDayParam(null, TODAY)).toBe(TODAY);
    expect(parseDayParam('nonsense', TODAY)).toBe(TODAY);
    expect(parseDayParam('2026-02-30', TODAY)).toBe(TODAY);
    expect(parseDayParam('2026-10-14', TODAY, '2026-09-28')).toBe('2026-10-14');
    expect(parseDayParam('2026-10-20', TODAY)).toBe(TODAY);
    expect(parseDayParam('2026-09-01', TODAY, '2026-09-28')).toBe('2026-09-28');
  });

  it('parses ?week= to a Monday no later than this week', () => {
    expect(parseWeekParam('2026-10-08', THIS_WEEK)).toBe('2026-10-05');
    expect(parseWeekParam('2026-11-02', THIS_WEEK)).toBe(THIS_WEEK);
    expect(parseWeekParam('2026-09-01', THIS_WEEK, '2026-09-28')).toBe('2026-09-28');
  });

  it('builds links without params for today and this week', () => {
    expect(diaryDayPath(TODAY, TODAY)).toBe('/diary');
    expect(diaryDayPath('2026-10-15', TODAY)).toBe('/diary?day=2026-10-15');
    expect(diaryWeekPath(THIS_WEEK, THIS_WEEK)).toBe('/diary/week');
    expect(diaryWeekPath('2026-10-05', THIS_WEEK)).toBe('/diary/week?week=2026-10-05');
    expect(dayForWeek(THIS_WEEK, TODAY)).toBe(TODAY);
    expect(dayForWeek('2026-10-05', TODAY)).toBe('2026-10-11');
  });
});

describe('labels', () => {
  it('names days and weeks', () => {
    expect(dayTitle(TODAY, TODAY)).toBe('Fri 16 Oct · Today');
    expect(dayTitle('2026-10-15', TODAY)).toBe('Thu 15 Oct · Yesterday');
    expect(dayTitle('2026-10-14', TODAY)).toBe('Wed 14 Oct');
    expect(weekTitle(THIS_WEEK, THIS_WEEK)).toBe('12–18 Oct · This week');
    expect(weekTitle('2026-10-05', THIS_WEEK)).toBe('5–11 Oct · Last week');
    expect(weekTitle('2026-09-28', THIS_WEEK)).toBe('28 Sep–4 Oct');
    expect(kgNumber(77.99)).toBe('78.0');
    expect(dayMonth('2026-10-03')).toBe('3 Oct');
  });

  it('captions the target', () => {
    expect(targetCaption([1800, 1800, null])).toBe('Target 1,800 a day');
    expect(targetCaption([1800, 2100])).toBe('Target 1,800–2,100 a day');
    expect(targetCaption([null, null])).toBe('Budget off');
  });
});

describe('badges and rows', () => {
  it('picks the S12 badge', () => {
    expect(dayBadgeFor({ day: TODAY, today: TODAY, status: null, paused: false })).toBe('inProgress');
    expect(dayBadgeFor({ day: '2026-10-15', today: TODAY, status: null, paused: false })).toBe('unconfirmed');
    expect(dayBadgeFor({ day: '2026-10-15', today: TODAY, status: 'notCounted', paused: false })).toBe('notCounted');
    expect(dayBadgeFor({ day: TODAY, today: TODAY, status: null, paused: true })).toBe('paused');
  });

  it('picks the S13 badge and kcal', () => {
    expect(budgetDayBadge(budgetDay({}))).toBe('complete');
    expect(budgetDayBadge(budgetDay({ status: null }))).toBe('unconfirmed');
    expect(budgetDayBadge(budgetDay({ status: 'guess' }))).toBe('guess');
    expect(budgetDayBadge(budgetDay({ isToday: true, isFinished: false, kind: 'today' }))).toBe('inProgress');
    expect(budgetDayBadge(budgetDay({ isFinished: false, kind: 'makan', plannedKcal: 2450 }))).toBe('makan');
    expect(budgetDayBadge(budgetDay({ isFinished: false, kind: 'planned' }))).toBe('planned');
    expect(budgetDayBadge(budgetDay({ kind: 'paused' }))).toBe('paused');
    expect(dayRowKcal(budgetDay({}))).toEqual({ kcal: 1540, planned: false });
    expect(dayRowKcal(budgetDay({ isFinished: false, kind: 'makan', plannedKcal: 2450 }))).toEqual({ kcal: 2450, planned: true });
    expect(dayRowKcal(budgetDay({ isFinished: false, kind: 'paused' }))).toEqual({ kcal: null, planned: true });
  });
});

describe('timelineFor', () => {
  it('places dots, the window and the now marker across the 5am day', () => {
    const breakfast = meal('b', '2026-10-16T02:40:00.000Z', 560, { slot: 'breakfast' });
    const lunch = meal('l', '2026-10-16T06:15:00.000Z', 900);
    const model = timelineFor({
      day: TODAY,
      isToday: true,
      meals: [breakfast, lunch],
      tags: { b: 'lateForYou', l: 'onTime' },
      window: { opensAt: breakfast.eatenAt, closesAt: '2026-10-16T14:40:00.000Z', lengthHours: 3.6, occasions: 2 },
      now: new Date('2026-10-16T11:10:00.000Z'),
      tz: TZ,
      rolloverHour: 5,
    });
    // 10:40am is 340 minutes after 5am.
    expect(model.dots[0]).toEqual({ pct: (340 / 1440) * 100, kcal: 560, tone: 'late' });
    expect(model.dots[1]?.tone).toBe('onTime');
    expect(model.windowEndPct).toBeCloseTo((1060 / 1440) * 100, 6);
    expect(model.nowPct).toBeCloseTo((850 / 1440) * 100, 6);
    expect(model.captions).toEqual(['5am', 'now', '5am']);
    expect(model.header).toEqual({ left: 'Window opened 10:40am', right: 'closes 10:40pm' });
  });

  it('keeps a window that closes after the rollover at the right edge, and leaves guesses off', () => {
    const late = meal('d', '2026-10-15T11:00:00.000Z', 600, { logicalDay: '2026-10-15' });
    const guess = meal('g', '2026-10-15T13:00:00.000Z', 300, { logicalDay: '2026-10-15', isGuess: true });
    const model = timelineFor({
      day: '2026-10-15',
      isToday: false,
      meals: [late, guess],
      tags: {},
      window: { opensAt: late.eatenAt, closesAt: '2026-10-15T23:00:00.000Z', lengthHours: 0, occasions: 1 },
      now: new Date('2026-10-16T11:10:00.000Z'),
      tz: TZ,
      rolloverHour: 5,
    });
    expect(model.dots).toHaveLength(1);
    expect(model.windowEndPct).toBe(100);
    expect(model.nowPct).toBeUndefined();
    expect(model.captions).toEqual(['5am', '5pm', '5am']);
    expect(model.header?.right).toBe('closed 7:00am');
  });
});

describe('entries', () => {
  const rice: MealItem = {
    id: 'r',
    name: 'Rice',
    variants: [
      { id: 'n', label: 'Normal', macros: { kcal: 330, proteinG: 6, carbsG: 73, fatG: 0.6 } },
      { id: 'b', label: 'Mamak big', macros: { kcal: 430, proteinG: 8, carbsG: 95, fatG: 0.8 } },
    ],
    selectedVariant: 0,
    unitMacros: { kcal: 330, proteinG: 6, carbsG: 73, fatG: 0.6 },
    quantity: 1,
    uncertainty: 0.15,
    source: 'catalogue',
  };

  it('finds the original estimate only when an item changed', () => {
    expect(originalEstimateKcal({ items: [rice], finished: 'all' })).toBeNull();
    const edited: MealItem = { ...rice, original: { selectedVariant: 1, quantity: 1, unitMacros: { kcal: 430, proteinG: 8, carbsG: 95, fatG: 0.8 } }, edited: true };
    expect(originalEstimateKcal({ items: [edited], finished: 'all' })).toBe(430);
    expect(originalEstimateKcal({ items: [edited], finished: 'half' })).toBe(215);
  });

  it('describes an item portion', () => {
    expect(itemDetail(rice)).toBe('Normal');
    expect(itemDetail({ ...rice, quantity: 2 })).toBe('Normal · ×2');
    expect(itemDetail({ ...rice, variants: undefined, selectedVariant: undefined })).toBeUndefined();
  });
});
