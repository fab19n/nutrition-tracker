/**
 * Weekly budget (plan §7, decision ARCHITECTURE §10.1).
 *
 * The week runs Mon–Sun and starts fresh every Monday. Finished days count what was eaten;
 * unconfirmed days count overspend straight away but hold their savings until the morning
 * check-in confirms them. Savings can be set aside for a makan day; a shortfall is spread
 * over the remaining days without taking any of them below the daily minimum.
 */
import { compareDays, weekStartOf } from './day';
import type { DayStatusKind, LogicalDay } from './types';

export interface BudgetDayInput {
  day: LogicalDay;
  /** null = paused (no budget that day). */
  targetKcal: number | null;
  /** Includes guess entries. */
  eatenKcal: number;
  workoutKcal: number;
  bonusKcal: number;
  /** null = no record (a finished day with no record is treated as 'unconfirmed'). */
  status: DayStatusKind | null;
}

export type BudgetBarKind = 'logged' | 'over' | 'today' | 'planned' | 'makan' | 'notCounted' | 'paused';

export interface BudgetDay {
  day: LogicalDay;
  kind: BudgetBarKind;
  isToday: boolean;
  isFinished: boolean;
  status: DayStatusKind | null;
  /** target + workouts + bonus (0 when paused). */
  baseKcal: number;
  eatenKcal: number;
  /** What the day uses from the week (finished days only; else 0). */
  countedKcal: number;
  /** base − counted (finished days only). */
  savedKcal: number;
  /** Allowance for today/future days after redistribution (0 for finished and paused days). */
  plannedKcal: number;
}

export interface WeekBudget {
  weekStart: LogicalDay;
  today: LogicalDay;
  days: BudgetDay[];
  /** Σ base over non-paused days. */
  weeklyBudgetKcal: number;
  workoutsKcal: number;
  bonusKcal: number;
  /** Σ eaten for finished days + today, paused days left out ("Eaten so far Mon–Fri"). */
  eatenSoFarKcal: number;
  /** Σ saved over finished days (can be negative). */
  savedKcal: number;
  /** Savings held back on unconfirmed days, released when confirmed. */
  pendingSavedKcal: number;
  todayBaseKcal: number;
  /** todayBase − eatenToday (negative = over). */
  leftTodayKcal: number;
  overTodayKcal: number;
  /** overToday > 0 && saved ≥ overToday. */
  coveredBySavings: boolean;
  /** weeklyBudget − Σ counted(finished) − eatenToday. */
  leftThisWeekKcal: number;
  makanDay?: LogicalDay;
  /** Planned allowance of the makan day (today's base + savings when the makan day is today). */
  makanRoomKcal?: number;
  /** Shortfall the remaining days couldn't take without going below the minimum. Shown, never carried over. */
  unabsorbedKcal: number;
}

/** Whole kcal everywhere, so totals add up exactly on screen. */
function kcal(n: number): number {
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function evaluateDay(input: BudgetDayInput, today: LogicalDay, makanDay: LogicalDay | undefined): { day: BudgetDay; pending: number } {
  const order = compareDays(input.day, today);
  const paused = input.targetKcal === null || input.status === 'paused';
  const eaten = kcal(input.eatenKcal);
  const base = paused ? 0 : kcal(input.targetKcal ?? 0) + kcal(input.workoutKcal) + kcal(input.bonusKcal);
  const common = {
    day: input.day,
    isToday: order === 0,
    isFinished: order < 0,
    status: input.status,
    baseKcal: base,
    eatenKcal: eaten,
  };
  const empty = { countedKcal: 0, savedKcal: 0, plannedKcal: 0 };

  if (paused) return { day: { ...common, ...empty, kind: 'paused' }, pending: 0 };
  if (order === 0) return { day: { ...common, ...empty, kind: 'today', plannedKcal: base }, pending: 0 };
  if (order > 0) {
    return { day: { ...common, ...empty, kind: input.day === makanDay ? 'makan' : 'planned', plannedKcal: base }, pending: 0 };
  }

  let counted: number;
  let saved: number;
  let pending = 0;
  switch (input.status) {
    case 'complete':
    case 'guess':
      counted = eaten;
      saved = base - eaten;
      break;
    case 'notCounted':
      counted = base;
      saved = 0;
      break;
    default:
      // Unconfirmed: overspend counts now, savings wait for the check-in.
      counted = Math.max(eaten, base);
      saved = Math.min(0, base - eaten);
      pending = Math.max(0, base - eaten);
  }
  const kind: BudgetBarKind = input.status === 'notCounted' ? 'notCounted' : eaten > base ? 'over' : 'logged';
  return { day: { ...common, kind, countedKcal: counted, savedKcal: saved, plannedKcal: 0 }, pending };
}

interface Allowance {
  base: number;
  floor: number;
}

/**
 * Takes `shortfall` off the allowances by water-filling from the top: the biggest allowances
 * come down first, towards one common level, and none goes below its floor.
 * Returns whole-kcal allowances whose total is exactly Σ base − absorbed.
 */
export function spreadShortfall(allowances: Allowance[], shortfall: number): { planned: number[]; unabsorbedKcal: number } {
  const capacity = allowances.reduce((sum, a) => sum + Math.max(0, a.base - a.floor), 0);
  if (shortfall <= 0) return { planned: allowances.map((a) => a.base), unabsorbedKcal: 0 };
  if (shortfall >= capacity) {
    return { planned: allowances.map((a) => Math.min(a.base, a.floor)), unabsorbedKcal: shortfall - capacity };
  }

  const totalBase = allowances.reduce((sum, a) => sum + a.base, 0);
  const goal = totalBase - shortfall;
  const allowanceAt = (level: number, a: Allowance): number => Math.max(Math.min(a.floor, a.base), Math.min(a.base, level));
  const totalAt = (level: number): number => allowances.reduce((sum, a) => sum + allowanceAt(level, a), 0);

  // The total is piecewise linear in the level; find the segment that reaches the goal and interpolate.
  const breakpoints = [...new Set(allowances.flatMap((a) => [a.base, Math.min(a.floor, a.base)]))].sort((x, y) => x - y);
  let level = breakpoints[breakpoints.length - 1] ?? 0;
  for (let i = 1; i < breakpoints.length; i++) {
    const lo = breakpoints[i - 1] ?? 0;
    const hi = breakpoints[i] ?? 0;
    const totalHi = totalAt(hi);
    if (totalHi >= goal) {
      const totalLo = totalAt(lo);
      level = totalHi === totalLo ? hi : lo + ((goal - totalLo) * (hi - lo)) / (totalHi - totalLo);
      break;
    }
  }

  const exact = allowances.map((a) => allowanceAt(level, a));
  const planned = exact.map((x) => Math.floor(x + 1e-9));
  // Hand the rounding remainder to the days with the largest fractions (earlier days on ties).
  let remainder = goal - planned.reduce((sum, x) => sum + x, 0);
  const byFraction = exact
    .map((x, i) => ({ i, fraction: x - Math.floor(x + 1e-9) }))
    .sort((a, b) => b.fraction - a.fraction || a.i - b.i);
  for (const { i } of byFraction) {
    if (remainder <= 0) break;
    const current = planned[i];
    const allowance = allowances[i];
    if (current === undefined || !allowance || current >= allowance.base) continue;
    planned[i] = current + 1;
    remainder -= 1;
  }
  return { planned, unabsorbedKcal: 0 };
}

export function computeWeekBudget(input: {
  days: BudgetDayInput[];
  today: LogicalDay;
  dailyMinimumKcal: number;
  makanDay?: LogicalDay;
}): WeekBudget {
  const { today, makanDay } = input;
  const sorted = [...input.days].sort((a, b) => compareDays(a.day, b.day));
  const evaluated = sorted.map((d) => evaluateDay(d, today, makanDay));
  const days = evaluated.map((e) => e.day);
  const active = days.filter((d) => d.kind !== 'paused');
  const finished = active.filter((d) => d.isFinished);
  const todayDay = active.find((d) => d.isToday);

  const savedKcal = finished.reduce((sum, d) => sum + d.savedKcal, 0);
  const pendingSavedKcal = evaluated.reduce((sum, e) => sum + e.pending, 0);
  const countedKcal = finished.reduce((sum, d) => sum + d.countedKcal, 0);
  const eatenToday = todayDay?.eatenKcal ?? 0;
  const todayBaseKcal = todayDay?.baseKcal ?? 0;
  const leftTodayKcal = todayDay ? todayBaseKcal - eatenToday : 0;
  const overTodayKcal = Math.max(0, -leftTodayKcal);

  // Today's unspent kcal aren't savings until the day is finished; today's overspend is.
  const net = savedKcal + Math.min(0, leftTodayKcal);
  const future = active.filter((d) => !d.isFinished && !d.isToday);
  let unabsorbedKcal = 0;
  if (net >= 0) {
    const makan = future.find((d) => d.kind === 'makan');
    if (makan) makan.plannedKcal = makan.baseKcal + net;
  } else {
    const spread = spreadShortfall(
      future.map((d) => ({ base: d.baseKcal, floor: Math.min(d.baseKcal, input.dailyMinimumKcal) })),
      -net,
    );
    future.forEach((d, i) => {
      d.plannedKcal = spread.planned[i] ?? d.baseKcal;
    });
    unabsorbedKcal = spread.unabsorbedKcal;
  }

  const weeklyBudgetKcal = active.reduce((sum, d) => sum + d.baseKcal, 0);
  const budget: WeekBudget = {
    weekStart: weekStartOf(sorted[0]?.day ?? today),
    today,
    days,
    weeklyBudgetKcal,
    workoutsKcal: sumActive(sorted, (d) => kcal(d.workoutKcal)),
    bonusKcal: sumActive(sorted, (d) => kcal(d.bonusKcal)),
    eatenSoFarKcal: finished.reduce((sum, d) => sum + d.eatenKcal, 0) + eatenToday,
    savedKcal,
    pendingSavedKcal,
    todayBaseKcal,
    leftTodayKcal,
    overTodayKcal,
    coveredBySavings: overTodayKcal > 0 && savedKcal >= overTodayKcal,
    leftThisWeekKcal: weeklyBudgetKcal - countedKcal - eatenToday,
    unabsorbedKcal,
  };

  if (makanDay) {
    budget.makanDay = makanDay;
    const room = makanRoom(makanDay, days, todayDay, savedKcal);
    if (room !== undefined) budget.makanRoomKcal = room;
  }
  return budget;
}

function sumActive(days: BudgetDayInput[], value: (d: BudgetDayInput) => number): number {
  return days.reduce((sum, d) => (d.targetKcal === null || d.status === 'paused' ? sum : sum + value(d)), 0);
}

function makanRoom(makanDay: LogicalDay, days: BudgetDay[], todayDay: BudgetDay | undefined, savedKcal: number): number | undefined {
  if (todayDay?.day === makanDay) return todayDay.baseKcal + Math.max(0, savedKcal);
  const day = days.find((d) => d.day === makanDay);
  return day?.kind === 'makan' ? day.plannedKcal : undefined;
}

/**
 * Days whose intake was within maintenance ± rangePct (Festive maintain's main number).
 * Not-counted and paused days are unknown, so they never count as in range.
 */
export function daysInRange(
  days: { eatenKcal: number; status: DayStatusKind | null }[],
  maintenanceKcal: number,
  rangePct: number,
): number {
  const low = maintenanceKcal * (1 - rangePct);
  const high = maintenanceKcal * (1 + rangePct);
  return days.filter(
    (d) => d.status !== 'notCounted' && d.status !== 'paused' && d.eatenKcal >= low && d.eatenKcal <= high,
  ).length;
}
