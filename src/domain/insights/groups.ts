/**
 * The insight toggles of a goal (C48): rules come in four groups, and a goal can turn a group
 * off. The engine leaves an off group's rules out of the feed, the top 3 and the weekly focus
 * options; the evidence sheet still reads them. The maintenance estimate (S37) isn't in a group.
 */
import type { Goal, InsightGroup } from '@/domain/types';
import type { InsightRuleId } from './types';

export const INSIGHT_GROUPS: Record<InsightGroup, readonly InsightRuleId[]> = {
  food: ['categoryShare', 'placeComparison', 'recurringCalories', 'weekdayWeekend', 'budgetResult'],
  protein: ['proteinGaps'],
  timing: ['windowVsCalories', 'firstMealDrift', 'grazing', 'lateEating'],
  weight: ['weightTrendVsPlan'],
};

/** The order of the toggles on S42 and S43. */
export const INSIGHT_GROUP_ORDER: readonly InsightGroup[] = ['food', 'protein', 'timing', 'weight'];

/** The rules a goal turned off (none without a goal, or for a row from before the toggles). */
export function rulesOffFor(goal?: Pick<Goal, 'insightsOff'>): Set<InsightRuleId> {
  const off = new Set<InsightRuleId>();
  for (const group of goal?.insightsOff ?? []) {
    for (const id of INSIGHT_GROUPS[group] ?? []) off.add(id);
  }
  return off;
}
