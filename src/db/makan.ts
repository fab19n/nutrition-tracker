/**
 * S18's preview: the week as it would be with a given makan day, from the same inputs the
 * budget hook already read, so the room the sheet shows is the one Today and S17 show after
 * Confirm (screens never run the budget engine themselves).
 */
import type { WeekBudget } from '@/domain/budget';
import { computeWeekBudget } from '@/domain/budget';
import type { LogicalDay } from '@/domain/types';
import type { WeekBudgetView } from './selectors';

export interface MakanPreview {
  week: WeekBudget;
  /** The room on that day: its allowance with this week's savings on top. */
  roomKcal: number | undefined;
  /** That day's own base (target + workouts + bonus). */
  baseKcal: number;
}

export function previewMakanDay(view: Pick<WeekBudgetView, 'days' | 'budget' | 'dailyMinimumKcal'>, day: LogicalDay): MakanPreview {
  const week = computeWeekBudget({ days: view.days, today: view.budget.today, dailyMinimumKcal: view.dailyMinimumKcal, makanDay: day });
  const chosen = week.days.find((d) => d.day === day);
  return { week, roomKcal: week.makanRoomKcal ?? chosen?.plannedKcal, baseKcal: chosen?.baseKcal ?? 0 };
}
