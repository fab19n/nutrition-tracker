import { DEMO_EXPECTED } from '@/db/seed/demo';
import { instantAt } from '@/domain/day';
import { buildInsightContext, dayNumberOf, insightPeriodFor, isSundayNight, reviewWeekStart, weekNumberOf } from './context';
import { categoryShares } from './categories';
import { evaluateInsights, focusOptions, NOT_FOR_ME_PAUSE_DAYS, pausedRuleIds, pausedUntilFrom, unlockProgress } from './engine';
import { focusOutcome } from './focusRules';
import { INSIGHT_RULES, shortPlaceName } from './rules';
import { learnedAboutYou, placeTotals, recurringItems, timingGrid } from './summaries';
import { demoWeekContext, demoWorldContext, notForMe } from './testWorld';
import type { InsightRule } from './types';

const TODAY = DEMO_EXPECTED.today.day;
const LAST_WEEK = DEMO_EXPECTED.lastWeekStart;

describe('context', () => {
  it('counts days and weeks of use like the design header ("Week 3 · day 19")', () => {
    expect(dayNumberOf(DEMO_EXPECTED.startedOn, TODAY)).toBe(19);
    expect(weekNumberOf(DEMO_EXPECTED.startedOn, TODAY)).toBe(3);
    expect(dayNumberOf(TODAY, TODAY)).toBe(1);
  });

  it('reviews last week, or this week from Sunday night', () => {
    expect(reviewWeekStart(TODAY, DEMO_EXPECTED.now)).toBe(LAST_WEEK);
    expect(isSundayNight('2026-10-18', instantAt('2026-10-18', 19, 0))).toBe(true);
    expect(isSundayNight('2026-10-18', instantAt('2026-10-18', 15, 0))).toBe(false);
    // 1am Monday still belongs to Sunday's logical day.
    expect(isSundayNight('2026-10-18', instantAt('2026-10-18', 25, 0))).toBe(true);
    expect(reviewWeekStart('2026-10-18', instantAt('2026-10-18', 20, 0))).toBe(DEMO_EXPECTED.weekStart);
  });

  it('describes everything so far on days 1–6, then the review week', () => {
    expect(insightPeriodFor('2026-10-01', DEMO_EXPECTED.startedOn, '2026-09-21')).toEqual({ from: '2026-09-28', to: '2026-10-01', kind: 'soFar' });
    expect(insightPeriodFor(TODAY, DEMO_EXPECTED.startedOn, LAST_WEEK)).toEqual({ from: LAST_WEEK, to: '2026-10-11', kind: 'week' });
    // Started last Saturday: last week had only 2 days in use, so the last 7 days are read.
    expect(insightPeriodFor(TODAY, '2026-10-10', LAST_WEEK)).toEqual({ from: '2026-10-10', to: '2026-10-15', kind: 'last7' });
  });

  it('builds the demo context from plain rows', () => {
    const ctx = demoWorldContext();
    expect(ctx.period).toEqual({ from: LAST_WEEK, to: '2026-10-11', kind: 'week' });
    expect(ctx.periodDays).toHaveLength(7);
    expect(ctx.completeDays).toBe(17);
    expect(ctx.historyDays.at(-1)?.day).toBe('2026-10-15');
    expect(ctx.budget?.weekStart).toBe(LAST_WEEK);
  });
});

describe('rules on the demo world (last week, 5–11 Oct)', () => {
  const ctx = demoWorldContext();
  const evaluation = evaluateInsights(ctx);
  const byRule = (id: string) => evaluation.all.find((i) => i.ruleId === id);

  it('finds drinks at about 17% of calories, with 11 drinks behind it', () => {
    const drinks = byRule('categoryShare');
    expect(drinks).toBeDefined();
    const pct = Number(/(\d+)%/.exec(drinks!.headline)?.[1]);
    expect(pct).toBeGreaterThanOrEqual(17);
    expect(pct).toBeLessThanOrEqual(18);
    expect(drinks!.headline).toBe(`Drinks were ${pct}% of your calories`);
    expect(drinks!.evidence).toBe('Teh tarik 8 times, milo ais 3 times, ~2,170 kcal.');
    expect(drinks!.linkLabel).toBe('See 11 drinks');
    expect(drinks!.evidenceEntries).toHaveLength(11);
    expect(drinks!.focus).toBe('drinksKurang');
    expect(drinks!.category).toBe('drinks');
    expect(drinks!.tryText).toMatch(/^kurang manis for half of them, about \d+ kcal a week less$/);
    expect(drinks!.earlyRead).toBe(false);
    expect(drinks!.meta).toBe('Based on 7 days');
  });

  it('compares nasi kandar nights with meals elsewhere', () => {
    const place = byRule('placeComparison');
    expect(place?.headline).toBe('Nasi kandar nights cost the most');
    expect(place?.evidence).toMatch(/^4 visits, ~950 kcal each vs [\d,]+ elsewhere\.$/);
    expect(place?.linkLabel).toBe('See 4 visits');
    expect(place?.tryText).toBe('half rice there, or kuah sikit');
    expect(place?.focus).toBe('halfRiceNasiKandar');
    expect(place?.focusSub).toBe('Around 180 kcal a visit');
    expect(place?.meta).toBe('Based on 4 visits');
    expect(place?.evidenceMealIds).toHaveLength(4);
  });

  it('lists teh tarik as recurring calories (~8 a week)', () => {
    const meals = ctx.periodDays.flatMap((d) => d.meals);
    const recurring = recurringItems(meals, ctx.periodDays.length, ctx.places);
    expect(recurring[0]).toMatchObject({ name: 'Teh tarik', count: 8, kcalPerWeek: 1420 });
    expect(recurring.map((r) => r.name)).toEqual(['Teh tarik', 'Milo ais']);
    expect(byRule('recurringCalories')?.headline).toBe('Teh tarik adds up to ~1,420 kcal a week');
  });

  it('sees long eating days running higher and last week going over plan', () => {
    expect(byRule('windowVsCalories')).toMatchObject({ headline: 'Long eating days ran higher', focus: 'windowUnder12h' });
    expect(byRule('budgetResult')?.headline).toBe('Week finished 350 kcal over plan');
    expect(byRule('budgetResult')?.evidence).toBe('13,420 of 13,070. Saturday went over by 620.');
  });

  it('keeps day-21 rules locked on day 19', () => {
    expect(byRule('maintenanceEstimate')).toBeUndefined();
    expect(byRule('weightTrendVsPlan')).toBeUndefined();
  });

  it('splits calories into the design groups, adding up to 100%', () => {
    const shares = categoryShares(ctx.periodDays.flatMap((d) => d.meals), ctx.places);
    expect(shares.reduce((sum, s) => sum + s.pct, 0)).toBe(100);
    expect(shares[0]?.name).toBe('Rice dishes');
    expect(shares.map((s) => s.name)).toEqual(expect.arrayContaining(['Home cooking', 'Drinks', 'Noodles', 'Snacks and kuih']));
  });

  it('totals calories and spend by Place', () => {
    const places = placeTotals(ctx.periodDays.flatMap((d) => d.meals), ctx.places);
    expect(places[0]).toMatchObject({ name: 'Nasi kandar near home', kcal: 3800, spendRm: 58, visits: 4 });
    expect(shortPlaceName('Nasi kandar near home')).toBe('Nasi kandar');
    expect(shortPlaceName('Medan selera nearby')).toBe('Medan selera');
    expect(shortPlaceName('Home')).toBe('Home');
  });
});

describe('ranking and pausing', () => {
  const ctx = demoWorldContext();

  it('ranks by impact × confidence with one insight per topic', () => {
    const { ranked, top } = evaluateInsights(ctx);
    const scores = ranked.map((i) => i.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(top).toHaveLength(3);
    expect(new Set(top.map((i) => i.topic)).size).toBe(3);
    expect(top.map((i) => i.ruleId)).toEqual(expect.arrayContaining(['placeComparison', 'categoryShare']));
    // Teh tarik (recurring) and the drinks share are one topic: only the better one shows.
    expect(ranked.filter((i) => i.topic === 'drinks')).toHaveLength(1);
  });

  it('skips a rule paused with "Not for me" for about 4 weeks', () => {
    const until = pausedUntilFrom(TODAY);
    expect(until).toBe('2026-11-13');
    expect(NOT_FOR_ME_PAUSE_DAYS).toBe(28);
    const paused = evaluateInsights(ctx, { feedback: [notForMe('placeComparison', until)] });
    expect(paused.top.map((i) => i.ruleId)).not.toContain('placeComparison');
    expect(paused.top).toHaveLength(3);
    // Still found, so its evidence can be shown.
    expect(paused.all.map((i) => i.ruleId)).toContain('placeComparison');
    expect(pausedRuleIds([notForMe('placeComparison', until)], until).size).toBe(0);
    expect(pausedRuleIds([{ ruleId: 'grazing', feedback: 'useful', at: DEMO_EXPECTED.now }], TODAY).size).toBe(0);
  });

  it('labels thin data "Early read"', () => {
    const thin = { ...ctx, completeDays: 9 };
    const window = evaluateInsights(thin).all.find((i) => i.ruleId === 'windowVsCalories');
    expect(window?.earlyRead).toBe(true);
    expect(window?.meta).toMatch(/^Early read · based on \d+ days$/);
  });

  it('runs a rule only from its unlock day', () => {
    const always: InsightRule = {
      id: 'grazing',
      unlockDay: 21,
      solidDays: 21,
      minimumData: 'test',
      compute: () => ({
        headline: 'x',
        evidence: 'y',
        linkLabel: '',
        evidenceMealIds: [],
        evidenceEntries: [],
        summary: '',
        tryText: 'z',
        impactKcalPerWeek: 100,
        confidence: 1,
        earlyRead: false,
        basisDays: 1,
        topic: 't',
      }),
    };
    expect(evaluateInsights({ ...ctx, dayNumber: 20 }, { rules: [always] }).all).toHaveLength(0);
    expect(evaluateInsights({ ...ctx, dayNumber: 21 }, { rules: [always] }).all[0]?.meta).toBe('Based on 1 day');
  });
});

describe('unlock schedule and early days', () => {
  it('stays quiet on days 1–6 and shows progress', () => {
    const ctx = demoWorldContext({ today: '2026-10-01' });
    expect(ctx.period.kind).toBe('soFar');
    expect(ctx.dayNumber).toBe(4);
    expect(evaluateInsights(ctx).all).toHaveLength(0);
    expect(unlockProgress(ctx)).toEqual([
      { label: 'Weekly review and patterns', have: 3, need: 7 },
      { label: 'Timing patterns', have: 3, need: 14 },
      { label: 'Your real maintenance', have: 3, need: 21 },
    ]);
  });

  it('counts complete days toward timing and maintenance on day 19', () => {
    expect(unlockProgress(demoWorldContext())).toEqual([
      { label: 'Timing patterns', have: 17, need: 14 },
      { label: 'Your real maintenance', have: 17, need: 21 },
    ]);
  });

  it('works from rows with no goal, weights or meals', () => {
    const ctx = buildInsightContext({
      today: '2026-10-16',
      profile: { startedOn: '2026-10-16' },
      period: { from: '2026-10-16', to: '2026-10-16', kind: 'soFar' },
      meals: [],
      records: [],
      workouts: [],
      weights: [],
      places: [],
    });
    expect(ctx.dayNumber).toBe(1);
    expect(evaluateInsights(ctx).top).toEqual([]);
    expect(INSIGHT_RULES.every((rule) => rule.compute({ ...ctx, dayNumber: 30 }) === null)).toBe(true);
  });
});

describe('weekly focus', () => {
  const ctx = demoWeekContext(LAST_WEEK);
  const meals = ctx.periodDays.flatMap((d) => d.meals);

  it('counts how last week’s focus went, with the rules Today uses', () => {
    expect(focusOutcome('drinksKurang', meals, LAST_WEEK, TODAY)).toEqual({ done: 3, total: 11 });
    expect(focusOutcome('halfRiceNasiKandar', meals, LAST_WEEK, TODAY)).toEqual({ done: 0, total: 4 });
    expect(focusOutcome('windowUnder12h', meals, LAST_WEEK, TODAY)).toEqual({ done: 4, total: 7 });
  });

  it('offers three options from the top insights, with their numbers', () => {
    const options = focusOptions(evaluateInsights(ctx).top);
    expect(options).toHaveLength(3);
    expect(options.map((o) => o.ruleId).sort()).toEqual(['drinksKurang', 'halfRiceNasiKandar', 'windowUnder12h']);
    expect(options.find((o) => o.ruleId === 'drinksKurang')).toMatchObject({ label: 'Kurang manis for drinks', sub: expect.stringMatching(/^About \d+ kcal a week less$/) });
    expect(options.find((o) => o.ruleId === 'windowUnder12h')?.label).toBe('Keep eating days under 12 hours');
    expect(focusOptions([])).toHaveLength(3);
  });
});

describe('timing grid and the day-7 review', () => {
  it('draws one row per day with late meals flagged', () => {
    const ctx = demoWorldContext();
    const grid = timingGrid(ctx.periodDays, { baselines: ctx.baselines, tz: ctx.tz, rolloverHour: ctx.rolloverHour });
    expect(grid.rows.map((r) => r.label)).toEqual(['M', 'T', 'W', 'T', 'F', 'S', 'S']);
    const friday = grid.rows[4]!;
    // 12:30am Maggi kari supper: after midnight, flagged.
    expect(friday.dots.at(-1)?.late).toBe(true);
    expect(friday.windowHours).toBe(15);
    expect(grid.rows.every((r) => r.dots.every((d) => d.sizePx >= 7 && d.sizePx <= 12))).toBe(true);
    expect(grid.averageWindowHours).toBeGreaterThan(10);
  });

  it('learns usual times, Places and meals in the first week', () => {
    const learned = learnedAboutYou(demoWeekContext('2026-09-28'));
    expect(learned.usualTimes.find((t) => t.slot === 'breakfast')?.minutes).toBe(9 * 60 + 30);
    expect(learned.topPlaces[0]?.name).toBe('Home');
    expect(learned.topFoods[0]).toEqual({ name: 'Economy rice', count: 5 });
    expect(learned).toMatchObject({ completeDays: 7, daysInUse: 7 });
  });
});
