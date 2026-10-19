/**
 * Meal timing (plan §11): the eating window from the goal's rules, and each meal judged
 * against the user's own rhythm for that slot. Medians are taken in minutes since the
 * rollover and offsets are measured the short way round the clock, so a 12:30am supper
 * sits next to 11:30pm rather than 23 hours away.
 */
import {
  DEFAULT_ROLLOVER_HOUR,
  DEFAULT_TZ,
  MINUTES_PER_DAY,
  addDays,
  compareDays,
  instantAt,
  logicalDayOf,
  logicalToWallMinutes,
  minutesIntoLogicalDay,
  wallToLogicalMinutes,
  zonedParts,
} from './day';
import type { Instant, LogicalDay, MealLog, MealSlot, TimingRules } from './types';

/** Minutes after midnight used until a slot has enough history. */
export const DEFAULT_SLOT_TIMES: Record<MealSlot, number> = {
  breakfast: 9 * 60 + 30,
  lunch: 13 * 60 + 30,
  dinner: 20 * 60 + 30,
  snack: 16 * 60,
  supper: 23 * 60 + 30,
};

/** Slots in the order they usually happen through a logical day. */
export const MEAL_SLOTS: readonly MealSlot[] = ['breakfast', 'lunch', 'snack', 'dinner', 'supper'];

export const DEFAULT_MAX_WINDOW_HOURS = 12;
/** A slot's own median is used once it has this many days of history. */
export const MIN_BASELINE_SAMPLES = 5;
/** A slot is part of your usual day when it shows up on at least this share of the days in the window. */
export const USUAL_SLOT_SHARE = 0.5;
const BASELINE_WINDOW_DAYS = 28;
const MIN_TOLERANCE_MIN = 60;
/** Meals within this long of an occasion's first bite are one eating occasion (roti canai, then the teh tarik). */
const SAME_OCCASION_MIN = 30;
const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;

export interface SlotBaseline {
  /** Minutes after midnight. */
  medianMin: number;
  /** Median absolute deviation, minutes. */
  spreadMin: number;
  /** Days with that slot in the window. */
  samples: number;
  /** samples ÷ days with any meal in the window (0 without history). */
  share: number;
}

export type SlotBaselines = Record<MealSlot, SlotBaseline>;

export interface EatingWindow {
  opensAt?: Instant;
  closesAt?: Instant;
  /** First bite to last bite. */
  lengthHours: number;
  occasions: number;
}

function sortedTimes(meals: Pick<MealLog, 'eatenAt'>[]): number[] {
  return meals
    .map((m) => Date.parse(m.eatenAt))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
}

/** A new occasion starts more than 30 minutes after the current occasion's first bite, so grazing adds up. */
function countOccasions(times: number[]): number {
  let occasions = 0;
  let occasionStart = -Infinity;
  for (const time of times) {
    if (time - occasionStart > SAME_OCCASION_MIN * MS_PER_MINUTE) {
      occasions += 1;
      occasionStart = time;
    }
  }
  return occasions;
}

/** A wall-clock time (minutes after midnight) on a logical day; times before the rollover fall on the next date. */
function wallInstantMs(day: LogicalDay, wallMinutes: number, tz: string, rolloverHour: number): number {
  const hour = Math.floor(wallMinutes / 60) + (wallMinutes < rolloverHour * 60 ? 24 : 0);
  return Date.parse(instantAt(day, hour, wallMinutes % 60, tz));
}

/**
 * Opens at the first meal and closes maxWindowHours (default 12) later. A custom goal's
 * fixed window (minutes after midnight) uses its own open and close times instead, on the
 * first meal's logical day.
 */
export function eatingWindow(
  mealsOfDay: Pick<MealLog, 'eatenAt'>[],
  rules: TimingRules,
  opts: { tz?: string; rolloverHour?: number } = {},
): EatingWindow {
  const times = sortedTimes(mealsOfDay);
  const first = times[0];
  const last = times[times.length - 1];
  if (first === undefined || last === undefined) return { lengthHours: 0, occasions: 0 };

  const lengthHours = (last - first) / MS_PER_HOUR;
  const occasions = countOccasions(times);
  const fixed = rules.fixedWindow;
  if (fixed) {
    const tz = opts.tz ?? DEFAULT_TZ;
    const rolloverHour = opts.rolloverHour ?? DEFAULT_ROLLOVER_HOUR;
    const day = logicalDayOf(new Date(first), tz, rolloverHour);
    const opensMs = wallInstantMs(day, fixed.startMin, tz, rolloverHour);
    const span = wallToLogicalMinutes(fixed.endMin, rolloverHour) - wallToLogicalMinutes(fixed.startMin, rolloverHour);
    const closesMs = span > 0 ? wallInstantMs(day, fixed.endMin, tz, rolloverHour) : opensMs + MINUTES_PER_DAY * MS_PER_MINUTE;
    return { opensAt: new Date(opensMs).toISOString(), closesAt: new Date(closesMs).toISOString(), lengthHours, occasions };
  }

  const maxHours = rules.maxWindowHours ?? DEFAULT_MAX_WINDOW_HOURS;
  return {
    opensAt: new Date(first).toISOString(),
    closesAt: new Date(first + maxHours * MS_PER_HOUR).toISOString(),
    lengthHours,
    occasions,
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid] ?? 0;
  if (sorted.length % 2 === 1) return upper;
  return ((sorted[mid - 1] ?? upper) + upper) / 2;
}

/**
 * Median and median absolute deviation of each slot's start time over the last 28 days of
 * `history` (one sample per day: that day's earliest meal in the slot). Pass complete days only.
 */
export function slotBaselines(
  history: Pick<MealLog, 'eatenAt' | 'slot' | 'logicalDay'>[],
  tz: string = DEFAULT_TZ,
  rolloverHour: number = DEFAULT_ROLLOVER_HOUR,
): SlotBaselines {
  const latest = history.reduce<LogicalDay | undefined>(
    (max, m) => (max === undefined || compareDays(m.logicalDay, max) > 0 ? m.logicalDay : max),
    undefined,
  );
  const start = latest === undefined ? undefined : addDays(latest, -(BASELINE_WINDOW_DAYS - 1));

  // slot → day → earliest logical minute that day
  const firstBySlotDay = new Map<MealSlot, Map<LogicalDay, number>>();
  const daysWithMeals = new Set<LogicalDay>();
  for (const meal of history) {
    if (start === undefined || compareDays(meal.logicalDay, start) < 0) continue;
    if (!Number.isFinite(Date.parse(meal.eatenAt))) continue;
    daysWithMeals.add(meal.logicalDay);
    const minute = minutesIntoLogicalDay(meal.eatenAt, tz, rolloverHour);
    const byDay = firstBySlotDay.get(meal.slot) ?? new Map<LogicalDay, number>();
    const existing = byDay.get(meal.logicalDay);
    if (existing === undefined || minute < existing) byDay.set(meal.logicalDay, minute);
    firstBySlotDay.set(meal.slot, byDay);
  }

  const baselineFor = (slot: MealSlot): SlotBaseline => {
    const minutes = [...(firstBySlotDay.get(slot)?.values() ?? [])];
    if (minutes.length === 0) return { medianMin: DEFAULT_SLOT_TIMES[slot], spreadMin: 0, samples: 0, share: 0 };
    const mid = median(minutes);
    return {
      medianMin: logicalToWallMinutes(Math.round(mid), rolloverHour),
      spreadMin: Math.round(median(minutes.map((m) => Math.abs(m - mid)))),
      samples: minutes.length,
      share: minutes.length / daysWithMeals.size,
    };
  };
  return {
    breakfast: baselineFor('breakfast'),
    lunch: baselineFor('lunch'),
    snack: baselineFor('snack'),
    dinner: baselineFor('dinner'),
    supper: baselineFor('supper'),
  };
}

/**
 * When you usually eat a slot, in minutes after midnight: your own median once it has 5 days of
 * history, else the default. The same centre timingTag judges a meal against.
 */
export function usualSlotMinute(slot: MealSlot, baselines?: SlotBaselines): number {
  const baseline = baselines?.[slot];
  return baseline && baseline.samples >= MIN_BASELINE_SAMPLES ? baseline.medianMin : DEFAULT_SLOT_TIMES[slot];
}

/**
 * A slot that's part of your usual day: at least 5 days of history, and on at least half the
 * days in the window, so an occasional snack doesn't make every day without one look short.
 */
export function isUsualSlot(baseline: SlotBaseline): boolean {
  return baseline.samples >= MIN_BASELINE_SAMPLES && baseline.share >= USUAL_SLOT_SHARE;
}

export type TimingTagKind = 'onTime' | 'lateForYou' | 'earlyForYou' | 'outsideWindow' | 'afterMidnight';

/**
 * In order: outside the goal's window (after it closes, or before a fixed window opens); late or early by more than max(60, 2 × spread) from
 * your median (DEFAULT_SLOT_TIMES ± 60 with fewer than 5 days of history); between midnight
 * and the rollover (counts toward the previous day); otherwise on time.
 */
export function timingTag(
  meal: Pick<MealLog, 'eatenAt' | 'slot'>,
  ctx: { baselines: SlotBaselines; window?: { opensAt?: Instant; closesAt?: Instant }; tz?: string; rolloverHour?: number },
): TimingTagKind {
  const tz = ctx.tz ?? DEFAULT_TZ;
  const rolloverHour = ctx.rolloverHour ?? DEFAULT_ROLLOVER_HOUR;
  const eatenAt = Date.parse(meal.eatenAt);
  const opensAt = ctx.window?.opensAt === undefined ? NaN : Date.parse(ctx.window.opensAt);
  const closesAt = ctx.window?.closesAt === undefined ? NaN : Date.parse(ctx.window.closesAt);
  if (Number.isFinite(closesAt) && eatenAt > closesAt) return 'outsideWindow';
  if (Number.isFinite(opensAt) && eatenAt < opensAt) return 'outsideWindow';

  const baseline = ctx.baselines[meal.slot];
  const useOwn = baseline.samples >= MIN_BASELINE_SAMPLES;
  const centre = usualSlotMinute(meal.slot, ctx.baselines);
  const tolerance = useOwn ? Math.max(MIN_TOLERANCE_MIN, 2 * baseline.spreadMin) : MIN_TOLERANCE_MIN;
  const parts = zonedParts(meal.eatenAt, tz);
  const offset = clockOffset(parts.hour * 60 + parts.minute, centre);
  if (offset > tolerance) return 'lateForYou';
  if (offset < -tolerance) return 'earlyForYou';

  if (parts.hour < rolloverHour) return 'afterMidnight';
  return 'onTime';
}

/** Signed minutes from `centre` to `minute` the short way round the clock (−720 … 719). */
function clockOffset(minute: number, centre: number): number {
  return ((((minute - centre + 720) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY) - 720;
}

/** The slot to pre-select for a meal eaten at `at` (always editable). */
export function suggestSlot(
  at: Date | Instant,
  tz: string = DEFAULT_TZ,
  rolloverHour: number = DEFAULT_ROLLOVER_HOUR,
): MealSlot {
  const p = zonedParts(at, tz);
  const minute = p.hour * 60 + p.minute;
  if (minute < rolloverHour * 60 || minute >= 22 * 60 + 30) return 'supper';
  if (minute < 11 * 60) return 'breakfast';
  if (minute < 16 * 60) return 'lunch';
  if (minute < 18 * 60) return 'snack';
  return 'dinner';
}
