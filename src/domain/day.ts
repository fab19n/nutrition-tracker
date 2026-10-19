/**
 * Logical days and time-zone arithmetic.
 *
 * A `LogicalDay` is a calendar date ('YYYY-MM-DD') in the user's zone after applying the
 * rollover hour, so a 2am supper belongs to the previous day (plan §9.9, §17.4).
 * Calendar maths on LogicalDay values is zone-free (they are plain dates); converting
 * between instants and wall-clock time goes through Intl.DateTimeFormat.
 */
import type { Instant, LogicalDay } from './types';

export const DEFAULT_TZ = 'Asia/Kuala_Lumpur';
export const DEFAULT_ROLLOVER_HOUR = 5;

export const MINUTES_PER_DAY = 1440;
const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;
const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Wall-clock parts of an instant in a zone. `weekday` is Mon = 0 … Sun = 6, like `weekdayIndex`. */
export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

const WEEKDAY_FROM_SHORT: Readonly<Record<string, number>> = {
  Mon: 0,
  Tue: 1,
  Wed: 2,
  Thu: 3,
  Fri: 4,
  Sat: 5,
  Sun: 6,
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat {
  let formatter = formatters.get(tz);
  if (!formatter) {
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

function toDate(at: Date | Instant): Date {
  const date = typeof at === 'string' ? new Date(at) : at;
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`Invalid instant: ${String(at)}`);
  }
  return date;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Calendar parts of a LogicalDay. Throws on anything that isn't a real 'YYYY-MM-DD' date. */
export function dayParts(day: LogicalDay): { year: number; month: number; day: number } {
  const match = DAY_PATTERN.exec(day);
  if (!match) throw new RangeError(`Invalid logical day: ${day}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, date));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== date) {
    throw new RangeError(`Invalid logical day: ${day}`);
  }
  return { year, month, day: date };
}

/** UTC midnight of the calendar date, used for zone-free calendar arithmetic. */
function dayToUtcMs(day: LogicalDay): number {
  const p = dayParts(day);
  return Date.UTC(p.year, p.month - 1, p.day);
}

function utcMsToDay(ms: number): LogicalDay {
  const d = new Date(ms);
  return `${String(d.getUTCFullYear()).padStart(4, '0')}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function zonedParts(at: Date | Instant, tz: string = DEFAULT_TZ): ZonedParts {
  const values: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const part of formatterFor(tz).formatToParts(toDate(at))) {
    values[part.type] = part.value;
  }
  // Some engines still print midnight as "24" even with h23.
  const hour = Number(values.hour) % 24;
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour,
    minute: Number(values.minute),
    weekday: WEEKDAY_FROM_SHORT[values.weekday ?? ''] ?? 0,
  };
}

export function logicalDayOf(
  at: Date | Instant,
  tz: string = DEFAULT_TZ,
  rolloverHour: number = DEFAULT_ROLLOVER_HOUR,
): LogicalDay {
  const p = zonedParts(at, tz);
  const calendarDay = `${String(p.year).padStart(4, '0')}-${pad2(p.month)}-${pad2(p.day)}`;
  return p.hour < rolloverHour ? addDays(calendarDay, -1) : calendarDay;
}

export function addDays(day: LogicalDay, n: number): LogicalDay {
  return utcMsToDay(dayToUtcMs(day) + Math.trunc(n) * MS_PER_DAY);
}

/** Whole days from `from` to `to` (to − from). */
export function daysBetween(from: LogicalDay, to: LogicalDay): number {
  return Math.round((dayToUtcMs(to) - dayToUtcMs(from)) / MS_PER_DAY);
}

export function compareDays(a: LogicalDay, b: LogicalDay): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Mon = 0 … Sun = 6. */
export function weekdayIndex(day: LogicalDay): number {
  return (new Date(dayToUtcMs(day)).getUTCDay() + 6) % 7;
}

/** The Monday of the budget week containing `day`. */
export function weekStartOf(day: LogicalDay): LogicalDay {
  return addDays(day, -weekdayIndex(day));
}

/** The 7 days Mon … Sun starting at `weekStart`. */
export function weekDays(weekStart: LogicalDay): LogicalDay[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

/** Minutes since the rollover, 0 … 1439 (5:00am → 0, 4:59am → 1439 with the default rollover). */
export function minutesIntoLogicalDay(
  at: Date | Instant,
  tz: string = DEFAULT_TZ,
  rolloverHour: number = DEFAULT_ROLLOVER_HOUR,
): number {
  const p = zonedParts(at, tz);
  return wallToLogicalMinutes(p.hour * 60 + p.minute, rolloverHour);
}

/** Converts minutes after midnight into minutes after the rollover. */
export function wallToLogicalMinutes(wallMinutes: number, rolloverHour: number = DEFAULT_ROLLOVER_HOUR): number {
  return mod(wallMinutes - rolloverHour * 60, MINUTES_PER_DAY);
}

/** Converts minutes after the rollover back into minutes after midnight. */
export function logicalToWallMinutes(logicalMinutes: number, rolloverHour: number = DEFAULT_ROLLOVER_HOUR): number {
  return mod(logicalMinutes + rolloverHour * 60, MINUTES_PER_DAY);
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/** Offset of the zone from UTC at `ms`, in ms (Kuala Lumpur: +8 h). */
function zoneOffsetMs(ms: number, tz: string): number {
  const p = zonedParts(new Date(ms), tz);
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return wallAsUtc - Math.floor(ms / MS_PER_MINUTE) * MS_PER_MINUTE;
}

/**
 * The instant at a wall-clock time on the calendar date `day` in `tz`.
 * `hour` may be 24 or more to reach the next calendar date (instantAt(d, 25, 0) = 1am the day after),
 * which is how the end of a logical day is expressed: instantAt(d, rollover + 24, 0).
 */
export function instantAt(day: LogicalDay, hour: number, minute: number, tz: string = DEFAULT_TZ): Instant {
  const wallAsUtc = dayToUtcMs(day) + (hour * 60 + minute) * MS_PER_MINUTE;
  // Two passes settle the offset across DST changes in zones that have them.
  let utc = wallAsUtc - zoneOffsetMs(wallAsUtc, tz);
  utc = wallAsUtc - zoneOffsetMs(utc, tz);
  return new Date(utc).toISOString();
}
