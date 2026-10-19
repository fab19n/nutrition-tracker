// @vitest-environment node
import { createDb, type KiraMakanDb } from '@/db/db';
import { DEMO_EXPECTED, DEMO_IDS, loadDemo } from '@/db/seed/demo';
import { setDemoClock } from '@/domain/clock';
import { fmtKgDelta } from '@/domain/format';
import { mealMacros } from '@/domain/meal';
import {
  getActiveGoal,
  getCheckIn,
  getDaySummary,
  getFestiveDaysInRange,
  getProteinLeft,
  getToday,
  getWeekBudget,
  getWeightTrend,
} from './selectors';

let db: KiraMakanDb;

beforeEach(async () => {
  db = createDb(`selectors-${crypto.randomUUID()}`);
  await loadDemo(db);
  setDemoClock(true);
});

afterEach(async () => {
  setDemoClock(false);
  await db.delete();
});

describe('demo day read models', () => {
  it('knows today from the demo clock', async () => {
    expect(await getToday(db)).toBe(DEMO_EXPECTED.today.day);
  });

  it('resolves the active Cut goal and its version', async () => {
    const active = await getActiveGoal(db, DEMO_EXPECTED.today.day);
    expect(active?.goal.id).toBe(DEMO_IDS.goals.cut);
    expect(active?.version.dailyKcal).toBe(1800);
    expect(active?.paused).toBe(false);
    expect(await getActiveGoal(db, '2026-09-01')).toBeUndefined();
  });

  it('builds the week budget of the design sample', async () => {
    const view = await getWeekBudget(db);
    expect(view).toBeDefined();
    const budget = view!.budget;
    expect(budget.weekStart).toBe(DEMO_EXPECTED.weekStart);
    expect(budget.savedKcal).toBe(DEMO_EXPECTED.savedThisWeekKcal);
    expect(budget.leftTodayKcal).toBe(DEMO_EXPECTED.leftTodayKcal);
    expect(budget.leftThisWeekKcal).toBe(DEMO_EXPECTED.leftThisWeekKcal);
    expect(budget.weeklyBudgetKcal).toBe(DEMO_EXPECTED.weeklyBudgetKcal);
    expect(budget.eatenSoFarKcal).toBe(DEMO_EXPECTED.eatenSoFarKcal);
    expect(budget.makanDay).toBe(DEMO_EXPECTED.makanDay);
    expect(budget.makanRoomKcal).toBe(DEMO_EXPECTED.makanRoomKcal);
    expect(budget.pendingSavedKcal).toBe(0);
    expect(view!.goal.id).toBe(DEMO_IDS.goals.cut);
    expect(view!.plan?.makanDay).toBe(DEMO_EXPECTED.makanDay);
    expect(budget.days.map((d) => d.kind)).toEqual(['logged', 'logged', 'logged', 'logged', 'today', 'makan', 'planned']);
  });

  it('shows last week as finished, with the futsal workout and the not-counted Sunday', async () => {
    const view = await getWeekBudget(db, DEMO_EXPECTED.lastWeekStart);
    const budget = view!.budget;
    expect(budget.workoutsKcal).toBe(DEMO_EXPECTED.lastWeek.futsal.netKcal);
    expect(budget.days.every((d) => d.isFinished)).toBe(true);
    expect(budget.days.at(-1)?.kind).toBe('notCounted');
    expect(budget.eatenSoFarKcal).toBe(DEMO_EXPECTED.lastWeek.loggedKcal);
    expect(budget.weeklyBudgetKcal).toBe(DEMO_EXPECTED.lastWeek.weeklyBudgetKcal);
    expect(budget.savedKcal).toBe(-DEMO_EXPECTED.lastWeek.overBudgetKcal);
    expect(budget.makanDay).toBe(DEMO_EXPECTED.lastWeek.makanDay);
  });

  it("summarises today's meals with macros, window and timing tags", async () => {
    const summary = await getDaySummary(db, DEMO_EXPECTED.today.day);
    expect(summary.meals.map((m) => m.id)).toEqual([DEMO_EXPECTED.today.breakfast.id, DEMO_EXPECTED.today.lunch.id]);
    expect(summary.kcal).toBe(DEMO_EXPECTED.today.kcal);
    expect(Math.round(summary.macros.proteinG)).toBe(DEMO_EXPECTED.today.macros.proteinG);
    expect(summary.window.closesAt).toBe(DEMO_EXPECTED.today.windowClosesAt);
    expect(summary.tags[DEMO_EXPECTED.today.breakfast.id]).toBe('lateForYou');
    expect(summary.tags[DEMO_EXPECTED.today.lunch.id]).toBe('onTime');
    expect(summary.record).toBeUndefined();
    expect(summary.range.low).toBeLessThan(summary.kcal);
    expect(summary.range.high).toBeGreaterThan(summary.kcal);
  });

  it('reads the weight trend with the salt-and-water annotation', async () => {
    const trend = await getWeightTrend(db);
    expect(trend.points).toHaveLength(DEMO_EXPECTED.weights.kg.length);
    expect(trend.latest?.trendKg).toBeCloseTo(DEMO_EXPECTED.weights.trendKg, 2);
    expect(trend.latest?.kg).toBe(DEMO_EXPECTED.weights.latestKg);
    // "This week −0.4 kg": the trend now minus the trend on Sunday 11 Oct.
    expect(trend.weekChangeKg).toBeCloseTo(DEMO_EXPECTED.weights.weekChangeKg, 2);
    expect(fmtKgDelta(trend.weekChangeKg ?? 0)).toBe('−0.4 kg');
    expect(trend.annotation).toMatchObject({ day: '2026-10-09', kg: 79, text: 'Friday jump: salt and water' });
    expect(trend.points[trend.annotation!.index]?.day).toBe('2026-10-09');
    expect(trend.entries[0]?.logicalDay).toBe(DEMO_EXPECTED.weights.lastDay);
  });

  it('needs no check-in when yesterday is complete', async () => {
    const checkIn = await getCheckIn(db);
    expect(checkIn.day).toBe('2026-10-15');
    expect(checkIn.queue).toEqual([]);
    expect(checkIn.needed).toBe(false);
    expect(checkIn.variant).toBe('light');
    expect(checkIn.title).toBe('Yesterday: 3 meals, 1,680 kcal. All there?');
  });

  it('asks about an unconfirmed yesterday with a missing dinner', async () => {
    await db.meals.delete('meal-2026-10-15-dinner');
    await db.days.put({ logicalDay: '2026-10-15', status: 'unconfirmed' });

    const checkIn = await getCheckIn(db);
    expect(checkIn.needed).toBe(true);
    expect(checkIn.variant).toBe('full');
    expect(checkIn.analysis.gap?.missingSlot).toBe('dinner');
    expect(checkIn.title).toMatch(/^Yesterday · 2 meals · [\d,]+ kcal$/);
    expect(checkIn.explanation).toMatch(/^Nothing logged for \d+ hours after 1:30pm\. You usually have dinner around /);
    expect(checkIn.guess?.slot).toBe('dinner');
    expect(checkIn.typicalKcal).toBeGreaterThan(0);
    expect(checkIn.options.map((o) => o.id)).toEqual(['complete', 'fillTypical', 'addMore', 'notCounted']);
    const fill = checkIn.options.find((o) => o.id === 'fillTypical');
    expect(fill?.label).toMatch(/^I had dinner\. Fill in a typical one \(~[\d,]+\)$/);
    expect(checkIn.options.at(-1)?.consequence).toBe('Counts as exactly 1,800. Missed meals never count as calories saved.');
  });

  it('before usual meal times are known, offers the full card for a day logged well under target', async () => {
    // A new user: no history to learn slot times from, and yesterday has one small meal.
    const meals = await db.meals.toArray();
    const keep = meals
      .filter((m) => m.logicalDay === '2026-10-15')
      .sort((a, b) => mealMacros(a).kcal - mealMacros(b).kcal)[0]!;
    await db.meals.bulkDelete(meals.filter((m) => m.id !== keep.id).map((m) => m.id));
    await db.days.put({ logicalDay: '2026-10-15', status: 'unconfirmed' });
    expect(mealMacros(keep).kcal).toBeLessThan(900);

    const checkIn = await getCheckIn(db);
    expect(checkIn.needed).toBe(true);
    expect(checkIn.analysis.looksIncomplete).toBe(false);
    expect(checkIn.variant).toBe('full');
    expect(checkIn.options.map((o) => o.id)).toEqual(['complete', 'addMore', 'notCounted']);
    expect(checkIn.explanation).toBe("That's under half of the day's 1,800 kcal. If meals are missing, you can leave the day out.");

    // A day logged near its target stays the light "All there?" card.
    await db.meals.put({ ...keep, id: 'big', items: keep.items.map((i) => ({ ...i, unitMacros: { ...i.unitMacros, kcal: 1700 } })) });
    expect((await getCheckIn(db)).variant).toBe('light');
  });

  it('counts a not-counted day as its target plus that day’s workouts', async () => {
    await db.meals.delete('meal-2026-10-15-dinner');
    await db.days.delete('2026-10-15');
    await db.workouts.put({ id: 'w', logicalDay: '2026-10-15', type: 'futsal', minutes: 60, intensity: 'moderate', netKcal: 470, createdAt: DEMO_EXPECTED.now });
    const checkIn = await getCheckIn(db);
    expect(checkIn.targetKcal).toBe(1800);
    expect(checkIn.notCountedKcal).toBe(2270);
    expect(checkIn.options.at(-1)?.consequence).toBe('Counts as exactly 2,270. Missed meals never count as calories saved.');
  });

  it('queues every unconfirmed day this week, newest first, so none keeps its savings held back', async () => {
    await db.days.bulkDelete(['2026-10-14', '2026-10-15']);
    let checkIn = await getCheckIn(db);
    expect(checkIn.queue).toEqual(['2026-10-15', '2026-10-14']);
    expect(checkIn.day).toBe('2026-10-15');
    expect((await getWeekBudget(db))!.budget.pendingSavedKcal).toBe(380);

    await db.days.put({ logicalDay: '2026-10-15', status: 'complete' });
    checkIn = await getCheckIn(db);
    expect(checkIn.queue).toEqual(['2026-10-14']);
    expect(checkIn).toMatchObject({ day: '2026-10-14', needed: true, variant: 'light' });
    expect(checkIn.title).toBe('Wed 14 Oct: 4 meals, 1,540 kcal. All there?');
    expect(checkIn.options[0]?.consequence).toBe('Marks Wed 14 Oct complete. Counts toward maintenance and timing.');

    await db.days.put({ logicalDay: '2026-10-14', status: 'complete' });
    checkIn = await getCheckIn(db);
    expect(checkIn).toMatchObject({ day: '2026-10-15', queue: [], needed: false });
    expect((await getWeekBudget(db))!.budget.pendingSavedKcal).toBe(0);
  });

  it('asks about a given day when told to', async () => {
    const checkIn = await getCheckIn(db, { day: '2026-10-13' });
    expect(checkIn.day).toBe('2026-10-13');
    expect(checkIn.needed).toBe(false);
  });

  it('counts protein left today', async () => {
    expect(await getProteinLeft(db, DEMO_EXPECTED.today.day)).toEqual({ targetG: 110, eatenG: 42, leftG: 68 });
  });

  it('counts festive days in range only while Festive maintain was active', async () => {
    const thisWeek = [DEMO_EXPECTED.weekStart, DEMO_EXPECTED.today.day] as const;
    expect(await getFestiveDaysInRange(db, ...thisWeek)).toEqual({ inRange: 0, days: 0 });

    // Festive maintain (2,100 ± 10% = 1,890–2,310) from this Monday; Tue gets a 300 kcal snack → 2,010.
    await db.goalPeriods.update(DEMO_IDS.goalPeriods.cut, { to: DEMO_EXPECTED.weekStart });
    await db.goalPeriods.put({ id: 'festive-period', goalId: DEMO_IDS.goals.festive, from: DEMO_EXPECTED.weekStart });
    const tuesdaySnack = await db.meals.get('meal-2026-10-13-lunch');
    await db.meals.put({
      ...tuesdaySnack!,
      id: 'extra-snack',
      slot: 'snack',
      items: [{ id: 'extra-snack-1', name: 'Karipap', unitMacros: { kcal: 300, proteinG: 5, carbsG: 30, fatG: 17 }, quantity: 1, uncertainty: 0.15, source: 'catalogue' }],
    });

    expect(await getFestiveDaysInRange(db, ...thisWeek)).toEqual({ inRange: 1, days: 4, lowKcal: 1890, highKcal: 2310 });
  });
});

describe('budget edge cases', () => {
  it('holds an unconfirmed yesterday’s savings as pending', async () => {
    await db.days.put({ logicalDay: '2026-10-15', status: 'unconfirmed' });
    const budget = (await getWeekBudget(db))!.budget;
    expect(budget.pendingSavedKcal).toBe(120);
    expect(budget.savedKcal).toBe(530);
  });

  it('gives a paused day no budget', async () => {
    await db.goalPeriods.update(DEMO_IDS.goalPeriods.cut, { to: '2026-10-14' });
    await db.goalPeriods.put({ id: 'pause-period', goalId: DEMO_IDS.goals.pause, from: '2026-10-14', to: '2026-10-15' });
    await db.goalPeriods.put({ id: 'cut-again', goalId: DEMO_IDS.goals.cut, from: '2026-10-15' });

    const pausedGoal = await getActiveGoal(db, '2026-10-14');
    expect(pausedGoal?.paused).toBe(true);
    // Pause has no targets of its own; it carries the Cut version for macros and maintenance.
    expect(pausedGoal?.version.id).toBe(DEMO_IDS.goalVersions.cut);

    const budget = (await getWeekBudget(db))!.budget;
    expect(budget.days[2]?.kind).toBe('paused');
    expect(budget.weeklyBudgetKcal).toBe(1800 * 6);
  });
});
