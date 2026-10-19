/**
 * Display text and the review draft for S23 Usuals. Pure: the screen passes in what it read.
 */
import { PATHS } from '@/app/paths';
import { normaliseName } from '@/data/catalogue';
import { usualOption } from '@/db/logging';
import { fmtApprox, fmtInt, fmtRange, roundTo10 } from '@/domain/format';
import { itemsRange } from '@/domain/meal';
import type { Id, MealItem, Usual } from '@/domain/types';
import { orderDraft } from '@/screens/Log/drafts';
import { itemDisplayName, itemsKcal } from '@/screens/Log/library';
import type { MealContext } from '@/screens/Log/mealTime';
import type { ReviewDraft } from '@/state/ui';

/**
 * "Roti canai + dhal · Teh tarik", "Ayam goreng ×2 · Teh o ais kurang". Empty when it would only
 * repeat the Usual's name (a one-item Usual named after its item), so the card doesn't say it twice.
 */
export function usualItemsLabel(items: readonly MealItem[], usualName?: string): string {
  const label = items.map((item) => (item.quantity !== 1 ? `${itemDisplayName(item)} ×${item.quantity}` : itemDisplayName(item))).join(' · ');
  if (usualName !== undefined && normaliseName(label) === normaliseName(usualName)) return '';
  return label;
}

/** "~560 kcal". */
export function usualKcalLabel(items: readonly MealItem[]): string {
  return `${fmtApprox(roundTo10(itemsKcal(items)))} kcal`;
}

/** "~560 kcal · likely 480–640" for the editor's total line. */
export function usualTotalLabel(items: readonly MealItem[]): string {
  return `${usualKcalLabel(items)} · likely ${fmtRange(itemsRange([...items]))}`;
}

/**
 * Log in one tap: the Usual's items on the review screen (S11), at its Place when that Place
 * still exists, timed now. Back from the review returns to Usuals.
 */
export function usualReviewDraft(usual: Usual, ctx: MealContext, knownPlaceIds?: ReadonlySet<Id>): ReviewDraft {
  const option = usualOption(usual);
  if (option.placeId && knownPlaceIds && !knownPlaceIds.has(option.placeId)) delete option.placeId;
  return { ...orderDraft(option, ctx), backTo: PATHS.usuals };
}

/** Screen-reader note after a move: "Moved down. Roti canai + teh tarik is 2 of 4." */
export function moveAnnouncement(name: string, direction: 'up' | 'down', position: number, total: number): string {
  return `Moved ${direction}. ${name} is ${fmtInt(position)} of ${fmtInt(total)}.`;
}
