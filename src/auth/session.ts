/**
 * Sign-in for the AI estimate function. Sign-in exists only to protect that function: the rest
 * of the app works offline without an account, and without Supabase configured (local dev) AI
 * calls go to the dev endpoint without a token.
 *
 * - isAuthConfigured(): true when VITE_SUPABASE_URL and VITE_SUPABASE_KEY are set (deployed app).
 * - getAccessToken(): the signed-in user's access token, refreshed first when it runs out within
 *   60 s; null when signed out or unconfigured. Rejects when the session can't be checked (a
 *   refresh that failed on a bad connection), so callers report the connection, not a sign-out.
 * - useSession(): live session state for the UI, from one shared subscription.
 * - sendSignInCode(email) / verifySignInCode(email, code): a 6-digit code by email (no links,
 *   because an emailed link opens Safari instead of the installed iPhone app). New accounts are
 *   never created here; the server allow-lists emails as well.
 * - readCodeRequest(): the last code this phone asked for while it still works, so a closed sheet
 *   or a relaunched app goes back to the code step instead of spending another email.
 * - signOut(): forgets this phone's session.
 *
 * Errors are SignInError with copy the UI shows as is. Nothing here logs tokens or codes.
 */
import { useSyncExternalStore } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import {
  clearStoredSession,
  codeRequestKeyFor,
  getSupabase,
  hasStoredSession,
  readSupabaseConfig,
  sessionStorageAdapter,
} from './supabase';

export type SessionStatus = 'unconfigured' | 'loading' | 'signedOut' | 'signedIn';

export interface SessionState {
  status: SessionStatus;
  email?: string;
}

/** Supabase's email one-time codes are 6 digits. */
export const SIGN_IN_CODE_LENGTH = 6;
/** Supabase sends one address a code at most once a minute. */
export const RESEND_COOLDOWN_SECONDS = 60;
/** Supabase's email codes work for an hour unless the project changes it. */
export const SIGN_IN_CODE_VALID_MS = 60 * 60_000;
/** Tokens that run out sooner than this are refreshed before use. */
const REFRESH_MARGIN_MS = 60_000;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type SignInErrorKind =
  | 'invalidEmail'
  | 'invalidCode'
  | 'notAllowed'
  | 'rateLimited'
  | 'wrongCode'
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
  codeMissing: 'Enter the 6-digit code from the email.',
  codeInvalid: 'The code is 6 digits.',
  notAllowed: "That email can't sign in to this app.",
  sendTooSoon: 'Too many codes asked for. Wait a minute and try again.',
  sendRateLimited: 'Too many codes sent for now. Enter the last code you got, or try again later.',
  verifyRateLimited: 'Too many tries. Wait a minute and try again.',
  wrongCode: 'That code is wrong or has expired. Check it, or send a new code.',
  offline: "No connection. Try again when you're online.",
  unavailable: "Sign-in isn't answering right now. Try again in a minute.",
  emailSignInOff: 'Email sign-in is turned off for this app.',
  unconfigured: "Sign-in isn't set up in this version of the app.",
  sendFailed: "Couldn't send a code right now. Try again.",
  verifyFailed: "Couldn't sign in right now. Try again.",
} as const;

type Step = 'send' | 'verify';

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

/*
 * Both of Supabase's email limits answer 429 over_email_send_rate_limit: one code per address a
 * minute ("For security purposes, you can only request this after 42 seconds.") and a few emails
 * an hour for the whole project (2 with the built-in mailer: "email rate limit exceeded").
 */
const TOO_SOON = /\bafter \d+ seconds?\b/i;

const NOT_ALLOWED_CODES = new Set(['otp_disabled', 'signup_disabled', 'user_not_found', 'user_banned', 'email_address_not_authorized']);
const RATE_LIMIT_CODES = new Set(['over_email_send_rate_limit', 'over_request_rate_limit']);
const WRONG_CODE_CODES = new Set(['otp_expired', 'invalid_credentials', 'validation_failed']);

/** Maps a Supabase Auth error (or a thrown fetch failure) to a SignInError. */
export function toSignInError(error: unknown, step: Step): SignInError {
  if (error instanceof SignInError) return error;
  const { name, code, status, message } = partsOf(error);
  const failed = step === 'send' ? SIGN_IN_MESSAGES.sendFailed : SIGN_IN_MESSAGES.verifyFailed;

  if (name === 'AuthRetryableFetchError') {
    return status ? new SignInError('unavailable', SIGN_IN_MESSAGES.unavailable) : new SignInError('offline', SIGN_IN_MESSAGES.offline);
  }
  if (error instanceof TypeError) return new SignInError('offline', SIGN_IN_MESSAGES.offline);
  if (status === 429 || (code !== undefined && RATE_LIMIT_CODES.has(code))) {
    if (step === 'verify') return new SignInError('rateLimited', SIGN_IN_MESSAGES.verifyRateLimited);
    const tooSoon = message !== undefined && TOO_SOON.test(message);
    return new SignInError('rateLimited', tooSoon ? SIGN_IN_MESSAGES.sendTooSoon : SIGN_IN_MESSAGES.sendRateLimited);
  }
  if (code === 'email_provider_disabled') return new SignInError('unavailable', SIGN_IN_MESSAGES.emailSignInOff);
  if (step === 'send') {
    // shouldCreateUser: false answers an unknown email with otp_disabled ("Signups not allowed for otp").
    if (code !== undefined && NOT_ALLOWED_CODES.has(code)) return new SignInError('notAllowed', SIGN_IN_MESSAGES.notAllowed);
    if (code === 'validation_failed' || code === 'email_address_invalid') {
      return new SignInError('invalidEmail', SIGN_IN_MESSAGES.emailInvalid);
    }
  } else if ((code !== undefined && WRONG_CODE_CODES.has(code)) || status === 403) {
    // Supabase answers both a mistyped and an expired code with otp_expired (403).
    return new SignInError('wrongCode', SIGN_IN_MESSAGES.wrongCode);
  }
  if (status !== undefined && status >= 500) return new SignInError('unavailable', SIGN_IN_MESSAGES.unavailable);
  return new SignInError('unknown', failed);
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

/** The code's digits (spaces and dashes from a paste dropped), or a SignInError. */
export function normaliseCode(code: string): string {
  const digits = code.replace(/[\s-]/g, '');
  if (digits === '') throw new SignInError('invalidCode', SIGN_IN_MESSAGES.codeMissing);
  if (!new RegExp(`^\\d{${SIGN_IN_CODE_LENGTH}}$`).test(digits)) throw new SignInError('invalidCode', SIGN_IN_MESSAGES.codeInvalid);
  return digits;
}

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

// ---------------------------------------------------------------------------
// The last code request: the address and when, never the code
// ---------------------------------------------------------------------------

export interface CodeRequest {
  email: string;
  /** Epoch ms when the code went out. */
  sentAt: number;
}

function codeRequestKey(): string | null {
  const config = readSupabaseConfig();
  return config ? codeRequestKeyFor(config.url) : null;
}

function rememberCodeRequest(email: string): void {
  const key = codeRequestKey();
  if (key) sessionStorageAdapter.setItem(key, JSON.stringify({ email, sentAt: Date.now() } satisfies CodeRequest));
}

function forgetCodeRequest(): void {
  const key = codeRequestKey();
  if (key) sessionStorageAdapter.removeItem(key);
}

function parseCodeRequest(stored: string): CodeRequest | null {
  try {
    const value: unknown = JSON.parse(stored);
    if (typeof value !== 'object' || value === null) return null;
    const { email, sentAt } = value as Record<string, unknown>;
    if (typeof email !== 'string' || email === '' || typeof sentAt !== 'number' || !Number.isFinite(sentAt)) return null;
    return { email, sentAt };
  } catch {
    return null;
  }
}

/**
 * The last code this phone asked for, while it still works (under an hour old). Each new code
 * replaces the last one and the built-in mailer sends only 2 emails an hour, so the sign-in panel
 * reopens on this code instead of asking for another.
 */
export function readCodeRequest(): CodeRequest | null {
  const key = codeRequestKey();
  if (!key) return null;
  const stored = sessionStorageAdapter.getItem(key);
  if (stored === null) return null;
  const request = parseCodeRequest(stored);
  const age = request ? Date.now() - request.sentAt : Number.NaN;
  if (request && age >= 0 && age < SIGN_IN_CODE_VALID_MS) return request;
  sessionStorageAdapter.removeItem(key);
  return null;
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

function readState(): SessionState {
  return state ?? (isAuthConfigured() ? LOADING : UNCONFIGURED);
}

function setState(next: SessionState): void {
  if (state && state.status === next.status && state.email === next.email) return;
  state = next;
  for (const listener of [...listeners]) listener();
}

function stateFor(session: Session | null): SessionState {
  if (!session) return SIGNED_OUT;
  const email = session.user.email;
  return email ? { status: 'signedIn', email } : { status: 'signedIn' };
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
      setState(stateFor(session));
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
  return useSyncExternalStore(subscribe, readState, readState);
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

export async function getAccessToken(): Promise<string | null> {
  if (!isAuthConfigured()) return null;
  // supabase-js not loading, or getSession throwing, rejects too: the session couldn't be checked.
  const client = await getSupabase();
  if (!client) return null;
  // getSession itself refreshes a token that runs out within 90 s.
  const { data, error } = await client.auth.getSession();
  const session = data.session;
  if (!session) return throwUnlessSignedOut(error);
  if (!expiresWithin(session, REFRESH_MARGIN_MS)) return session.access_token;
  const refreshed = await client.auth.refreshSession();
  if (refreshed.data.session) return refreshed.data.session.access_token;
  // Couldn't refresh (offline): the old token still works until it runs out.
  if (!expiresWithin(session, 0)) return session.access_token;
  return throwUnlessSignedOut(refreshed.error ?? new Error('The session ran out and could not be refreshed.'));
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

/** Emails a 6-digit code to an existing account. Never creates an account. */
export async function sendSignInCode(email: string): Promise<void> {
  const address = normaliseEmail(email);
  if (isOffline()) throw new SignInError('offline', SIGN_IN_MESSAGES.offline);
  const client = await requireClient();
  let error: unknown;
  try {
    ({ error } = await client.auth.signInWithOtp({ email: address, options: { shouldCreateUser: false } }));
  } catch (thrown) {
    error = thrown;
  }
  if (error) throw toSignInError(error, 'send');
  rememberCodeRequest(address);
}

/** Signs in with the emailed code. */
export async function verifySignInCode(email: string, code: string): Promise<void> {
  const address = normaliseEmail(email);
  const token = normaliseCode(code);
  if (isOffline()) throw new SignInError('offline', SIGN_IN_MESSAGES.offline);
  const client = await requireClient();
  let session: Session | null = null;
  try {
    const { data, error } = await client.auth.verifyOtp({ email: address, token, type: 'email' });
    if (error) throw error;
    session = data.session;
  } catch (thrown) {
    throw toSignInError(thrown, 'verify');
  }
  if (!session) throw new SignInError('unknown', SIGN_IN_MESSAGES.verifyFailed);
  forgetCodeRequest();
  heardFromAuth = true;
  setState(stateFor(session));
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
