import { addDays, compareDays, instantAt } from '@/domain/day';
import type { Instant, LogicalDay } from '@/domain/types';

/** The demo world lives in Malaysia (UTC+8 all year), whatever the device's zone. */
const DEMO_TZ = 'Asia/Kuala_Lumpur';

/**
 * A Malaysian wall-clock time on `day` as a UTC instant. Hours from 24 run into the next
 * calendar day, so `myt('2026-10-09', 24, 30)` is 12:30am on Sat 10 Oct.
 */
export function myt(day: LogicalDay, hour: number, minute = 0): Instant {
  return instantAt(day, hour, minute, DEMO_TZ);
}

/** `myt` from an 'HH:MM' string, e.g. '24:30' for half past midnight. */
export function mytAt(day: LogicalDay, time: string): Instant {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!match) throw new Error(`Not an HH:MM time: ${time}`);
  return myt(day, Number(match[1]), Number(match[2]));
}

/** Every calendar day from `from` to `to`, both inclusive. */
export function dayRange(from: LogicalDay, to: LogicalDay): LogicalDay[] {
  const days: LogicalDay[] = [];
  for (let day = from; compareDays(day, to) <= 0; day = addDays(day, 1)) days.push(day);
  return days;
}

/** Instants are ISO strings; this adds minutes and keeps the same format. */
export function addMinutes(at: Instant, minutes: number): Instant {
  return new Date(Date.parse(at) + minutes * 60_000).toISOString();
}
