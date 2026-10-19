import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PATHS } from '@/app/paths';
import type { SessionState } from '@/auth/session';
import { loadDemoData, resetAll } from '@/db/actions';
import { db } from '@/db/db';
import { resetUiState, useUiStore } from '@/state/ui';
import SettingsScreen from './SettingsScreen';

/** Stands in for the Supabase session (src/auth/session.ts): unconfigured unless a test says so. */
const auth = vi.hoisted(() => ({
  configured: false,
  state: { status: 'unconfigured' } as SessionState,
  sendSignInCode: vi.fn<(email: string) => Promise<void>>(async () => {}),
  verifySignInCode: vi.fn<(email: string, code: string) => Promise<void>>(async () => {}),
  signOut: vi.fn<() => Promise<void>>(async () => {}),
}));

vi.mock('@/auth/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/session')>()),
  isAuthConfigured: () => auth.configured,
  useSession: () => auth.state,
  sendSignInCode: (email: string) => auth.sendSignInCode(email),
  verifySignInCode: (email: string, code: string) => auth.verifySignInCode(email, code),
  signOut: () => auth.signOut(),
}));

/** Where supabase-js keeps the deployed app's session (src/auth/supabase.ts storageKeyFor). */
const STORAGE_KEY = 'kira-makan:sb-abcdefgh-auth';
const CODE_REQUEST_KEY = `${STORAGE_KEY}-code-request`;
const EMAIL = 'fabian@example.com';

/** The deployed app: Supabase configured, with this session. */
function deployed(state: SessionState): void {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://abcdefgh.supabase.co');
  vi.stubEnv('VITE_SUPABASE_KEY', 'sb_publishable_test_key');
  auth.configured = true;
  auth.state = state;
}

const MODE_HELP = {
  auto: "Only when the offline estimator can't match everything you typed. Cheapest.",
  always: 'Every typed meal and photo goes to the AI.',
  off: 'Offline estimates only. Nothing leaves your phone.',
};

function renderSettings() {
  const router = createMemoryRouter(
    [
      { path: '/more/settings', element: <SettingsScreen /> },
      { path: '/more', element: <h1>More screen</h1> },
      { path: '/more/export', element: <h1>Export screen</h1> },
      { path: '/more/weight', element: <h1>Weight screen</h1> },
      { path: '/more/soon/:what', element: <h1>Soon screen</h1> },
      { path: '/setup/*', element: <h1>Setup screen</h1> },
    ],
    { initialEntries: [PATHS.settings] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(async () => {
  vi.stubEnv('VITE_ESTIMATE_URL', '');
  vi.stubEnv('VITE_SUPABASE_URL', '');
  vi.stubEnv('VITE_SUPABASE_KEY', '');
  auth.configured = false;
  auth.state = { status: 'unconfigured' };
  auth.sendSignInCode.mockReset().mockResolvedValue(undefined);
  auth.verifySignInCode.mockReset().mockResolvedValue(undefined);
  auth.signOut.mockReset().mockResolvedValue(undefined);
  await resetAll();
  resetUiState();
  await loadDemoData();
});

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  window.localStorage.clear();
  await resetAll();
});

async function confirmDeleteEverything(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(await screen.findByRole('button', { name: /^Delete everything/ }));
  const dialog = await screen.findByRole('alertdialog', { name: 'Delete everything?' });
  await user.type(within(dialog).getByRole('textbox'), 'DELETE');
  await user.click(within(dialog).getByRole('button', { name: 'Delete everything' }));
}

/** A signed-in phone: the session, its user record and a code request in localStorage. */
function storeSignedInPhone(): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ access_token: 'access', refresh_token: 'refresh', expires_at: 2_000_000_000 }));
  window.localStorage.setItem(`${STORAGE_KEY}-user`, JSON.stringify({ user: { email: EMAIL } }));
  window.localStorage.setItem(CODE_REQUEST_KEY, JSON.stringify({ email: EMAIL, sentAt: Date.now() }));
}

function expectNoSessionStored(): void {
  expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  expect(window.localStorage.getItem(`${STORAGE_KEY}-user`)).toBeNull();
  expect(window.localStorage.getItem(CODE_REQUEST_KEY)).toBeNull();
}

describe('SettingsScreen (S19)', () => {
  it('shows the profile, budget and day settings from the demo profile', async () => {
    renderSettings();

    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /^Age/ })).toHaveTextContent('30');
    expect(screen.getByRole('button', { name: /^Sex/ })).toHaveTextContent('Male');
    expect(screen.getByRole('button', { name: /^Height/ })).toHaveTextContent('172 cm');
    expect(await screen.findByRole('button', { name: /^Weight/ })).toHaveTextContent('77.8 kg');
    expect(screen.getByRole('button', { name: /^Daily minimum/ })).toHaveTextContent('1,400 kcal');
    expect(screen.getByText('Weeks start on Monday')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Day rollover/ })).toHaveTextContent('5am');
    expect(screen.getAllByText('Your target changes through a suggestion you approve.').length).toBeGreaterThan(0);
    expect(screen.getByText("Estimates are approximate. This app isn't medical advice.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Leave demo and start fresh/ })).toBeInTheDocument();
  });

  it('writes the theme to the profile', async () => {
    const user = userEvent.setup();
    renderSettings();

    const theme = await screen.findByRole('group', { name: 'Theme' });
    expect(within(theme).getByRole('button', { name: 'System' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(theme).getByRole('button', { name: 'Dark' }));

    await waitFor(async () => expect((await db.profile.get('me'))?.theme).toBe('dark'));
    await waitFor(() => expect(within(theme).getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true'));
  });

  it('writes the location and photo toggles to the profile', async () => {
    const user = userEvent.setup();
    renderSettings();

    const location = await screen.findByRole('switch', { name: 'Location' });
    expect(location).toHaveAttribute('aria-checked', 'true');
    await user.click(location);
    await waitFor(async () => expect((await db.profile.get('me'))?.useLocation).toBe(false));

    await user.click(screen.getByRole('switch', { name: 'Keep photos' }));
    await waitFor(async () => expect((await db.profile.get('me'))?.keepPhotos).toBe(false));
  });

  it('edits the profile in a sheet without touching the target', async () => {
    const user = userEvent.setup();
    renderSettings();
    const versionsBefore = await db.goalVersions.toArray();

    await user.click(await screen.findByRole('button', { name: /^Height/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Profile and body' });
    const height = within(sheet).getByLabelText('Height');
    await user.clear(height);
    await user.type(height, '175');
    await user.click(within(sheet).getByRole('button', { name: 'Save' }));

    await waitFor(async () => expect((await db.profile.get('me'))?.heightCm).toBe(175));
    expect(await db.goalVersions.toArray()).toEqual(versionsBefore);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Profile and body' })).not.toBeInTheDocument());
  });

  it('changes the day rollover in a sheet', async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(await screen.findByRole('button', { name: /^Day rollover/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Day rollover' });
    await user.click(within(sheet).getByRole('button', { name: '4am' }));
    await user.click(within(sheet).getByRole('button', { name: 'Save' }));
    await waitFor(async () => expect((await db.profile.get('me'))?.rolloverHour).toBe(4));
  });

  it('only deletes everything after DELETE is typed', async () => {
    const user = userEvent.setup();
    const router = renderSettings();

    await user.click(await screen.findByRole('button', { name: /^Delete everything/ }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete everything?' });
    const confirm = within(dialog).getByRole('button', { name: 'Delete everything' });
    expect(confirm).toBeDisabled();

    const field = within(dialog).getByRole('textbox');
    await user.type(field, 'delete');
    expect(confirm).toBeDisabled();
    await user.clear(field);
    await user.type(field, 'DELETE');
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    expect(await screen.findByRole('heading', { name: 'Setup screen' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(PATHS.setup);
    expect(await db.profile.count()).toBe(0);
    expect(await db.meals.count()).toBe(0);
  });

  it('cancelling the delete dialog keeps the data', async () => {
    const user = userEvent.setup();
    renderSettings();

    await user.click(await screen.findByRole('button', { name: /^Delete everything/ }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete everything?' });
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(await db.meals.count()).toBeGreaterThan(0);
  });

  it('leaves demo mode for a fresh setup', async () => {
    const user = userEvent.setup();
    const router = renderSettings();

    await user.click(await screen.findByRole('button', { name: /Leave demo and start fresh/ }));
    expect(await screen.findByRole('heading', { name: 'Setup screen' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe(PATHS.setup);
    expect(await db.profile.count()).toBe(0);
  });

  it('links to export, reminders and backups', async () => {
    const user = userEvent.setup();
    const router = renderSettings();

    await user.click(await screen.findByRole('button', { name: /^Export/ }));
    expect(router.state.location.pathname).toBe(PATHS.export);
    await router.navigate(PATHS.settings);
    await user.click(await screen.findByRole('button', { name: /^Backups/ }));
    expect(router.state.location.pathname).toBe(PATHS.soon('backups'));
    await router.navigate(PATHS.settings);
    await user.click(await screen.findByRole('button', { name: /^Reminders/ }));
    expect(router.state.location.pathname).toBe(PATHS.soon('reminders'));
  });
});

describe('SettingsScreen Delete everything and the account', () => {
  it('signs this phone out and leaves no session behind', async () => {
    deployed({ status: 'signedIn', email: EMAIL });
    storeSignedInPhone();
    const user = userEvent.setup();
    renderSettings();

    await confirmDeleteEverything(user);

    expect(await screen.findByRole('heading', { name: 'Setup screen' })).toBeInTheDocument();
    expect(auth.signOut).toHaveBeenCalledTimes(1);
    expectNoSessionStored();
    expect(await db.profile.count()).toBe(0);
    expect(useUiStore.getState().toast?.message).toBe('Everything on this phone is deleted');
  });

  it('still deletes everything and forgets the session when signing out fails', async () => {
    deployed({ status: 'signedIn', email: EMAIL });
    storeSignedInPhone();
    auth.signOut.mockRejectedValue(new Error('nope'));
    const user = userEvent.setup();
    renderSettings();

    await confirmDeleteEverything(user);

    expect(await screen.findByRole('heading', { name: 'Setup screen' })).toBeInTheDocument();
    expectNoSessionStored();
    expect(await db.meals.count()).toBe(0);
    expect(useUiStore.getState().toast?.message).toBe('Everything on this phone is deleted');
  });

  it("doesn't wait long for a sign-out that never answers", async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    deployed({ status: 'signedIn', email: EMAIL });
    storeSignedInPhone();
    auth.signOut.mockReturnValue(new Promise<void>(() => {}));
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    renderSettings();

    await confirmDeleteEverything(user);
    await waitFor(() => expect(auth.signOut).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('heading', { name: 'Setup screen' })).not.toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(3_000);

    expect(await screen.findByRole('heading', { name: 'Setup screen' })).toBeInTheDocument();
    expectNoSessionStored();
  });

  it('reopens sign-in on the code step for a code asked for earlier', async () => {
    deployed({ status: 'signedOut' });
    window.localStorage.setItem(CODE_REQUEST_KEY, JSON.stringify({ email: EMAIL, sentAt: Date.now() - 10_000 }));
    const user = userEvent.setup();
    renderSettings();

    await user.click(await screen.findByRole('button', { name: /^Account/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Sign in for AI estimates' });
    expect(within(sheet).getByText(/We sent a 6-digit code to/)).toHaveTextContent(EMAIL);
    expect(within(sheet).getByRole('button', { name: /^Send a new code in \d+s$/ })).toBeDisabled();
    await user.type(within(sheet).getByLabelText('Code'), '123456');
    await user.click(within(sheet).getByRole('button', { name: 'Sign in' }));

    expect(auth.verifySignInCode).toHaveBeenCalledWith(EMAIL, '123456');
    expect(auth.sendSignInCode).not.toHaveBeenCalled();
  });

  it('starts sign-in from the email step once the last code has run out', async () => {
    deployed({ status: 'signedOut' });
    window.localStorage.setItem(CODE_REQUEST_KEY, JSON.stringify({ email: EMAIL, sentAt: Date.now() - 2 * 60 * 60_000 }));
    const user = userEvent.setup();
    renderSettings();

    await user.click(await screen.findByRole('button', { name: /^Account/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Sign in for AI estimates' });
    expect(within(sheet).getByLabelText('Email')).toHaveValue('');
    expect(within(sheet).queryByRole('button', { name: 'I have a code' })).not.toBeInTheDocument();
  });
});

describe('SettingsScreen AI estimates', () => {
  it('leaves the group out when no AI endpoint is set up', async () => {
    renderSettings();

    expect(await screen.findByRole('button', { name: /^Age/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'AI estimates' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    expect(screen.queryByText('Account')).not.toBeInTheDocument();
  });

  it('in local dev, offers the modes without an account and says where AI runs', async () => {
    vi.stubEnv('VITE_ESTIMATE_URL', '/api/estimate');
    renderSettings();

    const modes = await screen.findByRole('radiogroup', { name: 'When to use AI' });
    expect(screen.getAllByRole('heading', { level: 2 })[0]).toHaveTextContent('AI estimates');
    expect(screen.getByText('AI estimates run through the dev server.')).toBeInTheDocument();
    expect(screen.queryByText('Account')).not.toBeInTheDocument();

    expect(within(modes).getByRole('radio', { name: /^When needed/ })).toHaveAttribute('aria-checked', 'true');
    expect(within(modes).getByRole('radio', { name: /^Always/ })).toHaveAttribute('aria-checked', 'false');
    expect(within(modes).getByRole('radio', { name: /^Off/ })).toHaveAttribute('aria-checked', 'false');
    expect(within(modes).getByText(MODE_HELP.auto)).toBeInTheDocument();
    expect(within(modes).getByText(MODE_HELP.always)).toBeInTheDocument();
    expect(within(modes).getByText(MODE_HELP.off)).toBeInTheDocument();
  });

  it('in production without sign-in, shows no dev note', async () => {
    vi.stubEnv('VITE_ESTIMATE_URL', 'https://estimate.test/api/estimate');
    vi.stubEnv('DEV', false);
    renderSettings();

    expect(await screen.findByRole('radiogroup', { name: 'When to use AI' })).toBeInTheDocument();
    expect(screen.queryByText('AI estimates run through the dev server.')).not.toBeInTheDocument();
    expect(screen.queryByText('Account')).not.toBeInTheDocument();
  });

  it('saves the mode to the profile', async () => {
    vi.stubEnv('VITE_ESTIMATE_URL', '/api/estimate');
    const user = userEvent.setup();
    renderSettings();

    await user.click(await screen.findByRole('radio', { name: /^Always/ }));
    await waitFor(async () => expect((await db.profile.get('me'))?.aiEstimates).toBe('always'));
    await waitFor(() => expect(screen.getByRole('radio', { name: /^Always/ })).toHaveAttribute('aria-checked', 'true'));

    await user.click(screen.getByRole('radio', { name: /^Off/ }));
    await waitFor(async () => expect((await db.profile.get('me'))?.aiEstimates).toBe('off'));
    await waitFor(() => expect(screen.getByRole('radio', { name: /^Off/ })).toHaveAttribute('aria-checked', 'true'));

    // Arrow keys move the choice too.
    await user.keyboard('{ArrowUp}');
    await waitFor(async () => expect((await db.profile.get('me'))?.aiEstimates).toBe('always'));
  });

  it('shows a saved mode', async () => {
    vi.stubEnv('VITE_ESTIMATE_URL', '/api/estimate');
    await db.profile.update('me', { aiEstimates: 'off' });
    renderSettings();

    await waitFor(() => expect(screen.getByRole('radio', { name: /^Off/ })).toHaveAttribute('aria-checked', 'true'));
  });

  it('signs in through the sheet when signed out', async () => {
    deployed({ status: 'signedOut' });
    const user = userEvent.setup();
    renderSettings();

    expect(await screen.findByText('Until you sign in, estimates stay offline.')).toBeInTheDocument();
    expect(screen.queryByText('AI estimates run through the dev server.')).not.toBeInTheDocument();
    const account = screen.getByRole('button', { name: /^Account/ });
    expect(account).toHaveTextContent('Sign in for AI estimates');
    await user.click(account);

    const sheet = await screen.findByRole('dialog', { name: 'Sign in for AI estimates' });
    await user.type(within(sheet).getByLabelText('Email'), 'fabian@example.com');
    await user.click(within(sheet).getByRole('button', { name: 'Send code' }));
    expect(auth.sendSignInCode).toHaveBeenCalledWith('fabian@example.com');

    expect(await within(sheet).findByText(/We sent a 6-digit code to/)).toHaveTextContent('fabian@example.com');
    await user.type(within(sheet).getByLabelText('Code'), '123456');
    await user.click(within(sheet).getByRole('button', { name: 'Sign in' }));
    expect(auth.verifySignInCode).toHaveBeenCalledWith('fabian@example.com', '123456');

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Sign in for AI estimates' })).not.toBeInTheDocument());
    expect(useUiStore.getState().toast?.message).toBe('Signed in');
  });

  it('keeps the sheet open with the error when the code is wrong', async () => {
    deployed({ status: 'signedOut' });
    auth.verifySignInCode.mockRejectedValue(new Error('That code is wrong or has expired. Check it, or send a new code.'));
    const user = userEvent.setup();
    renderSettings();

    await user.click(await screen.findByRole('button', { name: /^Account/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Sign in for AI estimates' });
    await user.type(within(sheet).getByLabelText('Email'), 'fabian@example.com');
    await user.click(within(sheet).getByRole('button', { name: 'Send code' }));
    await user.type(await within(sheet).findByLabelText('Code'), '000000');
    await user.click(within(sheet).getByRole('button', { name: 'Sign in' }));

    expect(await within(sheet).findByRole('alert')).toHaveTextContent('That code is wrong or has expired.');
    expect(screen.getByRole('dialog', { name: 'Sign in for AI estimates' })).toBeInTheDocument();
    expect(useUiStore.getState().toast).toBeNull();
  });

  it('shows who is signed in and signs out', async () => {
    deployed({ status: 'signedIn', email: 'fabian@example.com' });
    const user = userEvent.setup();
    renderSettings();

    expect(await screen.findByText('Signed in as fabian@example.com')).toBeInTheDocument();
    expect(screen.queryByText('Until you sign in, estimates stay offline.')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(auth.signOut).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(useUiStore.getState().toast?.message).toBe('Signed out'));
  });

  it('says so when signing out fails', async () => {
    deployed({ status: 'signedIn', email: 'fabian@example.com' });
    auth.signOut.mockRejectedValue(new Error('nope'));
    const user = userEvent.setup();
    renderSettings();

    await user.click(await screen.findByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(useUiStore.getState().toast?.message).toBe("Couldn't sign out. Try again."));
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled();
  });

  it('has no sign-in note when AI is off', async () => {
    deployed({ status: 'signedOut' });
    await db.profile.update('me', { aiEstimates: 'off' });
    renderSettings();

    await waitFor(() => expect(screen.getByRole('radio', { name: /^Off/ })).toHaveAttribute('aria-checked', 'true'));
    expect(screen.queryByText('Until you sign in, estimates stay offline.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Account/ })).toBeInTheDocument();
  });
});
