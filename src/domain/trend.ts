/**
 * Weight trend (plan §8.1, decision ARCHITECTURE §10.3): a plain exponential moving average
 * with α = 0.25, the smoothing the design's chart draws. Daily readings swing with salt and
 * water; the trend is what moves the story.
 *
 * On the design's 14 readings the EMA ends at 77.99 kg, so the app shows "78.0 kg" where the
 * design's copy says 77.9 (the prototype draws this same EMA but hard-codes the label).
 */
import { addDays, compareDays, daysBetween } from './day';
import type { LogicalDay, WeightLog } from './types';

export const TREND_ALPHA = 0.25;

export interface TrendPoint {
  day: LogicalDay;
  kg: number;
  trendKg: number;
}

/** One EMA step after `gapDays` days (1 for consecutive readings). */
function step(trend: number, value: number, gapDays: number, alpha: number): number {
  // A longer gap weighs the new reading as if the missing days had read the same.
  const a = 1 - (1 - alpha) ** gapDays;
  return trend + a * (value - trend);
}

/** Smoothed values for consecutive daily readings; the first value seeds the trend. */
export function emaTrend(values: number[], alpha: number = TREND_ALPHA): number[] {
  const out: number[] = [];
  let trend: number | undefined;
  for (const value of values) {
    trend = trend === undefined ? value : step(trend, value, 1, alpha);
    out.push(trend);
  }
  return out;
}

/** The last reading of each logical day, sorted by day. Non-positive or non-finite readings are skipped. */
export function dailyWeights(logs: WeightLog[]): { day: LogicalDay; kg: number }[] {
  const latest = new Map<LogicalDay, WeightLog>();
  for (const log of logs) {
    if (!Number.isFinite(log.kg) || log.kg <= 0) continue;
    const current = latest.get(log.logicalDay);
    if (!current || Date.parse(log.measuredAt) >= Date.parse(current.measuredAt)) {
      latest.set(log.logicalDay, log);
    }
  }
  return [...latest.values()]
    .sort((a, b) => compareDays(a.logicalDay, b.logicalDay))
    .map((log) => ({ day: log.logicalDay, kg: log.kg }));
}

/** Daily readings with their trend; gaps between weigh-ins are handled by day count. */
export function weightTrend(logs: WeightLog[], alpha: number = TREND_ALPHA): TrendPoint[] {
  const points: TrendPoint[] = [];
  let trend: number | undefined;
  let previousDay: LogicalDay | undefined;
  for (const { day, kg } of dailyWeights(logs)) {
    trend =
      trend !== undefined && previousDay !== undefined
        ? step(trend, kg, Math.max(1, daysBetween(previousDay, day)), alpha)
        : kg;
    previousDay = day;
    points.push({ day, kg, trendKg: trend });
  }
  return points;
}

/** The last point on or before `day`, if any. */
export function trendOn<T extends { day: LogicalDay }>(points: T[], day: LogicalDay): T | undefined {
  let found: T | undefined;
  for (const point of [...points].sort((a, b) => compareDays(a.day, b.day))) {
    if (compareDays(point.day, day) > 0) break;
    found = point;
  }
  return found;
}

/**
 * Trend now (the latest point) minus the trend `days` earlier, using the last point on or
 * before that day. null when there's no point that far back.
 */
export function trendChange(points: { day: LogicalDay; trendKg: number }[], days: number): number | null {
  const latest = [...points].sort((a, b) => compareDays(a.day, b.day)).at(-1);
  if (!latest) return null;
  const earlier = trendOn(points, addDays(latest.day, -days));
  return earlier ? latest.trendKg - earlier.trendKg : null;
}

/**
 * Trend change over the budget week starting `weekStart`: the trend at the end of that week
 * (or the latest point, for the current week) minus the trend at the end of the week before.
 * This is the design's "This week −0.4 kg". null without a point before the week.
 */
export function weekTrendChange(points: { day: LogicalDay; trendKg: number }[], weekStart: LogicalDay): number | null {
  const before = trendOn(points, addDays(weekStart, -1));
  const end = trendOn(points, addDays(weekStart, 6));
  if (!before || !end || compareDays(end.day, weekStart) < 0) return null;
  return end.trendKg - before.trendKg;
}
