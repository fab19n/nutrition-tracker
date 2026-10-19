/**
 * When a meal was eaten, as the Log, Review and Plate chips show it (C19): quick choices,
 * a custom wall-clock time, the check-in's "last night" preset, and the after-midnight hint.
 */
import { DEFAULT_ROLLOVER_HOUR, DEFAULT_TZ, addDays, compareDays, instantAt, logicalDayOf, zonedParts } from '@/domain/day';
import { fmtDayShort, fmtTime, fmtWeekday } from '@/domain/format';
import { suggestSlot } from '@/domain/timing';
import type { Id, Instant, LogicalDay, MealSlot, Profile } from '@/domain/types';

export type TimeId = 'now' | 'm30' | 'h1' | 'preset' | 'custom';

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

/** The TimeChip text for the current choice. `withClock` adds the time to "Now" (Review: "Now · 7:10pm"). */
export function timeChipLabel(ctx: Pick<MealContext, 'timeId' | 'eatenAt'>, current: Date, s: TimeSettings, withClock = false): string {
  if (ctx.timeId === 'now' || !ctx.eatenAt) {
    const label = withClock ? `Now · ${fmtTime(current, s.tz)}` : 'Now';
    // A 1am supper counts toward the day before (C19), "Now" included.
    if (!isAfterMidnight(current, s)) return label;
    return `${label} · counts toward ${fmtWeekday(logicalDayOf(current, s.tz, s.rolloverHour))}`;
  }
  const quick = QUICK_TIMES.find((t) => t.id === ctx.timeId);
  if (quick) return quick.label;
  return absoluteTimeLabel(ctx.eatenAt, current, s);
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
  resume: { placeId?: Id; placeName?: string; eatenAt?: Instant; slot?: MealSlot },
  current: Date,
  s: TimeSettings,
  presetAt?: Instant,
): MealContext {
  const suggested = slotFor(resume.eatenAt, current, s);
  const isPreset = resume.eatenAt !== undefined && presetAt !== undefined && Date.parse(resume.eatenAt) === Date.parse(presetAt);
  const timeId: TimeId = !resume.eatenAt ? 'now' : isPreset ? 'preset' : 'custom';
  const ctx: MealContext = {
    timeId,
    slot: resume.slot ?? suggested,
    slotTouched: resume.slot !== undefined && resume.slot !== suggested,
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
