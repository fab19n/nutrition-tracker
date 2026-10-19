/**
 * Copy for the Activity screens (S29, S30): week headings, row titles, kcal labels and toasts.
 * Pure; every number goes through src/domain/format.ts.
 */
import { INTENSITY_LABEL, workoutName } from '@/components/WorkoutForm/workoutOptions';
import type { ActivityEntry, ActivityWeek } from '@/db/activity';
import { addDays, daysBetween, weekStartOf } from '@/domain/day';
import { fmtApprox, fmtDayRange, fmtInt, fmtWeekday } from '@/domain/format';
import type { LogicalDay, OneOffBonus, Workout } from '@/domain/types';

/** Kcal added never goes negative: 0 reads "+0", like the design's "This week · +0". */
export function plusKcal(n: number): string {
  return n < 0 ? fmtInt(n) : `+${fmtInt(n)}`;
}

/** "This week", "Last week", else the week's dates "28 Sep–4 Oct". */
export function weekName(week: Pick<ActivityWeek, 'kind' | 'weekStart' | 'weekEnd'>): string {
  if (week.kind === 'thisWeek') return 'This week';
  if (week.kind === 'lastWeek') return 'Last week';
  return fmtDayRange(week.weekStart, week.weekEnd);
}

/** "This week · +0", "Last week · +470". */
export function weekHeading(week: Pick<ActivityWeek, 'kind' | 'weekStart' | 'weekEnd' | 'addedKcal'>): string {
  return `${weekName(week)} · ${plusKcal(week.addedKcal)}`;
}

/** Whose budget a day feeds, in a sentence: "this week", "last week", "the week of 28 Sep–4 Oct". */
export function weekPhrase(day: LogicalDay, today: LogicalDay): string {
  const start = weekStartOf(day);
  const thisWeek = weekStartOf(today);
  if (start === thisWeek) return 'this week';
  if (start === addDays(thisWeek, -7)) return 'last week';
  return `the week of ${fmtDayRange(start, addDays(start, 6))}`;
}

/** Row day: "Today", "Yesterday", else the weekday ("Tue"); the section says which week. */
export function entryDay(day: LogicalDay, today: LogicalDay): string {
  const ago = daysBetween(day, today);
  if (ago === 0) return 'Today';
  if (ago === 1) return 'Yesterday';
  return fmtWeekday(day);
}

/** Completes "+ … kcal today" in the bonus form: "today", "yesterday", "on Wed". */
export function dayPhrase(day: LogicalDay, today: LogicalDay): string {
  const ago = daysBetween(day, today);
  if (ago === 0) return 'today';
  if (ago === 1) return 'yesterday';
  return `on ${fmtWeekday(day)}`;
}

/** "Futsal 60 min, moderate". */
export function workoutSummary(workout: Pick<Workout, 'type' | 'minutes' | 'intensity'>): string {
  return `${workoutName(workout.type)} ${fmtInt(workout.minutes)} min, ${INTENSITY_LABEL[workout.intensity].toLowerCase()}`;
}

/** A bonus's name: its reason, else "One-off bonus". */
export function bonusName(bonus: Pick<OneOffBonus, 'reason'>): string {
  const reason = bonus.reason.trim();
  return reason === '' ? 'One-off bonus' : reason;
}

/** "Tue · Futsal 60 min, moderate", "Sat · A hike". */
export function entryTitle(entry: ActivityEntry, today: LogicalDay): string {
  const what = entry.kind === 'workout' ? workoutSummary(entry.workout) : bonusName(entry.bonus);
  return `${entryDay(entry.day, today)} · ${what}`;
}

/** Workouts are estimates ("~470"); a bonus is the amount you set ("+300"). */
export function entryKcal(entry: Pick<ActivityEntry, 'kind' | 'kcal'>): string {
  return entry.kind === 'workout' ? fmtApprox(entry.kcal) : plusKcal(entry.kcal);
}

/** The delete button's name: "Delete Futsal, Tue, ~470 kcal", "Delete bonus, Sat, A hike, +300 kcal". */
export function deleteLabel(entry: ActivityEntry, today: LogicalDay): string {
  const day = entryDay(entry.day, today);
  if (entry.kind === 'workout') return `Delete ${workoutName(entry.workout.type)}, ${day}, ${entryKcal(entry)} kcal`;
  return `Delete bonus, ${day}, ${bonusName(entry.bonus)}, ${entryKcal(entry)} kcal`;
}

/** "Futsal · ~470 kcal added to this week". */
export function workoutToast(workout: Pick<Workout, 'type' | 'netKcal' | 'logicalDay'>, today: LogicalDay): string {
  return `${workoutName(workout.type)} · ${fmtApprox(workout.netKcal)} kcal added to ${weekPhrase(workout.logicalDay, today)}`;
}

/** "A hike · +300 kcal added to this week". */
export function bonusToast(bonus: Pick<OneOffBonus, 'reason' | 'kcal' | 'logicalDay'>, today: LogicalDay): string {
  return `${bonusName(bonus)} · ${plusKcal(bonus.kcal)} kcal added to ${weekPhrase(bonus.logicalDay, today)}`;
}

/** "Futsal", "A hike": what an entry is called in a sentence. */
function entryName(entry: ActivityEntry): string {
  return entry.kind === 'workout' ? workoutName(entry.workout.type) : bonusName(entry.bonus);
}

/**
 * The confirmation before deleting from a week that has closed: "Delete from last week?" /
 * "Futsal, Tue, ~470 kcal. Last week has closed, so this changes its budget and weekly review.
 * This week's budget stays the same. You can undo straight after."
 */
export function closedWeekDelete(entry: ActivityEntry, today: LogicalDay): { title: string; body: string } {
  const week = weekPhrase(entry.day, today);
  const Week = week.charAt(0).toUpperCase() + week.slice(1);
  return {
    title: `Delete from ${week}?`,
    body:
      `${entryName(entry)}, ${entryDay(entry.day, today)}, ${entryKcal(entry)} kcal. ` +
      `${Week} has closed, so this changes its budget and weekly review. ` +
      "This week's budget stays the same. You can undo straight after.",
  };
}
