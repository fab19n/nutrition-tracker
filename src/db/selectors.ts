/**
 * Read models for screens: plain async functions that read Dexie and run the engine.
 *
 * They are framework-free (hooks.ts wraps them in live queries) and take the database first,
 * so tests can point them at a throwaway copy. "Today" comes from the clock unless the caller
 * passes it in, which lets the hooks re-run a query only when the logical day changes.
 */
import type { KiraMakanDb } from '@/db/db';
import {
  getDayRecord,
  getProfile as readProfile,
  getWeekPlan,
  listBonusesInRange,
  listDayRecordsInRange,
  listGoalPeriods,
  listGoals,
  listMealsForDay,
  listMealsInRange,
  listWeights,
  listWorkoutsInRange,
} from '@/db/repo';
import { computeWeekBudget, daysInRange, type BudgetDayInput, type WeekBudget } from '@/domain/budget';
import { analyseDay, typicalSlotKcal, type DayAnalysis } from '@/domain/checkin';
import { periodOn as periodAppliesOn } from '@/domain/goals';
import { now } from '@/domain/clock';
import {
  DEFAULT_ROLLOVER_HOUR,
  DEFAULT_TZ,
  addDays,
  compareDays,
  daysBetween,
  instantAt,
  logicalDayOf,
  weekDays,
  weekStartOf,
  weekdayIndex,
} from '@/domain/day';
import { fmtDayShort, fmtInt, fmtKcal, fmtTime, roundTo10 } from '@/domain/format';
import { mealMacros, mealRange, scaleMacros, sumMacros } from '@/domain/meal';
import {
  DEFAULT_SLOT_TIMES,
  MEAL_SLOTS,
  eatingWindow,
  isUsualSlot,
  slotBaselines,
  timingTag,
  type EatingWindow,
  type SlotBaselines,
  type TimingTagKind,
} from '@/domain/timing';
import { weekTrendChange, weightTrend, type TrendPoint } from '@/domain/trend';
import type {
  DayRecord,
  Goal,
  GoalPeriod,
  GoalVersion,
  Id,
  Instant,
  KcalRange,
  LogicalDay,
  Macros,
  MealLog,
  MealSlot,
  Profile,
  WeekPlan,
  WeightLog,
} from '@/domain/types';

// ---------------------------------------------------------------------------
// Settings and today
// ---------------------------------------------------------------------------

export interface SelectorOptions {
  /** The current logical day; defaults to the clock (demo-aware) in the profile's zone. */
  today?: LogicalDay;
}

export interface Settings {
  profile?: Profile;
  tz: string;
  rolloverHour: number;
  dailyMinimumKcal: number;
}

/** Only used before setup, when there is no profile yet. */
const FALLBACK_DAILY_MINIMUM_KCAL = 1200;

/** Timing baselines and typical portions look back this far (plan §11, §10.2). */
const HISTORY_DAYS = 28;

export async function loadSettings(db: KiraMakanDb): Promise<Settings> {
  const profile = await readProfile(db);
  const settings: Settings = {
    tz: profile?.timeZone ?? DEFAULT_TZ,
    rolloverHour: profile?.rolloverHour ?? DEFAULT_ROLLOVER_HOUR,
    dailyMinimumKcal: profile?.dailyMinimumKcal ?? FALLBACK_DAILY_MINIMUM_KCAL,
  };
  if (profile) settings.profile = profile;
  return settings;
}

/** The logical day at `at` (default: the clock) in the profile's zone and rollover. */
export function todayFor(profile: Pick<Profile, 'timeZone' | 'rolloverHour'> | undefined, at: Date = now()): LogicalDay {
  return logicalDayOf(at, profile?.timeZone ?? DEFAULT_TZ, profile?.rolloverHour ?? DEFAULT_ROLLOVER_HOUR);
}

export function getProfile(db: KiraMakanDb): Promise<Profile | undefined> {
  return readProfile(db);
}

export async function getToday(db: KiraMakanDb, at: Date = now()): Promise<LogicalDay> {
  return todayFor(await readProfile(db), at);
}

// ---------------------------------------------------------------------------
// Goals in force on a day
// ---------------------------------------------------------------------------

export interface ActiveGoal {
  goal: Goal;
  /** Targets in force that day. A goal without versions of its own (Pause) carries the previous goal's. */
  version: GoalVersion;
  period: GoalPeriod;
  /** Pause: no budget that day. */
  paused: boolean;
}

export type GoalTimeline = (day: LogicalDay) => ActiveGoal | undefined;

function byEffectiveFrom(a: GoalVersion, b: GoalVersion): number {
  return compareDays(a.effectiveFrom, b.effectiveFrom) || a.createdAt.localeCompare(b.createdAt);
}

/** Loads the (small) goal tables once and resolves any number of days against them. */
async function loadGoalTimeline(db: KiraMakanDb): Promise<GoalTimeline> {
  const [goals, periods, versions] = await Promise.all([listGoals(db), listGoalPeriods(db), db.goalVersions.toArray()]);
  return goalTimelineOf(goals, periods, versions);
}

/**
 * Resolves days against goal rows already read (the goal library reads them once): the period
 * that applies (periodOn) and the goal's latest version with effectiveFrom ≤ day.
 */
export function goalTimelineOf(goals: readonly Goal[], periods: readonly GoalPeriod[], versions: readonly GoalVersion[]): GoalTimeline {
  const goalById = new Map(goals.map((g) => [g.id, g]));
  const versionsByGoal = new Map<Id, GoalVersion[]>();
  for (const version of [...versions].sort(byEffectiveFrom)) {
    const list = versionsByGoal.get(version.goalId) ?? [];
    list.push(version);
    versionsByGoal.set(version.goalId, list);
  }

  // Two periods from the same day (two devices booked a switch offline): the later booking wins.
  const periodOn = (day: LogicalDay): GoalPeriod | undefined => periodAppliesOn(periods, day);
  const versionOn = (goalId: Id, day: LogicalDay): GoalVersion | undefined =>
    versionsByGoal.get(goalId)?.filter((v) => v.effectiveFrom <= day).at(-1);

  // A Pause has no versions of its own and carries the previous day's, which may itself be a
  // Pause's carry (Pause after Pause): the carry follows the chain back to a budget goal.
  // `from` strictly decreases at every step, so the recursion ends; memoised per day.
  const memo = new Map<LogicalDay, ActiveGoal | undefined>();
  const resolve = (day: LogicalDay): ActiveGoal | undefined => {
    const period = periodOn(day);
    const goal = period ? goalById.get(period.goalId) : undefined;
    if (!period || !goal) return undefined;
    const version =
      versionOn(goal.id, day) ?? lookup(addDays(period.from, -1))?.version ?? versionsByGoal.get(goal.id)?.[0];
    if (!version) return undefined;
    return { goal, version, period, paused: goal.template === 'pause' };
  };
  const lookup = (day: LogicalDay): ActiveGoal | undefined => {
    if (!memo.has(day)) memo.set(day, resolve(day));
    return memo.get(day);
  };
  return lookup;
}

/** The goal period covering `day` and the latest version with effectiveFrom ≤ day. */
export async function getActiveGoal(db: KiraMakanDb, day: LogicalDay): Promise<ActiveGoal | undefined> {
  return (await loadGoalTimeline(db))(day);
}

// ---------------------------------------------------------------------------
// History shared by timing and the check-in
// ---------------------------------------------------------------------------

/**
 * Meals of complete days in the 28 days before `day`. Guesses, not-counted and unconfirmed
 * days stay out of timing baselines and typical portions (plan §10.1).
 */
async function completeHistoryBefore(db: KiraMakanDb, day: LogicalDay): Promise<MealLog[]> {
  const from = addDays(day, -HISTORY_DAYS);
  const to = addDays(day, -1);
  const [meals, records] = await Promise.all([listMealsInRange(db, from, to), listDayRecordsInRange(db, from, to)]);
  const complete = new Set(records.filter((r) => r.status === 'complete').map((r) => r.logicalDay));
  return meals.filter((m) => complete.has(m.logicalDay) && !m.isGuess);
}

function mealsKcal(meals: MealLog[]): number {
  return Math.round(meals.reduce((sum, m) => sum + mealMacros(m).kcal, 0));
}

/** A wall-clock time (minutes after midnight) on a logical day; times before the rollover fall on the next date. */
function slotInstant(day: LogicalDay, wallMinutes: number, settings: Settings): Instant {
  const hour = Math.floor(wallMinutes / 60) + (wallMinutes < settings.rolloverHour * 60 ? 24 : 0);
  return instantAt(day, hour, wallMinutes % 60, settings.tz);
}

// ---------------------------------------------------------------------------
// Day summary (Today, Diary day)
// ---------------------------------------------------------------------------

export interface DaySummary {
  day: LogicalDay;
  /** In the order they were eaten, guesses included. */
  meals: MealLog[];
  macros: Macros;
  kcal: number;
  /** Σ meal ranges. */
  range: KcalRange;
  record?: DayRecord;
  /** From the goal's timing rules; guesses are left out. */
  window: EatingWindow;
  /** Timing tag per meal id (guesses have none). */
  tags: Record<Id, TimingTagKind>;
  baselines: SlotBaselines;
  goal?: ActiveGoal;
}

/** When you usually eat each slot, from the complete days before `day` (what getDaySummary judges by). */
export async function getSlotBaselines(db: KiraMakanDb, day: LogicalDay): Promise<SlotBaselines> {
  const [settings, history] = await Promise.all([loadSettings(db), completeHistoryBefore(db, day)]);
  return slotBaselines(history, settings.tz, settings.rolloverHour);
}

export async function getDaySummary(db: KiraMakanDb, day: LogicalDay): Promise<DaySummary> {
  const [settings, meals, record, history, timeline] = await Promise.all([
    loadSettings(db),
    listMealsForDay(db, day),
    getDayRecord(db, day),
    completeHistoryBefore(db, day),
    loadGoalTimeline(db),
  ]);
  const goal = timeline(day);
  const timed = meals.filter((m) => !m.isGuess);
  const fullWindow = eatingWindow(timed, goal?.goal.timing ?? {}, { tz: settings.tz, rolloverHour: settings.rolloverHour });
  const baselines = slotBaselines(history, settings.tz, settings.rolloverHour);
  const tags: Record<Id, TimingTagKind> = {};
  // A paused day has timing off (plan §6.2 Pause): no window to close and no timing tags.
  const paused = goal?.paused === true;
  const window: EatingWindow = paused ? { lengthHours: fullWindow.lengthHours, occasions: fullWindow.occasions } : fullWindow;
  if (!paused) {
    for (const meal of timed) {
      tags[meal.id] = timingTag(meal, { baselines, window, tz: settings.tz, rolloverHour: settings.rolloverHour });
    }
  }
  const macros = sumMacros(meals.map(mealMacros));
  const range = meals.reduce<KcalRange>((sum, m) => {
    const r = mealRange(m);
    return { low: sum.low + r.low, high: sum.high + r.high };
  }, { low: 0, high: 0 });

  const summary: DaySummary = { day, meals, macros, kcal: Math.round(macros.kcal), range, window, tags, baselines };
  if (record) summary.record = record;
  if (goal) summary.goal = goal;
  return summary;
}

// ---------------------------------------------------------------------------
// Weekly budget (Today hero, S17, S13)
// ---------------------------------------------------------------------------

export interface WeekBudgetView {
  budget: WeekBudget;
  plan?: WeekPlan;
  /** The goal in force on the requested day (or today, or the latest one this week). */
  goal: Goal;
  version: GoalVersion;
  /** What went into the budget, one row per day Mon–Sun. */
  days: BudgetDayInput[];
  dailyMinimumKcal: number;
}

function sumByDay<T extends { logicalDay: LogicalDay }>(rows: T[], value: (row: T) => number): Map<LogicalDay, number> {
  const totals = new Map<LogicalDay, number>();
  for (const row of rows) totals.set(row.logicalDay, (totals.get(row.logicalDay) ?? 0) + value(row));
  return totals;
}

/** The budget week containing `day` (default today). Undefined before any goal applies that week. */
export async function getWeekBudget(
  db: KiraMakanDb,
  day?: LogicalDay,
  opts: SelectorOptions = {},
): Promise<WeekBudgetView | undefined> {
  const settings = await loadSettings(db);
  const today = opts.today ?? todayFor(settings.profile);
  const reference = day ?? today;
  const weekStart = weekStartOf(reference);
  const days = weekDays(weekStart);
  const weekEnd = addDays(weekStart, 6);

  const [meals, workouts, bonuses, records, plan, timeline] = await Promise.all([
    listMealsInRange(db, weekStart, weekEnd),
    listWorkoutsInRange(db, weekStart, weekEnd),
    listBonusesInRange(db, weekStart, weekEnd),
    listDayRecordsInRange(db, weekStart, weekEnd),
    getWeekPlan(db, weekStart),
    loadGoalTimeline(db),
  ]);
  const eaten = sumByDay(meals, (m) => mealMacros(m).kcal);
  const workoutKcal = sumByDay(workouts, (w) => w.netKcal);
  const bonusKcal = sumByDay(bonuses, (b) => b.kcal);
  const status = new Map(records.map((r) => [r.logicalDay, r.status]));

  const inputs: BudgetDayInput[] = days.map((d) => {
    const active = timeline(d);
    return {
      day: d,
      targetKcal: active && !active.paused ? active.version.dailyKcal : null,
      eatenKcal: Math.round(eaten.get(d) ?? 0),
      workoutKcal: workoutKcal.get(d) ?? 0,
      bonusKcal: bonusKcal.get(d) ?? 0,
      status: status.get(d) ?? null,
    };
  });

  const current =
    timeline(reference) ??
    timeline(today) ??
    [...days].reverse().map(timeline).find((g): g is ActiveGoal => g !== undefined);
  if (!current) return undefined;

  const makanDay = plan?.makanDay && weekStartOf(plan.makanDay) === weekStart ? plan.makanDay : undefined;
  const budget = computeWeekBudget({
    days: inputs,
    today,
    dailyMinimumKcal: settings.dailyMinimumKcal,
    ...(makanDay ? { makanDay } : {}),
  });
  const view: WeekBudgetView = {
    budget,
    goal: current.goal,
    version: current.version,
    days: inputs,
    dailyMinimumKcal: settings.dailyMinimumKcal,
  };
  if (plan) view.plan = plan;
  return view;
}

// ---------------------------------------------------------------------------
// Weight trend (S16)
// ---------------------------------------------------------------------------

/** A rise this big from one weigh-in to the next is water, not fat (plan §8.1). */
export const WEIGHT_JUMP_KG = 0.6;
/** "Single-day": the previous weigh-in was at most this many days earlier. */
const JUMP_MAX_GAP_DAYS = 2;
const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

export interface WeightAnnotation {
  day: LogicalDay;
  /** Index into `points`, for the chart. */
  index: number;
  kg: number;
  jumpKg: number;
  /** "Friday jump: salt and water". */
  text: string;
}

export interface WeightTrendView {
  /** One point per weigh-in day, oldest first. */
  points: TrendPoint[];
  latest?: TrendPoint;
  /** This week's change: the latest trend minus the trend at the end of last week (S16 "This week −0.4 kg"). */
  weekChangeKg: number | null;
  /** The most recent single-day jump of 0.6 kg or more. */
  annotation?: WeightAnnotation;
  /** Every weigh-in, newest first (the list under the chart). */
  entries: WeightLog[];
}

function latestJump(points: TrendPoint[]): WeightAnnotation | undefined {
  for (let i = points.length - 1; i > 0; i--) {
    const point = points[i];
    const previous = points[i - 1];
    if (!point || !previous) continue;
    const jumpKg = point.kg - previous.kg;
    const gap = daysBetween(previous.day, point.day);
    if (gap <= JUMP_MAX_GAP_DAYS && jumpKg >= WEIGHT_JUMP_KG - 1e-9) {
      const weekday = WEEKDAY_NAMES[weekdayIndex(point.day)] ?? '';
      return { day: point.day, index: i, kg: point.kg, jumpKg, text: `${weekday} jump: salt and water` };
    }
  }
  return undefined;
}

export async function getWeightTrend(db: KiraMakanDb, opts: SelectorOptions = {}): Promise<WeightTrendView> {
  const [logs, profile] = await Promise.all([listWeights(db), readProfile(db)]);
  const today = opts.today ?? todayFor(profile);
  const points = weightTrend(logs);
  const view: WeightTrendView = { points, weekChangeKg: weekTrendChange(points, weekStartOf(today)), entries: [...logs].reverse() };
  const latest = points.at(-1);
  if (latest) view.latest = latest;
  const annotation = latestJump(points);
  if (annotation) view.annotation = annotation;
  return view;
}

// ---------------------------------------------------------------------------
// Morning check-in (S15)
// ---------------------------------------------------------------------------

export type CheckInChoice = 'complete' | 'fillTypical' | 'addMore' | 'notCounted';

export interface CheckInOption {
  id: CheckInChoice;
  label: string;
  /** What the answer means for the budget and trends. */
  consequence: string;
}

/** The typical portion "Fill in a typical one" adds. */
export interface CheckInGuess {
  slot: MealSlot;
  kcal: number;
  macros: Macros;
  /** The slot's usual time on that day. */
  eatenAt: Instant;
  /** "Typical dinner". */
  name: string;
}

export interface CheckIn {
  /** `day` has no record or is unconfirmed (and the app was in use, and no Pause). */
  needed: boolean;
  /** The day being asked about: the newest finished day still waiting (yesterday first), else yesterday. */
  day: LogicalDay;
  /**
   * Every finished day still waiting for a check-in since the start of yesterday's week (or
   * the first day of use), newest first. The sheet answers them one at a time, so a day the
   * app wasn't opened after never keeps its savings held back for the rest of the week.
   */
  queue: LogicalDay[];
  record?: DayRecord;
  meals: MealLog[];
  kcal: number;
  analysis: DayAnalysis;
  baselines: SlotBaselines;
  /** full: looks incomplete, four answers. light: looks complete, "All there?" with Yes / Add more. */
  variant: 'full' | 'light';
  /** "Yesterday · 2 meals · 1,240 kcal" or "Yesterday: 3 meals, 1,760 kcal. All there?". */
  title: string;
  /** "Nothing logged for 10 hours after 3:40pm. You usually have dinner around 9pm." */
  explanation?: string;
  /** Typical kcal for the missing slot. */
  typicalKcal: number | null;
  guess?: CheckInGuess;
  /** The day's target; null when paused. */
  targetKcal: number | null;
  /** What "Don't count this day" counts it as: the target plus that day's workouts and bonuses; null when paused. */
  notCountedKcal: number | null;
  /** Where "Let me add it" sets the time: the missing slot's usual time last night. */
  addMoreAt: Instant;
  options: CheckInOption[];
}

/** Shown under the answers until one is picked. */
export const CHECK_IN_PROMPT = 'Pick an answer to see what it means for your budget.';

/** Before usual meal times are known, a day logged under this share of its target may be missing meals. */
const LOW_DAY_SHARE = 0.5;

const SLOT_PHRASE: Record<MealSlot, string> = {
  breakfast: 'breakfast',
  lunch: 'lunch',
  snack: 'a snack',
  dinner: 'dinner',
  supper: 'supper',
};

const SLOT_NAME: Record<MealSlot, string> = {
  breakfast: 'Typical breakfast',
  lunch: 'Typical lunch',
  snack: 'Typical snack',
  dinner: 'Typical dinner',
  supper: 'Typical supper',
};

function mealCountLabel(count: number): string {
  return count === 1 ? '1 meal' : `${fmtInt(count)} meals`;
}

/** Typical macros for a slot: that slot's average macro split, scaled to the typical kcal. */
function typicalMacros(history: MealLog[], slot: MealSlot, kcal: number): Macros {
  const total = sumMacros(history.filter((m) => m.slot === slot).map(mealMacros));
  if (total.kcal <= 0) return { kcal, proteinG: 0, carbsG: 0, fatG: 0 };
  const scaled = scaleMacros(total, kcal / total.kcal);
  return { kcal, proteinG: Math.round(scaled.proteinG), carbsG: Math.round(scaled.carbsG), fatG: Math.round(scaled.fatG) };
}

interface DayInspection {
  settings: Settings;
  meals: MealLog[];
  record?: DayRecord;
  baselines: SlotBaselines;
  analysis: DayAnalysis;
  missingSlot?: MealSlot;
  typicalKcal: number | null;
  guess?: CheckInGuess;
}

async function inspectDay(db: KiraMakanDb, day: LogicalDay): Promise<DayInspection> {
  const [settings, meals, record, history] = await Promise.all([
    loadSettings(db),
    listMealsForDay(db, day),
    getDayRecord(db, day),
    completeHistoryBefore(db, day),
  ]);
  const baselines = slotBaselines(history, settings.tz, settings.rolloverHour);
  const logged = meals.filter((m) => !m.isGuess);
  const analysis = analyseDay(logged, {
    baselines,
    tz: settings.tz,
    rolloverHour: settings.rolloverHour,
    ...(record?.sleepAt ? { sleepAt: record.sleepAt } : {}),
  });
  // An empty day has no "one" to fill in; otherwise the gap's slot, else the first usual slot missing.
  const missingSlot =
    analysis.gap?.missingSlot ??
    (logged.length > 0
      ? MEAL_SLOTS.find((s) => isUsualSlot(baselines[s]) && !logged.some((m) => m.slot === s))
      : undefined);
  const typicalKcal = missingSlot ? typicalSlotKcal(history, missingSlot) : null;

  const inspection: DayInspection = { settings, meals, baselines, analysis, typicalKcal };
  if (record) inspection.record = record;
  if (missingSlot) inspection.missingSlot = missingSlot;
  if (missingSlot && typicalKcal !== null && typicalKcal > 0) {
    inspection.guess = {
      slot: missingSlot,
      kcal: typicalKcal,
      macros: typicalMacros(history, missingSlot, typicalKcal),
      eatenAt: slotInstant(day, baselines[missingSlot].medianMin, settings),
      name: SLOT_NAME[missingSlot],
    };
  }
  return inspection;
}

/** The typical meal "Fill in a typical one" would add to `day`, if there is one. */
export async function getTypicalGuess(db: KiraMakanDb, day: LogicalDay): Promise<CheckInGuess | undefined> {
  return (await inspectDay(db, day)).guess;
}

/** How the sheet names the day: "Yesterday", or "Wed 14 Oct" for an earlier day still waiting. */
interface DayNames {
  /** Start of a title: "Yesterday", "Wed 14 Oct". */
  title: string;
  /** Inside a sentence: "yesterday", "Wed 14 Oct". */
  inline: string;
}

function dayNames(day: LogicalDay, yesterday: LogicalDay): DayNames {
  return day === yesterday ? { title: 'Yesterday', inline: 'yesterday' } : { title: fmtDayShort(day), inline: fmtDayShort(day) };
}

function checkInOptions(
  variant: 'full' | 'light',
  guess: CheckInGuess | undefined,
  notCountedKcal: number | null,
  names: DayNames,
): CheckInOption[] {
  const complete: CheckInOption = {
    id: 'complete',
    label: "Yes, that's all I ate",
    consequence: `Marks ${names.inline} complete. Counts toward maintenance and timing.`,
  };
  const addMore: CheckInOption = {
    id: 'addMore',
    label: 'I ate more. Let me add it',
    consequence: names.inline === 'yesterday' ? 'Opens Log with the time set to last night.' : `Opens Log with the time set to ${names.inline}.`,
  };
  if (variant === 'light') return [complete, addMore];

  const counted = notCountedKcal === null ? 'your target' : fmtInt(notCountedKcal);
  const options: CheckInOption[] = [complete];
  if (guess) {
    options.push({
      id: 'fillTypical',
      label: `I had ${SLOT_PHRASE[guess.slot]}. Fill in a typical one (~${fmtInt(guess.kcal)})`,
      consequence: `Adds ~${fmtInt(guess.kcal)} kcal to this week's budget, marked as a guess. Left out of maintenance and timing insights.`,
    });
  }
  options.push(addMore, {
    id: 'notCounted',
    label: "Don't count this day",
    consequence: `Counts as exactly ${counted}. Missed meals never count as calories saved.`,
  });
  return options;
}

/**
 * Finished days that still need a check-in, newest first: from the start of yesterday's
 * budget week (or the first day of use) to yesterday, with no record or an unconfirmed one,
 * and not paused.
 */
async function pendingCheckInDays(
  db: KiraMakanDb,
  yesterday: LogicalDay,
  profile: Profile | undefined,
  timeline: GoalTimeline,
): Promise<LogicalDay[]> {
  if (!profile) return [];
  const weekStart = weekStartOf(yesterday);
  const from = compareDays(profile.startedOn, weekStart) > 0 ? profile.startedOn : weekStart;
  if (compareDays(from, yesterday) > 0) return [];
  const records = new Map((await listDayRecordsInRange(db, from, yesterday)).map((r) => [r.logicalDay, r]));
  const days: LogicalDay[] = [];
  for (let day = yesterday; compareDays(day, from) >= 0; day = addDays(day, -1)) {
    const record = records.get(day);
    const paused = timeline(day)?.paused === true || record?.status === 'paused';
    if (!paused && (!record || record.status === 'unconfirmed')) days.push(day);
  }
  return days;
}

/**
 * The morning check-in, with everything the S15 sheet shows. It asks about the newest
 * finished day still waiting (normally yesterday); `opts.day` asks about a given day instead.
 */
export async function getCheckIn(db: KiraMakanDb, opts: SelectorOptions & { day?: LogicalDay } = {}): Promise<CheckIn> {
  const [profile, timeline] = await Promise.all([readProfile(db), loadGoalTimeline(db)]);
  const today = opts.today ?? todayFor(profile);
  const yesterday = addDays(today, -1);
  const queue = await pendingCheckInDays(db, yesterday, profile, timeline);
  const day = opts.day ?? queue[0] ?? yesterday;
  const [inspection, workouts, bonuses] = await Promise.all([
    inspectDay(db, day),
    listWorkoutsInRange(db, day, day),
    listBonusesInRange(db, day, day),
  ]);
  const { settings, meals, record, analysis, guess } = inspection;
  const active = timeline(day);
  const targetKcal = active && !active.paused ? active.version.dailyKcal : null;
  const extrasKcal = workouts.reduce((sum, w) => sum + w.netKcal, 0) + bonuses.reduce((sum, b) => sum + b.kcal, 0);
  const notCountedKcal = targetKcal === null ? null : targetKcal + extrasKcal;

  const inUse = profile !== undefined && compareDays(day, profile.startedOn) >= 0;
  const paused = active?.paused === true || record?.status === 'paused';
  const unconfirmed = !record || record.status === 'unconfirmed';
  const kcal = mealsKcal(meals);
  // Without usual meal times yet (the first weeks), a gap can't be spotted; a day logged at well
  // under its target gets the full card instead, so "Don't count this day" is there and a mostly
  // missed day is never banked as savings by a quick "Yes".
  const baselinesKnown = MEAL_SLOTS.some((s) => isUsualSlot(inspection.baselines[s]));
  const lowWithoutBaselines =
    !baselinesKnown && meals.length > 0 && notCountedKcal !== null && kcal < notCountedKcal * LOW_DAY_SHARE;
  const variant = analysis.looksIncomplete || lowWithoutBaselines ? 'full' : 'light';
  const names = dayNames(day, yesterday);

  let title: string;
  let explanation: string | undefined;
  if (meals.length === 0) {
    title = `${names.title} · nothing logged`;
    explanation = names.inline === 'yesterday' ? 'Nothing was logged yesterday.' : `Nothing was logged on ${names.inline}.`;
  } else if (variant === 'light') {
    title = `${names.title}: ${mealCountLabel(meals.length)}, ${fmtKcal(kcal)}. All there?`;
  } else {
    title = `${names.title} · ${mealCountLabel(meals.length)} · ${fmtKcal(kcal)}`;
  }
  const gap = analysis.gap;
  if (lowWithoutBaselines && notCountedKcal !== null) {
    explanation = `That's under half of the day's ${fmtKcal(notCountedKcal)}. If meals are missing, you can leave the day out.`;
  }
  if (gap) {
    explanation =
      `Nothing logged for ${fmtInt(Math.round(gap.hours))} hours after ${fmtTime(gap.from, settings.tz)}. ` +
      `You usually have ${SLOT_PHRASE[gap.missingSlot]} around ${gap.usualLabel}.`;
  }

  const addMoreAt =
    guess?.eatenAt ??
    slotInstant(day, inspection.missingSlot ? inspection.baselines[inspection.missingSlot].medianMin : DEFAULT_SLOT_TIMES.dinner, settings);

  const checkIn: CheckIn = {
    needed: inUse && !paused && unconfirmed,
    day,
    queue,
    meals,
    kcal,
    analysis,
    baselines: inspection.baselines,
    variant,
    title,
    typicalKcal: inspection.typicalKcal,
    targetKcal,
    notCountedKcal,
    addMoreAt,
    options: checkInOptions(variant, guess, notCountedKcal, names),
  };
  if (record) checkIn.record = record;
  if (explanation) checkIn.explanation = explanation;
  if (guess) checkIn.guess = guess;
  return checkIn;
}

// ---------------------------------------------------------------------------
// Festive maintain and protein heroes
// ---------------------------------------------------------------------------

/** Festive maintain's band when a goal doesn't set one (the template's ±10%). */
const DEFAULT_FESTIVE_RANGE_PCT = 0.1;

export interface FestiveDaysInRange {
  /** Finished Festive-maintain days whose intake was within the target ± range. */
  inRange: number;
  /** Finished Festive-maintain days in the range. */
  days: number;
  /** The band of the latest Festive version in the range, rounded to 10. */
  lowKcal?: number;
  highKcal?: number;
}

/** Days in [from, to] (both inclusive) that stayed in the Festive band; today and later are left out. */
export async function getFestiveDaysInRange(
  db: KiraMakanDb,
  from: LogicalDay,
  to: LogicalDay,
  opts: SelectorOptions = {},
): Promise<FestiveDaysInRange> {
  const result: FestiveDaysInRange = { inRange: 0, days: 0 };
  if (compareDays(from, to) > 0) return result;
  const settings = await loadSettings(db);
  const today = opts.today ?? todayFor(settings.profile);
  const [meals, records, timeline] = await Promise.all([
    listMealsInRange(db, from, to),
    listDayRecordsInRange(db, from, to),
    loadGoalTimeline(db),
  ]);
  const eaten = sumByDay(meals, (m) => mealMacros(m).kcal);
  const status = new Map(records.map((r) => [r.logicalDay, r.status]));

  for (let day = from; compareDays(day, to) <= 0 && compareDays(day, today) < 0; day = addDays(day, 1)) {
    const active = timeline(day);
    if (active?.goal.template !== 'festive') continue;
    const rangePct = active.goal.rangePct ?? DEFAULT_FESTIVE_RANGE_PCT;
    // Centred on the target (which a Festive goal sets at maintenance), so an edited target and its band agree.
    const target = active.version.dailyKcal;
    result.days += 1;
    result.inRange += daysInRange([{ eatenKcal: eaten.get(day) ?? 0, status: status.get(day) ?? null }], target, rangePct);
    result.lowKcal = roundTo10(target * (1 - rangePct));
    result.highKcal = roundTo10(target * (1 + rangePct));
  }
  return result;
}

export interface ProteinLeft {
  targetG: number;
  eatenG: number;
  /** Negative once the target is passed. */
  leftG: number;
}

export async function getProteinLeft(db: KiraMakanDb, day: LogicalDay): Promise<ProteinLeft | undefined> {
  const [timeline, meals] = await Promise.all([loadGoalTimeline(db), listMealsForDay(db, day)]);
  const active = timeline(day);
  if (!active) return undefined;
  const eatenG = Math.round(sumMacros(meals.map(mealMacros)).proteinG);
  return { targetG: active.version.proteinG, eatenG, leftG: active.version.proteinG - eatenG };
}
