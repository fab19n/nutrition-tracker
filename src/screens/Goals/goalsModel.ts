/**
 * Pure helpers that turn the goal read models (src/db/goals) into what S41–S44 and the S48
 * card show. All of the goal screens' copy lives here (the Today banner's is in todayModel.ts).
 * Estimates carry "~" (maintenance); targets don't, they are the numbers the budget uses.
 */
import type { GoalCardProps } from '@/components/GoalCard/GoalCard';
import type { GoalEditorValue } from '@/components/GoalEditorFields/GoalEditorFields';
import type { GoalSwitchPanelProps, PauseUntilChoice } from '@/components/GoalSwitchSheet/GoalSwitchSheet';
import type { GoalDetail, GoalEndView, GoalLibrary, LibraryEntry, SwitchPreview } from '@/db/goals';
import type { BuiltInTemplate } from '@/db/seed/defaults';
import { presetFor } from '@/db/seed/defaults';
import type { ActiveGoal } from '@/db/selectors';
import { switchedWeek } from '@/domain/budget';
import { addDays, compareDays, dayParts, daysBetween, weekStartOf, weekdayIndex } from '@/domain/day';
import { fmtApprox, fmtClock, fmtDayShort, fmtGrams, fmtInt, fmtKg, fmtKgRate, fmtRange, fmtWeekday, roundTo10 } from '@/domain/format';
import { PAUSE_UNTIL_MAX_DAYS, endConditionState, goalWeek, periodOn, type EndState, type GoalDraft } from '@/domain/goals';
import { KCAL_PER_KG, dailyTargetFor, deficitForPace, macrosForTarget, paceOf } from '@/domain/targets';
import type { Goal, GoalPeriod, GoalTemplate, GoalVersion, InsightGroup, LogicalDay, TimingRules } from '@/domain/types';
import { startsWhen } from '@/screens/Insights/targetModel';
import { fmtPaceKg, parseNumber } from '@/screens/Setup/fields';

const SUNDAY = 6;
const MINUS = '−';
const DEFAULT_RANGE_PCT = 0.1;
const DEFAULT_WINDOW_HOURS = 12;
const DEFAULT_SLEEP_GAP = 2;
const DEFAULT_OCCASIONS = 5;
const DEFAULT_FIXED = { start: '10:00', end: '20:00' } as const;

export const GOAL_ERRORS = {
  switch: "Couldn't switch goals. Try again.",
  save: "Couldn't save the goal. Try again.",
  archive: "Couldn't archive that. Try again.",
  changed: 'This goal changed. Have another look.',
} as const;

export const TEMPLATE_INFO: Record<GoalTemplate, { label: string; summary: string; mainNumber?: string }> = {
  cut: { label: 'Cut', summary: 'Lose fat at a steady pace.', mainNumber: 'kcal left' },
  festive: { label: 'Festive maintain', summary: 'Hold your weight through open-house season.', mainNumber: 'days in range' },
  leanBulk: { label: 'Lean bulk', summary: 'Gain slowly, with protein first.', mainNumber: 'protein left' },
  pause: { label: 'Pause', summary: 'Budget off for travel or sick days. Logging is optional.' },
  custom: { label: 'Custom', summary: 'Your own target, pace and eating window.', mainNumber: 'kcal left or protein left' },
};

/** S43's line under the template chips. */
export function templateDescription(t: GoalTemplate): string {
  const info = TEMPLATE_INFO[t];
  return info.mainNumber ? `${info.summary} Main number: ${info.mainNumber}.` : info.summary;
}

/** A day within the coming week by its weekday ("Sat"), else in full ("Mon 2 Nov"). */
function dayWord(day: LogicalDay, today: LogicalDay): string {
  return daysBetween(today, day) < 7 ? fmtWeekday(day) : fmtDayShort(day);
}

/** "tomorrow (Sat)", "5am (Sat)": when tomorrow starts, for "from …" phrases. */
export function fromWhen(today: LogicalDay, now: Date, tz: string, rolloverHour: number): string {
  return startsWhen(today, now, tz, rolloverHour).long.replace(/^at /, '');
}

// ---------------------------------------------------------------------------
// C46 cards (S41) and the S48 card
// ---------------------------------------------------------------------------

export interface GoalCardContext {
  today: LogicalDay;
  now: Date;
  tz: string;
  rolloverHour: number;
  dailyMinimumKcal: number;
}

export type GoalCardEntry =
  | { role: 'current'; entry: NonNullable<GoalLibrary['current']> }
  | { role: 'next'; entry: NonNullable<GoalLibrary['next']> }
  | { role: 'saved'; entry: LibraryEntry }
  | { role: 'ended'; entry: GoalLibrary['ended'][number] }
  | { role: 'template'; template: BuiltInTemplate };

export type GoalCardModel = Pick<GoalCardProps, 'status' | 'label' | 'title' | 'detail' | 'badge' | 'openLabel'>;

function paceWords(pace: number): string {
  return pace === 0 ? 'hold weight' : `${fmtPaceKg(pace)} a week`;
}

function bandOf(kcal: number, rangePct: number): string {
  return fmtRange({ low: roundTo10(kcal * (1 - rangePct)), high: roundTo10(kcal * (1 + rangePct)) });
}

/** The key targets of a goal on a list card, by template. */
function targetsDetail(goal: Goal, version: GoalVersion | undefined): string {
  if (goal.template === 'pause') return 'Budget off · logging optional';
  if (!version) return 'No target yet';
  const kcal = fmtInt(version.dailyKcal);
  const protein = fmtGrams(version.proteinG);
  switch (goal.template) {
    case 'festive':
      return `${kcal} a day · in range ${bandOf(version.dailyKcal, goal.rangePct ?? DEFAULT_RANGE_PCT)}`;
    case 'leanBulk':
      return `${kcal} a day · protein ${protein}`;
    case 'custom':
      if (goal.heroMetric === 'proteinLeft') return `protein ${protein} a day · ${kcal} kcal`;
      return `${kcal} a day · ${paceWords(paceOf(goal, version))} · protein ${protein}`;
    case 'cut':
      return `${kcal} a day · ${paceWords(paceOf(goal, version))} · protein ${protein}`;
  }
}

/** The template's name above the title when the goal is called something else. */
function templateLabel(goal: Goal): string | undefined {
  const label = TEMPLATE_INFO[goal.template].label;
  return goal.name.trim().toLowerCase() === label.toLowerCase() ? undefined : label;
}

function withLabel(model: GoalCardModel, label: string | undefined): GoalCardModel {
  if (label) model.label = label;
  return model;
}

function currentCard(entry: NonNullable<GoalLibrary['current']>, ctx: Pick<GoalCardContext, 'today' | 'dailyMinimumKcal'>): GoalCardModel {
  const { goal, period, week, version, paused } = entry;
  if (paused) {
    const label = period.to ? `Active goal · until ${dayWord(period.to, ctx.today)}` : `Active goal · since ${fmtDayShort(period.from)}`;
    return { status: 'active', label, title: `${goal.name} · budget off`, detail: 'Logging is optional. These days stay out of trends.', badge: 'Active' };
  }
  const pace = paceOf(goal, version);
  const parts = [
    pace === 0 ? 'Hold weight' : `${fmtPaceKg(pace)} a week`,
    `protein ${fmtGrams(version?.proteinG ?? 0)}`,
    `min ${fmtInt(ctx.dailyMinimumKcal)}`,
  ];
  return {
    status: 'active',
    label: `Active goal · week ${fmtInt(week)}`,
    title: `${goal.name} · ${fmtInt(version?.dailyKcal ?? 0)} a day`,
    detail: parts.join(' · '),
    badge: 'Active',
  };
}

/** C46 copy for each kind of card on S41. */
export function goalCardModel(input: GoalCardEntry, ctx: GoalCardContext): GoalCardModel {
  switch (input.role) {
    case 'current':
      return currentCard(input.entry, ctx);
    case 'next': {
      const { goal, version, startsOn, cancellable } = input.entry;
      const label = cancellable
        ? `Next · from ${fromWhen(ctx.today, ctx.now, ctx.tz, ctx.rolloverHour)}`
        : `Next · from ${fmtDayShort(startsOn)}`;
      return { status: 'next', label, title: goal.name, detail: targetsDetail(goal, version), badge: `Starts ${dayWord(startsOn, ctx.today)}` };
    }
    case 'saved': {
      const { goal, version } = input.entry;
      return withLabel({ status: goal.status === 'draft' ? 'draft' : 'saved', title: goal.name, detail: targetsDetail(goal, version) }, templateLabel(goal));
    }
    case 'ended': {
      const { goal, version, lastUsed } = input.entry;
      const detail = lastUsed ? `Used ${fmtDayShort(lastUsed.from)} to ${fmtDayShort(addDays(lastUsed.to, -1))}` : targetsDetail(goal, version);
      return withLabel({ status: 'ended', title: goal.name, detail }, templateLabel(goal));
    }
    case 'template': {
      const info = TEMPLATE_INFO[input.template];
      return { status: 'template', title: info.label, detail: info.summary, badge: 'Template', openLabel: `New goal from ${info.label}` };
    }
  }
}

/** The next goal starts again after a dated pause (rather than being a new switch). */
function resumes(library: Pick<GoalLibrary, 'current' | 'next'>): boolean {
  const { current, next } = library;
  return current?.paused === true && next !== undefined && current.period.to === next.startsOn;
}

/** S48: the active card, with the next goal and the saved goals as chips. Undefined without a goal in force. */
export function moreCardModel(library: GoalLibrary): (GoalCardModel & { chips: string[] }) | undefined {
  const { current, next } = library;
  if (!current) return undefined;
  const chips: string[] = [];
  if (next) chips.push(`${next.goal.name} · Starts ${resumes(library) ? 'again ' : ''}${dayWord(next.startsOn, library.today)}`);
  for (const entry of library.saved) chips.push(`${entry.goal.name} · ${entry.goal.status === 'draft' ? 'Draft' : 'Saved'}`);
  return { ...currentCard(current, library), chips };
}

/** More › Goals: "Cut active · 2 saved", "Cut active · Festive maintain from Sat". */
export function goalsSubLine(library: GoalLibrary): string | undefined {
  const { current, next } = library;
  if (!current) return undefined;
  const lead = `${current.goal.name} active`;
  if (next) return `${lead} · ${next.goal.name} from ${dayWord(next.startsOn, library.today)}`;
  return library.saved.length > 0 ? `${lead} · ${fmtInt(library.saved.length)} saved` : lead;
}

// ---------------------------------------------------------------------------
// C48 hints (S42, S43)
// ---------------------------------------------------------------------------

/** How the daily target is worked out, under the Daily target stepper. */
export function targetWorking(input: {
  template: GoalTemplate;
  dailyKcal: number;
  maintenanceKcal: number;
  paceKgPerWeek: number;
  rangePct: number;
  dailyMinimumKcal: number;
}): string {
  const { template, dailyKcal: kcal, maintenanceKcal, paceKgPerWeek: pace, dailyMinimumKcal } = input;
  const m = fmtApprox(roundTo10(maintenanceKcal));
  const gap = Math.round(maintenanceKcal - kcal);
  const relative = (): string => {
    if (gap > 0) return `${fmtInt(gap)} under your ${m} maintenance`;
    if (gap < 0) return `${fmtInt(-gap)} over your ${m} maintenance`;
    return `At your ${m} maintenance`;
  };
  switch (template) {
    case 'pause':
      return '';
    case 'festive':
      return `Maintenance ${m} · in range ${bandOf(kcal, input.rangePct)}`;
    case 'leanBulk':
      return gap < 0 ? `Maintenance ${m} + ${fmtInt(-gap)} surplus` : relative();
    case 'cut':
    case 'custom': {
      if (kcal === dailyTargetFor({ template, paceKgPerWeek: pace }, maintenanceKcal, dailyMinimumKcal)) {
        if (pace === 0) return `Your maintenance ${m}`;
        const deficit = deficitForPace(pace);
        if (maintenanceKcal - deficit < dailyMinimumKcal) return `Held at your ${fmtInt(dailyMinimumKcal)} daily minimum`;
        return `Maintenance ${m} ${MINUS} ${fmtInt(deficit)} for ${fmtKgRate(pace)} a week`;
      }
      if (gap > 0) return `${relative()}, about ${fmtKgRate((gap * 7) / KCAL_PER_KG)} a week`;
      return relative();
    }
  }
}

/**
 * "Carbs 205g and fat 60g follow from the rest." A stored target (S42, fields unchanged) says its
 * own carbs and fat, which can differ from what macrosForTarget would give now.
 */
export function macrosNote(dailyKcal: number, proteinG: number, stored?: Pick<GoalVersion, 'carbsG' | 'fatG'>): string {
  const { carbsG, fatG } = stored ?? macrosForTarget(dailyKcal, proteinG);
  return `Carbs ${fmtGrams(carbsG)} and fat ${fmtGrams(fatG)} follow from the rest.`;
}

/** The Festive band under the range chips: "In range: 1,890–2,310 kcal". */
export function rangeLine(dailyKcal: number, rangePct: number): string {
  return `In range: ${bandOf(dailyKcal, rangePct)} kcal`;
}

/** While target fields are changed on a goal with history: when the new target starts. */
export function startsNote(detail: Pick<GoalDetail, 'role' | 'everUsed' | 'version' | 'today' | 'tz' | 'rolloverHour'>, now: Date): string | undefined {
  if (!detail.everUsed) return undefined;
  const when = startsWhen(detail.today, now, detail.tz, detail.rolloverHour).long;
  const today = detail.role === 'current' && detail.version ? ` Today keeps ${fmtInt(detail.version.dailyKcal)}.` : '';
  return `Target changes start ${when}.${today}`;
}

/** Under the end fields: how far there is to go, or that it was reached. */
export function endHint(state: EndState): string | undefined {
  switch (state.kind) {
    case 'none':
      return undefined;
    case 'date':
      if (state.reached) return `Reached on ${fmtDayShort(state.date)}`;
      return `Ends ${fmtDayShort(state.date)} · ${state.daysLeft === 1 ? '1 day' : `${fmtInt(state.daysLeft)} days`} to go`;
    case 'weight':
      if (state.trendKg === undefined) return 'No trend yet. Weigh in to track it.';
      return state.reached ? `Reached: your trend is ${fmtKg(state.trendKg)}` : `Your trend is ${fmtKg(state.trendKg)} now`;
  }
}

// ---------------------------------------------------------------------------
// The form (C48) and the draft it saves
// ---------------------------------------------------------------------------

/** The end the form describes, for its hint: undefined until there is a real date, or with no end. */
export function formEndState(form: GoalEditorValue, ctx: { today: LogicalDay; paceKgPerWeek: number; trendKg?: number }): EndState | undefined {
  if (form.end.kind === 'date') return isLogicalDay(form.end.date) ? endConditionState({ date: form.end.date }, ctx) : undefined;
  if (form.end.kind !== 'weight') return undefined;
  const kg = parseNumber(form.end.weightKg);
  if (kg !== null) return endConditionState({ weightKg: kg }, ctx);
  // No weight typed yet: the hint still says where the trend is.
  const state: EndState = { kind: 'weight', weightKg: Number.NaN, reached: false };
  if (ctx.trendKg !== undefined) state.trendKg = ctx.trendKg;
  return state;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** 600 → "10:00". */
function clockText(minutes: number): string {
  return `${pad2(Math.floor(minutes / 60) % 24)}:${pad2(minutes % 60)}`;
}

/** "10:00" → 600. */
function clockMinutes(text: string): number {
  const [h, m] = text.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function formOf(source: {
  name: string;
  heroMetric: Goal['heroMetric'];
  paceKgPerWeek: number;
  dailyKcal?: number;
  proteinG?: number;
  rangePct?: number;
  timing: TimingRules;
  insightsOff?: readonly InsightGroup[];
  endCondition?: Goal['endCondition'];
}): GoalEditorValue {
  const { timing, endCondition } = source;
  const fixed = timing.fixedWindow;
  // A hold pace has no direction to reach a weight in, so a weight end shows as no end (spec D17).
  const weightEnd = endCondition?.weightKg !== undefined && source.paceKgPerWeek !== 0;
  return {
    name: source.name,
    heroMetric: source.heroMetric,
    dailyKcal: source.dailyKcal ?? 0,
    proteinG: source.proteinG ?? 0,
    paceKgPerWeek: source.paceKgPerWeek,
    rangePct: source.rangePct ?? DEFAULT_RANGE_PCT,
    windowHours: timing.maxWindowHours ?? DEFAULT_WINDOW_HOURS,
    fixedWindow: fixed ? { on: true, start: clockText(fixed.startMin), end: clockText(fixed.endMin) } : { on: false, ...DEFAULT_FIXED },
    sleepGap: { on: timing.minHoursBeforeSleep !== undefined, hours: timing.minHoursBeforeSleep ?? DEFAULT_SLEEP_GAP },
    grazing: { on: timing.maxEatingOccasions !== undefined, occasions: timing.maxEatingOccasions ?? DEFAULT_OCCASIONS },
    insightsOff: [...(source.insightsOff ?? [])],
    end: {
      kind: endCondition?.date !== undefined ? 'date' : weightEnd ? 'weight' : 'none',
      date: endCondition?.date ?? '',
      weightKg: endCondition?.weightKg !== undefined ? String(endCondition.weightKg) : '',
    },
  };
}

/** S42: the form for a goal and its target (the pending one when a change waits). */
export function formFromGoal(goal: Goal, version: GoalVersion | undefined): GoalEditorValue {
  return formOf({
    name: goal.name,
    heroMetric: goal.heroMetric,
    paceKgPerWeek: paceOf(goal, version),
    ...(version ? { dailyKcal: version.dailyKcal, proteinG: version.proteinG } : {}),
    ...(goal.rangePct !== undefined ? { rangePct: goal.rangePct } : {}),
    timing: goal.timing,
    ...(goal.insightsOff ? { insightsOff: goal.insightsOff } : {}),
    ...(goal.endCondition ? { endCondition: goal.endCondition } : {}),
  });
}

/** S43: the form for a template's draft. */
export function formFromDraft(draft: GoalDraft): GoalEditorValue {
  return formOf({
    name: draft.name,
    heroMetric: draft.heroMetric,
    paceKgPerWeek: draft.paceKgPerWeek,
    ...(draft.dailyKcal !== undefined ? { dailyKcal: draft.dailyKcal } : {}),
    ...(draft.proteinG !== undefined ? { proteinG: draft.proteinG } : {}),
    ...(draft.rangePct !== undefined ? { rangePct: draft.rangePct } : {}),
    timing: draft.timing,
    insightsOff: draft.insightsOff,
    ...(draft.endCondition ? { endCondition: draft.endCondition } : {}),
  });
}

/**
 * The draft a form saves. The eating window is always on (spec D15); fixed hours are Custom's.
 * A Pause keeps its timing and has no target or end. A typed weight like "78,6" reads as 78.6;
 * anything else is NaN, which the validation turns into "Add a weight in kg".
 */
export function draftFromForm(form: GoalEditorValue, template: GoalTemplate, base?: Goal): GoalDraft {
  const preset = presetFor(template);
  const draft: GoalDraft = {
    name: form.name,
    template,
    heroMetric: template === 'custom' ? form.heroMetric : (base?.heroMetric ?? preset.heroMetric),
    paceKgPerWeek: form.paceKgPerWeek,
    timing: { ...(base?.timing ?? preset.timing) },
    insightsOff: [...form.insightsOff],
  };
  if (template === 'pause') return draft;

  draft.dailyKcal = form.dailyKcal;
  draft.proteinG = form.proteinG;
  if (template === 'festive') draft.rangePct = form.rangePct;
  const surplus = base?.surplusKcal ?? preset.surplusKcal;
  if (template === 'leanBulk' && surplus !== undefined) draft.surplusKcal = surplus;

  const timing: TimingRules = { maxWindowHours: form.windowHours };
  if (form.sleepGap.on) timing.minHoursBeforeSleep = form.sleepGap.hours;
  if (form.grazing.on) timing.maxEatingOccasions = form.grazing.occasions;
  if (template === 'custom' && form.fixedWindow.on) {
    timing.fixedWindow = { startMin: clockMinutes(form.fixedWindow.start), endMin: clockMinutes(form.fixedWindow.end) };
  }
  draft.timing = timing;

  if (form.end.kind === 'date') draft.endCondition = { date: form.end.date };
  if (form.end.kind === 'weight') draft.endCondition = { weightKg: parseNumber(form.end.weightKg) ?? Number.NaN };
  return draft;
}

/** Same values (insight groups in any order). */
export function sameForm(a: GoalEditorValue, b: GoalEditorValue): boolean {
  const groups = (v: GoalEditorValue) => [...v.insightsOff].sort().join(',');
  return (
    a.name === b.name &&
    a.heroMetric === b.heroMetric &&
    a.dailyKcal === b.dailyKcal &&
    a.proteinG === b.proteinG &&
    a.paceKgPerWeek === b.paceKgPerWeek &&
    a.rangePct === b.rangePct &&
    a.windowHours === b.windowHours &&
    a.fixedWindow.on === b.fixedWindow.on &&
    a.fixedWindow.start === b.fixedWindow.start &&
    a.fixedWindow.end === b.fixedWindow.end &&
    a.sleepGap.on === b.sleepGap.on &&
    a.sleepGap.hours === b.sleepGap.hours &&
    a.grazing.on === b.grazing.on &&
    a.grazing.occasions === b.grazing.occasions &&
    groups(a) === groups(b) &&
    a.end.kind === b.end.kind &&
    a.end.date === b.end.date &&
    a.end.weightKg === b.end.weightKg
  );
}

/** The fields that make a new target version (kcal, protein, pace) differ. */
export function targetFieldsChanged(a: GoalEditorValue, b: GoalEditorValue): boolean {
  return a.dailyKcal !== b.dailyKcal || a.proteinG !== b.proteinG || a.paceKgPerWeek !== b.paceKgPerWeek;
}

/**
 * A pace chip: the pace and the target it gives (dailyTargetFor, never under the minimum).
 * Hold ends a weight end: there is no direction to reach a weight in, and the End chips drop it.
 */
export function withPace(
  form: GoalEditorValue,
  pace: number,
  ctx: { template: GoalTemplate; maintenanceKcal: number; dailyMinimumKcal: number },
): GoalEditorValue {
  const next: GoalEditorValue = {
    ...form,
    paceKgPerWeek: pace,
    dailyKcal: dailyTargetFor({ template: ctx.template, paceKgPerWeek: pace }, ctx.maintenanceKcal, ctx.dailyMinimumKcal),
  };
  if (pace === 0 && form.end.kind === 'weight') next.end = { ...form.end, kind: 'none' };
  return next;
}

// ---------------------------------------------------------------------------
// C47 GoalSwitchSheet (S44)
// ---------------------------------------------------------------------------

/** 'Sat' · 'Sat and Sun' · 'Wed–Fri' (3 or more in a row) · 'Mon, Wed and Fri'. */
export function dayListLabel(days: readonly LogicalDay[]): string {
  const names = days.map(fmtWeekday);
  if (names.length <= 1) return names[0] ?? '';
  const consecutive = days.every((day, i) => i === 0 || daysBetween(days[i - 1] ?? day, day) === 1);
  if (consecutive && names.length >= 3) return `${names[0]}–${names.at(-1)}`;
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** "Timing: 12-hour eating window, last meal 2 h before sleep, more than 5 eating occasions flagged." Undefined for Pause. */
export function timingLine(goal: Pick<Goal, 'template' | 'timing'>): string | undefined {
  if (goal.template === 'pause') return undefined;
  const { timing } = goal;
  const parts: string[] = [];
  if (timing.fixedWindow) {
    const { startMin, endMin } = timing.fixedWindow;
    parts.push(`eating window ${fmtClock(startMin, { compact: true })}–${fmtClock(endMin, { compact: true })}`);
  } else {
    parts.push(`${fmtInt(timing.maxWindowHours ?? DEFAULT_WINDOW_HOURS)}-hour eating window`);
  }
  if (timing.minHoursBeforeSleep !== undefined) parts.push(`last meal ${fmtInt(timing.minHoursBeforeSleep)} h before sleep`);
  if (timing.maxEatingOccasions !== undefined) parts.push(`more than ${fmtInt(timing.maxEatingOccasions)} eating occasions flagged`);
  return `Timing: ${parts.join(', ')}.`;
}

/** What the Today hero shows after the switch: "Main number becomes days in range (2,100 ± 10%)." */
export function mainNumberLine(target: Goal, version: GoalVersion | undefined, from: ActiveGoal | undefined): string {
  if (target.template === 'pause') return 'Budget off. Logging is optional, and these days stay out of trends.';
  const verb = from && !from.paused && from.goal.heroMetric === target.heroMetric ? 'stays' : 'becomes';
  const kcal = fmtInt(version?.dailyKcal ?? 0);
  switch (target.heroMetric) {
    case 'daysInRange':
      return `Main number ${verb} days in range (${kcal} ± ${Math.round((target.rangePct ?? DEFAULT_RANGE_PCT) * 100)}%).`;
    case 'proteinLeft':
      return `Main number ${verb} protein left, ${fmtGrams(version?.proteinG ?? 0)}.`;
    default:
      return `Main number ${verb} kcal left, ${kcal} a day.`;
  }
}

/** A pause runs to the Monday after the week tomorrow is in: Fri 16 → Mon 19, Sun 18 → Mon 26. */
export function pauseUntilDefault(today: LogicalDay): LogicalDay {
  return addDays(weekStartOf(addDays(today, 1)), 7);
}

function isLogicalDay(text: string): boolean {
  try {
    dayParts(text);
    return true;
  } catch {
    return false;
  }
}

export type UntilModel = Omit<NonNullable<GoalSwitchPanelProps['until']>, 'onSelect' | 'onDate'>;

export type SwitchSheetModel = Omit<GoalSwitchPanelProps, 'onConfirm' | 'onCancel' | 'busy' | 'until'> & {
  /** Pause only. */
  untilModel?: UntilModel;
  /** The day a dated pause ends (exclusive): what `switchGoal` gets as `until`. */
  untilDay?: LogicalDay;
};

/** The default picked date: a week after the pause starts. */
export function pausePickDefault(today: LogicalDay): LogicalDay {
  return addDays(today, 8);
}

/** Everything S44 shows for a switch, with the pause end the user picked. */
export function switchSheetModel(preview: SwitchPreview, choice: { until: PauseUntilChoice; date: LogicalDay }, now: Date): SwitchSheetModel {
  const { today, goal, version, from, startsOn } = preview;
  const when = startsWhen(today, now, preview.tz, preview.rolloverHour);
  const sunday = weekdayIndex(today) === SUNDAY;
  const pause = goal.template === 'pause';

  let untilModel: UntilModel | undefined;
  let untilDay: LogicalDay | undefined;
  if (pause) {
    const minDate = addDays(startsOn, 1);
    const maxDate = addDays(startsOn, PAUSE_UNTIL_MAX_DAYS);
    const monday = pauseUntilDefault(today);
    if (choice.until === 'monday') untilDay = monday;
    if (choice.until === 'date') untilDay = choice.date;
    const outside =
      choice.until === 'date' &&
      (!isLogicalDay(choice.date) || compareDays(choice.date, minDate) < 0 || compareDays(choice.date, maxDate) > 0);
    const resumeName = from?.goal.name ?? 'Your goal';
    untilModel = {
      options: [
        { id: 'monday', label: fmtDayShort(monday) },
        { id: 'date', label: 'Pick a date' },
        { id: 'open', label: 'Until I switch back' },
      ],
      selected: choice.until,
      date: choice.date,
      minDate,
      maxDate,
      line: untilDay && !outside ? `${resumeName} starts again on ${fmtDayShort(untilDay)}.` : 'Runs until you switch to another goal.',
    };
    if (outside) {
      untilModel.error = `Pick a day between ${fmtDayShort(minDate)} and ${fmtDayShort(maxDate)}`;
      untilModel.line = '';
      untilDay = undefined;
    }
  }

  const aheadOn = new Map(preview.ahead.map((a) => [a.day, a]));
  const pausedUntil = untilDay;
  const targetAfter = (day: LogicalDay): number | null => {
    const ahead = aheadOn.get(day);
    if (!ahead) return null;
    if (pause) return pausedUntil !== undefined && compareDays(day, pausedUntil) >= 0 ? ahead.fromKcal : null;
    return ahead.targetKcal;
  };
  const week = switchedWeek(preview.days, today, targetAfter);

  const model: SwitchSheetModel = {
    goalName: goal.name,
    startsLine: `Starts ${when.long}${sunday ? ', with the new week' : ''}. Past days keep the goal they had.`,
    changes: [mainNumberLine(goal, version, from), timingLine(goal)].filter((line): line is string => line !== undefined),
    confirmLabel: `Switch from ${when.short}`,
  };
  if (week.sameWeek && week.groups.length > 0) {
    model.week = {
      lead: `This week: ${week.groups.map((g) => `${g.days === 1 ? '1 day' : `${fmtInt(g.days)} days`} at ${fmtInt(g.kcal)}`).join(' + ')} = `,
      total: `${fmtInt(week.totalKcal)} kcal`,
    };
    if (week.pausedDays.length > 0) model.week.tail = `. ${dayListLabel(week.pausedDays)}: budget off.`;
  }
  if (preview.replaces) model.replaces = `This replaces ${preview.replaces.goal.name} from ${dayWord(preview.replaces.startsOn, today)}.`;
  if (untilModel) model.untilModel = untilModel;
  if (untilDay) model.untilDay = untilDay;
  return model;
}

// ---------------------------------------------------------------------------
// S42 status, usage and the end note
// ---------------------------------------------------------------------------

export interface StatusCardModel {
  headline: string;
  lines: string[];
  /** "Keep Cut instead": cancels the booked switch. */
  cancelLabel?: string;
}

/** The S42 card that says where the goal stands; undefined for a saved or draft goal. */
export function statusCard(detail: GoalDetail, now: Date): StatusCardModel | undefined {
  const { today, goal, current, next } = detail;
  const tomorrow = addDays(today, 1);
  const when = startsWhen(today, now, detail.tz, detail.rolloverHour).long;
  const startsPhrase = (day: LogicalDay): string => (day === tomorrow ? when : `on ${fmtDayShort(day)}`);

  switch (detail.role) {
    case 'current': {
      if (!current) return undefined;
      const lines: string[] = [];
      const model: StatusCardModel = { headline: '', lines };
      if (current.paused) {
        const to = current.period.to;
        model.headline = to ? `Paused until ${dayWord(to, today)}` : `Paused since ${fmtDayShort(current.period.from)}`;
        lines.push('Budget off. Logging is optional, and these days stay out of trends.');
        if (next && to && next.startsOn === to) lines.push(`${next.goal.name} starts again on ${fmtDayShort(to)}.`);
        else if (next) lines.push(`${next.goal.name} starts ${startsPhrase(next.startsOn)}.`);
      } else {
        model.headline = `Your goal now · week ${fmtInt(goalWeek(current.period, today))}`;
        if (detail.pending && detail.version) {
          lines.push(`${fmtInt(detail.pending.dailyKcal)} starts ${startsPhrase(detail.pending.effectiveFrom)}. Today keeps ${fmtInt(detail.version.dailyKcal)}.`);
        }
        if (next) lines.push(`${next.goal.name} starts ${next.cancellable ? when : `on ${fmtDayShort(next.startsOn)}`}.`);
      }
      // Whenever the booked goal starts: a pause's resume can be dropped to keep the pause going.
      if (next) model.cancelLabel = `Keep ${goal.name} instead`;
      return model;
    }
    case 'next': {
      const startsOn = detail.startsOn ?? tomorrow;
      const cancellable = startsOn === tomorrow;
      const headline = cancellable ? `Starts ${when}` : detail.resumes ? `Starts again on ${fmtDayShort(startsOn)}` : `Starts on ${fmtDayShort(startsOn)}`;
      const keep = current?.goal.name;
      const model: StatusCardModel = { headline, lines: keep ? [`Today and earlier days keep ${keep}.`] : [] };
      if (keep) model.cancelLabel = `Keep ${keep} instead`;
      return model;
    }
    case 'ended':
      return { headline: 'Ended', lines: ['Past days keep it. Restore it to use it again.'] };
    default:
      return undefined;
  }
}

function pastPeriods(periods: readonly GoalPeriod[], today: LogicalDay): GoalPeriod[] {
  return periods.filter((p) => p.to !== undefined && compareDays(p.to, today) <= 0);
}

/** Above the target history: since when it's in use, when it was last used, or that it hasn't been. */
export function usageLine(detail: Pick<GoalDetail, 'periods' | 'role' | 'today'> & { goal: Pick<Goal, 'template'> }): string {
  if (detail.role === 'current') {
    const period = periodOn(detail.periods, detail.today);
    if (period) return `In use since ${fmtDayShort(period.from)}`;
  }
  const past = pastPeriods(detail.periods, detail.today);
  const last = past.at(-1);
  if (last?.to) {
    const times = past.length > 1 ? `Used ${fmtInt(past.length)} times · ` : '';
    return `${times}Last used ${fmtDayShort(last.from)} to ${fmtDayShort(addDays(last.to, -1))}`;
  }
  // A Pause has no target of its own.
  return detail.goal.template === 'pause' ? 'Not used yet. It starts the day you switch to it.' : 'Not used yet. Its target starts the day you switch to it.';
}

/** S41 and S42: the reached end, and the maintain goal to switch to. */
export function endNote(end: Pick<GoalEndView, 'state' | 'maintain' | 'goal'>): { lead: string; rest: string; actionLabel?: string } {
  const lead =
    end.state.kind === 'date' ? `You reached your end date, ${fmtDayShort(end.state.date)}.` : `Your trend reached ${fmtKg(end.state.weightKg)}.`;
  const maintain = end.maintain;
  if (maintain?.kind === 'goal') {
    return { lead, rest: `Switch to ${maintain.goal.name} to hold your weight.`, actionLabel: `See ${maintain.goal.name}` };
  }
  if (maintain?.kind === 'template') {
    return { lead, rest: 'A maintain goal holds your weight from here.', actionLabel: 'Set up a maintain goal' };
  }
  return { lead, rest: 'Pick what comes next.' };
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

/** "Festive maintain from tomorrow (Sat)", "Paused from tomorrow (Sat) until Mon". */
export function switchToast(
  goal: Goal,
  startsOn: LogicalDay,
  until: LogicalDay | undefined,
  today: LogicalDay,
  now: Date,
  tz: string,
  rolloverHour: number,
): string {
  const from = startsOn === addDays(today, 1) ? fromWhen(today, now, tz, rolloverHour) : fmtDayShort(startsOn);
  if (goal.template !== 'pause') return `${goal.name} from ${from}`;
  return `Paused from ${from}${until ? ` until ${dayWord(until, today)}` : ''}`;
}

/** "Cut stays your goal". */
export function cancelToast(current: Goal): string {
  return `${current.name} stays your goal`;
}

export function archiveToast(goal: Goal): string {
  return `Archived · ${goal.name}`;
}

export function restoreToast(goal: Goal): string {
  return `Restored · ${goal.name}`;
}

/** "Saved · 1,850 a day from tomorrow" when a target waits for tomorrow, else "Saved". */
export function saveToast(result: { version?: GoalVersion; startsOn?: LogicalDay }, when: string): string {
  return result.version && result.startsOn ? `Saved · ${fmtInt(result.version.dailyKcal)} a day from ${when}` : 'Saved';
}

export function createToast(goal: Goal): string {
  return `Saved · ${goal.name}`;
}
