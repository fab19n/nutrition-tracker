/**
 * Sign-in for this phone's account. The account keeps the synced copy of the diary (src/sync,
 * ARCHITECTURE.md §6.2) and protects the AI estimate function (§7). Everything else works offline
 * without an account, and without Supabase configured (local dev) there is no sign-in and no sync,
 * and AI calls go to the dev endpoint without a token.
 *
 * - isAuthConfigured(): true when VITE_SUPABASE_URL and VITE_SUPABASE_KEY are set (deployed app).
 * - getAuth(): the signed-in user's access token, user id and email, the token refreshed first
 *   when it runs out within 60 s; null when signed out or unconfigured. Rejects when the session
 *   can't be checked (a refresh that failed on a bad connection), so callers report the
 *   connection, not a sign-out. Sync sends this token and checks the id against the device's link.
 * - getAccessToken(): getAuth()'s token alone, for the AI estimate call.
 * - useSession(): live session state for the UI, from one shared subscription. It starts the client.
 * - readSession(), watchSession(listener): the same state for code outside React (the sync
 *   engine). Watching is passive: it never loads supabase-js. ensureSessionStarted() does, once.
 * - signIn(email, password): the account's email and password, typed in the app. No email is
 *   sent, so there's no mailer to set up: new free Supabase projects can't edit the built-in
 *   mailer's template (it sends only a link), and an emailed link opens Safari instead of the
 *   installed iPhone app. Accounts are never created here; sign-ups are off in Supabase and the
 *   server allow-lists emails as well.
 * - signOut(): forgets this phone's session. The diary stays on this phone, and the copy in the
 *   account stays as it is.
 *
 * Errors are SignInError with copy the UI shows as is. Nothing here logs or stores passwords or
 * tokens; supabase-js keeps the session.
 */
import { useSyncExternalStore } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { clearStoredSession, getSupabase, hasStoredSession, readSupabaseConfig } from './supabase';

export type SessionStatus = 'unconfigured' | 'loading' | 'signedOut' | 'signedIn';

export interface SessionState {
  status: SessionStatus;
  email?: string;
  /** The signed-in user's id (auth.users.id): what the sync link is checked against. */
  userId?: string;
}

/** What a call to Supabase needs: the token to send, and whose it is. */
export interface AuthInfo {
  token: string;
  userId: string;
  email?: string;
}

/** Tokens that run out sooner than this are refreshed before use. */
const REFRESH_MARGIN_MS = 60_000;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type SignInErrorKind =
  | 'invalidEmail'
  | 'missingPassword'
  | 'wrongPassword'
  | 'notConfirmed'
  | 'notAllowed'
  | 'rateLimited'
  | 'offline'
  | 'unavailable'
  | 'unconfigured'
  | 'unknown';

/** A sign-in failure with a message ready to show. */
export class SignInError extends Error {
  readonly kind: SignInErrorKind;

  constructor(kind: SignInErrorKind, message: string) {
    super(message);
    this.name = 'SignInError';
    this.kind = kind;
  }
}

export const SIGN_IN_MESSAGES = {
  emailMissing: 'Enter your email address.',
  emailInvalid: "That doesn't look like an email address.",
  passwordMissing: 'Enter your password.',
  wrongPassword: 'Wrong email or password.',
  notConfirmed: "This account isn't confirmed yet.",
  notAllowed: "That email can't sign in to this app.",
  rateLimited: 'Too many tries. Wait a few minutes and try again.',
  offline: "No connection. Try again when you're online.",
  unavailable: "Sign-in isn't answering right now. Try again in a minute.",
  emailSignInOff: 'Email sign-in is turned off for this app.',
  unconfigured: "Sign-in isn't set up in this version of the app.",
  failed: "Couldn't sign in right now. Try again.",
} as const;

interface ErrorParts {
  name?: string | undefined;
  code?: string | undefined;
  status?: number | undefined;
  message?: string | undefined;
}

function partsOf(error: unknown): ErrorParts {
  if (typeof error !== 'object' || error === null) return {};
  const { name, code, status, message } = error as Record<string, unknown>;
  return {
    name: typeof name === 'string' ? name : undefined,
    code: typeof code === 'string' ? code : undefined,
    status: typeof status === 'number' ? status : undefined,
    message: typeof message === 'string' ? message : undefined,
  };
}

/** A fetch that failed, or a 5xx from Supabase Auth or its proxy: a connection problem, not an answer. */
function isRetryableFetchError(error: unknown): boolean {
  return partsOf(error).name === 'AuthRetryableFetchError';
}

const RATE_LIMIT_CODES = new Set(['over_request_rate_limit', 'over_email_send_rate_limit']);
const NOT_ALLOWED_CODES = new Set(['user_banned', 'user_not_found', 'signup_disabled', 'email_address_not_authorized']);
/** Older Auth servers answer a wrong password with this message and no error code. */
const WRONG_PASSWORD_MESSAGE = /invalid login credentials/i;

/** Maps a Supabase Auth error (or a thrown fetch failure) to a SignInError. */
export function toSignInError(error: unknown): SignInError {
  if (error instanceof SignInError) return error;
  const { name, code, status, message } = partsOf(error);

  if (name === 'AuthRetryableFetchError') {
    return status ? new SignInError('unavailable', SIGN_IN_MESSAGES.unavailable) : new SignInError('offline', SIGN_IN_MESSAGES.offline);
  }
  if (error instanceof TypeError) return new SignInError('offline', SIGN_IN_MESSAGES.offline);
  // Supabase limits sign-ins per IP address (the token endpoint's limit, shared with refreshes).
  if (status === 429 || (code !== undefined && RATE_LIMIT_CODES.has(code))) {
    return new SignInError('rateLimited', SIGN_IN_MESSAGES.rateLimited);
  }
  // An unknown email and a wrong password get the same answer, so neither says who has an account.
  const oldWrongPassword = code === undefined && status === 400 && message !== undefined && WRONG_PASSWORD_MESSAGE.test(message);
  if (code === 'invalid_credentials' || oldWrongPassword) return new SignInError('wrongPassword', SIGN_IN_MESSAGES.wrongPassword);
  if (code === 'email_not_confirmed') return new SignInError('notConfirmed', SIGN_IN_MESSAGES.notConfirmed);
  if (code === 'email_provider_disabled') return new SignInError('unavailable', SIGN_IN_MESSAGES.emailSignInOff);
  if (code !== undefined && NOT_ALLOWED_CODES.has(code)) return new SignInError('notAllowed', SIGN_IN_MESSAGES.notAllowed);
  if (code === 'email_address_invalid') return new SignInError('invalidEmail', SIGN_IN_MESSAGES.emailInvalid);
  if (status !== undefined && status >= 500) return new SignInError('unavailable', SIGN_IN_MESSAGES.unavailable);
  return new SignInError('unknown', SIGN_IN_MESSAGES.failed);
}

// ---------------------------------------------------------------------------
// Input checks
// ---------------------------------------------------------------------------

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trimmed, lower-cased email, or a SignInError. */
export function normaliseEmail(email: string): string {
  const address = email.trim().toLowerCase();
  if (address === '') throw new SignInError('invalidEmail', SIGN_IN_MESSAGES.emailMissing);
  if (!EMAIL_SHAPE.test(address)) throw new SignInError('invalidEmail', SIGN_IN_MESSAGES.emailInvalid);
  return address;
}

/** The password exactly as typed (spaces count, so it's never trimmed), or a SignInError when empty. */
export function checkPassword(password: string): string {
  if (password === '') throw new SignInError('missingPassword', SIGN_IN_MESSAGES.passwordMissing);
  return password;
}

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

// ---------------------------------------------------------------------------
// Session store: one auth subscription shared by every useSession()
// ---------------------------------------------------------------------------

const UNCONFIGURED: SessionState = { status: 'unconfigured' };
const LOADING: SessionState = { status: 'loading' };
const SIGNED_OUT: SessionState = { status: 'signedOut' };

let state: SessionState | null = null;
let starting: Promise<void> | null = null;
/** Set once onAuthStateChange (or a sign-in or sign-out here) has spoken; newer than getSession. */
let heardFromAuth = false;
let stopListening: (() => void) | null = null;
const listeners = new Set<() => void>();

/** The session state now, without starting the client (loading until something starts it). */
export function readSession(): SessionState {
  return state ?? (isAuthConfigured() ? LOADING : UNCONFIGURED);
}

/** `event`: an auth event, passed on even when the state is the same (a refreshed token, a sign-in again). */
function setState(next: SessionState, event = false): void {
  const same = state !== null && state.status === next.status && state.email === next.email && state.userId === next.userId;
  if (same && !event) return;
  if (!same) state = next;
  for (const listener of [...listeners]) listener();
}

function stateFor(session: Session | null): SessionState {
  if (!session) return SIGNED_OUT;
  const { id: userId, email } = session.user;
  return email ? { status: 'signedIn', email, userId } : { status: 'signedIn', userId };
}

/** Starts listening to Supabase Auth once. Never rejects. */
function start(): Promise<void> {
  starting ??= (async () => {
    let client: SupabaseClient | null;
    try {
      client = await getSupabase();
    } catch {
      // supabase-js couldn't load (offline before it was ever cached). Try again next time.
      starting = null;
      setState(SIGNED_OUT);
      return;
    }
    if (!client) {
      setState(UNCONFIGURED);
      return;
    }
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      heardFromAuth = true;
      setState(stateFor(session), true);
    });
    stopListening = () => data.subscription.unsubscribe();
    try {
      const { data: current } = await client.auth.getSession();
      if (!heardFromAuth) setState(stateFor(current.session));
    } catch {
      if (!heardFromAuth) setState(SIGNED_OUT);
    }
  })();
  return starting;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  void start();
  return () => {
    listeners.delete(listener);
  };
}

/** Starts listening to Supabase Auth (loading supabase-js) unless it already is. Never rejects. */
export function ensureSessionStarted(): Promise<void> {
  return start();
}

/**
 * Calls `listener` with the state after every change and every auth event (a refreshed token, or
 * a sign-in again as the same user, passes on the same state), until the returned function is
 * called. Passive: it never starts the client, so supabase-js stays unloaded until a sign-in,
 * ensureSessionStarted() or a screen showing the session loads it. A listener can run inside
 * supabase-js's onAuthStateChange, where awaiting another Supabase call waits on the auth lock
 * that event holds: defer that work (setTimeout 0).
 */
export function watchSession(listener: (state: SessionState) => void): () => void {
  const notify = () => listener(readSession());
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}

/** Tests only: forget the session state and the auth subscription. */
export function resetSessionForTests(): void {
  stopListening?.();
  stopListening = null;
  state = null;
  starting = null;
  heardFromAuth = false;
}

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

export function isAuthConfigured(): boolean {
  return readSupabaseConfig() !== null;
}

/** Live session state; every caller shares one subscription. */
export function useSession(): SessionState {
  return useSyncExternalStore(subscribe, readSession, readSession);
}

function expiresWithin(session: Session, ms: number): boolean {
  return session.expires_at !== undefined && session.expires_at * 1000 - Date.now() < ms;
}

/**
 * A failed session read or refresh means "signed out" only once the session is gone from storage
 * (the server refused the refresh token). A refresh that fails on a bad connection keeps the
 * session stored and getSession answers { session: null, error } for it: that's a connection
 * problem, so it's thrown.
 */
function throwUnlessSignedOut(error: unknown): null {
  if (error && (isRetryableFetchError(error) || hasStoredSession())) throw error;
  return null;
}

function authFor(session: Session): AuthInfo {
  const { id: userId, email } = session.user;
  return email ? { token: session.access_token, userId, email } : { token: session.access_token, userId };
}

/** The signed-in user's token (refreshed when it runs out within 60 s), id and email. See the header. */
export async function getAuth(): Promise<AuthInfo | null> {
  if (!isAuthConfigured()) return null;
  // supabase-js not loading, or getSession throwing, rejects too: the session couldn't be checked.
  const client = await getSupabase();
  if (!client) return null;
  // getSession itself refreshes a token that runs out within 90 s.
  const { data, error } = await client.auth.getSession();
  const session = data.session;
  if (!session) return throwUnlessSignedOut(error);
  if (!expiresWithin(session, REFRESH_MARGIN_MS)) return authFor(session);
  const refreshed = await client.auth.refreshSession();
  if (refreshed.data.session) return authFor(refreshed.data.session);
  // Couldn't refresh (offline): the old token still works until it runs out.
  if (!expiresWithin(session, 0)) return authFor(session);
  return throwUnlessSignedOut(refreshed.error ?? new Error('The session ran out and could not be refreshed.'));
}

export async function getAccessToken(): Promise<string | null> {
  return (await getAuth())?.token ?? null;
}

async function requireClient(): Promise<SupabaseClient> {
  if (!isAuthConfigured()) throw new SignInError('unconfigured', SIGN_IN_MESSAGES.unconfigured);
  // Listening first means the session this sign-in creates reaches every useSession().
  await start();
  let client: SupabaseClient | null;
  try {
    client = await getSupabase();
  } catch {
    throw new SignInError('offline', SIGN_IN_MESSAGES.offline);
  }
  if (!client) throw new SignInError('unconfigured', SIGN_IN_MESSAGES.unconfigured);
  return client;
}

/** Signs in with the account's email and password. Never creates an account. */
export async function signIn(email: string, password: string): Promise<void> {
  const address = normaliseEmail(email);
  const secret = checkPassword(password);
  if (isOffline()) throw new SignInError('offline', SIGN_IN_MESSAGES.offline);
  const client = await requireClient();
  let session: Session | null = null;
  try {
    const { data, error } = await client.auth.signInWithPassword({ email: address, password: secret });
    if (error) throw error;
    session = data.session;
  } catch (thrown) {
    throw toSignInError(thrown);
  }
  if (!session) throw new SignInError('unknown', SIGN_IN_MESSAGES.failed);
  heardFromAuth = true;
  setState(stateFor(session), true);
}

/** Forgets this phone's session (other devices stay signed in). Always ends signed out. */
export async function signOut(): Promise<void> {
  if (!isAuthConfigured()) return;
  let client: SupabaseClient | null = null;
  try {
    client = await getSupabase();
  } catch {
    // supabase-js didn't load; the stored session is cleared below.
  }
  let cleared = false;
  if (client) {
    try {
      const { error } = await client.auth.signOut({ scope: 'local' });
      cleared = !error;
    } catch {
      cleared = false;
    }
  }
  // Offline with a run-out token the client keeps the session; drop it here instead.
  if (!cleared) clearStoredSession();
  heardFromAuth = true;
  setState(SIGNED_OUT);
}
