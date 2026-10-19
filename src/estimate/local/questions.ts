import type { EstimateQuestion } from '../types';
import { MAX_QUESTIONS } from '../types';
import type { BuiltItem } from './build';

/**
 * At most two follow-up questions per meal (plan §15.2): guessed dishes first, then the items
 * whose answer moves the total most. Returned in item order, and set on the items themselves.
 */
export function pickQuestions(built: readonly BuiltItem[], max: number = MAX_QUESTIONS): EstimateQuestion[] {
  const chosen = built
    .flatMap((b, index) => (b.question ? [{ index, itemId: b.item.id, ...b.question }] : []))
    .sort((a, b) => a.priority - b.priority || b.weight - a.weight || a.index - b.index)
    .slice(0, Math.max(0, max))
    .sort((a, b) => a.index - b.index);
  return chosen.map(({ itemId, question }) => ({ itemId, question }));
}
