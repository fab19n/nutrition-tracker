/**
 * Pure helpers that turn the Today read models (hooks) into what the S08 components show.
 * No budget or timing maths here: the numbers come from the hooks; these pick the words.
 */
import type { HeroCardProps } from '@/components/HeroCard/HeroCard';
import type { WeekBar, WeekBarsProps } from '@/components/WeekBars/WeekBars';
import type { GoalEndView } from '@/db/goals';
import type { ActiveGoal, CheckIn, FestiveDaysInRange, ProteinLeft, WeekBudgetView } from '@/db/selectors';
import type { BudgetDay, WeekBudget } from '@/domain/budget';
import { addDays, compareDays, daysBetween, wallToLogicalMinutes, weekdayIndex } from '@/domain/day';
import {
  fmtDayLetter,
  fmtDayShort,
  fmtGrams,
  fmtInt,
  fmtKcal,
  fmtKg,
  fmtRange,
  fmtSigned,
  fmtTime,
  fmtWeekday,
} from '@/domain/format';
import type { TargetCheck } from '@/domain/maintenance';
import type { SlotBaselines } from '@/domain/timing';
import type { Instant, LogicalDay, MealLog, MealSlot } from '@/domain/types';
import { weeksOfData } from '@/screens/Insights/targetModel';

// ---------------------------------------------------------------------------
// Goal pill
// ---------------------------------------------------------------------------

/** C03 copy: "Cut · 1,800", "Lean bulk · 130g", "Festive · 2,100", "Paused until Mon". */
export function goalPillLabel(active: Pick<ActiveGoal, 'goal' | 'version' | 'period'>, today: LogicalDay): string {
  const { goal, version, period } = active;
  switch (goal.template) {
    case 'pause': {
      if (!period.to) return 'Paused';
      const until = daysBetween(today, period.to) < 7 ? fmtWeekday(period.to) : fmtDayShort(period.to);
      return `Paused until ${until}`;
    }
    case 'leanBulk':
      return `Lean bulk · ${fmtGrams(version.proteinG)}`;
    case 'festive':
      return `Festive · ${fmtInt(version.dailyKcal)}`;
    default:
      return goal.heroMetric === 'proteinLeft'
        ? `${goal.name} · ${fmtGrams(version.proteinG)}`
        : `${goal.name} · ${fmtInt(version.dailyKcal)}`;
  }
}

// ---------------------------------------------------------------------------
// Hero card (C07)
// ---------------------------------------------------------------------------

/** "Near": 10% or less of today's allowance left. */
export const NEAR_SHARE = 0.1;

export type HeroFigures = Pick<
  HeroCardProps,
  'label' | 'value' | 'valueTone' | 'note' | 'noteTone' | 'savedLabel' | 'savedTone' | 'leftWeekLabel'
> & {
  /** Start of the card's accessible name: "570 kcal left today." */
  spoken: string;
};

type MainFigure = Pick<HeroFigures, 'label' | 'value' | 'valueTone' | 'note' | 'noteTone' | 'spoken'>;

function hasDaysAhead(budget: WeekBudget): boolean {
  return budget.days.some((d) => !d.isFinished && !d.isToday && d.kind !== 'paused');
}

function kcalFigure(budget: WeekBudget): MainFigure {
  const base = budget.todayBaseKcal;
  const left = budget.leftTodayKcal;
  if (left < 0) {
    const over = budget.overTodayKcal;
    let note: string;
    if (budget.coveredBySavings) note = `Covered by your ${fmtSigned(budget.savedKcal)} saved`;
    else if (hasDaysAhead(budget) && budget.unabsorbedKcal === 0) note = 'The rest of the week adjusts to cover it';
    else note = 'Fresh start on Monday';
    return { label: 'Over today', value: fmtSigned(over), valueTone: 'over', note, noteTone: 'over', spoken: `${fmtInt(over)} kcal over today. ${note}.` };
  }
  if (base > 0 && left <= base * NEAR_SHARE) {
    const note = "Close to today's budget";
    return { label: 'Left today', value: fmtInt(left), valueTone: 'near', note, noteTone: 'over', spoken: `${fmtInt(left)} kcal left today. ${note}.` };
  }
  return { label: 'Left today', value: fmtInt(left), spoken: `${fmtInt(left)} kcal left today.` };
}

function proteinFigure(protein: ProteinLeft | undefined): MainFigure {
  const left = Math.max(0, protein?.leftG ?? 0);
  if (protein && protein.leftG <= 0) {
    return { label: 'Protein left', value: fmtGrams(0), note: 'Protein target reached', noteTone: 'muted', spoken: 'Protein target reached today.' };
  }
  return { label: 'Protein left', value: fmtGrams(left), spoken: `${fmtGrams(left)} protein left today.` };
}

function festiveFigure(festive: FestiveDaysInRange | undefined): MainFigure {
  if (!festive || festive.days === 0) {
    return { label: 'Days in range', value: '—', valueTone: 'muted', note: 'Counts from tomorrow', noteTone: 'muted', spoken: 'Days in range count from tomorrow.' };
  }
  const value = `${fmtInt(festive.inRange)} of ${fmtInt(festive.days)}`;
  const band =
    festive.lowKcal !== undefined && festive.highKcal !== undefined
      ? `In range: ${fmtRange({ low: festive.lowKcal, high: festive.highKcal })} kcal`
      : undefined;
  const figure: MainFigure = { label: 'Days in range', value, spoken: `${value} days in range.` };
  if (band) {
    figure.note = band;
    figure.noteTone = 'muted';
  }
  return figure;
}

const PAUSED: MainFigure = {
  label: 'Budget off',
  value: '—',
  valueTone: 'muted',
  note: 'Logging is optional this week',
  noteTone: 'muted',
  spoken: 'Budget off. Logging is optional this week.',
};

export interface HeroInput {
  view: Pick<WeekBudgetView, 'budget' | 'goal'>;
  paused: boolean;
  proteinLeft?: ProteinLeft;
  festive?: FestiveDaysInRange;
}

/** The figures for each goal: kcal left (Cut), protein left (Lean bulk), days in range (Festive), budget off (Pause). */
export function heroFigures({ view, paused, proteinLeft, festive }: HeroInput): HeroFigures {
  const { budget, goal } = view;
  let main: MainFigure;
  if (paused) main = PAUSED;
  else if (goal.heroMetric === 'proteinLeft') main = proteinFigure(proteinLeft);
  else if (goal.heroMetric === 'daysInRange') main = festiveFigure(festive);
  else main = kcalFigure(budget);

  // Savings held back on unconfirmed days, said honestly where there's room for it.
  if (!paused && !main.note && budget.pendingSavedKcal > 0) {
    main = { ...main, note: `${fmtSigned(budget.pendingSavedKcal)} waiting for check-in`, noteTone: 'muted' };
  }

  if (paused) return { ...main, savedLabel: '—', savedTone: 'neutral', leftWeekLabel: '—' };
  const saved = budget.savedKcal;
  return {
    ...main,
    savedLabel: fmtSigned(saved),
    savedTone: saved > 0 ? 'good' : saved < 0 ? 'over' : 'neutral',
    leftWeekLabel: fmtInt(budget.leftThisWeekKcal),
  };
}

/** The whole card's accessible name. */
export function heroAriaLabel(figures: HeroFigures, paused: boolean): string {
  if (paused) return `${figures.spoken} Opens the budget breakdown.`;
  return `${figures.spoken} Saved this week ${figures.savedLabel}. Left this week ${figures.leftWeekLabel}. Opens the budget breakdown.`;
}

// ---------------------------------------------------------------------------
// Week bars (C10)
// ---------------------------------------------------------------------------

function barFor(day: BudgetDay): WeekBar {
  const label = fmtDayLetter(day.day);
  switch (day.kind) {
    case 'today':
      return { label, kind: 'today', valueKcal: day.plannedKcal, fillKcal: day.eatenKcal, isToday: true };
    case 'planned':
    case 'makan':
      return { label, kind: day.kind, valueKcal: day.plannedKcal };
    case 'notCounted':
      // Counts as exactly its target.
      return { label, kind: 'notCounted', valueKcal: day.countedKcal };
    default:
      return { label, kind: day.kind, valueKcal: day.eatenKcal, isToday: day.isToday };
  }
}

function spokenBar(day: BudgetDay): string {
  const name = day.isToday ? 'today' : fmtWeekday(day.day);
  switch (day.kind) {
    case 'today':
      return `today ${fmtInt(day.eatenKcal)} of ${fmtInt(day.plannedKcal)}`;
    case 'makan':
      return `${name} makan day, ${fmtInt(day.plannedKcal)} room`;
    case 'planned':
      return `${name} ${fmtInt(day.plannedKcal)} planned`;
    case 'notCounted':
      return `${name} not counted`;
    case 'paused':
      return `${name} paused`;
    case 'over':
      return `${name} ${fmtInt(day.eatenKcal)}, over`;
    default:
      return `${name} ${fmtInt(day.eatenKcal)}`;
  }
}

export function weekBarsFor(view: Pick<WeekBudgetView, 'budget' | 'version'>, paused: boolean): WeekBarsProps {
  const days = view.budget.days;
  const anyBudget = days.some((d) => d.kind !== 'paused');
  return {
    bars: days.map(barFor),
    targetKcal: paused || !anyBudget ? null : view.version.dailyKcal,
    height: 64,
    ariaLabel: `This week: ${days.map(spokenBar).join(', ')}`,
  };
}

// ---------------------------------------------------------------------------
// Captions
// ---------------------------------------------------------------------------

/** "1,230 eaten · window closes 10:40pm"; "Nothing logged yet" before the first meal. */
export function eatenCaption(input: { mealCount: number; kcal: number; closesAt?: Instant; now: Date; tz: string }): string {
  if (input.mealCount === 0) return 'Nothing logged yet';
  const eaten = `${fmtInt(input.kcal)} eaten`;
  if (!input.closesAt) return eaten;
  const closed = Date.parse(input.closesAt) <= input.now.getTime();
  return `${eaten} · window ${closed ? 'closed' : 'closes'} ${fmtTime(input.closesAt, input.tz)}`;
}

/** The first Sat or Sun still ahead this week. */
export function nextWeekendDay(today: LogicalDay): LogicalDay | undefined {
  const index = weekdayIndex(today);
  if (index < 5) return addDays(today, 5 - index);
  if (index === 5) return addDays(today, 1);
  return undefined;
}

/** "Sat: 2,450 room" when a makan day is coming, else "Sat: not planned" for the next weekend day. */
export function makanCaption(budget: WeekBudget): string | undefined {
  const { makanDay, makanRoomKcal, today } = budget;
  if (makanDay && compareDays(makanDay, today) >= 0 && makanRoomKcal !== undefined) {
    const name = makanDay === today ? 'Today' : fmtWeekday(makanDay);
    return `${name}: ${fmtInt(makanRoomKcal)} room`;
  }
  const weekend = nextWeekendDay(today);
  return weekend ? `${fmtWeekday(weekend)}: not planned` : undefined;
}

// ---------------------------------------------------------------------------
// Meals: the next empty slot and the nudge
// ---------------------------------------------------------------------------

export const MAIN_SLOTS: readonly MealSlot[] = ['breakfast', 'lunch', 'dinner'];

/** A missed breakfast or lunch stops being offered this long after its usual time. */
export const SLOT_GRACE_MIN = 120;

const SLOT_WORD: Record<MealSlot, string> = {
  breakfast: 'breakfast',
  lunch: 'lunch',
  dinner: 'dinner',
  snack: 'snack',
  supper: 'supper',
};

/**
 * The next main slot (breakfast → lunch → dinner) to offer as an empty slot: after the last one
 * logged, skipping a breakfast or lunch whose usual time has long passed. Dinner stays until it's
 * logged. Undefined once dinner is in.
 */
export function nextMainSlot(
  meals: readonly Pick<MealLog, 'slot'>[],
  baselines: SlotBaselines,
  nowWallMinutes: number,
  rolloverHour: number,
): MealSlot | undefined {
  const lastLogged = MAIN_SLOTS.reduce((last, slot, i) => (meals.some((m) => m.slot === slot) ? i : last), -1);
  const candidates = MAIN_SLOTS.slice(lastLogged + 1);
  const nowLogical = wallToLogicalMinutes(nowWallMinutes, rolloverHour);
  const open = candidates.find((slot) => {
    const usual = wallToLogicalMinutes(baselines[slot].medianMin, rolloverHour);
    return usual + SLOT_GRACE_MIN >= nowLogical;
  });
  return open ?? candidates[candidates.length - 1];
}

/** "Protein is behind: ~68g left. A protein-heavy dinner helps." → "Dinner logged. Window closes 10:40pm." */
export function nudgeLine(input: {
  meals: readonly Pick<MealLog, 'slot'>[];
  proteinBehind: boolean;
  proteinLeftG: number;
  nextSlot?: MealSlot;
  closesAt?: Instant;
  now: Date;
  tz: string;
}): string | undefined {
  if (input.meals.some((m) => m.slot === 'dinner')) {
    const open = input.closesAt !== undefined && Date.parse(input.closesAt) > input.now.getTime();
    return open && input.closesAt ? `Dinner logged. Window closes ${fmtTime(input.closesAt, input.tz)}.` : 'Dinner logged.';
  }
  if (input.meals.length > 0 && input.proteinBehind && input.nextSlot && input.proteinLeftG > 0) {
    return `Protein is behind: ~${fmtGrams(input.proteinLeftG)} left. A protein-heavy ${SLOT_WORD[input.nextSlot]} helps.`;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Sleep tap (C61)
// ---------------------------------------------------------------------------

/** Without any sleep taps yet, the button shows from 10pm. */
export const DEFAULT_SLEEP_FROM_WALL_MIN = 22 * 60;
/** With a usual sleep time, it shows from an hour before it. */
export const SLEEP_LEAD_MIN = 60;

/** Evenings near your usual sleep time; both in minutes since the rollover. */
export function sleepTapVisible(nowLogicalMin: number, usualSleepLogicalMin: number | null, rolloverHour: number): boolean {
  const from =
    usualSleepLogicalMin === null
      ? wallToLogicalMinutes(DEFAULT_SLEEP_FROM_WALL_MIN, rolloverHour)
      : Math.max(0, usualSleepLogicalMin - SLEEP_LEAD_MIN);
  return nowLogicalMin >= from;
}

// ---------------------------------------------------------------------------
// Check-in banner (C06)
// ---------------------------------------------------------------------------

export interface CheckInBannerCopy {
  tone: 'amber' | 'neutral';
  /** Bold lead: "Yesterday looks incomplete." */
  lead: string;
  /** "2 meals, 1,240 kcal." */
  rest: string;
}

function mealCount(n: number): string {
  return n === 1 ? '1 meal' : `${fmtInt(n)} meals`;
}

/** Amber when the day looks incomplete, a lighter neutral note when it only needs confirming. */
export function checkInBanner(checkIn: CheckIn, today: LogicalDay): CheckInBannerCopy | undefined {
  if (!checkIn.needed) return undefined;
  const isYesterday = checkIn.day === addDays(today, -1);
  const name = isYesterday ? 'Yesterday' : fmtDayShort(checkIn.day);
  const more = checkIn.queue.length - 1;
  const moreText = more > 0 ? ` ${fmtInt(more)} more ${more === 1 ? 'day' : 'days'} to check.` : '';
  const count = checkIn.meals.length;
  if (count === 0) {
    return { tone: 'amber', lead: `Nothing logged ${isYesterday ? 'yesterday' : `on ${name}`}.`, rest: moreText.trim() };
  }
  const summary = `${mealCount(count)}, ${fmtKcal(checkIn.kcal)}.${moreText}`;
  if (checkIn.variant === 'full') return { tone: 'amber', lead: `${name} looks incomplete.`, rest: summary };
  return { tone: 'neutral', lead: `${name} isn't confirmed yet.`, rest: summary };
}

// ---------------------------------------------------------------------------
// Target suggestion notice (S40, in-app)
// ---------------------------------------------------------------------------

export interface TargetNoticeCopy {
  /** The notice key (`${versionId}:${weekStart}`), marked seen when the banner is tapped. */
  key: string;
  /** Bold lead: "New target suggestion". */
  lead: string;
  /** "based on 4 weeks of data." */
  rest: string;
}

/**
 * The in-app S40 notice: "New target suggestion based on 4 weeks of data." Shown while a
 * suggestion waits (not kept), once per key on this device.
 */
export function targetNotice(check: TargetCheck | undefined, seenKey: string | null): TargetNoticeCopy | undefined {
  if (check?.kind !== 'suggestion' || check.proposal.noticeKey === seenKey) return undefined;
  return {
    key: check.proposal.noticeKey,
    lead: 'New target suggestion',
    rest: `based on ${fmtInt(weeksOfData(check.estimate.daysUsed))} weeks of data.`,
  };
}

// ---------------------------------------------------------------------------
// Goal end notice (plan §6.3): the end of a goal was reached, once per device
// ---------------------------------------------------------------------------

export interface GoalEndNoticeCopy {
  /** endKey() of the goal and its end, marked seen when the banner is tapped. */
  key: string;
  /** Bold lead: "Your Cut goal reached its end date." */
  lead: string;
  rest: string;
}

/** Shown after the check-in banner and the target notice, until this end has been seen on this device. */
export function goalEndNotice(end: Pick<GoalEndView, 'goal' | 'state' | 'key'> | undefined, seenKey: string | null): GoalEndNoticeCopy | undefined {
  if (!end || end.key === seenKey) return undefined;
  const lead = end.state.kind === 'date' ? `Your ${end.goal.name} goal reached its end date.` : `Your trend reached ${fmtKg(end.state.weightKg)}.`;
  return { key: end.key, lead, rest: 'Pick what comes next.' };
}
