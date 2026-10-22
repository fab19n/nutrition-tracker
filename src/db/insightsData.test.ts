// @vitest-environment node
import { createDb, type KiraMakanDb } from '@/db/db';
import { getInsightFeedback, listSuggestionEvents, putWeekPlan } from '@/db/repo';
import { DEMO_EXPECTED, loadDemo } from '@/db/seed/demo';
import { setDemoClock } from '@/domain/clock';
import { instantAt } from '@/domain/day';
import { loadMaintenanceWorld, MAINTENANCE_WORLD } from '@/test/maintenanceWorld';
import { createDishCheckActions } from './dishCheck';
import { createInsightsActions, getEvidence, getInsightsView, getMealIdeas, getWeeklyReview } from './insightsData';
import { createTargetActions, getTargetCheck } from './targetSuggestion';

let db: KiraMakanDb;
let actions: ReturnType<typeof createInsightsActions>;
const now = new Date(DEMO_EXPECTED.now);

beforeEach(async () => {
  db = createDb(`insights-${crypto.randomUUID()}`);
  await loadDemo(db);
  setDemoClock(true);
  actions = createInsightsActions(db);
});

afterEach(async () => {
  setDemoClock(false);
  await db.delete();
});

describe('getInsightsView', () => {
  it('reads last week for the tiles, top 3 and categories', async () => {
    const view = await getInsightsView(db, { now });
    expect(view).toBeDefined();
    expect(view!.headerLabel).toBe('Week 3 · day 19');
    expect(view!.early).toBe(false);
    expect(view!.periodLabel).toBe('last week');
    expect(view!.tiles.budget).toEqual({ overKcal: 350, countedKcal: 13420, budgetKcal: 13070 });
    expect(view!.tiles.complete).toEqual({ done: 6, of: 7 });
    expect(view!.tiles.trendChangeKg).toBeCloseTo(DEMO_EXPECTED.weights.lastWeekChangeKg, 1);
    expect(view!.top).toHaveLength(3);
    expect(view!.top.map((i) => i.ruleId)).toEqual(expect.arrayContaining(['placeComparison', 'categoryShare']));
    expect(view!.categories.find((c) => c.id === 'drinks')?.pct).toBe(17);
    expect(view!.places[0]).toMatchObject({ name: 'Nasi kandar near home', kcal: 3800, spendRm: 58 });
    expect(view!.recurring[0]).toMatchObject({ name: 'Teh tarik', count: 8 });
    // This week Mon–Sun: rows read M T W T F S S, today on Friday, the weekend still empty.
    expect(view!.timing.rows.map((r) => r.label)).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S']);
    expect(view!.timing.rows[0]?.day).toBe(DEMO_EXPECTED.weekStart);
    expect(view!.timing.rows[4]?.day).toBe(DEMO_EXPECTED.today.day);
    expect(view!.timing.rows[4]?.dots.length).toBeGreaterThan(0);
    expect(view!.timing.rows.slice(5).every((r) => r.dots.length === 0)).toBe(true);
    expect(view!.timing.averageWindowHours).toBeGreaterThan(0);
    expect(view!.highlightCategory).toBe(view!.top[0]?.category);
  });

  it('carries the top dishes check: ready on the demo Friday, in progress after one answer', async () => {
    expect((await getInsightsView(db, { now }))!.dishCheck).toEqual({ phase: 'ready', loggedDays: 19, dishCount: 27, total: 27, answered: 0, hidden: false });
    await createDishCheckActions(db).answerDish('rice-economy', 'right', { today: DEMO_EXPECTED.today.day });
    const after = (await getInsightsView(db, { now }))!.dishCheck;
    expect(after).toMatchObject({ phase: 'inProgress', total: 27, answered: 1, hidden: false, startedOn: DEMO_EXPECTED.today.day });
  });

  it('keeps the top dishes check out of the paused insights and the useful ones', async () => {
    await createDishCheckActions(db).dismissDishCheck({ today: DEMO_EXPECTED.today.day });
    const view = (await getInsightsView(db, { now }))!;
    expect(view.dishCheck.hidden).toBe(true);
    expect(view.top).toHaveLength(3);
    expect(view.feedback.topDishes?.pausedUntil).toBe('2026-11-13');
  });

  it('offers last week’s review until a focus is picked for this week', async () => {
    const before = await getInsightsView(db, { now });
    expect(before!.review).toMatchObject({ weekStart: DEMO_EXPECTED.lastWeekStart, focusWeekStart: DEMO_EXPECTED.weekStart, available: true, seen: false, sundayNight: false, rangeLabel: '5–11 Oct' });
    await putWeekPlan(db, { weekStart: DEMO_EXPECTED.weekStart, focus: { label: 'Kurang manis for drinks', sub: 'x', ruleId: 'drinksKurang' } });
    expect((await getInsightsView(db, { now }))!.review.seen).toBe(true);
  });

  it('turns to this week on Sunday night', async () => {
    const sunday = new Date(instantAt('2026-10-18', 20, 0));
    const view = await getInsightsView(db, { now: sunday, today: '2026-10-18' });
    expect(view!.review).toMatchObject({ weekStart: DEMO_EXPECTED.weekStart, sundayNight: true, focusWeekStart: '2026-10-19' });
  });

  it('hides a paused insight after "Not for me", and the undo brings it back', async () => {
    const undo = await actions.recordFeedback('placeComparison', 'notForMe', DEMO_EXPECTED.today.day);
    expect((await getInsightFeedback(db, 'placeComparison'))?.pausedUntil).toBe('2026-11-13');
    expect((await getInsightsView(db, { now }))!.top.map((i) => i.ruleId)).not.toContain('placeComparison');
    await undo();
    expect(await getInsightFeedback(db, 'placeComparison')).toBeUndefined();
    expect((await getInsightsView(db, { now }))!.top.map((i) => i.ruleId)).toContain('placeComparison');
  });

  it('remembers "Useful"', async () => {
    await actions.recordFeedback('categoryShare', 'useful');
    expect((await getInsightsView(db, { now }))!.feedback.categoryShare?.feedback).toBe('useful');
    const undo = await actions.clearFeedback('categoryShare');
    expect(await getInsightFeedback(db, 'categoryShare')).toBeUndefined();
    await undo();
    expect((await getInsightFeedback(db, 'categoryShare'))?.feedback).toBe('useful');
  });
});

describe('getEvidence', () => {
  it('lists the 11 drinks with kcal by day', async () => {
    const evidence = await getEvidence(db, 'categoryShare', { now });
    expect(evidence?.insight?.summary).toBe('11 drinks last week · ~2,170 kcal');
    expect(evidence?.rows).toHaveLength(11);
    expect(evidence?.days).toHaveLength(7);
    expect(evidence?.days.reduce((sum, d) => sum + d.kcal, 0)).toBe(2170);
    expect(evidence?.placeNames['place-nasi-kandar']).toBe('Nasi kandar near home');
  });

  it('has nothing for a rule that found nothing', async () => {
    const evidence = await getEvidence(db, 'lateEating', { now });
    expect(evidence?.insight).toBeUndefined();
    expect(evidence?.rows).toEqual([]);
  });
});

describe('getWeeklyReview', () => {
  it('summarises last week with the last focus result', async () => {
    const review = await getWeeklyReview(db, DEMO_EXPECTED.lastWeekStart, { now });
    expect(review).toMatchObject({ rangeLabel: '5–11 Oct', focusWeekStart: DEMO_EXPECTED.weekStart, firstWeek: false, completeDays: 6, daysInUse: 7 });
    expect(review!.notCountedDays).toEqual(['2026-10-11']);
    expect(review!.budget).toMatchObject({ overKcal: 350, countedKcal: 13420, budgetKcal: 13070, targetKcal: 1800 });
    expect(review!.budget!.days.map((d) => d.kind)).toEqual(['logged', 'logged', 'logged', 'logged', 'logged', 'over', 'notCounted']);
    expect(review!.lastFocus).toMatchObject({ label: 'Kurang manis for drinks', done: 3, total: 11 });
    expect(review!.focusOptions).toHaveLength(3);
    expect(review!.top).toHaveLength(3);
    expect(review!.learned).toBeUndefined();
  });

  it('is "what we learned about you" for the first week', async () => {
    const review = await getWeeklyReview(db, DEMO_EXPECTED.weekBeforeStart, { now });
    expect(review!.firstWeek).toBe(true);
    expect(review!.learned?.topPlaces[0]?.name).toBe('Home');
  });
});

describe('getMealIdeas', () => {
  it('suggests dinner for the 570 kcal left', async () => {
    const ideas = await getMealIdeas(db, { now });
    expect(ideas).toMatchObject({ slot: 'dinner', leftTodayKcal: 570, proteinLeftG: 68, windowClosesAt: DEMO_EXPECTED.today.windowClosesAt, windowClosed: false, mode: 'normal', hasHistory: true });
    expect(ideas!.cards.map((c) => c.role)).toEqual(['usual', 'lighterSwap', 'different']);
    expect(ideas!.cards.every((c) => c.kcal <= 570)).toBe(true);
  });

  it('records shown, taken and ignored picks', async () => {
    const id = await actions.recordSuggestionEvent('usual', 'Rice, ayam masak kicap, sayur');
    await actions.setSuggestionEventOutcome(id, 'taken');
    const events = await listSuggestionEvents(db);
    expect(events).toEqual([expect.objectContaining({ id, role: 'usual', outcome: 'taken' })]);
  });
});

describe('with a target suggestion waiting (the maintenance world, Fri 30 Oct)', () => {
  const read = { today: MAINTENANCE_WORLD.today, now: new Date(MAINTENANCE_WORLD.now) };

  beforeEach(async () => {
    setDemoClock(false);
    await loadMaintenanceWorld(db);
  });

  it('keeps the maintenance insight out of the top 3 while the card shows, yet the rule found it', async () => {
    const view = await getInsightsView(db, read);
    expect(view?.top.map((i) => i.ruleId)).not.toContain('maintenanceEstimate');
    const evidence = await getEvidence(db, 'maintenanceEstimate', read);
    expect(evidence?.insight?.headline).toBe('Maintenance is about 2,100, not 2,350');

    await createTargetActions(db).keepCurrentTarget({ versionId: MAINTENANCE_WORLD.ids.setupVersion }, { today: read.today });
    expect((await getEvidence(db, 'maintenanceEstimate', read))?.insight).toBeUndefined();
  });

  it('shows the weigh-ins the maintenance read still needs', async () => {
    await loadMaintenanceWorld(db, { weighInEvery: 7 });
    const view = await getInsightsView(db, read);
    expect(view?.unlocks).toContainEqual({ label: 'Weigh-ins for your maintenance', have: 4, need: 8, unit: 'weigh-ins' });
    // In place of "Your real maintenance", which can't say Unlocked while no maintenance is shown.
    expect(view?.unlocks.find((u) => u.label === 'Your real maintenance')).toBeUndefined();
    expect(view?.unlocks.at(-1)?.label).toBe('Weigh-ins for your maintenance');
  });

  it('counts "Your real maintenance" as unlocked when the weekly read has 21 days, though the last 4 weeks have fewer', async () => {
    // 2–8 Oct and this week's Mon–Thu not counted: the weekly window (28 Sep – 25 Oct) still has
    // 21 complete days, the 28 days to yesterday only 17.
    const notCounted = ['2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29'];
    await db.days.bulkPut(notCounted.map((day) => ({ logicalDay: day, status: 'notCounted' as const })));
    const target = await getTargetCheck(db, { today: read.today });
    expect(target?.check).toMatchObject({ kind: 'suggestion', estimate: { basis: 'weekly', daysUsed: 21 } });
    const view = await getInsightsView(db, read);
    expect(view?.unlocks).toContainEqual({ label: 'Your real maintenance', have: 21, need: 21 });
    expect(view?.unlocks.every((u) => u.have >= u.need)).toBe(true);
  });

  it('shows the span the weigh-ins still need', async () => {
    await loadMaintenanceWorld(db, { weighInsFrom: '2026-10-20' });
    const view = await getInsightsView(db, read);
    expect(view?.unlocks).toContainEqual({ label: 'Weigh-ins for your maintenance', have: 9, need: 14, unit: 'days' });
  });

  it('reads the pace of the version in force today for the trend tile and the weekly review', async () => {
    expect((await getInsightsView(db, read))?.tiles.paceKgPerWeek).toBe(0.5);
    await db.goalVersions.update(MAINTENANCE_WORLD.ids.setupVersion, { paceKgPerWeek: 0.25 });
    expect((await getInsightsView(db, read))?.tiles.paceKgPerWeek).toBe(0.25);
    expect((await getWeeklyReview(db, '2026-10-19', read))?.trend.paceKgPerWeek).toBe(0.25);
  });
});

