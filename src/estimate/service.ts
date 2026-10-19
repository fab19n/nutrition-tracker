/**
 * The estimator the app uses (ARCHITECTURE.md §7). With VITE_ESTIMATE_URL set, the AI endpoint
 * runs first and the local estimator answers whenever it's unavailable; without it, estimation
 * is local only. Offline with nothing recognised, items come back flagged `pendingEstimate`
 * ("Estimate will run when you're back online") with a conservative guess so the day still adds up.
 */
import type { MealItem } from '@/domain/types';
import { candidateHints, placeHint, postEstimate, readEstimateUrl, type AiClientConfig } from './aiClient';
import { throwIfAborted } from './abort';
import { EstimateUnavailableError } from './errors';
import { GUESS_NORMAL_INDEX, GUESS_UNCERTAINTY, PHOTO_GUESS_KCAL, guessMacrosFor, guessVariants } from './local/guess';
import { createLocalEstimator, estimateLocally } from './localEstimator';
import type { EstimateContext, EstimateOptions, EstimateRequest, EstimateResult, Estimator } from './types';

export type EstimatorConfig = AiClientConfig;

function defaultNewId(): string {
  return globalThis.crypto.randomUUID();
}

function hasInput(req: EstimateRequest): boolean {
  return Boolean(req.photo) || Boolean(req.text?.trim()) || Boolean(req.caption?.trim());
}

/** A whole plate known only from its photo: one pending item until the AI can look at it. */
function pendingPhotoItem(id: string): MealItem {
  const variants = guessVariants(guessMacrosFor(PHOTO_GUESS_KCAL));
  const normal = variants[GUESS_NORMAL_INDEX];
  return {
    id,
    name: 'Meal from photo',
    variants,
    selectedVariant: GUESS_NORMAL_INDEX,
    unitMacros: { ...(normal?.macros ?? guessMacrosFor(PHOTO_GUESS_KCAL)) },
    quantity: 1,
    uncertainty: GUESS_UNCERTAINTY,
    source: 'aiGuess',
    pendingEstimate: true,
  };
}

/**
 * When the AI couldn't run and the local estimator recognised nothing, the guesses wait for
 * the AI (marked pendingEstimate). Partly recognised meals keep their local guesses as they are.
 */
export function withPendingEstimates(result: EstimateResult, req: EstimateRequest, newId: () => string): EstimateResult {
  if (result.items.some((item) => item.source !== 'aiGuess')) return result;
  if (result.items.length > 0) {
    return { ...result, items: result.items.map((item) => ({ ...item, pendingEstimate: true })) };
  }
  return req.photo ? { ...result, items: [pendingPhotoItem(newId())] } : result;
}

/** AI first, local estimate as the fallback. */
function aiWithLocalFallback(url: string, config: EstimatorConfig): Estimator {
  const newId = config.newId ?? defaultNewId;
  return {
    async estimate(req: EstimateRequest, ctx: EstimateContext, opts?: EstimateOptions): Promise<EstimateResult> {
      throwIfAborted(opts?.signal);
      const local = estimateLocally(req, ctx, newId);
      if (!hasInput(req)) return local;
      try {
        return await postEstimate(req, {
          ...config,
          url,
          newId,
          ...(opts?.signal ? { signal: opts.signal } : {}),
          hints: { ...(ctx.place ? { place: placeHint(ctx.place) } : {}), candidates: candidateHints(local.items) },
        });
      } catch (error) {
        if (!(error instanceof EstimateUnavailableError)) throw error;
        return withPendingEstimates(local, req, newId);
      }
    },
  };
}

/** AI with local fallback when an endpoint is configured (VITE_ESTIMATE_URL), else local only. */
export function getEstimator(config: EstimatorConfig = {}): Estimator {
  const url = config.url ?? readEstimateUrl();
  if (!url) return createLocalEstimator(config.newId ? { newId: config.newId } : {});
  return aiWithLocalFallback(url, config);
}

/** One-shot convenience for screens: `await estimateMeal({ text }, { place, personal })`. */
export function estimateMeal(req: EstimateRequest, ctx: EstimateContext, opts?: EstimateOptions): Promise<EstimateResult> {
  return getEstimator().estimate(req, ctx, opts);
}
