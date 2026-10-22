/**
 * Read model, hook and actions for the top dishes check (S34). The list of dishes is read from
 * the last 8 weeks of meals (src/domain/dishCheck); the state lives in one existing synced row,
 * the `insightFeedback` row 'topDishes' (feedback 'dishCheck', optional `dishCheck`): the list
 * frozen at the first answer, the answers, and when it was finished. An answer is kept through
 * the existing learning (`rememberCorrection`: a PersonalItem, and the Place's learned portion
 * for a Place default), so the estimators and the Log matches pick it up. Past meals, Usuals and
 * pots are never rewritten. Reading never writes.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { createActions, type Undo } from '@/db/actions';
import { db as appDb, type KiraMakanDb } from '@/db/db';
import { useToday } from '@/db/hooks';
import {
  deleteInsightFeedback,
  getInsightFeedback,
  listMealsInRange,
  listPersonalItems,
  listPlaces,
  putInsightFeedback,
  putPersonalItem,
  setPlaceDefaultVariant,
} from '@/db/repo';
import { loadSettings, todayFor, type Settings } from '@/db/selectors';
import { now } from '@/domain/clock';
import { addDays, compareDays } from '@/domain/day';
import {
  DISH_CHECK_HIDE_DAYS,
  DISH_CHECK_HISTORY_DAYS,
  DISH_CHECK_ID,
  DISH_CHECK_MIN_DAYS,
  DISH_CHECK_MIN_DISHES,
  dishEstimate,
  dishStats,
  loggedDayCount,
  planDishAnswer,
  topDishes,
  type DishAnswer,
  type DishChange,
  type DishSource,
  type DishStat,
} from '@/domain/dishCheck';
import type { DishCheckEntry, InsightFeedback, Instant, LogicalDay, PersonalItem, Place } from '@/domain/types';

/** The insightFeedback row that holds the check. */
export const DISH_CHECK_FEEDBACK_ID = DISH_CHECK_ID;

interface ReadOptions {
  /** The current logical day; the clock in the profile's zone by default. */
  today?: LogicalDay;
}

/** The list moved under the user: an unknown dish, a dish already answered, or a check already finished. */
export class DishCheckChangedError extends Error {
  constructor(message = 'The top dishes check changed') {
    super(message);
    this.name = 'DishCheckChangedError';
  }
}

// ---------------------------------------------------------------------------
// Read model
// ---------------------------------------------------------------------------

export type DishCheckPhase = 'locked' | 'thin' | 'ready' | 'inProgress' | 'done';

export interface DishCheckStatus {
  phase: DishCheckPhase;
  /** Days with a real meal in the 56-day window (today included). */
  loggedDays: number;
  /** Listable dishes (2+ logs), at most 30. */
  dishCount: number;
  /** The frozen list once started (dishes no longer in the diary left out), else dishCount. */
  total: number;
  answered: number;
  /** Not finished and "Not now" is still inside its 28 days. Answering clears it. */
  hidden: boolean;
  startedOn?: LogicalDay;
  doneAt?: Instant;
}

export interface DishRowView {
  key: string;
  name: string;
  /** Meals it was in over the 8 weeks before the check started (frozen). */
  times: number;
  source: DishSource;
  /** One portion, live. */
  kcal: number;
  /** "Normal", "a piece", "1 portion". */
  portion: string;
  /** Only for a Place default. */
  placeName?: string;
  answer?: DishAnswer;
  saved?: boolean;
  /** kcal before the answer. */
  fromKcal?: number;
}

export interface DishCheckSummary {
  right: number;
  more: number;
  less: number;
  notChecked: number;
  /** Dishes whose number moved (Usually more or less). */
  updated: number;
  changes: { key: string; name: string; fromKcal: number; toKcal: number }[];
}

export interface DishCheckView extends DishCheckStatus {
  today: LogicalDay;
  tz: string;
  rolloverHour: number;
  /** Empty while locked or thin; the candidates when ready; the frozen list once started. */
  rows: DishRowView[];
  /** Done only. */
  summary?: DishCheckSummary;
}

interface State {
  settings: Settings;
  today: LogicalDay;
  places: Place[];
  personal: PersonalItem[];
  row: InsightFeedback | undefined;
  stats: DishStat[];
  candidates: DishStat[];
  loggedDays: number;
}

/**
 * The rows behind the check. Reads only meals, places, personalItems and insightFeedback, so an action can run it inside its transaction.
 * What is offered (`candidates`, `loggedDays`) comes from the rolling 8 weeks. Whether a frozen dish is
 * still in the diary (`stats`) comes from the 8 weeks before the check started through today, so a
 * dish only drops out when its meals were deleted, not because they got older than 8 weeks.
 */
async function readState(db: KiraMakanDb, settings: Settings, today: LogicalDay): Promise<State> {
  const [places, personal, row] = await Promise.all([listPlaces(db), listPersonalItems(db), getInsightFeedback(db, DISH_CHECK_FEEDBACK_ID)]);
  const rollingFrom = addDays(today, -(DISH_CHECK_HISTORY_DAYS - 1));
  const frozenFrom = row?.dishCheck ? addDays(row.dishCheck.startedOn, -(DISH_CHECK_HISTORY_DAYS - 1)) : undefined;
  const from = frozenFrom !== undefined && compareDays(frozenFrom, rollingFrom) < 0 ? frozenFrom : rollingFrom;
  const meals = await listMealsInRange(db, from, today);
  const widened = from !== rollingFrom;
  const rolling = widened ? meals.filter((m) => compareDays(m.logicalDay, rollingFrom) >= 0) : meals;
  const rollingStats = dishStats(rolling, places);
  const stats = widened ? dishStats(meals, places) : rollingStats;
  return { settings, today, places, personal, row, stats, candidates: topDishes(rollingStats), loggedDays: loggedDayCount(rolling) };
}

async function loadState(db: KiraMakanDb, opts: ReadOptions): Promise<State | undefined> {
  const settings = await loadSettings(db);
  if (!settings.profile) return undefined;
  return readState(db, settings, opts.today ?? todayFor(settings.profile));
}

/** The frozen entries whose dish is still in the diary. */
function liveEntries(state: State): DishCheckEntry[] {
  const present = new Set(state.stats.map((s) => s.key));
  return (state.row?.dishCheck?.dishes ?? []).filter((e) => present.has(e.key));
}

function statusOf(state: State): DishCheckStatus {
  const { row, today, candidates, loggedDays } = state;
  const check = row?.dishCheck;
  let phase: DishCheckPhase;
  if (check?.doneAt) phase = 'done';
  else if (check) phase = 'inProgress';
  else if (loggedDays < DISH_CHECK_MIN_DAYS) phase = 'locked';
  else if (candidates.length < DISH_CHECK_MIN_DISHES) phase = 'thin';
  else phase = 'ready';

  const entries = check ? liveEntries(state) : [];
  const status: DishCheckStatus = {
    phase,
    loggedDays,
    dishCount: candidates.length,
    total: check ? entries.length : candidates.length,
    answered: entries.filter((e) => e.answer !== undefined).length,
    hidden: !check?.doneAt && row?.pausedUntil !== undefined && compareDays(today, row.pausedUntil) < 0,
  };
  if (check) status.startedOn = check.startedOn;
  if (check?.doneAt) status.doneAt = check.doneAt;
  return status;
}

/** Just the phase and the counts, for the Insights card and the Unlock list. Undefined without a profile. */
export async function getDishCheckStatusIn(db: KiraMakanDb, opts: ReadOptions = {}): Promise<DishCheckStatus | undefined> {
  const state = await loadState(db, opts);
  return state ? statusOf(state) : undefined;
}

function rowView(entry: DishCheckEntry, stat: DishStat, state: State): DishRowView {
  const estimate = dishEstimate(entry.placeId !== undefined ? { ...stat, placeId: entry.placeId } : omitPlace(stat), state);
  const view: DishRowView = {
    key: entry.key,
    name: entry.name,
    times: entry.times,
    source: estimate.source,
    kcal: estimate.kcal,
    portion: estimate.portion,
  };
  if (estimate.source === 'placeDefault') {
    const placeName = state.places.find((p) => p.id === estimate.placeId)?.name;
    if (placeName) view.placeName = placeName;
  }
  if (entry.answer) view.answer = entry.answer;
  if (entry.saved) view.saved = true;
  if (entry.fromKcal !== undefined) view.fromKcal = entry.fromKcal;
  return view;
}

/** A dish-wide row stays dish-wide, whatever Place its logs have grown into since. */
function omitPlace(stat: DishStat): DishStat {
  const { placeId: _placeId, ...rest } = stat;
  return rest;
}

function summaryOf(rows: readonly DishRowView[]): DishCheckSummary {
  const count = (answer: DishAnswer): number => rows.filter((r) => r.answer === answer).length;
  return {
    right: count('right'),
    more: count('more'),
    less: count('less'),
    notChecked: rows.filter((r) => r.answer === undefined).length,
    updated: count('more') + count('less'),
    changes: rows
      .filter((r) => (r.answer === 'more' || r.answer === 'less') && r.fromKcal !== undefined)
      .map((r) => ({ key: r.key, name: r.name, fromKcal: r.fromKcal ?? r.kcal, toKcal: r.kcal })),
  };
}

/** The S34 view. Undefined without a profile. */
export async function getDishCheckViewIn(db: KiraMakanDb, opts: ReadOptions = {}): Promise<DishCheckView | undefined> {
  const state = await loadState(db, opts);
  if (!state) return undefined;
  const status = statusOf(state);
  const view: DishCheckView = { ...status, today: state.today, tz: state.settings.tz, rolloverHour: state.settings.rolloverHour, rows: [] };
  const byKey = new Map(state.stats.map((s) => [s.key, s]));

  if (state.row?.dishCheck) {
    // The frozen order and numbers of times; the kcal and source are live.
    view.rows = liveEntries(state).flatMap((entry) => {
      const stat = byKey.get(entry.key);
      return stat ? [rowView(entry, stat, state)] : [];
    });
  } else if (status.phase === 'ready') {
    view.rows = state.candidates.map((stat) => rowView(entryOf(stat), stat, state));
  }
  if (status.phase === 'done') view.summary = summaryOf(view.rows);
  return view;
}

/** S34, re-read when the data changes or the day rolls over. */
export function useDishCheckView(): DishCheckView | undefined {
  const today = useToday();
  return useLiveQuery(() => getDishCheckViewIn(appDb, { today }), [today]);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** A dish as the frozen list holds it. */
function entryOf(stat: DishStat): DishCheckEntry {
  return { key: stat.key, name: stat.name, times: stat.times, ...(stat.placeId !== undefined ? { placeId: stat.placeId } : {}) };
}

function withoutAnswer(entry: DishCheckEntry): DishCheckEntry {
  const { answer: _answer, fromKcal: _fromKcal, saved: _saved, ...rest } = entry;
  return rest;
}

export interface DishAnswerResult {
  kind: DishChange['kind'];
  fromKcal: number;
  toKcal: number;
  undo: Undo;
}

/**
 * One answer. The first one on a ready check freezes the list into the row. A PersonalItem
 * (and, for a Place default, the Place's learned portion) is written when the answer teaches
 * something. The undo puts those two back exactly and clears only this entry's answer, never
 * the others: if this answer started the check and no other is left, the row goes back to what it was.
 */
async function answerDishIn(db: KiraMakanDb, key: string, answer: DishAnswer, opts: ReadOptions = {}): Promise<DishAnswerResult> {
  // loadSettings reads the profile, a table outside the transaction.
  const settings = await loadSettings(db);
  const today = opts.today ?? todayFor(settings.profile);

  return db.transaction('rw', [db.meals, db.personalItems, db.places, db.insightFeedback], async () => {
    const state = await readState(db, settings, today);
    const { row, stats, candidates, places, personal } = state;
    const check = row?.dishCheck;

    let entries: DishCheckEntry[];
    if (check) {
      if (check.doneAt) throw new DishCheckChangedError();
      entries = check.dishes;
    } else {
      if (state.loggedDays < DISH_CHECK_MIN_DAYS || candidates.length < DISH_CHECK_MIN_DISHES) throw new DishCheckChangedError();
      entries = candidates.map(entryOf);
    }
    const entry = entries.find((e) => e.key === key);
    const stat = stats.find((s) => s.key === key);
    if (!entry || entry.answer !== undefined || !stat) throw new DishCheckChangedError();

    const estimate = dishEstimate(entry.placeId !== undefined ? { ...stat, placeId: entry.placeId } : omitPlace(stat), { personal, places });
    const plan = planDishAnswer(estimate, answer);

    // What the undo needs.
    const personalBefore = personal;
    const place = estimate.placeId !== undefined ? places.find((p) => p.id === estimate.placeId) : undefined;
    const catalogueId = plan.item?.catalogueId;
    const placeRestore =
      estimate.scope === 'place' && place && catalogueId !== undefined ? { placeId: place.id, catalogueId, before: place.defaultVariants[catalogueId] } : undefined;

    const written = plan.item
      ? await createActions(db).rememberCorrection(plan.item, estimate.scope === 'place' ? estimate.placeId : undefined, estimate.scope)
      : undefined;

    const answered: DishCheckEntry = { ...entry, answer, fromKcal: estimate.kcal, ...(plan.kind !== 'none' ? { saved: true } : {}) };
    const next: InsightFeedback = {
      ...row,
      ruleId: DISH_CHECK_FEEDBACK_ID,
      feedback: 'dishCheck',
      at: now().toISOString(),
      dishCheck: { startedOn: check?.startedOn ?? today, dishes: entries.map((e) => (e.key === key ? answered : e)) },
    };
    // Starting counts as engaging, so the card's "Not now" no longer applies.
    delete next.pausedUntil;
    await putInsightFeedback(db, next);

    const startedHere = check === undefined;
    const previousRow = row;
    const undo: Undo = async () => {
      await db.transaction('rw', [db.personalItems, db.places, db.insightFeedback], async () => {
        if (written) {
          const before = personalBefore.find((p) => p.id === written.id);
          if (before) await putPersonalItem(db, before);
          else await db.personalItems.delete(written.id);
        }
        if (placeRestore) await setPlaceDefaultVariant(db, placeRestore.placeId, placeRestore.catalogueId, placeRestore.before ?? null);

        // Re-read: later answers must survive.
        const current = await getInsightFeedback(db, DISH_CHECK_FEEDBACK_ID);
        const latest = current?.dishCheck;
        if (!current || !latest) return;
        const dishes = latest.dishes.map((e) => (e.key === key ? withoutAnswer(e) : e));
        if (startedHere && !latest.doneAt && !dishes.some((e) => e.answer !== undefined)) {
          if (previousRow) await putInsightFeedback(db, previousRow);
          else await deleteInsightFeedback(db, DISH_CHECK_FEEDBACK_ID);
          return;
        }
        await putInsightFeedback(db, { ...current, dishCheck: { ...latest, dishes } });
      });
    };
    return { kind: plan.kind, fromKcal: plan.fromKcal, toKcal: plan.toKcal, undo };
  });
}

/** Done: nothing is asked after it. Unanswered dishes simply stay unasked. */
async function finishDishCheckIn(db: KiraMakanDb, opts: ReadOptions = {}): Promise<{ answered: number; updated: number; undo: Undo }> {
  const state = await loadState(db, opts);
  if (!state) throw new DishCheckChangedError();
  const entries = liveEntries(state);
  const answered = entries.filter((e) => e.answer !== undefined).length;
  const updated = entries.filter((e) => e.answer === 'more' || e.answer === 'less').length;

  return db.transaction('rw', [db.insightFeedback], async () => {
    const row = await getInsightFeedback(db, DISH_CHECK_FEEDBACK_ID);
    const check = row?.dishCheck;
    if (!row || !check || check.doneAt) throw new DishCheckChangedError();
    await putInsightFeedback(db, { ...row, at: now().toISOString(), dishCheck: { ...check, doneAt: now().toISOString() } });
    const undo: Undo = async () => {
      await db.transaction('rw', [db.insightFeedback], async () => {
        const current = await getInsightFeedback(db, DISH_CHECK_FEEDBACK_ID);
        if (!current?.dishCheck) return;
        const { doneAt: _doneAt, ...open } = current.dishCheck;
        await putInsightFeedback(db, { ...current, dishCheck: open });
      });
    };
    return { answered, updated, undo };
  });
}

/** Not now: hides the Insights card for 4 weeks. The Unlock-list row stays. */
async function dismissDishCheckIn(db: KiraMakanDb, opts: ReadOptions = {}): Promise<Undo> {
  const settings = await loadSettings(db);
  const today = opts.today ?? todayFor(settings.profile);

  return db.transaction('rw', [db.insightFeedback], async () => {
    const previous = await getInsightFeedback(db, DISH_CHECK_FEEDBACK_ID);
    const pausedUntil = addDays(today, DISH_CHECK_HIDE_DAYS);
    await putInsightFeedback(
      db,
      previous
        ? { ...previous, pausedUntil }
        : { ruleId: DISH_CHECK_FEEDBACK_ID, feedback: 'dishCheck', at: now().toISOString(), pausedUntil },
    );
    const undo: Undo = async () => {
      await db.transaction('rw', [db.insightFeedback], async () => {
        const current = await getInsightFeedback(db, DISH_CHECK_FEEDBACK_ID);
        if (current?.dishCheck) {
          const { pausedUntil: _pausedUntil, ...rest } = current;
          await putInsightFeedback(db, previous?.pausedUntil !== undefined ? { ...rest, pausedUntil: previous.pausedUntil } : rest);
        } else if (previous) {
          await putInsightFeedback(db, previous);
        } else {
          await deleteInsightFeedback(db, DISH_CHECK_FEEDBACK_ID);
        }
      });
    };
    return undo;
  });
}

export function createDishCheckActions(db: KiraMakanDb) {
  return {
    answerDish: (key: string, answer: DishAnswer, opts?: ReadOptions) => answerDishIn(db, key, answer, opts),
    finishDishCheck: (opts?: ReadOptions) => finishDishCheckIn(db, opts),
    dismissDishCheck: (opts?: ReadOptions) => dismissDishCheckIn(db, opts),
  };
}

export const { answerDish, finishDishCheck, dismissDishCheck } = createDishCheckActions(appDb);

