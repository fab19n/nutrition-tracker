/**
 * Workouts and one-off bonuses (S29 Log workout, S30 Activity; plan §8.2).
 *
 * - Workouts and bonuses grouped by budget week (this week, last week, older), with the kcal
 *   each week gained.
 * - The weight the estimate uses: the latest weigh-in, else the weight at setup (the same one
 *   `addWorkout` uses, so the number on screen is the number saved).
 * - Which days a workout can go on: today back to this week's Monday, never in the future, and
 *   yesterday across the week line only while that day is still unconfirmed (a confirmed past
 *   week keeps its budget).
 * - Adds and deletes that hand back an undo for the toast. A past week that has closed (no day
 *   on offer for adds) is marked, so deleting from it is confirmed first: the delete changes
 *   that week's budget and review, never this week's.
 *
 * Plain async functions take the database first, like the repo and selectors; the bound
 * versions and hooks use the app's database.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { createActions, type Undo } from '@/db/actions';
import { db as appDb, type KiraMakanDb } from '@/db/db';
import { useToday } from '@/db/hooks';
import { getDayRecord, getProfile, latestWeight, listBonusesInRange, listWorkouts } from '@/db/repo';
import { todayFor } from '@/db/selectors';
import { addDays, compareDays, weekStartOf } from '@/domain/day';
import { fmtRelativeDay } from '@/domain/format';
import type { DayRecord, Id, Instant, Intensity, LogicalDay, OneOffBonus, Workout, WorkoutType } from '@/domain/types';

/** Logical days sort as ISO strings, so these bound every stored day. */
const FIRST_DAY = '0000-01-01';
const LAST_DAY = '9999-12-31';

/** The duration stepper's bounds (C51); the same limits guard the write. */
export const WORKOUT_MINUTES = { min: 5, max: 300, step: 5 } as const;

/** A one-off bonus is for an unusual day (a hike, a tournament), not a second target. */
export const BONUS_KCAL = { min: 1, max: 3000 } as const;

/** Longest reason kept with a bonus. */
export const BONUS_REASON_MAX = 60;

// ---------------------------------------------------------------------------
// Grouping by budget week (S30)
// ---------------------------------------------------------------------------

export type ActivityWeekKind = 'thisWeek' | 'lastWeek' | 'older';

interface EntryBase {
  id: Id;
  day: LogicalDay;
  /** Net kcal the entry added to its week's budget. */
  kcal: number;
  createdAt: Instant;
}

export type ActivityEntry =
  | (EntryBase & { kind: 'workout'; workout: Workout })
  | (EntryBase & { kind: 'bonus'; bonus: OneOffBonus });

export interface ActivityWeek {
  /** Monday of the budget week. */
  weekStart: LogicalDay;
  weekEnd: LogicalDay;
  kind: ActivityWeekKind;
  workoutsKcal: number;
  bonusKcal: number;
  /** Workouts + bonuses: what the week's budget gained. */
  addedKcal: number;
  /**
   * A past week with no day still on offer for a workout (see `workoutDayChoice`): its budget
   * has closed, so a delete there is confirmed before it changes that week's numbers.
   */
  closed: boolean;
  /** Newest first. */
  entries: ActivityEntry[];
}

export interface ActivityView {
  today: LogicalDay;
  /**
   * Newest week first. This week is always there (even with nothing in it, "This week · +0");
   * other weeks only when something was logged in them.
   */
  weeks: ActivityWeek[];
  /** False when no workout or bonus was ever logged (S30 empty state). */
  hasAny: boolean;
}

function weekKind(weekStart: LogicalDay, thisWeek: LogicalDay): ActivityWeekKind {
  if (weekStart === thisWeek) return 'thisWeek';
  if (weekStart === addDays(thisWeek, -7)) return 'lastWeek';
  return 'older';
}

function emptyWeek(weekStart: LogicalDay, thisWeek: LogicalDay): ActivityWeek {
  return {
    weekStart,
    weekEnd: addDays(weekStart, 6),
    kind: weekKind(weekStart, thisWeek),
    workoutsKcal: 0,
    bonusKcal: 0,
    addedKcal: 0,
    closed: false,
    entries: [],
  };
}

/** Newest first: by day, then by when it was logged. */
function newestFirst(a: ActivityEntry, b: ActivityEntry): number {
  const byDay = compareDays(b.day, a.day);
  if (byDay !== 0) return byDay;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/**
 * Groups workouts and bonuses into budget weeks (Mon–Sun) around `today`. Pure.
 * `openDays` are the days still on offer for a workout (`workoutDayChoice`); a past week with
 * none of them is closed. Without it, only this week is open.
 */
export function groupActivityByWeek(
  workouts: readonly Workout[],
  bonuses: readonly OneOffBonus[],
  today: LogicalDay,
  openDays: readonly LogicalDay[] = [],
): ActivityView {
  const thisWeek = weekStartOf(today);
  const openWeeks = new Set([thisWeek, ...openDays.map(weekStartOf)]);
  const weeks = new Map<LogicalDay, ActivityWeek>([[thisWeek, emptyWeek(thisWeek, thisWeek)]]);
  const weekFor = (day: LogicalDay): ActivityWeek => {
    const start = weekStartOf(day);
    let week = weeks.get(start);
    if (!week) {
      week = emptyWeek(start, thisWeek);
      weeks.set(start, week);
    }
    return week;
  };

  for (const workout of workouts) {
    const week = weekFor(workout.logicalDay);
    week.workoutsKcal += workout.netKcal;
    week.entries.push({ kind: 'workout', id: workout.id, day: workout.logicalDay, kcal: workout.netKcal, createdAt: workout.createdAt, workout });
  }
  for (const bonus of bonuses) {
    const week = weekFor(bonus.logicalDay);
    week.bonusKcal += bonus.kcal;
    week.entries.push({ kind: 'bonus', id: bonus.id, day: bonus.logicalDay, kcal: bonus.kcal, createdAt: bonus.createdAt, bonus });
  }

  const list = [...weeks.values()].sort((a, b) => compareDays(b.weekStart, a.weekStart));
  for (const week of list) {
    week.addedKcal = week.workoutsKcal + week.bonusKcal;
    week.closed = compareDays(week.weekStart, thisWeek) < 0 && !openWeeks.has(week.weekStart);
    week.entries.sort(newestFirst);
  }
  return { today, weeks: list, hasAny: workouts.length + bonuses.length > 0 };
}

export async function getActivity(db: KiraMakanDb, opts: { today?: LogicalDay } = {}): Promise<ActivityView> {
  const profile = await getProfile(db);
  const today = opts.today ?? todayFor(profile);
  const [workouts, bonuses, days] = await Promise.all([
    listWorkouts(db),
    listBonusesInRange(db, FIRST_DAY, LAST_DAY),
    getWorkoutDayChoice(db, { today }),
  ]);
  return groupActivityByWeek(
    workouts,
    bonuses,
    today,
    days.options.map((o) => o.day),
  );
}

/** S30: every workout and bonus by week. Undefined while loading. */
export function useActivity(): ActivityView | undefined {
  const today = useToday();
  return useLiveQuery(() => getActivity(appDb, { today }), [today]);
}

// ---------------------------------------------------------------------------
// Estimate weight and day choice (S29)
// ---------------------------------------------------------------------------

/** The latest weigh-in, else the weight at setup; undefined before setup. */
export async function getEstimateWeightKg(db: KiraMakanDb): Promise<number | undefined> {
  const [latest, profile] = await Promise.all([latestWeight(db), getProfile(db)]);
  return latest?.kg ?? profile?.weightKgAtSetup;
}

export interface WorkoutDayOption {
  day: LogicalDay;
  /** "Today", "Yesterday", "Wed". */
  label: string;
}

export interface WorkoutDayChoice {
  today: LogicalDay;
  /** Today first, then back towards this week's Monday. Never a future day. */
  options: WorkoutDayOption[];
  /** Why yesterday isn't offered, when the week line hides it. */
  limitNote?: string;
}

export const LAST_WEEK_CLOSED_NOTE = "Last week is already confirmed, so workouts can only go on this week's days.";

/** A day the check-in (or a status) has settled. */
export function isConfirmedDay(record: Pick<DayRecord, 'status'> | undefined): boolean {
  return record !== undefined && record.status !== 'unconfirmed';
}

/**
 * The days a workout or bonus can go on. Pure.
 * - Today back to this week's Monday, never before the first day the app was used.
 * - Yesterday from last week (today is Monday) only while it is still unconfirmed: once the
 *   check-in settles it, last week's budget stays as it was.
 */
export function workoutDayChoice(input: {
  today: LogicalDay;
  startedOn?: LogicalDay;
  /** Yesterday's day record, when yesterday falls in last week. */
  yesterdayRecord?: Pick<DayRecord, 'status'>;
}): WorkoutDayChoice {
  const { today, startedOn } = input;
  const monday = weekStartOf(today);
  const started = (day: LogicalDay) => startedOn === undefined || compareDays(day, startedOn) >= 0;
  const option = (day: LogicalDay): WorkoutDayOption => ({ day, label: fmtRelativeDay(day, today) });

  const options: WorkoutDayOption[] = [];
  for (let day = today; compareDays(day, monday) >= 0; day = addDays(day, -1)) {
    if (started(day)) options.push(option(day));
  }

  const choice: WorkoutDayChoice = { today, options };
  const yesterday = addDays(today, -1);
  if (compareDays(yesterday, monday) < 0 && started(yesterday)) {
    if (isConfirmedDay(input.yesterdayRecord)) choice.limitNote = LAST_WEEK_CLOSED_NOTE;
    else options.push(option(yesterday));
  }
  return choice;
}

export async function getWorkoutDayChoice(db: KiraMakanDb, opts: { today?: LogicalDay } = {}): Promise<WorkoutDayChoice> {
  const profile = await getProfile(db);
  const today = opts.today ?? todayFor(profile);
  const yesterday = addDays(today, -1);
  const crossesWeek = weekStartOf(yesterday) !== weekStartOf(today);
  const yesterdayRecord = crossesWeek ? await getDayRecord(db, yesterday) : undefined;
  return workoutDayChoice({
    today,
    ...(profile ? { startedOn: profile.startedOn } : {}),
    ...(yesterdayRecord ? { yesterdayRecord } : {}),
  });
}

export interface WorkoutContext {
  today: LogicalDay;
  /** What the estimate uses; undefined before setup (nothing to estimate from). */
  weightKg: number | undefined;
  days: WorkoutDayChoice;
  /** The newest workout, to start the form from (most people repeat their usual session). */
  lastWorkout?: Workout;
}

export async function getWorkoutContext(db: KiraMakanDb, opts: { today?: LogicalDay } = {}): Promise<WorkoutContext> {
  const profile = await getProfile(db);
  const today = opts.today ?? todayFor(profile);
  const [weightKg, days, workouts] = await Promise.all([
    getEstimateWeightKg(db),
    getWorkoutDayChoice(db, { today }),
    listWorkouts(db),
  ]);
  const context: WorkoutContext = { today, weightKg, days };
  // Newest day first, and the later-logged one within a day.
  const newest = workouts[0];
  if (newest) context.lastWorkout = newest;
  return context;
}

/** S29: weight for the estimate, the days on offer and the last workout. Undefined while loading. */
export function useWorkoutContext(): WorkoutContext | undefined {
  const today = useToday();
  return useLiveQuery(() => getWorkoutContext(appDb, { today }), [today]);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

async function assertOpenDay(db: KiraMakanDb, day: LogicalDay | undefined): Promise<void> {
  if (day === undefined) return;
  const choice = await getWorkoutDayChoice(db);
  if (!choice.options.some((o) => o.day === day)) throw new RangeError(`A workout can't go on ${day}`);
}

export interface LoggedWorkout {
  workout: Workout;
  undo: Undo;
}

export interface WorkoutInput {
  type: WorkoutType;
  intensity: Intensity;
  minutes: number;
  /** Default today. Must be one of the days `workoutDayChoice` offers. */
  day?: LogicalDay;
}

/** Adds a workout (net kcal from the MET table and the estimate weight); the undo removes it. */
export async function logWorkoutIn(db: KiraMakanDb, input: WorkoutInput): Promise<LoggedWorkout> {
  const { min, max } = WORKOUT_MINUTES;
  if (!Number.isInteger(input.minutes) || input.minutes < min || input.minutes > max) {
    throw new RangeError(`Workout minutes must be ${min}–${max}: ${input.minutes}`);
  }
  await assertOpenDay(db, input.day);
  const actions = createActions(db);
  const workout = await actions.addWorkout(input.type, input.intensity, input.minutes, input.day);
  return {
    workout,
    undo: async () => {
      await actions.deleteWorkout(workout.id);
    },
  };
}

export function logWorkout(input: WorkoutInput): Promise<LoggedWorkout> {
  return logWorkoutIn(appDb, input);
}

export interface LoggedBonus {
  bonus: OneOffBonus;
  undo: Undo;
}

export interface BonusInput {
  kcal: number;
  reason: string;
  /** Default today. Must be one of the days `workoutDayChoice` offers. */
  day?: LogicalDay;
}

/** Adds a one-off bonus; the undo removes it. */
export async function logBonusIn(db: KiraMakanDb, input: BonusInput): Promise<LoggedBonus> {
  if (!Number.isInteger(input.kcal) || input.kcal < BONUS_KCAL.min || input.kcal > BONUS_KCAL.max) {
    throw new RangeError(`Bonus kcal must be ${BONUS_KCAL.min}–${BONUS_KCAL.max}: ${input.kcal}`);
  }
  const reason = input.reason.trim();
  if (reason.length > BONUS_REASON_MAX) throw new RangeError(`Bonus reason is over ${BONUS_REASON_MAX} characters`);
  await assertOpenDay(db, input.day);
  const actions = createActions(db);
  const bonus = await actions.addBonus(input.kcal, reason, input.day);
  return {
    bonus,
    undo: async () => {
      await actions.deleteBonus(bonus.id);
    },
  };
}

export function logBonus(input: BonusInput): Promise<LoggedBonus> {
  return logBonusIn(appDb, input);
}

/** Deletes a workout or bonus; the undo puts it back exactly as it was. */
export function deleteActivityEntryIn(db: KiraMakanDb, entry: Pick<ActivityEntry, 'kind' | 'id'>): Promise<Undo> {
  const actions = createActions(db);
  return entry.kind === 'workout' ? actions.deleteWorkout(entry.id) : actions.deleteBonus(entry.id);
}

export function deleteActivityEntry(entry: Pick<ActivityEntry, 'kind' | 'id'>): Promise<Undo> {
  return deleteActivityEntryIn(appDb, entry);
}
