/**
 * Test-only world for the target suggestion (S37): a Cut that started on Mon 7 Sep 2026 with the
 * setup estimate (2,350 maintenance, 1,800 a day), ~1,822 logged on every finished day and a
 * trend losing 0.25 kg a week. On Fri 30 Oct the weekly read (Mon 28 Sep – Sun 25 Oct) finds
 * maintenance ~2,100, so the check suggests 1,550 (or 1,825 at 0.25 kg a week).
 * Never imported by the app.
 */
import { clearAllTables, type KiraMakanDb } from '@/db/db';
import { buildGoal } from '@/db/seed/defaults';
import { setDemoClock } from '@/domain/clock';
import { addDays, compareDays, daysBetween, instantAt } from '@/domain/day';
import type { checkTarget, MaintenanceDay } from '@/domain/maintenance';
import { mealMacros } from '@/domain/meal';
import { weightTrend } from '@/domain/trend';
import type { DayRecord, Goal, GoalPeriod, GoalVersion, LogicalDay, MealLog, Profile, WeightLog, Workout } from '@/domain/types';

export const MAINTENANCE_WORLD = {
  /** Fri 30 Oct 2026, 7:10pm MYT. */
  now: '2026-10-30T11:10:00.000Z',
  today: '2026-10-30',
  tomorrow: '2026-10-31',
  weekStart: '2026-10-26',
  startedOn: '2026-09-07',
  window: { from: '2026-09-28', to: '2026-10-25' },
  nextCheckOn: '2026-11-02',
  ids: { cut: 'goal-cut', pause: 'goal-pause', setupVersion: 'version-cut-setup', period: 'period-cut' },
  expected: {
    maintenanceKcal: 2100,
    avgEatenKcal: 1822,
    suggestedDailyKcal: 1550,
    slowerDailyKcal: 1825,
    weekTotalKcal: 12100,
    keptUntil: '2026-11-27',
    noticeKey: 'version-cut-setup:2026-10-26',
  },
} as const;

/** The weigh-ins count days from this fixed anchor, so moving `startedOn` never changes a reading. */
const WEIGHT_ANCHOR = '2026-09-07';
const TZ = 'Asia/Kuala_Lumpur';

export interface MaintenanceWorldOptions {
  /** Profile, setup version and period; meals and day records start here. Default 7 Sep. */
  startedOn?: LogicalDay;
  /** On every finished day. Default 1,822. */
  eatenKcal?: number;
  /** Lost a week (negative = gaining). Default 0.25. */
  kgPerWeek?: number;
  /** 1 = daily (default), 7 = weekly. */
  weighInEvery?: number;
  /** Default `startedOn`; may be earlier. */
  weighInsFrom?: LogicalDay;
  /** The setup version's maintenance. Default 2,350. */
  maintenanceKcal?: number;
  /** The setup version's target. Default 1,800. */
  dailyKcal?: number;
  /** Default 1,400. */
  dailyMinimumKcal?: number;
  /** The goal's pace. Default the template's (Cut 0.5). */
  paceKgPerWeek?: number;
  template?: 'cut' | 'festive' | 'leanBulk';
  /** A workout on every finished day with this net kcal. Default 0 (none). */
  workoutKcal?: number;
  /** A breakfast at 10:40am today. Default 500. */
  todayMealKcal?: number;
}

export interface MaintenanceWorldRows {
  profile: Profile;
  goals: Goal[];
  goalVersions: GoalVersion[];
  goalPeriods: GoalPeriod[];
  meals: MealLog[];
  days: DayRecord[];
  weights: WeightLog[];
  workouts: Workout[];
}

function dayRange(from: LogicalDay, to: LogicalDay, every = 1): LogicalDay[] {
  const days: LogicalDay[] = [];
  for (let day = from; compareDays(day, to) <= 0; day = addDays(day, every)) days.push(day);
  return days;
}

function meal(id: string, day: LogicalDay, hour: number, minute: number, slot: MealLog['slot'], kcal: number): MealLog {
  const eatenAt = instantAt(day, hour, minute, TZ);
  return {
    id,
    eatenAt,
    logicalDay: day,
    slot,
    name: slot === 'lunch' ? 'Economy rice' : 'Roti canai',
    items: [
      {
        id: `${id}-item`,
        name: slot === 'lunch' ? 'Economy rice' : 'Roti canai',
        unitMacros: { kcal, proteinG: 100, carbsG: 200, fatG: 60 },
        quantity: 1,
        uncertainty: 0.15,
        source: 'catalogue',
      },
    ],
    method: 'manual',
    finished: 'all',
    createdAt: eatenAt,
    updatedAt: eatenAt,
    syncState: 'local',
  };
}

export function buildMaintenanceWorld(opts: MaintenanceWorldOptions = {}): MaintenanceWorldRows {
  const { today, ids } = MAINTENANCE_WORLD;
  const startedOn = opts.startedOn ?? MAINTENANCE_WORLD.startedOn;
  const yesterday = addDays(today, -1);
  const eatenKcal = opts.eatenKcal ?? MAINTENANCE_WORLD.expected.avgEatenKcal;
  const kgPerWeek = opts.kgPerWeek ?? 0.25;
  const template = opts.template ?? 'cut';
  const setupAt = instantAt(startedOn, 9, 10, TZ);
  const finished = dayRange(startedOn, yesterday);

  const profile: Profile = {
    id: 'me',
    age: 30,
    sex: 'male',
    heightCm: 172,
    weightKgAtSetup: 80,
    activity: 'light',
    timeZone: TZ,
    rolloverHour: 5,
    weekStartsOn: 1,
    dailyMinimumKcal: opts.dailyMinimumKcal ?? 1400,
    theme: 'system',
    keepPhotos: false,
    useLocation: false,
    startedOn,
    setupCompletedAt: setupAt,
    demoMode: false,
  };

  const goal = buildGoal(template, { id: ids.cut, status: 'active', createdAt: setupAt });
  if (opts.paceKgPerWeek !== undefined) goal.paceKgPerWeek = opts.paceKgPerWeek;
  const goals = [goal, buildGoal('pause', { id: ids.pause, status: 'template', createdAt: setupAt })];

  // Made at setup, before paces were versioned: no paceKgPerWeek of its own.
  const goalVersions: GoalVersion[] = [
    {
      id: ids.setupVersion,
      goalId: ids.cut,
      effectiveFrom: startedOn,
      dailyKcal: opts.dailyKcal ?? 1800,
      proteinG: 110,
      carbsG: 180,
      fatG: 60,
      maintenanceKcal: opts.maintenanceKcal ?? 2350,
      reason: 'setup',
      createdAt: setupAt,
    },
  ];
  const goalPeriods: GoalPeriod[] = [{ id: ids.period, goalId: ids.cut, from: startedOn }];

  const meals = finished.map((day) => meal(`meal-${day}`, day, 13, 0, 'lunch', eatenKcal));
  const todayMealKcal = opts.todayMealKcal ?? 500;
  if (todayMealKcal > 0) meals.push(meal(`meal-${today}-breakfast`, today, 10, 40, 'breakfast', todayMealKcal));

  const days: DayRecord[] = finished.map((day) => ({
    logicalDay: day,
    status: 'complete',
    confirmedAt: instantAt(addDays(day, 1), 9, 0, TZ),
  }));

  const weights: WeightLog[] = dayRange(opts.weighInsFrom ?? startedOn, yesterday, opts.weighInEvery ?? 1).map((day) => ({
    id: `weight-${day}`,
    measuredAt: instantAt(day, 8, 5, TZ),
    logicalDay: day,
    kg: Math.round((80 - (kgPerWeek / 7) * daysBetween(WEIGHT_ANCHOR, day)) * 10) / 10,
  }));

  const workoutKcal = opts.workoutKcal ?? 0;
  const workouts: Workout[] =
    workoutKcal > 0
      ? finished.map((day) => ({
          id: `workout-${day}`,
          logicalDay: day,
          type: 'walking',
          minutes: 30,
          intensity: 'moderate',
          netKcal: workoutKcal,
          createdAt: instantAt(day, 18, 0, TZ),
        }))
      : [];

  return { profile, goals, goalVersions, goalPeriods, meals, days, weights, workouts };
}

/**
 * What checkTarget reads on `today`, from plain rows (this world or the demo world), the way
 * src/db/targetSuggestion builds it from the database: the 35 days before today, the trend of
 * the weigh-ins so far, the active goal and its newest version.
 */
export function targetCheckInput(
  world: Pick<MaintenanceWorldRows, 'profile' | 'goals' | 'goalVersions' | 'meals' | 'days' | 'weights' | 'workouts'>,
  today: LogicalDay = MAINTENANCE_WORLD.today,
): Parameters<typeof checkTarget>[0] {
  const days: MaintenanceDay[] = dayRange(addDays(today, -35), addDays(today, -1)).map((day) => ({
    day,
    eatenKcal: Math.round(world.meals.filter((m) => m.logicalDay === day).reduce((sum, m) => sum + mealMacros(m).kcal, 0)),
    workoutKcal: world.workouts.filter((w) => w.logicalDay === day).reduce((sum, w) => sum + w.netKcal, 0),
    status: compareDays(day, world.profile.startedOn) < 0 ? null : (world.days.find((d) => d.logicalDay === day)?.status ?? null),
  }));
  const goal = world.goals.find((g) => g.status === 'active');
  const latest = world.goalVersions.filter((v) => v.goalId === goal?.id).at(-1);
  return {
    today,
    days,
    trend: weightTrend(world.weights.filter((w) => compareDays(w.logicalDay, today) < 0)),
    ...(goal ? { goal } : {}),
    ...(latest ? { latest } : {}),
    dailyMinimumKcal: world.profile.dailyMinimumKcal,
  };
}

/** Empties the database, then writes the world in one transaction. */
export async function loadMaintenanceWorld(db: KiraMakanDb, opts?: MaintenanceWorldOptions): Promise<MaintenanceWorldRows> {
  const world = buildMaintenanceWorld(opts);
  await clearAllTables(db);
  await db.transaction('rw', [db.profile, db.goals, db.goalVersions, db.goalPeriods, db.meals, db.days, db.weights, db.workouts], async () => {
    await db.profile.put(world.profile);
    await db.goals.bulkPut(world.goals);
    await db.goalVersions.bulkPut(world.goalVersions);
    await db.goalPeriods.bulkPut(world.goalPeriods);
    await db.meals.bulkPut(world.meals);
    await db.days.bulkPut(world.days);
    await db.weights.bulkPut(world.weights);
    await db.workouts.bulkPut(world.workouts);
  });
  return world;
}

/**
 * The real (non-demo) clock pinned to `iso` (default Fri 30 Oct, 7:10pm MYT). Only Date is faked,
 * so timers still run. Pair with vi.useRealTimers() in afterEach.
 */
export function pinClock(iso: string = MAINTENANCE_WORLD.now): void {
  setDemoClock(false);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso));
}
