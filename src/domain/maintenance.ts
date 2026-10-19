/**
 * Adaptive maintenance (plan §6.4, §8.3).
 *
 * maintenance without workouts ≈ avg eaten − avg workout kcal + trend kg lost per day × 7,700,
 * from complete days only. Using the trend (never single readings) keeps water-weight jumps out.
 * The target never changes automatically: targetSuggestion only proposes a new version.
 */
import { addDays, compareDays, daysBetween } from './day';
import { roundTo10 } from './format';
import { KCAL_PER_KG, dailyTargetFor } from './targets';
import type { DayStatusKind, Goal, LogicalDay } from './types';

export const MAINTENANCE_WINDOW_DAYS = 28;
export const MIN_COMPLETE_DAYS = 21;
/** Changes of this size or less aren't worth a suggestion card. */
export const SUGGESTION_THRESHOLD_KCAL = 100;
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
