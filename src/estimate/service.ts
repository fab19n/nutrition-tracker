/**
 * The estimator the app uses (ARCHITECTURE.md §7). When the AI runs depends on the endpoint
 * (readEstimateUrl) and the profile's AI estimates setting:
 * - 'off': local only.
 * - 'auto' (default): the local estimator answers first; the AI runs only when it left something
 *   it couldn't read (unmatched words, a rough 'aiGuess' item, nothing at all) or for a photo,
 *   which can't be read offline.
 * - 'always': the AI first for every typed or photographed meal.
 * Whenever the AI can't run the local estimate answers, and `aiSkipped` says why. Offline with
 * nothing recognised, items come back flagged `pendingEstimate` ("Estimate will run when you're
 * back online") with a conservative guess so the day still adds up.
 */
import type { AiEstimateMode, MealItem } from '@/domain/types';
import { candidateHints, placeHint, postEstimate, readEstimateUrl, type AiClientConfig } from './aiClient';
import { throwIfAborted } from './abort';
import { EstimateUnavailableError } from './errors';
import { GUESS_NORMAL_INDEX, GUESS_UNCERTAINTY, PHOTO_GUESS_KCAL, guessMacrosFor, guessVariants } from './local/guess';
import { estimateLocally } from './localEstimator';
import type { AiSkipReason, EstimateContext, EstimateOptions, EstimateRequest, EstimateResult, Estimator } from './types';

export const DEFAULT_AI_MODE: AiEstimateMode = 'auto';

export interface EstimatorConfig extends AiClientConfig {
  /** profile.aiEstimates; defaults to 'auto'. */
  mode?: AiEstimateMode | undefined;
}

export interface EstimateMealOptions extends EstimateOptions {
  /** profile.aiEstimates; undefined = 'auto'. */
  mode?: AiEstimateMode | undefined;
}

function defaultNewId(): string {
  return globalThis.crypto.randomUUID();
}

function hasInput(req: EstimateRequest): boolean {
  return Boolean(req.photo) || Boolean(req.text?.trim()) || Boolean(req.caption?.trim());
}

/**
 * Whether a local estimate leaves something only the AI can read: a photo (always), unmatched
 * words, a rough 'aiGuess' item, or nothing recognised at all. Works on a fallback result too.
 */
export function needsAi(req: EstimateRequest, local: EstimateResult): boolean {
  if (req.photo) return true;
  if (!hasInput(req)) return false;
  return local.items.length === 0 || local.unmatched.length > 0 || local.items.some((item) => item.source === 'aiGuess');
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

function skipped(result: EstimateResult, reason: AiSkipReason): EstimateResult {
  return { ...result, aiSkipped: reason };
}

/**
 * Local only ('off', or no endpoint). Typed guesses stay plain guesses (there's no AI to wait
 * for); a photo the caption doesn't explain becomes one pending "Meal from photo".
 */
function localOnly(reason: AiSkipReason, newId: () => string): Estimator {
  return {
    async estimate(req: EstimateRequest, ctx: EstimateContext, opts?: EstimateOptions): Promise<EstimateResult> {
      throwIfAborted(opts?.signal);
      const local = estimateLocally(req, ctx, newId);
      return skipped(req.photo ? withPendingEstimates(local, req, newId) : local, reason);
    },
  };
}

/** The local estimate first, then the AI when the mode calls for it; local is the fallback. */
function aiWithLocalFallback(url: string, mode: 'auto' | 'always', config: AiClientConfig): Estimator {
  const newId = config.newId ?? defaultNewId;
  return {
    async estimate(req: EstimateRequest, ctx: EstimateContext, opts?: EstimateOptions): Promise<EstimateResult> {
      throwIfAborted(opts?.signal);
      const local = estimateLocally(req, ctx, newId);
      if (!hasInput(req) || (mode === 'auto' && !needsAi(req, local))) return skipped(local, 'notNeeded');
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
        return skipped(withPendingEstimates(local, req, newId), error.reason);
      }
    },
  };
}

/**
 * The app's estimator for a mode (default 'auto'): local only when the mode is 'off' or no
 * endpoint is configured, else local with the AI as needed (see the file comment).
 */
export function getEstimator(config: EstimatorConfig = {}): Estimator {
  const { mode = DEFAULT_AI_MODE, ...client } = config;
  const newId = client.newId ?? defaultNewId;
  if (mode === 'off') return localOnly('off', newId);
  const url = client.url ?? readEstimateUrl();
  if (!url) return localOnly('notConfigured', newId);
  return aiWithLocalFallback(url, mode, client);
}

/**
 * One-shot convenience for screens:
 * `await estimateMeal({ text }, { place, personal }, { signal, mode: profile.aiEstimates })`.
 */
export function estimateMeal(req: EstimateRequest, ctx: EstimateContext, opts: EstimateMealOptions = {}): Promise<EstimateResult> {
  const { mode, ...rest } = opts;
  return getEstimator(mode ? { mode } : {}).estimate(req, ctx, rest);
}
