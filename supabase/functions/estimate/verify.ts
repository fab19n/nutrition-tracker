/**
 * Access-token verification with supabase-js, shared by the Edge Function (./index.ts) and the
 * Node tests (server/estimateVerify.test.ts), which run it against a real client and a fake fetch.
 *
 * auth.getClaims checks the JWT locally against the project's signing keys (JWKS), or through the
 * Auth server (getUser) for legacy HS256 projects and tokens without a key id. Outcomes:
 * - verified, signed-in user with an email → their Identity (auth.ts decides who is allowed)
 * - bad, expired, forged or malformed token → null, so the caller answers 401
 * - Auth server or JWKS unreachable (AuthRetryableFetchError, which includes its 5xx answers) →
 *   throws, so the caller answers 503
 *
 * getClaims returns AuthErrors but rethrows anything else, and a crafted token can cause those:
 * a SyntaxError from a segment that isn't JSON, "Invalid alg claim", or a WebCrypto DOMException
 * when the header's alg doesn't fit the key. They mean "not signed in", not an outage.
 */
import { createClient, isAuthRetryableFetchError } from '@supabase/supabase-js';
import { identityFromClaims, type VerifyToken } from './auth.ts';

type ClaimsAuth = Pick<ReturnType<typeof createClient>['auth'], 'getClaims'>;

/** A server-side client used only to verify access tokens; it never stores or refreshes a session. */
export function createVerifierClient(url: string, key: string, fetchImpl?: typeof fetch): ReturnType<typeof createClient> {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    ...(fetchImpl ? { global: { fetch: fetchImpl } } : {}),
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A VerifyToken backed by auth.getClaims. `auth` is called on every check, so a missing URL or
 * key (it throws) is reported as a failed check (503) rather than as "sign in again".
 */
export function createTokenVerifier(auth: () => ClaimsAuth, onError: (message: string) => void = () => {}): VerifyToken {
  return async (token) => {
    let client: ClaimsAuth;
    try {
      client = auth();
    } catch (error) {
      onError(`sign-in check failed: ${messageOf(error)}`);
      throw error;
    }

    let result: Awaited<ReturnType<ClaimsAuth['getClaims']>>;
    try {
      result = await client.getClaims(token);
    } catch (error) {
      if (isAuthRetryableFetchError(error)) {
        onError(`sign-in check failed: ${messageOf(error)}`);
        throw error;
      }
      return null; // thrown by a malformed or crafted token
    }

    const { data, error } = result;
    if (error) {
      if (isAuthRetryableFetchError(error)) {
        onError(`sign-in check failed: ${messageOf(error)}`);
        throw error;
      }
      return null;
    }
    return identityFromClaims(data?.claims);
  };
}
