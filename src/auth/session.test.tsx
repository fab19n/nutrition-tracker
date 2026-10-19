import { act, render, screen, waitFor } from '@testing-library/react';
import { AuthApiError, AuthRetryableFetchError, createClient, type Session } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SIGN_IN_CODE_VALID_MS,
  SIGN_IN_MESSAGES,
  SignInError,
  getAccessToken,
  isAuthConfigured,
  readCodeRequest,
  resetSessionForTests,
  sendSignInCode,
  signOut,
  toSignInError,
  useSession,
  verifySignInCode,
} from './session';
import { resetSupabaseForTests } from './supabase';

/** A stand-in for supabase-js's auth client; each test sets what it answers. */
const fake = vi.hoisted(() => {
  type Listener = (event: string, session: unknown) => void;
  const listeners: Listener[] = [];
  const unsubscribe = vi.fn();
  const auth = {
    onAuthStateChange: vi.fn((listener: Listener) => {
      listeners.push(listener);
      return { data: { subscription: { unsubscribe } } };
    }),
    getSession: vi.fn<() => Promise<unknown>>(),
    refreshSession: vi.fn<() => Promise<unknown>>(),
    signInWithOtp: vi.fn<(credentials: unknown) => Promise<unknown>>(),
    verifyOtp: vi.fn<(params: unknown) => Promise<unknown>>(),
    signOut: vi.fn<(options: unknown) => Promise<unknown>>(),
  };
  return {
    auth,
    listeners,
    unsubscribe,
    emit(event: string, session: unknown) {
      for (const listener of [...listeners]) listener(event, session);
    },
  };
});

vi.mock('@supabase/supabase-js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@supabase/supabase-js')>()),
  createClient: vi.fn(() => ({ auth: fake.auth })),
}));

const SUPABASE_URL = 'https://abcdefgh.supabase.co';
const STORAGE_KEY = 'kira-makan:sb-abcdefgh-auth';
const CODE_REQUEST_KEY = 'kira-makan:sb-abcdefgh-auth-code-request';
const EMAIL = 'fabian@example.com';
const TOKEN = 'access-token-1';

function configure(): void {
  vi.stubEnv('VITE_SUPABASE_URL', SUPABASE_URL);
  vi.stubEnv('VITE_SUPABASE_KEY', 'sb_publishable_test_key');
}

function sessionFor(opts: { token?: string; expiresInS?: number; email?: string } = {}): Session {
  const session = {
    access_token: opts.token ?? TOKEN,
    refresh_token: 'refresh-token',
    token_type: 'bearer',
    expires_in: opts.expiresInS ?? 3600,
    expires_at: Math.floor(Date.now() / 1000) + (opts.expiresInS ?? 3600),
    user: { id: 'user-1', email: opts.email ?? EMAIL, app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '' },
  };
  return session as Session;
}

function signedInWith(session: Session | null): void {
  fake.auth.getSession.mockResolvedValue({ data: { session }, error: null });
}

function SessionProbe({ label }: { label: string }) {
  const state = useSession();
  return (
    <p data-testid={label}>
      {state.status}
      {state.email ? ` ${state.email}` : ''}
    </p>
  );
}

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', '');
  vi.stubEnv('VITE_SUPABASE_KEY', '');
  resetSessionForTests();
  resetSupabaseForTests();
  fake.listeners.length = 0;
  vi.mocked(createClient).mockClear();
  fake.unsubscribe.mockClear();
  fake.auth.onAuthStateChange.mockClear();
  signedInWith(null);
  fake.auth.refreshSession.mockReset().mockResolvedValue({ data: { session: null, user: null }, error: null });
  fake.auth.signInWithOtp.mockReset().mockResolvedValue({ data: { user: null, session: null }, error: null });
  fake.auth.verifyOtp.mockReset().mockResolvedValue({ data: { user: null, session: null }, error: null });
  fake.auth.signOut.mockReset().mockResolvedValue({ error: null });
});

afterEach(() => {
  resetSessionForTests();
  resetSupabaseForTests();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('isAuthConfigured', () => {
  it('is true only with the Supabase URL and key', () => {
    expect(isAuthConfigured()).toBe(false);
    configure();
    expect(isAuthConfigured()).toBe(true);
  });
});

describe('useSession', () => {
  it('reports unconfigured without Supabase and never builds a client', async () => {
    render(<SessionProbe label="a" />);
    expect(screen.getByTestId('a')).toHaveTextContent('unconfigured');
    await act(async () => {});
    expect(createClient).not.toHaveBeenCalled();
  });

  it('loads the stored session once for every reader', async () => {
    configure();
    signedInWith(sessionFor());

    render(
      <>
        <SessionProbe label="a" />
        <SessionProbe label="b" />
      </>,
    );
    expect(screen.getByTestId('a')).toHaveTextContent('loading');

    await waitFor(() => expect(screen.getByTestId('a')).toHaveTextContent(`signedIn ${EMAIL}`));
    expect(screen.getByTestId('b')).toHaveTextContent(`signedIn ${EMAIL}`);
    expect(fake.auth.onAuthStateChange).toHaveBeenCalledTimes(1);
    expect(createClient).toHaveBeenCalledTimes(1);
  });

  it('follows auth events', async () => {
    configure();
    render(<SessionProbe label="a" />);
    await waitFor(() => expect(screen.getByTestId('a')).toHaveTextContent('signedOut'));

    act(() => fake.emit('SIGNED_IN', sessionFor({ email: 'other@example.com' })));
    expect(screen.getByTestId('a')).toHaveTextContent('signedIn other@example.com');

    act(() => fake.emit('SIGNED_OUT', null));
    expect(screen.getByTestId('a')).toHaveTextContent('signedOut');
  });

  it("prefers an auth event over a getSession answer that's older", async () => {
    configure();
    let answer: (value: unknown) => void = () => {};
    fake.auth.getSession.mockReturnValue(new Promise((resolve) => (answer = resolve)));

    render(<SessionProbe label="a" />);
    await waitFor(() => expect(fake.auth.onAuthStateChange).toHaveBeenCalled());
    act(() => fake.emit('SIGNED_OUT', null));
    await act(async () => answer({ data: { session: sessionFor() }, error: null }));

    expect(screen.getByTestId('a')).toHaveTextContent('signedOut');
  });
});

describe('sendSignInCode', () => {
  beforeEach(configure);

  it('trims the email and never creates an account', async () => {
    await sendSignInCode('  Fabian@Example.com ');
    expect(fake.auth.signInWithOtp).toHaveBeenCalledWith({ email: EMAIL, options: { shouldCreateUser: false } });
  });

  it('checks the email before asking Supabase', async () => {
    await expect(sendSignInCode('   ')).rejects.toThrow(SIGN_IN_MESSAGES.emailMissing);
    await expect(sendSignInCode('fabian@example')).rejects.toThrow(SIGN_IN_MESSAGES.emailInvalid);
    await expect(sendSignInCode('not an email')).rejects.toMatchObject({ kind: 'invalidEmail' });
    expect(fake.auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it("explains an email that can't sign in", async () => {
    // shouldCreateUser: false answers an unknown email with 422 otp_disabled.
    fake.auth.signInWithOtp.mockResolvedValue({
      data: { user: null, session: null },
      error: new AuthApiError('Signups not allowed for otp', 422, 'otp_disabled'),
    });
    const failure = sendSignInCode(EMAIL);
    await expect(failure).rejects.toBeInstanceOf(SignInError);
    await expect(failure).rejects.toThrow("That email can't sign in to this app.");
  });

  it('explains the one-code-a-minute limit', async () => {
    fake.auth.signInWithOtp.mockResolvedValue({
      data: { user: null, session: null },
      error: new AuthApiError('For security purposes, you can only request this after 42 seconds.', 429, 'over_email_send_rate_limit'),
    });
    await expect(sendSignInCode(EMAIL)).rejects.toThrow('Too many codes asked for. Wait a minute and try again.');
  });

  it("doesn't promise a minute when the hourly email limit is used up", async () => {
    // The built-in mailer sends 2 emails an hour for the whole project.
    fake.auth.signInWithOtp.mockResolvedValue({
      data: { user: null, session: null },
      error: new AuthApiError('email rate limit exceeded', 429, 'over_email_send_rate_limit'),
    });
    const failure = sendSignInCode(EMAIL);
    await expect(failure).rejects.toMatchObject({ kind: 'rateLimited', message: SIGN_IN_MESSAGES.sendRateLimited });
    await expect(failure).rejects.not.toThrow(/minute/);
  });

  it('remembers where the code went and when, never the code', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    await sendSignInCode('  Fabian@Example.com ');
    expect(readCodeRequest()).toEqual({ email: EMAIL, sentAt: 1_000_000 });
    expect(JSON.parse(window.localStorage.getItem(CODE_REQUEST_KEY) ?? 'null')).toEqual({ email: EMAIL, sentAt: 1_000_000 });
  });

  it("doesn't remember a code that wasn't sent", async () => {
    fake.auth.signInWithOtp.mockResolvedValue({
      data: { user: null, session: null },
      error: new AuthApiError('Signups not allowed for otp', 422, 'otp_disabled'),
    });
    await expect(sendSignInCode(EMAIL)).rejects.toBeInstanceOf(SignInError);
    expect(readCodeRequest()).toBeNull();
  });

  it('explains a lost connection', async () => {
    fake.auth.signInWithOtp.mockResolvedValue({
      data: { user: null, session: null },
      error: new AuthRetryableFetchError('Failed to fetch', 0),
    });
    await expect(sendSignInCode(EMAIL)).rejects.toThrow("No connection. Try again when you're online.");
  });

  it("doesn't try while the phone is offline", async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    await expect(sendSignInCode(EMAIL)).rejects.toMatchObject({ kind: 'offline', message: SIGN_IN_MESSAGES.offline });
    expect(fake.auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it('refuses when sign-in is not configured', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    await expect(sendSignInCode(EMAIL)).rejects.toMatchObject({ kind: 'unconfigured' });
  });
});

describe('verifySignInCode', () => {
  beforeEach(configure);

  it('verifies a 6-digit email code and signs in', async () => {
    fake.auth.verifyOtp.mockResolvedValue({ data: { user: sessionFor().user, session: sessionFor() }, error: null });
    render(<SessionProbe label="a" />);
    await waitFor(() => expect(screen.getByTestId('a')).toHaveTextContent('signedOut'));

    await act(() => verifySignInCode(' Fabian@example.com', '123 456'));

    expect(fake.auth.verifyOtp).toHaveBeenCalledWith({ email: EMAIL, token: '123456', type: 'email' });
    expect(screen.getByTestId('a')).toHaveTextContent(`signedIn ${EMAIL}`);
  });

  it('forgets the code request once signed in, and keeps it after a wrong code', async () => {
    await sendSignInCode(EMAIL);
    fake.auth.verifyOtp.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: new AuthApiError('Token has expired or is invalid', 403, 'otp_expired'),
    });
    await expect(verifySignInCode(EMAIL, '000000')).rejects.toMatchObject({ kind: 'wrongCode' });
    expect(readCodeRequest()?.email).toBe(EMAIL);

    fake.auth.verifyOtp.mockResolvedValueOnce({ data: { user: sessionFor().user, session: sessionFor() }, error: null });
    await verifySignInCode(EMAIL, '123456');
    expect(readCodeRequest()).toBeNull();
    expect(window.localStorage.getItem(CODE_REQUEST_KEY)).toBeNull();
  });

  it('checks the code before asking Supabase', async () => {
    await expect(verifySignInCode(EMAIL, '')).rejects.toThrow(SIGN_IN_MESSAGES.codeMissing);
    await expect(verifySignInCode(EMAIL, '12345')).rejects.toThrow(SIGN_IN_MESSAGES.codeInvalid);
    await expect(verifySignInCode(EMAIL, '12345a')).rejects.toMatchObject({ kind: 'invalidCode' });
    expect(fake.auth.verifyOtp).not.toHaveBeenCalled();
  });

  it('explains a wrong or expired code', async () => {
    fake.auth.verifyOtp.mockResolvedValue({
      data: { user: null, session: null },
      error: new AuthApiError('Token has expired or is invalid', 403, 'otp_expired'),
    });
    await expect(verifySignInCode(EMAIL, '000000')).rejects.toMatchObject({ kind: 'wrongCode', message: SIGN_IN_MESSAGES.wrongCode });
  });

  it('explains too many tries', async () => {
    fake.auth.verifyOtp.mockResolvedValue({
      data: { user: null, session: null },
      error: new AuthApiError('Request rate limit reached', 429, 'over_request_rate_limit'),
    });
    await expect(verifySignInCode(EMAIL, '000000')).rejects.toThrow(SIGN_IN_MESSAGES.verifyRateLimited);
  });

  it('explains a thrown network failure', async () => {
    fake.auth.verifyOtp.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(verifySignInCode(EMAIL, '123456')).rejects.toMatchObject({ kind: 'offline' });
  });
});

describe('getAccessToken', () => {
  it('is null without Supabase', async () => {
    expect(await getAccessToken()).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  it('is null when signed out', async () => {
    configure();
    expect(await getAccessToken()).toBeNull();
  });

  it("returns the session's token while it has more than a minute left", async () => {
    configure();
    signedInWith(sessionFor({ expiresInS: 600 }));
    expect(await getAccessToken()).toBe(TOKEN);
    expect(fake.auth.refreshSession).not.toHaveBeenCalled();
  });

  it('refreshes a token that runs out within 60 s', async () => {
    configure();
    signedInWith(sessionFor({ expiresInS: 30 }));
    fake.auth.refreshSession.mockResolvedValue({ data: { session: sessionFor({ token: 'access-token-2' }), user: null }, error: null });

    expect(await getAccessToken()).toBe('access-token-2');
    expect(fake.auth.refreshSession).toHaveBeenCalledTimes(1);
  });

  it('keeps the old token when a refresh fails before it runs out', async () => {
    configure();
    signedInWith(sessionFor({ expiresInS: 30 }));
    fake.auth.refreshSession.mockResolvedValue({ data: { session: null, user: null }, error: new AuthRetryableFetchError('Failed to fetch', 0) });
    expect(await getAccessToken()).toBe(TOKEN);
  });

  it('rejects, not null, when a run-out token cannot be refreshed on a bad connection', async () => {
    configure();
    window.localStorage.setItem(STORAGE_KEY, '{"access_token":"stale"}');
    signedInWith(sessionFor({ expiresInS: -10 }));
    const offline = new AuthRetryableFetchError('Failed to fetch', 0);
    fake.auth.refreshSession.mockResolvedValue({ data: { session: null, user: null }, error: offline });
    await expect(getAccessToken()).rejects.toBe(offline);
  });

  it("rejects when getSession's own refresh failed on a bad connection", async () => {
    // auth-js 2.118: a token that has really run out and can't be refreshed for a network reason
    // stays stored, and getSession answers { session: null, error: AuthRetryableFetchError }.
    configure();
    window.localStorage.setItem(STORAGE_KEY, '{"access_token":"stale"}');
    const offline = new AuthRetryableFetchError('Failed to fetch', 0);
    fake.auth.getSession.mockResolvedValue({ data: { session: null }, error: offline });
    await expect(getAccessToken()).rejects.toBe(offline);
  });

  it('rejects when any refresh failure leaves the session stored', async () => {
    configure();
    window.localStorage.setItem(STORAGE_KEY, '{"access_token":"stale"}');
    const odd = new AuthApiError('Something odd', 400, 'unexpected_failure');
    fake.auth.getSession.mockResolvedValue({ data: { session: null }, error: odd });
    await expect(getAccessToken()).rejects.toBe(odd);
  });

  it('is null when the server refused the refresh token and the session is gone', async () => {
    configure();
    fake.auth.getSession.mockResolvedValue({
      data: { session: null },
      error: new AuthApiError('Invalid Refresh Token: Refresh Token Not Found', 400, 'refresh_token_not_found'),
    });
    expect(await getAccessToken()).toBeNull();
  });

  it('rejects when the session cannot be read', async () => {
    configure();
    fake.auth.getSession.mockRejectedValue(new Error('storage broke'));
    await expect(getAccessToken()).rejects.toThrow('storage broke');
  });

  it("rejects when supabase-js can't load", async () => {
    configure();
    vi.mocked(createClient).mockImplementationOnce(() => {
      throw new TypeError('Failed to fetch dynamically imported module');
    });
    await expect(getAccessToken()).rejects.toBeInstanceOf(TypeError);
  });
});

describe('signOut', () => {
  it('signs this phone out only', async () => {
    configure();
    signedInWith(sessionFor());
    render(<SessionProbe label="a" />);
    await waitFor(() => expect(screen.getByTestId('a')).toHaveTextContent('signedIn'));

    await act(() => signOut());

    expect(fake.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(screen.getByTestId('a')).toHaveTextContent('signedOut');
  });

  it('forgets the stored session when Supabase cannot be reached', async () => {
    configure();
    window.localStorage.setItem(STORAGE_KEY, '{"access_token":"stale"}');
    fake.auth.signOut.mockResolvedValue({ error: new AuthRetryableFetchError('Failed to fetch', 0) });

    await signOut();

    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('does nothing without Supabase', async () => {
    await signOut();
    expect(createClient).not.toHaveBeenCalled();
  });
});

describe('readCodeRequest', () => {
  beforeEach(configure);

  it('is null without Supabase or without a request', () => {
    expect(readCodeRequest()).toBeNull();
    vi.stubEnv('VITE_SUPABASE_URL', '');
    window.localStorage.setItem(CODE_REQUEST_KEY, JSON.stringify({ email: EMAIL, sentAt: Date.now() }));
    expect(readCodeRequest()).toBeNull();
  });

  it('drops a request once its code has run out', () => {
    const sentAt = Date.now() - SIGN_IN_CODE_VALID_MS;
    window.localStorage.setItem(CODE_REQUEST_KEY, JSON.stringify({ email: EMAIL, sentAt: sentAt + 1_000 }));
    expect(readCodeRequest()).toEqual({ email: EMAIL, sentAt: sentAt + 1_000 });

    window.localStorage.setItem(CODE_REQUEST_KEY, JSON.stringify({ email: EMAIL, sentAt }));
    expect(readCodeRequest()).toBeNull();
    expect(window.localStorage.getItem(CODE_REQUEST_KEY)).toBeNull();
  });

  it('ignores something that is not a request', () => {
    for (const junk of ['not json', 'null', '{"email":""}', '{"email":"a@b.co","sentAt":"soon"}']) {
      window.localStorage.setItem(CODE_REQUEST_KEY, junk);
      expect(readCodeRequest()).toBeNull();
    }
    // A request from the future (the clock moved back) isn't trusted either.
    window.localStorage.setItem(CODE_REQUEST_KEY, JSON.stringify({ email: EMAIL, sentAt: Date.now() + 60_000 }));
    expect(readCodeRequest()).toBeNull();
  });
});

describe('toSignInError', () => {
  it('maps Supabase errors to the copy the UI shows', () => {
    expect(toSignInError(new AuthApiError('Signups not allowed', 422, 'signup_disabled'), 'send').kind).toBe('notAllowed');
    expect(toSignInError(new AuthApiError('Not authorized', 400, 'email_address_not_authorized'), 'send').kind).toBe('notAllowed');
    expect(toSignInError(new AuthApiError('Too many', 429, undefined), 'send').message).toBe(SIGN_IN_MESSAGES.sendRateLimited);
    expect(toSignInError(new AuthApiError('Email logins are disabled', 400, 'email_provider_disabled'), 'send').message).toBe(
      SIGN_IN_MESSAGES.emailSignInOff,
    );
    expect(toSignInError(new AuthRetryableFetchError('Bad gateway', 502), 'send').kind).toBe('unavailable');
    expect(toSignInError(new AuthApiError('Boom', 500, 'unexpected_failure'), 'verify').kind).toBe('unavailable');
    expect(toSignInError(new AuthApiError('Invalid', 400, 'invalid_credentials'), 'verify').kind).toBe('wrongCode');
    expect(toSignInError(new Error('odd'), 'send').message).toBe(SIGN_IN_MESSAGES.sendFailed);
    expect(toSignInError('odd', 'verify').message).toBe(SIGN_IN_MESSAGES.verifyFailed);
  });
});

describe('logging', () => {
  it('never writes tokens or codes to the console', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) => vi.spyOn(console, method));
    configure();
    signedInWith(sessionFor({ expiresInS: 30 }));
    fake.auth.refreshSession.mockResolvedValue({ data: { session: sessionFor({ token: 'access-token-2' }), user: null }, error: null });
    fake.auth.verifyOtp.mockResolvedValue({ data: { user: null, session: sessionFor() }, error: null });

    await getAccessToken();
    await sendSignInCode(EMAIL);
    await verifySignInCode(EMAIL, '654321');
    await signOut();

    const written = spies.flatMap((spy) => spy.mock.calls.flat().map(String)).join('\n');
    expect(written).not.toContain(TOKEN);
    expect(written).not.toContain('access-token-2');
    expect(written).not.toContain('654321');
    const stored = Object.keys(window.localStorage).map((key) => window.localStorage.getItem(key) ?? '');
    expect(stored.join('\n')).not.toContain('654321');
  });
});
