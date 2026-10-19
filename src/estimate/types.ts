/**
 * Estimation service contract (ARCHITECTURE.md §7).
 *
 * An estimator turns what the user typed (or photographed) into review-screen items (C21) with
 * ranges, at most two follow-up questions (C25) and the phrases it could not place.
 */
import type { Id, MealItem, MealSlot, PersonalItem, Place } from '@/domain/types';
import type { EstimateUnavailableReason } from './errors';

export interface EstimateRequest {
  text?: string;
  photo?: Blob;
  caption?: string;
  placeId?: Id;
  slot?: MealSlot;
}

export interface EstimateQuestion {
  itemId: Id;
  question: string;
}

export type EstimateMethod = 'local' | 'ai';

/**
 * Why a result came from the local estimator instead of the AI: 'off' (the profile turned AI
 * estimates off), 'notNeeded' (auto mode matched everything, or there was nothing to read), or
 * the reason the AI couldn't run ('notConfigured', 'offline', 'notSignedIn', 'timeout', …).
 */
export type AiSkipReason = 'off' | 'notNeeded' | EstimateUnavailableReason;

export interface EstimateResult {
  items: MealItem[];
  questions: EstimateQuestion[];
  /** Phrases from the text that matched nothing in the library or catalogue. */
  unmatched: string[];
  method: EstimateMethod;
  /** Set by the service (service.ts) when method is 'local': why the AI didn't answer. */
  aiSkipped?: AiSkipReason;
}

/** What the estimator knows about the user: the Place they're at and their saved corrections. */
export interface EstimateContext {
  place?: Place;
  personal: PersonalItem[];
}

export interface EstimateOptions {
  /** Cancels a running estimate (the Cancel button on S10). */
  signal?: AbortSignal;
}

export interface Estimator {
  estimate(req: EstimateRequest, ctx: EstimateContext, opts?: EstimateOptions): Promise<EstimateResult>;
}

/** Plan §15.2: at most 2 follow-up questions per meal… */
export const MAX_QUESTIONS = 2;
/** …and only when the answer moves the total by at least this much. */
export const QUESTION_MIN_KCAL = 100;
