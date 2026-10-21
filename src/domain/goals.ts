/**
 * Goals (plan §6, S41–S44): which goal period applies on a day, a switch from the next
 * rollover, end conditions, and the S42/S43 draft with its checks.
 *
 * Pure: the data layer (src/db/goals.ts) reads and writes the rows. Periods decide which goal
 * applies on a day (`Goal.status` is only library bookkeeping); versions decide its targets.
 * A switch never edits the past: it caps the periods that reach past today at tomorrow,
 * replaces anything booked from tomorrow on, and adds the new period from tomorrow.
 */
// Template defaults are plain data next to the seeds (they import nothing but domain types).
import { presetFor } from '@/db/seed/defaults';
import { addDays, compareDays, daysBetween } from './day';
import { fmtInt, fmtKg } from './format';
import { dailyTargetFor, defaultMacroTargets } from './targets';
import type { Goal, GoalPeriod, GoalTemplate, HeroMetric, Id, InsightGroup, Instant, LogicalDay, TimingRules } from './types';

export const GOAL_NAME_MAX = 40;
/** The lowest daily target is the profile's daily minimum. */
export const TARGET_KCAL_MAX = 5000;
export const TARGET_KCAL_STEP = 50;
export const PROTEIN_LIMIT = { min: 40, max: 250 } as const;
export const PROTEIN_STEP = 5;
/** Cut's pace chips, kg a week. */
export const PACE_CHOICES = [0.25, 0.5, 0.75] as const;
/** Custom's pace chips (0 = Hold). */
export const CUSTOM_PACE_CHOICES = [0, 0.25, 0.5, 0.75] as const;
/** Festive maintain's band around its target. */
export const RANGE_CHOICES = [0.05, 0.1, 0.15] as const;
export const WINDOW_HOURS_LIMIT = { min: 8, max: 16 } as const;
export const SLEEP_GAP_LIMIT = { min: 1, max: 4 } as const;
export const OCCASIONS_LIMIT = { min: 3, max: 8 } as const;
export const DEFAULT_SLEEP_GAP_HOURS = 2;
export const DEFAULT_MAX_OCCASIONS = 5;
/** 10am–8pm, in minutes after midnight. */
export const DEFAULT_FIXED_WINDOW = { startMin: 600, endMin: 1200 } as const;
/** A dated pause ends at most this many days after it starts. */
export const PAUSE_UNTIL_MAX_DAYS = 60;
export const END_DATE_MAX_DAYS = 730;
export const END_WEIGHT_LIMIT = { min: 30, max: 300 } as const;

// ---------------------------------------------------------------------------
// The draft S42 and S43 save
// ---------------------------------------------------------------------------

/** What S43 and S42 save, as numbers. Pause has no dailyKcal / proteinG. */
export interface GoalDraft {
  name: string;
  template: GoalTemplate;
  heroMetric: HeroMetric;
  paceKgPerWeek: number;
  dailyKcal?: number;
  proteinG?: number;
  /** Festive maintain. */
  rangePct?: number;
  /** Lean bulk. */
  surplusKcal?: number;
  timing: TimingRules;
  insightsOff: InsightGroup[];
  endCondition?: { date?: LogicalDay; weightKg?: number };
}

export interface DraftContext {
  name: string;
  maintenanceKcal: number;
  weightKg: number;
  dailyMinimumKcal: number;
}

function copyTiming(timing: TimingRules): TimingRules {
  const copy: TimingRules = { ...timing };
  if (timing.fixedWindow) copy.fixedWindow = { ...timing.fixedWindow };
  return copy;
}

/** Template defaults (presetFor) with the targets worked out: dailyTargetFor, defaultMacroTargets. */
export function goalDraftFor(template: GoalTemplate, ctx: DraftContext): GoalDraft {
  const preset = presetFor(template);
  const draft: GoalDraft = {
    name: ctx.name,
    template,
    heroMetric: preset.heroMetric,
    paceKgPerWeek: preset.paceKgPerWeek,
    timing: copyTiming(preset.timing),
    insightsOff: [],
  };
  if (preset.rangePct !== undefined) draft.rangePct = preset.rangePct;
  if (preset.surplusKcal !== undefined) draft.surplusKcal = preset.surplusKcal;
  if (template !== 'pause') {
    const dailyKcal = dailyTargetFor(
      { template, paceKgPerWeek: preset.paceKgPerWeek, ...(preset.surplusKcal !== undefined ? { surplusKcal: preset.surplusKcal } : {}) },
      ctx.maintenanceKcal,
      ctx.dailyMinimumKcal,
    );
    draft.dailyKcal = dailyKcal;
    draft.proteinG = defaultMacroTargets(dailyKcal, ctx.weightKg, template).proteinG;
  }
  return draft;
}

export type GoalDraftField = 'name' | 'dailyKcal' | 'proteinG' | 'timing' | 'end';
export type GoalDraftErrors = Partial<Record<GoalDraftField, string>>;

function endError(
  end: NonNullable<GoalDraft['endCondition']>,
  draft: Pick<GoalDraft, 'paceKgPerWeek'>,
  ctx: { today: LogicalDay; trendKg?: number },
): string | undefined {
  if (end.date !== undefined) {
    if (compareDays(end.date, ctx.today) <= 0) return 'Pick a date after today';
    if (daysBetween(ctx.today, end.date) > END_DATE_MAX_DAYS) return 'Pick a date within 2 years';
  }
  if (end.weightKg !== undefined) {
    const kg = end.weightKg;
    if (!Number.isFinite(kg)) return 'Add a weight in kg';
    if (kg < END_WEIGHT_LIMIT.min || kg > END_WEIGHT_LIMIT.max) return `Between ${END_WEIGHT_LIMIT.min} and ${END_WEIGHT_LIMIT.max} kg`;
    const trend = ctx.trendKg;
    // The direction only makes sense against a trend; without one, any weight in range is fine.
    if (trend !== undefined && draft.paceKgPerWeek > 0 && kg >= trend) return `Pick a weight under your ${fmtKg(trend)} trend`;
    if (trend !== undefined && draft.paceKgPerWeek < 0 && kg <= trend) return `Pick a weight over your ${fmtKg(trend)} trend`;
  }
  return undefined;
}

/** Same end (a date, a weight or none); a weight typed as nothing (NaN) never matches. */
export function sameEndCondition(a: Goal['endCondition'], b: Goal['endCondition']): boolean {
  return a?.date === b?.date && a?.weightKg === b?.weightKg;
}

/**
 * {} when valid. A target below the daily minimum is only an error when the user changed it,
 * and so is an end that has since passed or been reached: an unchanged end never blocks an edit.
 */
export function validateGoalDraft(
  draft: GoalDraft,
  ctx: { today: LogicalDay; dailyMinimumKcal: number; trendKg?: number; kcalChanged: boolean; endChanged: boolean },
): GoalDraftErrors {
  const errors: GoalDraftErrors = {};
  const name = draft.name.trim();
  if (!name) errors.name = 'Give it a name';
  else if (name.length > GOAL_NAME_MAX) errors.name = `Up to ${GOAL_NAME_MAX} characters`;

  if (draft.template !== 'pause' && draft.dailyKcal !== undefined) {
    const kcal = draft.dailyKcal;
    if (!Number.isFinite(kcal) || (ctx.kcalChanged && kcal < ctx.dailyMinimumKcal)) {
      errors.dailyKcal = `At least your ${fmtInt(ctx.dailyMinimumKcal)} daily minimum`;
    } else if (kcal > TARGET_KCAL_MAX) {
      errors.dailyKcal = `Up to ${fmtInt(TARGET_KCAL_MAX)} kcal`;
    }
  }
  if (draft.template !== 'pause' && draft.proteinG !== undefined) {
    const g = draft.proteinG;
    if (!Number.isFinite(g) || g < PROTEIN_LIMIT.min || g > PROTEIN_LIMIT.max) {
      errors.proteinG = `Between ${PROTEIN_LIMIT.min} and ${PROTEIN_LIMIT.max}g`;
    }
  }
  const fixed = draft.timing.fixedWindow;
  if (fixed && fixed.startMin === fixed.endMin) errors.timing = 'Opening and closing times need to differ';
  if (draft.endCondition && ctx.endChanged) {
    const end = endError(draft.endCondition, draft, ctx);
    if (end) errors.end = end;
  }
  return errors;
}

/** 'Cut' → 'Cut 2' when taken (case-insensitive), then 'Cut 3'… */
export function uniqueGoalName(base: string, taken: readonly string[]): string {
  const used = new Set(taken.map((name) => name.trim().toLowerCase()));
  if (!used.has(base.trim().toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const name = `${base} ${n}`;
    if (!used.has(name.toLowerCase())) return name;
  }
}

// ---------------------------------------------------------------------------
// Periods: which goal applies when (`to` is exclusive)
// ---------------------------------------------------------------------------

function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * The order periods resolve in: by `from`, then by when they were booked (rows from before
 * `createdAt` sort first), then by id. Of the periods covering a day, the last one applies, so
 * two switches booked offline for the same day give the same answer on every device.
 */
export function comparePeriods(a: GoalPeriod, b: GoalPeriod): number {
  return compareDays(a.from, b.from) || compareText(a.createdAt ?? '', b.createdAt ?? '') || compareText(a.id, b.id);
}

export function periodCovers(period: GoalPeriod, day: LogicalDay): boolean {
  return compareDays(period.from, day) <= 0 && (period.to === undefined || compareDays(day, period.to) < 0);
}

/** The period that applies on `day`: the covering one that sorts last. */
export function periodOn(periods: readonly GoalPeriod[], day: LogicalDay): GoalPeriod | undefined {
  let found: GoalPeriod | undefined;
  for (const period of periods) {
    if (periodCovers(period, day) && (!found || comparePeriods(period, found) > 0)) found = period;
  }
  return found;
}

/** The goal was in force on some day up to `today` (it has history). */
export function everInForce(periods: readonly GoalPeriod[], goalId: Id, today: LogicalDay): boolean {
  return periods.some((p) => p.goalId === goalId && compareDays(p.from, today) <= 0);
}

/** The goal runs today or is booked for later: it can't be archived. */
export function inUseAfter(periods: readonly GoalPeriod[], goalId: Id, today: LogicalDay): boolean {
  return periods.some((p) => p.goalId === goalId && (p.to === undefined || compareDays(p.to, today) > 0));
}

/** The goal of the open-ended period that sorts last: the one that stays once every booking has started. */
export function activeGoalIdAfter(periods: readonly GoalPeriod[]): Id | undefined {
  let found: GoalPeriod | undefined;
  for (const period of periods) {
    if (period.to === undefined && (!found || comparePeriods(period, found) > 0)) found = period;
  }
  return found?.goalId;
}

/** "week 3": floor(daysBetween(period.from, today) / 7) + 1, never below 1. */
export function goalWeek(period: Pick<GoalPeriod, 'from'>, today: LogicalDay): number {
  return Math.max(1, Math.floor(daysBetween(period.from, today) / 7) + 1);
}

export interface PeriodPlan {
  /** Tomorrow: the day the change applies from. */
  startsOn: LogicalDay;
  /** Period ids to delete (key deletes). */
  remove: Id[];
  /** Whole rows to put: changed existing periods first, then new ones. */
  put: GoalPeriod[];
  /** Ids of the new periods in `put`. */
  added: Id[];
}

function withoutTo(period: GoalPeriod): GoalPeriod {
  const { to: _to, ...rest } = period;
  return rest;
}

/**
 * A switch to `goalId` from tomorrow. Periods reaching past today end at tomorrow, anything
 * starting tomorrow or later (an earlier booking, a pause's resume) is removed, and the new
 * period starts tomorrow. With `until` (a dated pause) the new period ends there and
 * `resumeGoalId` (today's goal) starts again that day.
 */
export function planGoalSwitch(input: {
  periods: readonly GoalPeriod[];
  today: LogicalDay;
  goalId: Id;
  until?: LogicalDay;
  resumeGoalId?: Id;
  newId: () => Id;
  createdAt: Instant;
}): PeriodPlan {
  const { today, goalId, until, resumeGoalId, createdAt } = input;
  const startsOn = addDays(today, 1);
  if (until !== undefined) {
    if (!resumeGoalId) throw new RangeError('A dated pause needs a goal to resume');
    if (compareDays(until, startsOn) <= 0 || daysBetween(startsOn, until) > PAUSE_UNTIL_MAX_DAYS) {
      throw new RangeError(`A pause ends 1 to ${PAUSE_UNTIL_MAX_DAYS} days after it starts`);
    }
  }
  const periods = [...input.periods].sort(comparePeriods);
  const remove = periods.filter((p) => compareDays(p.from, startsOn) >= 0).map((p) => p.id);
  const put: GoalPeriod[] = periods
    .filter((p) => compareDays(p.from, today) <= 0 && (p.to === undefined || compareDays(p.to, startsOn) > 0))
    .map((p) => ({ ...p, to: startsOn }));

  const added: Id[] = [];
  const next: GoalPeriod = { id: input.newId(), goalId, from: startsOn, createdAt };
  if (until !== undefined) next.to = until;
  put.push(next);
  added.push(next.id);
  if (until !== undefined && resumeGoalId) {
    const resume: GoalPeriod = { id: input.newId(), goalId: resumeGoalId, from: until, createdAt };
    put.push(resume);
    added.push(resume.id);
  }
  return { startsOn, remove, put, added };
}

/**
 * Cancels what is booked from tomorrow: those periods are removed and today's period runs on
 * (put back without its end). Undefined when nothing is booked.
 */
export function planCancelSwitch(periods: readonly GoalPeriod[], today: LogicalDay): PeriodPlan | undefined {
  const startsOn = addDays(today, 1);
  const sorted = [...periods].sort(comparePeriods);
  const remove = sorted.filter((p) => compareDays(p.from, startsOn) >= 0).map((p) => p.id);
  const current = periodOn(sorted, today);
  const reopen = current?.to !== undefined ? withoutTo(current) : undefined;
  if (remove.length === 0 && !reopen) return undefined;
  return { startsOn, remove, put: reopen ? [reopen] : [], added: [] };
}

// ---------------------------------------------------------------------------
// End condition (plan §6.3): never automatic, only a suggestion
// ---------------------------------------------------------------------------

export type EndState =
  | { kind: 'none' }
  | { kind: 'date'; date: LogicalDay; reached: boolean; daysLeft: number }
  | { kind: 'weight'; weightKg: number; reached: boolean; trendKg?: number };

/**
 * Where the goal stands against its end: a date is reached on that day; a weight when the
 * trend (never a single reading) is at or past it in the pace's direction. A hold pace never
 * reaches a weight.
 */
export function endConditionState(
  end: Goal['endCondition'],
  ctx: { today: LogicalDay; trendKg?: number; paceKgPerWeek: number },
): EndState {
  if (end?.date !== undefined) {
    return {
      kind: 'date',
      date: end.date,
      reached: compareDays(ctx.today, end.date) >= 0,
      daysLeft: Math.max(0, daysBetween(ctx.today, end.date)),
    };
  }
  if (end?.weightKg !== undefined) {
    const { trendKg, paceKgPerWeek: pace } = ctx;
    const reached =
      trendKg !== undefined && ((pace > 0 && trendKg <= end.weightKg) || (pace < 0 && trendKg >= end.weightKg));
    const state: EndState = { kind: 'weight', weightKg: end.weightKg, reached };
    if (trendKg !== undefined) state.trendKg = trendKg;
    return state;
  }
  return { kind: 'none' };
}

/** What the "seen" store remembers for a reached end: one notice per goal and end. */
export function endKey(goalId: Id, state: EndState): string | undefined {
  if (state.kind === 'date') return `${goalId}:date:${state.date}`;
  if (state.kind === 'weight') return `${goalId}:weight:${state.weightKg}`;
  return undefined;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Thrown by the goal actions when what the screen showed is no longer true (archived, started, booked elsewhere). */
export class GoalChangedError extends Error {
  constructor(message = 'The goal changed') {
    super(message);
    this.name = 'GoalChangedError';
  }
}

/** A draft that doesn't pass validateGoalDraft; `errors` says which fields. */
export class GoalDraftError extends RangeError {
  readonly errors: GoalDraftErrors;

  constructor(errors: GoalDraftErrors) {
    super('The goal has fields to fix');
    this.name = 'GoalDraftError';
    this.errors = errors;
  }
}
