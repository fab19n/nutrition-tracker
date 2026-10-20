import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionState } from '@/auth/session';
import { completeSetup, loadDemoData, resetAll, type SetupInput } from '@/db/actions';
import { db } from '@/db/db';
import { fmtApprox, fmtKcal } from '@/domain/format';
import { dailyTargetFor, startingMaintenance } from '@/domain/targets';
import { resetUiState, useUiStore } from '@/state/ui';
import type { RestoreResult, SyncProgress } from '@/sync';
import { SyncError } from '@/sync/errors';
import SetupFlow from './SetupFlow';

const pwa = vi.hoisted(() => ({
  state: { canPrompt: false, platform: 'other' as 'ios' | 'android' | 'other', isStandalone: false },
}));

vi.mock('@/app/pwa', () => ({
  usePwaInstall: () => ({ ...pwa.state, prompt: () => Promise.resolve() }),
}));

/** Stands in for the Supabase session (src/auth/session.ts): unconfigured unless a test says so. */
const auth = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const current = { configured: false, state: { status: 'unconfigured' } as SessionState };
  const set = (state: SessionState) => {
    current.state = state;
    for (const listener of [...listeners]) listener();
  };
  return {
    current,
    set,
    read: () => current.state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    signIn: vi.fn<(email: string, password: string) => Promise<void>>(),
    signOut: vi.fn<() => Promise<void>>(),
  };
});

vi.mock('@/auth/session', async (importOriginal) => {
  const { useSyncExternalStore } = await import('react');
  return {
    ...(await importOriginal<typeof import('@/auth/session')>()),
    isAuthConfigured: () => auth.current.configured,
    useSession: () => useSyncExternalStore(auth.subscribe, auth.read, auth.read),
    signIn: (email: string, password: string) => auth.signIn(email, password),
    signOut: () => auth.signOut(),
  };
});

/** Stands in for the sync engine's restore (src/sync); a test says what it answers. */
const sync = vi.hoisted(() => ({
  restore: vi.fn<(onProgress?: (progress: SyncProgress) => void) => Promise<RestoreResult>>(),
}));

vi.mock('@/sync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/sync')>()),
  restoreFromAccount: (onProgress?: (progress: SyncProgress) => void) => sync.restore(onProgress),
}));

const EMAIL = 'fabian@example.com';
const PASSWORD = 'correct horse battery staple';
const USER_ID = 'user-1';

/** What a restore writes, as far as SetupFlow can tell: a real profile with its goal. */
const RESTORED_SETUP: SetupInput = {
  age: 34,
  sex: 'male',
  heightCm: 172,
  weightKg: 78.6,
  activity: 'light',
  paceKgPerWeek: 0.5,
  dailyMinimumKcal: 1400,
  regulars: [],
  places: [{ name: 'Home', type: 'home' }],
  rolloverHour: 5,
  timeZone: 'Asia/Kuala_Lumpur',
};

/** The deployed app (Supabase configured), with this session. */
function deployed(state: SessionState): void {
  auth.current.configured = true;
  auth.set(state);
}

const signedIn: SessionState = { status: 'signedIn', email: EMAIL, userId: USER_ID };

/** A promise the test settles by hand, to look at the sheet while the restore runs. */
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function renderSetup(path = '/setup') {
  const router = createMemoryRouter(
    [
      { path: '/setup/*', element: <SetupFlow /> },
      { path: '/', element: <h1>Today screen</h1> },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

/** The S04 result line as the user reads it (the target is bold, so it spans two nodes). */
function resultLine(text: string) {
  return screen.getByText((_, el) => el?.tagName === 'P' && el.textContent === text);
}

beforeEach(async () => {
  await resetAll();
  resetUiState();
  pwa.state = { canPrompt: false, platform: 'other', isStandalone: false };
  auth.current.configured = false;
  auth.set({ status: 'unconfigured' });
  auth.signIn.mockReset().mockImplementation(async (email) => auth.set({ status: 'signedIn', email, userId: USER_ID }));
  auth.signOut.mockReset().mockImplementation(async () => auth.set({ status: 'signedOut' }));
  sync.restore.mockReset().mockResolvedValue({ result: 'empty' });
});

afterEach(async () => {
  await resetAll();
});

describe('SetupFlow (S01–S07)', () => {
  it('walks every step and creates an active Cut goal whose daily target matches the engine', async () => {
    const user = userEvent.setup();
    const router = renderSetup();

    expect(await screen.findByRole('heading', { level: 1, name: 'Kira Makan' })).toBeInTheDocument();
    expect(screen.getByText('A calorie budget that speaks Malaysian food')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Get started' }));

    // S02 About you
    expect(screen.getByRole('heading', { name: 'About you' })).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 6')).toBeInTheDocument();
    await user.type(screen.getByLabelText('Age'), '30');
    await user.click(screen.getByRole('button', { name: 'Male' }));
    await user.type(screen.getByLabelText('Height'), '172');
    expect(screen.getByText(/An estimate is fine/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Today's weight"), '78.6');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    // S03 activity on a day without workouts
    expect(screen.getByRole('heading', { name: "On a day without workouts, you're mostly…" })).toBeInTheDocument();
    expect(screen.getByText('Workouts are added separately, on the days you do them.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    await user.click(screen.getByRole('radio', { name: /WFH, mostly sitting/ }));
    await user.click(screen.getByRole('button', { name: 'Next' }));

    // S04 goal and pace: live result from the engine
    const maintenance = startingMaintenance({ sex: 'male', weightKg: 78.6, heightCm: 172, age: 30, activity: 'sedentary' });
    const target = (pace: number) => dailyTargetFor({ template: 'cut', paceKgPerWeek: pace }, maintenance, 1400);
    expect(screen.getByRole('radio', { name: /Cut/ })).toHaveAttribute('aria-checked', 'true');
    expect(resultLine(`Starting maintenance ${fmtApprox(maintenance)} → daily target ${fmtKcal(target(0.5))}`)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '0.25 kg' }));
    expect(resultLine(`Starting maintenance ${fmtApprox(maintenance)} → daily target ${fmtKcal(target(0.25))}`)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '0.5 kg' }));
    expect(screen.getByRole('group', { name: 'Daily minimum' })).toHaveTextContent('1,400');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    // S05 regulars
    expect(screen.getByRole('heading', { name: 'Your regulars' })).toBeInTheDocument();
    const roti = screen.getByRole('button', { name: /Roti canai \+ teh tarik/ });
    await user.click(roti);
    expect(roti).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    // S06 places: Home is pre-added
    expect(screen.getByRole('heading', { name: 'Your main Places' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Home' })).toHaveValue('Home');
    await user.type(screen.getByRole('textbox', { name: 'Your mamak' }), 'Nasi kandar near home');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    // S07 your day
    expect(screen.getByRole('heading', { name: 'Your day' })).toBeInTheDocument();
    expect(screen.getByText('A 2am supper counts as the night before.')).toBeInTheDocument();
    expect(screen.getByText('Weeks start on Monday')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '5am' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: 'Done' }));

    expect(await screen.findByText('Today screen')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');

    const profile = await db.profile.get('me');
    expect(profile).toMatchObject({ age: 30, sex: 'male', heightCm: 172, activity: 'sedentary', rolloverHour: 5, dailyMinimumKcal: 1400 });
    const active = await db.goals.where('status').equals('active').toArray();
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ template: 'cut', paceKgPerWeek: 0.5 });
    const versions = await db.goalVersions.toArray();
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ dailyKcal: target(0.5), maintenanceKcal: maintenance, goalId: active[0]?.id });

    await waitFor(async () => {
      const usuals = await db.usuals.toArray();
      expect(usuals.map((u) => u.name)).toEqual(['Roti canai + teh tarik']);
      expect(usuals[0]?.items.map((i) => i.catalogueId)).toEqual(['roti-canai-dhal', 'teh-tarik']);
    });
    const places = await db.places.toArray();
    expect(places.map((p) => [p.name, p.type]).sort()).toEqual([
      ['Home', 'home'],
      ['Nasi kandar near home', 'mamak'],
    ]);
    expect(useUiStore.getState().toast?.message).toBe(`All set · ${fmtKcal(target(0.5))} a day`);
  });

  it('checks the numbers on About you before moving on', async () => {
    const user = userEvent.setup();
    renderSetup();
    await user.click(await screen.findByRole('button', { name: 'Get started' }));

    await user.type(screen.getByLabelText('Age'), '5');
    await user.click(screen.getByRole('button', { name: 'Next' }));

    expect(screen.getByRole('heading', { name: 'About you' })).toBeInTheDocument();
    expect(screen.getByText('Age between 16 and 100')).toBeInTheDocument();
    expect(screen.getByLabelText('Age')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Pick one')).toBeInTheDocument();
    expect(screen.getByText('Add your height')).toBeInTheDocument();
  });

  it('goes back a step without losing answers', async () => {
    const user = userEvent.setup();
    renderSetup();
    await user.click(await screen.findByRole('button', { name: 'Get started' }));
    await user.type(screen.getByLabelText('Age'), '41');
    await user.click(screen.getByRole('button', { name: 'Female' }));
    await user.type(screen.getByLabelText('Height'), '160');
    await user.type(screen.getByLabelText("Today's weight"), '62,5');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('radio', { name: /On your feet a fair bit/ }));
    await user.click(screen.getByRole('button', { name: 'Next' }));

    // Female default minimum.
    expect(screen.getByRole('group', { name: 'Daily minimum' })).toHaveTextContent('1,200');
    await user.click(screen.getByRole('button', { name: 'Raise daily minimum' }));
    expect(screen.getByRole('group', { name: 'Daily minimum' })).toHaveTextContent('1,250');

    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByLabelText('Age')).toHaveValue('41');
    expect(screen.getByLabelText("Today's weight")).toHaveValue('62,5');
  });

  it('"Explore with sample data" loads the demo and opens Today', async () => {
    const user = userEvent.setup();
    const router = renderSetup();
    await user.click(await screen.findByRole('button', { name: 'Explore with sample data' }));

    expect(await screen.findByText('Today screen')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
    expect((await db.profile.get('me'))?.demoMode).toBe(true);
    expect(await db.meals.count()).toBeGreaterThan(0);
  });

  it('redirects to Today when a profile already exists', async () => {
    await loadDemoData();
    renderSetup('/setup');
    expect(await screen.findByText('Today screen')).toBeInTheDocument();
  });

  it('shows the install prompt in a browser, and not once installed', async () => {
    pwa.state = { canPrompt: false, platform: 'ios', isStandalone: false };
    const { unmount } = render(
      <RouterProvider router={createMemoryRouter([{ path: '/setup/*', element: <SetupFlow /> }], { initialEntries: ['/setup'] })} />,
    );
    expect(await screen.findByRole('heading', { name: 'Add Kira Makan to your home screen' })).toBeInTheDocument();
    expect(screen.getByText(/Add to Home Screen/)).toBeInTheDocument();
    unmount();

    pwa.state = { canPrompt: false, platform: 'ios', isStandalone: true };
    renderSetup();
    expect(await screen.findByRole('button', { name: 'Get started' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Add Kira Makan to your home screen' })).not.toBeInTheDocument();
  });
});

describe('Restore from your account (S01)', () => {
  it('has no restore button without Supabase', async () => {
    renderSetup();
    expect(await screen.findByRole('button', { name: 'Get started' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Explore with sample data' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restore from your account' })).not.toBeInTheDocument();
  });

  it('offers restore between Get started and the sample week in the deployed app', async () => {
    deployed({ status: 'signedOut' });
    renderSetup();
    await screen.findByRole('button', { name: 'Restore from your account' });
    const names = screen.getAllByRole('button').map((button) => button.textContent);
    expect(names).toEqual(['Get started', 'Restore from your account', 'Explore with sample data']);
  });

  it('signs a signed-out phone in, restores straight away with progress, and opens Today', async () => {
    deployed({ status: 'signedOut' });
    const pending = deferred<RestoreResult>();
    let report: ((progress: SyncProgress) => void) | undefined;
    sync.restore.mockImplementation((onProgress) => {
      report = onProgress;
      return pending.promise;
    });
    const user = userEvent.setup();
    const router = renderSetup();

    await user.click(await screen.findByRole('button', { name: 'Restore from your account' }));
    const signIn = await screen.findByRole('dialog', { name: 'Restore from your account' });
    expect(within(signIn).getByText('Sign in with the account your diary syncs to.')).toBeInTheDocument();
    expect(sync.restore).not.toHaveBeenCalled();
    await user.type(within(signIn).getByLabelText('Email'), EMAIL);
    await user.type(within(signIn).getByLabelText('Password'), PASSWORD);
    await user.click(within(signIn).getByRole('button', { name: 'Sign in' }));
    expect(auth.signIn).toHaveBeenCalledWith(EMAIL, PASSWORD);

    // No second tap: signed in, the restore starts.
    const sheet = await screen.findByRole('dialog', { name: 'Restoring your diary' });
    expect(sync.restore).toHaveBeenCalledTimes(1);
    expect(within(sheet).getByText('Keep the app open.')).toBeInTheDocument();
    expect(within(sheet).queryByRole('progressbar')).not.toBeInTheDocument();

    act(() => report?.({ done: 340, total: 1840 }));
    expect(within(sheet).getByText('340 of about 1,840 entries. Keep the app open.')).toBeInTheDocument();
    const bar = within(sheet).getByRole('progressbar', { name: 'Restoring your diary' });
    expect(bar).toHaveAttribute('aria-valuenow', '340');
    expect(bar).toHaveAttribute('aria-valuemax', '1840');

    // It can't be closed while it runs: no handle button, and Escape does nothing.
    expect(within(sheet).queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Restoring your diary' })).toBeInTheDocument();

    // The restore commits the whole diary, profile included, then answers: Today opens by itself.
    await completeSetup(RESTORED_SETUP);
    await act(async () => pending.resolve({ result: 'restored', meals: 12 }));
    expect(await screen.findByText('Today screen')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
    expect(useUiStore.getState().toast?.message).toBe('Restored · 12 meals');
    expect(sync.restore).toHaveBeenCalledTimes(1);
  });

  it('restores at once when already signed in, and says so when the account has no diary', async () => {
    deployed(signedIn);
    const user = userEvent.setup();
    renderSetup();

    await user.click(await screen.findByRole('button', { name: 'Restore from your account' }));
    const sheet = await screen.findByRole('dialog', { name: 'Nothing to restore yet' });
    expect(sync.restore).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();
    expect(within(sheet).getByText('This account has no diary yet. Set up here and it syncs from then on.')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Close' })).toBeInTheDocument();

    // Get started closes the sheet and opens step 1.
    await user.click(within(sheet).getByRole('button', { name: 'Get started' }));
    expect(screen.getByRole('heading', { name: 'About you' })).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 6')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await db.profile.count()).toBe(0);
  });

  it('signs out from an empty account, to sign in with another one', async () => {
    deployed(signedIn);
    const user = userEvent.setup();
    renderSetup();

    await user.click(await screen.findByRole('button', { name: 'Restore from your account' }));
    const sheet = await screen.findByRole('dialog', { name: 'Nothing to restore yet' });
    await user.click(within(sheet).getByRole('button', { name: 'Sign out' }));

    expect(auth.signOut).toHaveBeenCalledTimes(1);
    const signIn = await screen.findByRole('dialog', { name: 'Restore from your account' });
    expect(within(signIn).getByLabelText('Email')).toHaveValue('');
    expect(sync.restore).toHaveBeenCalledTimes(1);
  });

  it('says when another device is still uploading the diary, and tries again', async () => {
    deployed(signedIn);
    sync.restore.mockResolvedValueOnce({ result: 'uploading' });
    const user = userEvent.setup();
    renderSetup();

    await user.click(await screen.findByRole('button', { name: 'Restore from your account' }));
    const sheet = await screen.findByRole('dialog', { name: 'Your diary is still uploading' });
    expect(
      within(sheet).getByText('Another device is still sending your diary. Keep it open, then try again in a minute.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Nothing to restore yet')).not.toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(await db.profile.count()).toBe(0);

    await user.click(within(sheet).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('dialog', { name: 'Nothing to restore yet' })).toBeInTheDocument();
    expect(sync.restore).toHaveBeenCalledTimes(2);
  });

  it('sets up here instead of waiting for the upload', async () => {
    deployed(signedIn);
    sync.restore.mockResolvedValueOnce({ result: 'uploading' });
    const user = userEvent.setup();
    renderSetup();

    await user.click(await screen.findByRole('button', { name: 'Restore from your account' }));
    const sheet = await screen.findByRole('dialog', { name: 'Your diary is still uploading' });
    await user.click(within(sheet).getByRole('button', { name: 'Set up instead' }));
    expect(screen.getByRole('heading', { name: 'About you' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(sync.restore).toHaveBeenCalledTimes(1);
  });

  it("says when it couldn't restore, changes nothing, and tries again", async () => {
    deployed(signedIn);
    sync.restore.mockRejectedValueOnce(new SyncError('unreachable', 'The connection dropped'));
    const user = userEvent.setup();
    renderSetup();

    await user.click(await screen.findByRole('button', { name: 'Restore from your account' }));
    const sheet = await screen.findByRole('dialog', { name: "Couldn't restore right now" });
    expect(within(sheet).getByText('Check your connection and try again. Nothing on this device has changed.')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Set up instead' })).toBeInTheDocument();
    expect(await db.profile.count()).toBe(0);

    await user.click(within(sheet).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('dialog', { name: 'Nothing to restore yet' })).toBeInTheDocument();
    expect(sync.restore).toHaveBeenCalledTimes(2);
  });

  it('points at the SQL when the server has no sync yet, and sets up instead', async () => {
    deployed(signedIn);
    sync.restore.mockRejectedValueOnce(new SyncError('notSetUp', 'Could not find the function public.sync_hello'));
    const user = userEvent.setup();
    renderSetup();

    await user.click(await screen.findByRole('button', { name: 'Restore from your account' }));
    const sheet = await screen.findByRole('dialog', { name: "Couldn't restore right now" });
    expect(within(sheet).getByText('Run supabase/sync.sql in the Supabase SQL Editor (see DEPLOY.md).')).toBeInTheDocument();

    await user.click(within(sheet).getByRole('button', { name: 'Set up instead' }));
    expect(screen.getByRole('heading', { name: 'About you' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('asks to sign in again when the account refuses the session, then restores', async () => {
    deployed(signedIn);
    sync.restore.mockRejectedValueOnce(new SyncError('needsSignIn', 'Sign in to sync'));
    const user = userEvent.setup();
    renderSetup();

    await user.click(await screen.findByRole('button', { name: 'Restore from your account' }));
    const sheet = await screen.findByRole('dialog', { name: 'Restore from your account' });
    expect(within(sheet).getByLabelText('Email')).toHaveValue(EMAIL);
    await user.type(within(sheet).getByLabelText('Password'), PASSWORD);
    await user.click(within(sheet).getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('dialog', { name: 'Nothing to restore yet' })).toBeInTheDocument();
    expect(auth.signIn).toHaveBeenCalledWith(EMAIL, PASSWORD);
    expect(sync.restore).toHaveBeenCalledTimes(2);
  });

  it('waits for the session before choosing between sign-in and restore', async () => {
    deployed({ status: 'loading' });
    const user = userEvent.setup();
    renderSetup();

    await user.click(await screen.findByRole('button', { name: 'Restore from your account' }));
    const sheet = await screen.findByRole('dialog', { name: 'Restore from your account' });
    expect(within(sheet).getByText('Checking your account…')).toBeInTheDocument();
    expect(sync.restore).not.toHaveBeenCalled();

    act(() => auth.set(signedIn));
    expect(await screen.findByRole('dialog', { name: 'Nothing to restore yet' })).toBeInTheDocument();
    expect(sync.restore).toHaveBeenCalledTimes(1);
  });
});
