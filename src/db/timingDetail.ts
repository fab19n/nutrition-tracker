/**
 * Read model and hook for S35 Timing detail: one day's timing numbers against the goal's own
 * rules, and the grid of the week that day belongs to. Built on the Diary's day summary and the
 * week budget, so the tags, the window and the paused days agree with Today, Diary and Insights.
 * Read-only: nothing here writes.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { db as appDb, type KiraMakanDb } from '@/db/db';
import { useToday } from '@/db/hooks';
import { listDayRecordsInRange, listMealsInRange } from '@/db/repo';
import { getDaySummary, getWeekBudget, loadSettings, todayFor, type DaySummary, type SelectorOptions } from '@/db/selectors';
import { getUsualSleepMinutes } from '@/db/today';
import { addDays, compareDays, weekDays, weekStartOf } from '@/domain/day';
import { timingGrid, type InsightDay, type TimingRow } from '@/domain/insights';
import { mealMacros } from '@/domain/meal';
import { DEFAULT_MAX_WINDOW_HOURS } from '@/domain/timing';
import { dayTimingMetrics, type DayTimingMetrics } from '@/domain/timingDetail';
import type { LogicalDay, TimingRules } from '@/domain/types';

/** Fewer complete days than this is an early read, the same rule Insights follows. */
export const TIMING_SOLID_DAYS = 14;

export interface TimingDetailView {
  day: LogicalDay;
  today: LogicalDay;
  isToday: boolean;
  tz: string;
  rolloverHour: number;
  /** The first day of use. */
  earliest: LogicalDay;
  /** Days marked complete since the first day, before today. */
  completeDays: number;
  earlyRead: boolean;
  /** The goal in force that day is Pause: timing is off. */
  paused: boolean;
  summary: DaySummary;
  /** The goal's timing rules for that day. */
  rules: TimingRules;
  /** Real meals only, with the baselines the tags use. */
  metrics: DayTimingMetrics;
  /** Median "Going to sleep" time, minutes since the rollover; null before the first tap. */
  usualSleepLogicalMin: number | null;
  week: { weekStart: LogicalDay; rows: TimingRow[]; averageWindowHours: number | null };
}

/** The day's timing and its week. Undefined without a profile. */
export async function getTimingDetailIn(db: KiraMakanDb, day: LogicalDay, opts: SelectorOptions = {}): Promise<TimingDetailView | undefined> {
  const settings = await loadSettings(db);
  const profile = settings.profile;
  if (!profile) return undefined;
  const today = opts.today ?? todayFor(profile);
  const weekStart = weekStartOf(day);
  const weekEnd = addDays(weekStart, 6);

  const [summary, usualSleep, weekMeals, weekRecords, sinceStart, budgetView] = await Promise.all([
    getDaySummary(db, day),
    getUsualSleepMinutes(db, today),
    listMealsInRange(db, weekStart, weekEnd),
    listDayRecordsInRange(db, weekStart, weekEnd),
    listDayRecordsInRange(db, profile.startedOn, addDays(today, -1)),
    getWeekBudget(db, day, { today }),
  ]);
  const completeDays = sinceStart.filter((r) => r.status === 'complete').length;
  const rules = summary.goal?.goal.timing ?? {};
  const record = summary.record;
  const metrics = dayTimingMetrics({
    meals: summary.meals,
    rules,
    baselines: summary.baselines,
    ...(record?.sleepAt ? { sleepAt: record.sleepAt } : {}),
    tz: settings.tz,
    rolloverHour: settings.rolloverHour,
  });

  // The week's grid. A day the goal paused has timing off, so it is drawn empty.
  const pausedDays = new Set(budgetView?.budget.days.filter((d) => d.kind === 'paused').map((d) => d.day));
  const statusOf = new Map(weekRecords.map((r) => [r.logicalDay, r.status]));
  const days: InsightDay[] = weekDays(weekStart).map((d) => {
    const meals = pausedDays.has(d) ? [] : weekMeals.filter((m) => m.logicalDay === d);
    return {
      day: d,
      status: statusOf.get(d) ?? null,
      meals,
      eatenKcal: Math.round(meals.reduce((sum, m) => sum + mealMacros(m).kcal, 0)),
      workoutKcal: 0,
    };
  });
  const gridOpts = {
    baselines: summary.baselines,
    tz: settings.tz,
    rolloverHour: settings.rolloverHour,
    maxWindowHours: rules.maxWindowHours ?? DEFAULT_MAX_WINDOW_HOURS,
  };
  const grid = timingGrid(days, gridOpts);
  const finished = timingGrid(days.filter((d) => compareDays(d.day, today) < 0), gridOpts);

  return {
    day,
    today,
    isToday: day === today,
    tz: settings.tz,
    rolloverHour: settings.rolloverHour,
    earliest: profile.startedOn,
    completeDays,
    earlyRead: completeDays < TIMING_SOLID_DAYS,
    paused: summary.goal?.paused === true,
    summary,
    rules,
    metrics,
    usualSleepLogicalMin: usualSleep,
    week: { weekStart, rows: grid.rows, averageWindowHours: finished.averageWindowHours ?? grid.averageWindowHours },
  };
}

/** S35, re-read when the data changes or the day rolls over. Undefined while loading (and without a profile). */
export function useTimingDetail(day: LogicalDay): TimingDetailView | undefined {
  const today = useToday();
  return useLiveQuery(() => getTimingDetailIn(appDb, day, { today }), [day, today]);
}
