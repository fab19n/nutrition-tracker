/**
 * The estimate endpoint as a plain fetch handler: CORS, sign-in, allow list, rate limit, then the
 * estimate itself. Runtime-agnostic; ./index.ts injects the Deno pieces (supabase-js verification,
 * the Anthropic client, secrets) and the Node tests inject fakes.
 *
 * Responses (JSON, with CORS headers for allowed origins):
 *   204 preflight · 200 EstimateOutput · 400/413/422/502 { error, code } from core.ts
 *   401 { code: 'notSignedIn' } · 403 { code: 'forbidden' } · 429 { code: 'rateLimited' } + Retry-After
 *   503 { code: 'upstream' } when sign-in can't be checked · 500 { code: 'upstream' } otherwise
 */
import { authorize, corsHeaders, type ListSetting, type RateLimiter, type VerifyToken } from './auth.ts';
import { EstimateError, readEstimateRequest, type EstimateInput, type EstimateOutput } from './core.ts';

export interface EstimateHandlerSettings {
  /** ALLOWED_EMAILS: who may use AI estimates. Empty = nobody. */
  allowedEmails: ListSetting;
  /** ALLOWED_ORIGIN: which web origins get CORS headers. */
  allowedOrigins: ListSetting;
}

export interface EstimateHandlerDeps {
  verify: VerifyToken;
  estimate: (input: EstimateInput) => Promise<EstimateOutput>;
  limiter: RateLimiter;
  /** Read on every request, so changed secrets apply without a redeploy. */
  settings: () => EstimateHandlerSettings;
  onError?: (error: unknown) => void;
}

export function createEstimateHandler(deps: EstimateHandlerDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    const { allowedEmails, allowedOrigins } = deps.settings();
    const cors = corsHeaders(req.headers.get('origin'), allowedOrigins);
    const json = (body: unknown, status: number, extra: Record<string, string> = {}): Response =>
      new Response(JSON.stringify(body), { status, headers: { ...cors, ...extra, 'Content-Type': 'application/json' } });

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return json({ error: 'Use POST.', code: 'bad_request' }, 405, { Allow: 'POST, OPTIONS' });

    const auth = await authorize(req, deps.verify, allowedEmails);
    if (!auth.ok) {
      return json({ error: auth.error, code: auth.code }, auth.status, auth.status === 401 ? { 'WWW-Authenticate': 'Bearer' } : {});
    }

    const rate = deps.limiter.take(auth.email);
    if (!rate.ok) {
      return json({ error: 'Too many estimates for now. Try again later.', code: 'rateLimited' }, 429, {
        'Retry-After': String(rate.retryAfterSeconds),
      });
    }

    let input: EstimateInput;
    try {
      input = await readEstimateRequest(req);
    } catch (error) {
      if (error instanceof EstimateError) return json({ error: error.message, code: error.code }, error.status);
      return json({ error: 'The request could not be read.', code: 'bad_request' }, 400);
    }

    try {
      return json(await deps.estimate(input), 200);
    } catch (error) {
      if (error instanceof EstimateError) return json({ error: error.message, code: error.code }, error.status);
      deps.onError?.(error);
      return json({ error: 'Estimate failed.', code: 'upstream' }, 500);
    }
  };
}
