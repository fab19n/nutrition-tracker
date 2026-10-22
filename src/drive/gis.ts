/**
 * The Google access token for Drive (decision §10.18), from Google Identity Services' token model:
 * the only module that loads the GIS script or touches `window.google`.
 *
 * - The script loads on demand (`load()`), never on a device that doesn't use Drive.
 * - Every token request opens a Google window, and the browser only lets it open inside a tap the
 *   user makes, so `request()` calls `requestAccessToken` synchronously before it returns: call
 *   it straight from a tap handler with no await before it. With `prompt: ''` and the connected
 *   account as `login_hint`, a returning user sees a window that opens and closes by itself.
 * - Tokens last about an hour and live in memory only: nothing is stored, nothing is revoked.
 */
import type { SyncTimers } from '@/sync/engine';
import { DRIVE_SCOPE, GIS_SCRIPT_URL } from './config';

export interface DriveTokenRequest {
  /** 'select_account' on Connect (pick the account with the space); '' afterwards (no screen when Google remembers). */
  prompt: '' | 'select_account';
  /** The connected Google email, so account choice is skipped. */
  loginHint?: string;
}

export interface DriveToken {
  accessToken: string;
  /** ms, from expires_in */
  expiresAt: number;
}

export type DriveAuthProblem =
  | 'notReady' // GIS not loaded yet (buttons are disabled meanwhile; never a popup)
  | 'offline'
  | 'popupBlocked' // error_callback type popup_failed_to_open
  | 'popupClosed' // error_callback type popup_closed (the user closed it: no message)
  | 'denied' // token response error access_denied
  | 'scopeDenied' // hasGrantedAllScopes(resp, DRIVE_SCOPE) is false (the Drive box unticked)
  | 'otherAccount' // the token's account isn't driveMeta.email (checked by the engine)
  | 'unavailable' // the GIS script couldn't load (offline, blocked, 15 s timeout)
  | 'failed'; // anything else, or no answer within 3 minutes

export class DriveAuthError extends Error {
  readonly problem: DriveAuthProblem;

  constructor(problem: DriveAuthProblem, message?: string) {
    super(message ?? problem);
    this.name = 'DriveAuthError';
    this.problem = problem;
  }
}

export function isDriveAuthError(error: unknown): error is DriveAuthError {
  return error instanceof DriveAuthError;
}

export interface DriveTokenSource {
  ready(): boolean;
  /** Loads GIS once and builds the token client. Rejects DriveAuthError('unavailable'); the next call tries again. */
  load(): Promise<void>;
  /**
   * Calls requestAccessToken synchronously, before returning: call it straight from a tap handler with no await before it.
   * One request at a time: a call while one is pending returns the pending promise.
   */
  request(req: DriveTokenRequest): Promise<DriveToken>;
}

export const GIS_LOAD_TIMEOUT_MS = 15_000;
export const POPUP_TIMEOUT_MS = 180_000;

// The part of google.accounts.oauth2 this app uses, written by hand (no npm dependency).

interface TokenResponse {
  access_token: string;
  expires_in: number | string;
  scope: string;
  error?: string;
  error_description?: string;
}

interface TokenClientError {
  type: string;
}

interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string; login_hint?: string }): void;
}

interface GoogleOAuth2 {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    prompt?: string;
    callback: (response: TokenResponse) => void;
    error_callback?: (error: TokenClientError) => void;
  }): TokenClient;
  hasGrantedAllScopes(response: TokenResponse, firstScope: string, ...restScopes: string[]): boolean;
}

type GoogleHost = { google?: { accounts?: { oauth2?: Partial<GoogleOAuth2> } } };

const browserTimers: SyncTimers = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

interface Pending {
  promise: Promise<DriveToken>;
  resolve: (token: DriveToken) => void;
  reject: (error: DriveAuthError) => void;
  timer: unknown;
}

export function createGisTokenSource(
  clientId: string,
  opts: { clock?: () => number; timers?: SyncTimers; doc?: Document; win?: Window } = {},
): DriveTokenSource {
  const clock = opts.clock ?? (() => Date.now());
  const timers = opts.timers ?? browserTimers;
  const doc = opts.doc ?? (typeof document === 'undefined' ? undefined : document);
  const win = opts.win ?? (typeof window === 'undefined' ? undefined : window);

  let oauth2: GoogleOAuth2 | null = null;
  let client: TokenClient | null = null;
  let loading: Promise<void> | null = null;
  let pending: Pending | null = null;

  function loaded(): GoogleOAuth2 | null {
    const found = (win as GoogleHost | undefined)?.google?.accounts?.oauth2;
    return found && typeof found.initTokenClient === 'function' && typeof found.hasGrantedAllScopes === 'function'
      ? (found as GoogleOAuth2)
      : null;
  }

  function settle(outcome: { token: DriveToken } | { error: DriveAuthError }): void {
    const current = pending;
    if (!current) return;
    pending = null;
    timers.clearTimeout(current.timer);
    if ('token' in outcome) current.resolve(outcome.token);
    else current.reject(outcome.error);
  }

  function onToken(response: TokenResponse): void {
    if (response.error) {
      settle({ error: new DriveAuthError(response.error === 'access_denied' ? 'denied' : 'failed', response.error_description) });
      return;
    }
    if (!oauth2?.hasGrantedAllScopes(response, DRIVE_SCOPE)) {
      settle({ error: new DriveAuthError('scopeDenied') });
      return;
    }
    const seconds = Number(response.expires_in);
    settle({ token: { accessToken: response.access_token, expiresAt: clock() + (Number.isFinite(seconds) ? seconds : 0) * 1000 } });
  }

  function onError(error: TokenClientError): void {
    const problem: DriveAuthProblem =
      error?.type === 'popup_failed_to_open' ? 'popupBlocked' : error?.type === 'popup_closed' ? 'popupClosed' : 'failed';
    settle({ error: new DriveAuthError(problem) });
  }

  function build(google: GoogleOAuth2): void {
    oauth2 = google;
    client = google.initTokenClient({ client_id: clientId, scope: DRIVE_SCOPE, prompt: '', callback: onToken, error_callback: onError });
  }

  function load(): Promise<void> {
    if (client) return Promise.resolve();
    const already = loaded();
    if (already) {
      try {
        build(already);
        return Promise.resolve();
      } catch {
        return Promise.reject(new DriveAuthError('unavailable', "Google's sign-in couldn't start"));
      }
    }
    if (loading) return loading;
    if (!doc) return Promise.reject(new DriveAuthError('unavailable', 'No document to load Google into'));

    const attempt = new Promise<void>((resolve, reject) => {
      const script = doc.createElement('script');
      script.src = GIS_SCRIPT_URL;
      script.async = true;
      let timer: unknown;
      const finish = (ok: boolean) => {
        timers.clearTimeout(timer);
        script.removeEventListener('load', onLoad);
        script.removeEventListener('error', onFail);
        loading = null;
        if (ok) {
          resolve();
          return;
        }
        // The next load() appends a fresh tag.
        script.remove();
        reject(new DriveAuthError('unavailable', "Google's sign-in script didn't load"));
      };
      const onLoad = () => {
        const google = loaded();
        if (!google) {
          finish(false);
          return;
        }
        try {
          build(google);
          finish(true);
        } catch {
          finish(false);
        }
      };
      const onFail = () => finish(false);
      script.addEventListener('load', onLoad);
      script.addEventListener('error', onFail);
      timer = timers.setTimeout(onFail, GIS_LOAD_TIMEOUT_MS);
      doc.head.appendChild(script);
    });
    loading = attempt;
    return attempt;
  }

  function request(req: DriveTokenRequest): Promise<DriveToken> {
    if (pending) return pending.promise;
    if (!client) return Promise.reject(new DriveAuthError('notReady'));
    let resolve: (token: DriveToken) => void = () => undefined;
    let reject: (error: DriveAuthError) => void = () => undefined;
    const promise = new Promise<DriveToken>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const timer = timers.setTimeout(() => settle({ error: new DriveAuthError('failed', 'No answer from Google') }), POPUP_TIMEOUT_MS);
    pending = { promise, resolve, reject, timer };
    try {
      client.requestAccessToken(req.loginHint ? { prompt: req.prompt, login_hint: req.loginHint } : { prompt: req.prompt });
    } catch {
      settle({ error: new DriveAuthError('failed', "Google's window couldn't open") });
    }
    return promise;
  }

  return { ready: () => client !== null, load, request };
}
