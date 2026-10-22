/**
 * Reminder rules (S38 Reminders, S40 push notifications, decision §10.19): which reminder is due
 * for one user at one moment, and the words it says. One module for the app (src/domain/reminders.ts
 * re-exports it) and the send-reminders Edge Function (Deno imports it as ../_shared/reminders.ts).
 *
 * No imports and only Intl, Date, Math and JSON, so it type-checks in the app (DOM) and in Node, and
 * runs in Deno. It carries its own zone and day helpers: they mirror src/domain/day.ts, timing.ts and
 * goals.ts, and src/domain/remindersParity.test.ts checks that they still agree.
 *
 * Calm by construction: at most one reminder a run, never in quiet hours or after a "Going to sleep"
 * tap, at least an hour apart, and each kind once a day (once a week for the weekly ones), in the
 * order check-in, gap nudge, weekly review, target suggestion.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_TZ = 'Asia/Kuala_Lumpur';
export const DEFAULT_ROLLOVER_HOUR = 5;
export const REMINDER_KINDS = ['checkIn', 'gap', 'weeklyReview', 'targetSuggestion'] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];
export type MessageKind = ReminderKind | 'test';

/** 10am, in minutes after midnight on the wall clock. */
export const CHECK_IN_DEFAULT_MIN = 600;
/** 7am … 12pm. */
export const CHECK_IN_CHOICES_MIN = [420, 480, 540, 600, 660, 720] as const;
/** The check-in goes within 8 hours of the chosen time (later when quiet hours run past it). */
export const CHECK_IN_WINDOW_MIN = 480;
/** Gap nudges switch on at this many complete days (Insights' "Timing patterns", plan §16.2). */
export const GAP_NUDGE_UNLOCK_DAYS = 14;
export const GAP_HOURS = 6;
export const GAP_GRACE_MIN = 45;
export const GAP_NO_MEAL_GRACE_MIN = 60;
/** A nudge more than 3 hours after the usual time is no use any more. */
export const GAP_RELEVANT_MIN = 180;
/** Main meals only: a fat-loss user is never nudged toward a snack or supper. */
export const GAP_SLOTS = ['breakfast', 'lunch', 'dinner'] as const;
/** 8pm. */
export const WEEKLY_REVIEW_AT_MIN = 1200;
export const TARGET_DELAY_MIN = 120;
/** 10am–9pm. */
export const TARGET_WINDOW = { fromMin: 600, untilMin: 1260 } as const;
export const MIN_SPACING_MIN = 60;
/** Nothing logged for longer than this is a break, and a break isn't nagged. */
export const ACTIVE_WITHIN_DAYS = 3;
export const HISTORY_DAYS = 28;
/** 11pm–8am. */
export const QUIET_DEFAULT = { fromMin: 1380, untilMin: 480 } as const;
/** 9pm … 2am. */
export const QUIET_FROM_CHOICES = [1260, 1320, 1380, 0, 60, 120] as const;
/** 6am … 11am. */
export const QUIET_UNTIL_CHOICES = [360, 420, 480, 540, 600, 660] as const;
export const QUIET_MIN_SLEEP_TAPS = 3;
export const QUIET_MIN_MEAL_DAYS = 5;
export const QUIET_BEFORE_SLEEP_MIN = 30;
export const QUIET_AFTER_LAST_MEAL_MIN = 60;
export const QUIET_BEFORE_FIRST_MEAL_MIN = 60;
export const QUIET_MIN_LENGTH_MIN = 360;
export const QUIET_MAX_LENGTH_MIN = 840;
export const QUIET_STEP_MIN = 15;
/** = timing.MIN_BASELINE_SAMPLES */
export const MIN_SLOT_SAMPLES = 5;
/** = timing.USUAL_SLOT_SHARE */
export const USUAL_SLOT_SHARE = 0.5;
export const TTL_SECONDS: Record<MessageKind, number> = { checkIn: 14400, gap: 3600, weeklyReview: 14400, targetSuggestion: 43200, test: 300 };
/** Where a tap on each notification opens (the worker accepts only these). */
export const NOTIFICATION_URLS: Record<MessageKind, string> = {
  checkIn: '/?sheet=checkin',
  gap: '/',
  weeklyReview: '/insights/weekly',
  targetSuggestion: '/insights/target',
  test: '/more/reminders',
};

const MINUTES_PER_DAY = 1440;
const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;
const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The synced preferences (Profile.reminders): every field optional, a missing one is its default. */
export interface ReminderPrefs {
  checkIn?: boolean;
  checkInAtMin?: number;
  gapNudges?: boolean;
  weeklyReview?: boolean;
  targetSuggestion?: boolean;
  quiet?: { fromMin: number; untilMin: number };
}

export interface ResolvedReminderPrefs {
  checkIn: boolean;
  checkInAtMin: number;
  gapNudges: boolean;
  weeklyReview: boolean;
  targetSuggestion: boolean;
  /** Null: from the sleep taps (auto). */
  quiet: { fromMin: number; untilMin: number } | null;
}

export interface ReminderDayRow {
  day: string;
  status?: string;
  sleepAt?: string;
}

export interface ReminderMealRow {
  day: string;
  at: string;
  slot?: string;
  guess?: boolean;
}

export interface ReminderPeriodRow {
  id: string;
  goalId: string;
  from: string;
  to?: string;
  createdAt?: string;
}

export interface ReminderGoalRow {
  id: string;
  template?: string;
}

export interface ReminderTargetMark {
  key?: string;
  weekStart?: string;
  weeks?: number;
  markedAt?: string;
  seenAt?: string;
}

/** The suggestion some device has seen (its own row, which a later mark can't overwrite). */
export interface ReminderTargetSeen {
  key?: string;
  seenAt?: string;
}

/** A row of the send log: `date` is the logical day (check-in, gap) or the week's Monday. */
export interface SentRow {
  kind: string;
  date: string;
  at: string;
}

export interface ReminderInput {
  profile?: { timeZone?: string; rolloverHour?: number; startedOn?: string; reminders?: unknown; demoMode?: boolean };
  /** Logical days ≥ today − 36. */
  days: ReminderDayRow[];
  /** Logical days ≥ today − 36. */
  meals: ReminderMealRow[];
  /** All 'complete' day records ever. */
  completeDays: number;
  periods: ReminderPeriodRow[];
  goals: ReminderGoalRow[];
  targetNotice?: ReminderTargetMark;
  targetNoticeSeen?: ReminderTargetSeen;
  /** The send log, last 8 days. */
  sent: SentRow[];
}

export type QuietSource = 'custom' | 'sleepTaps' | 'meals' | 'default';

/** Wall-clock minutes after midnight. */
export interface QuietWindow {
  fromMin: number;
  untilMin: number;
  source: QuietSource;
}

export interface DueReminder {
  kind: ReminderKind;
  localDate: string;
  title: string;
  body: string;
  url: string;
  ttlSeconds: number;
  topic: string;
}

export type SkipReason = 'noProfile' | 'demo' | 'badContext' | 'quiet' | 'asleep' | 'spacing' | 'nothingDue';
export type ReminderDecision = { due: DueReminder } | { due: null; reason: SkipReason };

/** What the service worker receives (JSON), and shows. */
export interface NotificationPayload {
  v: 1;
  kind: MessageKind;
  title: string;
  body: string;
  url: string;
}

// ---------------------------------------------------------------------------
// Time helpers (the semantics of src/domain/day.ts)
// ---------------------------------------------------------------------------

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** Mon = 0 … Sun = 6. */
  weekday: number;
}

const WEEKDAY_FROM_SHORT: Readonly<Record<string, number>> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat {
  let formatter = formatters.get(tz);
  if (!formatter) {
    // An unknown zone throws a RangeError here.
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      weekday: 'short',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    });
    formatters.set(tz, formatter);
  }
  return formatter;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/** Wall-clock parts of an instant (ms) in a zone. Throws a RangeError for an unknown zone or a bad instant. */
export function zonedParts(ms: number, tz: string): ZonedParts {
  const values: Record<string, string> = {};
  for (const part of formatterFor(tz).formatToParts(new Date(ms))) values[part.type] = part.value;
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    // Some engines still print midnight as "24" even with h23.
    hour: Number(values.hour) % 24,
    minute: Number(values.minute),
    weekday: WEEKDAY_FROM_SHORT[values.weekday ?? ''] ?? 0,
  };
}

function dayToUtcMs(day: string): number {
  const match = DAY_PATTERN.exec(day);
  if (!match) return NaN;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function utcMsToDay(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getUTCFullYear()).padStart(4, '0')}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function isDay(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(dayToUtcMs(value));
}

export function addDays(day: string, n: number): string {
  return utcMsToDay(dayToUtcMs(day) + Math.trunc(n) * MS_PER_DAY);
}

/** Whole days from `a` to `b` (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((dayToUtcMs(b) - dayToUtcMs(a)) / MS_PER_DAY);
}

/** Mon = 0 … Sun = 6. */
export function weekdayIndex(day: string): number {
  return (new Date(dayToUtcMs(day)).getUTCDay() + 6) % 7;
}

/** The Monday of the week containing `day`. */
export function weekStartOf(day: string): string {
  return addDays(day, -weekdayIndex(day));
}

/** Minutes after midnight → minutes after the rollover. */
export function wallToLogical(min: number, rolloverHour: number): number {
  return mod(min - rolloverHour * 60, MINUTES_PER_DAY);
}

/** Minutes after the rollover → minutes after midnight. */
export function logicalToWall(min: number, rolloverHour: number): number {
  return mod(min + rolloverHour * 60, MINUTES_PER_DAY);
}

/** The logical day of an instant: before the rollover hour it is still the previous date. */
export function logicalDayOf(ms: number, tz: string, rolloverHour: number): string {
  const p = zonedParts(ms, tz);
  const calendarDay = `${String(p.year).padStart(4, '0')}-${pad2(p.month)}-${pad2(p.day)}`;
  return p.hour < rolloverHour ? addDays(calendarDay, -1) : calendarDay;
}

/** Minutes since the rollover, 0 … 1439. */
export function minutesIntoLogicalDay(ms: number, tz: string, rolloverHour: number): number {
  const p = zonedParts(ms, tz);
  return wallToLogical(p.hour * 60 + p.minute, rolloverHour);
}

/** The middle value (the mean of the two middle ones for an even count); 0 for none. */
export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid] ?? 0;
  if (sorted.length % 2 === 1) return upper;
  return ((sorted[mid - 1] ?? upper) + upper) / 2;
}

function msOf(at: string | undefined): number {
  return at === undefined ? NaN : Date.parse(at);
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isQuarterMinute(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max && value % QUIET_STEP_MIN === 0;
}

/** A custom quiet window as stored: whole quarter hours in 0–1439, start and end different. */
export function isQuietSetting(value: unknown): value is { fromMin: number; untilMin: number } {
  if (!isRecord(value)) return false;
  const { fromMin, untilMin } = value;
  return isQuarterMinute(fromMin, 0, MINUTES_PER_DAY - 1) && isQuarterMinute(untilMin, 0, MINUTES_PER_DAY - 1) && fromMin !== untilMin;
}

/** A check-in time as stored: a quarter hour from 6am to 12pm. */
export function isCheckInSetting(value: unknown): value is number {
  return isQuarterMinute(value, 360, 720);
}

/** The preferences with every default filled in. Tolerant: it reads wire JSON, and anything unexpected is the default. */
export function resolveReminderPrefs(raw: unknown): ResolvedReminderPrefs {
  const r = isRecord(raw) ? raw : {};
  const on = (value: unknown) => value !== false;
  return {
    checkIn: on(r.checkIn),
    checkInAtMin: isCheckInSetting(r.checkInAtMin) ? r.checkInAtMin : CHECK_IN_DEFAULT_MIN,
    gapNudges: on(r.gapNudges),
    weeklyReview: on(r.weeklyReview),
    targetSuggestion: on(r.targetSuggestion),
    quiet: isQuietSetting(r.quiet) ? { fromMin: r.quiet.fromMin, untilMin: r.quiet.untilMin } : null,
  };
}

// ---------------------------------------------------------------------------
// Quiet hours
// ---------------------------------------------------------------------------

function roundToStep(min: number): number {
  return mod(Math.round(min / QUIET_STEP_MIN) * QUIET_STEP_MIN, MINUTES_PER_DAY);
}

/**
 * The quiet window: your own (custom), else from the last 28 days: the median "Going to sleep" tap
 * minus 30 min (3 taps or more), else the median last meal plus an hour (5 days of meals), else 11pm;
 * until the median first meal minus an hour (5 days), else 8am. Rounded to 15 min and kept 6–14 hours long.
 */
export function quietWindowFor(input: {
  prefs: Pick<ResolvedReminderPrefs, 'quiet'>;
  days: readonly ReminderDayRow[];
  meals: readonly ReminderMealRow[];
  today: string;
  tz: string;
  rolloverHour: number;
}): QuietWindow {
  const { prefs, today, tz, rolloverHour } = input;
  if (prefs.quiet) return { fromMin: prefs.quiet.fromMin, untilMin: prefs.quiet.untilMin, source: 'custom' };
  const from = addDays(today, -HISTORY_DAYS);
  const to = addDays(today, -1);
  const inWindow = (day: string) => day >= from && day <= to;

  const taps: number[] = [];
  for (const row of input.days) {
    const ms = msOf(row.sleepAt);
    if (inWindow(row.day) && Number.isFinite(ms)) taps.push(minutesIntoLogicalDay(ms, tz, rolloverHour));
  }

  const byDay = new Map<string, { first: number; last: number }>();
  for (const meal of input.meals) {
    const ms = msOf(meal.at);
    if (meal.guess === true || !inWindow(meal.day) || !Number.isFinite(ms)) continue;
    const minute = minutesIntoLogicalDay(ms, tz, rolloverHour);
    const span = byDay.get(meal.day);
    if (!span) byDay.set(meal.day, { first: minute, last: minute });
    else byDay.set(meal.day, { first: Math.min(span.first, minute), last: Math.max(span.last, minute) });
  }
  const spans = [...byDay.values()];
  const enoughTaps = taps.length >= QUIET_MIN_SLEEP_TAPS;
  const enoughMeals = spans.length >= QUIET_MIN_MEAL_DAYS;

  const fromLogical = enoughTaps
    ? median(taps) - QUIET_BEFORE_SLEEP_MIN
    : enoughMeals
      ? median(spans.map((s) => s.last)) + QUIET_AFTER_LAST_MEAL_MIN
      : undefined;
  const untilLogical = enoughMeals ? median(spans.map((s) => s.first)) - QUIET_BEFORE_FIRST_MEAL_MIN : undefined;
  const source: QuietSource = enoughTaps ? 'sleepTaps' : enoughMeals ? 'meals' : 'default';

  let fromMin = roundToStep(fromLogical === undefined ? QUIET_DEFAULT.fromMin : logicalToWall(Math.round(fromLogical), rolloverHour));
  let untilMin = roundToStep(untilLogical === undefined ? QUIET_DEFAULT.untilMin : logicalToWall(Math.round(untilLogical), rolloverHour));
  const length = mod(untilMin - fromMin, MINUTES_PER_DAY);
  if (length < QUIET_MIN_LENGTH_MIN) untilMin = mod(fromMin + QUIET_MIN_LENGTH_MIN, MINUTES_PER_DAY);
  else if (length > QUIET_MAX_LENGTH_MIN) fromMin = mod(untilMin - QUIET_MAX_LENGTH_MIN, MINUTES_PER_DAY);
  return { fromMin, untilMin, source };
}

/** True when the wall-clock minute falls in the window (which may run past midnight). */
export function isQuietAt(window: Pick<QuietWindow, 'fromMin' | 'untilMin'>, wallMin: number): boolean {
  const { fromMin, untilMin } = window;
  return fromMin <= untilMin ? wallMin >= fromMin && wallMin < untilMin : wallMin >= fromMin || wallMin < untilMin;
}

/** Today's "Going to sleep" tap has happened, and nothing was logged after it. */
export function asleepNow(input: { days: readonly ReminderDayRow[]; meals: readonly ReminderMealRow[]; today: string; nowMs: number }): boolean {
  const row = input.days.find((d) => d.day === input.today);
  const sleepMs = msOf(row?.sleepAt);
  if (!Number.isFinite(sleepMs) || sleepMs > input.nowMs) return false;
  return !input.meals.some((m) => {
    const ms = msOf(m.at);
    return ms > sleepMs && ms <= input.nowMs;
  });
}

// ---------------------------------------------------------------------------
// Usual slot times, pauses
// ---------------------------------------------------------------------------

export interface SlotUsualTime {
  /** Minutes after the rollover (rounded median). */
  medianLogicalMin: number;
  /** Median absolute deviation, minutes. */
  spreadMin: number;
  /** Days with that slot. */
  samples: number;
  /** samples ÷ days with any meal. */
  share: number;
}

export type ReminderSlot = 'breakfast' | 'lunch' | 'snack' | 'dinner' | 'supper';
const SLOTS: readonly ReminderSlot[] = ['breakfast', 'lunch', 'snack', 'dinner', 'supper'];

function isSlot(value: unknown): value is ReminderSlot {
  return (SLOTS as readonly unknown[]).includes(value);
}

/**
 * When each slot usually starts, over non-guess meals on the complete days in [today − 28, today − 1]:
 * one sample a day (that day's earliest meal in the slot), as timing.slotBaselines does.
 */
export function slotUsualTimes(
  meals: readonly ReminderMealRow[],
  completeDays: ReadonlySet<string>,
  today: string,
  tz: string,
  rolloverHour: number,
): Record<ReminderSlot, SlotUsualTime> {
  const from = addDays(today, -HISTORY_DAYS);
  const to = addDays(today, -1);
  const firstBySlot = new Map<ReminderSlot, Map<string, number>>();
  const daysWithMeals = new Set<string>();
  for (const meal of meals) {
    const ms = msOf(meal.at);
    if (meal.guess === true || meal.day < from || meal.day > to || !completeDays.has(meal.day) || !Number.isFinite(ms)) continue;
    daysWithMeals.add(meal.day);
    if (!isSlot(meal.slot)) continue;
    const minute = minutesIntoLogicalDay(ms, tz, rolloverHour);
    const byDay = firstBySlot.get(meal.slot) ?? new Map<string, number>();
    const existing = byDay.get(meal.day);
    if (existing === undefined || minute < existing) byDay.set(meal.day, minute);
    firstBySlot.set(meal.slot, byDay);
  }
  const usualFor = (slot: ReminderSlot): SlotUsualTime => {
    const minutes = [...(firstBySlot.get(slot)?.values() ?? [])];
    if (minutes.length === 0) return { medianLogicalMin: 0, spreadMin: 0, samples: 0, share: 0 };
    const mid = median(minutes);
    return {
      medianLogicalMin: Math.round(mid),
      spreadMin: Math.round(median(minutes.map((m) => Math.abs(m - mid)))),
      samples: minutes.length,
      share: minutes.length / daysWithMeals.size,
    };
  };
  return { breakfast: usualFor('breakfast'), lunch: usualFor('lunch'), snack: usualFor('snack'), dinner: usualFor('dinner'), supper: usualFor('supper') };
}

/** Part of your usual day: 5 days of history and on at least half of the days. */
export function isUsual(s: SlotUsualTime): boolean {
  return s.samples >= MIN_SLOT_SAMPLES && s.share >= USUAL_SLOT_SHARE;
}

function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** The order goals.comparePeriods resolves periods in: by `from`, then `createdAt`, then id. */
function comparePeriodRows(a: ReminderPeriodRow, b: ReminderPeriodRow): number {
  return compareText(a.from, b.from) || compareText(a.createdAt ?? '', b.createdAt ?? '') || compareText(a.id, b.id);
}

/** The day is marked paused, or the goal in force that day (the covering period that sorts last) is a Pause. */
export function pausedOn(
  day: string,
  input: { days: readonly ReminderDayRow[]; periods: readonly ReminderPeriodRow[]; goals: readonly ReminderGoalRow[] },
): boolean {
  if (input.days.some((d) => d.day === day && d.status === 'paused')) return true;
  let found: ReminderPeriodRow | undefined;
  for (const period of input.periods) {
    const covers = period.from <= day && (period.to === undefined || day < period.to);
    if (covers && (!found || comparePeriodRows(period, found) > 0)) found = period;
  }
  if (!found) return false;
  const goalId = found.goalId;
  return input.goals.some((g) => g.id === goalId && g.template === 'pause');
}

export function gapNudgesUnlocked(completeDays: number): boolean {
  return completeDays >= GAP_NUDGE_UNLOCK_DAYS;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

const SLOT_LABEL: Record<string, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner' };

export interface MessageDetails {
  /** Gap with a meal today: hours since the last log. */
  hours?: number;
  /** Gap: the slot it nudges. */
  slot?: string;
  /** Target suggestion: "Based on 3 weeks of data". */
  weeks?: number;
}

/** The title and body of each notification. */
export function reminderMessage(kind: MessageKind, details: MessageDetails = {}): { title: string; body: string } {
  switch (kind) {
    case 'checkIn':
      return { title: 'Quick check', body: "Was yesterday's log complete?" };
    case 'gap': {
      const label = SLOT_LABEL[details.slot ?? ''] ?? 'Meal';
      const title = details.hours === undefined ? 'Nothing logged yet today' : `${Math.floor(details.hours)} hours since your last log`;
      return { title, body: `${label} time for you?` };
    }
    case 'weeklyReview':
      return { title: 'Your week is ready', body: 'See how it went and pick one thing to try next week.' };
    case 'targetSuggestion': {
      const weeks = details.weeks !== undefined && Number.isInteger(details.weeks) && details.weeks >= 3 && details.weeks <= 8 ? details.weeks : 3;
      return { title: 'New target suggestion', body: `Based on ${weeks} weeks of data.` };
    }
    case 'test':
      return { title: 'Test notification', body: 'Reminders from Kira Makan show up like this.' };
  }
}

/** The push message's text: JSON the service worker reads (src/sw/push.ts). */
export function notificationPayload(kind: MessageKind, message: { title: string; body: string }): string {
  const payload: NotificationPayload = { v: 1, kind, title: message.title, body: message.body, url: NOTIFICATION_URLS[kind] };
  return JSON.stringify(payload);
}

function due(kind: ReminderKind, localDate: string, details: MessageDetails = {}): DueReminder {
  return { kind, localDate, ...reminderMessage(kind, details), url: NOTIFICATION_URLS[kind], ttlSeconds: TTL_SECONDS[kind], topic: `km-${kind}` };
}

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

interface Context {
  input: ReminderInput;
  nowMs: number;
  tz: string;
  rollover: number;
  today: string;
  startedOn: string;
  prefs: ResolvedReminderPrefs;
  wall: number;
  nowLogical: number;
  active: boolean;
  meals: ReminderMealRow[];
}

function checkInDue(c: Context): DueReminder | null {
  if (!c.prefs.checkIn || !c.active) return null;
  const yesterday = addDays(c.today, -1);
  if (yesterday < c.startedOn) return null;
  const row = c.input.days.find((d) => d.day === yesterday);
  if (row && row.status !== 'unconfirmed') return null;
  if (pausedOn(yesterday, c.input)) return null;
  if (c.wall < c.prefs.checkInAtMin || c.wall >= c.prefs.checkInAtMin + CHECK_IN_WINDOW_MIN) return null;
  return due('checkIn', c.today);
}

function gapDue(c: Context): DueReminder | null {
  if (!c.prefs.gapNudges || !gapNudgesUnlocked(c.input.completeDays) || !c.active || pausedOn(c.today, c.input)) return null;
  const from = addDays(c.today, -HISTORY_DAYS);
  const complete = new Set(c.input.days.filter((d) => d.status === 'complete' && d.day >= from && d.day < c.today).map((d) => d.day));
  const usual = slotUsualTimes(c.meals, complete, c.today, c.tz, c.rollover);

  const past = c.meals.filter((m) => msOf(m.at) <= c.nowMs);
  const todays = past.filter((m) => m.day === c.today).sort((a, b) => msOf(a.at) - msOf(b.at));
  const lastMs = past.reduce((max, m) => Math.max(max, msOf(m.at)), -Infinity);
  const last = todays.at(-1);
  const lastLogical = last ? minutesIntoLogicalDay(msOf(last.at), c.tz, c.rollover) : -Infinity;
  const eaten = new Set(todays.map((m) => m.slot));

  let pick: { slot: string; at: number } | undefined;
  for (const slot of GAP_SLOTS) {
    const s = usual[slot];
    if (!isUsual(s) || eaten.has(slot)) continue;
    const at = s.medianLogicalMin;
    const grace = Math.max(GAP_GRACE_MIN, s.spreadMin);
    if (at <= lastLogical || c.nowLogical < at + grace || c.nowLogical > at + GAP_RELEVANT_MIN) continue;
    const gapOk =
      todays.length > 0
        ? c.nowMs - lastMs >= GAP_HOURS * MS_PER_HOUR
        : c.nowLogical >= at + Math.max(grace, GAP_NO_MEAL_GRACE_MIN);
    if (!gapOk) continue;
    if (!pick || at > pick.at) pick = { slot, at };
  }
  if (!pick) return null;
  return due('gap', c.today, todays.length > 0 ? { slot: pick.slot, hours: (c.nowMs - lastMs) / MS_PER_HOUR } : { slot: pick.slot });
}

function weeklyReviewDue(c: Context): DueReminder | null {
  if (!c.prefs.weeklyReview || weekdayIndex(c.today) !== 6) return null;
  if (c.wall < WEEKLY_REVIEW_AT_MIN && c.wall >= c.rollover * 60) return null;
  if (daysBetween(c.startedOn, c.today) + 1 < 7) return null;
  const weekStart = weekStartOf(c.today);
  if (!c.meals.some((m) => m.day >= weekStart && m.day <= c.today)) return null;
  if (pausedOn(c.today, c.input)) return null;
  return due('weeklyReview', weekStart);
}

function targetSuggestionDue(c: Context): DueReminder | null {
  const mark = c.input.targetNotice;
  if (!c.prefs.targetSuggestion || !mark || !mark.key || mark.seenAt !== undefined || !isDay(mark.weekStart)) return null;
  // Seen on some device, even when a device that hadn't pulled yet marked it again since.
  if (c.input.targetNoticeSeen?.key === mark.key) return null;
  const markedMs = msOf(mark.markedAt);
  if (!Number.isFinite(markedMs) || mark.weekStart !== weekStartOf(c.today)) return null;
  if (c.nowMs < markedMs + TARGET_DELAY_MIN * MS_PER_MINUTE) return null;
  if (c.wall < TARGET_WINDOW.fromMin || c.wall >= TARGET_WINDOW.untilMin) return null;
  return due('targetSuggestion', mark.weekStart, mark.weeks === undefined ? {} : { weeks: mark.weeks });
}

const CANDIDATES = [checkInDue, gapDue, weeklyReviewDue, targetSuggestionDue];

/** What to send this user now, if anything (at most one), or why not. */
export function decideReminder(input: ReminderInput, nowMs: number): ReminderDecision {
  const p = input.profile;
  if (!p || !p.startedOn) return { due: null, reason: 'noProfile' };
  if (p.demoMode === true) return { due: null, reason: 'demo' };
  if (!isDay(p.startedOn) || !Number.isFinite(nowMs)) return { due: null, reason: 'badContext' };
  const tz = p.timeZone || DEFAULT_TZ;
  const rollover = typeof p.rolloverHour === 'number' && Number.isInteger(p.rolloverHour) && p.rolloverHour >= 0 && p.rolloverHour <= 23 ? p.rolloverHour : DEFAULT_ROLLOVER_HOUR;

  let today: string;
  let wall: number;
  try {
    today = logicalDayOf(nowMs, tz, rollover);
    const parts = zonedParts(nowMs, tz);
    wall = parts.hour * 60 + parts.minute;
  } catch (error) {
    if (error instanceof RangeError) return { due: null, reason: 'badContext' };
    throw error;
  }

  const prefs = resolveReminderPrefs(p.reminders);
  const quiet = quietWindowFor({ prefs, days: input.days, meals: input.meals, today, tz, rolloverHour: rollover });
  if (isQuietAt(quiet, wall)) return { due: null, reason: 'quiet' };
  if (asleepNow({ days: input.days, meals: input.meals, today, nowMs })) return { due: null, reason: 'asleep' };
  const lastSent = input.sent.reduce((max, s) => Math.max(max, Number.isFinite(msOf(s.at)) ? msOf(s.at) : -Infinity), -Infinity);
  if (nowMs - lastSent < MIN_SPACING_MIN * MS_PER_MINUTE) return { due: null, reason: 'spacing' };

  const meals = input.meals.filter((m) => m.guess !== true && Number.isFinite(msOf(m.at)));
  const c: Context = {
    input,
    nowMs,
    tz,
    rollover,
    today,
    startedOn: p.startedOn,
    prefs,
    wall,
    nowLogical: wallToLogical(wall, rollover),
    active: meals.some((m) => m.day >= addDays(today, -ACTIVE_WITHIN_DAYS)),
    meals,
  };
  const sentKeys = new Set(input.sent.map((s) => `${s.kind}|${s.date}`));
  for (const candidate of CANDIDATES) {
    const found = candidate(c);
    if (found && !sentKeys.has(`${found.kind}|${found.localDate}`)) return { due: found };
  }
  return { due: null, reason: 'nothingDue' };
}
