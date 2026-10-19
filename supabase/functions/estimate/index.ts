/**
 * Supabase Edge Function: POST /functions/v1/estimate
 *
 * Secrets (supabase secrets set ...): ANTHROPIC_API_KEY, ALLOWED_EMAILS (comma-separated; empty =
 * nobody), ALLOWED_ORIGIN (comma-separated web origins, e.g. the Vercel URL and
 * http://localhost:5173). Deploy: supabase functions deploy estimate
 *
 * The platform's JWT check is off (supabase/config.toml: verify_jwt = false) because this function
 * verifies the caller itself: the app sends the signed-in user's access token as
 * `Authorization: Bearer <jwt>`, auth.getClaims checks it (locally against the project's signing
 * keys, or through the Auth server for legacy HS256 projects), and the email must be on
 * ALLOWED_EMAILS. This works with both the legacy anon key and the new publishable keys.
 *
 * The per-user limit (30 an hour) lives in this instance's memory, so it's a best-effort guard;
 * set a monthly spend limit in the Anthropic console as the real cap.
 * catalogue.json is generated from src/data/catalogue.ts by `npm run build:estimate-catalogue`.
 */
import Anthropic from '@anthropic-ai/sdk';
import { createRateLimiter, ESTIMATES_PER_HOUR, publicKeyFromEnv } from './auth.ts';
import { buildSystemPrompt, estimateMeal, type CatalogueEntry } from './core.ts';
import { createEstimateHandler } from './handler.ts';
import { createTokenVerifier, createVerifierClient } from './verify.ts';
import catalogueJson from './catalogue.json' with { type: 'json' };

const catalogue = catalogueJson as CatalogueEntry[];
const systemPrompt = buildSystemPrompt(catalogue); // built once at start-up and reused for every request
const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY from the function's secrets

let supabase: ReturnType<typeof createVerifierClient> | null = null;

/** Created on first use; a missing URL or key throws, which the handler answers with 503. */
function authClient(): ReturnType<typeof createVerifierClient> {
  if (supabase) return supabase;
  const url = Deno.env.get('SUPABASE_URL');
  const key = publicKeyFromEnv((name) => Deno.env.get(name));
  if (!url || !key) throw new Error('SUPABASE_URL or the publishable/anon key is missing from the function environment.');
  supabase = createVerifierClient(url, key);
  return supabase;
}

// Bad, expired, forged or malformed tokens are "not signed in" (401); an unreachable Auth server is a 503.
const verify = createTokenVerifier(
  () => authClient().auth,
  (message) => console.error('[estimate]', message),
);

const handler = createEstimateHandler({
  verify,
  estimate: (input) => estimateMeal(input, { client: anthropic, catalogue, systemPrompt }),
  limiter: createRateLimiter({ limit: ESTIMATES_PER_HOUR, windowMs: 60 * 60 * 1000 }),
  settings: () => ({
    allowedEmails: Deno.env.get('ALLOWED_EMAILS'),
    allowedOrigins: Deno.env.get('ALLOWED_ORIGIN'),
  }),
  onError: (err) => console.error('[estimate]', err),
});

Deno.serve(handler);
