/**
 * Pure helpers that turn the target view (src/db/targetSuggestion) into what S37 and the C45
 * card show. All of S37's copy lives here, except the working sentence (shared with the
 * insight, src/domain/maintenance) and the Today notice (todayModel.ts). Estimates carry "~";
 * targets don't, they are the exact numbers the budget uses.
 */
import { PATHS } from '@/app/paths';
import type { TargetSuggestionCardProps, TargetWorkingRow } from '@/components/TargetSuggestionCard/TargetSuggestionCard';
import type { TargetChoice, TargetView } from '@/db/targetSuggestion';
import type { ProratedWeek } from '@/domain/budget';
import { addDays, daysBetween, weekdayIndex, zonedParts } from '@/domain/day';
import { fmtApprox, fmtClock, fmtDayShort, fmtInt, fmtKgRate, fmtSigned, fmtWeekday, roundTo10, roundTo5 } from '@/domain/format';
import { maintenanceWorking, type MaintenanceEstimate, type TargetCheck, type TargetOptionValues } from '@/domain/maintenance';
import { DEFAULT_SURPLUS_KCAL, KCAL_PER_KG, paceOf } from '@/domain/targets';
import type { GoalTemplate, GoalVersion, LogicalDay } from '@/domain/types';

const SUNDAY = 6;

function plural(n: number, one: string, many: string = `${one}s`): string {
  return `${fmtInt(n)} ${n === 1 ? one : many}`;
}

/** Cut and custom goals are set by a pace; Festive and Lean bulk by maintenance. */
function hasPace(template: GoalTemplate | undefined): boolean {
  return template === 'cut' || template === 'custom';
}

/** "N weeks of data": 21–27 complete days → 3, 28 → 4 (S40 "based on 3 weeks of data"). */
export function weeksOfData(daysUsed: number): number {
  return Math.max(3, Math.floor(daysUsed / 7));
}

/**
 * When "tomorrow" starts. Between midnight and the rollover, tomorrow is already the calendar
 * day, so it starts "at 5am (Sat)" rather than "tomorrow (Sat)".
 */
export function startsWhen(today: LogicalDay, now: Date, tz: string, rolloverHour: number): { long: string; short: string } {
  const weekday = fmtWeekday(addDays(today, 1));
  if (zonedParts(now, tz).hour < rolloverHour) {
    const time = fmtClock(rolloverHour * 60, { compact: true });
    return { long: `at ${time} (${weekday})`, short: time };
  }
  return { long: `tomorrow (${weekday})`, short: 'tomorrow' };
}

export function screenTitle(view: Pick<TargetView, 'check'>): 'Target suggestion' | 'Your target' {
  return view.check.kind === 'suggestion' || view.check.kind === 'kept' ? 'Target suggestion' : 'Your target';
}

/** "This week: 5 days at 1,800 + 2 days at 1,550 = 12,100 kcal"; nothing on a Sunday. */
export function weekLineOf(week: ProratedWeek | undefined): string | undefined {
  if (!week?.sameWeek || week.groups.length === 0) return undefined;
  const parts = week.groups.map((g) => `${plural(g.days, 'day')} at ${fmtInt(g.kcal)}`);
  return `This week: ${parts.join(' + ')} = ${fmtInt(week.totalKcal)} kcal`;
}

/** "−0.25 kg", "+0.1 kg", "0 kg". */
function signedRate(kgPerWeek: number): string {
  const text = fmtKgRate(kgPerWeek);
  return Math.round(kgPerWeek * 20) > 0 ? `+${text}` : text;
}

function workingRows(estimate: MaintenanceEstimate): TargetWorkingRow[] {
  const rows: TargetWorkingRow[] = [{ label: 'Logged', value: `${fmtApprox(roundTo10(estimate.avgEatenKcal))} a day` }];
  const workouts = roundTo10(estimate.avgWorkoutKcal);
  if (workouts > 0) rows.push({ label: 'Workouts added', value: `${fmtSigned(-workouts)} a day` });
  // Losing 0.25 kg a week means eating ~275 a day under maintenance.
  const energy = roundTo5((-estimate.trendKgPerWeek / 7) * KCAL_PER_KG);
  rows.push({ label: 'Trend', value: `${signedRate(estimate.trendKgPerWeek)} a week ≈ ${fmtSigned(energy)} a day` });
  rows.push({ label: 'Maintenance', value: `${fmtApprox(estimate.maintenanceKcal)} a day`, strong: true });
  return rows;
}

type Clocked = Pick<TargetView, 'today' | 'tz' | 'rolloverHour'>;

/**
 * When the estimate can change: the weekly read holds until next Monday, but the daily read
 * (before the weekly one is possible) moves on at every rollover.
 */
function checkedAgain(estimate: MaintenanceEstimate, view: Clocked, now: Date): string {
  if (estimate.basis === 'weekly') return `Checked again on ${fmtDayShort(estimate.nextCheckOn)}.`;
  const { short } = startsWhen(view.today, now, view.tz, view.rolloverHour);
  return short === 'tomorrow' ? 'Checked again tomorrow.' : `Checked again at ${short}.`;
}

function basisOf(estimate: MaintenanceEstimate, again: string): string {
  const { window } = estimate;
  return (
    `From ${plural(estimate.daysUsed, 'complete day')}, ${fmtDayShort(window.from)} to ${fmtDayShort(window.to)}. ` +
    `Days with a guess, not counted or not confirmed are left out. ${again}`
  );
}

type Proposed = Extract<TargetCheck, { kind: 'suggestion' | 'kept' }>;

function targetNote(check: Proposed, values: TargetOptionValues): string {
  const { template, dailyMinimumKcal, surplusKcal } = check.current;
  if (template === 'festive') return 'Festive maintain eats at your maintenance.';
  if (template === 'leanBulk') return `Your maintenance plus your ${fmtInt(surplusKcal ?? DEFAULT_SURPLUS_KCAL)} kcal surplus.`;
  const pace = `At your ${fmtKgRate(values.paceKgPerWeek)} a week pace`;
  return values.atMinimum
    ? `${pace} it would be ${fmtInt(values.rawDailyKcal)}, so it stays at your ${fmtInt(dailyMinimumKcal)} minimum.`
    : `${pace}, never below your ${fmtInt(dailyMinimumKcal)} minimum.`;
}

export interface TargetCardModel {
  /** Everything the card shows; the screen adds the handlers and `busy`. */
  props: Omit<TargetSuggestionCardProps, 'onApprove' | 'onKeep' | 'onDetails' | 'slowerPace' | 'busy' | 'className'>;
  /** "0.25 kg a week → 1,825 a day" when there is a slower pace. */
  slowerDetail?: string;
  /** What the user saw, for the stale check in the actions. */
  choices: { suggested: TargetChoice; slowerPace?: TargetChoice };
  kept: boolean;
}

/** The C45 card for a waiting (or kept) suggestion; undefined otherwise. */
export function targetCardModel(view: TargetView, opts: { now: Date; variant: 'compact' | 'full' }): TargetCardModel | undefined {
  const { check } = view;
  if (check.kind !== 'suggestion' && check.kind !== 'kept') return undefined;
  const { current, estimate, proposal } = check;
  const full = opts.variant === 'full';
  const when = startsWhen(view.today, opts.now, view.tz, view.rolloverHour).long;
  const newWeek = weekdayIndex(view.today) === SUNDAY ? ', with the new week' : '';

  const props: TargetCardModel['props'] = {
    variant: opts.variant,
    meta: `Based on ${plural(weeksOfData(estimate.daysUsed), 'week')}`,
    headline: `Your real maintenance looks like ${fmtApprox(estimate.maintenanceKcal)}, not ${fmtInt(current.maintenanceKcal)}`,
    working: maintenanceWorking(estimate),
    currentKcal: fmtInt(current.dailyKcal),
    suggestedKcal: fmtInt(proposal.suggested.dailyKcal),
    targetNote: targetNote(check, proposal.suggested),
    startsNote: full ? `Starts ${when}${newWeek}. Today and earlier days keep their target.` : `Starts ${when} if you approve.`,
  };
  if (full) {
    props.workingRows = workingRows(estimate);
    props.basis = basisOf(estimate, checkedAgain(estimate, view, opts.now));
    const weekLine = weekLineOf(view.week?.suggested);
    if (weekLine) props.weekLine = weekLine;
  }
  if (check.kind === 'kept') {
    props.keptNote =
      `You kept ${fmtInt(current.dailyKcal)} on ${fmtDayShort(check.kept.keptOn)}. ` +
      `The suggestion comes back on ${fmtDayShort(check.kept.until)}, or sooner if your maintenance moves by more than 100 kcal.`;
  }

  const model: TargetCardModel = {
    props,
    choices: { suggested: { versionId: current.versionId, option: 'suggested', dailyKcal: proposal.suggested.dailyKcal } },
    kept: check.kind === 'kept',
  };
  const slower = proposal.slowerPace;
  if (slower) {
    model.slowerDetail = `${fmtKgRate(slower.paceKgPerWeek)} a week → ${fmtInt(slower.dailyKcal)} a day${slower.atMinimum ? ' (your minimum)' : ''}`;
    model.choices.slowerPace = { versionId: current.versionId, option: 'slowerPace', dailyKcal: slower.dailyKcal };
  }
  return model;
}

export interface TargetStatusModel {
  headline: string;
  body: string;
  /** The working sentence, when there is an estimate. */
  working?: string;
  caption?: string;
  progress?: { label: string; have: number; need: number };
  action?: { label: string; to: string };
}

/**
 * The S37 card for every state without a suggestion to decide on. Undefined for a suggestion
 * (or a kept one), and while an approved target waits to start (the pending card says it all).
 */
export function statusModel(view: Pick<TargetView, 'check' | 'pending'> & Clocked, now: Date): TargetStatusModel | undefined {
  const { check } = view;
  switch (check.kind) {
    case 'suggestion':
    case 'kept':
      return undefined;
    case 'noTarget':
      if (check.reason === 'paused') return { headline: 'Your goal is paused', body: "There's no target to adjust while it's paused." };
      if (check.reason === 'switching') return { headline: 'Your goal changes tomorrow', body: 'Suggestions start again once the new goal is running.' };
      return { headline: 'No target yet', body: 'Finish setup to get a daily target.' };
    case 'tooEarly':
      return {
        headline: `Your real maintenance unlocks after ${fmtInt(check.needDays)} complete days`,
        progress: { label: 'Complete days in the last 4 weeks', have: check.completeDays, need: check.needDays },
        body:
          'The app compares what you log with your weight trend. ' +
          `Until then, your ${fmtInt(check.current.dailyKcal)} target uses the maintenance estimate of ${fmtApprox(check.current.maintenanceKcal)}.`,
        caption: "Days with a guess, not counted or not confirmed don't count.",
      };
    case 'needWeighIns': {
      const action = { label: 'Log a weigh-in', to: PATHS.weight };
      const headline = 'Your trend needs a few more weigh-ins';
      if (check.weighIns < check.needWeighIns || !check.firstWeighIn) {
        return {
          headline,
          body:
            `${fmtInt(check.weighIns)} of ${fmtInt(check.needWeighIns)} weigh-ins in the last 4 weeks. ` +
            "Weigh in most mornings and the trend shows which way you're heading.",
          action,
        };
      }
      // 14 days reads "2 weeks"; a trend that started over needs 17 (TREND_SETTLE_DAYS), said in days.
      const span = check.needSpanDays % 7 === 0 ? plural(check.needSpanDays / 7, 'week') : plural(check.needSpanDays, 'day');
      return {
        headline,
        body: `Your weigh-ins start on ${fmtDayShort(check.firstWeighIn)}. The trend needs ${span} of them to show a direction.`,
        action,
      };
    }
    case 'onTrack': {
      if (view.pending) return undefined;
      const { estimate, current } = check;
      const working = maintenanceWorking(estimate);
      const caption = checkedAgain(estimate, view, now);
      const real = `Your real maintenance looks like ${fmtApprox(estimate.maintenanceKcal)}`;
      if (check.sameTarget && check.atMinimum) {
        return {
          headline: `Your target stays at your ${fmtInt(current.dailyMinimumKcal)} minimum`,
          body:
            `${real}, not ${fmtInt(current.maintenanceKcal)}. ` +
            `At your ${fmtKgRate(current.paceKgPerWeek)} a week pace the target would be ${fmtInt(check.rawDailyKcal)}, under your ${fmtInt(current.dailyMinimumKcal)} daily minimum.`,
          working,
          caption,
        };
      }
      if (check.sameTarget) {
        return {
          headline: 'Your target fits your real maintenance',
          body: `${real}, and your ${fmtInt(current.dailyKcal)} target stays the same.`,
          working,
          caption,
        };
      }
      return {
        headline: 'Your target fits your real maintenance',
        body: `${real}, close to the ${fmtInt(current.maintenanceKcal)} your target uses. Nothing to change.`,
        working,
        caption,
      };
    }
  }
}

export interface PendingModel {
  /** "New target 1,550 starts tomorrow (Sat)". */
  headline: string;
  /** "Today and earlier days keep 1,800." (+ " Pace becomes 0.25 kg a week."). */
  body: string;
  weekLine?: string;
  /** "Keep 1,800 instead": only for an approved suggestion. */
  cancelLabel?: string;
}

/** The target that starts tomorrow, until the rollover. */
export function pendingModel(view: TargetView, now: Date): PendingModel | undefined {
  const { pending, current, goal } = view;
  if (!pending) return undefined;
  const when =
    pending.effectiveFrom === addDays(view.today, 1)
      ? startsWhen(view.today, now, view.tz, view.rolloverHour).long
      : `on ${fmtDayShort(pending.effectiveFrom)}`;
  let body = current ? `Today and earlier days keep ${fmtInt(current.dailyKcal)}.` : 'Today and earlier days keep their target.';
  if (goal && current) {
    const pace = paceOf(goal, pending);
    if (Math.abs(pace - paceOf(goal, current)) > 1e-9) body += ` Pace becomes ${fmtKgRate(pace)} a week.`;
  }
  const model: PendingModel = { headline: `New target ${fmtInt(pending.dailyKcal)} starts ${when}`, body };
  const weekLine = weekLineOf(view.week?.pending);
  if (weekLine) model.weekLine = weekLine;
  if (pending.reason === 'approvedSuggestion' && current) model.cancelLabel = `Keep ${fmtInt(current.dailyKcal)} instead`;
  return model;
}

const REASON: Record<GoalVersion['reason'], string> = {
  setup: 'starting estimate',
  approvedSuggestion: 'approved suggestion',
  manualEdit: 'edited by you',
};

export interface TargetHistoryItem {
  key: string;
  /** "1,800 a day". */
  title: string;
  /** "Since Mon 7 Sep · starting estimate · maintenance ~2,350 · 0.5 kg a week". */
  sub: string;
  badge?: { tone: 'accent' | 'neutral'; label: string; icon: 'now' | 'starts' };
}

/**
 * Every target version of the goal, newest first. `inForce: false` (S42 for a goal that isn't
 * running today) gives its latest target no "Now" badge and reads "From …" instead of "Since …".
 */
export function historyRows(view: Pick<TargetView, 'history' | 'goal' | 'today'>, opts: { inForce?: boolean } = {}): TargetHistoryItem[] {
  const withPace = hasPace(view.goal?.template);
  const inForce = opts.inForce ?? true;
  return view.history.map((row) => {
    const { version } = row;
    const from = fmtDayShort(version.effectiveFrom);
    const when =
      row.state === 'current'
        ? `${inForce ? 'Since' : 'From'} ${from}`
        : row.state === 'past' && row.until
          ? `${from} to ${fmtDayShort(row.until)}`
          : `From ${from}`;
    const parts = [when, REASON[version.reason], `maintenance ${fmtApprox(version.maintenanceKcal)}`];
    if (withPace) parts.push(`${fmtKgRate(row.paceKgPerWeek)} a week`);
    const item: TargetHistoryItem = { key: version.id, title: `${fmtInt(version.dailyKcal)} a day`, sub: parts.join(' · ') };
    if (row.state === 'current' && inForce) item.badge = { tone: 'accent', label: 'Now', icon: 'now' };
    if (row.state === 'pending') {
      const day = daysBetween(view.today, version.effectiveFrom) < 7 ? fmtWeekday(version.effectiveFrom) : fmtDayShort(version.effectiveFrom);
      item.badge = { tone: 'neutral', label: `Starts ${day}`, icon: 'starts' };
    }
    return item;
  });
}

/** The toast after a decision: "Target 1,550 from tomorrow", "Target stays at 1,800". */
export function decisionToast(
  kind: 'approve' | 'slowerPace' | 'keep' | 'cancel',
  values: { kcal: number; paceKgPerWeek?: number; when?: string },
): string {
  const when = values.when ?? 'tomorrow';
  switch (kind) {
    case 'approve':
      return `Target ${fmtInt(values.kcal)} from ${when}`;
    case 'slowerPace':
      return `${fmtKgRate(values.paceKgPerWeek ?? 0)} a week, target ${fmtInt(values.kcal)} from ${when}`;
    case 'keep':
    case 'cancel':
      return `Target stays at ${fmtInt(values.kcal)}`;
  }
}
