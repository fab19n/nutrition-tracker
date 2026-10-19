/**
 * Client for the server-side estimate endpoint (plan §15). Sends the meal text or photo, the
 * Place's learned defaults and what the local estimator matched; never the user's name, body
 * stats, weight or the Place's name and location (plan §15.3).
 */
import type { MealItem, Place, SourceTag } from '@/domain/types';
import { abortReason, throwIfAborted } from './abort';
import { parseEstimateResponse } from './aiResponse';
import { EstimateUnavailableError } from './errors';
import type { EstimateOptions, EstimateRequest, EstimateResult, Estimator } from './types';

export { EstimateUnavailableError, type EstimateUnavailableReason } from './errors';

export const ESTIMATE_TIMEOUT_MS = 12_000;

/** VITE_ESTIMATE_URL, or undefined when it's unset or blank. */
export function readEstimateUrl(): string | undefined {
  const raw: unknown = import.meta.env.VITE_ESTIMATE_URL;
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : undefined;
}

export interface PlaceHint {
  type: Place['type'];
  defaultVariants: Place['defaultVariants'];
  oilLevel?: Place['oilLevel'];
}

/** A local match the server can keep or refine. */
export interface CandidateHint {
  catalogueId: string;
  selectedVariant?: number;
  quantity: number;
  source: SourceTag;
}

export interface EstimateHints {
  place?: PlaceHint;
  candidates?: CandidateHint[];
}

export interface AiClientConfig {
  /** Defaults to VITE_ESTIMATE_URL. */
  url?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  /** Defaults to navigator.onLine. */
  isOnline?: () => boolean;
  /** Ids for items the server returns without one. */
  newId?: () => string;
}

export interface PostEstimateOptions extends AiClientConfig, EstimateOptions {
  hints?: EstimateHints;
}

export function placeHint(place: Place): PlaceHint {
  const hint: PlaceHint = { type: place.type, defaultVariants: { ...place.defaultVariants } };
  if (place.oilLevel) hint.oilLevel = place.oilLevel;
  return hint;
}

export function candidateHints(items: readonly MealItem[]): CandidateHint[] {
  return items.flatMap((item) => {
    if (item.catalogueId === undefined) return [];
    const hint: CandidateHint = { catalogueId: item.catalogueId, quantity: item.quantity, source: item.source };
    if (item.selectedVariant !== undefined) hint.selectedVariant = item.selectedVariant;
    return [hint];
  });
}

function browserIsOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

function defaultNewId(): string {
  return globalThis.crypto.randomUUID();
}

function payloadOf(req: EstimateRequest, hints: EstimateHints | undefined): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (req.text) payload.text = req.text;
  if (req.caption) payload.caption = req.caption;
  if (req.slot) payload.slot = req.slot;
  if (hints?.place) payload.place = hints.place;
  if (hints?.candidates?.length) payload.candidates = hints.candidates;
  return payload;
}

/** JSON for text; multipart with the photo and a JSON "request" field for photos. */
function requestBody(req: EstimateRequest, hints: EstimateHints | undefined): { body: BodyInit; headers: Record<string, string> } {
  const payload = JSON.stringify(payloadOf(req, hints));
  if (!req.photo) return { body: payload, headers: { Accept: 'application/json', 'Content-Type': 'application/json' } };
  const form = new FormData();
  form.append('request', payload);
  const name = typeof File !== 'undefined' && req.photo instanceof File ? req.photo.name : 'meal-photo';
  form.append('photo', req.photo, name);
  // No Content-Type: the browser adds the multipart boundary.
  return { body: form, headers: { Accept: 'application/json' } };
}

/**
 * Posts a meal to the estimate endpoint and returns its items (method 'ai'). Throws
 * EstimateUnavailableError when no endpoint is configured, the device is offline, the request
 * fails or times out (12 s), or the response can't be read. Cancelling through `signal`
 * rejects with the abort reason instead, so callers don't fall back after a Cancel.
 */
export async function postEstimate(req: EstimateRequest, opts: PostEstimateOptions = {}): Promise<EstimateResult> {
  const url = opts.url ?? readEstimateUrl();
  if (!url) throw new EstimateUnavailableError('notConfigured', 'No estimate endpoint is configured.');
  throwIfAborted(opts.signal);
  if (!(opts.isOnline ?? browserIsOnline)()) throw new EstimateUnavailableError('offline', 'The device is offline.');

  const fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const { body, headers } = requestBody(req, opts.hints);
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, opts.timeoutMs ?? ESTIMATE_TIMEOUT_MS);
  const external = opts.signal;
  const cancel = (): void => controller.abort();
  external?.addEventListener('abort', cancel, { once: true });

  try {
    const response = await fetchImpl(url, { method: 'POST', headers, body, signal: controller.signal });
    if (!response.ok) {
      throw new EstimateUnavailableError('http', `The estimate endpoint answered ${response.status}.`, {
        status: response.status,
      });
    }
    const json: unknown = await response.json();
    return parseEstimateResponse(json, opts.newId ?? defaultNewId);
  } catch (error) {
    if (external?.aborted) throw abortReason(external);
    if (timedOut) throw new EstimateUnavailableError('timeout', 'The estimate took too long.', { cause: error });
    if (error instanceof EstimateUnavailableError) throw error;
    if (error instanceof SyntaxError) {
      throw new EstimateUnavailableError('badResponse', 'The estimate response is not JSON.', { cause: error });
    }
    throw new EstimateUnavailableError('network', 'The estimate endpoint could not be reached.', { cause: error });
  } finally {
    clearTimeout(timer);
    external?.removeEventListener('abort', cancel);
  }
}

/** An Estimator backed only by the endpoint (no fallback); see service.ts for the app's one. */
export function createAiEstimator(config: AiClientConfig = {}): Estimator {
  return {
    estimate(req, ctx, opts) {
      const hints: EstimateHints = ctx.place ? { place: placeHint(ctx.place) } : {};
      return postEstimate(req, { ...config, ...(opts?.signal ? { signal: opts.signal } : {}), hints });
    },
  };
}
