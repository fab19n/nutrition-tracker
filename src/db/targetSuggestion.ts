/**
 * Read model, hook and actions for the target suggestion (S37, C45 and the Today notice, the
 * in-app form of S40). Reads go through the repositories and the shared selectors; the check
 * itself is `checkTarget` (src/domain/maintenance). Reading never writes: the target only
 * changes in the three actions below, each a tap by the user.
 *
 * Everything is stored in existing synced rows: an approval is a new goal version (from
 * tomorrow, with its pace), "Keep current" is the insightFeedback row 'targetSuggestion'. The
 * notice's "seen" key is per device (localStorage), like the Usual suggestions' "Not now".
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useSyncExternalStore } from 'react';
import type { Undo } from '@/db/actions';
import { db as appDb, newId, type KiraMakanDb } from '@/db/db';
import { useToday } from '@/db/hooks';
import {
  addGoalVersion,
  deleteInsightFeedback,
  getInsightFeedback,
  latestGoalVersion,
  listDayRecordsInRange,
  listGoalVersions,
  listMealsInRange,
  listWeights,
  listWorkoutsInRange,
  putInsightFeedback,
} from '@/db/repo';
import { getActiveGoal, getWeekBudget, loadSettings, todayFor, type ActiveGoal, type Settings } from '@/db/selectors';
import { proratedWeek, type ProratedWeek } from '@/domain/budget';
import { now } from '@/domain/clock';
import { addDays, compareDays } from '@/domain/day';
import { KEEP_CURRENT_DAYS, checkTarget, type KeptTarget, type MaintenanceDay, type TargetCheck } from '@/domain/maintenance';
import { mealMacros } from '@/domain/meal';
import { macrosForTarget, paceOf } from '@/domain/targets';
import { weightTrend } from '@/domain/trend';
import type { Goal, GoalVersion, Id, InsightFeedback, LogicalDay } from '@/domain/types';

/** The insightFeedback row that remembers "Keep current". */
export const TARGET_FEEDBACK_ID = 'targetSuggestion';
/** The weekly read can reach back 34 days (a Sunday's window starts 34 days before it). */
const LOOKBACK_DAYS = 35;

interface ReadOptions {
  /** The current logical day; the clock in the profile's zone by default. */
  today?: LogicalDay;
}

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

export interface TargetCheckState {
  settings: Settings;
  today: LogicalDay;
  check: TargetCheck;
  /** The goal in force today. */
  active?: ActiveGoal;
  /** The versions of that goal, oldest first (listGoalVersions order). */
  versions: GoalVersion[];
  /** Its newest version, a pending one included. */
  latest?: GoalVersion;
}

function keptFrom(row: InsightFeedback | undefined): KeptTarget | undefined {
  if (row?.feedback !== 'keepCurrent' || !row.keptTarget) return undefined;
  const { keptOn, maintenanceKcal, versionId } = row.keptTarget;
  return { keptOn, until: row.pausedUntil ?? addDays(keptOn, KEEP_CURRENT_DAYS), maintenanceKcal, versionId };
}

/** The check as of `today` (default: the clock in the profile's zone). Undefined without a profile. */
export async function getTargetCheck(db: KiraMakanDb, opts: ReadOptions = {}): Promise<TargetCheckState | undefined> {
  const settings = await loadSettings(db);
  const profile = settings.profile;
  if (!profile) return undefined;
  const today = opts.today ?? todayFor(profile);
  const from = addDays(today, -LOOKBACK_DAYS);
  const to = addDays(today, -1);
  const [active, tomorrow, meals, records, workouts, weights, feedback] = await Promise.all([
    getActiveGoal(db, today),
    getActiveGoal(db, addDays(today, 1)),
    listMealsInRange(db, from, to),
    listDayRecordsInRange(db, from, to),
    listWorkoutsInRange(db, from, to),
    listWeights(db),
    getInsightFeedback(db, TARGET_FEEDBACK_ID),
  ]);
  const versions = active ? await listGoalVersions(db, active.goal.id) : [];
  const latest = versions.at(-1);

  const eaten = new Map<LogicalDay, number>();
  for (const meal of meals) eaten.set(meal.logicalDay, (eaten.get(meal.logicalDay) ?? 0) + mealMacros(meal).kcal);
  const burned = new Map<LogicalDay, number>();
  for (const workout of workouts) burned.set(workout.logicalDay, (burned.get(workout.logicalDay) ?? 0) + workout.netKcal);
  const status = new Map(records.map((r) => [r.logicalDay, r.status]));
  const days: MaintenanceDay[] = [];
  for (let day = from; compareDays(day, to) <= 0; day = addDays(day, 1)) {
    days.push({
      day,
      eatenKcal: Math.round(eaten.get(day) ?? 0),
      workoutKcal: burned.get(day) ?? 0,
      // Days before the app was in use are no record, whatever is stored for them.
      status: compareDays(day, profile.startedOn) < 0 ? null : (status.get(day) ?? null),
    });
  }

  const kept = keptFrom(feedback);
  const check = checkTarget({
    today,
    days,
    trend: weightTrend(weights),
    ...(active ? { goal: active.goal } : {}),
    ...(latest ? { latest } : {}),
    switching: active !== undefined && tomorrow !== undefined && tomorrow.goal.id !== active.goal.id,
    dailyMinimumKcal: settings.dailyMinimumKcal,
    ...(kept ? { kept } : {}),
  });
  const state: TargetCheckState = { settings, today, check, versions };
  if (active) state.active = active;
  if (latest) state.latest = latest;
  return state;
}

// ---------------------------------------------------------------------------
// S37 view
// ---------------------------------------------------------------------------

export interface TargetHistoryRow {
  version: GoalVersion;
  state: 'pending' | 'current' | 'past';
  /** Last day it applied (past rows). */
  until?: LogicalDay;
  /** paceOf(goal, version). */
  paceKgPerWeek: number;
}

export interface TargetView {
  today: LogicalDay;
  tz: string;
  rolloverHour: number;
  dailyMinimumKcal: number;
  check: TargetCheck;
  goal?: Goal;
  /** Version in force today. */
  current?: GoalVersion;
  /** The goal's newest version when it starts after today. */
  pending?: GoalVersion;
  /** Newest first, one row per effectiveFrom (the last created wins, as in the budget). */
  history: TargetHistoryRow[];
  /** This week with each option from tomorrow, and with the pending target. */
  week?: { suggested?: ProratedWeek; slowerPace?: ProratedWeek; pending?: ProratedWeek };
}

/** One row per effectiveFrom, newest first, with which one is in force today (S37, and S42's target history). */
export function targetHistoryOf(goal: Goal, versions: readonly GoalVersion[], today: LogicalDay): TargetHistoryRow[] {
  // Sorted by effectiveFrom then createdAt: the last of each day is the one the budget uses.
  const byDay = new Map<LogicalDay, GoalVersion>();
  for (const version of versions) byDay.set(version.effectiveFrom, version);
  const chronological = [...byDay.values()];
  const currentIndex = chronological.findLastIndex((v) => compareDays(v.effectiveFrom, today) <= 0);
  const rows = chronological.map((version, i): TargetHistoryRow => {
    const state = i > currentIndex ? 'pending' : i === currentIndex ? 'current' : 'past';
    const row: TargetHistoryRow = { version, state, paceKgPerWeek: paceOf(goal, version) };
    const next = chronological[i + 1];
    if (state === 'past' && next) row.until = addDays(next.effectiveFrom, -1);
    return row;
  });
  return rows.reverse();
}

export async function getTargetView(db: KiraMakanDb, opts: ReadOptions = {}): Promise<TargetView | undefined> {
  const state = await getTargetCheck(db, opts);
  if (!state) return undefined;
  const { settings, today, check, active, versions, latest } = state;
  const view: TargetView = {
    today,
    tz: settings.tz,
    rolloverHour: settings.rolloverHour,
    dailyMinimumKcal: settings.dailyMinimumKcal,
    check,
    history: active ? targetHistoryOf(active.goal, versions, today) : [],
  };
  if (active) {
    view.goal = active.goal;
    view.current = active.version;
  }
  if (latest && compareDays(latest.effectiveFrom, today) > 0) view.pending = latest;

  const proposal = check.kind === 'suggestion' || check.kind === 'kept' ? check.proposal : undefined;
  if (proposal || view.pending) {
    const budget = await getWeekBudget(db, today, { today });
    if (budget) {
      const week: NonNullable<TargetView['week']> = {};
      if (proposal) {
        week.suggested = proratedWeek(budget.days, today, proposal.suggested.dailyKcal);
        if (proposal.slowerPace) week.slowerPace = proratedWeek(budget.days, today, proposal.slowerPace.dailyKcal);
      }
      if (view.pending) week.pending = proratedWeek(budget.days, today, view.pending.dailyKcal);
      view.week = week;
    }
  }
  return view;
}

/** S37, Insights and Today: re-read when the data changes or the day rolls over. */
export function useTargetView(): TargetView | undefined {
  const today = useToday();
  return useLiveQuery(() => getTargetView(appDb, { today }), [today]);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** What the user saw is no longer what the check says (a new version, a new estimate, a new minimum). */
export class TargetChangedError extends Error {
  constructor(message = 'The target suggestion changed') {
    super(message);
    this.name = 'TargetChangedError';
  }
}

export type TargetOption = 'suggested' | 'slowerPace';

/** What the user saw and tapped, for the stale check. */
export interface TargetChoice {
  versionId: Id;
  option: TargetOption;
  dailyKcal: number;
}

async function todayIn(db: KiraMakanDb, opts: ReadOptions): Promise<LogicalDay> {
  return opts.today ?? todayFor((await loadSettings(db)).profile);
}

/**
 * Every approved suggestion of the goal that starts on `effectiveFrom`. Two devices that both
 * approved offline leave one each (spec D22), so withdrawing only one would make the other the
 * target instead of keeping the current one.
 */
async function approvalsOn(db: KiraMakanDb, goalId: Id, effectiveFrom: LogicalDay): Promise<GoalVersion[]> {
  return (await listGoalVersions(db, goalId)).filter((v) => v.reason === 'approvedSuggestion' && v.effectiveFrom === effectiveFrom);
}

/**
 * Approve (or Change pace instead): a new version of the goal from tomorrow, so today and
 * earlier days keep their target and the week is prorated. Protein stays; fat and carbs follow.
 * The undo removes the version again while it hasn't started, and puts back a "Keep current".
 */
async function approveTargetIn(db: KiraMakanDb, choice: TargetChoice, opts: ReadOptions = {}): Promise<{ version: GoalVersion; undo: Undo }> {
  const view = await getTargetView(db, opts);
  const check = view?.check;
  if (!view || !check || (check.kind !== 'suggestion' && check.kind !== 'kept')) throw new TargetChangedError();
  const values = choice.option === 'slowerPace' ? check.proposal.slowerPace : check.proposal.suggested;
  if (check.current.versionId !== choice.versionId || !values || values.dailyKcal !== choice.dailyKcal) throw new TargetChangedError();
  const { goalId } = check.current;
  const effectiveFrom = addDays(view.today, 1);

  return db.transaction('rw', [db.goalVersions, db.insightFeedback], async () => {
    const newest = await latestGoalVersion(db, goalId);
    if (!newest || newest.id !== choice.versionId) throw new TargetChangedError();
    const version: GoalVersion = {
      id: newId(),
      goalId,
      effectiveFrom,
      dailyKcal: values.dailyKcal,
      ...macrosForTarget(values.dailyKcal, newest.proteinG),
      maintenanceKcal: check.proposal.newMaintenanceKcal,
      paceKgPerWeek: values.paceKgPerWeek,
      reason: 'approvedSuggestion',
      createdAt: now().toISOString(),
    };
    const kept = await getInsightFeedback(db, TARGET_FEEDBACK_ID);
    await addGoalVersion(db, version);
    // A key delete (never clear()), so it reaches the other device too.
    if (kept) await deleteInsightFeedback(db, TARGET_FEEDBACK_ID);
    const undo: Undo = async () => {
      const today = await todayIn(db, opts);
      await db.transaction('rw', [db.goalVersions, db.insightFeedback], async () => {
        // Once its day has started it is today's target: past and present stay as they are.
        // Key deletes (never clear()), with another device's approval for that day if one came in.
        if (compareDays(version.effectiveFrom, today) > 0) {
          const approvals = await approvalsOn(db, goalId, version.effectiveFrom);
          await db.goalVersions.bulkDelete(approvals.map((v) => v.id));
        }
        if (kept) await putInsightFeedback(db, kept);
      });
    };
    return { version, undo };
  });
}

/** Keep current: hides the suggestion for 4 weeks, or until the estimate or the target moves. */
async function keepCurrentTargetIn(db: KiraMakanDb, input: { versionId: Id }, opts: ReadOptions = {}): Promise<Undo> {
  const view = await getTargetView(db, opts);
  const check = view?.check;
  if (!view || check?.kind !== 'suggestion' || check.current.versionId !== input.versionId) throw new TargetChangedError();

  return db.transaction('rw', [db.goalVersions, db.insightFeedback], async () => {
    const newest = await latestGoalVersion(db, check.current.goalId);
    if (!newest || newest.id !== input.versionId) throw new TargetChangedError();
    const previous = await getInsightFeedback(db, TARGET_FEEDBACK_ID);
    const row: InsightFeedback = {
      ruleId: TARGET_FEEDBACK_ID,
      feedback: 'keepCurrent',
      at: now().toISOString(),
      pausedUntil: addDays(view.today, KEEP_CURRENT_DAYS),
      keptTarget: { keptOn: view.today, maintenanceKcal: check.estimate.maintenanceKcal, versionId: check.current.versionId },
    };
    await putInsightFeedback(db, row);
    return async () => {
      if (previous) await putInsightFeedback(db, previous);
      else await deleteInsightFeedback(db, TARGET_FEEDBACK_ID);
    };
  });
}

/**
 * "Keep 1,800 instead" on S37: withdraws an approval that hasn't started yet, with every other
 * approval for the same day (two devices, D22), so the target really stays.
 */
async function cancelPendingTargetIn(db: KiraMakanDb, versionId: Id, opts: ReadOptions = {}): Promise<Undo> {
  const today = await todayIn(db, opts);
  return db.transaction('rw', [db.goalVersions, db.insightFeedback], async () => {
    const version = await db.goalVersions.get(versionId);
    if (!version || version.reason !== 'approvedSuggestion' || compareDays(version.effectiveFrom, today) <= 0) throw new TargetChangedError();
    const withdrawn = await approvalsOn(db, version.goalId, version.effectiveFrom);
    // Key deletes, never clear(), so they reach the other device too.
    await db.goalVersions.bulkDelete(withdrawn.map((v) => v.id));
    return async () => {
      // Too late once their day has started: putting them back then would change today's target.
      if (compareDays(version.effectiveFrom, await todayIn(db, opts)) > 0) await db.goalVersions.bulkPut(withdrawn);
    };
  });
}

export function createTargetActions(db: KiraMakanDb) {
  return {
    approveTarget: (choice: TargetChoice, opts?: ReadOptions) => approveTargetIn(db, choice, opts),
    keepCurrentTarget: (input: { versionId: Id }, opts?: ReadOptions) => keepCurrentTargetIn(db, input, opts),
    cancelPendingTarget: (versionId: Id, opts?: ReadOptions) => cancelPendingTargetIn(db, versionId, opts),
  };
}

export const { approveTarget, keepCurrentTarget, cancelPendingTarget } = createTargetActions(appDb);

// ---------------------------------------------------------------------------
// The Today notice: seen once per key, per device (localStorage, with an in-memory fallback)
// ---------------------------------------------------------------------------

const NOTICE_SEEN_KEY = 'kira-makan:target-notice-seen';

let noticeCache: { key: string | null } | null = null;
const noticeListeners = new Set<() => void>();

function loadNoticeSeen(): string | null {
  try {
    return window.localStorage.getItem(NOTICE_SEEN_KEY);
  } catch {
    return null;
  }
}

function writeNoticeSeen(key: string | null): void {
  noticeCache = { key };
  try {
    if (key === null) window.localStorage.removeItem(NOTICE_SEEN_KEY);
    else window.localStorage.setItem(NOTICE_SEEN_KEY, key);
  } catch {
    // Private mode or storage blocked: remembered for this session only.
  }
  for (const listener of noticeListeners) listener();
}

/** The last notice key seen on this device. */
export function readTargetNoticeSeen(): string | null {
  noticeCache ??= { key: loadNoticeSeen() };
  return noticeCache.key;
}

/** The notice for `key` has been seen (tapped, S37 opened, or a decision made). */
export function markTargetNoticeSeen(key: string): void {
  if (readTargetNoticeSeen() === key) return;
  writeNoticeSeen(key);
}

/** Forgets the seen key (tests, a fresh start), like clearDismissedSuggestions in usuals.ts. */
export function clearTargetNoticeSeen(): void {
  writeNoticeSeen(null);
}

function subscribeNoticeSeen(listener: () => void): () => void {
  noticeListeners.add(listener);
  return () => {
    noticeListeners.delete(listener);
  };
}

export function useTargetNoticeSeen(): string | null {
  return useSyncExternalStore(subscribeNoticeSeen, readTargetNoticeSeen, readTargetNoticeSeen);
}
