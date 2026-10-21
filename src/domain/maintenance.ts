/**
 * Adaptive maintenance (plan §6.4, §8.3).
 *
 * maintenance without workouts ≈ avg eaten − avg workout kcal + trend kg lost per day × 7,700,
 * from complete days only. Using the trend (never single readings) keeps water-weight jumps out,
 * once it has settled after its first reading (TREND_SETTLE_DAYS). It is read weekly, from day 21
 * at the earliest (checkTarget); the target never changes automatically: targetSuggestion only
 * proposes a new version, and the user approves it (S37).
 */
import { addDays, compareDays, daysBetween, weekStartOf } from './day';
import { fmtInt, fmtKgRate, roundTo10 } from './format';
import { KCAL_PER_KG, dailyTargetFor, paceOf } from './targets';
import type { TrendPoint } from './trend';
import type { DayStatusKind, Goal, GoalTemplate, GoalVersion, Id, LogicalDay } from './types';

export const MAINTENANCE_WINDOW_DAYS = 28;
export const MIN_COMPLETE_DAYS = 21;
/** Changes of this size or less aren't worth a suggestion card. */
export const SUGGESTION_THRESHOLD_KCAL = 100;
/** Weigh-in days the window needs (about two a week)… */
export const MIN_WEIGH_INS = 8;
/** …from first to last at least this far apart, so the trend shows a direction. */
export const MIN_WEIGH_IN_SPAN_DAYS = 14;
/** Keep current hides the suggestion this long (same as "Not for me"). */
export const KEEP_CURRENT_DAYS = 28;
/**
 * The trend starts from its first reading: the first weigh-in (often the setup weight, typed in
 * the evening or rounded), or the first after a gap this long (the readings before it then weigh
 * under 6%). That one reading pulls on the trend for days, and a 0.5 kg gap alone would move
 * maintenance by ~115 kcal, so the slope leaves out the first days of each run: by day 10 the
 * first reading is down to 0.75^10 ≈ 6% of the trend.
 */
export const TREND_SETTLE_DAYS = 10;
/** The trend must cover at least this many days to give a usable slope. */
const MIN_TREND_SPAN_DAYS = 7;
/** Pace choices offered in setup and the goal editor (kg/week). */
const PACE_STEPS = [0.25, 0.5, 0.75];

export interface AdaptiveMaintenance {
  maintenanceKcal: number;
  avgEatenKcal: number;
  avgWorkoutKcal: number;
  /** Negative = losing. */
  trendKgPerWeek: number;
  daysUsed: number;
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Least-squares slope of the trend in kg/day, or null without enough spread in days. */
function trendSlopePerDay(points: { day: LogicalDay; trendKg: number }[], start: LogicalDay): number | null {
  if (points.length < 2) return null;
  const xs = points.map((p) => daysBetween(start, p.day));
  const span = Math.max(...xs) - Math.min(...xs);
  if (span < MIN_TREND_SPAN_DAYS) return null;
  const mx = mean(xs);
  const my = mean(points.map((p) => p.trendKg));
  let sxy = 0;
  let sxx = 0;
  points.forEach((p, i) => {
    const dx = (xs[i] ?? 0) - mx;
    sxy += dx * (p.trendKg - my);
    sxx += dx * dx;
  });
  return sxx === 0 ? null : sxy / sxx;
}

export function adaptiveMaintenance(input: {
  days: { day: LogicalDay; eatenKcal: number; workoutKcal: number; status: DayStatusKind | null }[];
  trend: { day: LogicalDay; trendKg: number }[];
  /** Default 21. The window is the last 28 days of `days`. */
  minCompleteDays?: number;
}): AdaptiveMaintenance | null {
  const minComplete = input.minCompleteDays ?? MIN_COMPLETE_DAYS;
  const end = input.days.reduce<LogicalDay | undefined>(
    (latest, d) => (latest === undefined || compareDays(d.day, latest) > 0 ? d.day : latest),
    undefined,
  );
  if (end === undefined) return null;
  const start = addDays(end, -(MAINTENANCE_WINDOW_DAYS - 1));
  const inWindow = (day: LogicalDay): boolean => compareDays(day, start) >= 0 && compareDays(day, end) <= 0;

  const complete = input.days.filter((d) => d.status === 'complete' && inWindow(d.day));
  if (complete.length === 0 || complete.length < minComplete) return null;

  const slope = trendSlopePerDay(
    input.trend.filter((p) => inWindow(p.day)),
    start,
  );
  if (slope === null) return null;

  const avgEaten = mean(complete.map((d) => d.eatenKcal));
  const avgWorkout = mean(complete.map((d) => d.workoutKcal));
  return {
    maintenanceKcal: roundTo10(avgEaten - avgWorkout - slope * KCAL_PER_KG),
    avgEatenKcal: Math.round(avgEaten),
    avgWorkoutKcal: Math.round(avgWorkout),
    trendKgPerWeek: slope * 7,
    daysUsed: complete.length,
  };
}

function slowerPaceThan(pace: number): number | undefined {
  return [...PACE_STEPS].reverse().find((step) => step < pace - 1e-9);
}

/**
 * A new target when adaptive maintenance moved by more than 100 kcal a day; null otherwise.
 * When a cut's target would drop, a slower pace is offered as the alternative ("Change pace instead").
 */
export function targetSuggestion(
  current: { maintenanceKcal: number; dailyKcal: number },
  adaptive: { maintenanceKcal: number },
  goal: Pick<Goal, 'template' | 'paceKgPerWeek' | 'surplusKcal'>,
  dailyMinimumKcal: number,
): { suggestedDailyKcal: number; newMaintenanceKcal: number; altSlowerPace?: { paceKgPerWeek: number; dailyKcal: number } } | null {
  if (Math.abs(adaptive.maintenanceKcal - current.maintenanceKcal) <= SUGGESTION_THRESHOLD_KCAL) return null;

  const suggestedDailyKcal = dailyTargetFor(goal, adaptive.maintenanceKcal, dailyMinimumKcal);
  const suggestion: {
    suggestedDailyKcal: number;
    newMaintenanceKcal: number;
    altSlowerPace?: { paceKgPerWeek: number; dailyKcal: number };
  } = { suggestedDailyKcal, newMaintenanceKcal: adaptive.maintenanceKcal };

  if (goal.template === 'cut' && suggestedDailyKcal < current.dailyKcal) {
    const slower = slowerPaceThan(goal.paceKgPerWeek);
    if (slower !== undefined) {
      suggestion.altSlowerPace = {
        paceKgPerWeek: slower,
        dailyKcal: dailyTargetFor({ ...goal, paceKgPerWeek: slower }, adaptive.maintenanceKcal, dailyMinimumKcal),
      };
    }
  }
  return suggestion;
}

// ---------------------------------------------------------------------------
// The weekly target check (S37, C45, the Today notice)
// ---------------------------------------------------------------------------

/** One logical day as the check reads it. */
export interface MaintenanceDay {
  day: LogicalDay;
  eatenKcal: number;
  workoutKcal: number;
  /** null = no record (or a day before the app was in use). */
  status: DayStatusKind | null;
}

export interface MaintenanceWindow {
  from: LogicalDay;
  to: LogicalDay;
}

export interface MaintenanceEstimate extends AdaptiveMaintenance {
  window: MaintenanceWindow;
  /** 'weekly': the 28 days to last Sunday (fixed all week). 'daily': the 28 days to yesterday, only while the weekly read isn't possible. */
  basis: 'weekly' | 'daily';
  /** Next Monday, when the weekly read moves on. */
  nextCheckOn: LogicalDay;
}

/** The goal's newest version (a pending one included), as the check sees it. */
export interface CurrentTarget {
  goalId: Id;
  template: GoalTemplate;
  versionId: Id;
  maintenanceKcal: number;
  dailyKcal: number;
  paceKgPerWeek: number;
  dailyMinimumKcal: number;
  surplusKcal?: number;
}

export interface TargetOptionValues {
  paceKgPerWeek: number;
  dailyKcal: number;
  /** Before the daily minimum. */
  rawDailyKcal: number;
  /** The daily minimum holds the target up. */
  atMinimum: boolean;
}

export interface TargetProposal {
  newMaintenanceKcal: number;
  suggested: TargetOptionValues;
  /** Cut only, when the target would drop and a slower pace step exists. */
  slowerPace?: TargetOptionValues;
  /** `${versionId}:${weekStart}`: the in-app notice shows once per key (a later push can reuse it). */
  noticeKey: string;
}

/** A "Keep current" answer, as the check reads it. */
export interface KeptTarget {
  keptOn: LogicalDay;
  /** The suggestion comes back on this day. */
  until: LogicalDay;
  maintenanceKcal: number;
  versionId: Id;
}

export type TargetCheck =
  | { kind: 'noTarget'; reason: 'noGoal' | 'paused' | 'switching' }
  | { kind: 'tooEarly'; current: CurrentTarget; completeDays: number; needDays: number; window: MaintenanceWindow }
  | {
      kind: 'needWeighIns';
      current: CurrentTarget;
      /** Weigh-in days in the window. */
      weighIns: number;
      needWeighIns: number;
      /** First to last weigh-in in the window; or, once there are enough, days since the trend's run started (TREND_SETTLE_DAYS). */
      spanDays: number;
      needSpanDays: number;
      /** The first weigh-in in the window, or the day the trend's run started. */
      firstWeighIn?: LogicalDay;
      window: MaintenanceWindow;
    }
  | { kind: 'onTrack'; current: CurrentTarget; estimate: MaintenanceEstimate; sameTarget: boolean; atMinimum: boolean; rawDailyKcal: number }
  | { kind: 'suggestion'; current: CurrentTarget; estimate: MaintenanceEstimate; proposal: TargetProposal }
  | { kind: 'kept'; current: CurrentTarget; estimate: MaintenanceEstimate; proposal: TargetProposal; kept: KeptTarget };

type Blocked = Extract<TargetCheck, { kind: 'tooEarly' | 'needWeighIns' }>;

/** A trend point and the day its run started (TREND_SETTLE_DAYS). */
interface RunPoint {
  point: TrendPoint;
  runFrom: LogicalDay;
}

/** Every trend point, oldest first, with the day its run started. */
function trendRuns(trend: readonly TrendPoint[]): RunPoint[] {
  const runs: RunPoint[] = [];
  for (const point of [...trend].sort((a, b) => compareDays(a.day, b.day))) {
    const previous = runs.at(-1);
    const runFrom = previous && daysBetween(previous.point.day, point.day) < TREND_SETTLE_DAYS ? previous.runFrom : point.day;
    runs.push({ point, runFrom });
  }
  return runs;
}

/** Far enough into its run that the first reading no longer skews it. */
function settled(run: RunPoint): boolean {
  return daysBetween(run.runFrom, run.point.day) >= TREND_SETTLE_DAYS;
}

/** One 28-day read ending on `end`: an estimate, or why there isn't one yet. */
function readWindow(
  end: LogicalDay,
  basis: MaintenanceEstimate['basis'],
  ctx: { byDay: ReadonlyMap<LogicalDay, MaintenanceDay>; runs: readonly RunPoint[]; current: CurrentTarget; nextCheckOn: LogicalDay },
): { estimate: MaintenanceEstimate } | { blocked: Blocked } {
  const from = addDays(end, -(MAINTENANCE_WINDOW_DAYS - 1));
  const window: MaintenanceWindow = { from, to: end };
  const rows: MaintenanceDay[] = Array.from({ length: MAINTENANCE_WINDOW_DAYS }, (_, i) => {
    const day = addDays(from, i);
    const row = ctx.byDay.get(day);
    return row ? { day, eatenKcal: row.eatenKcal, workoutKcal: row.workoutKcal, status: row.status } : { day, eatenKcal: 0, workoutKcal: 0, status: null };
  });

  const completeDays = rows.filter((d) => d.status === 'complete').length;
  if (completeDays < MIN_COMPLETE_DAYS) {
    return { blocked: { kind: 'tooEarly', current: ctx.current, completeDays, needDays: MIN_COMPLETE_DAYS, window } };
  }

  const runs = ctx.runs.filter((r) => compareDays(r.point.day, from) >= 0 && compareDays(r.point.day, end) <= 0);
  const first = runs[0];
  const last = runs.at(-1);
  const spanDays = first && last ? daysBetween(first.point.day, last.point.day) : 0;
  if (!first || !last || runs.length < MIN_WEIGH_INS || spanDays < MIN_WEIGH_IN_SPAN_DAYS) {
    const blocked: Blocked = {
      kind: 'needWeighIns',
      current: ctx.current,
      weighIns: runs.length,
      needWeighIns: MIN_WEIGH_INS,
      spanDays,
      needSpanDays: MIN_WEIGH_IN_SPAN_DAYS,
      window,
    };
    if (first) blocked.firstWeighIn = first.point.day;
    return { blocked };
  }

  const steady = runs.filter(settled);
  const adaptive = adaptiveMaintenance({ days: rows, trend: steady.map((r) => r.point) });
  if (adaptive) return { estimate: { ...adaptive, window, basis, nextCheckOn: ctx.nextCheckOn } };

  // Enough weigh-ins, but the trend started (over) too recently for a slope: it needs
  // TREND_SETTLE_DAYS, then a week of settled points, counted from the day its run started.
  const steadyFirst = steady[0];
  const steadyLast = steady.at(-1);
  const steadySpan = steadyFirst && steadyLast ? daysBetween(steadyFirst.point.day, steadyLast.point.day) : 0;
  return {
    blocked: {
      kind: 'needWeighIns',
      current: ctx.current,
      weighIns: runs.length,
      needWeighIns: MIN_WEIGH_INS,
      spanDays: Math.min(daysBetween(last.runFrom, last.point.day), TREND_SETTLE_DAYS + steadySpan),
      needSpanDays: TREND_SETTLE_DAYS + MIN_TREND_SPAN_DAYS,
      firstWeighIn: last.runFrom,
      window,
    },
  };
}

/**
 * The target check as of `today` (plan §6.4, §8.3, §13.4). The estimate is read weekly from the
 * 28 days to last Sunday, so it is the same number all week and on every device; only while
 * that read isn't possible yet, the 28 days to yesterday are read instead, so the first
 * suggestion shows as soon as the data allows. It compares with the goal's newest version (a
 * pending one included) and never changes anything: it only says what a suggestion would be.
 */
export function checkTarget(input: {
  today: LogicalDay;
  /** Any order; at least the 35 days before today. Days missing are "no record". */
  days: readonly MaintenanceDay[];
  /** weightTrend() of every weigh-in. */
  trend: readonly TrendPoint[];
  /** The goal in force today. */
  goal?: Pick<Goal, 'id' | 'template' | 'paceKgPerWeek' | 'surplusKcal'>;
  /** That goal's newest version. */
  latest?: Pick<GoalVersion, 'id' | 'maintenanceKcal' | 'dailyKcal' | 'paceKgPerWeek'>;
  /** A different goal is in force tomorrow (a switch is booked). */
  switching?: boolean;
  dailyMinimumKcal: number;
  kept?: KeptTarget;
}): TargetCheck {
  const { today, goal, latest, dailyMinimumKcal } = input;
  if (!goal) return { kind: 'noTarget', reason: 'noGoal' };
  // Pause has no versions of its own, so it is told apart before the version is looked at.
  if (goal.template === 'pause') return { kind: 'noTarget', reason: 'paused' };
  if (input.switching) return { kind: 'noTarget', reason: 'switching' };
  if (!latest) return { kind: 'noTarget', reason: 'noGoal' };

  const current: CurrentTarget = {
    goalId: goal.id,
    template: goal.template,
    versionId: latest.id,
    maintenanceKcal: latest.maintenanceKcal,
    dailyKcal: latest.dailyKcal,
    paceKgPerWeek: paceOf(goal, latest),
    dailyMinimumKcal,
  };
  if (goal.surplusKcal !== undefined) current.surplusKcal = goal.surplusKcal;

  const weekStart = weekStartOf(today);
  const yesterday = addDays(today, -1);
  const weeklyEnd = addDays(weekStart, -1);
  const ctx = { byDay: new Map(input.days.map((d) => [d.day, d])), runs: trendRuns(input.trend), current, nextCheckOn: addDays(weekStart, 7) };
  let read = readWindow(weeklyEnd, 'weekly', ctx);
  if ('blocked' in read && weeklyEnd !== yesterday) read = readWindow(yesterday, 'daily', ctx);
  if ('blocked' in read) return read.blocked;
  const { estimate } = read;

  const goalAtPace: Pick<Goal, 'template' | 'paceKgPerWeek' | 'surplusKcal'> = { template: goal.template, paceKgPerWeek: current.paceKgPerWeek };
  if (current.surplusKcal !== undefined) goalAtPace.surplusKcal = current.surplusKcal;
  const rawDailyKcal = dailyTargetFor(goalAtPace, estimate.maintenanceKcal, 0);
  const delta = estimate.maintenanceKcal - current.maintenanceKcal;
  if (Math.abs(delta) <= SUGGESTION_THRESHOLD_KCAL) {
    return { kind: 'onTrack', current, estimate, sameTarget: false, atMinimum: rawDailyKcal < dailyMinimumKcal, rawDailyKcal };
  }

  const s = targetSuggestion({ maintenanceKcal: current.maintenanceKcal, dailyKcal: current.dailyKcal }, estimate, goalAtPace, dailyMinimumKcal);
  if (!s) return { kind: 'onTrack', current, estimate, sameTarget: false, atMinimum: rawDailyKcal < dailyMinimumKcal, rawDailyKcal };
  const suggested: TargetOptionValues = {
    paceKgPerWeek: current.paceKgPerWeek,
    dailyKcal: s.suggestedDailyKcal,
    rawDailyKcal,
    atMinimum: rawDailyKcal < dailyMinimumKcal,
  };
  let slowerPace: TargetOptionValues | undefined;
  if (s.altSlowerPace) {
    const raw = dailyTargetFor({ ...goalAtPace, paceKgPerWeek: s.altSlowerPace.paceKgPerWeek }, estimate.maintenanceKcal, 0);
    slowerPace = { paceKgPerWeek: s.altSlowerPace.paceKgPerWeek, dailyKcal: s.altSlowerPace.dailyKcal, rawDailyKcal: raw, atMinimum: raw < dailyMinimumKcal };
  }
  // An Approve that changes nothing visible confuses: the target stays, and S37 says why.
  if (suggested.dailyKcal === current.dailyKcal && !slowerPace) {
    return { kind: 'onTrack', current, estimate, sameTarget: true, atMinimum: suggested.atMinimum, rawDailyKcal };
  }

  const proposal: TargetProposal = { newMaintenanceKcal: estimate.maintenanceKcal, suggested, noticeKey: `${current.versionId}:${weekStart}` };
  if (slowerPace) proposal.slowerPace = slowerPace;

  // "Keep current" holds until its day, or until the estimate moves again or the target changes.
  const { kept } = input;
  if (
    kept &&
    kept.versionId === current.versionId &&
    compareDays(today, kept.until) < 0 &&
    Math.abs(estimate.maintenanceKcal - kept.maintenanceKcal) <= SUGGESTION_THRESHOLD_KCAL
  ) {
    return { kind: 'kept', current, estimate, proposal, kept };
  }
  return { kind: 'suggestion', current, estimate, proposal };
}

/** "You logged ~1,820 a day, and your trend dropped 0.25 kg a week." Shared by the card and the insight. */
export function maintenanceWorking(estimate: Pick<AdaptiveMaintenance, 'avgEatenKcal' | 'avgWorkoutKcal' | 'trendKgPerWeek'>): string {
  const workouts = roundTo10(estimate.avgWorkoutKcal);
  const rate = Math.round(estimate.trendKgPerWeek * 20) / 20;
  const trend = rate === 0 ? 'your trend held steady' : `your trend ${rate < 0 ? 'dropped' : 'rose'} ${fmtKgRate(Math.abs(rate))} a week`;
  return (
    `You logged ~${fmtInt(roundTo10(estimate.avgEatenKcal))} a day` +
    (workouts > 0 ? `, workouts added ~${fmtInt(workouts)} a day` : '') +
    `, and ${trend}.`
  );
}
