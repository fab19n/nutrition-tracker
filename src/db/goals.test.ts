// @vitest-environment node
import { createDb, type KiraMakanDb } from '@/db/db';
import { buildStarterGoals } from '@/db/seed/defaults';
import { DEMO_IDS, buildDemoWorld, loadDemo } from '@/db/seed/demo';
import { getActiveGoal, getCheckIn, getDaySummary, getWeekBudget } from '@/db/selectors';
import { switchedWeek } from '@/domain/budget';
import { setDemoClock } from '@/domain/clock';
import { GoalChangedError, GoalDraftError, goalDraftFor, type GoalDraft } from '@/domain/goals';
import { macrosForTarget, paceOf } from '@/domain/targets';
import type { Goal, GoalTemplate, GoalVersion } from '@/domain/types';
import {
  clearGoalEndNoticeSeen,
  createGoalActions,
  getGoalDetailIn,
  getGoalEndCheckIn,
  getGoalLibraryIn,
  getNewGoalDefaultsIn,
  getSwitchPreviewIn,
  markGoalEndNoticeSeen,
  readGoalEndNoticeSeen,
} from './goals';

const G = DEMO_IDS.goals;
const V = DEMO_IDS.goalVersions;
const CUT_PERIOD = DEMO_IDS.goalPeriods.cut;
const TODAY = '2026-10-16';
const SAT = '2026-10-17';
const at = { today: TODAY };

let db: KiraMakanDb;
let actions: ReturnType<typeof createGoalActions>;
const opened: KiraMakanDb[] = [];

async function open(dbOpts?: Parameters<typeof createDb>[1]): Promise<void> {
  db = createDb(`goals-${crypto.randomUUID()}`, dbOpts);
  opened.push(db);
  actions = createGoalActions(db);
  await loadDemo(db);
}

/** A template's draft with the demo's numbers (maintenance ~2,350, trend 77.99 kg). */
function templateDraft(template: GoalTemplate, name: string): GoalDraft {
  return goalDraftFor(template, { name, maintenanceKcal: 2350, weightKg: 77.99, dailyMinimumKcal: 1400 });
}

/** What S42 would save for a goal with nothing changed, plus `patch`. */
async function draftOf(goalId: string, patch: Partial<GoalDraft> = {}): Promise<GoalDraft> {
  const goal = (await db.goals.get(goalId))!;
  const version = (await db.goalVersions.where('goalId').equals(goalId).toArray()).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom)).at(-1);
  const draft: GoalDraft = {
    name: goal.name,
    template: goal.template,
    heroMetric: goal.heroMetric,
    paceKgPerWeek: paceOf(goal, version),
    timing: { ...goal.timing },
    insightsOff: [...(goal.insightsOff ?? [])],
  };
  if (version) {
    draft.dailyKcal = version.dailyKcal;
    draft.proteinG = version.proteinG;
  }
  if (goal.rangePct !== undefined) draft.rangePct = goal.rangePct;
  if (goal.surplusKcal !== undefined) draft.surplusKcal = goal.surplusKcal;
  if (goal.endCondition) draft.endCondition = { ...goal.endCondition };
  return { ...draft, ...patch };
}

async function counts() {
  return { goals: await db.goals.count(), versions: await db.goalVersions.count(), periods: await db.goalPeriods.count() };
}

async function statusOf(id: string): Promise<Goal['status'] | undefined> {
  return (await db.goals.get(id))?.status;
}

async function convertPause(): Promise<void> {
  await actions.createGoal(templateDraft('pause', 'Pause'), at);
}

beforeEach(() => {
  clearGoalEndNoticeSeen();
});

afterEach(async () => {
  setDemoClock(false);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  await Promise.all(opened.splice(0).map((d) => d.delete()));
});

describe('the goal library (S41)', () => {
  beforeEach(() => open());

  it('is the design’s sample in the demo: Cut in week 3, two saved goals and the Pause template', async () => {
    const library = (await getGoalLibraryIn(db, at))!;
    expect(library).toMatchObject({ today: TODAY, tz: 'Asia/Kuala_Lumpur', rolloverHour: 5, dailyMinimumKcal: 1400 });
    expect(library.current).toMatchObject({ goal: { id: G.cut }, week: 3, paused: false, version: { id: V.cut } });
    expect(library.current?.pending).toBeUndefined();
    expect(library.next).toBeUndefined();
    expect(library.saved.map((e) => [e.goal.id, e.version?.id, e.goal.status])).toEqual([
      [G.festive, V.festive, 'saved'],
      [G.leanBulk, V.leanBulk, 'draft'],
    ]);
    expect(library.templates).toEqual(['pause']);
    expect(library.ended).toEqual([]);
    expect(library.end).toBeUndefined();
  });

  it('shows a new user’s Cut in week 1 and the other three templates', async () => {
    const fresh = createDb(`goals-new-${crypto.randomUUID()}`);
    opened.push(fresh);
    const stamp = '2026-10-16T01:10:00.000Z';
    const goals = buildStarterGoals('cut', stamp, (t) => `goal-${t}`);
    await fresh.profile.put({ ...buildDemoWorld().profile, startedOn: TODAY, demoMode: false });
    await fresh.goals.bulkPut(goals);
    await fresh.goalVersions.put({ id: 'v-cut', goalId: 'goal-cut', effectiveFrom: TODAY, dailyKcal: 1800, proteinG: 110, carbsG: 180, fatG: 60, maintenanceKcal: 2350, reason: 'setup', createdAt: stamp });
    await fresh.goalPeriods.put({ id: 'p-cut', goalId: 'goal-cut', from: TODAY });
    const library = (await getGoalLibraryIn(fresh, at))!;
    expect(library.templates).toEqual(['festive', 'leanBulk', 'pause']);
    expect(library.saved).toEqual([]);
    expect(library.current?.week).toBe(1);
  });

  it('shows a booked switch as next, then as the current goal once it starts', async () => {
    await actions.switchGoal(G.festive, at);
    const library = (await getGoalLibraryIn(db, at))!;
    expect(library.current?.goal.id).toBe(G.cut);
    expect(library.next).toMatchObject({ goal: { id: G.festive }, startsOn: SAT, cancellable: true, version: { id: V.festive } });
    expect(library.saved.map((e) => e.goal.id)).toEqual([G.leanBulk]);

    const saturday = (await getGoalLibraryIn(db, { today: SAT }))!;
    expect(saturday.current).toMatchObject({ goal: { id: G.festive }, week: 1 });
    expect(saturday.next).toBeUndefined();
    expect(saturday.saved.map((e) => e.goal.id)).toEqual([G.cut, G.leanBulk]);
  });

  it('lists a stale "active" row as a saved goal: periods decide what is in force', async () => {
    await db.goals.update(G.leanBulk, { status: 'active' });
    const library = (await getGoalLibraryIn(db, at))!;
    expect(library.current?.goal.id).toBe(G.cut);
    expect(library.saved.map((e) => e.goal.id)).toContain(G.leanBulk);
  });

  it('notes a reached end with a maintain goal to switch to', async () => {
    await db.goals.update(G.cut, { endCondition: { date: TODAY } });
    const library = (await getGoalLibraryIn(db, at))!;
    expect(library.end?.state).toMatchObject({ kind: 'date', reached: true });
    expect(library.end?.key).toBe('goal-cut:date:2026-10-16');
    expect(library.end?.maintain).toEqual({ kind: 'goal', goal: expect.objectContaining({ id: G.festive }) });
    expect(await getGoalEndCheckIn(db, at)).toEqual(library.end);

    // Without a saved Festive goal it suggests setting one up.
    await db.goals.update(G.festive, { status: 'ended' });
    expect((await getGoalLibraryIn(db, at))?.end?.maintain).toEqual({ kind: 'template' });
    expect((await getGoalEndCheckIn(db, at))?.maintain).toEqual({ kind: 'template' });
  });

  it('has no end note with a switch booked, before the date, or while paused', async () => {
    await db.goals.update(G.cut, { endCondition: { date: '2026-10-20' } });
    expect((await getGoalLibraryIn(db, at))?.end).toBeUndefined();

    await db.goals.update(G.cut, { endCondition: { date: TODAY } });
    const { undo } = await actions.switchGoal(G.festive, at);
    expect((await getGoalLibraryIn(db, at))?.end).toBeUndefined();
    expect(await getGoalEndCheckIn(db, at)).toBeUndefined();
    await undo();
    expect(await getGoalEndCheckIn(db, at)).toBeDefined();

    await db.goalPeriods.update(CUT_PERIOD, { to: TODAY });
    await db.goalPeriods.put({ id: 'p-pause', goalId: G.pause, from: TODAY });
    expect(await getGoalEndCheckIn(db, at)).toBeUndefined();
  });

  it('is undefined without a profile', async () => {
    await db.profile.clear();
    expect(await getGoalLibraryIn(db, at)).toBeUndefined();
    expect(await getGoalDetailIn(db, G.cut, at)).toBeUndefined();
    expect(await getNewGoalDefaultsIn(db, at)).toBeUndefined();
    expect(await getSwitchPreviewIn(db, G.festive, at)).toBeUndefined();
  });

  it('never writes while reading', async () => {
    const before = await counts();
    await getGoalLibraryIn(db, at);
    await getGoalDetailIn(db, G.festive, at);
    await getSwitchPreviewIn(db, G.festive, at);
    await getNewGoalDefaultsIn(db, at);
    expect(await counts()).toEqual(before);
  });
});

describe('reads for S42, S43 and S44', () => {
  beforeEach(() => open());

  it('gives new goals the newest maintenance, the trend weight and the names in use', async () => {
    const defaults = (await getNewGoalDefaultsIn(db, at))!;
    expect(defaults).toMatchObject({ today: TODAY, maintenanceKcal: 2350, dailyMinimumKcal: 1400 });
    expect(defaults.weightKg).toBeCloseTo(77.99, 2);
    expect(defaults.trendKg).toBeCloseTo(77.99, 2);
    expect(defaults.takenNames).toEqual(['Cut', 'Festive maintain', 'Lean bulk']);
  });

  it('describes each goal’s role, versions and history', async () => {
    const cut = (await getGoalDetailIn(db, G.cut, at))!.detail!;
    expect(cut).toMatchObject({ role: 'current', everUsed: true, version: { id: V.cut }, end: { kind: 'none' }, maintenanceKcal: 2350 });
    expect(cut.history).toHaveLength(1);
    expect(cut.history[0]).toMatchObject({ state: 'current', version: { id: V.cut } });
    expect(cut.periods.map((p) => p.id)).toEqual([CUT_PERIOD]);

    const festive = (await getGoalDetailIn(db, G.festive, at))!.detail!;
    expect(festive).toMatchObject({ role: 'saved', everUsed: false, history: [], version: { id: V.festive }, maintenanceKcal: 2100 });
    expect(festive.pending).toBeUndefined();

    expect(await getGoalDetailIn(db, 'missing', at)).toEqual({ detail: null });
    expect((await getGoalDetailIn(db, G.pause, at))?.detail?.role).toBe('template');

    await actions.switchGoal(G.festive, at);
    const booked = (await getGoalDetailIn(db, G.festive, at))!.detail!;
    expect(booked).toMatchObject({ role: 'next', startsOn: SAT, resumes: false });
    expect((await getGoalDetailIn(db, G.cut, at))?.detail?.next).toMatchObject({ goal: { id: G.festive }, startsOn: SAT, cancellable: true });
  });

  it('previews a switch to Festive: from Saturday, at 2,100 a day, from Cut', async () => {
    const preview = (await getSwitchPreviewIn(db, G.festive, at))!;
    expect(preview).toMatchObject({ today: TODAY, startsOn: SAT, canSwitch: true, version: { id: V.festive }, from: { goal: { id: G.cut } } });
    expect(preview.reason).toBeUndefined();
    expect(preview.replaces).toBeUndefined();
    expect(preview.days).toHaveLength(7);
    expect(preview.ahead).toEqual([
      { day: SAT, targetKcal: 2100, fromKcal: 1800 },
      { day: '2026-10-18', targetKcal: 2100, fromKcal: 1800 },
    ]);
    const week = switchedWeek(preview.days, TODAY, (day) => preview.ahead.find((a) => a.day === day)?.targetKcal ?? null);
    expect(week.totalKcal).toBe(13200);

    expect(await getSwitchPreviewIn(db, G.cut, at)).toMatchObject({ canSwitch: false, reason: 'current' });
    expect(await getSwitchPreviewIn(db, G.pause, at)).toMatchObject({ canSwitch: false, reason: 'template' });
    expect(await getSwitchPreviewIn(db, 'missing', at)).toBeUndefined();

    await actions.switchGoal(G.festive, at);
    const replacing = (await getSwitchPreviewIn(db, G.leanBulk, at))!;
    expect(replacing.replaces).toEqual({ goal: expect.objectContaining({ id: G.festive }), startsOn: SAT });
    // Back to Cut while Festive is booked is allowed: it cancels the booking.
    expect((await getSwitchPreviewIn(db, G.cut, at))?.canSwitch).toBe(true);
  });
});

describe('createGoal (S43)', () => {
  beforeEach(() => open());

  it('saves a new goal with its target from today, and changes nothing else', async () => {
    const periods = await db.goalPeriods.toArray();
    const { goal, version, converted } = await actions.createGoal(templateDraft('festive', 'Raya maintain'), at);
    expect(converted).toBe(false);
    expect(goal).toMatchObject({ name: 'Raya maintain', template: 'festive', status: 'saved', heroMetric: 'daysInRange', rangePct: 0.1 });
    expect(goal.id).not.toBe(G.festive);
    expect(goal).not.toHaveProperty('insightsOff');
    expect(goal).not.toHaveProperty('endCondition');
    expect(await db.goals.get(goal.id)).toEqual(goal);
    expect(version).toMatchObject({
      goalId: goal.id,
      effectiveFrom: TODAY,
      dailyKcal: 2350,
      ...macrosForTarget(2350, 110),
      maintenanceKcal: 2350,
      paceKgPerWeek: 0,
      reason: 'setup',
    });
    expect(await db.goalPeriods.toArray()).toEqual(periods);
    expect((await getActiveGoal(db, SAT))?.goal.id).toBe(G.cut);
  });

  it('turns the Pause template row into the new goal, and the undo puts the template back', async () => {
    const template = await db.goals.get(G.pause);
    const versions = await db.goalVersions.count();
    const { goal, version, converted, undo } = await actions.createGoal(templateDraft('pause', 'Pause'), at);
    expect(converted).toBe(true);
    expect(version).toBeUndefined();
    expect(goal).toMatchObject({ id: G.pause, status: 'saved', template: 'pause' });
    expect(await db.goalVersions.count()).toBe(versions);
    expect((await getGoalLibraryIn(db, at))?.templates).toEqual([]);

    await undo();
    expect(await db.goals.get(G.pause)).toEqual(template);
    expect((await getGoalLibraryIn(db, at))?.templates).toEqual(['pause']);
  });

  it('keeps a Lean bulk surplus that matches its target', async () => {
    const { goal } = await actions.createGoal({ ...templateDraft('leanBulk', 'Lean bulk 2'), dailyKcal: 2650 }, at);
    expect(goal.surplusKcal).toBe(300);
  });

  it('writes nothing for an invalid draft', async () => {
    const before = await counts();
    const error = await actions.createGoal({ ...templateDraft('cut', ''), proteinG: 30 }, at).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GoalDraftError);
    expect((error as GoalDraftError).errors).toEqual({ name: 'Give it a name', proteinG: 'Between 40 and 250g' });
    expect(await counts()).toEqual(before);
  });

  it('undoes a new goal by deleting it with its version', async () => {
    const before = await counts();
    const { goal, undo } = await actions.createGoal(templateDraft('cut', 'Cut 2'), at);
    await undo();
    expect(await db.goals.get(goal.id)).toBeUndefined();
    expect(await counts()).toEqual(before);
  });
});

describe('saveGoalEdits (S42)', () => {
  beforeEach(() => open());

  it('replaces the one target of a goal never used, and keeps the surplus with it', async () => {
    const lb1 = await db.goalVersions.get(V.leanBulk);
    const { version, startsOn, undo } = await actions.saveGoalEdits(G.leanBulk, await draftOf(G.leanBulk, { dailyKcal: 2400, proteinG: 135 }), at);
    expect(startsOn).toBeUndefined();
    const versions = await db.goalVersions.where('goalId').equals(G.leanBulk).toArray();
    expect(versions).toHaveLength(1);
    expect(versions[0]).toEqual(version);
    expect(version).toMatchObject({ effectiveFrom: TODAY, dailyKcal: 2400, proteinG: 135, maintenanceKcal: 2100, reason: 'setup' });
    expect(await db.goalVersions.get(V.leanBulk)).toBeUndefined();
    expect(await db.goals.get(G.leanBulk)).toMatchObject({ surplusKcal: 300, status: 'draft' });

    await undo();
    expect(await db.goalVersions.get(V.leanBulk)).toEqual(lb1);
    expect(await db.goalVersions.where('goalId').equals(G.leanBulk).count()).toBe(1);
    expect((await db.goals.get(G.leanBulk))?.surplusKcal).toBe(200);
  });

  it('gives the goal in force a new target from tomorrow; today keeps 1,800', async () => {
    const cut1 = await db.goalVersions.get(V.cut);
    const { version, startsOn } = await actions.saveGoalEdits(G.cut, await draftOf(G.cut, { dailyKcal: 1700 }), at);
    expect(startsOn).toBe(SAT);
    expect(version).toMatchObject({
      goalId: G.cut,
      effectiveFrom: SAT,
      reason: 'manualEdit',
      paceKgPerWeek: 0.5,
      maintenanceKcal: 2350,
      dailyKcal: 1700,
      ...macrosForTarget(1700, 110),
    });
    expect(await db.goalVersions.get(V.cut)).toEqual(cut1);
    expect((await getActiveGoal(db, TODAY))?.version.id).toBe(V.cut);
    expect((await getActiveGoal(db, SAT))?.version.id).toBe(version?.id);
    expect((await getWeekBudget(db, undefined, at))?.budget.weeklyBudgetKcal).toBe(12400);
  });

  it('keeps one version for tomorrow, replacing a pending approval (and its undo puts it back)', async () => {
    const cut1 = (await db.goalVersions.get(V.cut))!;
    const approval: GoalVersion = { ...cut1, id: 'approved', effectiveFrom: SAT, dailyKcal: 1550, reason: 'approvedSuggestion', createdAt: '2026-10-16T10:00:00.000Z' };
    await db.goalVersions.put(approval);
    await actions.saveGoalEdits(G.cut, await draftOf(G.cut, { dailyKcal: 1700 }), at);
    const { undo } = await actions.saveGoalEdits(G.cut, await draftOf(G.cut, { dailyKcal: 1650 }), at);
    const tomorrow = await db.goalVersions.where('effectiveFrom').equals(SAT).toArray();
    expect(tomorrow.map((v) => v.dailyKcal)).toEqual([1650]);
    expect(await db.goalVersions.get('approved')).toBeUndefined();

    await undo();
    expect((await db.goalVersions.where('effectiveFrom').equals(SAT).toArray()).map((v) => v.dailyKcal)).toEqual([1700]);

    // The first edit's undo would bring the approval back; a fresh edit over it is undone the same way.
    await db.goalVersions.clear();
    await db.goalVersions.bulkPut([cut1, approval]);
    const again = await actions.saveGoalEdits(G.cut, await draftOf(G.cut, { dailyKcal: 1700 }), at);
    expect(await db.goalVersions.get('approved')).toBeUndefined();
    await again.undo();
    expect(await db.goalVersions.get('approved')).toEqual(approval);
  });

  it('applies name, timing and insight changes at once, without a version', async () => {
    const versions = await db.goalVersions.count();
    await actions.saveGoalEdits(
      G.cut,
      await draftOf(G.cut, { name: ' Cut for Raya ', timing: { maxWindowHours: 13, minHoursBeforeSleep: 2, maxEatingOccasions: 5 }, insightsOff: ['food'], endCondition: { date: '2026-12-01' } }),
      at,
    );
    expect(await db.goalVersions.count()).toBe(versions);
    expect(await db.goals.get(G.cut)).toMatchObject({ name: 'Cut for Raya', timing: { maxWindowHours: 13 }, insightsOff: ['food'], endCondition: { date: '2026-12-01' }, status: 'active' });
    const day = await getDaySummary(db, TODAY);
    // Breakfast at 10:40am, so the 13-hour window closes at 11:40pm.
    expect(day.window.closesAt).toBe('2026-10-16T15:40:00.000Z');

    await actions.saveGoalEdits(G.cut, await draftOf(G.cut, { endCondition: undefined, insightsOff: [] }), at);
    const goal = (await db.goals.get(G.cut))!;
    expect('endCondition' in goal).toBe(false);
    expect('insightsOff' in goal).toBe(false);
  });

  it('versions a new pace; the goal row keeps its own', async () => {
    const { version } = await actions.saveGoalEdits(G.cut, await draftOf(G.cut, { paceKgPerWeek: 0.25, dailyKcal: 2075 }), at);
    expect(version).toMatchObject({ paceKgPerWeek: 0.25, dailyKcal: 2075 });
    expect((await db.goals.get(G.cut))?.paceKgPerWeek).toBe(0.5);
  });

  it('refuses a template row or a missing goal, and an invalid draft', async () => {
    await expect(actions.saveGoalEdits(G.pause, templateDraft('pause', 'Pause'), at)).rejects.toBeInstanceOf(GoalChangedError);
    await expect(actions.saveGoalEdits('missing', templateDraft('cut', 'Cut'), at)).rejects.toBeInstanceOf(GoalChangedError);
    await expect(actions.saveGoalEdits(G.cut, await draftOf(G.cut, { dailyKcal: 1350 }), at)).rejects.toBeInstanceOf(GoalDraftError);
    // A stored target under the minimum is fine while it isn't changed.
    await db.profile.update('me', { dailyMinimumKcal: 1900 });
    await expect(actions.saveGoalEdits(G.cut, await draftOf(G.cut, { name: 'Cut A' }), at)).resolves.toBeDefined();
  });

  it('saves an edit while the end it carries has been reached, and checks an end that changed', async () => {
    await db.goals.update(G.cut, { endCondition: { date: TODAY } });
    await actions.saveGoalEdits(G.cut, await draftOf(G.cut, { name: 'Cut A', proteinG: 115 }), at);
    expect(await db.goals.get(G.cut)).toMatchObject({ name: 'Cut A', endCondition: { date: TODAY } });
    // A later day, past the date: still only the name changes.
    await actions.saveGoalEdits(G.cut, await draftOf(G.cut, { name: 'Cut B' }), { today: '2026-10-20' });
    expect((await db.goals.get(G.cut))?.name).toBe('Cut B');

    // A weight the trend (77.99 kg) is already past.
    await db.goals.update(G.cut, { endCondition: { weightKg: 78.5 } });
    await actions.saveGoalEdits(G.cut, await draftOf(G.cut, { name: 'Cut C' }), at);
    expect((await db.goals.get(G.cut))?.name).toBe('Cut C');

    // Changing the end asks for a real one.
    await expect(actions.saveGoalEdits(G.cut, await draftOf(G.cut, { endCondition: { weightKg: 79 } }), at)).rejects.toMatchObject({
      errors: { end: 'Pick a weight under your 78.0 kg trend' },
    });
    await expect(actions.saveGoalEdits(G.cut, await draftOf(G.cut, { endCondition: { date: TODAY } }), at)).rejects.toMatchObject({
      errors: { end: 'Pick a date after today' },
    });
  });

  it('does nothing on undo once tomorrow has started', async () => {
    await db.profile.update('me', { demoMode: false });
    setDemoClock(false);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-16T11:10:00.000Z'));
    const { version, undo } = await actions.saveGoalEdits(G.cut, await draftOf(G.cut, { dailyKcal: 1700 }));
    expect(version?.effectiveFrom).toBe(SAT);
    vi.setSystemTime(new Date('2026-10-17T11:10:00.000Z'));
    await undo();
    expect(await db.goalVersions.get(version!.id)).toBeDefined();
  });
});

describe('switchGoal (S44)', () => {
  beforeEach(() => open());

  it('books Festive from tomorrow: today stays Cut and the week is prorated', async () => {
    const meals = await db.meals.toArray();
    const { startsOn, cancelled } = await actions.switchGoal(G.festive, at);
    expect(startsOn).toBe(SAT);
    expect(cancelled).toBe(false);

    const periods = await db.goalPeriods.toArray();
    expect(periods.find((p) => p.id === CUT_PERIOD)).toEqual({ id: CUT_PERIOD, goalId: G.cut, from: '2026-09-28', to: SAT });
    const added = periods.filter((p) => p.id !== CUT_PERIOD);
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ goalId: G.festive, from: SAT });
    expect(added[0]?.createdAt).toEqual(expect.any(String));
    expect(added[0]).not.toHaveProperty('to');
    expect(await statusOf(G.festive)).toBe('active');
    expect(await statusOf(G.cut)).toBe('saved');

    expect((await getActiveGoal(db, TODAY))?.goal.id).toBe(G.cut);
    expect(await getActiveGoal(db, SAT)).toMatchObject({ goal: { id: G.festive }, version: { id: V.festive } });

    const budget = (await getWeekBudget(db, undefined, at))!.budget;
    expect(budget.weeklyBudgetKcal).toBe(13200);
    expect(budget.days[5]?.baseKcal).toBe(2100);
    expect(budget.makanRoomKcal).toBe(2750);
    expect(budget.leftThisWeekKcal).toBe(5420);
    expect(budget.todayBaseKcal).toBe(1800);
    expect(budget.leftTodayKcal).toBe(570);
    expect(await db.meals.toArray()).toEqual(meals);
  });

  it('undoes the switch exactly', async () => {
    const periods = await db.goalPeriods.toArray();
    const goals = await db.goals.toArray();
    const { undo } = await actions.switchGoal(G.festive, at);
    await undo();
    expect(await db.goalPeriods.toArray()).toEqual(periods);
    expect('to' in (await db.goalPeriods.get(CUT_PERIOD))!).toBe(false);
    expect(await db.goals.toArray()).toEqual(goals);
  });

  it('replaces an earlier booking', async () => {
    await actions.switchGoal(G.festive, at);
    await actions.switchGoal(G.leanBulk, at);
    const fromSaturday = (await db.goalPeriods.toArray()).filter((p) => p.from === SAT);
    expect(fromSaturday.map((p) => p.goalId)).toEqual([G.leanBulk]);
    expect(await statusOf(G.leanBulk)).toBe('active');
    expect(await statusOf(G.festive)).toBe('saved');
    expect(await statusOf(G.cut)).toBe('saved');
  });

  it('cancels the booking when switching back to the goal in force, and refuses it with nothing booked', async () => {
    await expect(actions.switchGoal(G.cut, at)).rejects.toBeInstanceOf(GoalChangedError);
    const periods = await db.goalPeriods.toArray();
    await actions.switchGoal(G.festive, at);
    const { cancelled, startsOn } = await actions.switchGoal(G.cut, at);
    expect(cancelled).toBe(true);
    expect(startsOn).toBe(SAT);
    expect(await db.goalPeriods.toArray()).toEqual(periods);
    expect(await statusOf(G.cut)).toBe('active');
    expect(await statusOf(G.festive)).toBe('saved');
  });

  it('pauses until Monday, then gives Cut back', async () => {
    await convertPause();
    await actions.switchGoal(G.pause, { ...at, until: '2026-10-19' });
    const periods = (await db.goalPeriods.toArray()).map(({ goalId, from, to }) => ({ goalId, from, to }));
    expect(periods).toEqual(
      expect.arrayContaining([
        { goalId: G.cut, from: '2026-09-28', to: SAT },
        { goalId: G.pause, from: SAT, to: '2026-10-19' },
        { goalId: G.cut, from: '2026-10-19', to: undefined },
      ]),
    );
    expect(periods).toHaveLength(3);
    expect(await statusOf(G.cut)).toBe('active');
    expect(await statusOf(G.pause)).toBe('saved');
    expect(await getActiveGoal(db, SAT)).toMatchObject({ paused: true, goal: { id: G.pause } });
    expect((await getActiveGoal(db, '2026-10-19'))?.goal.id).toBe(G.cut);

    const budget = (await getWeekBudget(db, undefined, at))!.budget;
    expect(budget.weeklyBudgetKcal).toBe(9000);
    expect(budget.days[5]?.kind).toBe('paused');

    // Saturday asks about Friday; Monday doesn't ask about the paused weekend.
    expect((await getCheckIn(db, { today: SAT })).queue[0]).toBe(TODAY);
    const monday = await getCheckIn(db, { today: '2026-10-19' });
    expect(monday.queue).not.toContain(SAT);
    expect(monday.queue).not.toContain('2026-10-18');

    // Its library: Cut runs today, Pause is next; on Saturday Cut is next again (a resume).
    expect((await getGoalLibraryIn(db, at))?.next).toMatchObject({ goal: { id: G.pause }, startsOn: SAT, cancellable: true });
    const saturday = (await getGoalLibraryIn(db, { today: SAT }))!;
    expect(saturday.current).toMatchObject({ goal: { id: G.pause }, paused: true });
    expect(saturday.current?.version).toBeUndefined();
    expect(saturday.next).toMatchObject({ goal: { id: G.cut }, startsOn: '2026-10-19', cancellable: false });
    expect((await getGoalDetailIn(db, G.cut, { today: SAT }))?.detail).toMatchObject({ role: 'next', resumes: true });
  });

  it('pauses with no end date', async () => {
    await convertPause();
    await actions.switchGoal(G.pause, at);
    const pause = (await db.goalPeriods.toArray()).find((p) => p.goalId === G.pause);
    expect(pause).toMatchObject({ from: SAT });
    expect(pause).not.toHaveProperty('to');
    expect(await statusOf(G.pause)).toBe('active');
    expect(await statusOf(G.cut)).toBe('saved');
  });

  it('switches from one Pause to another and still has a goal on every day', async () => {
    await convertPause();
    const { goal: sick } = await actions.createGoal(templateDraft('pause', 'Sick days'), at);
    await actions.switchGoal(G.pause, at);

    // On Saturday Pause is in force; Sick days follows it from Sunday with no end date.
    const onSaturday = { today: SAT };
    await actions.switchGoal(sick.id, onSaturday);
    for (const day of ['2026-10-18', '2026-10-19', '2026-11-30']) {
      expect(await getActiveGoal(db, day), day).toMatchObject({ paused: true, goal: { id: sick.id }, version: { id: V.cut } });
    }
    expect(await getWeekBudget(db, undefined, { today: '2026-10-18' })).toBeDefined();
    expect((await getGoalLibraryIn(db, { today: '2026-10-18' }))?.current).toMatchObject({ goal: { id: sick.id }, paused: true });
  });

  it('gives the budget goal back after a dated Pause that follows a Pause', async () => {
    await convertPause();
    const { goal: sick } = await actions.createGoal(templateDraft('pause', 'Sick days'), at);
    await actions.switchGoal(G.pause, { ...at, until: '2026-10-19' });

    // Pause "Pause" runs Sat to Mon; on Saturday Sick days takes over until Wednesday.
    await actions.switchGoal(sick.id, { today: SAT, until: '2026-10-21' });
    const periods = (await db.goalPeriods.toArray()).map(({ goalId, from, to }) => ({ goalId, from, to })).sort((a, b) => a.from.localeCompare(b.from));
    expect(periods).toEqual([
      { goalId: G.cut, from: '2026-09-28', to: SAT },
      { goalId: G.pause, from: SAT, to: '2026-10-18' },
      { goalId: sick.id, from: '2026-10-18', to: '2026-10-21' },
      { goalId: G.cut, from: '2026-10-21', to: undefined },
    ]);
    expect(await getActiveGoal(db, '2026-10-19')).toMatchObject({ paused: true, goal: { id: sick.id }, version: { id: V.cut } });
    expect(await getActiveGoal(db, '2026-10-21')).toMatchObject({ paused: false, goal: { id: G.cut } });
    expect(await statusOf(G.cut)).toBe('active');
  });

  it('refuses what can’t be switched to, and writes nothing', async () => {
    const before = await db.goalPeriods.toArray();
    await db.goals.update(G.leanBulk, { status: 'ended' });
    await expect(actions.switchGoal(G.leanBulk, at)).rejects.toBeInstanceOf(GoalChangedError);
    await expect(actions.switchGoal(G.pause, at)).rejects.toBeInstanceOf(GoalChangedError);
    await db.goalVersions.delete(V.festive);
    await expect(actions.switchGoal(G.festive, at)).rejects.toBeInstanceOf(GoalChangedError);
    await expect(actions.switchGoal('missing', at)).rejects.toBeInstanceOf(GoalChangedError);

    await db.goals.update(G.leanBulk, { status: 'saved' });
    await expect(actions.switchGoal(G.leanBulk, { ...at, until: '2026-10-19' })).rejects.toBeInstanceOf(RangeError);
    await convertPause();
    await expect(actions.switchGoal(G.pause, { ...at, until: '2026-12-17' })).rejects.toBeInstanceOf(RangeError);
    expect(await db.goalPeriods.toArray()).toEqual(before);
    expect(await statusOf(G.cut)).toBe('active');
  });

  it('starts a Sunday switch on Monday, with the new week', async () => {
    const { startsOn } = await actions.switchGoal(G.festive, { today: '2026-10-18' });
    expect(startsOn).toBe('2026-10-19');
    const preview = (await getSwitchPreviewIn(db, G.leanBulk, { today: '2026-10-18' }))!;
    expect(preview.ahead).toEqual([]);
    expect(switchedWeek(preview.days, '2026-10-18', () => 2300).sameWeek).toBe(false);
  });
});

describe('cancelGoalSwitch', () => {
  beforeEach(() => open());

  it('cancels a booking, and its undo books it again', async () => {
    const periods = await db.goalPeriods.toArray();
    await actions.switchGoal(G.festive, at);
    const booked = await db.goalPeriods.toArray();
    const { undo } = await actions.cancelGoalSwitch(at);
    expect(await db.goalPeriods.toArray()).toEqual(periods);
    expect(await statusOf(G.cut)).toBe('active');
    expect(await statusOf(G.festive)).toBe('saved');

    await undo();
    expect(await db.goalPeriods.toArray()).toEqual(booked);
    expect((await getActiveGoal(db, SAT))?.goal.id).toBe(G.festive);
    expect(await statusOf(G.festive)).toBe('active');
  });

  it('refuses when nothing is booked', async () => {
    await expect(actions.cancelGoalSwitch(at)).rejects.toBeInstanceOf(GoalChangedError);
  });
});

describe('archiveGoal and restoreGoal', () => {
  beforeEach(() => open());

  it('deletes a goal that was never used, with its version; the undo brings both back', async () => {
    const goal = await db.goals.get(G.festive);
    const version = await db.goalVersions.get(V.festive);
    const { deleted, undo } = await actions.archiveGoal(G.festive, at);
    expect(deleted).toBe(true);
    expect(await db.goals.get(G.festive)).toBeUndefined();
    expect(await db.goalVersions.get(V.festive)).toBeUndefined();
    expect((await getGoalLibraryIn(db, at))?.templates).toEqual(['festive', 'pause']);

    await undo();
    expect(await db.goals.get(G.festive)).toEqual(goal);
    expect(await db.goalVersions.get(V.festive)).toEqual(version);
  });

  it('ends a goal that was used, keeps its history and restores it', async () => {
    await db.goalPeriods.update(CUT_PERIOD, { to: '2026-10-01' });
    await db.goalPeriods.bulkPut([
      { id: 'p-festive', goalId: G.festive, from: '2026-10-01', to: '2026-10-05' },
      { id: 'p-cut-2', goalId: G.cut, from: '2026-10-05' },
    ]);
    const { deleted, undo } = await actions.archiveGoal(G.festive, at);
    expect(deleted).toBe(false);
    expect(await statusOf(G.festive)).toBe('ended');
    expect(await db.goalVersions.get(V.festive)).toBeDefined();
    const library = (await getGoalLibraryIn(db, at))!;
    expect(library.ended.map((e) => e.goal.id)).toEqual([G.festive]);
    expect(library.ended[0]?.lastUsed).toEqual({ from: '2026-10-01', to: '2026-10-05' });
    expect(library.saved.map((e) => e.goal.id)).toEqual([G.leanBulk]);

    const restored = await actions.restoreGoal(G.festive);
    expect(await statusOf(G.festive)).toBe('saved');
    await restored.undo();
    expect(await statusOf(G.festive)).toBe('ended');
    await undo();
    expect(await statusOf(G.festive)).toBe('saved');
    await expect(actions.restoreGoal(G.festive)).rejects.toBeInstanceOf(GoalChangedError);
  });

  it('refuses the goal in force and a booked one', async () => {
    await expect(actions.archiveGoal(G.cut, at)).rejects.toBeInstanceOf(GoalChangedError);
    await actions.switchGoal(G.festive, at);
    await expect(actions.archiveGoal(G.festive, at)).rejects.toBeInstanceOf(GoalChangedError);
    await expect(actions.archiveGoal(G.pause, at)).rejects.toBeInstanceOf(GoalChangedError);
    expect(await statusOf(G.festive)).toBe('active');
  });
});

describe('sync capture and demo mode', () => {
  it('queues every row a switch changes, and its undo deletes by key', async () => {
    await open({ capture: () => true });
    await db.profile.update('me', { demoMode: false });
    await db.syncOutbox.clear();
    await actions.switchGoal(G.festive, at);
    const added = (await db.goalPeriods.toArray()).find((p) => p.id !== CUT_PERIOD)!;
    const keys = (await db.syncOutbox.toArray()).map((e) => [e.table, e.key]);
    expect(keys).toEqual(
      expect.arrayContaining([
        ['goalPeriods', CUT_PERIOD],
        ['goalPeriods', added.id],
        ['goals', G.festive],
        ['goals', G.cut],
      ]),
    );
  });

  it('keeps an outbox entry for the period the undo removed', async () => {
    await open({ capture: () => true });
    await db.profile.update('me', { demoMode: false });
    const { undo } = await actions.switchGoal(G.festive, at);
    const added = (await db.goalPeriods.toArray()).find((p) => p.id !== CUT_PERIOD)!;
    await db.syncOutbox.clear();
    await undo();
    expect(await db.goalPeriods.get(added.id)).toBeUndefined();
    expect(await db.syncOutbox.get(['goalPeriods', added.id])).toBeDefined();
  });

  it('queues nothing on the demo clock', async () => {
    await open({ capture: () => true });
    await db.syncOutbox.clear();
    setDemoClock(true);
    await actions.switchGoal(G.festive, at);
    await actions.createGoal(templateDraft('cut', 'Cut 2'), at);
    expect(await db.syncOutbox.count()).toBe(0);
  });
});

describe('the goal-end notice store', () => {
  it('remembers the last key seen', () => {
    expect(readGoalEndNoticeSeen()).toBeNull();
    markGoalEndNoticeSeen('k');
    expect(readGoalEndNoticeSeen()).toBe('k');
    clearGoalEndNoticeSeen();
    expect(readGoalEndNoticeSeen()).toBeNull();
  });

  it('keeps it in memory when storage refuses to write', () => {
    const storage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(() => {
        throw new Error('QuotaExceededError');
      }),
      removeItem: vi.fn(),
    };
    vi.stubGlobal('window', { localStorage: storage });
    markGoalEndNoticeSeen('goal-cut:date:2026-10-16');
    expect(storage.setItem).toHaveBeenCalled();
    expect(readGoalEndNoticeSeen()).toBe('goal-cut:date:2026-10-16');
  });
});
