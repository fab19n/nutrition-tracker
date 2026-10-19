import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BONUS_LIMITS } from '@/components/OneOffBonus/bonusForm';
import { MINUTES } from '@/components/WorkoutForm/workoutOptions';
import { createActions } from '@/db/actions';
import { createDb, type KiraMakanDb } from '@/db/db';
import { putBonus, putDayRecord, putWorkout } from '@/db/repo';
import { getWeekBudget } from '@/db/selectors';
import { DEMO_EXPECTED, DEMO_IDS } from '@/db/seed/demo';
import { setDemoClock } from '@/domain/clock';
import type { OneOffBonus, Workout } from '@/domain/types';
import {
  BONUS_KCAL,
  BONUS_REASON_MAX,
  LAST_WEEK_CLOSED_NOTE,
  WORKOUT_MINUTES,
  deleteActivityEntryIn,
  getActivity,
  getEstimateWeightKg,
  getWorkoutContext,
  getWorkoutDayChoice,
  groupActivityByWeek,
  isConfirmedDay,
  logBonusIn,
  logWorkoutIn,
  workoutDayChoice,
} from './activity';

let db: KiraMakanDb;
let seq = 0;

const TODAY = DEMO_EXPECTED.today.day; // Fri 16 Oct 2026
const THIS_WEEK = DEMO_EXPECTED.weekStart; // Mon 12 Oct
const LAST_WEEK = DEMO_EXPECTED.lastWeekStart; // Mon 5 Oct

function workout(id: string, logicalDay: string, netKcal: number, createdAt = `${logicalDay}T12:00:00.000Z`): Workout {
  return { id, logicalDay, type: 'futsal', minutes: 60, intensity: 'moderate', netKcal, createdAt };
}

function bonus(id: string, logicalDay: string, kcal: number, reason = 'A hike'): OneOffBonus {
  return { id, logicalDay, kcal, reason, createdAt: `${logicalDay}T13:00:00.000Z` };
}

beforeEach(async () => {
  seq += 1;
  db = createDb(`activity-test-${seq}`);
  await createActions(db).loadDemoData();
});

afterEach(async () => {
  setDemoClock(false);
  db.close();
  await db.delete();
});

describe('limits', () => {
  it('match the form components', () => {
    expect(WORKOUT_MINUTES).toEqual(MINUTES);
    expect(BONUS_KCAL).toEqual({ min: BONUS_LIMITS.minKcal, max: BONUS_LIMITS.maxKcal });
    expect(BONUS_REASON_MAX).toBe(BONUS_LIMITS.maxReason);
  });
});

describe('groupActivityByWeek', () => {
  it('always has this week, then weeks with entries newest first, with kcal added per week', () => {
    const view = groupActivityByWeek(
      [workout('w1', '2026-10-06', 470), workout('w2', '2026-09-29', 300), workout('w3', '2026-10-08', 200)],
      [bonus('b1', '2026-10-10', 300)],
      TODAY,
    );
    expect(view.hasAny).toBe(true);
    expect(view.weeks.map((w) => [w.weekStart, w.kind, w.workoutsKcal, w.bonusKcal, w.addedKcal])).toEqual([
      [THIS_WEEK, 'thisWeek', 0, 0, 0],
      [LAST_WEEK, 'lastWeek', 670, 300, 970],
      ['2026-09-28', 'older', 300, 0, 300],
    ]);
    expect(view.weeks[0]?.entries).toEqual([]);
    expect(view.weeks[1]?.weekEnd).toBe('2026-10-11');
    // Newest first: Sat bonus, Thu workout, Tue workout.
    expect(view.weeks[1]?.entries.map((e) => [e.kind, e.id, e.day, e.kcal])).toEqual([
      ['bonus', 'b1', '2026-10-10', 300],
      ['workout', 'w3', '2026-10-08', 200],
      ['workout', 'w1', '2026-10-06', 470],
    ]);
  });

  it('orders a day by when it was logged, and is empty with nothing logged', () => {
    const view = groupActivityByWeek(
      [workout('early', TODAY, 100, '2026-10-16T01:00:00.000Z'), workout('late', TODAY, 200, '2026-10-16T09:00:00.000Z')],
      [],
      TODAY,
    );
    expect(view.weeks[0]?.entries.map((e) => e.id)).toEqual(['late', 'early']);
    expect(view.weeks[0]?.addedKcal).toBe(300);

    const empty = groupActivityByWeek([], [], TODAY);
    expect(empty.hasAny).toBe(false);
    expect(empty.weeks).toHaveLength(1);
    expect(empty.weeks[0]).toMatchObject({ kind: 'thisWeek', addedKcal: 0, closed: false, entries: [] });
  });

  it('closes past weeks with no day on offer; this week never closes', () => {
    const entries = [workout('w-last', '2026-10-06', 470), workout('w-old', '2026-09-29', 300)];
    const closed = (view: ReturnType<typeof groupActivityByWeek>) => view.weeks.map((w) => [w.kind, w.closed]);

    // A Friday: only this week's days are on offer.
    expect(closed(groupActivityByWeek(entries, [], TODAY, [TODAY, '2026-10-15']))).toEqual([
      ['thisWeek', false],
      ['lastWeek', true],
      ['older', true],
    ]);
    // A Monday with yesterday still unconfirmed: last week is open too.
    const monday = '2026-10-12';
    expect(closed(groupActivityByWeek(entries, [], monday, [monday, '2026-10-11']))).toEqual([
      ['thisWeek', false],
      ['lastWeek', false],
      ['older', true],
    ]);
    // Without the days on offer, only this week is open.
    expect(closed(groupActivityByWeek(entries, [], monday))).toEqual([
      ['thisWeek', false],
      ['lastWeek', true],
      ['older', true],
    ]);
  });
});

describe('getActivity', () => {
  it("shows the demo's last-week futsal (+470) and an empty this week", async () => {
    const view = await getActivity(db);
    expect(view.today).toBe(TODAY);
    expect(view.hasAny).toBe(true);
    expect(view.weeks.map((w) => [w.kind, w.addedKcal])).toEqual([
      ['thisWeek', 0],
      ['lastWeek', 470],
    ]);
    const [entry] = view.weeks[1]?.entries ?? [];
    expect(entry).toMatchObject({ kind: 'workout', id: DEMO_IDS.workouts.futsal, day: DEMO_EXPECTED.lastWeek.futsal.day, kcal: 470 });
    // Friday: last week has closed (no adds there), so a delete there is confirmed first.
    expect(view.weeks.map((w) => w.closed)).toEqual([false, true]);
  });

  it('keeps last week open on a Monday until yesterday is confirmed', async () => {
    const monday = '2026-10-19';
    await putWorkout(db, workout('w-sun', '2026-10-18', 300));
    expect((await getActivity(db, { today: monday })).weeks.map((w) => [w.kind, w.closed])).toEqual([
      ['thisWeek', false],
      ['lastWeek', false],
      ['older', true],
    ]);
    await putDayRecord(db, { logicalDay: '2026-10-18', status: 'complete', confirmedAt: '2026-10-19T01:00:00.000Z' });
    expect((await getActivity(db, { today: monday })).weeks.map((w) => [w.kind, w.closed])).toEqual([
      ['thisWeek', false],
      ['lastWeek', true],
      ['older', true],
    ]);
  });

  it('includes bonuses', async () => {
    await putBonus(db, bonus('b-sat', '2026-10-10', 300));
    await putBonus(db, bonus('b-today', TODAY, 250, 'Futsal tournament'));
    const view = await getActivity(db);
    expect(view.weeks.map((w) => [w.kind, w.workoutsKcal, w.bonusKcal, w.addedKcal])).toEqual([
      ['thisWeek', 0, 250, 250],
      ['lastWeek', 470, 300, 770],
    ]);
  });
});

describe('getEstimateWeightKg', () => {
  it('uses the latest weigh-in, else the setup weight, else nothing', async () => {
    expect(await getEstimateWeightKg(db)).toBe(77.8);
    await db.weights.clear();
    expect(await getEstimateWeightKg(db)).toBe(78.6);
    await db.profile.clear();
    expect(await getEstimateWeightKg(db)).toBeUndefined();
  });
});

describe('workoutDayChoice', () => {
  it('offers today back to Monday, never a future day', () => {
    const choice = workoutDayChoice({ today: TODAY });
    expect(choice.options).toEqual([
      { day: '2026-10-16', label: 'Today' },
      { day: '2026-10-15', label: 'Yesterday' },
      { day: '2026-10-14', label: 'Wed' },
      { day: '2026-10-13', label: 'Tue' },
      { day: '2026-10-12', label: 'Mon' },
    ]);
    expect(choice.limitNote).toBeUndefined();
  });

  it('on a Monday offers yesterday only while it is unconfirmed', () => {
    const monday = '2026-10-19';
    expect(workoutDayChoice({ today: monday }).options.map((o) => o.label)).toEqual(['Today', 'Yesterday']);
    expect(workoutDayChoice({ today: monday, yesterdayRecord: { status: 'unconfirmed' } }).options).toHaveLength(2);

    const closed = workoutDayChoice({ today: monday, yesterdayRecord: { status: 'complete' } });
    expect(closed.options).toEqual([{ day: monday, label: 'Today' }]);
    expect(closed.limitNote).toBe(LAST_WEEK_CLOSED_NOTE);
    expect(workoutDayChoice({ today: monday, yesterdayRecord: { status: 'notCounted' } }).limitNote).toBe(LAST_WEEK_CLOSED_NOTE);
  });

  it('never goes before the first day the app was used', () => {
    expect(workoutDayChoice({ today: TODAY, startedOn: '2026-10-14' }).options.map((o) => o.label)).toEqual(['Today', 'Yesterday', 'Wed']);
    // Started today, a Monday: nothing before it, and nothing to explain.
    const fresh = workoutDayChoice({ today: '2026-10-19', startedOn: '2026-10-19', yesterdayRecord: { status: 'complete' } });
    expect(fresh.options.map((o) => o.label)).toEqual(['Today']);
    expect(fresh.limitNote).toBeUndefined();
  });

  it('treats a missing or unconfirmed record as open', () => {
    expect(isConfirmedDay(undefined)).toBe(false);
    expect(isConfirmedDay({ status: 'unconfirmed' })).toBe(false);
    expect(isConfirmedDay({ status: 'guess' })).toBe(true);
  });
});

describe('getWorkoutDayChoice / getWorkoutContext', () => {
  it('reads the demo Friday: five days, the weight and the last workout', async () => {
    const choice = await getWorkoutDayChoice(db);
    expect(choice.options.map((o) => o.label)).toEqual(['Today', 'Yesterday', 'Wed', 'Tue', 'Mon']);

    const context = await getWorkoutContext(db);
    expect(context).toMatchObject({ today: TODAY, weightKg: 77.8 });
    expect(context.lastWorkout?.id).toBe(DEMO_IDS.workouts.futsal);
  });

  it('checks yesterday’s record across the week line', async () => {
    const monday = '2026-10-19';
    expect((await getWorkoutDayChoice(db, { today: monday })).options.map((o) => o.label)).toEqual(['Today', 'Yesterday']);
    await putDayRecord(db, { logicalDay: '2026-10-18', status: 'complete', confirmedAt: '2026-10-19T01:00:00.000Z' });
    const closed = await getWorkoutDayChoice(db, { today: monday });
    expect(closed.options.map((o) => o.label)).toEqual(['Today']);
    expect(closed.limitNote).toBe(LAST_WEEK_CLOSED_NOTE);
  });
});

describe('logWorkoutIn', () => {
  it('adds futsal, moderate, 60 min as ~470 to this week, and the undo removes it', async () => {
    const before = await getWeekBudget(db);
    expect(before?.budget.workoutsKcal).toBe(0);

    const { workout: saved, undo } = await logWorkoutIn(db, { type: 'futsal', intensity: 'moderate', minutes: 60 });
    expect(saved).toMatchObject({ logicalDay: TODAY, type: 'futsal', intensity: 'moderate', minutes: 60, netKcal: 470 });
    const after = await getWeekBudget(db);
    expect(after?.budget.workoutsKcal).toBe(470);
    expect(after?.budget.leftTodayKcal).toBe((before?.budget.leftTodayKcal ?? 0) + 470);
    expect((await getActivity(db)).weeks[0]?.addedKcal).toBe(470);

    await undo();
    expect(await db.workouts.get(saved.id)).toBeUndefined();
    expect((await getWeekBudget(db))?.budget.workoutsKcal).toBe(0);
  });

  it('goes on an earlier day this week', async () => {
    const { workout: saved } = await logWorkoutIn(db, { type: 'walking', intensity: 'easy', minutes: 30, day: '2026-10-13' });
    expect(saved.logicalDay).toBe('2026-10-13');
    // (2.8 − 1) × 77.8 × 0.5 = 70.0
    expect(saved.netKcal).toBe(70);
  });

  it('refuses a future day, a confirmed past week and minutes out of range', async () => {
    await expect(logWorkoutIn(db, { type: 'gym', intensity: 'hard', minutes: 45, day: '2026-10-17' })).rejects.toThrow(RangeError);
    await expect(logWorkoutIn(db, { type: 'gym', intensity: 'hard', minutes: 45, day: '2026-10-11' })).rejects.toThrow(RangeError);
    await expect(logWorkoutIn(db, { type: 'gym', intensity: 'hard', minutes: 4 })).rejects.toThrow(RangeError);
    await expect(logWorkoutIn(db, { type: 'gym', intensity: 'hard', minutes: 301 })).rejects.toThrow(RangeError);
    await expect(logWorkoutIn(db, { type: 'gym', intensity: 'hard', minutes: 30.5 })).rejects.toThrow(RangeError);
    expect(await db.workouts.count()).toBe(DEMO_EXPECTED.counts.workouts);
  });
});

describe('logBonusIn', () => {
  it('adds a trimmed bonus to the week, and the undo removes it', async () => {
    const { bonus: saved, undo } = await logBonusIn(db, { kcal: 300, reason: '  A hike ' });
    expect(saved).toMatchObject({ logicalDay: TODAY, kcal: 300, reason: 'A hike' });
    expect((await getWeekBudget(db))?.budget.bonusKcal).toBe(300);
    await undo();
    expect(await db.bonuses.count()).toBe(0);
  });

  it('refuses amounts and reasons out of range, and days not on offer', async () => {
    await expect(logBonusIn(db, { kcal: 0, reason: '' })).rejects.toThrow(RangeError);
    await expect(logBonusIn(db, { kcal: 3001, reason: '' })).rejects.toThrow(RangeError);
    await expect(logBonusIn(db, { kcal: 300, reason: 'x'.repeat(61) })).rejects.toThrow(RangeError);
    await expect(logBonusIn(db, { kcal: 300, reason: '', day: '2026-10-18' })).rejects.toThrow(RangeError);
    expect(await db.bonuses.count()).toBe(0);
  });
});

describe('deleteActivityEntryIn', () => {
  it('deletes a workout or bonus and puts it back exactly on undo', async () => {
    const original = await db.workouts.get(DEMO_IDS.workouts.futsal);
    const undoWorkout = await deleteActivityEntryIn(db, { kind: 'workout', id: DEMO_IDS.workouts.futsal });
    expect(await db.workouts.count()).toBe(0);
    await undoWorkout();
    expect(await db.workouts.get(DEMO_IDS.workouts.futsal)).toEqual(original);

    const hike = bonus('b1', TODAY, 300);
    await putBonus(db, hike);
    const undoBonus = await deleteActivityEntryIn(db, { kind: 'bonus', id: 'b1' });
    expect(await db.bonuses.count()).toBe(0);
    await undoBonus();
    expect(await db.bonuses.get('b1')).toEqual(hike);
  });

  it('is a no-op for a row that is already gone', async () => {
    await putWorkout(db, workout('gone', TODAY, 100));
    await db.workouts.delete('gone');
    const undo = await deleteActivityEntryIn(db, { kind: 'workout', id: 'gone' });
    await undo();
    expect(await db.workouts.get('gone')).toBeUndefined();
  });
});
