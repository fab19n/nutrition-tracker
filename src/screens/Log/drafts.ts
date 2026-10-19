/**
 * Review drafts for every way into S11 (ARCHITECTURE.md §8.1): set one with setReviewDraft,
 * then navigate to PATHS.review (or PATHS.estimating for text and photos).
 */
import { PATHS } from '@/app/paths';
import type { OrderOption } from '@/db/logging';
import type { Id, Instant, MealItem, MealLog, MealSlot } from '@/domain/types';
import type { ReviewDraft, ReviewMeta } from '@/state/ui';
import { freshItems } from './library';
import type { MealContext } from './mealTime';

export const REVIEW_TITLE = {
  meal: 'Check your meal',
  plate: 'Check your plate',
  usual: 'Your usual order',
  edit: 'Edit entry',
} as const;

/** The Place and time chips as draft fields (an unset key stays out of the draft). */
export function contextMeta(ctx: Pick<MealContext, 'placeId' | 'placeName' | 'eatenAt' | 'slot'>): Pick<ReviewMeta, 'placeId' | 'placeName' | 'eatenAt' | 'slot'> {
  const meta: Pick<ReviewMeta, 'placeId' | 'placeName' | 'eatenAt' | 'slot'> = { slot: ctx.slot };
  if (ctx.placeId) meta.placeId = ctx.placeId;
  else if (ctx.placeName?.trim()) meta.placeName = ctx.placeName.trim();
  if (ctx.eatenAt) meta.eatenAt = ctx.eatenAt;
  return meta;
}

/** Typed text, waiting for the estimator (S10). */
export function textDraft(text: string, ctx: MealContext): ReviewDraft {
  return {
    flow: 'text',
    title: REVIEW_TITLE.meal,
    items: [],
    meta: { ...contextMeta(ctx), method: 'text', text: text.trim() },
    backTo: PATHS.today,
  };
}

/** A stored photo and its optional caption, waiting for the estimator. */
export function photoDraft(photoId: Id, caption: string, ctx: MealContext): ReviewDraft {
  const meta: ReviewMeta = { ...contextMeta(ctx), method: 'photo', photoId };
  if (caption.trim()) meta.text = caption.trim();
  return { flow: 'photo', title: REVIEW_TITLE.meal, items: [], meta, backTo: PATHS.today };
}

/** Items picked straight from the library (a match under the Log input). */
export function itemsDraft(items: MealItem[], ctx: MealContext): ReviewDraft {
  return { flow: 'text', title: REVIEW_TITLE.meal, items, meta: { ...contextMeta(ctx), method: 'text' }, backTo: PATHS.today };
}

/** A Usual, or an order you usually have at this Place. */
export function orderDraft(order: OrderOption, ctx: MealContext): ReviewDraft {
  const meta: ReviewMeta = { ...contextMeta(ctx), method: order.method, name: order.name };
  if (!meta.placeId && !meta.placeName && order.placeId) meta.placeId = order.placeId;
  return {
    flow: order.method === 'usual' ? 'usual' : 'placeOrder',
    title: REVIEW_TITLE.usual,
    items: freshItems(order.items),
    meta,
    backTo: PATHS.today,
  };
}

/** The economy-rice plate (S24 → S11). */
export function plateDraft(items: MealItem[], ctx: MealContext, priceRm?: number): ReviewDraft {
  const meta: ReviewMeta = { ...contextMeta(ctx), method: 'plate', name: 'Economy rice' };
  if (priceRm !== undefined) meta.priceRm = priceRm;
  return { flow: 'plate', title: REVIEW_TITLE.plate, items, meta, backTo: PATHS.plate };
}

/** A saved meal opened for editing (S14 → S11 edit mode). */
export function editDraft(meal: MealLog): ReviewDraft {
  const meta: ReviewMeta = {
    method: meal.method,
    editingMealId: meal.id,
    eatenAt: meal.eatenAt,
    slot: meal.slot,
    name: meal.name,
    finished: meal.finished,
  };
  if (meal.placeId) meta.placeId = meal.placeId;
  if (meal.priceRm !== undefined) meta.priceRm = meal.priceRm;
  if (meal.photoId) meta.photoId = meal.photoId;
  if (meal.text) meta.text = meal.text;
  return {
    flow: 'edit',
    title: REVIEW_TITLE.edit,
    items: meal.items.map((item) => ({ ...item, unitMacros: { ...item.unitMacros } })),
    meta,
    backTo: PATHS.entry(meal.id),
  };
}

/** Where the plate builder and Review keep the chosen time between screens (router state). */
export interface LogNavState {
  placeId?: Id;
  eatenAt?: Instant;
  slot?: MealSlot;
  /** Back from Review: the plate builder picks its plate up from the review draft. */
  restore?: boolean;
}

export function isLogNavState(value: unknown): value is LogNavState {
  return typeof value === 'object' && value !== null;
}
