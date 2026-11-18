// @vitest-environment node
import { createDb, type KiraMakanDb } from '@/db/db';
import { updateGoalPeriod } from '@/db/repo';
import { setDemoClock } from '@/domain/clock';
import { loadMaintenanceWorld, MAINTENANCE_WORLD as W, type MaintenanceWorldOptions } from '@/test/maintenanceWorld';
import { getPlanView } from './planProgress';

/**
 * The maintenance world: a Cut that began Mon 7 Sep (2,350 maintenance, 1,800 a day, pace 0.5 kg a
 * week), 1,822 logged on all 53 finished days, and a trend losing 0.25 kg a week. Today is Fri 30 Oct.
 */
const opened: KiraMakanDb[] = [];

async function open(opts?: MaintenanceWorldOptions): Promise<KiraMakanDb> {
  const db = createDb(`plan-${crypto.randomUUID()}`);
  opened.push(db);
  await loadMaintenanceWorld(db, opts);
  return db;
}

afterEach(async () => {
  setDemoClock(false);
  await Promise.all(opened.splice(0).map((d) => d.delete()));
});

describe('getPlanView', () => {
  it('has nothing to read without a profile', async () => {
    const db = createDb(`plan-${crypto.randomUUID()}`);
    opened.push(db);
    expect(await getPlanView(db, { today: W.today })).toBeUndefined();
  });

  it('reads the plan from the first day of the goal period, with its target and pace', async () => {
    const view = await getPlanView(await open(), { today: W.today });
    expect(view).toMatchObject({ start: '2026-09-07', paused: false, paceKgPerWeek: 0.5 });
    expect(view?.goal.name).toBe('Cut');
    expect(view?.version.dailyKcal).toBe(1800);
    expect(view?.progress.daysIn).toBe(53);
  });

  it('sets the weight trend against the line the plan draws', async () => {
    const { progress } = (await getPlanView(await open(), { today: W.today }))!;
    const { weight } = progress;
    // 0.5 a week up to the last weigh-in (yesterday, day 52) expects −3.7 kg; a trend losing 0.25 a week is well short.
    expect(weight.verdict).toBe('behind');
    expect(weight.startKg).toBeCloseTo(80);
    expect(weight.trendDays).toBe(52);
    expect(weight.expectedChangeKg).toBeCloseTo(-(0.5 * 52) / 7, 5);
    expect(weight.behindKg).toBeGreaterThan(1.5);
    expect(weight.actualPaceKgPerWeek).toBeCloseTo(0.25, 1);
  });

  it('is on track when the trend falls as fast as the plan', async () => {
    const { progress } = (await getPlanView(await open({ kgPerWeek: 0.5 }), { today: W.today }))!;
    expect(progress.weight.verdict).toBe('onTrack');
  });

  it('adds up how far over or under budget the finished days ended', async () => {
    const { progress } = (await getPlanView(await open(), { today: W.today }))!;
    // 1,822 eaten against 1,800 on each of 53 days.
    expect(progress.energy).toMatchObject({ countedDays: 53, withinBudgetDays: 0, underKcal: -22 * 53 });
    expect(progress.workouts.addedKcal).toBe(0);
  });

  it('counts workouts into each day\'s budget, and shows the same days without them', async () => {
    const { progress } = (await getPlanView(await open({ workoutKcal: 100 }), { today: W.today }))!;
    expect(progress.workouts).toMatchObject({ addedKcal: 5300, days: 53, underWithoutKcal: -22 * 53, underWithKcal: 5300 - 22 * 53 });
    expect(progress.energy.withinBudgetDays).toBe(53);
  });

  it('checks the logs against the weight: 528 under maintenance logged, 275 on the scale', async () => {
    const { progress } = (await getPlanView(await open(), { today: W.today }))!;
    const { check } = progress;
    expect(check.state).toBe('ready');
    expect(check.loggedDeficitKcal).toBeCloseTo(2350 - 1822);
    expect(check.weightDeficitKcal).toBeCloseTo((0.25 * 7700) / 7, -1);
    expect(check.read).toBe('logsAhead');
  });

  it('reads only from the goal period in force, not the days before it', async () => {
    const db = await open();
    await updateGoalPeriod(db, W.ids.period, { from: '2026-10-05' });
    const view = await getPlanView(db, { today: W.today });
    expect(view?.start).toBe('2026-10-05');
    expect(view?.progress.daysIn).toBe(25);
    expect(view?.progress.energy.countedDays).toBe(25);
    expect(view?.progress.weight.startKg).toBeCloseTo(79.3, 0);
  });

  it('has no days to count on the first day, and says so without failing', async () => {
    const view = await getPlanView(await open({ startedOn: W.today }), { today: W.today });
    expect(view?.progress.daysIn).toBe(0);
    expect(view?.progress.energy.countedDays).toBe(0);
    expect(view?.progress.check.state).toBe('locked');
  });
});
