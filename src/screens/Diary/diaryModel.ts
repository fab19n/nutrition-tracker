/**
 * Pure view helpers for the Diary screens (S12–S14): URL params, status badges, week bars
 * and timeline positions. The budget, trend and timing maths come from selectors and hooks;
 * these only map their results onto the components.
 */
import type { DayBadgeStatus } from '@/components/DayStatusBadge/DayStatusBadge';
import type { TimelineDot } from '@/components/DayTimeline/DayTimeline';
import type { WeekBar } from '@/components/WeekBars/WeekBars';
import type { SegmentedOption } from '@/components/ui/Segmented';
import { PATHS } from '@/app/paths';
import type { BudgetDay, WeekBudget } from '@/domain/budget';
import {
  MINUTES_PER_DAY,
  addDays,
  compareDays,
  dayParts,
  daysBetween,
  logicalDayOf,
  minutesIntoLogicalDay,
  weekStartOf,
} from '@/domain/day';
import { fmtClock, fmtDayLetter, fmtDayRange, fmtDayShort, fmtInt, fmtKg, fmtQuantity, fmtRange, fmtTime, fmtWeekday } from '@/domain/format';
import { FINISHED_FACTOR, mealMacros } from '@/domain/meal';
import type { EatingWindow, TimingTagKind } from '@/domain/timing';
import type { DayStatusKind, Instant, Intensity, LogicalDay, MealItem, MealLog, WorkoutType } from '@/domain/types';

// ---------------------------------------------------------------------------
// URL params and paths
// ---------------------------------------------------------------------------

export type DiaryView = 'day' | 'week';

/** The Day/Week switch in the Diary TopBar. */
export const DIARY_VIEWS: readonly SegmentedOption<DiaryView>[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
];

function isLogicalDay(raw: string | null): raw is string {
  if (raw === null) return false;
  try {
    dayParts(raw);
    return true;
  } catch {
    return false;
  }
}

/** ?day= → a day between `earliest` (first day of use) and today; anything else → today. */
export function parseDayParam(raw: string | null, today: LogicalDay, earliest?: LogicalDay): LogicalDay {
  if (!isLogicalDay(raw)) return today;
  if (compareDays(raw, today) > 0) return today;
  if (earliest && compareDays(raw, earliest) < 0) return compareDays(earliest, today) <= 0 ? earliest : today;
  return raw;
}

/** ?week= → the Monday of that week, no later than this week and no earlier than `earliestWeek`. */
export function parseWeekParam(raw: string | null, thisWeek: LogicalDay, earliestWeek?: LogicalDay): LogicalDay {
  if (!isLogicalDay(raw)) return thisWeek;
  const monday = weekStartOf(raw);
  if (compareDays(monday, thisWeek) > 0) return thisWeek;
  if (earliestWeek && compareDays(monday, earliestWeek) < 0) return compareDays(earliestWeek, thisWeek) <= 0 ? earliestWeek : thisWeek;
  return monday;
}

/** Diary day link; today needs no param. */
export function diaryDayPath(day: LogicalDay, today: LogicalDay): string {
  return day === today ? PATHS.diary : `${PATHS.diary}?day=${day}`;
}

/** Diary week link; this week needs no param. */
export function diaryWeekPath(weekStart: LogicalDay, thisWeek: LogicalDay): string {
  return weekStart === thisWeek ? PATHS.diaryWeek : `${PATHS.diaryWeek}?week=${weekStart}`;
}

/** The day the Day tab opens for a week: today in this week, else that week's Sunday. */
export function dayForWeek(weekStart: LogicalDay, today: LogicalDay): LogicalDay {
  const sunday = addDays(weekStart, 6);
  return compareDays(sunday, today) > 0 ? today : sunday;
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/** "Fri 16 Oct · Today", "Thu 15 Oct · Yesterday", "Wed 14 Oct". */
export function dayTitle(day: LogicalDay, today: LogicalDay): string {
  const offset = daysBetween(today, day);
  if (offset === 0) return `${fmtDayShort(day)} · Today`;
  if (offset === -1) return `${fmtDayShort(day)} · Yesterday`;
  return fmtDayShort(day);
}

/** "This week" / "Last week", else undefined. */
export function relativeWeek(weekStart: LogicalDay, thisWeek: LogicalDay): 'This week' | 'Last week' | undefined {
  const weeks = Math.round(daysBetween(thisWeek, weekStart) / 7);
  if (weeks === 0) return 'This week';
  if (weeks === -1) return 'Last week';
  return undefined;
}

/** "12–18 Oct · This week". */
export function weekTitle(weekStart: LogicalDay, thisWeek: LogicalDay): string {
  const range = fmtDayRange(weekStart, addDays(weekStart, 6));
  const relative = relativeWeek(weekStart, thisWeek);
  return relative ? `${range} · ${relative}` : range;
}

/** How a sentence names the week: "this week", "last week", "5–11 Oct". */
export function weekInline(weekStart: LogicalDay, thisWeek: LogicalDay): string {
  const relative = relativeWeek(weekStart, thisWeek);
  return relative ? relative.toLowerCase() : fmtDayRange(weekStart, addDays(weekStart, 6));
}

/** "77.8" — a kg value without its unit, for "Trend 77.9" and the number pad. */
export function kgNumber(kg: number): string {
  return fmtKg(kg).replace(/ kg$/, '');
}

/** "3 Oct" — the day and month of a date (axis captions). */
export function dayMonth(day: LogicalDay): string {
  return fmtDayShort(day).replace(/^\S+ /, '');
}

// ---------------------------------------------------------------------------
// Day status
// ---------------------------------------------------------------------------

/**
 * The S12 status badge: Paused when the goal paused the day, In progress for today, else
 * the day's record (a finished day without one is Unconfirmed).
 */
export function dayBadgeFor(input: { day: LogicalDay; today: LogicalDay; status: DayStatusKind | null; paused: boolean }): DayBadgeStatus {
  if (input.paused || input.status === 'paused') return 'paused';
  if (input.day === input.today) return 'inProgress';
  return input.status ?? 'unconfirmed';
}

/** The S13 row badge for one budget day. */
export function budgetDayBadge(d: BudgetDay): DayBadgeStatus {
  if (d.kind === 'paused') return 'paused';
  if (d.isToday) return 'inProgress';
  if (!d.isFinished) return d.kind === 'makan' ? 'makan' : 'planned';
  return d.status ?? 'unconfirmed';
}

/** The kcal a week row shows: eaten for finished days and today, the allowance (muted) ahead. */
export function dayRowKcal(d: BudgetDay): { kcal: number | null; planned: boolean } {
  if (!d.isFinished && !d.isToday) return { kcal: d.kind === 'paused' ? null : d.plannedKcal, planned: true };
  return { kcal: d.eatenKcal, planned: false };
}

/** WeekBars from the engine's days: eaten for finished days, allowance (with today's fill) ahead. */
export function weekBarsFor(budget: WeekBudget): WeekBar[] {
  return budget.days.map((d) => {
    const bar: WeekBar = { label: fmtDayLetter(d.day), kind: d.kind, valueKcal: d.eatenKcal, isToday: d.isToday };
    if (d.kind === 'today') return { ...bar, valueKcal: d.plannedKcal, fillKcal: d.eatenKcal };
    if (d.kind === 'planned' || d.kind === 'makan') return { ...bar, valueKcal: d.plannedKcal };
    return bar;
  });
}

/** Screen-reader summary of the bars: "Mon 1,620. … Fri 1,230 so far of 1,800. Sat makan day, 2,450 planned." */
export function weekBarsLabel(budget: WeekBudget): string {
  const parts = budget.days.map((d) => {
    const name = fmtWeekday(d.day);
    switch (d.kind) {
      case 'today':
        return `${name} ${fmtInt(d.eatenKcal)} so far of ${fmtInt(d.plannedKcal)}`;
      case 'makan':
        return `${name} makan day, ${fmtInt(d.plannedKcal)} planned`;
      case 'planned':
        return `${name} ${fmtInt(d.plannedKcal)} planned`;
      case 'notCounted':
        return `${name} not counted`;
      case 'paused':
        return `${name} paused`;
      case 'over':
        return `${name} ${fmtInt(d.eatenKcal)}, over`;
      default:
        return `${name} ${fmtInt(d.eatenKcal)}`;
    }
  });
  return `Week ${fmtDayRange(budget.weekStart, addDays(budget.weekStart, 6))}: ${parts.join('. ')}.`;
}

/** "Target 1,800 a day", "Target 1,800–2,100 a day" across a goal switch, "Budget off" when paused. */
export function targetCaption(targets: readonly (number | null)[]): string {
  const set = targets.filter((t): t is number => t !== null);
  if (set.length === 0) return 'Budget off';
  const low = Math.min(...set);
  const high = Math.max(...set);
  return low === high ? `Target ${fmtInt(low)} a day` : `Target ${fmtRange({ low, high })} a day`;
}

// ---------------------------------------------------------------------------
// Timeline (C12)
// ---------------------------------------------------------------------------

const clampPct = (n: number) => Math.min(100, Math.max(0, n));

/** Position across the logical day (0 at the rollover), 0–100. */
export function pctOfDay(at: Instant | Date, tz: string, rolloverHour: number): number {
  return clampPct((minutesIntoLogicalDay(at, tz, rolloverHour) / MINUTES_PER_DAY) * 100);
}

/** Like pctOfDay, but an instant on a later logical day sits at the right edge (a window closing after 5am). */
function pctWithin(at: Instant, day: LogicalDay, tz: string, rolloverHour: number): number {
  const of = logicalDayOf(at, tz, rolloverHour);
  if (compareDays(of, day) > 0) return 100;
  if (compareDays(of, day) < 0) return 0;
  return pctOfDay(at, tz, rolloverHour);
}

/** The expanded strip is captioned every 4 hours: 5am 9am 1pm 5pm 9pm 1am 5am. */
const EXPANDED_STEP_MIN = 240;
const EXPANDED_CAPTIONS = MINUTES_PER_DAY / EXPANDED_STEP_MIN + 1;

const LATE_TAGS: ReadonlySet<TimingTagKind> = new Set(['lateForYou', 'outsideWindow']);

export interface TimelineModel {
  windowStartPct?: number;
  windowEndPct?: number;
  dots: TimelineDot[];
  nowPct?: number;
  /** The "Going to sleep" tap (only when `sleepAt` is given). */
  sleep?: { pct: number };
  /** Hour lines of the expanded strip (only when `expanded`). */
  ticks?: number[];
  captions: string[];
  header?: { left: string; right?: string };
  ariaLabel: string;
}

const SLOT_WORD: Record<MealLog['slot'], string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
  supper: 'Supper',
};

/**
 * The Diary day strip: window band, one dot per timed meal (sized by kcal, amber when late
 * for you or outside the window), the now marker on today, and "5am · now · 5am" captions.
 * Guess entries have no real time, so they stay off the strip.
 *
 * S35 asks for the expanded strip (`expanded`): captions every 4 hours from the rollover, the
 * hour lines to match, and with `sleepAt` the Going to sleep marker (a tap after the next
 * rollover sits at the right edge). Without them the output is the Diary's, unchanged.
 */
export function timelineFor(input: {
  day: LogicalDay;
  isToday: boolean;
  meals: MealLog[];
  tags: Record<string, TimingTagKind>;
  window: EatingWindow;
  now: Date;
  tz: string;
  rolloverHour: number;
  sleepAt?: Instant;
  expanded?: boolean;
}): TimelineModel {
  const { day, isToday, tz, rolloverHour, window } = input;
  const timed = input.meals.filter((m) => !m.isGuess);
  const dots: TimelineDot[] = timed.map((m) => {
    const tag = input.tags[m.id];
    return { pct: pctOfDay(m.eatenAt, tz, rolloverHour), kcal: mealMacros(m).kcal, tone: tag && LATE_TAGS.has(tag) ? 'late' : 'onTime' };
  });

  const edge = fmtClock(rolloverHour * 60, { compact: true });
  const middle = isToday ? 'now' : fmtClock((rolloverHour + 12) * 60, { compact: true });
  const model: TimelineModel = { dots, captions: [edge, middle, edge], ariaLabel: '' };
  if (input.expanded) {
    model.captions = Array.from({ length: EXPANDED_CAPTIONS }, (_, k) => fmtClock(rolloverHour * 60 + k * EXPANDED_STEP_MIN, { compact: true }));
    model.ticks = Array.from({ length: EXPANDED_CAPTIONS - 2 }, (_, k) => (((k + 1) * EXPANDED_STEP_MIN) / MINUTES_PER_DAY) * 100);
  }

  const sentences: string[] = [];
  if (window.opensAt && window.closesAt) {
    model.windowStartPct = pctWithin(window.opensAt, day, tz, rolloverHour);
    model.windowEndPct = pctWithin(window.closesAt, day, tz, rolloverHour);
    const closed = !isToday || Date.parse(window.closesAt) <= input.now.getTime();
    model.header = {
      left: `Window opened ${fmtTime(window.opensAt, tz)}`,
      right: `${closed ? 'closed' : 'closes'} ${fmtTime(window.closesAt, tz)}`,
    };
    sentences.push(`Eating window ${fmtTime(window.opensAt, tz)} to ${fmtTime(window.closesAt, tz)}.`);
  }
  for (const m of timed) {
    const tag = input.tags[m.id];
    const note = tag === 'lateForYou' ? ', late for you' : tag === 'outsideWindow' ? ', outside the window' : '';
    sentences.push(`${SLOT_WORD[m.slot]} ${fmtTime(m.eatenAt, tz)}${note}.`);
  }
  if (timed.length === 0) sentences.push('No meals logged.');
  if (input.sleepAt) {
    model.sleep = { pct: pctWithin(input.sleepAt, day, tz, rolloverHour) };
    sentences.push(`Going to sleep tap at ${fmtTime(input.sleepAt, tz)}.`);
  }
  if (isToday) {
    model.nowPct = pctOfDay(input.now, tz, rolloverHour);
    sentences.push(`Now ${fmtTime(input.now, tz)}.`);
  }
  model.ariaLabel = sentences.join(' ');
  return model;
}

// ---------------------------------------------------------------------------
// Entries and workouts
// ---------------------------------------------------------------------------

function itemChanged(item: MealItem): boolean {
  const o = item.original;
  if (!o) return false;
  return o.quantity !== item.quantity || o.selectedVariant !== item.selectedVariant || o.unitMacros.kcal !== item.unitMacros.kcal;
}

/**
 * The estimate the meal started from, when you changed any of its items since (S14 history
 * line). Null when every item is as it was estimated.
 */
export function originalEstimateKcal(meal: Pick<MealLog, 'items' | 'finished'>): number | null {
  if (!meal.items.some(itemChanged)) return null;
  const total = meal.items.reduce((sum, item) => {
    const o = item.original;
    return sum + (o ? o.unitMacros.kcal * o.quantity : item.unitMacros.kcal * item.quantity);
  }, 0);
  return total * FINISHED_FACTOR[meal.finished];
}

/** "Normal", "Mamak big · ×2", "×2". */
export function itemDetail(item: MealItem): string | undefined {
  const variant = item.selectedVariant !== undefined ? item.variants?.[item.selectedVariant]?.label : undefined;
  const quantity = item.quantity === 1 ? undefined : fmtQuantity(item.quantity);
  const parts = [variant, quantity].filter((p): p is string => p !== undefined);
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

export const WORKOUT_LABEL: Record<WorkoutType, string> = {
  walking: 'Walking',
  futsal: 'Futsal',
  badminton: 'Badminton',
  gym: 'Gym',
  running: 'Running',
  cycling: 'Cycling',
  swimming: 'Swimming',
  other: 'Workout',
};

export const INTENSITY_LABEL: Record<Intensity, string> = { easy: 'easy', moderate: 'moderate', hard: 'hard' };
