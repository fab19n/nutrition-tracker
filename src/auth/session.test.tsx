import { act, render, screen, waitFor } from '@testing-library/react';
import { AuthApiError, AuthRetryableFetchError, createClient, type Session } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SIGN_IN_MESSAGES,
  SignInError,
  getAccessToken,
  isAuthConfigured,
  resetSessionForTests,
  signIn,
  signOut,
  toSignInError,
  useSession,
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
    signInWithPassword: vi.fn<(credentials: unknown) => Promise<unknown>>(),
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
const EMAIL = 'fabian@example.com';
const PASSWORD = 'correct horse battery staple';
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
  fake.auth.signInWithPassword.mockReset().mockResolvedValue({ data: { user: null, session: null }, error: null });
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

describe('signIn', () => {
  beforeEach(configure);

  it('signs in with the trimmed email and the password as typed', async () => {
    fake.auth.signInWithPassword.mockResolvedValue({ data: { user: sessionFor().user, session: sessionFor() }, error: null });
    render(<SessionProbe label="a" />);
    await waitFor(() => expect(screen.getByTestId('a')).toHaveTextContent('signedOut'));

    await act(() => signIn('  Fabian@Example.com ', ` ${PASSWORD} `));

    expect(fake.auth.signInWithPassword).toHaveBeenCalledWith({ email: EMAIL, password: ` ${PASSWORD} ` });
    expect(screen.getByTestId('a')).toHaveTextContent(`signedIn ${EMAIL}`);
  });

  it('checks the email and password before asking Supabase', async () => {
    await expect(signIn('   ', PASSWORD)).rejects.toThrow(SIGN_IN_MESSAGES.emailMissing);
    await expect(signIn('fabian@example', PASSWORD)).rejects.toThrow(SIGN_IN_MESSAGES.emailInvalid);
    await expect(signIn('not an email', PASSWORD)).rejects.toMatchObject({ kind: 'invalidEmail' });
    await expect(signIn(EMAIL, '')).rejects.toMatchObject({ kind: 'missingPassword', message: SIGN_IN_MESSAGES.passwordMissing });
    expect(fake.auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('explains a wrong email or password without saying which', async () => {
    // Supabase answers an unknown email and a wrong password alike: 400 invalid_credentials.
    fake.auth.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: new AuthApiError('Invalid login credentials', 400, 'invalid_credentials'),
    });
    const failure = signIn(EMAIL, 'wrong-password');
    await expect(failure).rejects.toBeInstanceOf(SignInError);
    await expect(failure).rejects.toMatchObject({ kind: 'wrongPassword', message: 'Wrong email or password.' });
  });

  it('explains an account that was never confirmed', async () => {
    fake.auth.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: new AuthApiError('Email not confirmed', 400, 'email_not_confirmed'),
    });
    await expect(signIn(EMAIL, PASSWORD)).rejects.toMatchObject({ kind: 'notConfirmed', message: SIGN_IN_MESSAGES.notConfirmed });
  });

  it('explains too many tries', async () => {
    fake.auth.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: new AuthApiError('Request rate limit reached', 429, 'over_request_rate_limit'),
    });
    await expect(signIn(EMAIL, PASSWORD)).rejects.toMatchObject({ kind: 'rateLimited', message: SIGN_IN_MESSAGES.rateLimited });
  });

  it('explains a lost connection', async () => {
    fake.auth.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: new AuthRetryableFetchError('Failed to fetch', 0),
    });
    await expect(signIn(EMAIL, PASSWORD)).rejects.toThrow("No connection. Try again when you're online.");
  });

  it('explains a thrown network failure', async () => {
    fake.auth.signInWithPassword.mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(signIn(EMAIL, PASSWORD)).rejects.toMatchObject({ kind: 'offline' });
  });

  it("doesn't try while the phone is offline", async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    await expect(signIn(EMAIL, PASSWORD)).rejects.toMatchObject({ kind: 'offline', message: SIGN_IN_MESSAGES.offline });
    expect(fake.auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('fails when Supabase answers without a session', async () => {
    await expect(signIn(EMAIL, PASSWORD)).rejects.toMatchObject({ kind: 'unknown', message: SIGN_IN_MESSAGES.failed });
  });

  it('refuses when sign-in is not configured', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    await expect(signIn(EMAIL, PASSWORD)).rejects.toMatchObject({ kind: 'unconfigured' });
    expect(fake.auth.signInWithPassword).not.toHaveBeenCalled();
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

describe('toSignInError', () => {
  it('maps Supabase errors to the copy the UI shows', () => {
    expect(toSignInError(new AuthApiError('Invalid login credentials', 400, 'invalid_credentials')).kind).toBe('wrongPassword');
    // Older Auth servers send the message without an error code.
    expect(toSignInError(new AuthApiError('Invalid login credentials', 400, undefined)).kind).toBe('wrongPassword');
    expect(toSignInError(new AuthApiError('User is banned', 400, 'user_banned')).kind).toBe('notAllowed');
    expect(toSignInError(new AuthApiError('Too many', 429, undefined)).message).toBe(SIGN_IN_MESSAGES.rateLimited);
    expect(toSignInError(new AuthApiError('Email logins are disabled', 400, 'email_provider_disabled')).message).toBe(
      SIGN_IN_MESSAGES.emailSignInOff,
    );
    expect(toSignInError(new AuthApiError('Invalid email', 400, 'email_address_invalid')).kind).toBe('invalidEmail');
    expect(toSignInError(new AuthRetryableFetchError('Bad gateway', 502)).kind).toBe('unavailable');
    expect(toSignInError(new AuthApiError('Boom', 500, 'unexpected_failure')).kind).toBe('unavailable');
    expect(toSignInError(new AuthApiError('Odd', 400, 'validation_failed')).message).toBe(SIGN_IN_MESSAGES.failed);
    expect(toSignInError(new Error('odd')).message).toBe(SIGN_IN_MESSAGES.failed);
    expect(toSignInError('odd').message).toBe(SIGN_IN_MESSAGES.failed);
  });

  it('passes a SignInError through', () => {
    const error = new SignInError('offline', SIGN_IN_MESSAGES.offline);
    expect(toSignInError(error)).toBe(error);
  });
});

describe('logging', () => {
  it('never writes tokens or passwords to the console or storage', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) => vi.spyOn(console, method));
    configure();
    signedInWith(sessionFor({ expiresInS: 30 }));
    fake.auth.refreshSession.mockResolvedValue({ data: { session: sessionFor({ token: 'access-token-2' }), user: null }, error: null });
    fake.auth.signInWithPassword
      .mockResolvedValueOnce({ data: { user: null, session: null }, error: new AuthApiError('Invalid login credentials', 400, 'invalid_credentials') })
      .mockResolvedValueOnce({ data: { user: null, session: sessionFor() }, error: null });

    await getAccessToken();
    await expect(signIn(EMAIL, 'wrong-password')).rejects.toBeInstanceOf(SignInError);
    await signIn(EMAIL, PASSWORD);
    await signOut();

    const written = spies.flatMap((spy) => spy.mock.calls.flat().map(String)).join('\n');
    expect(written).not.toContain(TOKEN);
    expect(written).not.toContain('access-token-2');
    expect(written).not.toContain(PASSWORD);
    expect(written).not.toContain('wrong-password');
    const stored = Object.keys(window.localStorage).map((key) => window.localStorage.getItem(key) ?? '');
    expect(stored.join('\n')).not.toContain(PASSWORD);
    expect(stored.join('\n')).not.toContain('wrong-password');
  });
});
