/**
 * The weekly focus as the insights see it (step 3 of the weekly review). The rules themselves
 * (ids, labels, how progress is counted) live in src/domain/focus.ts, shared with Today's
 * WeeklyFocusCard (C44), so the review reports exactly what Today showed all week.
 *
 * This file adds what the insight rules need on top: honest default sub-lines, and the item
 * tests the rules use to work out savings (a drink's sugar choice, nasi kandar rice).
 */
import { FOCUS_RULES, FOCUS_RULE_IDS, focusProgress, focusRuleIdOf, isFocusRuleId, type FocusRuleId } from '@/domain/focus';
import type { LogicalDay, MealLog, WeekPlan } from '@/domain/types';
import { isDrink, variantLabel } from './categories';

export { FOCUS_RULE_IDS, focusRuleIdOf, isFocusRuleId };

/** The option label (and WeekPlan.focus.label): "Kurang manis for drinks". */
export function focusLabel(id: FocusRuleId): string {
  return FOCUS_RULES[id].label;
}

/** Sub-line used when no insight gave a number of its own (never a made-up saving). */
export function defaultFocusSub(id: FocusRuleId): string {
  switch (id) {
    case 'drinksKurang':
      return 'Less sugar in teh, kopi and milo';
    case 'halfRiceNasiKandar':
      return 'Small rice when you eat there';
    case 'windowUnder12h':
      return 'First bite to last bite within 12 hours';
  }
}

export type WeeklyFocus = NonNullable<WeekPlan['focus']>;

export interface FocusOutcome {
  done: number;
  total: number;
}

const SUGAR_LABELS = new Set(['kosong', 'kurang', 'normal']);
const LESS_SUGAR = new Set(['kosong', 'kurang']);
const NASI_KANDAR_RICE = 'rice-nasi-kandar';

/** Drinks that offer a sugar choice (Kosong / Kurang / Normal). */
export function hasSugarChoice(item: MealLog['items'][number]): boolean {
  return isDrink(item) && (item.variants ?? []).some((v) => SUGAR_LABELS.has(v.label.toLowerCase()));
}

export function isLessSugar(item: MealLog['items'][number]): boolean {
  return LESS_SUGAR.has((variantLabel(item) ?? '').toLowerCase());
}

export function nasiKandarRice(meal: MealLog): MealLog['items'][number] | undefined {
  return meal.items.find((i) => i.catalogueId === NASI_KANDAR_RICE);
}

/**
 * How a focus went over a whole budget week (`weekStart`), counted by the shared rule in
 * src/domain/focus.ts. Days from `today` on are still going and don't count for the window rule.
 */
export function focusOutcome(
  ruleId: FocusRuleId,
  meals: readonly MealLog[],
  weekStart: LogicalDay,
  today: LogicalDay,
  opts: { tz?: string; rolloverHour?: number } = {},
): FocusOutcome {
  const progress = focusProgress(ruleId, { meals, today, weekStart, ...opts });
  return { done: progress.done, total: progress.total };
}
