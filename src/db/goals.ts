/**
 * Read models, hooks and actions for goals: S41 Goals library, S42 Goal detail, S43 New goal,
 * S44 Switch, the S48 goal card and the Today goal-end notice. Reads go through the
 * repositories and the shared selectors and never write; the goal tables only change in the
 * actions below, each a tap by the user, each one transaction that returns an undo.
 *
 * Everything is stored in the synced goal tables: a switch is goal periods (from tomorrow,
 * never the past) plus goal statuses, an edit is the goal row and, for targets, a goal version.
 * Which goal applies on a day always comes from the periods. `Goal.status` is library
 * bookkeeping: every action leaves the goal of the latest open-ended period 'active' and turns
 * any other 'active' row into 'saved', and the screens never trust it for "in force" (two
 * offline devices can leave two 'active' rows). The goal-end notice's "seen" key is per device
 * (localStorage), like the target notice.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useSyncExternalStore } from 'react';
import type { Undo } from '@/db/actions';
import { db as appDb, newId, type KiraMakanDb } from '@/db/db';
import { useToday } from '@/db/hooks';
import { deleteGoal, listGoalPeriods, listGoals, listGoalVersions } from '@/db/repo';
import { GOAL_PRESET_ORDER, presetFor, type BuiltInTemplate } from '@/db/seed/defaults';
import {
  getWeekBudget,
  getWeightTrend,
  goalTimelineOf,
  loadSettings,
  todayFor,
  type ActiveGoal,
  type GoalTimeline,
  type Settings,
} from '@/db/selectors';
import { targetHistoryOf, type TargetHistoryRow } from '@/db/targetSuggestion';
import type { BudgetDayInput } from '@/domain/budget';
import { now } from '@/domain/clock';
import { addDays, compareDays, weekDays, weekStartOf } from '@/domain/day';
import {
  GoalChangedError,
  GoalDraftError,
  activeGoalIdAfter,
  comparePeriods,
  endConditionState,
  endKey,
  everInForce,
  goalWeek,
  inUseAfter,
  periodOn,
  planCancelSwitch,
  planGoalSwitch,
  sameEndCondition,
  validateGoalDraft,
  type EndState,
  type GoalDraft,
  type PeriodPlan,
} from '@/domain/goals';
import { macrosForTarget, paceOf, startingMaintenance } from '@/domain/targets';
import type { Goal, GoalPeriod, GoalVersion, Id, LogicalDay, Profile } from '@/domain/types';

export interface GoalReadOptions {
  /** The current logical day; the clock in the profile's zone by default. */
  today?: LogicalDay;
}

// ---------------------------------------------------------------------------
// Reading the goal tables once
// ---------------------------------------------------------------------------

interface GoalWorld {
  settings: Settings;
  profile: Profile;
  today: LogicalDay;
  tomorrow: LogicalDay;
  /** createdAt order (listGoals). */
  goals: Goal[];
  /** comparePeriods order. */
  periods: GoalPeriod[];
  /** Per goal, oldest first (effectiveFrom, then createdAt), as listGoalVersions sorts them. */
  versionsByGoal: Map<Id, GoalVersion[]>;
  timeline: GoalTimeline;
  /** In force today. */
  current?: ActiveGoal;
  trendKg?: number;
  /** The newest weigh-in. */
  latestKg?: number;
}

function byVersionOrder(a: GoalVersion, b: GoalVersion): number {
  return compareDays(a.effectiveFrom, b.effectiveFrom) || a.createdAt.localeCompare(b.createdAt);
}

async function loadWorld(db: KiraMakanDb, opts: GoalReadOptions): Promise<GoalWorld | undefined> {
  const settings = await loadSettings(db);
  const profile = settings.profile;
  if (!profile) return undefined;
  const today = opts.today ?? todayFor(profile);
  const [goals, periods, versions, trend] = await Promise.all([
    listGoals(db),
    listGoalPeriods(db),
    db.goalVersions.toArray(),
    getWeightTrend(db, { today }),
  ]);
  const versionsByGoal = new Map<Id, GoalVersion[]>();
  for (const version of [...versions].sort(byVersionOrder)) {
    const list = versionsByGoal.get(version.goalId) ?? [];
    list.push(version);
    versionsByGoal.set(version.goalId, list);
  }
  const timeline = goalTimelineOf(goals, periods, versions);
  const world: GoalWorld = { settings, profile, today, tomorrow: addDays(today, 1), goals, periods, versionsByGoal, timeline };
  const current = timeline(today);
  if (current) world.current = current;
  if (trend.latest) world.trendKg = trend.latest.trendKg;
  const latest = trend.entries[0];
  if (latest) world.latestKg = latest.kg;
  return world;
}

function newestVersion(world: GoalWorld, goalId: Id): GoalVersion | undefined {
  return world.versionsByGoal.get(goalId)?.at(-1);
}

/** The goal's version on `day`: the latest that started by then, else its first. */
function versionOn(world: GoalWorld, goalId: Id, day: LogicalDay): GoalVersion | undefined {
  const versions = world.versionsByGoal.get(goalId) ?? [];
  return versions.filter((v) => compareDays(v.effectiveFrom, day) <= 0).at(-1) ?? versions[0];
}

/**
 * New-goal maintenance (spec D10): the newest version (pending included) of the goal in force
 * today, or the version a Pause carries, else the setup estimate. Never an unapproved estimate.
 */
function defaultMaintenance(world: GoalWorld): number {
  const { current, profile } = world;
  if (current) {
    if (current.paused) return current.version.maintenanceKcal;
    return (newestVersion(world, current.goal.id) ?? current.version).maintenanceKcal;
  }
  return startingMaintenance({
    sex: profile.sex,
    weightKg: profile.weightKgAtSetup,
    heightCm: profile.heightCm,
    age: profile.age,
    activity: profile.activity,
  });
}

interface NextGoal {
  goal: Goal;
  startsOn: LogicalDay;
  /** It starts tomorrow, so "Keep … instead" can still cancel it. */
  cancellable: boolean;
}

/** The next different goal: in force tomorrow, or the first later period's (a pause's resume). */
function nextGoalOf(world: GoalWorld): NextGoal | undefined {
  const currentId = world.current?.goal.id;
  const starts = [...new Set(world.periods.map((p) => p.from).filter((from) => compareDays(from, world.today) > 0))];
  const days = [world.tomorrow, ...starts.filter((d) => d !== world.tomorrow)].sort(compareDays);
  for (const day of days) {
    const active = world.timeline(day);
    if (active && active.goal.id !== currentId) return { goal: active.goal, startsOn: day, cancellable: day === world.tomorrow };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// S41 Goals library
// ---------------------------------------------------------------------------

export interface LibraryEntry {
  goal: Goal;
  /** Today's version for the goal in force; else the newest (pending included). Undefined for Pause. */
  version?: GoalVersion;
  /** The goal in force only: its newest version when it starts after today. */
  pending?: GoalVersion;
}

export type ReachedEnd = Exclude<EndState, { kind: 'none' }> & { reached: true };

export interface GoalEndView {
  goal: Goal;
  /** A date or weight end that has been reached. */
  state: ReachedEnd;
  /** endKey(): what the "seen" store remembers. */
  key: string;
  /** What to switch to: the first saved Festive goal, else the template. Undefined when the current goal is Festive. */
  maintain?: { kind: 'goal'; goal: Goal } | { kind: 'template' };
}

export interface GoalLibrary {
  today: LogicalDay;
  tz: string;
  rolloverHour: number;
  dailyMinimumKcal: number;
  current?: LibraryEntry & { period: GoalPeriod; week: number; paused: boolean };
  /** The next different goal: in force tomorrow, or the first later period's goal (a pause's resume). */
  next?: LibraryEntry & { startsOn: LogicalDay; cancellable: boolean };
  /** Saved, draft (and stale 'active') goals that are neither current nor next, in createdAt order. */
  saved: LibraryEntry[];
  /** Built-in templates with no goal of their own in use or saved, in GOAL_PRESET_ORDER. */
  templates: BuiltInTemplate[];
  ended: (LibraryEntry & { lastUsed?: { from: LogicalDay; to: LogicalDay } })[];
  /** The current goal's end condition when reached, current not Pause, and nothing booked. */
  end?: GoalEndView;
}

function entryOf(world: GoalWorld, goal: Goal): LibraryEntry {
  const entry: LibraryEntry = { goal };
  const version = goal.template === 'pause' ? undefined : newestVersion(world, goal.id);
  if (version) entry.version = version;
  return entry;
}

function endViewOf(world: GoalWorld, next: NextGoal | undefined, saved: readonly Goal[]): GoalEndView | undefined {
  const { current } = world;
  if (!current || current.paused || next) return undefined;
  const state = endConditionState(current.goal.endCondition, {
    today: world.today,
    paceKgPerWeek: paceOf(current.goal, current.version),
    ...(world.trendKg !== undefined ? { trendKg: world.trendKg } : {}),
  });
  if (state.kind === 'none' || !state.reached) return undefined;
  const key = endKey(current.goal.id, state);
  if (!key) return undefined;
  const view: GoalEndView = { goal: current.goal, state: { ...state, reached: true }, key };
  if (current.goal.template !== 'festive') {
    const festive = saved.find((g) => g.template === 'festive');
    view.maintain = festive ? { kind: 'goal', goal: festive } : { kind: 'template' };
  }
  return view;
}

function libraryOf(world: GoalWorld): GoalLibrary {
  const { current, today } = world;
  const next = nextGoalOf(world);
  const inUse = new Set([current?.goal.id, next?.goal.id].filter((id): id is Id => id !== undefined));
  const savedGoals = world.goals.filter(
    (g) => !inUse.has(g.id) && (g.status === 'saved' || g.status === 'draft' || g.status === 'active'),
  );

  const library: GoalLibrary = {
    today,
    tz: world.settings.tz,
    rolloverHour: world.settings.rolloverHour,
    dailyMinimumKcal: world.settings.dailyMinimumKcal,
    saved: savedGoals.map((g) => entryOf(world, g)),
    templates: [],
    ended: [],
  };

  if (current) {
    const entry: GoalLibrary['current'] = { goal: current.goal, period: current.period, week: goalWeek(current.period, today), paused: current.paused };
    if (!current.paused) {
      entry.version = current.version;
      const newest = newestVersion(world, current.goal.id);
      if (newest && compareDays(newest.effectiveFrom, today) > 0) entry.pending = newest;
    }
    library.current = entry;
  }
  if (next) library.next = { ...entryOf(world, next.goal), startsOn: next.startsOn, cancellable: next.cancellable };

  for (const goal of world.goals) {
    if (goal.status !== 'ended' || inUse.has(goal.id)) continue;
    const entry: GoalLibrary['ended'][number] = entryOf(world, goal);
    const used = world.periods.filter((p) => p.goalId === goal.id && p.to !== undefined && compareDays(p.to, today) <= 0).at(-1);
    if (used?.to) entry.lastUsed = { from: used.from, to: used.to };
    library.ended.push(entry);
  }

  // A template's card shows only while no goal of it is running, booked or kept (spec D7).
  const taken = new Set(
    world.goals
      .filter((g) => inUse.has(g.id) || g.status === 'active' || g.status === 'saved' || g.status === 'draft' || inUseAfter(world.periods, g.id, today))
      .map((g) => g.template),
  );
  library.templates = GOAL_PRESET_ORDER.filter((t) => !taken.has(t));

  const end = endViewOf(world, next, savedGoals);
  if (end) library.end = end;
  return library;
}

export async function getGoalLibraryIn(db: KiraMakanDb, opts: GoalReadOptions = {}): Promise<GoalLibrary | undefined> {
  const world = await loadWorld(db, opts);
  return world ? libraryOf(world) : undefined;
}

/** S41, S48 and Today: re-read when the data changes or the day rolls over. */
export function useGoalLibrary(): GoalLibrary | undefined {
  const today = useToday();
  return useLiveQuery(() => getGoalLibraryIn(appDb, { today }), [today]);
}

/** The current goal's reached end, for the Today notice (undefined when paused, booked or not reached). */
export async function getGoalEndCheckIn(db: KiraMakanDb, opts: GoalReadOptions = {}): Promise<GoalEndView | undefined> {
  return (await getGoalLibraryIn(db, opts))?.end;
}

export function useGoalEnd(): GoalEndView | undefined {
  const today = useToday();
  return useLiveQuery(() => getGoalEndCheckIn(appDb, { today }), [today]);
}

// ---------------------------------------------------------------------------
// S42 Goal detail
// ---------------------------------------------------------------------------

export interface GoalDetail {
  today: LogicalDay;
  tz: string;
  rolloverHour: number;
  dailyMinimumKcal: number;
  goal: Goal;
  role: 'current' | 'next' | 'saved' | 'ended' | 'template';
  /** Oldest first (listGoalVersions order). */
  versions: GoalVersion[];
  /** Today's when current, else the newest. */
  version?: GoalVersion;
  /** The newest version when it starts after today. */
  pending?: GoalVersion;
  /** This goal's periods, comparePeriods order. */
  periods: GoalPeriod[];
  everUsed: boolean;
  /** The goal in force today (any goal). */
  current?: ActiveGoal;
  /** A booked different goal (for "Keep Cut instead" on the current goal). */
  next?: { goal: Goal; startsOn: LogicalDay; cancellable: boolean };
  /** Role 'next': when it starts; `resumes` = it starts again after a dated pause. */
  startsOn?: LogicalDay;
  resumes?: boolean;
  /** The newest version's, else the new-goal default (spec D10). */
  maintenanceKcal: number;
  trendKg?: number;
  end: EndState;
  /** Reached end on the current goal: the maintain suggestion (as in GoalEndView). */
  maintain?: GoalEndView['maintain'];
  /** targetHistoryOf(goal, versions, today) once the goal has been used, else []. */
  history: TargetHistoryRow[];
}

function roleOf(goal: Goal, world: GoalWorld, next: NextGoal | undefined): GoalDetail['role'] {
  if (world.current?.goal.id === goal.id) return 'current';
  if (next?.goal.id === goal.id) return 'next';
  if (goal.status === 'ended') return 'ended';
  if (goal.status === 'template') return 'template';
  return 'saved';
}

function detailOf(world: GoalWorld, goal: Goal): GoalDetail {
  const { today, current } = world;
  const next = nextGoalOf(world);
  const role = roleOf(goal, world, next);
  const versions = world.versionsByGoal.get(goal.id) ?? [];
  const newest = versions.at(-1);
  const version = role === 'current' && current && !current.paused ? current.version : newest;
  const periods = world.periods.filter((p) => p.goalId === goal.id);
  const everUsed = everInForce(world.periods, goal.id, today);

  const detail: GoalDetail = {
    today,
    tz: world.settings.tz,
    rolloverHour: world.settings.rolloverHour,
    dailyMinimumKcal: world.settings.dailyMinimumKcal,
    goal,
    role,
    versions,
    periods,
    everUsed,
    maintenanceKcal: newest?.maintenanceKcal ?? defaultMaintenance(world),
    end: endConditionState(goal.endCondition, {
      today,
      paceKgPerWeek: paceOf(goal, version),
      ...(world.trendKg !== undefined ? { trendKg: world.trendKg } : {}),
    }),
    history: everUsed ? targetHistoryOf(goal, versions, today) : [],
  };
  if (version && goal.template !== 'pause') detail.version = version;
  if (newest && compareDays(newest.effectiveFrom, today) > 0) detail.pending = newest;
  if (current) detail.current = current;
  if (next) detail.next = next;
  if (role === 'next' && next) {
    detail.startsOn = next.startsOn;
    detail.resumes = current?.paused === true && current.period.to === next.startsOn;
  }
  if (world.trendKg !== undefined) detail.trendKg = world.trendKg;
  if (role === 'current') {
    const savedGoals = world.goals.filter((g) => g.id !== goal.id && g.id !== next?.goal.id && (g.status === 'saved' || g.status === 'draft' || g.status === 'active'));
    const end = endViewOf(world, next, savedGoals);
    if (end?.maintain) detail.maintain = end.maintain;
  }
  return detail;
}

/** Undefined without a profile; `{ detail: null }` when the goal isn't there. */
export async function getGoalDetailIn(db: KiraMakanDb, id: Id, opts: GoalReadOptions = {}): Promise<{ detail: GoalDetail | null } | undefined> {
  const world = await loadWorld(db, opts);
  if (!world) return undefined;
  const goal = world.goals.find((g) => g.id === id);
  return { detail: goal ? detailOf(world, goal) : null };
}

export function useGoalDetail(id: Id | undefined): { detail: GoalDetail | null } | undefined {
  const today = useToday();
  return useLiveQuery(async () => (id ? getGoalDetailIn(appDb, id, { today }) : { detail: null }), [id, today]);
}

// ---------------------------------------------------------------------------
// S43 New goal
// ---------------------------------------------------------------------------

export interface NewGoalDefaults {
  today: LogicalDay;
  dailyMinimumKcal: number;
  maintenanceKcal: number;
  weightKg: number;
  trendKg?: number;
  /** Names of non-ended, non-template goals (uniqueGoalName). */
  takenNames: string[];
}

function defaultsOf(world: GoalWorld): NewGoalDefaults {
  const defaults: NewGoalDefaults = {
    today: world.today,
    dailyMinimumKcal: world.settings.dailyMinimumKcal,
    maintenanceKcal: defaultMaintenance(world),
    weightKg: world.trendKg ?? world.latestKg ?? world.profile.weightKgAtSetup,
    takenNames: world.goals.filter((g) => g.status !== 'ended' && g.status !== 'template').map((g) => g.name),
  };
  if (world.trendKg !== undefined) defaults.trendKg = world.trendKg;
  return defaults;
}

export async function getNewGoalDefaultsIn(db: KiraMakanDb, opts: GoalReadOptions = {}): Promise<NewGoalDefaults | undefined> {
  const world = await loadWorld(db, opts);
  return world ? defaultsOf(world) : undefined;
}

export function useNewGoalDefaults(): NewGoalDefaults | undefined {
  const today = useToday();
  return useLiveQuery(() => getNewGoalDefaultsIn(appDb, { today }), [today]);
}

// ---------------------------------------------------------------------------
// S44 Switch preview
// ---------------------------------------------------------------------------

export interface SwitchPreview {
  today: LogicalDay;
  tz: string;
  rolloverHour: number;
  startsOn: LogicalDay;
  goal: Goal;
  /** The target's version on startsOn; undefined for Pause. */
  version?: GoalVersion;
  /** In force today. */
  from?: ActiveGoal;
  /** A booking this switch replaces. */
  replaces?: { goal: Goal; startsOn: LogicalDay };
  /** This week as budgeted now (getWeekBudget(today).days). */
  days: BudgetDayInput[];
  /** Each day after today in this week: the target's and today's goal's daily target that day (null for Pause). */
  ahead: { day: LogicalDay; targetKcal: number | null; fromKcal: number | null }[];
  canSwitch: boolean;
  reason?: 'current' | 'ended' | 'template' | 'noTarget';
}

function dailyKcalOn(world: GoalWorld, goal: Goal | undefined, day: LogicalDay): number | null {
  if (!goal || goal.template === 'pause') return null;
  return versionOn(world, goal.id, day)?.dailyKcal ?? null;
}

/** Undefined without a profile, or when the goal isn't there (S42 shows its missing state then). */
export async function getSwitchPreviewIn(db: KiraMakanDb, goalId: Id, opts: GoalReadOptions = {}): Promise<SwitchPreview | undefined> {
  const world = await loadWorld(db, opts);
  const goal = world?.goals.find((g) => g.id === goalId);
  if (!world || !goal) return undefined;
  const { today, tomorrow, current } = world;
  const budget = await getWeekBudget(db, today, { today });
  const next = nextGoalOf(world);
  const hasVersions = (world.versionsByGoal.get(goal.id)?.length ?? 0) > 0;

  let reason: SwitchPreview['reason'];
  if (goal.status === 'ended') reason = 'ended';
  else if (goal.status === 'template') reason = 'template';
  else if (goal.template !== 'pause' && !hasVersions) reason = 'noTarget';
  else if (current?.goal.id === goal.id && !next) reason = 'current';

  const ahead = weekDays(weekStartOf(today))
    .filter((day) => compareDays(day, today) > 0)
    .map((day) => ({ day, targetKcal: dailyKcalOn(world, goal, day), fromKcal: current?.paused ? null : dailyKcalOn(world, current?.goal, day) }));

  const preview: SwitchPreview = {
    today,
    tz: world.settings.tz,
    rolloverHour: world.settings.rolloverHour,
    startsOn: tomorrow,
    goal,
    days: budget?.days ?? [],
    ahead,
    canSwitch: reason === undefined,
  };
  const version = goal.template === 'pause' ? undefined : versionOn(world, goal.id, tomorrow);
  if (version) preview.version = version;
  if (current) preview.from = current;
  if (next && next.goal.id !== goal.id) preview.replaces = { goal: next.goal, startsOn: next.startsOn };
  if (reason) preview.reason = reason;
  return preview;
}

/** Only while S44 is open (undefined goal id: nothing to read). */
export function useSwitchPreview(goalId: Id | undefined): SwitchPreview | undefined {
  const today = useToday();
  return useLiveQuery(async () => (goalId ? getSwitchPreviewIn(appDb, goalId, { today }) : undefined), [goalId, today]);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** Drops keys whose value is undefined, so a whole-row put clears an optional field. */
function withoutUndefined<T extends object>(row: T): T {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined)) as T;
}

async function todayIn(db: KiraMakanDb, opts: GoalReadOptions): Promise<LogicalDay> {
  return opts.today ?? todayFor((await loadSettings(db)).profile);
}

async function settingsFor(db: KiraMakanDb, opts: GoalReadOptions): Promise<{ settings: Settings; profile: Profile; today: LogicalDay }> {
  const settings = await loadSettings(db);
  const profile = settings.profile;
  if (!profile) throw new GoalChangedError('No profile');
  return { settings, profile, today: opts.today ?? todayFor(profile) };
}

async function trendKgIn(db: KiraMakanDb, today: LogicalDay): Promise<number | undefined> {
  return (await getWeightTrend(db, { today })).latest?.trendKg;
}

/**
 * The status invariant (spec D3): the goal of the latest open-ended period is 'active', any
 * other 'active' goal becomes 'saved'. Returns the rows it changed, as they were.
 */
async function settleStatuses(db: KiraMakanDb, goals: readonly Goal[], periods: readonly GoalPeriod[]): Promise<Goal[]> {
  const activeId = activeGoalIdAfter(periods);
  const before: Goal[] = [];
  for (const goal of goals) {
    const status = goal.id === activeId ? 'active' : goal.status === 'active' ? 'saved' : goal.status;
    if (status === goal.status) continue;
    before.push(goal);
    await db.goals.put({ ...goal, status });
  }
  return before;
}

/** Puts back the statuses `before` held, on the rows as they are now (a rename since stays). */
async function restoreStatuses(db: KiraMakanDb, before: readonly Goal[]): Promise<void> {
  for (const goal of before) {
    const row = await db.goals.get(goal.id);
    if (row && row.status !== goal.status) await db.goals.put({ ...row, status: goal.status });
  }
}

/** Writes a period plan and the statuses that follow; the undo puts it all back while `startsOn` hasn't started. */
async function applyPeriodPlan(db: KiraMakanDb, plan: PeriodPlan, goals: readonly Goal[], periods: readonly GoalPeriod[], opts: GoalReadOptions): Promise<Undo> {
  const putIds = new Set(plan.put.map((p) => p.id));
  const removeIds = new Set(plan.remove);
  const removed = periods.filter((p) => removeIds.has(p.id));
  const changed = periods.filter((p) => putIds.has(p.id));
  // Key deletes and whole rows (never clear()), so every change reaches the other device.
  await db.goalPeriods.bulkDelete(plan.remove);
  await db.goalPeriods.bulkPut(plan.put);
  const after = [...periods.filter((p) => !removeIds.has(p.id) && !putIds.has(p.id)), ...plan.put].sort(comparePeriods);
  const statuses = await settleStatuses(db, goals, after);

  return async () => {
    // Once tomorrow has started the change already applied: the past stays as it is.
    if (compareDays(await todayIn(db, opts), plan.startsOn) >= 0) return;
    await db.transaction('rw', [db.goals, db.goalPeriods], async () => {
      await db.goalPeriods.bulkDelete(plan.added);
      await db.goalPeriods.bulkPut([...removed, ...changed]);
      await restoreStatuses(db, statuses);
    });
  };
}

async function readGoalRows(db: KiraMakanDb): Promise<{ goals: Goal[]; periods: GoalPeriod[] }> {
  const [goals, periods] = await Promise.all([listGoals(db), listGoalPeriods(db)]);
  return { goals, periods };
}

async function cancelIn(db: KiraMakanDb, opts: GoalReadOptions, today: LogicalDay): Promise<{ startsOn: LogicalDay; undo: Undo }> {
  const { goals, periods } = await readGoalRows(db);
  const plan = planCancelSwitch(periods, today);
  if (!plan) throw new GoalChangedError('Nothing is booked');
  const undo = await applyPeriodPlan(db, plan, goals, periods, opts);
  return { startsOn: plan.startsOn, undo };
}

/**
 * The goal a dated pause gives back: today's goal, or, when today is itself a Pause (it has no
 * targets), the budget goal that Pause carries, so a Pause after a Pause resumes Cut, not Pause.
 */
async function resumeGoalIdIn(
  db: KiraMakanDb,
  goals: readonly Goal[],
  periods: readonly GoalPeriod[],
  inForce: GoalPeriod,
  today: LogicalDay,
): Promise<Id | undefined> {
  const inForceGoal = goals.find((g) => g.id === inForce.goalId);
  if (inForceGoal?.template !== 'pause') return inForce.goalId;
  const carried = goalTimelineOf(goals, periods, await db.goalVersions.toArray())(today);
  return carried?.version.goalId;
}

/**
 * S44 confirm: `goalId` from tomorrow (spec §1.2). Pause can take `until` (a dated pause that
 * gives back today's goal that day). Switching to the goal in force while a switch is booked
 * cancels the booking. Never touches a meal, a version or a past period.
 */
async function switchGoalIn(
  db: KiraMakanDb,
  goalId: Id,
  opts: GoalReadOptions & { until?: LogicalDay } = {},
): Promise<{ startsOn: LogicalDay; cancelled: boolean; undo: Undo }> {
  const { today } = await settingsFor(db, opts);
  return db.transaction('rw', [db.goals, db.goalPeriods, db.goalVersions], async () => {
    const { goals, periods } = await readGoalRows(db);
    const target = goals.find((g) => g.id === goalId);
    if (!target || target.status === 'ended' || target.status === 'template') throw new GoalChangedError();
    if (target.template !== 'pause' && (await db.goalVersions.where('goalId').equals(goalId).count()) === 0) throw new GoalChangedError();
    const inForce = periodOn(periods, today);
    if (inForce?.goalId === goalId) {
      // "Keep Cut instead": back to the goal in force is cancelling what was booked.
      if (!planCancelSwitch(periods, today)) throw new GoalChangedError('Already the goal in force');
      const { startsOn, undo } = await cancelIn(db, opts, today);
      return { startsOn, cancelled: true, undo };
    }
    if (opts.until !== undefined && target.template !== 'pause') throw new RangeError('Only a pause has an end date');
    const resumeGoalId = opts.until !== undefined && inForce ? await resumeGoalIdIn(db, goals, periods, inForce, today) : undefined;
    const plan = planGoalSwitch({
      periods,
      today,
      goalId,
      ...(opts.until !== undefined ? { until: opts.until } : {}),
      ...(resumeGoalId !== undefined ? { resumeGoalId } : {}),
      newId,
      createdAt: now().toISOString(),
    });
    const undo = await applyPeriodPlan(db, plan, goals, periods, opts);
    return { startsOn: plan.startsOn, cancelled: false, undo };
  });
}

/** "Keep Cut instead": cancels what is booked from tomorrow; today's goal runs on. */
async function cancelGoalSwitchIn(db: KiraMakanDb, opts: GoalReadOptions = {}): Promise<{ undo: Undo }> {
  const { today } = await settingsFor(db, opts);
  return db.transaction('rw', [db.goals, db.goalPeriods], async () => {
    const { undo } = await cancelIn(db, opts, today);
    return { undo };
  });
}

function goalRowFrom(draft: GoalDraft, base: { id: Id; createdAt: string }, maintenanceKcal: number): Goal {
  const preset = presetFor(draft.template);
  const goal: Goal = withoutUndefined({
    id: base.id,
    name: draft.name.trim(),
    template: draft.template,
    heroMetric: draft.heroMetric,
    status: 'saved',
    paceKgPerWeek: draft.paceKgPerWeek,
    rangePct: draft.template === 'festive' ? draft.rangePct : undefined,
    // Lean bulk keeps the surplus the target was set with, so later suggestions keep it too.
    surplusKcal:
      draft.template === 'leanBulk'
        ? draft.dailyKcal !== undefined
          ? Math.max(0, Math.round(draft.dailyKcal - maintenanceKcal))
          : draft.surplusKcal
        : undefined,
    timing: draft.timing,
    suggestionWeights: { ...preset.suggestionWeights },
    endCondition: draft.endCondition,
    insightsOff: draft.insightsOff.length > 0 ? [...draft.insightsOff] : undefined,
    createdAt: base.createdAt,
  });
  return goal;
}

function versionFrom(
  goalId: Id,
  draft: GoalDraft,
  values: { effectiveFrom: LogicalDay; maintenanceKcal: number; reason: GoalVersion['reason']; createdAt: string },
): GoalVersion | undefined {
  if (draft.template === 'pause' || draft.dailyKcal === undefined || draft.proteinG === undefined) return undefined;
  return {
    id: newId(),
    goalId,
    effectiveFrom: values.effectiveFrom,
    dailyKcal: draft.dailyKcal,
    ...macrosForTarget(draft.dailyKcal, draft.proteinG),
    maintenanceKcal: values.maintenanceKcal,
    paceKgPerWeek: draft.paceKgPerWeek,
    reason: values.reason,
    createdAt: values.createdAt,
  };
}

/**
 * S43 Save goal: a saved goal with its target from today. It changes nothing until the user
 * switches to it. A built-in template row of the same template (status 'template') becomes the
 * goal, so no orphan template rows are left.
 */
async function createGoalIn(
  db: KiraMakanDb,
  draft: GoalDraft,
  opts: GoalReadOptions = {},
): Promise<{ goal: Goal; version?: GoalVersion; converted: boolean; undo: Undo }> {
  const { settings, today } = await settingsFor(db, opts);
  const trendKg = await trendKgIn(db, today);
  const errors = validateGoalDraft(draft, {
    today,
    dailyMinimumKcal: settings.dailyMinimumKcal,
    kcalChanged: true,
    endChanged: true,
    ...(trendKg !== undefined ? { trendKg } : {}),
  });
  if (Object.keys(errors).length > 0) throw new GoalDraftError(errors);
  const defaults = await getNewGoalDefaultsIn(db, { today });
  const maintenanceKcal = defaults?.maintenanceKcal ?? 0;
  const stamp = now().toISOString();

  return db.transaction('rw', [db.goals, db.goalVersions], async () => {
    const goals = await listGoals(db);
    const template = draft.template === 'custom' ? undefined : goals.find((g) => g.status === 'template' && g.template === draft.template);
    const goal = goalRowFrom(draft, { id: template?.id ?? newId(), createdAt: stamp }, maintenanceKcal);
    const version = versionFrom(goal.id, draft, { effectiveFrom: today, maintenanceKcal, reason: 'setup', createdAt: stamp });
    await db.goals.put(goal);
    if (version) await db.goalVersions.add(version);
    const undo: Undo = async () => {
      await db.transaction('rw', [db.goals, db.goalVersions], async () => {
        if (version) await db.goalVersions.delete(version.id);
        if (template) await db.goals.put(template);
        else await db.goals.delete(goal.id);
      });
    };
    return { goal, ...(version ? { version } : {}), converted: template !== undefined, undo };
  });
}

/**
 * S42 Save changes. Name, timing, insight toggles, end condition, the Festive range and a
 * Custom goal's main number live on the goal row and apply at once. Targets (kcal, protein,
 * pace) are versions: a goal never in force keeps one, replaced; one in force or used before
 * gets a version from tomorrow (spec D8), so today and earlier days keep theirs.
 */
async function saveGoalEditsIn(
  db: KiraMakanDb,
  goalId: Id,
  draft: GoalDraft,
  opts: GoalReadOptions = {},
): Promise<{ goal: Goal; version?: GoalVersion; startsOn?: LogicalDay; undo: Undo }> {
  const { settings, today } = await settingsFor(db, opts);
  const trendKg = await trendKgIn(db, today);
  const defaults = await getNewGoalDefaultsIn(db, { today });
  const tomorrow = addDays(today, 1);
  const stamp = now().toISOString();

  return db.transaction('rw', [db.goals, db.goalVersions, db.goalPeriods], async () => {
    const goal = await db.goals.get(goalId);
    if (!goal || goal.status === 'template') throw new GoalChangedError();
    const [versions, periods] = await Promise.all([listGoalVersions(db, goalId), listGoalPeriods(db)]);
    const newest = versions.at(-1);
    const errors = validateGoalDraft(draft, {
      today,
      dailyMinimumKcal: settings.dailyMinimumKcal,
      kcalChanged: draft.dailyKcal !== newest?.dailyKcal,
      endChanged: !sameEndCondition(goal.endCondition, draft.endCondition),
      ...(trendKg !== undefined ? { trendKg } : {}),
    });
    if (Object.keys(errors).length > 0) throw new GoalDraftError(errors);

    const targetChanged =
      goal.template !== 'pause' &&
      (!newest ||
        draft.dailyKcal !== newest.dailyKcal ||
        draft.proteinG !== newest.proteinG ||
        draft.paceKgPerWeek !== paceOf(goal, newest));
    const maintenanceKcal = newest?.maintenanceKcal ?? defaults?.maintenanceKcal ?? 0;
    const used = everInForce(periods, goalId, today);

    let version: GoalVersion | undefined;
    let replaced: GoalVersion[] = [];
    if (targetChanged) {
      version = versionFrom(goalId, draft, {
        effectiveFrom: used ? tomorrow : today,
        maintenanceKcal,
        reason: used ? 'manualEdit' : 'setup',
        createdAt: stamp,
      });
      if (version) {
        // Used: only tomorrow's versions make way (a pending approval included). Never used: its one target is replaced.
        replaced = used ? versions.filter((v) => v.effectiveFrom === tomorrow) : versions;
        await db.goalVersions.bulkDelete(replaced.map((v) => v.id));
        await db.goalVersions.add(version);
      }
    }

    const next: Goal = withoutUndefined({
      ...goal,
      name: draft.name.trim(),
      // Only a Custom goal picks its main number; the other templates keep theirs.
      heroMetric: goal.template === 'custom' ? draft.heroMetric : goal.heroMetric,
      rangePct: goal.template === 'festive' ? draft.rangePct : goal.rangePct,
      surplusKcal:
        goal.template === 'leanBulk' && version ? Math.max(0, Math.round(version.dailyKcal - maintenanceKcal)) : goal.surplusKcal,
      timing: draft.timing,
      endCondition: draft.endCondition,
      insightsOff: draft.insightsOff.length > 0 ? [...draft.insightsOff] : undefined,
    });
    await db.goals.put(next);

    const startsOn = version && version.effectiveFrom === tomorrow ? tomorrow : undefined;
    const undo: Undo = async () => {
      // Once tomorrow has started, a target from tomorrow already applied: it stays.
      if (compareDays(await todayIn(db, opts), tomorrow) >= 0) return;
      await db.transaction('rw', [db.goals, db.goalVersions], async () => {
        if (version) await db.goalVersions.delete(version.id);
        if (replaced.length > 0) await db.goalVersions.bulkPut(replaced);
        // The row as it was, with the status it has now (a switch since then keeps its bookkeeping).
        const row = await db.goals.get(goal.id);
        await db.goals.put(row ? { ...goal, status: row.status } : goal);
      });
    };
    return { goal: next, ...(version ? { version } : {}), ...(startsOn ? { startsOn } : {}), undo };
  });
}

/**
 * Archive: a goal that was ever in force becomes 'ended' (past days keep it); one that never
 * was is deleted with its versions. The goal in force today, or one booked later, can't be.
 */
async function archiveGoalIn(db: KiraMakanDb, goalId: Id, opts: GoalReadOptions = {}): Promise<{ deleted: boolean; undo: Undo }> {
  const { today } = await settingsFor(db, opts);
  return db.transaction('rw', [db.goals, db.goalVersions, db.goalPeriods], async () => {
    const goal = await db.goals.get(goalId);
    if (!goal || goal.status === 'ended' || goal.status === 'template') throw new GoalChangedError();
    const periods = await listGoalPeriods(db);
    if (inUseAfter(periods, goalId, today)) throw new GoalChangedError('The goal is in use');

    if (everInForce(periods, goalId, today)) {
      await db.goals.put({ ...goal, status: 'ended' });
      return { deleted: false, undo: () => restoreStatusOf(db, goal) };
    }
    const versions = await listGoalVersions(db, goalId);
    // Index-equality and key deletes, which reach the other device too.
    await deleteGoal(db, goalId);
    const undo: Undo = async () => {
      await db.transaction('rw', [db.goals, db.goalVersions], async () => {
        await db.goals.put(goal);
        await db.goalVersions.bulkPut(versions);
      });
    };
    return { deleted: true, undo };
  });
}

async function restoreStatusOf(db: KiraMakanDb, before: Goal): Promise<void> {
  await db.transaction('rw', [db.goals], () => restoreStatuses(db, [before]));
}

/** Restore an ended goal: back to the saved goals. */
async function restoreGoalIn(db: KiraMakanDb, goalId: Id): Promise<{ undo: Undo }> {
  return db.transaction('rw', [db.goals], async () => {
    const goal = await db.goals.get(goalId);
    if (!goal || goal.status !== 'ended') throw new GoalChangedError();
    await db.goals.put({ ...goal, status: 'saved' });
    return { undo: () => restoreStatusOf(db, goal) };
  });
}

export function createGoalActions(db: KiraMakanDb) {
  return {
    createGoal: (draft: GoalDraft, opts?: GoalReadOptions) => createGoalIn(db, draft, opts),
    saveGoalEdits: (goalId: Id, draft: GoalDraft, opts?: GoalReadOptions) => saveGoalEditsIn(db, goalId, draft, opts),
    switchGoal: (goalId: Id, opts?: GoalReadOptions & { until?: LogicalDay }) => switchGoalIn(db, goalId, opts),
    cancelGoalSwitch: (opts?: GoalReadOptions) => cancelGoalSwitchIn(db, opts),
    archiveGoal: (goalId: Id, opts?: GoalReadOptions) => archiveGoalIn(db, goalId, opts),
    restoreGoal: (goalId: Id) => restoreGoalIn(db, goalId),
  };
}

export const { createGoal, saveGoalEdits, switchGoal, cancelGoalSwitch, archiveGoal, restoreGoal } = createGoalActions(appDb);

// ---------------------------------------------------------------------------
// The Today goal-end notice: seen once per key, per device (localStorage, with an in-memory fallback)
// ---------------------------------------------------------------------------

const END_SEEN_KEY = 'kira-makan:goal-end-seen';

let endSeenCache: { key: string | null } | null = null;
const endSeenListeners = new Set<() => void>();

function loadEndSeen(): string | null {
  try {
    return window.localStorage.getItem(END_SEEN_KEY);
  } catch {
    return null;
  }
}

function writeEndSeen(key: string | null): void {
  endSeenCache = { key };
  try {
    if (key === null) window.localStorage.removeItem(END_SEEN_KEY);
    else window.localStorage.setItem(END_SEEN_KEY, key);
  } catch {
    // Private mode or storage blocked: remembered for this session only.
  }
  for (const listener of endSeenListeners) listener();
}

/** The last goal-end key seen on this device. */
export function readGoalEndNoticeSeen(): string | null {
  endSeenCache ??= { key: loadEndSeen() };
  return endSeenCache.key;
}

/** The end of `key` has been seen (the Today banner tapped, or the S41 note shown). */
export function markGoalEndNoticeSeen(key: string): void {
  if (readGoalEndNoticeSeen() === key) return;
  writeEndSeen(key);
}

/** Forgets the seen key (tests, a fresh start). */
export function clearGoalEndNoticeSeen(): void {
  writeEndSeen(null);
}

function subscribeEndSeen(listener: () => void): () => void {
  endSeenListeners.add(listener);
  return () => {
    endSeenListeners.delete(listener);
  };
}

export function useGoalEndNoticeSeen(): string | null {
  return useSyncExternalStore(subscribeEndSeen, readGoalEndNoticeSeen, readGoalEndNoticeSeen);
}
