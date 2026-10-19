/**
 * When a meal was eaten, as the Log, Review and Plate chips show it (C19): quick choices,
 * a custom wall-clock time, the check-in's "last night" preset, the slot's usual time, and the
 * after-midnight hint.
 */
import { DEFAULT_ROLLOVER_HOUR, DEFAULT_TZ, addDays, compareDays, instantAt, logicalDayOf, zonedParts } from '@/domain/day';
import { fmtDayShort, fmtTime, fmtWeekday } from '@/domain/format';
import { suggestSlot } from '@/domain/timing';
import type { Id, Instant, LogicalDay, MealSlot, Profile } from '@/domain/types';

/** 'slot': the time came from picking the meal slot (its usual time), not from the time picker. */
export type TimeId = 'now' | 'm30' | 'h1' | 'preset' | 'custom' | 'slot';

export interface TimeSettings {
  tz: string;
  rolloverHour: number;
}

export function timeSettings(profile: Pick<Profile, 'timeZone' | 'rolloverHour'> | undefined): TimeSettings {
  return { tz: profile?.timeZone ?? DEFAULT_TZ, rolloverHour: profile?.rolloverHour ?? DEFAULT_ROLLOVER_HOUR };
}

/** Place · time · slot for the meal being logged. `eatenAt` undefined means "now" (stamped on save). */
export interface MealContext {
  placeId?: Id;
  /** A typed Place name that isn't saved yet. */
  placeName?: string;
  eatenAt?: Instant;
  timeId: TimeId;
  slot: MealSlot;
  /** The user picked the slot, so a new time no longer re-suggests it. */
  slotTouched: boolean;
}

const MINUTE_MS = 60_000;

export const QUICK_TIMES: readonly { id: Exclude<TimeId, 'preset' | 'custom'>; label: string; minutesAgo: number }[] = [
  { id: 'now', label: 'Now', minutesAgo: 0 },
  { id: 'm30', label: '30 min ago', minutesAgo: 30 },
  { id: 'h1', label: '1 h ago', minutesAgo: 60 },
];

/** A valid ISO instant from a search param, or undefined. */
export function parseInstant(value: string | null | undefined): Instant | undefined {
  if (!value) return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

/** The instant a quick choice stands for; "Now" stays undefined so the save stamps it. */
export function quickTimeAt(id: Exclude<TimeId, 'preset' | 'custom'>, at: Date): Instant | undefined {
  const choice = QUICK_TIMES.find((t) => t.id === id);
  if (!choice || choice.minutesAgo === 0) return undefined;
  return new Date(at.getTime() - choice.minutesAgo * MINUTE_MS).toISOString();
}

function isAfterMidnight(at: Instant | Date, s: TimeSettings): boolean {
  return zonedParts(at, s.tz).hour < s.rolloverHour;
}

/** "Counts toward Thu" for a time between midnight and the rollover. */
export function afterMidnightHint(at: Instant | undefined, s: TimeSettings): string | undefined {
  if (!at || !isAfterMidnight(at, s)) return undefined;
  return `Counts toward ${fmtWeekday(logicalDayOf(at, s.tz, s.rolloverHour))}`;
}

/** "9:00pm", "Last night 9:00pm", "Yesterday 1:30pm", "Wed 9:00pm", "Fri 2 Oct 9:00pm". */
export function absoluteTimeLabel(at: Instant, current: Date, s: TimeSettings): string {
  const day = logicalDayOf(at, s.tz, s.rolloverHour);
  const today = logicalDayOf(current, s.tz, s.rolloverHour);
  const time = fmtTime(at, s.tz);
  if (day === today) {
    return isAfterMidnight(at, s) ? `${time} · counts toward ${fmtWeekday(day)}` : time;
  }
  if (day === addDays(today, -1)) {
    const hour = zonedParts(at, s.tz).hour;
    return hour >= 17 || hour < s.rolloverHour ? `Last night ${time}` : `Yesterday ${time}`;
  }
  const ago = compareDays(addDays(today, -6), day) <= 0 && compareDays(day, today) < 0;
  return `${ago ? fmtWeekday(day) : fmtDayShort(day)} ${time}`;
}

/**
 * The TimeChip text for the current choice, always with a clock time so it reads as a time you
 * can change: "Now · 7:10pm", "30 min ago · 6:40pm", "9:30am", "Last night 11:30pm".
 */
export function timeChipLabel(ctx: Pick<MealContext, 'timeId' | 'eatenAt'>, current: Date, s: TimeSettings): string {
  if (ctx.timeId === 'now' || !ctx.eatenAt) {
    const label = `Now · ${fmtTime(current, s.tz)}`;
    // A 1am supper counts toward the day before (C19), "Now" included.
    if (!isAfterMidnight(current, s)) return label;
    return `${label} · counts toward ${fmtWeekday(logicalDayOf(current, s.tz, s.rolloverHour))}`;
  }
  const quick = QUICK_TIMES.find((t) => t.id === ctx.timeId);
  if (quick) return `${quick.label} · ${fmtTime(ctx.eatenAt, s.tz)}`;
  return absoluteTimeLabel(ctx.eatenAt, current, s);
}

/** Picking a slot moves a "Now" meal to the slot's usual time only when that time is at least this long ago. */
export const SLOT_TIME_MIN_AGO_MINUTES = 120;

/** A snack has no time of its own: one picked at night is as likely now as at its usual hour. */
const ANYTIME_SLOTS: ReadonlySet<MealSlot> = new Set(['snack']);

/**
 * `slot`'s usual time (`usualMinute`, minutes after midnight) on today's logical day, when that
 * was at least 2 hours ago. Undefined for a time later today or too close to now to tell apart
 * from "now", for a snack, and for the slot now itself falls in (re-tapping the Supper chip at
 * 2am is the supper being eaten now, not one at its usual 11:30pm).
 */
export function slotTimeAt(slot: MealSlot, usualMinute: number, current: Date, s: TimeSettings): Instant | undefined {
  if (ANYTIME_SLOTS.has(slot) || slot === slotFor(undefined, current, s)) return undefined;
  const day = logicalDayOf(current, s.tz, s.rolloverHour);
  const hour = Math.floor(usualMinute / 60);
  const at = instantAt(day, hour < s.rolloverHour ? hour + 24 : hour, usualMinute % 60, s.tz);
  return current.getTime() - Date.parse(at) >= SLOT_TIME_MIN_AGO_MINUTES * MINUTE_MS ? at : undefined;
}

/**
 * The context once the user picks `slot`. While the time is still "Now" (or came from an earlier
 * slot pick), an earlier slot moves the meal to its usual time: a meal logged at 9pm as
 * "Breakfast" was this morning's, not a breakfast at 9pm. Any other slot puts the time back to
 * "Now". A time picked by hand is never moved.
 */
export function withSlot(value: MealContext, slot: MealSlot, usualMinute: number, current: Date, s: TimeSettings): MealContext {
  const next: MealContext = { ...value, slot, slotTouched: true };
  if (value.timeId !== 'now' && value.timeId !== 'slot') return next;
  const at = slotTimeAt(slot, usualMinute, current, s);
  if (at) return { ...next, timeId: 'slot', eatenAt: at };
  next.timeId = 'now';
  delete next.eatenAt;
  return next;
}

/** "HH:MM" (24 h) wall-clock time of an instant, for the time input. */
export function wallClockValue(at: Instant | Date, s: TimeSettings): string {
  const p = zonedParts(at, s.tz);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/**
 * A custom "HH:MM" on the logical day `baseDay`: times before the rollover fall on the next
 * calendar date. A time still ahead of now on today means the previous day.
 */
export function customTimeAt(value: string, baseDay: LogicalDay, current: Date, s: TimeSettings): Instant | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return undefined;
  const at = (day: LogicalDay) => instantAt(day, hour < s.rolloverHour ? hour + 24 : hour, minute, s.tz);
  const today = logicalDayOf(current, s.tz, s.rolloverHour);
  const candidate = at(baseDay);
  if (baseDay === today && Date.parse(candidate) > current.getTime() + MINUTE_MS) return at(addDays(baseDay, -1));
  return candidate;
}

export function slotFor(at: Instant | undefined, current: Date, s: TimeSettings): MealSlot {
  return suggestSlot(at ?? current, s.tz, s.rolloverHour);
}

/** The starting context for a new meal: now (or the check-in's preset time), slot suggested. */
export function initialContext(current: Date, s: TimeSettings, presetAt?: Instant): MealContext {
  if (presetAt) return { eatenAt: presetAt, timeId: 'preset', slot: slotFor(presetAt, current, s), slotTouched: false };
  return { timeId: 'now', slot: slotFor(undefined, current, s), slotTouched: false };
}

/**
 * The Log sheet's context picked back up after Cancel on S10: the same Place, time and slot. A
 * time that is also the sheet's preset (?at=) shows as that choice again.
 */
export function resumedContext(
  resume: { placeId?: Id; placeName?: string; eatenAt?: Instant; slot?: MealSlot; timeFromSlot?: boolean },
  current: Date,
  s: TimeSettings,
  presetAt?: Instant,
): MealContext {
  const suggested = slotFor(resume.eatenAt, current, s);
  const isPreset = resume.eatenAt !== undefined && presetAt !== undefined && Date.parse(resume.eatenAt) === Date.parse(presetAt);
  const timeId: TimeId = !resume.eatenAt ? 'now' : isPreset ? 'preset' : resume.timeFromSlot ? 'slot' : 'custom';
  const ctx: MealContext = {
    timeId,
    slot: resume.slot ?? suggested,
    // A slot time only exists because the slot was picked, so it counts as picked too.
    slotTouched: timeId === 'slot' || (resume.slot !== undefined && resume.slot !== suggested),
  };
  if (resume.placeId) ctx.placeId = resume.placeId;
  else if (resume.placeName) ctx.placeName = resume.placeName;
  if (resume.eatenAt) ctx.eatenAt = resume.eatenAt;
  return ctx;
}

/** The logical day a meal at `at` (default now) counts toward. */
export function mealDayOf(at: Instant | undefined, current: Date, s: TimeSettings): LogicalDay {
  return logicalDayOf(at ?? current, s.tz, s.rolloverHour);
}
