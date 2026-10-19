/**
 * Dev-only endpoint: POST /api/estimate on the Vite dev server, using the same core as the
 * Supabase Edge Function. Lets you try AI estimates locally before Supabase is set up.
 *
 * Enabled only when ANTHROPIC_API_KEY is set (in your shell or .env.local). Without a key it
 * answers 503 and the app falls back to the offline catalogue estimator.
 * The key stays in the Node process; it is never exposed to the browser bundle.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin, ViteDevServer } from 'vite';
import Anthropic from '@anthropic-ai/sdk';
import {
  buildSystemPrompt,
  estimateMeal,
  EstimateError,
  readEstimateRequest,
  type CatalogueEntry,
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
      server.middlewares.use('/api/estimate', async (req, res) => {
        if (req.method !== 'POST') return send(res, 405, { error: 'Use POST' });
        if (!apiKey) return send(res, 503, { error: 'AI estimates are off (no ANTHROPIC_API_KEY).', code: 'unavailable' });
        try {
          client ??= new Anthropic({ apiKey });
          const body = await readBody(req);
          const request = new Request('http://localhost/api/estimate', {
            method: 'POST',
            headers: { 'content-type': req.headers['content-type'] ?? 'application/json' },
            body: new Uint8Array(body),
          });
          const input = await readEstimateRequest(request);
          const { catalogue, systemPrompt } = await loadCatalogue(server);
          const result = await estimateMeal(input, { client, catalogue, systemPrompt });
          server.config.logger.info(
            `[estimate] ${result.items.length} items · in ${result.usage.inputTokens} (cache read ${result.usage.cacheReadTokens}) · out ${result.usage.outputTokens}`,
          );
          send(res, 200, result);
        } catch (err) {
          if (err instanceof EstimateError) return send(res, err.status, { error: err.message, code: err.code });
          server.config.logger.error(`[estimate] ${err instanceof Error ? err.message : String(err)}`);
          send(res, 500, { error: 'Estimate failed', code: 'upstream' });
        }
      });
    },
  };
}
