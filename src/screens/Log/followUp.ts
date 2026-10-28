/**
 * Answering an item's follow-up question on S11 (C25). The question is the estimator's own free
 * text ("How big was the glass?"), so the answer is too: the item is estimated again by the AI
 * from its name, the question and the answer, and the new items take its place.
 */
import type { MealItem } from '@/domain/types';
import type { EstimateRequest, EstimateResult } from '@/estimate/types';
import type { ReviewDraft } from '@/state/ui';

/** "Kopi ais (Normal ×2). Asked: How big was the glass? Answer: big Old Town glass, half drunk" */
export function answerText(item: MealItem, question: string, answer: string): string {
  const label = item.variants?.[item.selectedVariant ?? -1]?.label;
  const detail = [label, item.quantity !== 1 ? `×${item.quantity}` : undefined].filter(Boolean).join(' ');
  const name = detail ? `${item.name} (${detail})` : item.name;
  return `${name}. Asked: ${question.trim()} Answer: ${answer.trim()}`;
}

export function answerRequest(item: MealItem, question: string, answer: string, meta: ReviewDraft['meta']): EstimateRequest {
  const req: EstimateRequest = { text: answerText(item, question, answer) };
  if (meta.placeId) req.placeId = meta.placeId;
  if (meta.slot) req.slot = meta.slot;
  return req;
}

/**
 * The items that replace the answered one, or null when the answer wasn't used: the AI didn't
 * run (a local result) or came back empty. The question is answered, so none is asked again.
 */
export function answeredItems(result: EstimateResult): MealItem[] | null {
  if (result.method !== 'ai' || result.items.length === 0) return null;
  return result.items.map((item) => {
    if (item.question === undefined) return item;
    const { question: _question, ...rest } = item;
    return rest;
  });
}
