import { DayTimeline } from '@/components/DayTimeline/DayTimeline';
import { MINUTES_PER_DAY, wallToLogicalMinutes } from '@/domain/day';
import { fmtClock } from '@/domain/format';

/** Position of a wall-clock time across the 5am–5am logical day, 0–100. Hours from 24 run past midnight. */
export function pctOfDay(hour: number, minute = 0): number {
  return (wallToLogicalMinutes(hour * 60 + minute) / MINUTES_PER_DAY) * 100;
}

/** Check-in scenario B captions: wake, both meals, sleep. */
export const CHECK_IN_CAPTIONS: readonly string[] = ['woke 10am', fmtClock(11 * 60 + 10), fmtClock(15 * 60 + 40), 'slept 1:30am'];

/**
 * Yesterday in check-in scenario B (design_handoff.md §9): meals at 11:10am and 3:40pm, then a gap
 * over the usual 9pm dinner. Pass `captions` to draw them under the track; CheckInCard draws its own.
 */
export function CheckInTimelineSample({ captions = [] }: { captions?: readonly string[] }) {
  return (
    <DayTimeline
      windowStartPct={pctOfDay(11, 10)}
      windowEndPct={pctOfDay(23, 10)}
      dots={[
        { pct: pctOfDay(11, 10), kcal: 560, tone: 'onTime' },
        { pct: pctOfDay(15, 40), kcal: 680, tone: 'onTime' },
      ]}
      gap={{ startPct: pctOfDay(15, 40), endPct: pctOfDay(25, 30), label: `usual dinner ${fmtClock(21 * 60, { compact: true })}` }}
      captions={[...captions]}
      ariaLabel="Yesterday: meals at 11:10am and 3:40pm, then nothing for 10 hours. You usually have dinner around 9pm."
    />
  );
}
