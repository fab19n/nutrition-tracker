/**
 * Every number, time and date the UI shows goes through these (design_handoff §10.2).
 * Negative numbers use the true minus sign (U+2212) and ranges use an en dash (U+2013).
 */
import { DEFAULT_TZ, MINUTES_PER_DAY, dayParts, daysBetween, weekdayIndex, zonedParts } from './day';
import type { Instant, KcalRange, LogicalDay } from './types';

const MINUS = '−';
const EN_DASH = '–';
const PLACEHOLDER = '—';

const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
// Fixed English labels: ICU prints "Sept" for en-GB, the design uses "Sep".
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

const groupedInt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const money = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Avoids "-0" leaking into the UI after rounding. */
function noNegativeZero(n: number): number {
  return n === 0 ? 0 : n;
}

export function roundTo10(n: number): number {
  return noNegativeZero(Math.round(n / 10) * 10);
}

export function roundTo5(n: number): number {
  return noNegativeZero(Math.round(n / 5) * 5);
}

function signOf(rounded: number, n: number): '' | '+' | typeof MINUS {
  if (rounded === 0) return '';
  return n < 0 ? MINUS : '+';
}

/** 1800 → '1,800'; −120 → '−120'. */
export function fmtInt(n: number): string {
  if (!Number.isFinite(n)) return PLACEHOLDER;
  const rounded = Math.round(Math.abs(n));
  return `${rounded !== 0 && n < 0 ? MINUS : ''}${groupedInt.format(rounded)}`;
}

/** 650 → '+650'; −120 → '−120'; 0 → '0'. */
export function fmtSigned(n: number): string {
  if (!Number.isFinite(n)) return PLACEHOLDER;
  const rounded = Math.round(Math.abs(n));
  return `${signOf(rounded, n)}${groupedInt.format(rounded)}`;
}

export function fmtKcal(n: number): string {
  return `${fmtInt(n)} kcal`;
}

/** 560 → '~560'. Round estimates with roundTo10 first where the copy calls for it. */
export function fmtApprox(n: number): string {
  return `~${fmtInt(n)}`;
}

/** {low: 750, high: 1010} → '750–1,010'. */
export function fmtRange(range: KcalRange): string {
  return `${fmtInt(range.low)}${EN_DASH}${fmtInt(range.high)}`;
}

/** 42 → '42g'. */
export function fmtGrams(n: number): string {
  return `${fmtInt(n)}g`;
}

function fmtOneDecimal(n: number, signed: boolean): string {
  if (!Number.isFinite(n)) return PLACEHOLDER;
  const tenths = Math.round(Math.abs(n) * 10);
  const sign = signOf(tenths, n);
  const text = (tenths / 10).toFixed(1);
  if (sign === MINUS) return `${MINUS}${text}`;
  return signed ? `${sign}${text}` : text;
}

/** 77.9 → '77.9 kg'. */
export function fmtKg(kg: number): string {
  return `${fmtOneDecimal(kg, false)} kg`;
}

/** −0.4 → '−0.4 kg'; 0.3 → '+0.3 kg'. */
export function fmtKgDelta(kg: number): string {
  return `${fmtOneDecimal(kg, true)} kg`;
}

/** 9.5 → 'RM 9.50'. */
export function fmtRm(rm: number): string {
  if (!Number.isFinite(rm)) return `RM ${PLACEHOLDER}`;
  const cents = Math.round(Math.abs(rm) * 100);
  const text = money.format(cents / 100);
  return cents !== 0 && rm < 0 ? `${MINUS}RM ${text}` : `RM ${text}`;
}

/**
 * Minutes after midnight as a 12-hour clock: 640 → '10:40am', 1150 → '7:10pm', 5 → '12:05am'.
 * `compact` drops ':00' on the hour ('9pm', '5am') for captions and "usually around" copy.
 */
export function fmtClock(minutesAfterMidnight: number, opts: { compact?: boolean } = {}): string {
  const total = ((Math.round(minutesAfterMidnight) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hour = Math.floor(total / 60);
  const minute = total % 60;
  const suffix = hour < 12 ? 'am' : 'pm';
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  if (opts.compact && minute === 0) return `${hour12}${suffix}`;
  return `${hour12}:${String(minute).padStart(2, '0')}${suffix}`;
}

/** The wall-clock time of an instant in `tz`: '10:40am', '7:10pm', '12:05am'. */
export function fmtTime(at: Instant | Date, tz: string = DEFAULT_TZ): string {
  const p = zonedParts(at, tz);
  return fmtClock(p.hour * 60 + p.minute);
}

function monthShort(month: number): string {
  return MONTH_SHORT[month - 1] ?? '';
}

/** '2026-10-16' → 'Fri'. */
export function fmtWeekday(day: LogicalDay): string {
  return WEEKDAY_SHORT[weekdayIndex(day)] ?? '';
}

/** '2026-10-16' → 'F'. */
export function fmtDayLetter(day: LogicalDay): string {
  return fmtWeekday(day).charAt(0);
}

/** '2026-10-16' → 'Fri 16 Oct'. */
export function fmtDayShort(day: LogicalDay): string {
  const p = dayParts(day);
  return `${fmtWeekday(day)} ${p.day} ${monthShort(p.month)}`;
}

/** '2026-10-12', '2026-10-18' → '12–18 Oct'; across months '28 Sep–4 Oct'. */
export function fmtDayRange(start: LogicalDay, end: LogicalDay): string {
  const a = dayParts(start);
  const b = dayParts(end);
  if (a.year === b.year && a.month === b.month) {
    return `${a.day}${EN_DASH}${b.day} ${monthShort(b.month)}`;
  }
  return `${a.day} ${monthShort(a.month)}${EN_DASH}${b.day} ${monthShort(b.month)}`;
}

/** 'Today', 'Yesterday', 'Tomorrow', the weekday within the surrounding week, else 'Fri 16 Oct'. */
export function fmtRelativeDay(day: LogicalDay, today: LogicalDay): string {
  const offset = daysBetween(today, day);
  if (offset === 0) return 'Today';
  if (offset === -1) return 'Yesterday';
  if (offset === 1) return 'Tomorrow';
  if (Math.abs(offset) < 7) return fmtWeekday(day);
  return fmtDayShort(day);
}
