import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PATHS } from '@/app/paths';
import type { SessionState } from '@/auth/session';
import { loadDemoData, resetAll, syncDemoClock } from '@/db/actions';
import { db } from '@/db/db';
import { readLastBackupAt, readLastExport, writeLastBackupAt, writeLastExport } from '@/db/settings';
import type { OutboxEntry, SyncLink, SyncMeta } from '@/db/syncTypes';
import { logicalDayOf } from '@/domain/day';
import type { DriveEngineState } from '@/drive';
import type { PushEngineState } from '@/push';
import { resetUiState, useUiStore } from '@/state/ui';
import type { EngineState } from '@/sync';
import { SyncError } from '@/sync/errors';
import SettingsScreen from './SettingsScreen';

/** Stands in for the Supabase session (src/auth/session.ts): unconfigured unless a test says so. */
const auth = vi.hoisted(() => ({
  configured: false,
  state: { status: 'unconfigured' } as SessionState,
  signIn: vi.fn<(email: string, password: string) => Promise<void>>(async () => {}),
  signOut: vi.fn<() => Promise<void>>(async () => {}),
}));

vi.mock('@/auth/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/session')>()),
  isAuthConfigured: () => auth.configured,
  useSession: () => auth.state,
  signIn: (email: string, password: string) => auth.signIn(email, password),
  signOut: () => auth.signOut(),
}));

/**
 * Stands in for the sync engine (src/sync/index.ts): the card reads its state, and every action
 * is a mock. `order` records how Delete everything runs around the wipe.
 */
const sync = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const current: { state: EngineState } = { state: { phase: 'starting' } };
  const order: string[] = [];
  const action = () => vi.fn<() => Promise<void>>(async () => {});
  return {
    current,
    listeners,
    order,
    set(state: EngineState) {
      current.state = state;
      for (const listener of [...listeners]) listener();
    },
    stopSync: vi.fn<() => Promise<void>>(async () => {
      order.push('stopSync');
    }),
    resumeSync: vi.fn<() => void>(() => {
      order.push('resumeSync');
    }),
    flushSync: vi.fn<(timeoutMs: number) => Promise<void>>(async () => {}),
    syncNow: action(),
    useAccountData: action(),
    keepThisDeviceData: action(),
    notNow: action(),
    turnSyncBackOn: action(),
    switchToSignedInAccount: action(),
    uploadAfterReset: action(),
    turnOffAfterReset: action(),
  };
});

vi.mock('@/sync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/sync')>()),
  getEngineState: () => sync.current.state,
  subscribeEngine: (listener: () => void) => {
    sync.listeners.add(listener);
    return () => sync.listeners.delete(listener);
  },
  stopSync: () => sync.stopSync(),
  resumeSync: () => sync.resumeSync(),
  flushSync: (timeoutMs: number) => sync.flushSync(timeoutMs),
  syncNow: () => sync.syncNow(),
  useAccountData: () => sync.useAccountData(),
  keepThisDeviceData: () => sync.keepThisDeviceData(),
  notNow: () => sync.notNow(),
  turnSyncBackOn: () => sync.turnSyncBackOn(),
  switchToSignedInAccount: () => sync.switchToSignedInAccount(),
  uploadAfterReset: () => sync.uploadAfterReset(),
  turnOffAfterReset: () => sync.turnOffAfterReset(),
}));

/** Stands in for the Drive engine (src/drive/index.ts): its state, and the calls around Delete everything. */
const drive = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const base = {
    configured: false,
    profile: 'real' as const,
    keepPhotos: true,
    connected: false,
    gisReady: false,
    authBusy: false,
    running: false,
    online: true,
    counts: { uploads: 0, files: 0, failed: 0 },
  };
  const current: { state: DriveEngineState } = { state: base };
  return { base, current, listeners };
});

vi.mock('@/drive', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/drive')>()),
  getDriveState: () => drive.current.state,
  subscribeDrive: (listener: () => void) => {
    drive.listeners.add(listener);
    return () => drive.listeners.delete(listener);
  },
  stopDrive: async () => {
    sync.order.push('stopDrive');
  },
  resumeDrive: () => {
    sync.order.push('resumeDrive');
  },
  forgetDriveToken: () => {
    sync.order.push('forgetDriveToken');
  },
  prepareDrive: () => {},
}));

/** Stands in for the reminders engine (src/push/index.ts): the Reminders row's state, and forgetPush around leaving. */
const push = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const current: { state: PushEngineState } = { state: { phase: 'off', permission: 'default', hasRecord: false } };
  return {
    current,
    listeners,
    set(state: PushEngineState) {
      current.state = state;
      for (const listener of [...listeners]) listener();
    },
    forgetPush: vi.fn<(timeoutMs?: number) => Promise<void>>(async () => {}),
  };
});

vi.mock('@/push', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/push')>()),
  getPushState: () => push.current.state,
  subscribePush: (listener: () => void) => {
    push.listeners.add(listener);
    return () => push.listeners.delete(listener);
  },
  forgetPush: (timeoutMs?: number) => push.forgetPush(timeoutMs),
}));

// The real wipe, recorded so a test can check it runs while sync is stopped.
vi.mock('@/db/actions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db/actions')>();
  return {
    ...actual,
    resetAll: async () => {
      sync.order.push('resetAll');
      await actual.resetAll();
      sync.order.push('resetAll done');
    },
  };
});

/** Where supabase-js keeps the deployed app's session (src/auth/supabase.ts storageKeyFor). */
const STORAGE_KEY = 'kira-makan:sb-abcdefgh-auth';
const EMAIL = 'fabian@example.com';
const PASSWORD = 'correct horse battery staple';
const USER_ID = 'user-1';
const SIGNED_IN: SessionState = { status: 'signedIn', email: EMAIL, userId: USER_ID };
const MINUTE = 60_000;

const LINK: SyncLink = {
  userId: USER_ID,
  email: EMAIL,
  dataset: 'dataset-1',
  deviceId: 'device-1',
  cursor: 0,
  protocol: 1,
  linkedAt: 0,
};

function queued(table: string, key: string, failedAt?: number): OutboxEntry {
  return { table, key, changedAt: 1, nonce: `${table}-${key}`, ...(failedAt === undefined ? {} : { failedAt }) };
}

/** This phone's own diary: the demo's data, out of demo mode. */
async function ownDiary(): Promise<void> {
  await db.profile.update('me', { demoMode: false });
}

const DAY_MS = 86_400_000;

/** A time some days before the real now, and the calendar day it falls on in Kuala Lumpur. */
const isoDaysAgo = (days: number): string => new Date(Date.now() - days * DAY_MS).toISOString();
const dayDaysAgo = (days: number): string => logicalDayOf(new Date(Date.now() - days * DAY_MS), 'Asia/Kuala_Lumpur', 0);

/** An own diary of its own age, on the real clock (the sample week's Oct 2026 start would read as an old diary). */
async function diaryStartedDaysAgo(days: number): Promise<void> {
  await db.profile.update('me', { demoMode: false, startedOn: dayDaysAgo(days) });
  await syncDemoClock();
}

/** This phone's own diary, synced with an account, with these changes queued. */
async function linkedPhone(meta: Partial<SyncMeta> = {}, entries: OutboxEntry[] = []): Promise<void> {
  await ownDiary();
  await db.syncMeta.put({ id: 'sync', link: LINK, ...meta });
  await db.syncOutbox.bulkPut(entries);
}

/** A settings group's card and note, found by its heading. */
function group(name: string): HTMLElement {
  const section = screen.getByRole('heading', { level: 2, name }).closest('section');
  if (!(section instanceof HTMLElement)) throw new Error(`No ${name} group`);
  return section;
}

/** A promise the test settles by hand, to look at busy states. */
function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

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
  off: "Offline estimates only. Meals aren't sent to the AI.",
};

function renderSettings() {
  const router = createMemoryRouter(
    [
      { path: '/more/settings', element: <SettingsScreen /> },
      { path: '/more', element: <h1>More screen</h1> },
      { path: '/more/export', element: <h1>Export screen</h1> },
      { path: '/more/backups', element: <h1>Backups screen</h1> },
      { path: '/more/reminders', element: <h1>Reminders screen</h1> },
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
  auth.signIn.mockReset().mockResolvedValue(undefined);
  auth.signOut.mockReset().mockResolvedValue(undefined);
  sync.current.state = { phase: 'starting' };
  drive.current.state = { ...drive.base };
  push.current.state = { phase: 'off', permission: 'default', hasRecord: false };
  push.forgetPush.mockReset().mockImplementation(async () => {
    sync.order.push('forgetPush');
  });
  sync.stopSync.mockClear();
  sync.resumeSync.mockClear();
  sync.flushSync.mockReset().mockResolvedValue(undefined);
  for (const mock of [
    sync.syncNow,
    sync.useAccountData,
    sync.keepThisDeviceData,
    sync.notNow,
    sync.turnSyncBackOn,
    sync.switchToSignedInAccount,
    sync.uploadAfterReset,
    sync.turnOffAfterReset,
  ]) {
    mock.mockReset().mockResolvedValue(undefined);
  }
  await resetAll();
  resetUiState();
  await loadDemoData();
  sync.order.length = 0;
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

/** A signed-in phone: the session and its user record in localStorage. */
function storeSignedInPhone(): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ access_token: 'access', refresh_token: 'refresh', expires_at: 2_000_000_000 }));
  window.localStorage.setItem(`${STORAGE_KEY}-user`, JSON.stringify({ user: { email: EMAIL } }));
}

function expectNoSessionStored(): void {
  expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  expect(window.localStorage.getItem(`${STORAGE_KEY}-user`)).toBeNull();
}

describe('SettingsScreen (S19)', () => {
  it('shows the profile, budget and day settings from the demo profile', async () => {
    renderSettings();

    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /^Age/ })).toHaveTextContent('30');
    expect(screen.getByRole('button', { name: /^Sex/ })).toHaveTextContent('Male');
    expect(screen.getByRole('button', { name: /^Height/ })).toHaveTextContent('172 cm');
    // The weigh-ins load on their own, after the profile.
    await waitFor(() => expect(screen.getByRole('button', { name: /^Weight/ })).toHaveTextContent('77.8 kg'));
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

  it('keeps Location under Privacy and Keep photos under Photos', async () => {
    renderSettings();
    await screen.findByRole('switch', { name: 'Keep photos' });
    expect(within(group('Privacy')).getByRole('switch', { name: 'Location' })).toBeInTheDocument();
    expect(within(group('Privacy')).queryByRole('switch', { name: 'Keep photos' })).not.toBeInTheDocument();
    expect(within(group('Photos')).getByRole('switch', { name: 'Keep photos' })).toBeInTheDocument();
    // Without a Google client id there is no Drive card.
    expect(within(group('Photos')).queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows the Drive card under Keep photos when the app has a Google client id', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '123-abc.apps.googleusercontent.com');
    drive.current.state = { ...drive.base, configured: true };
    renderSettings();
    const photos = await screen.findByRole('heading', { level: 2, name: 'Photos' });
    const section = photos.closest('section');
    expect(section).not.toBeNull();
    expect(await within(section as HTMLElement).findByText('Photos are on this device only')).toBeInTheDocument();
    expect(within(section as HTMLElement).getByRole('button', { name: 'Connect Google Drive' })).toBeInTheDocument();
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

  it("forgets the sample week's export when leaving demo", async () => {
    writeLastExport({ at: '2026-10-16T11:10:00.000Z', kind: 'json' });
    expect(readLastBackupAt()).not.toBeNull();
    const user = userEvent.setup();
    renderSettings();

    await user.click(await screen.findByRole('button', { name: /Leave demo and start fresh/ }));
    expect(await screen.findByRole('heading', { name: 'Setup screen' })).toBeInTheDocument();
    expect(readLastExport()).toBeNull();
    expect(readLastBackupAt()).toBeNull();
    expect(window.localStorage.getItem('kira-makan:last-backup')).toBeNull();
  });

  it('links to export, reminders and backups', async () => {
    const user = userEvent.setup();
    const router = renderSettings();

    await user.click(await screen.findByRole('button', { name: /^Export/ }));
    expect(router.state.location.pathname).toBe(PATHS.export);
    await router.navigate(PATHS.settings);
    await user.click(await screen.findByRole('button', { name: /^Backups/ }));
    expect(router.state.location.pathname).toBe(PATHS.backups);
    expect(await screen.findByRole('heading', { name: 'Backups screen' })).toBeInTheDocument();
    await router.navigate(PATHS.settings);
    await user.click(await screen.findByRole('button', { name: /^Reminders/ }));
    expect(router.state.location.pathname).toBe(PATHS.reminders);
    expect(await screen.findByRole('heading', { name: 'Reminders screen' })).toBeInTheDocument();
  });
});

describe('SettingsScreen Reminders row', () => {
  const remindersRow = () => screen.findByRole('button', { name: /^Reminders/ });

  it("says what this device's reminders are doing", async () => {
    renderSettings();
    expect(await remindersRow()).toHaveTextContent('Off on this device');
    act(() => push.set({ phase: 'on', permission: 'granted', hasRecord: true, device: { failures: 0 } }));
    await waitFor(async () => expect(await remindersRow()).toHaveTextContent('On · check-in at 10am'));
    await db.profile.update('me', { reminders: { checkInAtMin: 540 } });
    await waitFor(async () => expect(await remindersRow()).toHaveTextContent('On · check-in at 9am'));
    act(() => push.set({ phase: 'on', permission: 'granted', hasRecord: true, device: { failures: 3 } }));
    await waitFor(async () => expect(await remindersRow()).toHaveTextContent('Needs a look'));
  });

  it('says when this version has no reminders', async () => {
    push.current.state = { phase: 'unconfigured', permission: 'unsupported', hasRecord: false };
    renderSettings();
    expect(await remindersRow()).toHaveTextContent('Not available in this version');
  });
});

describe('SettingsScreen Backups row', () => {
  const backupsRow = () => screen.findByRole('button', { name: /^Backups/ });

  it('says what the screen is for, and nothing about Google Drive', async () => {
    renderSettings();
    expect(await backupsRow()).toHaveTextContent('Export and restore');
    expect(document.body).not.toHaveTextContent('Google Drive');
  });

  it('mentions sync in the deployed app', async () => {
    deployed({ status: 'signedOut' });
    await diaryStartedDaysAgo(10);
    renderSettings();
    expect(await backupsRow()).toHaveTextContent('Sync, export and restore');
    expect(document.body).not.toHaveTextContent('Google Drive');
  });

  it('keeps the same line on the sample week, however old the last export', async () => {
    writeLastBackupAt(isoDaysAgo(45));
    renderSettings();
    const row = await backupsRow();
    expect(row).toHaveTextContent('Export and restore');
    expect(row).not.toHaveTextContent('Time for');
  });

  it('keeps the same line for a young diary that was never exported', async () => {
    await diaryStartedDaysAgo(10);
    renderSettings();
    expect(await backupsRow()).toHaveTextContent('Export and restore');
  });

  it('keeps the same line when the last backup is recent', async () => {
    await diaryStartedDaysAgo(100);
    writeLastBackupAt(isoDaysAgo(10));
    renderSettings();
    const row = await backupsRow();
    await act(async () => {
      await db.meals.count();
    });
    expect(row).toHaveTextContent('Export and restore');
    expect(row).not.toHaveTextContent('Time for');
  });

  it('says quietly that a new export is due, when the last backup is over 30 days old', async () => {
    await diaryStartedDaysAgo(100);
    writeLastBackupAt(isoDaysAgo(45));
    renderSettings();
    await waitFor(async () => expect(await backupsRow()).toHaveTextContent('Last export 45 days ago. Time for a new one.'));
    // Not a banner: no alert, and this row is the one place outside Backups that says so.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('counts a JSON export from before the backup record existed', async () => {
    await diaryStartedDaysAgo(100);
    window.localStorage.setItem('kira-makan:last-export', JSON.stringify({ at: isoDaysAgo(45), kind: 'json' }));
    renderSettings();
    await waitFor(async () => expect(await backupsRow()).toHaveTextContent('Last export 45 days ago. Time for a new one.'));
  });

  it('does not count a spreadsheet export', async () => {
    await diaryStartedDaysAgo(100);
    writeLastExport({ at: isoDaysAgo(1), kind: 'csv' });
    renderSettings();
    await waitFor(async () => expect(await backupsRow()).toHaveTextContent('No export yet. Time for one.'));
    // The Export row still shows the newest export of any kind.
    expect(screen.getByRole('button', { name: /^Export/ })).toHaveTextContent('Last export');
  });

  it('says there is no export yet once an old diary has never been exported', async () => {
    await diaryStartedDaysAgo(40);
    renderSettings();
    await waitFor(async () => expect(await backupsRow()).toHaveTextContent('No export yet. Time for one.'));
  });

  it('stays quiet for an empty diary', async () => {
    await diaryStartedDaysAgo(100);
    await db.meals.clear();
    renderSettings();
    const row = await backupsRow();
    await act(async () => {
      await db.meals.count();
    });
    expect(row).toHaveTextContent('Export and restore');
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

  it('stops sync before the wipe and resumes it after', async () => {
    deployed(SIGNED_IN);
    await linkedPhone();
    auth.signOut.mockImplementation(async () => {
      sync.order.push('signOut');
    });
    const user = userEvent.setup();
    renderSettings();

    await confirmDeleteEverything(user);

    expect(await screen.findByRole('heading', { name: 'Setup screen' })).toBeInTheDocument();
    // This device's reminders go while the session's token still works, then the session.
    expect(sync.order).toEqual([
      'stopSync',
      'stopDrive',
      'resetAll',
      'forgetPush',
      'signOut',
      'resetAll done',
      'forgetDriveToken',
      'resumeSync',
      'resumeDrive',
    ]);
    // The wipe is this phone's alone: nothing queued for the account, nothing linked.
    expect(await db.syncOutbox.count()).toBe(0);
    expect(await db.syncMeta.count()).toBe(0);
  });

  it('when linked, says the account keeps its copy and warns about changes not yet synced', async () => {
    deployed(SIGNED_IN);
    await linkedPhone({}, [queued('meals', 'm1'), queued('weights', 'w1'), queued('places', 'p1', 1)]);
    sync.current.state = { phase: 'offline' };
    const user = userEvent.setup();
    renderSettings();

    const row = await screen.findByRole('button', { name: /^Delete everything/ });
    await waitFor(() => expect(row).toHaveTextContent('Removes all data on this device. The copy in your account stays.'));
    await user.click(row);
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete everything?' });
    expect(dialog).toHaveAccessibleDescription(
      'Every meal, weigh-in, Place and goal on this device goes, and this device signs out. The copy in your account stays, ' +
        "so signing in again brings it back. 3 changes haven't synced and will be lost.",
    );
  });

  it('when linked with nothing queued, has no warning', async () => {
    deployed(SIGNED_IN);
    await linkedPhone();
    const user = userEvent.setup();
    renderSettings();

    const row = await screen.findByRole('button', { name: /^Delete everything/ });
    await waitFor(() => expect(row).toHaveTextContent('The copy in your account stays.'));
    await user.click(row);
    expect(await screen.findByRole('alertdialog', { name: 'Delete everything?' })).toHaveAccessibleDescription(
      'Every meal, weigh-in, Place and goal on this device goes, and this device signs out. The copy in your account stays, ' +
        'so signing in again brings it back.',
    );
  });

  it('says the photos in Google Drive stay, only when Drive is connected here', async () => {
    deployed(SIGNED_IN);
    await linkedPhone();
    drive.current.state = { ...drive.base, configured: true, connected: true };
    const user = userEvent.setup();
    renderSettings();

    const row = await screen.findByRole('button', { name: /^Delete everything/ });
    await waitFor(() => expect(row).toHaveTextContent('The copy in your account stays.'));
    await user.click(row);
    expect(await screen.findByRole('alertdialog', { name: 'Delete everything?' })).toHaveAccessibleDescription(
      'Every meal, weigh-in, Place and goal on this device goes, and this device signs out. The copy in your account stays, ' +
        'so signing in again brings it back. Photos in your Google Drive stay there.',
    );
  });

  it('warns that photos still waiting to upload are lost, set-aside ones included', async () => {
    deployed(SIGNED_IN);
    await linkedPhone();
    drive.current.state = { ...drive.base, configured: true, connected: true, counts: { uploads: 2, files: 1, failed: 1 } };
    const user = userEvent.setup();
    renderSettings();

    const row = await screen.findByRole('button', { name: /^Delete everything/ });
    await waitFor(() => expect(row).toHaveTextContent('The copy in your account stays.'));
    await user.click(row);
    expect(await screen.findByRole('alertdialog', { name: 'Delete everything?' })).toHaveAccessibleDescription(
      'Every meal, weigh-in, Place and goal on this device goes, and this device signs out. The copy in your account stays, ' +
        "so signing in again brings it back. Photos in your Google Drive stay there. 3 photos that haven't uploaded will be lost.",
    );
  });

  it('says the photos in Google Drive stay before linking too', async () => {
    await ownDiary();
    drive.current.state = { ...drive.base, configured: true, connected: true };
    const user = userEvent.setup();
    renderSettings();
    await user.click(await screen.findByRole('button', { name: /^Delete everything/ }));
    expect(await screen.findByRole('alertdialog', { name: 'Delete everything?' })).toHaveAccessibleDescription(
      "Every meal, weigh-in, Place and goal on this phone goes, and it can't be undone. Export a backup first if you want a copy. " +
        'Photos in your Google Drive stay there.',
    );
  });

  it('says one photo that has not uploaded will be lost', async () => {
    await ownDiary();
    drive.current.state = { ...drive.base, configured: true, connected: true, counts: { uploads: 1, files: 0, failed: 0 } };
    const user = userEvent.setup();
    renderSettings();
    await user.click(await screen.findByRole('button', { name: /^Delete everything/ }));
    expect(await screen.findByRole('alertdialog', { name: 'Delete everything?' })).toHaveAccessibleDescription(
      "Every meal, weigh-in, Place and goal on this phone goes, and it can't be undone. Export a backup first if you want a copy. " +
        "Photos in your Google Drive stay there. 1 photo that hasn't uploaded will be lost.",
    );
  });

  it('before linking, the copy is unchanged', async () => {
    deployed(SIGNED_IN);
    await ownDiary();
    const user = userEvent.setup();
    renderSettings();

    const row = await screen.findByRole('button', { name: /^Delete everything/ });
    // Give the sync tables' live query time to answer, then check the copy still says nothing more.
    await act(async () => {
      await db.syncMeta.get('sync');
    });
    expect(row).toHaveTextContent('Removes all data on this phone');
    expect(row).not.toHaveTextContent('The copy in your account stays.');
    await user.click(row);
    expect(await screen.findByRole('alertdialog', { name: 'Delete everything?' })).toHaveAccessibleDescription(
      "Every meal, weigh-in, Place and goal on this phone goes, and it can't be undone. Export a backup first if you want a copy.",
    );
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


  it('has no sign-in note when AI is off', async () => {
    deployed({ status: 'signedOut' });
    await db.profile.update('me', { aiEstimates: 'off' });
    renderSettings();

    await waitFor(() => expect(screen.getByRole('radio', { name: /^Off/ })).toHaveAttribute('aria-checked', 'true'));
    expect(screen.queryByText('Until you sign in, estimates stay offline.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Account/ })).toBeInTheDocument();
  });

  it('keeps only the modes and the note once the Account row has moved to Account and sync', async () => {
    deployed({ status: 'signedOut' });
    renderSettings();

    const ai = await screen.findByRole('radiogroup', { name: 'When to use AI' });
    expect(group('AI estimates')).toContainElement(ai);
    expect(within(group('AI estimates')).queryByText('Account')).not.toBeInTheDocument();
    expect(within(group('AI estimates')).getByText('Until you sign in, estimates stay offline.')).toBeInTheDocument();
    expect(within(group('Account and sync')).getByRole('button', { name: /^Account/ })).toBeInTheDocument();
  });
});

describe('SettingsScreen Account and sync', () => {
  it('is left out when Supabase is not set up', async () => {
    vi.stubEnv('VITE_ESTIMATE_URL', '/api/estimate');
    renderSettings();

    expect(await screen.findByRole('radiogroup', { name: 'When to use AI' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Account and sync' })).not.toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('comes first, with the sync card over the Account row', async () => {
    deployed({ status: 'signedOut' });
    renderSettings();

    expect(await screen.findByRole('button', { name: /^Age/ })).toBeInTheDocument();
    const headings = screen.getAllByRole('heading', { level: 2 });
    expect(headings[0]).toHaveTextContent('Account and sync');
    expect(headings[1]).toHaveTextContent('AI estimates');
    // The demo profile: sync stays off whoever signs in.
    const card = within(group('Account and sync')).getByRole('status');
    expect(card).toHaveTextContent('Sync is off in demo mode');
    expect(within(group('Account and sync')).getByText('Sample data never leaves this device.')).toBeInTheDocument();
    expect(card.compareDocumentPosition(screen.getByRole('button', { name: /^Account/ })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('says sync is off while signed out, and the Account row signs in', async () => {
    deployed({ status: 'signedOut' });
    await ownDiary();
    renderSettings();

    await waitFor(() => expect(within(group('Account and sync')).getByRole('status')).toHaveTextContent('Sync is off'));
    expect(
      within(group('Account and sync')).getByText('Sign in to keep a copy of your diary in your account and use it on another device.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Account/ })).toHaveTextContent('Sign in to sync and use AI estimates');
  });

  it('signs in through the sheet when signed out', async () => {
    deployed({ status: 'signedOut' });
    const user = userEvent.setup();
    renderSettings();

    expect(await screen.findByText('Until you sign in, estimates stay offline.')).toBeInTheDocument();
    expect(screen.queryByText('AI estimates run through the dev server.')).not.toBeInTheDocument();
    const account = screen.getByRole('button', { name: /^Account/ });
    expect(account).toHaveTextContent('Sign in to sync and use AI estimates');
    await user.click(account);

    const sheet = await screen.findByRole('dialog', { name: 'Sign in' });
    expect(
      within(sheet).getByText('Your account keeps a synced copy of your diary and unlocks AI estimates. Everything works offline without it.'),
    ).toBeInTheDocument();
    await user.type(within(sheet).getByLabelText('Email'), EMAIL);
    await user.type(within(sheet).getByLabelText('Password'), PASSWORD);
    await user.click(within(sheet).getByRole('button', { name: 'Sign in' }));
    expect(auth.signIn).toHaveBeenCalledWith(EMAIL, PASSWORD);

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Sign in' })).not.toBeInTheDocument());
    expect(useUiStore.getState().toast?.message).toBe('Signed in');
    // Sync looks again at once, even while it waits on a session the account refused.
    expect(sync.syncNow).toHaveBeenCalledTimes(1);
  });

  it('keeps the sheet open with the error when the password is wrong', async () => {
    deployed({ status: 'signedOut' });
    auth.signIn.mockRejectedValue(Object.assign(new Error('Wrong email or password.'), { kind: 'wrongPassword' }));
    const user = userEvent.setup();
    renderSettings();

    await user.click(await screen.findByRole('button', { name: /^Account/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Sign in' });
    await user.type(within(sheet).getByLabelText('Email'), EMAIL);
    await user.type(within(sheet).getByLabelText('Password'), 'wrong');
    await user.click(within(sheet).getByRole('button', { name: 'Sign in' }));

    expect(await within(sheet).findByRole('alert')).toHaveTextContent('Wrong email or password.');
    expect(screen.getByRole('dialog', { name: 'Sign in' })).toBeInTheDocument();
    expect(useUiStore.getState().toast).toBeNull();
  });

  it('shows who is signed in, sends what is queued, then signs out', async () => {
    deployed(SIGNED_IN);
    const user = userEvent.setup();
    renderSettings();

    expect(await screen.findByText('Signed in as fabian@example.com')).toBeInTheDocument();
    expect(screen.queryByText('Until you sign in, estimates stay offline.')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(auth.signOut).toHaveBeenCalledTimes(1);
    expect(sync.flushSync).toHaveBeenCalledWith(5_000);
    expect(sync.flushSync.mock.invocationCallOrder[0]).toBeLessThan(auth.signOut.mock.invocationCallOrder[0] ?? 0);
    // This device's reminders go after the flush, while the token still works.
    expect(push.forgetPush).toHaveBeenCalledTimes(1);
    expect(sync.flushSync.mock.invocationCallOrder[0]).toBeLessThan(push.forgetPush.mock.invocationCallOrder[0] ?? 0);
    expect(push.forgetPush.mock.invocationCallOrder[0]).toBeLessThan(auth.signOut.mock.invocationCallOrder[0] ?? 0);
    await waitFor(() => expect(useUiStore.getState().toast?.message).toBe('Signed out'));
  });

  it("waits for the flush before signing out, and says what's still waiting", async () => {
    deployed(SIGNED_IN);
    await linkedPhone({ lastSyncedAt: Date.now() - 5 * MINUTE }, [queued('meals', 'm1'), queued('weights', 'w1'), queued('places', 'p1', 1)]);
    sync.current.state = { phase: 'idle' };
    const flushing = deferred();
    sync.flushSync.mockReturnValueOnce(flushing.promise);
    const user = userEvent.setup();
    renderSettings();

    await user.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(screen.getByRole('button', { name: 'Signing out…' })).toBeDisabled();
    expect(auth.signOut).not.toHaveBeenCalled();
    await act(async () => flushing.resolve());

    expect(auth.signOut).toHaveBeenCalledTimes(1);
    // Refused changes aren't counted: they wait for the next app start, not for a sign-in.
    await waitFor(() => expect(useUiStore.getState().toast?.message).toBe('Signed out. 2 changes wait on this device until you sign in.'));
  });

  it('says one change waits', async () => {
    deployed(SIGNED_IN);
    await linkedPhone({}, [queued('meals', 'm1')]);
    const user = userEvent.setup();
    renderSettings();

    await user.click(await screen.findByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(useUiStore.getState().toast?.message).toBe('Signed out. 1 change waits on this device until you sign in.'));
  });

  it('says so when signing out fails', async () => {
    deployed(SIGNED_IN);
    auth.signOut.mockRejectedValue(new Error('nope'));
    const user = userEvent.setup();
    renderSettings();

    await user.click(await screen.findByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(useUiStore.getState().toast?.message).toBe("Couldn't sign out. Try again."));
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled();
  });

  it('shows up to date, with the account and Sync now', async () => {
    deployed(SIGNED_IN);
    await linkedPhone({ lastSyncedAt: Date.now() - 5 * MINUTE });
    sync.current.state = { phase: 'idle' };
    const user = userEvent.setup();
    renderSettings();

    const card = await screen.findByRole('status');
    await waitFor(() => expect(card).toHaveTextContent('Up to date'));
    const syncCard = group('Account and sync');
    expect(within(syncCard).getByText('Last synced 5 min ago')).toBeInTheDocument();
    // The account it syncs with, as a fact on the card (the Account row says "Signed in as").
    expect(within(syncCard).getByText(EMAIL).tagName).toBe('DD');
    await user.click(within(syncCard).getByRole('button', { name: 'Sync now' }));
    expect(sync.syncNow).toHaveBeenCalledTimes(1);
    expect(useUiStore.getState().toast).toBeNull();
  });

  it('follows the engine', async () => {
    deployed(SIGNED_IN);
    await linkedPhone({ lastSyncedAt: Date.now() - 5 * MINUTE });
    sync.current.state = { phase: 'idle' };
    renderSettings();

    const card = await screen.findByRole('status');
    await waitFor(() => expect(card).toHaveTextContent('Up to date'));
    act(() => sync.set({ phase: 'uploading', progress: { done: 340, total: 1840 } }));
    expect(card).toHaveTextContent('Backing up');
    expect(screen.getByText('340 of 1,840 entries')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Backing up' })).toHaveAttribute('aria-valuenow', '340');

    act(() => sync.set({ phase: 'error', error: 'unreachable', retryAt: Date.now() + 30_000 }));
    expect(card).toHaveTextContent("Can't reach your account");
    expect(screen.getByText('Your entries are safe on this device. Trying again in about a minute.')).toBeInTheDocument();

    // The account answered, and said no: where to look.
    act(() => sync.set({ phase: 'error', error: 'rejected', retryAt: Date.now() + 30_000 }));
    expect(card).toHaveTextContent('Your account refused the last sync');
    expect(
      screen.getByText('Your entries are safe on this device. It keeps trying; if this stays, check Supabase › Logs (DEPLOY.md).'),
    ).toBeInTheDocument();
  });

  it('asks a linked phone that is signed out to sign in, from the card too', async () => {
    deployed({ status: 'signedOut' });
    await linkedPhone({}, [queued('meals', 'm1'), queued('weights', 'w1')]);
    const user = userEvent.setup();
    renderSettings();

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Sign in to keep syncing'));
    expect(screen.getByText('2 changes wait on this device until you sign in.')).toBeInTheDocument();
    await user.click(within(group('Account and sync')).getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('dialog', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('when the account refused the sign-in, offers Try again and Sign out instead', async () => {
    deployed(SIGNED_IN);
    await linkedPhone({}, [queued('meals', 'm1')]);
    sync.current.state = { phase: 'needsSignIn', error: 'needsSignIn' };
    const user = userEvent.setup();
    renderSettings();

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Sign in again to keep syncing'));
    const card = group('Account and sync');
    expect(within(card).getByText("Your account didn't accept this sign-in. Try again, or sign out and in.")).toBeInTheDocument();
    // The Account row still says who is signed in; the card has no Sign in of its own.
    expect(within(card).queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Try again' }));
    expect(sync.syncNow).toHaveBeenCalledTimes(1);

    // The card's ghost Sign out, before the Account row's: through the flush, as the row's is.
    await waitFor(() => expect(within(card).getAllByRole('button', { name: 'Sign out' })[0]).toBeEnabled());
    await user.click(within(card).getAllByRole('button', { name: 'Sign out' })[0] as HTMLElement);
    expect(sync.flushSync).toHaveBeenCalledWith(5_000);
    await waitFor(() => expect(auth.signOut).toHaveBeenCalledTimes(1));
  });

  it('turns sync back on', async () => {
    deployed(SIGNED_IN);
    await linkedPhone({ paused: true });
    const user = userEvent.setup();
    renderSettings();

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Sync is off on this device'));
    await user.click(screen.getByRole('button', { name: 'Turn on sync' }));
    expect(sync.turnSyncBackOn).toHaveBeenCalledTimes(1);
  });

  it('after the account copy was deleted, uploads again or turns sync off', async () => {
    deployed(SIGNED_IN);
    await linkedPhone();
    sync.current.state = { phase: 'cloudReset', error: 'cloudReset' };
    const user = userEvent.setup();
    renderSettings();

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('The copy in your account was deleted'));
    await user.click(screen.getByRole('button', { name: "Upload this device's data" }));
    expect(sync.uploadAfterReset).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Turn off sync' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'Turn off sync' }));
    expect(sync.turnOffAfterReset).toHaveBeenCalledTimes(1);
  });

  it('says so when turning sync off fails', async () => {
    deployed(SIGNED_IN);
    await linkedPhone();
    sync.current.state = { phase: 'cloudReset', error: 'cloudReset' };
    sync.turnOffAfterReset.mockRejectedValue(new SyncError('failed'));
    const user = userEvent.setup();
    renderSettings();

    await user.click(await screen.findByRole('button', { name: 'Turn off sync' }));
    await waitFor(() => expect(useUiStore.getState().toast?.message).toBe("Couldn't turn sync off. Try again."));
  });

  it('switches to the signed-in account after a confirm', async () => {
    deployed({ status: 'signedIn', email: 'other@example.com', userId: 'user-2' });
    await linkedPhone();
    sync.current.state = { phase: 'otherAccount' };
    const user = userEvent.setup();
    renderSettings();

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('This device syncs with another account'));
    expect(screen.getByText(`Synced with ${EMAIL}. You're signed in as other@example.com.`)).toBeInTheDocument();
    const card = group('Account and sync');
    await user.click(within(card).getByRole('button', { name: 'Switch to this account' }));
    let dialog = await screen.findByRole('dialog', { name: 'Sync with this account?' });
    expect(dialog).toHaveAccessibleDescription(`This device's data starts syncing with other@example.com. The copy in ${EMAIL} stays as it is.`);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog', { name: 'Sync with this account?' })).not.toBeInTheDocument();
    expect(sync.switchToSignedInAccount).not.toHaveBeenCalled();

    await user.click(within(card).getByRole('button', { name: 'Switch to this account' }));
    dialog = await screen.findByRole('dialog', { name: 'Sync with this account?' });
    await user.click(within(dialog).getByRole('button', { name: 'Switch' }));
    expect(sync.switchToSignedInAccount).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: 'Sync with this account?' })).not.toBeInTheDocument();
  });

  it('signs out from another account through the flush too', async () => {
    deployed({ status: 'signedIn', email: 'other@example.com', userId: 'user-2' });
    await linkedPhone();
    sync.current.state = { phase: 'otherAccount' };
    const user = userEvent.setup();
    renderSettings();

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('This device syncs with another account'));
    const card = screen.getByRole('status').closest('section');
    if (!(card instanceof HTMLElement)) throw new Error('No sync group');
    // The card's ghost Sign out, before the Account row's.
    await user.click(within(card).getAllByRole('button', { name: 'Sign out' })[0] as HTMLElement);
    expect(sync.flushSync).toHaveBeenCalledWith(5_000);
    await waitFor(() => expect(auth.signOut).toHaveBeenCalledTimes(1));
  });
});

describe('SettingsScreen Which copy to keep?', () => {
  /** The account has its own diary; this phone, 12 meals of its own. */
  async function choosing(lastChangeAt = serverTime(Date.now() - 5 * MINUTE)) {
    deployed(SIGNED_IN);
    await ownDiary();
    sync.current.state = {
      phase: 'choose',
      choice: { cloud: { dataset: 'dataset-2', head: 120, counts: { meals: 30, profile: 1, places: 4 }, lastChangeAt }, localMeals: 12 },
    };
  }

  /** How Postgres sends a timestamptz: six fractional digits and an offset. */
  function serverTime(ms: number): string {
    return new Date(ms).toISOString().replace(/\.(\d{3})Z$/, '.$1456+00:00');
  }

  async function openSheet(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Your account already has a diary'));
    expect(screen.getByText('It came from another device. Choose which copy to keep.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Choose' }));
    return screen.findByRole('dialog', { name: 'Which copy to keep?' });
  }

  it('shows what each copy holds', async () => {
    await choosing();
    const user = userEvent.setup();
    renderSettings();

    const sheet = await openSheet(user);
    expect(within(sheet).getByText("This device and your account each have a diary. They can't be merged, so pick one.")).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: "Use the account's data" })).toHaveAccessibleDescription(
      '30 meals, last changed 5 min ago. Replaces the 12 meals on this device.',
    );
    expect(within(sheet).getByRole('button', { name: "Keep this device's data" })).toHaveAccessibleDescription(
      '12 meals. Replaces the copy in your account, and your other devices follow.',
    );
    expect(within(sheet).getByRole('button', { name: 'Export a backup first' })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Not now' })).toBeInTheDocument();
  });

  it('leaves out the time when the account has none', async () => {
    await choosing();
    sync.current.state = {
      phase: 'choose',
      choice: { cloud: { dataset: 'dataset-2', head: 3, counts: { meals: 1, profile: 1 }, lastChangeAt: null }, localMeals: 0 },
    };
    const user = userEvent.setup();
    renderSettings();

    const sheet = await openSheet(user);
    expect(within(sheet).getByRole('button', { name: "Use the account's data" })).toHaveAccessibleDescription(
      '1 meal. Replaces the data on this device.',
    );
    expect(within(sheet).getByRole('button', { name: "Keep this device's data" })).toHaveAccessibleDescription(
      'No meals. Replaces the copy in your account, and your other devices follow.',
    );
  });

  it("uses the account's data after a confirm", async () => {
    await choosing();
    const restoring = deferred();
    sync.useAccountData.mockReturnValue(restoring.promise);
    const user = userEvent.setup();
    renderSettings();

    const sheet = await openSheet(user);
    await user.click(within(sheet).getByRole('button', { name: "Use the account's data" }));
    let dialog = await screen.findByRole('alertdialog', { name: "Replace this device's data?" });
    expect(dialog).toHaveAccessibleDescription(
      "Everything on this device is replaced with your account's data. Entries only on this device are lost.",
    );
    // Cancel goes back to the sheet.
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Which copy to keep?' })).toBeInTheDocument();
    expect(sync.useAccountData).not.toHaveBeenCalled();

    await user.click(within(sheet).getByRole('button', { name: "Use the account's data" }));
    dialog = await screen.findByRole('alertdialog', { name: "Replace this device's data?" });
    await user.click(within(dialog).getByRole('button', { name: "Replace this device's data" }));
    expect(sync.useAccountData).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Which copy to keep?' })).not.toBeInTheDocument());
    // While it downloads, the card's buttons wait.
    expect(screen.getByRole('button', { name: 'Choose' })).toBeDisabled();

    await act(async () => restoring.resolve());
    expect(useUiStore.getState().toast?.message).toBe("Using your account's data");
    expect(screen.getByRole('button', { name: 'Choose' })).toBeEnabled();
  });

  it("keeps this device's data after a confirm", async () => {
    await choosing();
    const user = userEvent.setup();
    renderSettings();

    const sheet = await openSheet(user);
    await user.click(within(sheet).getByRole('button', { name: "Keep this device's data" }));
    const dialog = await screen.findByRole('alertdialog', { name: "Replace your account's data?" });
    expect(dialog).toHaveAccessibleDescription(
      "Your account gets this device's data. Entries only in your account are deleted, and your other devices follow on their next sync.",
    );
    await user.click(within(dialog).getByRole('button', { name: 'Replace account data' }));

    expect(sync.keepThisDeviceData).toHaveBeenCalledTimes(1);
    expect(sync.useAccountData).not.toHaveBeenCalled();
    await waitFor(() => expect(useUiStore.getState().toast?.message).toBe("Uploading this device's data"));
    expect(screen.queryByRole('dialog', { name: 'Which copy to keep?' })).not.toBeInTheDocument();
  });

  it('says so when a choice fails, and stays quiet when it was stopped', async () => {
    await choosing();
    sync.useAccountData.mockRejectedValueOnce(new SyncError('unreachable')).mockRejectedValueOnce(new SyncError('aborted'));
    const user = userEvent.setup();
    renderSettings();

    let sheet = await openSheet(user);
    await user.click(within(sheet).getByRole('button', { name: "Use the account's data" }));
    let dialog = await screen.findByRole('alertdialog', { name: "Replace this device's data?" });
    await user.click(within(dialog).getByRole('button', { name: "Replace this device's data" }));
    await waitFor(() => expect(useUiStore.getState().toast?.message).toBe("Couldn't get your account's data. Try again."));

    act(() => useUiStore.getState().hideToast());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Choose' })).toBeEnabled());
    sheet = await openSheet(user);
    await user.click(within(sheet).getByRole('button', { name: "Use the account's data" }));
    dialog = await screen.findByRole('alertdialog', { name: "Replace this device's data?" });
    await user.click(within(dialog).getByRole('button', { name: "Replace this device's data" }));
    await waitFor(() => expect(sync.useAccountData).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Choose' })).toBeEnabled());
    expect(useUiStore.getState().toast).toBeNull();
  });

  it('Not now turns sync off here', async () => {
    await choosing();
    const user = userEvent.setup();
    renderSettings();

    const sheet = await openSheet(user);
    await user.click(within(sheet).getByRole('button', { name: 'Not now' }));
    expect(sync.notNow).toHaveBeenCalledTimes(1);
    expect(sync.useAccountData).not.toHaveBeenCalled();
    expect(sync.keepThisDeviceData).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Which copy to keep?' })).not.toBeInTheDocument());
  });

  it('can export a backup first', async () => {
    await choosing();
    const user = userEvent.setup();
    const router = renderSettings();

    const sheet = await openSheet(user);
    await user.click(within(sheet).getByRole('button', { name: 'Export a backup first' }));
    expect(router.state.location.pathname).toBe(PATHS.export);
    expect(await screen.findByRole('heading', { name: 'Export screen' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Which copy to keep?' })).not.toBeInTheDocument();
  });

  it('closes when the choice was made elsewhere, and stays closed', async () => {
    await choosing();
    const user = userEvent.setup();
    renderSettings();

    const choose = sync.current.state;
    await openSheet(user);
    act(() => sync.set({ phase: 'syncing' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Which copy to keep?' })).not.toBeInTheDocument());
    act(() => sync.set(choose));
    expect(await screen.findByRole('button', { name: 'Choose' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Which copy to keep?' })).not.toBeInTheDocument();
  });
});
