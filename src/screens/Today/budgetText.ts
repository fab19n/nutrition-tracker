/**
 * Words for the budget sheets (S17, S18): how the targets add up, how a shortfall spreads,
 * and day names. Numbers come from the week budget; these only phrase them.
 */
import type { BudgetDayInput, WeekBudget } from '@/domain/budget';
import { weekdayIndex } from '@/domain/day';
import { fmtInt, fmtWeekday } from '@/domain/format';
import type { LogicalDay } from '@/domain/types';

const WEEKDAY_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

/** '2026-10-17' → 'Saturday'. */
export function weekdayLong(day: LogicalDay): string {
  return WEEKDAY_LONG[weekdayIndex(day)] ?? '';
}

/** "Sat", "Sat and Sun", "Thu, Fri and Sat". */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1] ?? ''}`;
}

function isBudgetDay(d: BudgetDayInput): d is BudgetDayInput & { targetKcal: number } {
  return d.targetKcal !== null && d.status !== 'paused';
}

/** Σ daily targets of the week's budget days (the weekly budget before workouts and bonuses). */
export function targetsTotal(days: readonly BudgetDayInput[]): number {
  return days.filter(isBudgetDay).reduce((sum, d) => sum + d.targetKcal, 0);
}

/** "7 × 1,800", or "4 × 1,800 + 3 × 2,100" when the goal changed this week. */
export function targetsBreakdown(days: readonly BudgetDayInput[]): string {
  const groups: { kcal: number; count: number }[] = [];
  for (const day of days.filter(isBudgetDay)) {
    const last = groups[groups.length - 1];
    if (last && last.kcal === day.targetKcal) last.count += 1;
    else groups.push({ kcal: day.targetKcal, count: 1 });
  }
  return groups.map((g) => `${fmtInt(g.count)} × ${fmtInt(g.kcal)}`).join(' + ');
}

/** "Mon–Fri", or "Mon" on a Monday. */
export function soFarRange(weekStart: LogicalDay, today: LogicalDay): string {
  return weekStart === today ? fmtWeekday(today) : `${fmtWeekday(weekStart)}–${fmtWeekday(today)}`;
}

/** Budget days still ahead (after today), paused days left out. */
export function daysAhead(budget: WeekBudget) {
  return budget.days.filter((d) => !d.isFinished && !d.isToday && d.kind !== 'paused');
}

/**
 * When the week is over, how the shortfall lands on the days ahead:
 * "Sat and Sun allowance: 1,650 each, never below your 1,400 minimum." Undefined when nothing was cut.
 */
export function shortfallLine(budget: WeekBudget, dailyMinimumKcal: number): string | undefined {
  const ahead = daysAhead(budget);
  const cut = ahead.some((d) => d.plannedKcal < d.baseKcal);
  const lines: string[] = [];
  if (cut) {
    const minimum = `never below your ${fmtInt(dailyMinimumKcal)} minimum`;
    const values = new Set(ahead.map((d) => d.plannedKcal));
    const first = ahead[0];
    if (values.size === 1 && first) {
      const names = joinNames(ahead.map((d) => fmtWeekday(d.day)));
      lines.push(`${names} allowance: ${fmtInt(first.plannedKcal)}${ahead.length > 1 ? ' each' : ''}, ${minimum}.`);
    } else {
      lines.push(`Allowance: ${ahead.map((d) => `${fmtWeekday(d.day)} ${fmtInt(d.plannedKcal)}`).join(' · ')}, ${minimum}.`);
    }
  }
  if (budget.unabsorbedKcal > 0) {
    lines.push(
      ahead.length > 0
        ? `${fmtInt(budget.unabsorbedKcal)} kcal can't fit into the days left. It isn't carried into next week.`
        : `${fmtInt(budget.unabsorbedKcal)} kcal over this week. Each week starts fresh, so it isn't carried into next week.`,
    );
  }
  return lines.length > 0 ? lines.join(' ') : undefined;
}
