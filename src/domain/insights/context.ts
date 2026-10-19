/**
 * Builds the context the insight rules read from plain rows (Dexie or the demo world), so the
 * engine stays pure and testable without a database.
 */
import type { WeekBudget } from '@/domain/budget';
import { DEFAULT_ROLLOVER_HOUR, DEFAULT_TZ, addDays, compareDays, daysBetween, weekStartOf, zonedParts } from '@/domain/day';
import { mealMacros } from '@/domain/meal';
import { slotBaselines } from '@/domain/timing';
import { weightTrend } from '@/domain/trend';
import type { DayRecord, Goal, GoalVersion, Instant, LogicalDay, MealLog, Place, Profile, WeightLog, Workout } from '@/domain/types';
import type { InsightContext, InsightDay, InsightPeriod } from './types';

/** Timing and maintenance look back this far (plan §11, §8.3). */
export const HISTORY_DAYS = 28;
/** Last week is reviewed once it has at least this many days in use; else the last 7 days are. */
const MIN_WEEK_DAYS_IN_USE = 4;
/** The weekly review appears from this hour on Sunday (plan §13.5 "Sunday night"). */
export const SUNDAY_NIGHT_HOUR = 18;
const SUNDAY = 6;

/** Day of use: 1 on the first day ("day 19"). */
export function dayNumberOf(startedOn: LogicalDay, today: LogicalDay): number {
  return Math.max(1, daysBetween(startedOn, today) + 1);
}

/** Budget weeks since the first one ("Week 3"). */
export function weekNumberOf(startedOn: LogicalDay, today: LogicalDay): number {
  return Math.max(1, Math.floor(daysBetween(weekStartOf(startedOn), weekStartOf(today)) / 7) + 1);
}

/** Sunday evening of the logical day (an after-midnight moment before the rollover still counts). */
export function isSundayNight(today: LogicalDay, at: Date | Instant, tz: string = DEFAULT_TZ, rolloverHour = DEFAULT_ROLLOVER_HOUR): boolean {
  if (daysBetween(weekStartOf(today), today) !== SUNDAY) return false;
  const hour = zonedParts(at, tz).hour;
  return hour >= SUNDAY_NIGHT_HOUR || hour < rolloverHour;
}

/** The week the weekly review is about: this week from Sunday night, else last week. */
export function reviewWeekStart(today: LogicalDay, at: Date | Instant, tz?: string, rolloverHour?: number): LogicalDay {
  const thisWeek = weekStartOf(today);
  return isSundayNight(today, at, tz, rolloverHour) ? thisWeek : addDays(thisWeek, -7);
}

function laterOf(a: LogicalDay, b: LogicalDay): LogicalDay {
  return compareDays(a, b) >= 0 ? a : b;
}

function earlierOf(a: LogicalDay, b: LogicalDay): LogicalDay {
  return compareDays(a, b) <= 0 ? a : b;
}

/**
 * The days the Insights tab describes: everything so far on days 1–6, else the review week
 * (last week, or this week from Sunday night) when enough of it was in use, else the last 7 days.
 */
export function insightPeriodFor(today: LogicalDay, startedOn: LogicalDay, reviewWeek: LogicalDay): InsightPeriod {
  if (dayNumberOf(startedOn, today) < 7) return { from: startedOn, to: today, kind: 'soFar' };
  const weekEnd = earlierOf(addDays(reviewWeek, 6), today);
  const inUse = daysBetween(laterOf(reviewWeek, startedOn), weekEnd) + 1;
  if (inUse >= MIN_WEEK_DAYS_IN_USE) return { from: reviewWeek, to: weekEnd, kind: 'week' };
  return { from: laterOf(startedOn, addDays(today, -7)), to: addDays(today, -1), kind: 'last7' };
}

/** The period for a given budget week (weekly review of any week). */
export function weekPeriod(weekStart: LogicalDay, today: LogicalDay): InsightPeriod {
  return { from: weekStart, to: earlierOf(addDays(weekStart, 6), today), kind: 'week' };
}

export interface InsightSource {
  today: LogicalDay;
  profile: Pick<Profile, 'startedOn'> & Partial<Pick<Profile, 'timeZone' | 'rolloverHour'>>;
  period: InsightPeriod;
  /** Should cover the period and the 28 days before today. */
  meals: MealLog[];
  records: DayRecord[];
  workouts: Workout[];
  weights: WeightLog[];
  places: Place[];
  goal?: Goal;
  version?: GoalVersion;
  budget?: WeekBudget;
}

function dayRange(from: LogicalDay, to: LogicalDay): LogicalDay[] {
  const days: LogicalDay[] = [];
  for (let day = from; compareDays(day, to) <= 0; day = addDays(day, 1)) days.push(day);
  return days;
}

export function buildInsightContext(src: InsightSource): InsightContext {
  const tz = src.profile.timeZone ?? DEFAULT_TZ;
  const rolloverHour = src.profile.rolloverHour ?? DEFAULT_ROLLOVER_HOUR;
  const { today, period } = src;
  const startedOn = src.profile.startedOn;

  const mealsByDay = new Map<LogicalDay, MealLog[]>();
  for (const meal of [...src.meals].sort((a, b) => Date.parse(a.eatenAt) - Date.parse(b.eatenAt))) {
    const list = mealsByDay.get(meal.logicalDay) ?? [];
    list.push(meal);
    mealsByDay.set(meal.logicalDay, list);
  }
  const recordByDay = new Map(src.records.map((r) => [r.logicalDay, r]));
  const workoutKcal = new Map<LogicalDay, number>();
  for (const w of src.workouts) workoutKcal.set(w.logicalDay, (workoutKcal.get(w.logicalDay) ?? 0) + w.netKcal);

  const toDay = (day: LogicalDay): InsightDay => {
    const meals = mealsByDay.get(day) ?? [];
    const record = recordByDay.get(day);
    const insightDay: InsightDay = {
      day,
      status: record?.status ?? null,
      meals,
      eatenKcal: Math.round(meals.reduce((sum, m) => sum + mealMacros(m).kcal, 0)),
      workoutKcal: workoutKcal.get(day) ?? 0,
    };
    if (record?.sleepAt) insightDay.sleepAt = record.sleepAt;
    return insightDay;
  };

  const inUse = (day: LogicalDay): boolean => compareDays(day, startedOn) >= 0;
  const periodDays = dayRange(period.from, period.to).filter(inUse).map(toDay);
  const historyDays = dayRange(addDays(today, -HISTORY_DAYS), addDays(today, -1)).filter(inUse).map(toDay);

  const completeDays = src.records.filter(
    (r) => r.status === 'complete' && inUse(r.logicalDay) && compareDays(r.logicalDay, today) < 0,
  ).length;
  const completeHistory = historyDays.filter((d) => d.status === 'complete').flatMap((d) => d.meals.filter((m) => !m.isGuess));

  const ctx: InsightContext = {
    today,
    tz,
    rolloverHour,
    startedOn,
    dayNumber: dayNumberOf(startedOn, today),
    completeDays,
    period,
    periodDays,
    historyDays,
    places: src.places,
    trend: weightTrend(src.weights),
    baselines: slotBaselines(completeHistory, tz, rolloverHour),
  };
  if (src.goal) ctx.goal = src.goal;
  if (src.version) ctx.version = src.version;
  if (src.budget) ctx.budget = src.budget;
  return ctx;
}
