/**
 * Supabase Edge Function: POST /functions/v1/estimate
 *
 * Deploy:  supabase secrets set ANTHROPIC_API_KEY=...   then   supabase functions deploy estimate
 * The function keeps Supabase's default JWT verification, so only signed-in requests reach it.
 * catalogue.json is generated from src/data/catalogue.ts by `npm run build:estimate-catalogue`.
 */
import Anthropic from '@anthropic-ai/sdk';
import { buildSystemPrompt, estimateMeal, EstimateError, readEstimateRequest, type CatalogueEntry } from './core.ts';
import catalogueJson from './catalogue.json' with { type: 'json' };

const catalogue = catalogueJson as CatalogueEntry[];
const systemPrompt = buildSystemPrompt(catalogue); // built once so every request shares the cached prefix
const client = new Anthropic(); // reads ANTHROPIC_API_KEY from the function's secrets

const CORS = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);
  try {
    const input = await readEstimateRequest(req);
    const result = await estimateMeal(input, { client, catalogue, systemPrompt });
    return json(result);
  } catch (err) {
    if (err instanceof EstimateError) return json({ error: err.message, code: err.code }, err.status);
    console.error(err);
    return json({ error: 'Estimate failed', code: 'upstream' }, 500);
  }
});
