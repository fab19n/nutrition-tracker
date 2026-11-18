/**
 * Plan progress (Insights › Your plan): where you stand against the goal you picked. Pure: the
 * database layer (src/db/planProgress.ts) gathers the days, and this module does the sums.
 *
 * Four reads, each from data the app already keeps:
 * - weight: your weight trend since the plan began, against the straight line the plan's pace draws;
 * - energy: how many kcal you finished under or over each day's budget (target + workouts + bonus);
 * - workouts: what they added to those budgets, and how the picture reads without them;
 * - check: the deficit your logs imply against the deficit your weight trend implies.
 *
 * Kcal and kg are tied by KCAL_PER_KG (7,700), as everywhere else. Nothing here changes a target;
 * it only reads. Wording elsewhere stays neutral: a reading is not a verdict.
 */
import { addDays, compareDays, daysBetween, weekStartOf } from './day';
import { trendSlopePerDay } from './maintenance';
import { KCAL_PER_KG } from './targets';
import { trendOn, type TrendPoint } from './trend';
import type { DayStatusKind, Goal, LogicalDay } from './types';

/** Days of trend (and weigh-ins) before the weight line is called ahead or behind. */
export const PLAN_MIN_TREND_DAYS = 14;
export const PLAN_MIN_WEIGH_INS = 3;
/** The trend wobbles this much by itself, so closer than this to the plan is "on track". */
export const PLAN_TOLERANCE_KG = 0.3;
/** Complete days the logs-against-weight check needs, and when it stops being an early read. */
export const CHECK_MIN_DAYS = 14;
export const CHECK_FULL_DAYS = 21;
export const CHECK_WINDOW_DAYS = 28;
/** A gap smaller than this between logs and weight counts as agreement. */
export const CHECK_AGREE_KCAL = 150;
/** Weeks listed in the week-by-week table. */
export const PLAN_WEEKS_SHOWN = 8;
/** A projection needs the trend to be moving the right way by at least this much a week. */
const MIN_PROJECTION_KG_PER_WEEK = 0.05;

/** One logical day from the plan's start to yesterday, as the plan reads it. */
export interface PlanDay {
  day: LogicalDay;
  /** null = paused: no budget that day. */
  targetKcal: number | null;
  eatenKcal: number;
  workoutKcal: number;
  bonusKcal: number;
  status: DayStatusKind | null;
  /** kg a week the plan was set at that day (positive = losing). */
  paceKgPerWeek: number;
  /** The maintenance the target assumed that day. */
  maintenanceKcal: number;
}

export interface PlanInput {
  today: LogicalDay;
  /** The first day of the goal period in force. */
  start: LogicalDay;
  /** The plan's pace today (positive = losing), used for any day `days` doesn't cover. */
  paceKgPerWeek: number;
  /** The weight to start from when no weigh-in sits at or before the start day. */
  fallbackStartKg?: number;
  goal: Pick<Goal, 'endCondition'>;
  /** From `start` to yesterday, oldest first. */
  days: PlanDay[];
  /** The whole weight trend, oldest first. */
  trend: TrendPoint[];
}

// ---------------------------------------------------------------------------
// Weight
// ---------------------------------------------------------------------------

export type PlanVerdict = 'noData' | 'early' | 'ahead' | 'onTrack' | 'behind' | 'drifting';

export interface PlanPoint {
  day: LogicalDay;
  kg: number;
}

export interface PlanGoalEnd {
  targetKg: number;
  /** 0 once reached. */
  kgToGo: number;
  reached: boolean;
  /** When the plan's own pace would get there. */
  atPlanPace?: LogicalDay;
  /** When your trend of the last weeks would; missing while it isn't moving that way. */
  atCurrentPace?: LogicalDay;
}

export interface PlanWeight {
  verdict: PlanVerdict;
  /** The plan's pace today (positive = losing). */
  paceKgPerWeek: number;
  startKg?: number;
  nowKg?: number;
  /** Trend now minus trend at the start (negative = lost). */
  changeKg?: number;
  /** What the plan's pace expects for the same stretch. */
  expectedChangeKg?: number;
  /** How far the trend sits behind the plan, in the plan's direction (negative = ahead). */
  behindKg?: number;
  /** Your trend over the last 28 days in the plan's convention (positive = losing). */
  actualPaceKgPerWeek?: number;
  weighInDays: number;
  trendDays: number;
  /** Trend from the start, the first point being the starting weight. */
  actual: PlanPoint[];
  /** The straight line the plan's pace draws over the same days. */
  plan: PlanPoint[];
  end?: PlanGoalEnd;
}

/** Whole days to cover `kg` at `kgPerWeek`; the nudge keeps 4 kg at 0.25 a week at exactly 112 days, not 113. */
function daysToGo(kg: number, kgPerWeek: number): number {
  return Math.ceil((kg / kgPerWeek) * 7 - 1e-6);
}

function paceLookup(input: PlanInput): (day: LogicalDay) => number {
  const byDay = new Map(input.days.map((d) => [d.day, d.paceKgPerWeek]));
  return (day) => byDay.get(day) ?? input.paceKgPerWeek;
}

function planWeight(input: PlanInput, paceOn: (day: LogicalDay) => number): PlanWeight {
  const { today, start, trend } = input;
  const paceNow = paceOn(today);
  const since = trend.filter((p) => compareDays(p.day, start) >= 0 && compareDays(p.day, today) <= 0);
  const anchor = trendOn(trend, start);
  const startKg = anchor?.trendKg ?? since[0]?.trendKg ?? input.fallbackStartKg;
  const latest = since.at(-1);
  const empty: PlanWeight = { verdict: 'noData', paceKgPerWeek: paceNow, weighInDays: since.length, trendDays: 0, actual: [], plan: [] };
  if (startKg === undefined || !latest) return empty;

  const trendDays = daysBetween(start, latest.day);
  // The line the plan draws: each day's pace spread over its seven days.
  const planned: PlanPoint[] = [{ day: start, kg: startKg }];
  let cumulative = 0;
  for (let i = 0; i < trendDays; i++) {
    cumulative += paceOn(addDays(start, i)) / 7;
    planned.push({ day: addDays(start, i + 1), kg: startKg - cumulative });
  }
  const plan = planned.filter((_, i) => i % 7 === 0 || i === planned.length - 1);
  const expectedChangeKg = -cumulative;
  const changeKg = latest.trendKg - startKg;
  const actual: PlanPoint[] = [{ day: start, kg: startKg }, ...since.filter((p) => p.day !== start).map((p) => ({ day: p.day, kg: p.trendKg }))];

  const direction = paceNow > 0 ? 1 : paceNow < 0 ? -1 : 0;
  const deviation = changeKg - expectedChangeKg;
  const behindKg = direction === 0 ? Math.abs(deviation) : direction * deviation;
  const tolerance = Math.max(PLAN_TOLERANCE_KG, 0.15 * Math.abs(expectedChangeKg));
  let verdict: PlanVerdict;
  if (trendDays < PLAN_MIN_TREND_DAYS || since.length < PLAN_MIN_WEIGH_INS) verdict = 'early';
  else if (direction === 0) verdict = behindKg > tolerance ? 'drifting' : 'onTrack';
  else verdict = behindKg > tolerance ? 'behind' : behindKg < -tolerance ? 'ahead' : 'onTrack';

  const windowStart = addDays(latest.day, -(CHECK_WINDOW_DAYS - 1));
  const windowPoints = since.filter((p) => compareDays(p.day, windowStart) >= 0);
  const slope = trendSlopePerDay(windowPoints, windowPoints[0]?.day ?? windowStart);
  const actualPaceKgPerWeek = slope === null ? undefined : -slope * 7;

  const weight: PlanWeight = { verdict, paceKgPerWeek: paceNow, startKg, nowKg: latest.trendKg, changeKg, expectedChangeKg, behindKg, weighInDays: since.length, trendDays, actual, plan };
  if (actualPaceKgPerWeek !== undefined) weight.actualPaceKgPerWeek = actualPaceKgPerWeek;

  const targetKg = input.goal.endCondition?.weightKg;
  if (targetKg !== undefined && direction !== 0) {
    const kgToGo = direction === 1 ? latest.trendKg - targetKg : targetKg - latest.trendKg;
    const end: PlanGoalEnd = { targetKg, kgToGo: Math.max(0, kgToGo), reached: kgToGo <= 0 };
    if (!end.reached) {
      end.atPlanPace = addDays(today, daysToGo(kgToGo, Math.abs(paceNow)));
      const toward = actualPaceKgPerWeek === undefined ? 0 : direction * actualPaceKgPerWeek;
      if (toward >= MIN_PROJECTION_KG_PER_WEEK) end.atCurrentPace = addDays(today, daysToGo(kgToGo, toward));
    }
    weight.end = end;
  }
  return weight;
}

// ---------------------------------------------------------------------------
// Energy and workouts
// ---------------------------------------------------------------------------

export interface PlanWeekRow {
  weekStart: LogicalDay;
  countedDays: number;
  budgetKcal: number;
  eatenKcal: number;
  workoutKcal: number;
  /** Positive = finished under budget. */
  underKcal: number;
}

export interface PlanEnergy {
  /** Finished days that count: complete or guess, and not paused. */
  countedDays: number;
  withinBudgetDays: number;
  budgetKcal: number;
  eatenKcal: number;
  /** Positive = under budget over all counted days. */
  underKcal: number;
  /** underKcal as kilograms (÷ 7,700). */
  underKg: number;
  /** Newest first. */
  weeks: PlanWeekRow[];
}

export interface PlanWorkouts {
  /** Net kcal workouts added to the counted days' budgets. */
  addedKcal: number;
  /** Counted days with a workout. */
  days: number;
  /** addedKcal over seven counted days. */
  perWeekKcal: number;
  /** addedKcal as a share of all the budgets (0–1). */
  shareOfBudget: number;
  /** How far under budget, with the workouts counted (the same as energy.underKcal). */
  underWithKcal: number;
  /** How far under budget the same days read with no workouts counted. */
  underWithoutKcal: number;
}

function counted(days: readonly PlanDay[]): (PlanDay & { targetKcal: number })[] {
  return days.filter((d): d is PlanDay & { targetKcal: number } => d.targetKcal !== null && (d.status === 'complete' || d.status === 'guess'));
}

function planEnergy(days: readonly PlanDay[]): { energy: PlanEnergy; workouts: PlanWorkouts } {
  const rows = counted(days);
  let budget = 0;
  let eaten = 0;
  let workout = 0;
  let withoutBudget = 0;
  let within = 0;
  let workoutDays = 0;
  const weeks = new Map<LogicalDay, PlanWeekRow>();
  for (const d of rows) {
    const dayBudget = d.targetKcal + d.workoutKcal + d.bonusKcal;
    budget += dayBudget;
    eaten += d.eatenKcal;
    workout += d.workoutKcal;
    withoutBudget += d.targetKcal + d.bonusKcal;
    if (d.eatenKcal <= dayBudget) within += 1;
    if (d.workoutKcal > 0) workoutDays += 1;
    const weekStart = weekStartOf(d.day);
    const week = weeks.get(weekStart) ?? { weekStart, countedDays: 0, budgetKcal: 0, eatenKcal: 0, workoutKcal: 0, underKcal: 0 };
    week.countedDays += 1;
    week.budgetKcal += dayBudget;
    week.eatenKcal += d.eatenKcal;
    week.workoutKcal += d.workoutKcal;
    week.underKcal += dayBudget - d.eatenKcal;
    weeks.set(weekStart, week);
  }
  const under = budget - eaten;
  const energy: PlanEnergy = {
    countedDays: rows.length,
    withinBudgetDays: within,
    budgetKcal: budget,
    eatenKcal: eaten,
    underKcal: under,
    underKg: under / KCAL_PER_KG,
    weeks: [...weeks.values()].sort((a, b) => compareDays(b.weekStart, a.weekStart)).slice(0, PLAN_WEEKS_SHOWN),
  };
  const workouts: PlanWorkouts = {
    addedKcal: workout,
    days: workoutDays,
    perWeekKcal: rows.length === 0 ? 0 : (workout / rows.length) * 7,
    shareOfBudget: budget > 0 ? workout / budget : 0,
    underWithKcal: under,
    underWithoutKcal: withoutBudget - eaten,
  };
  return { energy, workouts };
}

// ---------------------------------------------------------------------------
// Logs against weight
// ---------------------------------------------------------------------------

export type PlanCheckState = 'locked' | 'early' | 'ready';
/** agree: close · logsAhead: the logs show a bigger deficit than your weight does · weightAhead: the other way. */
export type PlanCheckRead = 'agree' | 'logsAhead' | 'weightAhead';

export interface PlanCheck {
  state: PlanCheckState;
  /** Complete days in the window (the check reads complete days only, like the target check). */
  completeDays: number;
  needDays: number;
  fullDays: number;
  /** Days the window covers. */
  windowDays?: number;
  /** What the logs imply a day: maintenance + workouts − eaten, averaged. */
  loggedDeficitKcal?: number;
  /** What the weight trend implies a day: the slope × 7,700. */
  weightDeficitKcal?: number;
  /** loggedDeficitKcal − weightDeficitKcal. */
  gapKcal?: number;
  /** Workouts' average a day inside loggedDeficitKcal. */
  workoutKcalPerDay?: number;
  /** The gap if only half of each workout had counted. */
  gapHalfWorkoutsKcal?: number;
  read?: PlanCheckRead;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function planCheck(input: PlanInput): PlanCheck {
  const end = addDays(input.today, -1);
  const from = addDays(end, -(CHECK_WINDOW_DAYS - 1));
  const windowStart = compareDays(from, input.start) < 0 ? input.start : from;
  const inWindow = (day: LogicalDay): boolean => compareDays(day, windowStart) >= 0 && compareDays(day, end) <= 0;
  const complete = input.days.filter((d) => d.status === 'complete' && d.targetKcal !== null && inWindow(d.day));
  const base: PlanCheck = { state: 'locked', completeDays: complete.length, needDays: CHECK_MIN_DAYS, fullDays: CHECK_FULL_DAYS };
  if (complete.length < CHECK_MIN_DAYS) return base;
  const slope = trendSlopePerDay(
    input.trend.filter((p) => inWindow(p.day)),
    windowStart,
  );
  if (slope === null) return base;

  const logged = mean(complete.map((d) => d.maintenanceKcal + d.workoutKcal - d.eatenKcal));
  const workoutPerDay = mean(complete.map((d) => d.workoutKcal));
  const weightDeficit = -slope * KCAL_PER_KG;
  const gap = logged - weightDeficit;
  const read: PlanCheckRead = Math.abs(gap) < CHECK_AGREE_KCAL ? 'agree' : gap > 0 ? 'logsAhead' : 'weightAhead';
  return {
    ...base,
    state: complete.length >= CHECK_FULL_DAYS ? 'ready' : 'early',
    windowDays: daysBetween(windowStart, end) + 1,
    loggedDeficitKcal: logged,
    weightDeficitKcal: weightDeficit,
    gapKcal: gap,
    workoutKcalPerDay: workoutPerDay,
    gapHalfWorkoutsKcal: gap - workoutPerDay / 2,
    read,
  };
}

// ---------------------------------------------------------------------------
// Everything
// ---------------------------------------------------------------------------

export interface PlanProgress {
  start: LogicalDay;
  today: LogicalDay;
  /** Days since the plan began. */
  daysIn: number;
  weight: PlanWeight;
  energy: PlanEnergy;
  workouts: PlanWorkouts;
  check: PlanCheck;
}

export function planProgress(input: PlanInput): PlanProgress {
  const { energy, workouts } = planEnergy(input.days);
  return {
    start: input.start,
    today: input.today,
    daysIn: Math.max(0, daysBetween(input.start, input.today)),
    weight: planWeight(input, paceLookup(input)),
    energy,
    workouts,
    check: planCheck(input),
  };
}
