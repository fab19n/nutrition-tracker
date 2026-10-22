// @vitest-environment node
// The shared reminder module (supabase/functions/_shared/reminders.ts) carries its own copies of the
// day, timing and period helpers, since Deno can't import src/domain. These checks keep them equal.
import { PATHS } from '@/app/paths';
import { buildDemoWorld, DEMO_EXPECTED } from '@/db/seed/demo';
import { NOTIFICATION_PATHS } from '@/push/notificationPaths';
import * as day from './day';
import { periodOn } from './goals';
import * as shared from './reminders';
import { MIN_BASELINE_SAMPLES, USUAL_SLOT_SHARE, slotBaselines } from './timing';
import type { GoalPeriod, MealSlot, ReminderSettings } from './types';

const ZONES = ['Asia/Kuala_Lumpur', 'Europe/London', 'America/New_York', 'Asia/Kolkata', 'Asia/Kathmandu'];
const ROLLOVERS = [0, 3, 5, 6];
const STEP_MS = 37 * 60_000;

/** Every 37 minutes for 3 days around each zone's autumn clock change (London 25 Oct, New York 1 Nov). */
function grid(): number[] {
  const out: number[] = [];
  for (const start of ['2026-10-24T00:00:00.000Z', '2026-10-31T00:00:00.000Z']) {
    const from = Date.parse(start);
    for (let ms = from; ms < from + 3 * 86_400_000; ms += STEP_MS) out.push(ms);
  }
  return out;
}

describe('the shared time helpers', () => {
  it('agree with src/domain/day.ts over zones, rollovers and clock changes', () => {
    let checked = 0;
    for (const tz of ZONES) {
      for (const rollover of ROLLOVERS) {
        for (const ms of grid()) {
          const iso = new Date(ms).toISOString();
          const logical = day.logicalDayOf(iso, tz, rollover);
          expect(shared.logicalDayOf(ms, tz, rollover)).toBe(logical);
          expect(shared.minutesIntoLogicalDay(ms, tz, rollover)).toBe(day.minutesIntoLogicalDay(iso, tz, rollover));
          expect(shared.weekStartOf(logical)).toBe(day.weekStartOf(logical));
          expect(shared.weekdayIndex(logical)).toBe(day.weekdayIndex(logical));
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it('do the same calendar arithmetic', () => {
    for (const d of ['2026-01-01', '2026-02-28', '2026-03-29', '2026-10-25', '2028-02-29', '2026-12-31']) {
      for (const n of [-400, -36, -28, -1, 0, 1, 6, 7, 365]) {
        expect(shared.addDays(d, n)).toBe(day.addDays(d, n));
        expect(shared.daysBetween(d, day.addDays(d, n))).toBe(day.daysBetween(d, day.addDays(d, n)));
      }
    }
    for (let m = 0; m < 1440; m += 15) {
      for (const rollover of ROLLOVERS) {
        expect(shared.wallToLogical(m, rollover)).toBe(day.wallToLogicalMinutes(m, rollover));
        expect(shared.logicalToWall(m, rollover)).toBe(day.logicalToWallMinutes(m, rollover));
      }
    }
  });
});

describe('usual slot times', () => {
  it('match slotBaselines on the demo meals (complete days in the 28 before today)', () => {
    const world = buildDemoWorld();
    const today = DEMO_EXPECTED.today.day;
    const tz = DEMO_EXPECTED.timeZone;
    const rollover = DEMO_EXPECTED.rolloverHour;
    const from = day.addDays(today, -28);
    const yesterday = day.addDays(today, -1);
    const complete = new Set(world.days.filter((d) => d.status === 'complete' && d.logicalDay >= from && d.logicalDay <= yesterday).map((d) => d.logicalDay));
    // Yesterday is complete, so both windows are the same 28 days.
    expect(complete.has(yesterday)).toBe(true);

    const history = world.meals.filter((m) => !m.isGuess && complete.has(m.logicalDay));
    const baselines = slotBaselines(history, tz, rollover);
    const wire = world.meals.map((m) => ({ day: m.logicalDay, at: m.eatenAt, slot: m.slot, guess: m.isGuess === true }));
    const usual = shared.slotUsualTimes(wire, complete, today, tz, rollover);

    let compared = 0;
    for (const slot of ['breakfast', 'lunch', 'snack', 'dinner', 'supper'] as MealSlot[]) {
      const b = baselines[slot];
      const u = usual[slot];
      expect(u.samples).toBe(b.samples);
      if (b.samples === 0) continue;
      expect(shared.logicalToWall(u.medianLogicalMin, rollover)).toBe(b.medianMin);
      expect(u.spreadMin).toBe(b.spreadMin);
      expect(u.share).toBeCloseTo(b.share, 10);
      compared += 1;
    }
    expect(compared).toBeGreaterThanOrEqual(3);
  });

  it('use the same thresholds as timing.ts', () => {
    expect(shared.MIN_SLOT_SAMPLES).toBe(MIN_BASELINE_SAMPLES);
    expect(shared.USUAL_SLOT_SHARE).toBe(USUAL_SLOT_SHARE);
  });
});

describe('pausedOn', () => {
  const goals = [
    { id: 'cut', template: 'cut' },
    { id: 'pause', template: 'pause' },
    { id: 'festive', template: 'festive' },
  ];
  const sets: GoalPeriod[][] = [
    [],
    [{ id: 'p1', goalId: 'cut', from: '2026-10-01' }],
    [{ id: 'p1', goalId: 'pause', from: '2026-10-01', to: '2026-10-10' }, { id: 'p2', goalId: 'cut', from: '2026-10-10' }],
    // Two switches booked for the same day: the later booking wins.
    [
      { id: 'p1', goalId: 'cut', from: '2026-10-05', createdAt: '2026-10-04T10:00:00.000Z' },
      { id: 'p2', goalId: 'pause', from: '2026-10-05', createdAt: '2026-10-04T09:00:00.000Z' },
    ],
    [
      { id: 'p1', goalId: 'cut', from: '2026-10-05', createdAt: '2026-10-04T09:00:00.000Z' },
      { id: 'p2', goalId: 'pause', from: '2026-10-05', createdAt: '2026-10-04T10:00:00.000Z' },
    ],
    // No createdAt on either (older rows): the id decides; and one without createdAt sorts first.
    [
      { id: 'b', goalId: 'cut', from: '2026-10-05' },
      { id: 'a', goalId: 'pause', from: '2026-10-05' },
    ],
    [
      { id: 'a', goalId: 'pause', from: '2026-10-05', createdAt: '2026-10-04T09:00:00.000Z' },
      { id: 'b', goalId: 'festive', from: '2026-10-05' },
    ],
  ];

  it('agrees with periodOn and a Pause template', () => {
    for (const periods of sets) {
      for (const d of ['2026-09-30', '2026-10-01', '2026-10-05', '2026-10-09', '2026-10-10', '2026-11-01']) {
        const p = periodOn(periods, d);
        const expected = p !== undefined && goals.find((g) => g.id === p.goalId)?.template === 'pause';
        expect(shared.pausedOn(d, { days: [], periods, goals })).toBe(expected);
      }
    }
  });
});

describe('the contract with the app', () => {
  it('opens only the paths the app accepts', () => {
    expect(Object.values(shared.NOTIFICATION_URLS).every((url) => NOTIFICATION_PATHS.includes(url))).toBe(true);
    expect(shared.NOTIFICATION_URLS).toEqual({
      checkIn: `${PATHS.today}?sheet=checkin`,
      gap: PATHS.today,
      weeklyReview: PATHS.weekly,
      targetSuggestion: PATHS.target,
      test: PATHS.reminders,
    });
  });

  it('stores the same preferences the profile declares', () => {
    expectTypeOf<ReminderSettings>().toEqualTypeOf<shared.ReminderPrefs>();
    expect(shared.DEFAULT_TZ).toBe(day.DEFAULT_TZ);
    expect(shared.DEFAULT_ROLLOVER_HOUR).toBe(day.DEFAULT_ROLLOVER_HOUR);
  });
});
