/**
 * This week's focus (C44, plan §12): the one thing picked in the weekly review (S33) and
 * tracked on Today. Each focus is a rule with an id shared by the review and Today; its
 * progress is counted from this week's meals.
 *
 * - drinksKurang: drinks chosen Kurang or Kosong, out of every drink with a sugar choice.
 * - halfRiceNasiKandar: nasi kandar visits where the rice was logged Small, out of all visits.
 * - windowUnder12h: finished days this week whose eating window (first to last bite) stayed
 *   at 12 hours or less, out of the finished days with meals.
 */
import { DEFAULT_ROLLOVER_HOUR, DEFAULT_TZ, addDays, compareDays, weekStartOf } from './day';
import { fmtInt } from './format';
import { eatingWindow } from './timing';
import type { LogicalDay, MealItem, MealLog, WeekPlan } from './types';

export type FocusRuleId = 'drinksKurang' | 'halfRiceNasiKandar' | 'windowUnder12h';

export const FOCUS_RULE_IDS: readonly FocusRuleId[] = ['drinksKurang', 'halfRiceNasiKandar', 'windowUnder12h'];

export interface FocusRule {
  id: FocusRuleId;
  /** As the review offers it and WeekPlan.focus stores it: "Kurang manis for drinks". */
  label: string;
  /** The review's default sub-line: "About 300 kcal a week less". */
  sub: string;
}

export const FOCUS_RULES: Record<FocusRuleId, FocusRule> = {
  drinksKurang: { id: 'drinksKurang', label: 'Kurang manis for drinks', sub: 'About 300 kcal a week less' },
  halfRiceNasiKandar: { id: 'halfRiceNasiKandar', label: 'Half rice at nasi kandar', sub: 'Around 250 kcal a visit' },
  windowUnder12h: { id: 'windowUnder12h', label: 'Keep eating days under 12 hours', sub: 'Long days ran +350' },
};

/** The eating-window focus is about 12 hours, whatever the goal's own window says. */
export const FOCUS_WINDOW_HOURS = 12;

/** Catalogue id of nasi kandar rice (its chips: Small / Normal / Mamak big). */
export const NASI_KANDAR_RICE_ID = 'rice-nasi-kandar';

const SUGAR_LESS = new Set(['kosong', 'kurang']);
const SMALL_RICE = new Set(['small', 'half']);

export function isFocusRuleId(value: unknown): value is FocusRuleId {
  return typeof value === 'string' && (FOCUS_RULE_IDS as readonly string[]).includes(value);
}

function normalise(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** The rule behind a stored focus: its ruleId, else a focus saved before ids existed, matched by label. */
export function focusRuleIdOf(focus: Pick<NonNullable<WeekPlan['focus']>, 'label' | 'ruleId'> | undefined): FocusRuleId | undefined {
  if (!focus) return undefined;
  if (isFocusRuleId(focus.ruleId)) return focus.ruleId;
  const label = normalise(focus.label);
  return FOCUS_RULE_IDS.find((id) => normalise(FOCUS_RULES[id].label) === label);
}

export interface FocusProgress {
  ruleId: FocusRuleId;
  done: number;
  total: number;
  /** Short, for the card's right side: "2 of 3", or "No drinks yet" before there is anything to count. */
  label: string;
  /** For screen readers: "2 of 3 drinks kurang or kosong so far". */
  description: string;
}

export interface FocusProgressInput {
  /** Meals of the budget week, any order. Guess entries are skipped. */
  meals: readonly MealLog[];
  today: LogicalDay;
  /** Monday of the week; defaults to the week containing today. */
  weekStart?: LogicalDay;
  tz?: string;
  rolloverHour?: number;
}

function variantLabel(item: MealItem): string | undefined {
  if (item.selectedVariant === undefined) return undefined;
  const label = item.variants?.[item.selectedVariant]?.label;
  return label === undefined ? undefined : normalise(label);
}

/** A drink with sugar chips: some choice is Kosong or Kurang. */
export function hasSugarChoice(item: MealItem): boolean {
  return (item.variants ?? []).some((v) => SUGAR_LESS.has(normalise(v.label)));
}

export function isSugarLess(item: MealItem): boolean {
  const label = variantLabel(item);
  return label !== undefined && SUGAR_LESS.has(label);
}

export function isNasiKandarRice(item: MealItem): boolean {
  if (item.catalogueId) return item.catalogueId === NASI_KANDAR_RICE_ID;
  return /nasi kandar/.test(normalise(item.name)) && (item.variants ?? []).some((v) => SMALL_RICE.has(normalise(v.label)));
}

function isSmallRice(item: MealItem): boolean {
  const label = variantLabel(item);
  return label !== undefined && SMALL_RICE.has(label);
}

/** "2 teh tarik" on one line are two drinks; half a glass is still one. */
function servings(item: MealItem): number {
  return Math.max(1, Math.round(item.quantity));
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** Meals of the week up to today, not guesses. */
function weekMeals(input: FocusProgressInput, weekStart: LogicalDay): MealLog[] {
  const weekEnd = addDays(weekStart, 6);
  return input.meals.filter(
    (m) =>
      !m.isGuess &&
      compareDays(m.logicalDay, weekStart) >= 0 &&
      compareDays(m.logicalDay, weekEnd) <= 0 &&
      compareDays(m.logicalDay, input.today) <= 0,
  );
}

function drinksProgress(meals: MealLog[]): FocusProgress {
  let done = 0;
  let total = 0;
  for (const meal of meals) {
    for (const item of meal.items) {
      if (!hasSugarChoice(item)) continue;
      const n = servings(item);
      total += n;
      if (isSugarLess(item)) done += n;
    }
  }
  return {
    ruleId: 'drinksKurang',
    done,
    total,
    label: total === 0 ? 'No drinks yet' : `${fmtInt(done)} of ${fmtInt(total)}`,
    description:
      total === 0
        ? 'No drinks logged this week yet'
        : `${fmtInt(done)} of ${fmtInt(total)} ${plural(total, 'drink', 'drinks')} kurang or kosong so far`,
  };
}

function nasiKandarProgress(meals: MealLog[]): FocusProgress {
  let done = 0;
  let total = 0;
  for (const meal of meals) {
    const rice = meal.items.filter(isNasiKandarRice);
    if (rice.length === 0) continue;
    total += 1;
    if (rice.every(isSmallRice)) done += 1;
  }
  return {
    ruleId: 'halfRiceNasiKandar',
    done,
    total,
    label: total === 0 ? 'No visits yet' : `${fmtInt(done)} of ${fmtInt(total)}`,
    description:
      total === 0
        ? 'No nasi kandar visits this week yet'
        : `${fmtInt(done)} of ${fmtInt(total)} nasi kandar ${plural(total, 'visit', 'visits')} with small rice`,
  };
}

function windowProgress(meals: MealLog[], input: FocusProgressInput): FocusProgress {
  const byDay = new Map<LogicalDay, MealLog[]>();
  for (const meal of meals) {
    // Today is still going: it counts once it's finished.
    if (compareDays(meal.logicalDay, input.today) >= 0) continue;
    const list = byDay.get(meal.logicalDay) ?? [];
    list.push(meal);
    byDay.set(meal.logicalDay, list);
  }
  let done = 0;
  const opts = { tz: input.tz ?? DEFAULT_TZ, rolloverHour: input.rolloverHour ?? DEFAULT_ROLLOVER_HOUR };
  for (const dayMeals of byDay.values()) {
    const window = eatingWindow(dayMeals, { maxWindowHours: FOCUS_WINDOW_HOURS }, opts);
    if (window.lengthHours <= FOCUS_WINDOW_HOURS + 1e-9) done += 1;
  }
  const total = byDay.size;
  return {
    ruleId: 'windowUnder12h',
    done,
    total,
    label: total === 0 ? 'From tomorrow' : `${fmtInt(done)} of ${fmtInt(total)}`,
    description:
      total === 0
        ? 'Counts from tomorrow, once today is finished'
        : `${fmtInt(done)} of ${fmtInt(total)} ${plural(total, 'day', 'days')} under ${FOCUS_WINDOW_HOURS} hours so far`,
  };
}

/** How this week is going on a focus. */
export function focusProgress(ruleId: FocusRuleId, input: FocusProgressInput): FocusProgress {
  const weekStart = input.weekStart ?? weekStartOf(input.today);
  const meals = weekMeals(input, weekStart);
  switch (ruleId) {
    case 'drinksKurang':
      return drinksProgress(meals);
    case 'halfRiceNasiKandar':
      return nasiKandarProgress(meals);
    case 'windowUnder12h':
      return windowProgress(meals, input);
  }
}
