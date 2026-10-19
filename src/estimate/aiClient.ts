/**
 * Client for the server-side estimate endpoint (plan §15). Sends the meal text or photo, the
 * Place's learned defaults and what the local estimator matched; never the user's name, body
 * stats, weight or the Place's name and location (plan §15.3).
 *
 * Deployed, the endpoint is the Supabase Edge Function and every call carries the signed-in
 * user's access token (Authorization) and the project's publishable key (apikey). In local dev
 * without Supabase, /api/estimate on the Vite server answers without either.
 */
import { getAccessToken, isAuthConfigured } from '@/auth/session';
import type { MealItem, Place, SourceTag } from '@/domain/types';
import { abortReason, throwIfAborted } from './abort';
import { parseEstimateResponse } from './aiResponse';
import { EstimateUnavailableError, type EstimateUnavailableReason } from './errors';
import type { EstimateOptions, EstimateRequest, EstimateResult, Estimator } from './types';

export { EstimateUnavailableError, type EstimateUnavailableReason } from './errors';

export const ESTIMATE_TIMEOUT_MS = 12_000;

/** The Edge Function's path under the Supabase project URL. */
export const SUPABASE_ESTIMATE_PATH = '/functions/v1/estimate';

function envValue(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw.trim() !== '' ? raw.trim() : undefined;
}

/**
 * Where estimates go: VITE_ESTIMATE_URL when set; else the Supabase Edge Function
 * (`${VITE_SUPABASE_URL}/functions/v1/estimate`) when sign-in is configured; else undefined
 * (local estimates only).
 */
export function readEstimateUrl(): string | undefined {
  const explicit = envValue(import.meta.env.VITE_ESTIMATE_URL);
  if (explicit) return explicit;
  if (!isAuthConfigured()) return undefined;
  const project = envValue(import.meta.env.VITE_SUPABASE_URL);
  return project ? `${project.replace(/\/+$/, '')}${SUPABASE_ESTIMATE_PATH}` : undefined;
}

/** Who is calling the endpoint. */
export interface EstimateAuth {
  /** The signed-in user's access token, or null when signed out. */
  getAccessToken: () => Promise<string | null>;
  /** The project's publishable (or legacy anon) key, sent as `apikey`. Public by design. */
  apiKey?: string;
}

/** The Supabase session when sign-in is configured; null (no auth headers) in local dev. */
export function defaultEstimateAuth(): EstimateAuth | null {
  if (!isAuthConfigured()) return null;
  const apiKey = envValue(import.meta.env.VITE_SUPABASE_KEY);
  return apiKey ? { getAccessToken, apiKey } : { getAccessToken };
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
  /** Defaults to readEstimateUrl(). */
  url?: string;
  /** Defaults to defaultEstimateAuth(); null sends no auth headers. */
  auth?: EstimateAuth | null;
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

/** Settles like `promise`, or rejects with the signal's reason as soon as it aborts. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(abortReason(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

/** Authorization (the user's access token) and apikey; 'notSignedIn' without a session. */
async function authHeaders(auth: EstimateAuth): Promise<Record<string, string>> {
  let token: string | null;
  try {
    token = await auth.getAccessToken();
  } catch (error) {
    throw new EstimateUnavailableError('network', 'The sign-in session could not be refreshed.', { cause: error });
  }
  if (!token) throw new EstimateUnavailableError('notSignedIn', 'Sign in to use AI estimates.');
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (auth.apiKey) headers.apikey = auth.apiKey;
  return headers;
}

/** 401 means the session is missing or expired; 403 that this account isn't allowed. */
function httpReason(status: number): EstimateUnavailableReason {
  if (status === 401) return 'notSignedIn';
  if (status === 403) return 'forbidden';
  return 'http';
}

/**
 * Posts a meal to the estimate endpoint and returns its items (method 'ai'). Throws
 * EstimateUnavailableError when no endpoint is configured, the device is offline, sign-in is
 * configured but there's no session ('notSignedIn', before anything is sent), the server refuses
 * the user (401 'notSignedIn', 403 'forbidden'), the request fails or times out (12 s), or the
 * response can't be read. Cancelling through `signal` rejects with the abort reason instead, so
 * callers don't fall back after a Cancel.
 */
export async function postEstimate(req: EstimateRequest, opts: PostEstimateOptions = {}): Promise<EstimateResult> {
  const url = opts.url ?? readEstimateUrl();
  if (!url) throw new EstimateUnavailableError('notConfigured', 'No estimate endpoint is configured.');
  throwIfAborted(opts.signal);
  if (!(opts.isOnline ?? browserIsOnline)()) throw new EstimateUnavailableError('offline', 'The device is offline.');
  const auth = opts.auth === undefined ? defaultEstimateAuth() : opts.auth;

  const fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
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
    // The token may need a refresh; the timeout and Cancel cover that wait too. Nothing is
    // prepared or sent without one.
    const credentials = auth ? await untilAborted(authHeaders(auth), controller.signal) : {};
    const { body, headers: bodyHeaders } = requestBody(req, opts.hints);
    const headers = { ...bodyHeaders, ...credentials };
    const response = await fetchImpl(url, { method: 'POST', headers, body, signal: controller.signal });
    if (!response.ok) {
      throw new EstimateUnavailableError(httpReason(response.status), `The estimate endpoint answered ${response.status}.`, {
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
