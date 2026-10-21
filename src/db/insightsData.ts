/**
 * Read models, live-query hooks and small actions for Insights (S31), the evidence sheet (S32),
 * the weekly review (S33) and meal ideas (S36). Reads go through the repositories and the
 * shared selectors; the rules themselves live in src/domain/insights and src/domain/suggestions.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { db as appDb, newId, type KiraMakanDb } from '@/db/db';
import { useNow, useProfile, useToday } from '@/db/hooks';
import {
  addSuggestionEvent,
  deleteInsightFeedback,
  getInsightFeedback,
  getWeekPlan,
  listDayRecordsInRange,
  listInsightFeedback,
  listMealsInRange,
  listPlaces,
  listSuggestionEventsSince,
  listUsuals,
  listWeights,
  listWorkoutsInRange,
  putInsightFeedback,
  setSuggestionOutcome,
} from '@/db/repo';
import { GOAL_PRESETS } from '@/db/seed/defaults';
import { getActiveGoal, getDaySummary, getProteinLeft, getWeekBudget, loadSettings, todayFor, type Settings } from '@/db/selectors';
import { getTargetCheck } from '@/db/targetSuggestion';
import type { BudgetDay } from '@/domain/budget';
import { now as clockNow } from '@/domain/clock';
import { DEFAULT_ROLLOVER_HOUR, DEFAULT_TZ, addDays, compareDays, weekDays, weekStartOf } from '@/domain/day';
import { fmtDayRange, fmtInt } from '@/domain/format';
import {
  buildInsightContext,
  categoryShares,
  evaluateInsights,
  focusOptions,
  focusOutcome,
  insightPeriodFor,
  focusRuleIdOf,
  isSundayNight,
  learnedAboutYou,
  pausedUntilFrom,
  periodPhrase,
  placeTotals,
  recurringItems,
  reviewWeekStart,
  timingGrid,
  TOP_INSIGHTS,
  unlockProgress,
  weekNumberOf,
  weekPeriod,
  type CategoryGroupId,
  type CategoryShare,
  type FocusOption,
  type InsightContext,
  type InsightEvaluation,
  type InsightPeriod,
  type LearnedAboutYou,
  type PlaceTotal,
  type RankedInsight,
  type RecurringItem,
  type TimingRow,
  type UnlockItem,
  type WeeklyFocus,
} from '@/domain/insights';
import { DEFAULT_MAX_WINDOW_HOURS, suggestSlot } from '@/domain/timing';
import { suggestMeals, type IdeasMode, type MealSuggestion, type SuggestionRole } from '@/domain/suggestions';
import { paceOf } from '@/domain/targets';
import { trendChange, weekTrendChange, weightTrend } from '@/domain/trend';
import type { Id, InsightFeedback, Instant, LogicalDay, MealLog, MealSlot, SuggestionEvent } from '@/domain/types';
import { normaliseName } from '@/data/catalogue';

export type Undo = () => Promise<void>;

interface ReadOptions {
  today?: LogicalDay;
  /** The current moment (Sunday-night review, meal slot); the clock by default. */
  now?: Date;
}

/** Meals for suggestions look back this far. */
const IDEAS_HISTORY_DAYS = 60;
/** "Recently ignored" suggestions. */
const IGNORED_LOOKBACK_DAYS = 14;
const HISTORY_DAYS = 28;

function earlierOf(a: LogicalDay, b: LogicalDay): LogicalDay {
  return compareDays(a, b) <= 0 ? a : b;
}

// ---------------------------------------------------------------------------
// Shared loading
// ---------------------------------------------------------------------------

interface InsightState {
  settings: Settings;
  today: LogicalDay;
  at: Date;
  ctx: InsightContext;
  evaluation: InsightEvaluation;
  feedback: InsightFeedback[];
  meals: MealLog[];
}

/** Loads the rows behind a period and runs the rules on them. */
async function loadInsightState(db: KiraMakanDb, opts: ReadOptions, pickPeriod: (today: LogicalDay, startedOn: LogicalDay, at: Date, settings: Settings) => InsightPeriod): Promise<InsightState | undefined> {
  const settings = await loadSettings(db);
  const profile = settings.profile;
  if (!profile) return undefined;
  const at = opts.now ?? clockNow();
  const today = opts.today ?? todayFor(profile, at);
  const period = pickPeriod(today, profile.startedOn, at, settings);
  const from = earlierOf(addDays(today, -HISTORY_DAYS), period.from);
  const [meals, records, workouts, weights, places, feedback, active, budgetView, target] = await Promise.all([
    listMealsInRange(db, from, today),
    listDayRecordsInRange(db, from, today),
    listWorkoutsInRange(db, from, today),
    listWeights(db),
    listPlaces(db),
    listInsightFeedback(db),
    getActiveGoal(db, today),
    period.kind === 'week' ? getWeekBudget(db, period.from, { today }) : Promise.resolve(undefined),
    getTargetCheck(db, { today }),
  ]);
  const ctx = buildInsightContext({
    today,
    profile,
    period,
    meals,
    records: records.filter((r) => compareDays(r.logicalDay, today) < 0),
    workouts,
    weights,
    places,
    ...(active ? { goal: active.goal, version: active.version } : {}),
    ...(budgetView ? { budget: budgetView.budget } : {}),
    ...(target ? { maintenance: target.check } : {}),
  });
  return { settings, today, at, ctx, evaluation: evaluateInsights(ctx, { feedback }), feedback, meals };
}

function tabPeriod(today: LogicalDay, startedOn: LogicalDay, at: Date, settings: Settings): InsightPeriod {
  return insightPeriodFor(today, startedOn, reviewWeekStart(today, at, settings.tz, settings.rolloverHour));
}

// ---------------------------------------------------------------------------
// Insights tab (S31)
// ---------------------------------------------------------------------------

export interface BudgetResult {
  /** Counted − budget over the finished days (positive = over plan). */
  overKcal: number;
  countedKcal: number;
  budgetKcal: number;
}

export interface InsightsView {
  today: LogicalDay;
  dayNumber: number;
  weekNumber: number;
  /** "Week 3 · day 19". */
  headerLabel: string;
  /** Days 1–6: budget and categories only. */
  early: boolean;
  period: InsightPeriod;
  /** "last week", "so far". */
  periodLabel: string;
  tiles: {
    /** The period's week result (normal), or undefined in the early days. */
    budget?: BudgetResult;
    /** This week's savings so far (early days). */
    savedSoFarKcal?: number;
    trendChangeKg: number | null;
    latestTrendKg?: number;
    /** The goal's pace (kg a week, positive = lose), to tell a good trend change from a neutral one. */
    paceKgPerWeek: number;
    complete: { done: number; of: number };
  };
  review: {
    weekStart: LogicalDay;
    /** The week the picked focus goes on. */
    focusWeekStart: LogicalDay;
    /** Day 7 onwards, with days in use that week. */
    available: boolean;
    /** A focus for the week after it has been picked. */
    seen: boolean;
    sundayNight: boolean;
    rangeLabel: string;
  };
  top: RankedInsight[];
  feedback: Record<string, InsightFeedback>;
  /** The top insight's category, highlighted in "Where it came from". */
  highlightCategory?: CategoryGroupId;
  categories: CategoryShare[];
  places: PlaceTotal[];
  recurring: RecurringItem[];
  timing: { rows: TimingRow[]; averageWindowHours: number | null; completeDays: number; earlyRead: boolean; rolloverHour: number };
  unlocks: UnlockItem[];
}

const TIMING_SOLID_DAYS = 14;

export async function getInsightsView(db: KiraMakanDb, opts: ReadOptions = {}): Promise<InsightsView | undefined> {
  const state = await loadInsightState(db, opts, tabPeriod);
  if (!state) return undefined;
  const { ctx, evaluation, settings, today, at } = state;
  const periodMeals = ctx.periodDays.flatMap((d) => d.meals);
  const early = ctx.dayNumber < 7;

  const reviewWeek = reviewWeekStart(today, at, settings.tz, settings.rolloverHour);
  const focusWeek = addDays(reviewWeek, 7);
  const [focusPlan, thisWeek] = await Promise.all([
    getWeekPlan(db, focusWeek),
    ctx.period.kind === 'week' ? Promise.resolve(undefined) : getWeekBudget(db, today, { today }),
  ]);

  const points = ctx.trend;
  const trendChangeKg = ctx.period.kind === 'week' ? weekTrendChange(points, ctx.period.from) : trendChange(points, 7);
  const latest = points.at(-1);
  const finishedDays = ctx.periodDays.filter((d) => compareDays(d.day, today) < 0);

  const tiles: InsightsView['tiles'] = {
    trendChangeKg,
    paceKgPerWeek: ctx.goal ? paceOf(ctx.goal, ctx.version) : 0,
    complete: { done: finishedDays.filter((d) => d.status === 'complete').length, of: finishedDays.length },
  };
  if (latest) tiles.latestTrendKg = latest.trendKg;
  if (ctx.budget && ctx.period.kind === 'week') {
    const done = ctx.budget.days.filter((d) => d.isFinished && d.kind !== 'paused');
    const countedKcal = done.reduce((sum, d) => sum + d.countedKcal, 0);
    const budgetKcal = done.reduce((sum, d) => sum + d.baseKcal, 0);
    tiles.budget = { overKcal: countedKcal - budgetKcal, countedKcal, budgetKcal };
  } else if (thisWeek) {
    tiles.savedSoFarKcal = thisWeek.budget.savedKcal;
  }

  // This week Mon–Sun (rows read M T W T F S S, as designed): finished days, today so far, and
  // empty rows for the days to come. The average window counts this week's finished days, else
  // (on a Monday) the last 7 finished days.
  const gridOpts = {
    baselines: ctx.baselines,
    tz: ctx.tz,
    rolloverHour: ctx.rolloverHour,
    maxWindowHours: ctx.goal?.timing.maxWindowHours ?? DEFAULT_MAX_WINDOW_HOURS,
  };
  const historyByDay = new Map(ctx.historyDays.map((d) => [d.day, d]));
  const weekRows = weekDays(weekStartOf(today)).map((day) =>
    day === today ? buildTodayDay(state) : (historyByDay.get(day) ?? emptyDay(day)),
  );
  const grid = timingGrid(weekRows, gridOpts);
  const finishedThisWeek = timingGrid(weekRows.filter((d) => compareDays(d.day, today) < 0), gridOpts);
  const finishedWeek = timingGrid(ctx.historyDays.slice(-7), gridOpts);

  // While a target suggestion waits, its card (C45) leads the screen, so the same finding isn't in the top 3 too.
  const top = ctx.maintenance?.kind === 'suggestion'
    ? evaluation.ranked.filter((i) => i.ruleId !== 'maintenanceEstimate').slice(0, TOP_INSIGHTS)
    : evaluation.top;
  const highlightCategory = top.find((i) => i.category !== undefined)?.category;
  const view: InsightsView = {
    today,
    dayNumber: ctx.dayNumber,
    weekNumber: weekNumberOf(ctx.startedOn, today),
    headerLabel: `Week ${fmtInt(weekNumberOf(ctx.startedOn, today))} · day ${fmtInt(ctx.dayNumber)}`,
    early,
    period: ctx.period,
    periodLabel: periodPhrase(ctx),
    tiles,
    review: {
      weekStart: reviewWeek,
      focusWeekStart: focusWeek,
      available: !early && compareDays(addDays(reviewWeek, 6), ctx.startedOn) >= 0,
      seen: focusPlan?.focus !== undefined,
      sundayNight: isSundayNight(today, at, settings.tz, settings.rolloverHour),
      rangeLabel: fmtDayRange(reviewWeek, addDays(reviewWeek, 6)),
    },
    top: early ? [] : top,
    feedback: Object.fromEntries(state.feedback.map((f) => [f.ruleId, f])),
    categories: categoryShares(periodMeals, ctx.places),
    places: placeTotals(periodMeals, ctx.places),
    recurring: early ? [] : recurringItems(periodMeals, ctx.periodDays.length, ctx.places),
    timing: {
      rows: grid.rows,
      averageWindowHours: finishedThisWeek.averageWindowHours ?? finishedWeek.averageWindowHours ?? grid.averageWindowHours,
      completeDays: ctx.completeDays,
      earlyRead: ctx.completeDays < TIMING_SOLID_DAYS,
      rolloverHour: ctx.rolloverHour,
    },
    unlocks: unlockProgress(ctx),
  };
  if (highlightCategory && !early) view.highlightCategory = highlightCategory;
  return view;
}

/** A day with nothing on it (still to come, or before the app was in use). */
function emptyDay(day: LogicalDay): InsightContext['periodDays'][number] {
  return { day, status: null, meals: [], eatenKcal: 0, workoutKcal: 0 };
}

/** Today as an insight day (the history stops at yesterday). */
function buildTodayDay(state: InsightState): InsightContext['periodDays'][number] {
  const meals = state.meals.filter((m) => m.logicalDay === state.today);
  return { day: state.today, status: null, meals, eatenKcal: 0, workoutKcal: 0 };
}

// ---------------------------------------------------------------------------
// Evidence sheet (S32)
// ---------------------------------------------------------------------------

export interface EvidenceRow {
  meal: MealLog;
  /** kcal of the part the insight is about. */
  kcal: number;
  label?: string;
}

export interface EvidenceView {
  ruleId: string;
  insight?: RankedInsight;
  paused: boolean;
  rows: EvidenceRow[];
  /** Evidence kcal per day of the period, oldest first. */
  days: { day: LogicalDay; kcal: number }[];
  placeNames: Record<Id, string>;
  tz: string;
}

export async function getEvidence(db: KiraMakanDb, ruleId: string, opts: ReadOptions = {}): Promise<EvidenceView | undefined> {
  const state = await loadInsightState(db, opts, tabPeriod);
  if (!state) return undefined;
  const insight = state.evaluation.all.find((i) => i.ruleId === ruleId);
  const mealById = new Map(state.meals.map((m) => [m.id, m]));
  const rows: EvidenceRow[] = (insight?.evidenceEntries ?? []).flatMap((entry) => {
    const meal = mealById.get(entry.mealId);
    if (!meal) return [];
    const row: EvidenceRow = { meal, kcal: entry.kcal };
    if (entry.label) row.label = entry.label;
    return [row];
  });
  rows.sort((a, b) => Date.parse(a.meal.eatenAt) - Date.parse(b.meal.eatenAt));
  const perDay = new Map<LogicalDay, number>();
  for (const row of rows) perDay.set(row.meal.logicalDay, (perDay.get(row.meal.logicalDay) ?? 0) + row.kcal);
  const inPeriod = rows.every((r) => compareDays(r.meal.logicalDay, state.ctx.period.from) >= 0);
  const dayList = inPeriod ? state.ctx.periodDays.map((d) => d.day) : [...new Set(rows.map((r) => r.meal.logicalDay))];
  const places = await listPlaces(db);
  const view: EvidenceView = {
    ruleId,
    paused: state.evaluation.paused.has(ruleId),
    rows,
    days: dayList.map((day) => ({ day, kcal: Math.round(perDay.get(day) ?? 0) })),
    placeNames: Object.fromEntries(places.map((p) => [p.id, p.name])),
    tz: state.settings.tz,
  };
  if (insight) view.insight = insight;
  return view;
}

// ---------------------------------------------------------------------------
// Weekly review (S33)
// ---------------------------------------------------------------------------

export interface WeeklyReviewView {
  weekStart: LogicalDay;
  weekEnd: LogicalDay;
  /** "5–11 Oct". */
  rangeLabel: string;
  /** Where the picked focus goes: the week after. */
  focusWeekStart: LogicalDay;
  /** The first week of use: "What we learned about you" instead of a report. */
  firstWeek: boolean;
  /** Days of the week in use. */
  daysInUse: number;
  completeDays: number;
  /** Finished days marked "Don't count this day". */
  notCountedDays: LogicalDay[];
  budget?: BudgetResult & { days: BudgetDay[]; targetKcal: number | null };
  trend: { changeKg: number | null; paceKgPerWeek: number };
  /** How last week's focus went ("kurang manis for drinks: 3 of 11"). */
  lastFocus?: WeeklyFocus & { done: number; total: number };
  top: RankedInsight[];
  focusOptions: FocusOption[];
  /** Already picked for the next week. */
  currentFocus?: WeeklyFocus;
  learned?: LearnedAboutYou;
}

export async function getWeeklyReview(db: KiraMakanDb, weekStart: LogicalDay, opts: ReadOptions = {}): Promise<WeeklyReviewView | undefined> {
  const monday = weekStartOf(weekStart);
  const state = await loadInsightState(db, opts, (today) => weekPeriod(monday, today));
  if (!state) return undefined;
  const { ctx, evaluation, today } = state;
  const focusWeek = addDays(monday, 7);
  const [plan, nextPlan, budgetView] = await Promise.all([getWeekPlan(db, monday), getWeekPlan(db, focusWeek), getWeekBudget(db, monday, { today })]);
  const finishedDays = ctx.periodDays.filter((d) => compareDays(d.day, today) < 0);

  const view: WeeklyReviewView = {
    weekStart: monday,
    weekEnd: addDays(monday, 6),
    rangeLabel: fmtDayRange(monday, addDays(monday, 6)),
    focusWeekStart: focusWeek,
    firstWeek: monday === weekStartOf(ctx.startedOn),
    daysInUse: ctx.periodDays.length,
    completeDays: finishedDays.filter((d) => d.status === 'complete').length,
    notCountedDays: finishedDays.filter((d) => d.status === 'notCounted').map((d) => d.day),
    trend: { changeKg: weekTrendChange(weightTrend(await listWeights(db)), monday), paceKgPerWeek: ctx.goal ? paceOf(ctx.goal, ctx.version) : 0 },
    top: evaluation.top,
    focusOptions: focusOptions(evaluation.ranked),
  };
  if (budgetView) {
    const done = budgetView.budget.days.filter((d) => d.isFinished && d.kind !== 'paused');
    const countedKcal = done.reduce((sum, d) => sum + d.countedKcal, 0);
    const budgetKcal = done.reduce((sum, d) => sum + d.baseKcal, 0);
    view.budget = {
      overKcal: countedKcal - budgetKcal,
      countedKcal,
      budgetKcal,
      days: budgetView.budget.days,
      targetKcal: budgetView.goal.template === 'pause' ? null : budgetView.version.dailyKcal,
    };
  }
  const focus = plan?.focus;
  if (focus) {
    // Counted by the same rule Today's focus card uses (src/domain/focus.ts).
    const ruleId = focusRuleIdOf(focus);
    const outcome = ruleId
      ? focusOutcome(ruleId, ctx.periodDays.flatMap((d) => d.meals), monday, today, { tz: ctx.tz, rolloverHour: ctx.rolloverHour })
      : { done: 0, total: 0 };
    view.lastFocus = { ...focus, ...outcome };
  }
  if (nextPlan?.focus) view.currentFocus = nextPlan.focus;
  if (view.firstWeek) view.learned = learnedAboutYou(ctx);
  return view;
}

// ---------------------------------------------------------------------------
// Meal ideas (S36)
// ---------------------------------------------------------------------------

export interface MealIdeasView {
  today: LogicalDay;
  slot: MealSlot;
  /** null when there's no budget today (Pause). */
  leftTodayKcal: number | null;
  proteinLeftG: number | null;
  windowClosesAt?: Instant;
  windowClosed: boolean;
  mode: IdeasMode;
  hasHistory: boolean;
  cards: MealSuggestion[];
  pool: MealSuggestion[];
  /** Ideas already logged today (normalised names), shown as "Logged". */
  loggedNames: string[];
  tz: string;
}

export async function getMealIdeas(db: KiraMakanDb, opts: ReadOptions = {}): Promise<MealIdeasView | undefined> {
  const settings = await loadSettings(db);
  const profile = settings.profile;
  const at = opts.now ?? clockNow();
  const today = opts.today ?? todayFor(profile, at);
  const since = new Date(at.getTime() - IGNORED_LOOKBACK_DAYS * 86_400_000).toISOString();
  const [active, budgetView, protein, summary, history, usuals, places, events] = await Promise.all([
    getActiveGoal(db, today),
    getWeekBudget(db, today, { today }),
    getProteinLeft(db, today),
    getDaySummary(db, today),
    listMealsInRange(db, addDays(today, -IDEAS_HISTORY_DAYS), today),
    listUsuals(db),
    listPlaces(db),
    listSuggestionEventsSince(db, since),
  ]);
  const paused = active?.paused === true || !budgetView || budgetView.budget.todayBaseKcal <= 0;
  const leftTodayKcal = paused ? null : (budgetView?.budget.leftTodayKcal ?? null);
  const proteinLeftG = protein ? Math.max(0, protein.leftG) : null;
  const slot = suggestSlot(at, settings.tz, settings.rolloverHour);
  const closesAt = summary.window.closesAt;
  const weights = active?.goal.suggestionWeights ?? GOAL_PRESETS.cut.suggestionWeights;

  const result = suggestMeals({
    today,
    now: at,
    slot,
    leftTodayKcal,
    proteinLeftG,
    ...(closesAt ? { windowClosesAt: closesAt } : {}),
    history,
    usuals,
    places,
    events,
    weights,
    // CONTRACT: nearby Places come from location once Log asks for it; none until then.
    nearbyPlaceIds: [],
  });
  const view: MealIdeasView = {
    today,
    slot,
    leftTodayKcal,
    proteinLeftG,
    windowClosed: closesAt !== undefined && Date.parse(closesAt) < at.getTime(),
    mode: result.mode,
    hasHistory: result.hasHistory,
    cards: result.cards,
    pool: result.pool,
    loggedNames: summary.meals.filter((m) => m.method === 'idea').map((m) => normaliseName(m.name)),
    tz: settings.tz,
  };
  if (closesAt) view.windowClosesAt = closesAt;
  return view;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

const MS_PER_HOUR = 3_600_000;

/** The Insights tab, re-read when the data changes, the day rolls over or the hour turns (Sunday night). */
export function useInsights(): InsightsView | undefined {
  const today = useToday();
  const now = useNow();
  const hour = Math.floor(now.getTime() / MS_PER_HOUR);
  return useLiveQuery(() => getInsightsView(appDb, { today, now }), [today, hour]);
}

export function useEvidence(ruleId: string | null | undefined): EvidenceView | undefined {
  const today = useToday();
  const now = useNow();
  const hour = Math.floor(now.getTime() / MS_PER_HOUR);
  return useLiveQuery(() => (ruleId ? getEvidence(appDb, ruleId, { today, now }) : undefined), [ruleId, today, hour]);
}

/** The week the review is about by default: last week, or this week from Sunday night. */
export function useReviewWeekStart(): LogicalDay {
  const today = useToday();
  const now = useNow();
  const profile = useProfile();
  // The profile's zone and rollover, as getInsightsView uses, so both pick the same week.
  return reviewWeekStart(today, now, profile?.timeZone ?? DEFAULT_TZ, profile?.rolloverHour ?? DEFAULT_ROLLOVER_HOUR);
}

export function useWeeklyReview(weekStart: LogicalDay): WeeklyReviewView | undefined {
  const today = useToday();
  const now = useNow();
  const hour = Math.floor(now.getTime() / MS_PER_HOUR);
  return useLiveQuery(() => getWeeklyReview(appDb, weekStart, { today, now }), [weekStart, today, hour]);
}

/** Meal ideas for now: re-read every minute, since the slot and the window move with the clock. */
export function useMealIdeas(): MealIdeasView | undefined {
  const today = useToday();
  const now = useNow();
  const minute = now.getTime();
  return useLiveQuery(() => getMealIdeas(appDb, { today, now }), [today, minute]);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Answers on an insight card ("Keep current" belongs to the target suggestion, src/db/targetSuggestion.ts). */
type InsightAnswer = Exclude<InsightFeedback['feedback'], 'keepCurrent'>;

/** "Useful" or "Not for me" (which pauses the rule for about 4 weeks). The undo puts back the previous answer. */
async function recordFeedbackIn(db: KiraMakanDb, ruleId: string, feedback: InsightAnswer, today?: LogicalDay): Promise<Undo> {
  const settings = await loadSettings(db);
  const day = today ?? todayFor(settings.profile);
  const previous = await getInsightFeedback(db, ruleId);
  const row: InsightFeedback = { ruleId, feedback, at: clockNow().toISOString() };
  if (feedback === 'notForMe') row.pausedUntil = pausedUntilFrom(day);
  await putInsightFeedback(db, row);
  return async () => {
    if (previous) await putInsightFeedback(db, previous);
    else await deleteInsightFeedback(db, ruleId);
  };
}

async function clearFeedbackIn(db: KiraMakanDb, ruleId: string): Promise<Undo> {
  const previous = await getInsightFeedback(db, ruleId);
  await deleteInsightFeedback(db, ruleId);
  return async () => {
    if (previous) await putInsightFeedback(db, previous);
  };
}

/** Records a pick shown, taken or ignored (plan §12 "Learning"). Returns the event id. */
async function recordSuggestionEventIn(
  db: KiraMakanDb,
  role: SuggestionRole,
  name: string,
  outcome: SuggestionEvent['outcome'] = 'shown',
): Promise<Id> {
  const event: SuggestionEvent = { id: newId(), at: clockNow().toISOString(), role, name, outcome };
  await addSuggestionEvent(db, event);
  return event.id;
}

export function createInsightsActions(db: KiraMakanDb) {
  return {
    recordFeedback: (ruleId: string, feedback: InsightAnswer, today?: LogicalDay) => recordFeedbackIn(db, ruleId, feedback, today),
    clearFeedback: (ruleId: string) => clearFeedbackIn(db, ruleId),
    recordSuggestionEvent: (role: SuggestionRole, name: string, outcome?: SuggestionEvent['outcome']) =>
      recordSuggestionEventIn(db, role, name, outcome),
    setSuggestionEventOutcome: (id: Id, outcome: SuggestionEvent['outcome']) => setSuggestionOutcome(db, id, outcome),
  };
}

export const { recordFeedback, clearFeedback, recordSuggestionEvent, setSuggestionEventOutcome } = createInsightsActions(appDb);
