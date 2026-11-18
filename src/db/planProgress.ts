/**
 * Read model and hook for "Your plan" (Insights › Your plan). Reads go through the repositories
 * and the shared goal timeline; the sums are `planProgress` (src/domain/plan). Reading never
 * writes: nothing here changes a target or a goal.
 *
 * The plan starts on the first day of the goal period in force (or the day the app was first
 * used, if that is later), so a goal switch starts a fresh read and the older goal's days stay out.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { db as appDb, type KiraMakanDb } from '@/db/db';
import { useToday } from '@/db/hooks';
import {
  listBonusesInRange,
  listDayRecordsInRange,
  listGoalPeriods,
  listGoals,
  listMealsInRange,
  listWeights,
  listWorkoutsInRange,
} from '@/db/repo';
import { goalTimelineOf, loadSettings, todayFor } from '@/db/selectors';
import { addDays, compareDays } from '@/domain/day';
import { mealMacros } from '@/domain/meal';
import { planProgress, type PlanDay, type PlanProgress } from '@/domain/plan';
import { paceOf } from '@/domain/targets';
import { weightTrend } from '@/domain/trend';
import type { Goal, GoalVersion, LogicalDay } from '@/domain/types';

export interface PlanView {
  today: LogicalDay;
  /** The goal in force today. */
  goal: Goal;
  /** Its targets in force today. */
  version: GoalVersion;
  /** The first day the plan reads from. */
  start: LogicalDay;
  /** A Pause has no budget and no pace to read against. */
  paused: boolean;
  /** The plan's pace today (positive = losing). */
  paceKgPerWeek: number;
  progress: PlanProgress;
}

interface ReadOptions {
  /** The current logical day; the clock in the profile's zone by default. */
  today?: LogicalDay;
}

function sumByDay<T extends { logicalDay: LogicalDay }>(rows: readonly T[], value: (row: T) => number): Map<LogicalDay, number> {
  const totals = new Map<LogicalDay, number>();
  for (const row of rows) totals.set(row.logicalDay, (totals.get(row.logicalDay) ?? 0) + value(row));
  return totals;
}

/** The plan as of `today`. Undefined without a profile or a goal in force. */
export async function getPlanView(db: KiraMakanDb, opts: ReadOptions = {}): Promise<PlanView | undefined> {
  const settings = await loadSettings(db);
  const profile = settings.profile;
  if (!profile) return undefined;
  const today = opts.today ?? todayFor(profile);

  const [goals, periods, versions] = await Promise.all([listGoals(db), listGoalPeriods(db), db.goalVersions.toArray()]);
  const timeline = goalTimelineOf(goals, periods, versions);
  const active = timeline(today);
  if (!active) return undefined;

  // The goal period in force, but never before the app was in use.
  const start = compareDays(active.period.from, profile.startedOn) < 0 ? profile.startedOn : active.period.from;
  const last = addDays(today, -1);
  const finished = compareDays(start, last) <= 0;
  const [meals, workouts, bonuses, records, weights] = await Promise.all([
    finished ? listMealsInRange(db, start, last) : [],
    finished ? listWorkoutsInRange(db, start, last) : [],
    finished ? listBonusesInRange(db, start, last) : [],
    finished ? listDayRecordsInRange(db, start, last) : [],
    listWeights(db),
  ]);
  const eaten = sumByDay(meals, (m) => mealMacros(m).kcal);
  const burned = sumByDay(workouts, (w) => w.netKcal);
  const extra = sumByDay(bonuses, (b) => b.kcal);
  const status = new Map(records.map((r) => [r.logicalDay, r.status]));

  const days: PlanDay[] = [];
  for (let day = start; finished && compareDays(day, last) <= 0; day = addDays(day, 1)) {
    const on = timeline(day);
    days.push({
      day,
      targetKcal: on && !on.paused ? on.version.dailyKcal : null,
      eatenKcal: Math.round(eaten.get(day) ?? 0),
      workoutKcal: burned.get(day) ?? 0,
      bonusKcal: extra.get(day) ?? 0,
      status: status.get(day) ?? null,
      paceKgPerWeek: on ? paceOf(on.goal, on.version) : 0,
      maintenanceKcal: on?.version.maintenanceKcal ?? active.version.maintenanceKcal,
    });
  }

  const paceKgPerWeek = paceOf(active.goal, active.version);
  const progress = planProgress({
    today,
    start,
    paceKgPerWeek,
    fallbackStartKg: profile.weightKgAtSetup,
    goal: active.goal,
    days,
    trend: weightTrend(weights),
  });
  return { today, goal: active.goal, version: active.version, start, paused: active.paused, paceKgPerWeek, progress };
}

/** Insights › Your plan, and its card: re-read when the data changes or the day rolls over. */
export function usePlanView(): PlanView | undefined {
  const today = useToday();
  return useLiveQuery(() => getPlanView(appDb, { today }), [today]);
}
