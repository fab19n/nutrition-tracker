/**
 * Copy for "Your plan" (Insights › Your plan) and its card on Insights: every sentence and number
 * the screen shows, worked out from a PlanProgress. Pure, so the wording is tested without
 * rendering. Neutral by design: a reading is not a verdict, so nothing is amber for being behind.
 */
import type { MetricTone } from '@/components/MetricTile/MetricTile';
import { addDays } from '@/domain/day';
import { fmtDateYear, fmtDayRange, fmtDayShort, fmtInt, fmtKg, fmtKgDelta, fmtKgRate, roundTo10 } from '@/domain/format';
import { CHECK_AGREE_KCAL, type PlanCheck, type PlanProgress, type PlanWeight } from '@/domain/plan';
import type { Goal, GoalVersion, LogicalDay } from '@/domain/types';

/** What the model needs of a PlanView (src/db/planProgress.ts); the view satisfies it as is. */
export interface PlanModelInput {
  goal: Pick<Goal, 'name' | 'template'>;
  version: Pick<GoalVersion, 'dailyKcal'>;
  start: LogicalDay;
  paused: boolean;
  /** The plan's pace today (positive = losing). */
  paceKgPerWeek: number;
  progress: PlanProgress;
}

export interface PlanTile {
  label: string;
  value: string;
  sub?: string;
  tone: MetricTone;
}

export interface PlanRow {
  label: string;
  sub?: string;
  value: string;
  tone?: 'good' | 'over' | 'muted';
}

// ---------------------------------------------------------------------------
// Small wording helpers
// ---------------------------------------------------------------------------

function daysText(n: number): string {
  return n === 1 ? '1 day' : `${fmtInt(n)} days`;
}

/** "9 days", "4 weeks": days up to two weeks, then whole weeks. */
export function spanText(days: number): string {
  return days < 14 ? daysText(days) : `${fmtInt(Math.round(days / 7))} weeks`;
}

/** "−0.5 kg a week" for a cut, "+0.25 kg a week" for a gain, "hold steady" for 0. */
export function paceText(paceKgPerWeek: number): string {
  if (paceKgPerWeek === 0) return 'hold steady';
  // The plan's pace is positive for losing; as a change of weight it reads the other way round.
  const change = fmtKgRate(-paceKgPerWeek);
  return `${change.startsWith('−') ? change : `+${change}`} a week`;
}

/** 2,300 → "2,300 under"; −400 → "400 over". */
function underOver(kcal: number): { text: string; tone: 'good' | 'over' } {
  const whole = Math.round(kcal);
  return whole >= 0 ? { text: `${fmtInt(whole)} under`, tone: 'good' } : { text: `${fmtInt(-whole)} over`, tone: 'over' };
}

/** 0.3 → "about 0.3 kg"; anything under 0.05 → "less than 0.1 kg" instead of a lone "0.0 kg". */
export function kgText(kg: number): string {
  return kg < 0.05 ? 'less than 0.1 kg' : `about ${kg.toFixed(1)} kg`;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

// ---------------------------------------------------------------------------
// Weight
// ---------------------------------------------------------------------------

export interface PlanWeightModel {
  headline: string;
  tone: MetricTone;
  note: string;
  tiles: PlanTile[];
  chart?: { startLabel: string; endLabel: string; ariaLabel: string };
  end?: { title: string; lines: string[] };
}

function verdictCopy(w: PlanWeight): { headline: string; tone: MetricTone; note: string } {
  const gap = Math.abs(w.behindKg ?? 0);
  const hold = w.paceKgPerWeek === 0;
  switch (w.verdict) {
    case 'noData':
      return { headline: 'No weigh-ins yet', tone: 'neutral', note: 'Weigh in a few times and your trend will show here, drawn against your plan.' };
    case 'early':
      return {
        headline: 'Too early to say',
        tone: 'neutral',
        note: `${fmtInt(w.weighInDays)} ${plural(w.weighInDays, 'weigh-in', 'weigh-ins')} over ${daysText(w.trendDays)} so far. A trend needs about two weeks of weigh-ins before it says much.`,
      };
    case 'onTrack':
      return hold
        ? { headline: 'Holding steady', tone: 'good', note: 'Your plan is to hold your weight, and your trend is close to flat.' }
        : { headline: 'On track', tone: 'good', note: "Your weight trend is close to the line your plan draws." };
    case 'ahead':
      return { headline: `${fmtKg(gap)} ahead of plan`, tone: 'good', note: 'Your weight trend is past the line your plan draws.' };
    case 'behind':
      return {
        headline: `${fmtKg(gap)} behind plan`,
        tone: 'neutral',
        note: "Your weight trend is short of the line your plan draws. Weight moves slowly and noisily, so read this over weeks. The check below shows whether your logs explain it.",
      };
    case 'drifting':
      return {
        headline: `${(w.changeKg ?? 0) > 0 ? 'Up' : 'Down'} ${fmtKg(Math.abs(w.changeKg ?? 0))}`,
        tone: 'neutral',
        note: 'Your plan is to hold your weight, so its line is flat. Your trend has moved away from where you started.',
      };
  }
}

function weightModel(input: PlanModelInput): PlanWeightModel {
  const { progress, paceKgPerWeek } = input;
  const w = progress.weight;
  const copy = verdictCopy(w);
  const tiles: PlanTile[] = [];
  if (w.changeKg !== undefined && w.nowKg !== undefined) {
    tiles.push({ label: 'Your trend', value: fmtKgDelta(w.changeKg), sub: `${fmtKg(w.nowKg)} now`, tone: 'neutral' });
    tiles.push({
      label: 'Plan expects',
      value: fmtKgDelta(w.expectedChangeKg ?? 0),
      sub: `over ${spanText(w.trendDays)}`,
      tone: 'neutral',
    });
    tiles.push({
      label: 'Pace a week',
      value: w.actualPaceKgPerWeek === undefined ? '—' : fmtKgRate(-w.actualPaceKgPerWeek),
      sub: `plan ${paceText(paceKgPerWeek).replace(' a week', '')}`,
      tone: 'neutral',
    });
  }

  const model: PlanWeightModel = { ...copy, tiles };
  if (w.actual.length >= 2 && w.nowKg !== undefined) {
    const side = w.behindKg === undefined || w.verdict === 'early' ? '' : w.verdict === 'onTrack' ? ', close to the plan' : `, ${fmtKg(Math.abs(w.behindKg))} ${w.behindKg > 0 ? 'short of' : 'past'} the plan`;
    model.chart = {
      startLabel: fmtDayShort(input.start),
      endLabel: 'today',
      ariaLabel: `Weight trend ${fmtKg(w.nowKg)}${side}.`,
    };
  }
  if (w.end) {
    if (w.end.reached) {
      model.end = { title: `Reached ${fmtKg(w.end.targetKg)}`, lines: ['Your trend is at or past the end weight you set.'] };
    } else {
      const lines = [`${fmtKg(w.end.kgToGo)} to go`];
      if (w.end.atPlanPace) lines.push(`At your plan's pace: around ${fmtDateYear(w.end.atPlanPace)}`);
      lines.push(w.end.atCurrentPace ? `At your pace now: around ${fmtDateYear(w.end.atCurrentPace)}` : "At your pace now: your trend isn't moving that way yet");
      model.end = { title: `Towards ${fmtKg(w.end.targetKg)}`, lines };
    }
  }
  return model;
}

// ---------------------------------------------------------------------------
// Energy and workouts
// ---------------------------------------------------------------------------

export interface PlanEnergyModel {
  note: string;
  empty?: string;
  tiles: PlanTile[];
  weeks: PlanRow[];
}

function energyModel(progress: PlanProgress): PlanEnergyModel {
  const e = progress.energy;
  const note = "Each finished day you logged as complete or as a guess is measured against its budget: your target plus any workouts and one-off bonus.";
  if (e.countedDays === 0) {
    return { note, empty: "No finished days to count yet. Days you log as complete (or as a guess) show here once they're over.", tiles: [], weeks: [] };
  }
  const result = underOver(e.underKcal);
  const tiles: PlanTile[] = [
    { label: 'Counted', value: `${fmtInt(e.countedDays)} of ${fmtInt(progress.daysIn)}`, sub: 'finished days', tone: 'neutral' },
    { label: 'Within budget', value: `${fmtInt(e.withinBudgetDays)} of ${fmtInt(e.countedDays)}`, sub: 'days', tone: 'neutral' },
    {
      label: 'Result',
      value: fmtInt(Math.abs(e.underKcal)),
      sub: `${e.underKcal >= 0 ? 'under' : 'over'} · ${kgText(Math.abs(e.underKg))}`,
      tone: result.tone,
    },
  ];
  const weeks: PlanRow[] = e.weeks.map((w) => {
    const r = underOver(w.underKcal);
    const days = `${fmtInt(w.countedDays)} ${plural(w.countedDays, 'day', 'days')}`;
    return {
      label: fmtDayRange(w.weekStart, addDays(w.weekStart, 6)),
      sub: w.workoutKcal > 0 ? `${days} · +${fmtInt(roundTo10(w.workoutKcal))} from workouts` : days,
      value: r.text,
      tone: r.tone,
    };
  });
  return { note, tiles, weeks };
}

export interface PlanWorkoutsModel {
  note: string;
  empty?: string;
  rows: PlanRow[];
}

function workoutsModel(progress: PlanProgress): PlanWorkoutsModel {
  const w = progress.workouts;
  const note =
    "A workout adds its estimated net burn to that day's budget. The estimate comes from the activity, time, intensity and your weight, so if your weight isn't moving the way your logs say, workouts are a good place to look.";
  if (progress.energy.countedDays === 0 || w.addedKcal === 0) {
    return {
      note,
      empty:
        progress.energy.countedDays === 0
          ? "Nothing to compare yet. Once finished days are counted, this shows what your workouts added."
          : 'No workouts logged on the days counted so far. A workout you log adds its net burn to that day\'s budget.',
      rows: [],
    };
  }
  const withW = underOver(w.underWithKcal);
  const without = underOver(w.underWithoutKcal);
  const pct = w.shareOfBudget * 100;
  const share = pct < 1 ? '<1%' : `${Math.round(pct)}%`;
  return {
    note,
    rows: [
      {
        label: 'Added to your budgets',
        sub: `${fmtInt(w.days)} workout ${plural(w.days, 'day', 'days')} · about ${fmtInt(roundTo10(w.perWeekKcal))} a week`,
        value: `+${fmtInt(w.addedKcal)}`,
      },
      { label: 'Share of your budgets', sub: 'of all the kcal you were allowed', value: share },
      { label: 'Result, workouts counted', value: withW.text, tone: withW.tone },
      { label: 'Same days, no workouts', value: without.text, tone: without.tone },
    ],
  };
}

// ---------------------------------------------------------------------------
// Logs against weight
// ---------------------------------------------------------------------------

export interface PlanCheckModel {
  state: PlanCheck['state'];
  /** "Early read · 16 complete days" while it is not yet firm. */
  badge?: string;
  headline: string;
  body: string;
  /** 0–1 while locked. */
  progress?: number;
  rows: PlanRow[];
  extras: string[];
}

/** "550 under" / "150 over", to the nearest 10, as a deficit against maintenance. */
function deficitText(kcal: number): string {
  return underOver(roundTo10(kcal)).text;
}

function gapPhrase(gap: number): string {
  const n = fmtInt(roundTo10(Math.abs(gap)));
  if (Math.abs(gap) < CHECK_AGREE_KCAL) return 'close to agreement';
  return gap > 0 ? `${n} kcal a day more deficit in your logs than on the scale` : `${n} kcal a day more loss on the scale than your logs show`;
}

function checkModel(progress: PlanProgress): PlanCheckModel {
  const c = progress.check;
  const headline = 'Do your logs match your weight?';
  if (c.state === 'locked') {
    return {
      state: 'locked',
      headline,
      body: `This check compares the deficit your logs imply with the one your weight trend implies. It unlocks after ${fmtInt(c.needDays)} complete days with weigh-ins. You have ${fmtInt(Math.min(c.completeDays, c.needDays))} so far.`,
      progress: Math.min(1, c.completeDays / c.needDays),
      rows: [],
      extras: [],
    };
  }
  const logged = c.loggedDeficitKcal ?? 0;
  const weight = c.weightDeficitKcal ?? 0;
  const gap = c.gapKcal ?? 0;
  const body =
    c.read === 'agree'
      ? 'They agree within 150 kcal a day: your logs and your weight are telling the same story.'
      : c.read === 'logsAhead'
        ? 'Your logs show a bigger deficit than your weight does. Usual reasons: portions a little larger than estimated, foods not logged, workout estimates on the high side, or a maintenance estimate that is too high.'
        : 'Your weight is falling faster than your logs say. Usual reasons: portions logged larger than they were, or a maintenance estimate that is too low.';
  const extras: string[] = [];
  if ((c.workoutKcalPerDay ?? 0) >= 20) {
    extras.push(`Workouts supply about ${fmtInt(roundTo10(c.workoutKcalPerDay ?? 0))} kcal a day of the deficit your logs imply.`);
    if (c.gapHalfWorkoutsKcal !== undefined) extras.push(`If only half of each workout counted, the gap would be ${gapPhrase(c.gapHalfWorkoutsKcal)}.`);
  }
  extras.push('Weight moves slowly and noisily, so read this over weeks, not days. It never changes your target; the target check does that, and you approve it.');
  return {
    state: c.state,
    ...(c.state === 'early' ? { badge: `Early read · ${fmtInt(c.completeDays)} complete days` } : {}),
    headline,
    body,
    rows: [
      { label: 'Your logs imply', sub: 'kcal a day against maintenance, workouts counted', value: deficitText(logged) },
      { label: 'Your weight trend implies', sub: 'kcal a day, from your trend of the last weeks', value: deficitText(weight) },
      { label: 'Gap', sub: 'kcal a day, logs minus weight', value: `${fmtInt(roundTo10(Math.abs(gap)))}`, tone: c.read === 'agree' ? 'good' : 'muted' },
    ],
    extras,
  };
}

// ---------------------------------------------------------------------------
// The screen and the card
// ---------------------------------------------------------------------------

export interface PlanScreenModel {
  name: string;
  since: string;
  facts: string[];
  paused: boolean;
  weight: PlanWeightModel;
  energy: PlanEnergyModel;
  workouts: PlanWorkoutsModel;
  check: PlanCheckModel;
}

export function planScreenModel(input: PlanModelInput): PlanScreenModel {
  const { progress } = input;
  const since = progress.daysIn === 0 ? `Starts today · ${fmtDateYear(input.start)}` : `Since ${fmtDateYear(input.start)} · ${spanText(progress.daysIn)} in`;
  return {
    name: input.goal.name,
    since,
    facts: input.paused ? [] : [`Target ${fmtInt(input.version.dailyKcal)} kcal a day`, `Plan ${paceText(input.paceKgPerWeek)}`],
    paused: input.paused,
    weight: weightModel(input),
    energy: energyModel(progress),
    workouts: workoutsModel(progress),
    check: checkModel(progress),
  };
}

export interface PlanCardModel {
  label: string;
  title: string;
  sub: string;
}

/** The one-line card on Insights that opens the plan. */
export function planCardModel(input: PlanModelInput): PlanCardModel {
  const w = input.progress.weight;
  if (input.paused) return { label: 'Your plan', title: 'Paused', sub: 'No budget or pace while this goal is paused' };
  if (w.verdict === 'noData' || w.changeKg === undefined) {
    return { label: 'Your plan', title: 'See where you stand', sub: 'Weigh in to draw your trend against the plan' };
  }
  const copy = verdictCopy(w);
  return { label: 'Your plan', title: copy.headline, sub: `Trend ${fmtKgDelta(w.changeKg)} · plan ${fmtKgDelta(w.expectedChangeKg ?? 0)}` };
}
