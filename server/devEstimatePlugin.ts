/**
 * Dev-only endpoint: POST /api/estimate on the Vite dev server, using the same core as the
 * Supabase Edge Function. Lets you try AI estimates locally before Supabase is set up.
 *
 * Enabled only when ANTHROPIC_API_KEY is set (in your shell or .env.local). Without a key it
 * answers 503 and the app falls back to the offline catalogue estimator.
 * The key stays in the Node process; it is never exposed to the browser bundle.
 *
 * It needs no sign-in, so it answers only the app itself: browser requests from any other origin
 * (another site, or another localhost port) get 403. Vite's CORS middleware doesn't stop those on
 * its own: a cross-site `no-cors` POST with a text/plain or multipart body needs no preflight and
 * would still reach this handler and spend Anthropic credit. Vite's host check, which runs before
 * plugin middlewares, keeps DNS-rebinding hosts out, so the request's Host can be trusted here.
 */
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import type { Logger, Plugin, ViteDevServer } from 'vite';
import Anthropic from '@anthropic-ai/sdk';
import {
  buildSystemPrompt,
  estimateMeal,
  EstimateError,
  readEstimateRequest,
  type CatalogueEntry,
  type EstimateInput,
  type EstimateOutput,
} from '../supabase/functions/estimate/core.ts';

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
  return Buffer.concat(chunks);
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function header(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Whether a request comes from a page on this dev server. Browsers send `Origin` on every POST
 * (as "null" when hidden) and `Sec-Fetch-Site` on every request, so a cross-origin page can't
 * pass; a request with neither is a script or curl on this machine, which is allowed.
 */
export function isSameOriginRequest(headers: IncomingHttpHeaders): boolean {
  const site = header(headers, 'sec-fetch-site');
  if (site !== undefined && site !== 'same-origin') return false;

  const origin = header(headers, 'origin');
  if (origin === undefined) return true;
  const host = header(headers, 'host');
  if (!host) return false;
  try {
    const from = new URL(origin); // "null" and other opaque origins throw
    if (from.protocol !== 'http:' && from.protocol !== 'https:') return false;
    // Parse the Host the same way so default ports and letter case compare equal.
    return from.host === new URL(`${from.protocol}//${host}`).host;
  } catch {
    return false;
  }
}

/** The app sends JSON for text and multipart for photos; anything else is refused. */
export function isAcceptedContentType(raw: string | undefined): boolean {
  const type = raw?.split(';')[0]?.trim().toLowerCase();
  return type === 'application/json' || type === 'multipart/form-data';
}

export interface DevEstimateDeps {
  apiKey: string | undefined;
  estimate: (input: EstimateInput) => Promise<EstimateOutput>;
  logger: Pick<Logger, 'info' | 'error'>;
}

/** The /api/estimate handler, separate from the plugin so tests can call it directly. */
export function createDevEstimateMiddleware(deps: DevEstimateDeps): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    if (req.method !== 'POST') return send(res, 405, { error: 'Use POST', code: 'bad_request' });
    if (!isSameOriginRequest(req.headers)) {
      return send(res, 403, { error: 'The dev endpoint only answers the app on this server.', code: 'forbidden' });
    }
    const contentType = header(req.headers, 'content-type');
    if (!isAcceptedContentType(contentType)) {
      return send(res, 415, { error: 'Send JSON or multipart form data.', code: 'bad_request' });
    }
    if (!deps.apiKey) return send(res, 503, { error: 'AI estimates are off (no ANTHROPIC_API_KEY).', code: 'unavailable' });

    let input: EstimateInput;
    try {
      const body = await readBody(req);
      const request = new Request('http://localhost/api/estimate', {
        method: 'POST',
        headers: { 'content-type': contentType ?? 'application/json' },
        body: new Uint8Array(body),
      });
      input = await readEstimateRequest(request);
    } catch (err) {
      if (err instanceof EstimateError) return send(res, err.status, { error: err.message, code: err.code });
      return send(res, 400, { error: 'The request could not be read.', code: 'bad_request' });
    }

    try {
      const result = await deps.estimate(input);
      deps.logger.info(
        `[estimate] ${result.items.length} items · in ${result.usage.inputTokens} · out ${result.usage.outputTokens}`,
      );
      send(res, 200, result);
    } catch (err) {
      if (err instanceof EstimateError) return send(res, err.status, { error: err.message, code: err.code });
      deps.logger.error(`[estimate] ${err instanceof Error ? err.message : String(err)}`);
      send(res, 500, { error: 'Estimate failed', code: 'upstream' });
    }
  };
}

export function devEstimatePlugin(apiKey: string | undefined): Plugin {
  let client: Anthropic | null = null;
  let cached: { catalogue: CatalogueEntry[]; systemPrompt: string } | null = null;

  async function loadCatalogue(server: ViteDevServer) {
    // Loaded through Vite so the @/ alias and TS resolve; reloaded when the module graph changes.
    const mod = (await server.ssrLoadModule('/src/data/catalogue.ts')) as { CATALOGUE: CatalogueEntry[] };
    if (!cached || cached.catalogue !== mod.CATALOGUE) {
      cached = { catalogue: mod.CATALOGUE, systemPrompt: buildSystemPrompt(mod.CATALOGUE) };
    }
    return cached;
  }

  return {
    name: 'kira-dev-estimate',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(
        '/api/estimate',
        createDevEstimateMiddleware({
          apiKey,
          logger: server.config.logger,
          estimate: async (input) => {
            client ??= new Anthropic({ apiKey });
            const { catalogue, systemPrompt } = await loadCatalogue(server);
            return estimateMeal(input, { client, catalogue, systemPrompt });
          },
        }),
      );
    },
  };
}
