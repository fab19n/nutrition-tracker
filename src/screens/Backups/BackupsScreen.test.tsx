import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PATHS } from '@/app/paths';
import { topLocalSheet } from '@/components/BottomSheet/BottomSheet';
import type { SessionState } from '@/auth/session';
import { loadDemoData, resetAll, syncDemoClock } from '@/db/actions';
import { createDb, db, TABLE_NAMES, type KiraMakanDb } from '@/db/db';
import { BACKUP_FORMAT } from '@/db/export';
import { clearLastExport, readLastBackupAt, readLastExport, writeLastBackupAt, writeLastExport } from '@/db/settings';
import { DEMO_IDS, loadDemo } from '@/db/seed/demo';
import type { SyncLink, SyncMeta } from '@/db/syncTypes';
import { DEMO_NOW_ISO, isDemoClock } from '@/domain/clock';
import { logicalDayOf } from '@/domain/day';
import { backupFileOf, jsonFile, type BackupFileOptions } from '@/test/backupFiles';
import { resetUiState, useUiStore } from '@/state/ui';
import type { EngineState } from '@/sync';
import BackupsScreen from './BackupsScreen';

/** Stands in for the Supabase session (src/auth/session.ts): unconfigured unless a test says so. */
const auth = vi.hoisted(() => ({
  configured: false,
  state: { status: 'unconfigured' } as SessionState,
}));

vi.mock('@/auth/session', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/session')>()),
  isAuthConfigured: () => auth.configured,
  useSession: () => auth.state,
}));

/**
 * Stands in for the sync engine (src/sync/index.ts): the card reads its state, and Sync now is a
 * mock a test can make slow, or have leave the engine in another state.
 */
const sync = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const current: { state: EngineState } = { state: { phase: 'starting' } };
  return {
    current,
    listeners,
    set(state: EngineState) {
      current.state = state;
      for (const listener of [...listeners]) listener();
    },
    syncNow: vi.fn<() => Promise<void>>(async () => {}),
  };
});

vi.mock('@/sync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/sync')>()),
  getEngineState: () => sync.current.state,
  subscribeEngine: (listener: () => void) => {
    sync.listeners.add(listener);
    return () => sync.listeners.delete(listener);
  },
  syncNow: () => sync.syncNow(),
}));

const EMAIL = 'fabian@example.com';
const USER_ID = 'user-1';
const SIGNED_IN: SessionState = { status: 'signedIn', email: EMAIL, userId: USER_ID };
const TZ = 'Asia/Kuala_Lumpur';
const DAY_MS = 86_400_000;

const LINK: SyncLink = {
  userId: USER_ID,
  email: EMAIL,
  dataset: 'dataset-1',
  deviceId: 'device-1',
  cursor: 0,
  protocol: 1,
  linkedAt: 0,
};

/** A time `days` days before the real now, as the card reads it. */
const isoDaysAgo = (days: number): string => new Date(Date.now() - days * DAY_MS).toISOString();
const dayDaysAgo = (days: number): string => logicalDayOf(new Date(Date.now() - days * DAY_MS), TZ, 0);

/** The deployed app: Supabase configured, with this session. */
function deployed(state: SessionState): void {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://abcdefgh.supabase.co');
  vi.stubEnv('VITE_SUPABASE_KEY', 'sb_publishable_test_key');
  auth.configured = true;
  auth.state = state;
}

/** This phone's own diary: the demo's data, out of demo mode, started `startedDaysAgo` days ago. */
async function ownDiary(startedDaysAgo = 10): Promise<void> {
  await db.profile.update('me', { demoMode: false, startedOn: dayDaysAgo(startedDaysAgo) });
  // As the app does at start-up: the clock follows the profile, so "now" is the real one.
  await syncDemoClock();
}

/** This phone's own diary, synced with an account. */
async function linkedPhone(meta: Partial<SyncMeta> = {}, startedDaysAgo = 10): Promise<void> {
  await ownDiary(startedDaysAgo);
  await db.syncMeta.put({ id: 'sync', link: LINK, ...meta });
}

/** A promise the test settles by hand, to look at the screen while something runs. */
function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** A card's section, found by its heading. */
function section(name: string): HTMLElement {
  const found = screen.getByRole('heading', { level: 2, name }).closest('section');
  if (!(found instanceof HTMLElement)) throw new Error(`No ${name} section`);
  return found;
}

function renderBackups() {
  const router = createMemoryRouter(
    [
      { path: '/more/backups', element: <BackupsScreen /> },
      { path: '/more/settings', element: <h1>Settings screen</h1> },
      { path: '/more/export', element: <h1>Export screen</h1> },
      { path: '/', element: <h1>Today screen</h1> },
    ],
    { initialEntries: [PATHS.backups] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

/** Captures what would be downloaded: jsdom has no object URLs and can't follow <a download>. */
function captureDownloads() {
  const blobs: Blob[] = [];
  const names: string[] = [];
  const create = vi.fn((blob: Blob) => {
    blobs.push(blob);
    return `blob:test/${blobs.length}`;
  });
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: create });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    names.push(this.download);
  });
  return { blobs, names, create, restore: () => click.mockRestore() };
}

let downloads: ReturnType<typeof captureDownloads>;
/** The backup file's own database: the demo's world, as another phone (or this one earlier) had it. */
let source: KiraMakanDb;

beforeEach(async () => {
  vi.stubEnv('VITE_SUPABASE_URL', '');
  vi.stubEnv('VITE_SUPABASE_KEY', '');
  auth.configured = false;
  auth.state = { status: 'unconfigured' };
  sync.current.state = { phase: 'starting' };
  sync.syncNow.mockReset().mockResolvedValue(undefined);
  await resetAll();
  resetUiState();
  clearLastExport();
  await loadDemoData();
  downloads = captureDownloads();
  source = createDb(`backups-source-${crypto.randomUUID()}`);
  await loadDemo(source);
});

afterEach(async () => {
  vi.restoreAllMocks();
  downloads.restore();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  window.localStorage.clear();
  await source.delete();
  await resetAll();
});

/** The app's own database as a list of rows per table, for comparing with the file's. */
async function rowsOf(database: KiraMakanDb, skip: string[] = []): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {};
  for (const name of TABLE_NAMES) {
    if (skip.includes(name)) continue;
    const rows = await database.table(name).toArray();
    out[name] = rows.sort((a: Record<string, string>, b: Record<string, string>) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  return out;
}

/** Picks a file on the screen. */
async function choose(user: ReturnType<typeof userEvent.setup>, file: File): Promise<void> {
  await user.upload(await screen.findByLabelText('Backup file'), file);
}

/** Picks a real diary's backup and waits for the preview. */
async function openPreview(user: ReturnType<typeof userEvent.setup>, title = 'Restore this backup?'): Promise<HTMLElement> {
  await choose(user, await backupFileOf(source, { real: true }));
  return screen.findByRole('dialog', { name: title });
}

describe('BackupsScreen without an account (S39)', () => {
  it('has the file card and the Restore card, and no account section', async () => {
    renderBackups();

    expect(screen.getByRole('heading', { level: 1, name: 'Backups' })).toBeInTheDocument();
    expect(await screen.findByText('A copy of your diary as a file you keep, and a way to restore it.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Your account' })).not.toBeInTheDocument();
    expect(screen.queryByText('Account and sync')).not.toBeInTheDocument();

    const file = section('Backup file');
    expect(within(file).getByRole('status')).toHaveTextContent('No export yet');
    expect(within(file).getByText('None yet')).toBeInTheDocument();
    expect(within(file).getByText('Export saves your whole diary as one file you can restore from.')).toBeInTheDocument();
    expect(within(file).getByRole('button', { name: 'Export now' })).toBeInTheDocument();
    expect(within(file).getByText("The file goes to your downloads. Meal photos stay on this phone and aren't in it. Keep a copy somewhere off this phone.")).toBeInTheDocument();
    expect(within(file).getByRole('button', { name: /^Other export options/ })).toHaveTextContent(
      'Spreadsheet files for meals, weights and workouts',
    );

    const restore = section('Restore');
    expect(within(restore).getByRole('heading', { level: 3, name: 'Restore from a backup file' })).toBeInTheDocument();
    expect(within(restore).getByText("Pick a file saved by Export now. You see what's in it before anything changes.")).toBeInTheDocument();
    expect(within(restore).getByRole('button', { name: 'Choose a backup file' })).toBeEnabled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('goes back to Settings when opened directly', async () => {
    const user = userEvent.setup();
    const router = renderBackups();

    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(router.state.location.pathname).toBe(PATHS.settings);
  });

  it('opens Other export options', async () => {
    const user = userEvent.setup();
    const router = renderBackups();

    await user.click(await screen.findByRole('button', { name: /^Other export options/ }));
    expect(router.state.location.pathname).toBe(PATHS.export);
  });
});

describe('BackupsScreen the account card', () => {
  it('shows up to date, runs Sync now in place, and leads to Settings', async () => {
    deployed(SIGNED_IN);
    await linkedPhone({ lastSyncedAt: Date.now() - 5 * 60_000 });
    sync.current.state = { phase: 'idle' };
    const user = userEvent.setup();
    const router = renderBackups();

    expect(await screen.findByText('A second copy of your diary: in your account, and as a file you keep.')).toBeInTheDocument();
    await waitFor(() => expect(within(section('Your account')).getByRole('status')).toHaveTextContent('Up to date'));
    const account = section('Your account');
    expect(within(account).getByText('Last synced 5 min ago')).toBeInTheDocument();
    await user.click(within(account).getByRole('button', { name: 'Sync now' }));
    expect(sync.syncNow).toHaveBeenCalledTimes(1);
    expect(router.state.location.pathname).toBe(PATHS.backups);

    await user.click(within(account).getByRole('button', { name: /^Account and sync/ }));
    expect(router.state.location.pathname).toBe(PATHS.settings);
  });

  it('waits while Sync now runs', async () => {
    deployed(SIGNED_IN);
    await linkedPhone({ lastSyncedAt: Date.now() - 5 * 60_000 });
    sync.current.state = { phase: 'idle' };
    const running = deferred();
    sync.syncNow.mockReturnValueOnce(running.promise);
    const user = userEvent.setup();
    renderBackups();

    await screen.findByRole('heading', { name: 'Your account' });
    await user.click(await within(section('Your account')).findByRole('button', { name: 'Sync now' }));
    expect(within(section('Your account')).getByRole('button', { name: 'Sync now' })).toBeDisabled();
    await act(async () => running.resolve());
    expect(within(section('Your account')).getByRole('button', { name: 'Sync now' })).toBeEnabled();
  });

  it.each<[string, () => Promise<void>, SessionState]>([
    [
      'a linked phone that is signed out',
      async () => {
        await linkedPhone();
      },
      { status: 'signedOut' },
    ],
    [
      'two diaries that must be chosen between',
      async () => {
        await ownDiary();
        sync.current.state = {
          phase: 'choose',
          choice: { cloud: { dataset: 'dataset-2', head: 120, counts: { meals: 30 }, lastChangeAt: null }, localMeals: 12 },
        };
      },
      SIGNED_IN,
    ],
    [
      'another account',
      async () => {
        await linkedPhone();
        sync.current.state = { phase: 'otherAccount' };
      },
      { status: 'signedIn', email: 'other@example.com', userId: 'user-2' },
    ],
    [
      'an account copy that was deleted',
      async () => {
        await linkedPhone();
        sync.current.state = { phase: 'cloudReset', error: 'cloudReset' };
      },
      SIGNED_IN,
    ],
  ])('says Needs you for %s, and leaves the fix to Settings', async (_name, setUp, session) => {
    deployed(session);
    await setUp();
    const user = userEvent.setup();
    const router = renderBackups();

    await waitFor(() => expect(within(section('Your account')).getByRole('status')).toHaveTextContent('Needs you'));
    const account = section('Your account');
    // Sign in, Choose, Switch, Upload and Sign out are Settings' to offer, with their confirms.
    for (const name of ['Sign in', 'Choose', 'Switch to this account', "Upload this device's data", 'Sign out', 'Turn off sync']) {
      expect(within(account).queryByRole('button', { name })).not.toBeInTheDocument();
    }
    const open = within(account).getByRole('button', { name: 'Open Settings' });
    expect(open.className).toMatch(/primary/);
    expect(within(account).getAllByRole('button', { name: /^(Open Settings)$/ })).toHaveLength(1);
    await user.click(open);
    expect(router.state.location.pathname).toBe(PATHS.settings);
  });

  it('offers a secondary Open Settings, not Turn on sync, when sync is off here', async () => {
    deployed(SIGNED_IN);
    await linkedPhone({ paused: true });
    const user = userEvent.setup();
    const router = renderBackups();

    await waitFor(() => expect(within(section('Your account')).getByRole('status')).toHaveTextContent('Sync is off on this device'));
    const account = section('Your account');
    expect(within(account).queryByRole('button', { name: 'Turn on sync' })).not.toBeInTheDocument();
    const open = within(account).getByRole('button', { name: 'Open Settings' });
    expect(open.className).toMatch(/secondary/);
    await user.click(open);
    expect(router.state.location.pathname).toBe(PATHS.settings);
  });

  it('runs Try again in place after an error', async () => {
    deployed(SIGNED_IN);
    await linkedPhone();
    sync.current.state = { phase: 'error', error: 'unreachable', retryAt: Date.now() + 30_000 };
    const user = userEvent.setup();
    renderBackups();

    await waitFor(() => expect(within(section('Your account')).getByRole('status')).toHaveTextContent("Can't reach your account"));
    await user.click(within(section('Your account')).getByRole('button', { name: 'Try again' }));
    expect(sync.syncNow).toHaveBeenCalledTimes(1);
  });

  it('runs Try again in place when the account refused the token, and has no Sign out here', async () => {
    deployed(SIGNED_IN);
    await linkedPhone();
    sync.current.state = { phase: 'needsSignIn', error: 'needsSignIn' };
    const user = userEvent.setup();
    renderBackups();

    await waitFor(() => expect(within(section('Your account')).getByRole('status')).toHaveTextContent('Sign in again to keep syncing'));
    const account = section('Your account');
    expect(within(account).queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
    expect(within(account).queryByRole('button', { name: 'Open Settings' })).not.toBeInTheDocument();
    await user.click(within(account).getByRole('button', { name: 'Try again' }));
    expect(sync.syncNow).toHaveBeenCalledTimes(1);
  });

  it('says the file is the only copy while signed out', async () => {
    deployed({ status: 'signedOut' });
    await ownDiary();
    renderBackups();

    expect(
      await screen.findByText('Until you sign in, your diary is only on this phone. A backup file is another way to keep a copy.'),
    ).toBeInTheDocument();
    expect(within(section('Your account')).getByRole('status')).toHaveTextContent('Sync is off');
    expect(within(section('Your account')).queryByRole('button', { name: /Sync now|Try again|Open Settings/ })).not.toBeInTheDocument();
    // Sign-in still lives in Settings, one tap away.
    expect(within(section('Your account')).getByRole('button', { name: /^Account and sync/ })).toBeInTheDocument();
  });

  it('says what demo mode is, and has no Account and sync row', async () => {
    deployed({ status: 'signedOut' });
    renderBackups();

    expect(
      await screen.findByText('Backups start once you set up your own diary. A backup file can still replace the sample week.'),
    ).toBeInTheDocument();
    await waitFor(() => expect(within(section('Your account')).getByRole('status')).toHaveTextContent('Sync is off in demo mode'));
    expect(screen.queryByText('Account and sync')).not.toBeInTheDocument();
  });
});

describe('BackupsScreen Export now', () => {
  it('downloads a full backup, says so, and shows it as the last export', async () => {
    const user = userEvent.setup();
    renderBackups();

    await user.click(await screen.findByRole('button', { name: 'Export now' }));

    await waitFor(() => expect(downloads.blobs).toHaveLength(1));
    expect(downloads.names).toEqual(['kira-makan-backup-2026-10-16.json']);
    const backup = JSON.parse(await downloads.blobs[0]!.text()) as { format: string; tables: { meals: unknown[]; profile: unknown[] } };
    expect(backup.format).toBe(BACKUP_FORMAT);
    expect(backup.tables.meals.length).toBeGreaterThan(0);
    expect(backup.tables.profile).toHaveLength(1);

    expect(useUiStore.getState().toast?.message).toBe('Backup done · kira-makan-backup-2026-10-16.json');
    const file = section('Backup file');
    await waitFor(() => expect(within(file).getByRole('status')).toHaveTextContent('Last export today'));
    expect(within(file).getByText('Saved')).toBeInTheDocument();
    expect(within(file).getByText('Fri 16 Oct, 7:10pm')).toBeInTheDocument();
    expect(readLastBackupAt()).toBe('2026-10-16T11:10:00.000Z');
    expect(readLastExport()).toEqual({ at: '2026-10-16T11:10:00.000Z', kind: 'json' });
  });

  it('says so when the file can not be made, and changes nothing', async () => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: () => {
        throw new Error('no storage');
      },
    });
    const user = userEvent.setup();
    renderBackups();

    await user.click(await screen.findByRole('button', { name: 'Export now' }));

    await waitFor(() => expect(useUiStore.getState().toast?.message).toBe("Couldn't export right now. Try again."));
    expect(readLastBackupAt()).toBeNull();
    expect(within(section('Backup file')).getByRole('status')).toHaveTextContent('No export yet');
    expect(screen.getByRole('button', { name: 'Export now' })).toBeEnabled();
  });
});

describe('BackupsScreen the monthly nudge', () => {
  const fileCard = () => section('Backup file');

  it('says Due and makes Export now the main button when the last backup is over 30 days old', async () => {
    await ownDiary(100);
    writeLastBackupAt(isoDaysAgo(45));
    renderBackups();

    await waitFor(() => expect(within(fileCard()).getByRole('status')).toHaveTextContent('Last export 45 days ago'));
    expect(within(fileCard()).getByText('Due')).toBeInTheDocument();
    expect(within(fileCard()).getByText("It's been a while. A fresh file takes a few seconds.")).toBeInTheDocument();
    expect(within(fileCard()).getByRole('button', { name: 'Export now' }).className).toMatch(/primary/);
  });

  it('says Saved for a recent backup, with a secondary button', async () => {
    await ownDiary(100);
    writeLastBackupAt(isoDaysAgo(10));
    renderBackups();

    await waitFor(() => expect(within(fileCard()).getByRole('status')).toHaveTextContent('Last export 10 days ago'));
    expect(within(fileCard()).getByText('Saved')).toBeInTheDocument();
    expect(within(fileCard()).queryByText('Due')).not.toBeInTheDocument();
    expect(within(fileCard()).getByRole('button', { name: 'Export now' }).className).toMatch(/secondary/);
  });

  it('counts a diary that was never exported from its first day', async () => {
    await ownDiary(40);
    renderBackups();

    await waitFor(() => expect(within(fileCard()).getByText('Due')).toBeInTheDocument());
    expect(within(fileCard()).getByRole('status')).toHaveTextContent('No export yet');
    expect(within(fileCard()).getByText('Your diary is 40 days old. A file is a copy that lives outside the app.')).toBeInTheDocument();
  });

  it('says None yet for a young diary', async () => {
    await ownDiary(10);
    renderBackups();

    await waitFor(() => expect(within(fileCard()).getByText('None yet')).toBeInTheDocument());
    expect(within(fileCard()).queryByText('Due')).not.toBeInTheDocument();
  });

  it('never says Due for a diary with no meals', async () => {
    await ownDiary(100);
    await db.meals.clear();
    renderBackups();

    await waitFor(() => expect(within(fileCard()).getByRole('status')).toHaveTextContent('No export yet'));
    expect(within(fileCard()).getByText('None yet')).toBeInTheDocument();
    expect(within(fileCard()).queryByText('Due')).not.toBeInTheDocument();
  });

  it('never says Due on the sample week', async () => {
    await db.profile.update('me', { startedOn: dayDaysAgo(100) });
    writeLastBackupAt(isoDaysAgo(45));
    renderBackups();

    await waitFor(() => expect(within(fileCard()).getByRole('status')).toHaveTextContent('Last export'));
    expect(within(fileCard()).queryByText('Due')).not.toBeInTheDocument();
  });

  it('is not cleared by a spreadsheet export a day ago', async () => {
    await ownDiary(100);
    writeLastBackupAt(isoDaysAgo(45));
    writeLastExport({ at: isoDaysAgo(1), kind: 'csv' });
    renderBackups();

    await waitFor(() => expect(within(fileCard()).getByRole('status')).toHaveTextContent('Last export 45 days ago'));
    expect(within(fileCard()).getByText('Due')).toBeInTheDocument();
  });

  it('mentions the account copy on a device that syncs, and goes away once a file is saved', async () => {
    deployed(SIGNED_IN);
    await linkedPhone({}, 100);
    sync.current.state = { phase: 'idle' };
    writeLastBackupAt(isoDaysAgo(45));
    const user = userEvent.setup();
    renderBackups();

    await waitFor(() =>
      expect(within(fileCard()).getByText("It's been a while. Your account keeps a copy; a fresh file doesn't depend on it.")).toBeInTheDocument(),
    );
    expect(within(fileCard()).getByText("The file goes to your downloads. Meal photos stay on this device and aren't in it. Keep a copy somewhere off this device.")).toBeInTheDocument();
    await user.click(within(fileCard()).getByRole('button', { name: 'Export now' }));
    await waitFor(() => expect(within(fileCard()).getByRole('status')).toHaveTextContent('Last export today'));
    expect(within(fileCard()).queryByText('Due')).not.toBeInTheDocument();
  });
});

describe('BackupsScreen Restore on a diary that stays on this phone', () => {
  it('steps back from the confirm to the preview on Back, and closes the sheet on the next Back', async () => {
    await ownDiary();
    const before = await db.meals.count();
    const user = userEvent.setup();
    renderBackups();

    const sheet = await openPreview(user);
    await user.click(within(sheet).getByRole('button', { name: 'Restore this backup' }));
    await screen.findByRole('alertdialog');

    // The phone's Back button: the shell closes the newest sheet that has no history entry of its own.
    const back = () => {
      const top = topLocalSheet();
      expect(top?.dismissible).toBe(true);
      act(() => top?.close());
    };
    back();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    // Still the preview, with the file loaded: Restore asks again without picking the file again.
    const preview = screen.getByRole('dialog', { name: 'Restore this backup?' });
    await user.click(within(preview).getByRole('button', { name: 'Restore this backup' }));
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();

    back();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    back();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await db.meals.count()).toBe(before);
  });

  it('shows what is in the file against this phone, then replaces everything after a confirm', async () => {
    await ownDiary();
    await db.profile.update('me', { theme: 'dark' });
    // Two meals and a weigh-in here that the file hasn't got.
    const lunch = await db.meals.get(DEMO_IDS.meals.todayLunch);
    await db.meals.bulkPut([
      { ...(lunch as NonNullable<typeof lunch>), id: 'extra-1', name: 'Extra one' },
      { ...(lunch as NonNullable<typeof lunch>), id: 'extra-2', name: 'Extra two' },
    ]);
    await db.weights.put({ id: 'extra-w', measuredAt: isoDaysAgo(0), logicalDay: dayDaysAgo(0), kg: 77.1 });
    const user = userEvent.setup();
    const router = renderBackups();

    const fileMeals = await source.meals.count();
    const sheet = await openPreview(user);

    // What is in the file.
    expect(within(sheet).getByText('Everything on this phone is replaced by this backup.')).toBeInTheDocument();
    expect(within(sheet).getByText('kira-makan-backup-2026-10-16.json')).toBeInTheDocument();
    expect(within(sheet).getByText('Exported 16 Oct 2026, 7:10pm')).toBeInTheDocument();
    const count = (label: string) => within(sheet).getByText(label).closest('div')?.querySelector('dd')?.textContent;
    expect(count('Meals')).toBe(String(fileMeals));
    expect(count('Weigh-ins')).toBe('14');
    expect(count('Workouts')).toBe('1');
    expect(count('Places')).toBe('4');
    expect(count('Usuals')).toBe('4');
    expect(count('Pots')).toBe('1');
    expect(count('Goals')).toBe('4');
    expect(within(sheet).getByText('Other entries')).toBeInTheDocument();
    expect(within(sheet).getByText(/^Meals from \d+ \w{3} 2026 to 16 Oct 2026$/)).toBeInTheDocument();
    expect(within(sheet).getByText('Photos: not in this file. Photos on this phone stay.')).toBeInTheDocument();
    // What would be lost here.
    expect(
      within(sheet).getByText('On this phone but not in the backup: 2 meals and 1 weigh-in. They will be lost.'),
    ).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Export this phone first' })).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    // Cancel changes nothing.
    await user.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await db.meals.count()).toBe(fileMeals + 2);

    // Restore asks first.
    const again = await openPreview(user);
    await user.click(within(again).getByRole('button', { name: 'Restore this backup' }));
    const confirm = await screen.findByRole('alertdialog', { name: 'Replace everything on this phone?' });
    expect(confirm).toHaveAccessibleDescription(
      "The backup from 16 Oct 2026 replaces every meal, weigh-in, Place and goal here. Anything added since then is lost, and it can't be undone.",
    );
    expect(within(confirm).queryByRole('textbox')).not.toBeInTheDocument();
    // Cancel goes back to the preview.
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Restore this backup?' })).toBeInTheDocument();
    expect(await db.meals.count()).toBe(fileMeals + 2);

    await user.click(within(screen.getByRole('dialog', { name: 'Restore this backup?' })).getByRole('button', { name: 'Restore this backup' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Replace everything' }));

    const done = await screen.findByRole('dialog', { name: 'Backup restored' });
    expect(within(done).getByText(`Your backup is on this phone: ${fileMeals} meals, 14 weigh-ins and 4 Places.`)).toBeInTheDocument();
    expect(within(done).queryByText(/account/)).not.toBeInTheDocument();
    expect(await rowsOf(db, ['profile'])).toEqual(await rowsOf(source, ['profile']));
    expect(await db.meals.get('extra-1')).toBeUndefined();
    expect(await db.weights.get('extra-w')).toBeUndefined();
    expect(await db.profile.get('me')).toMatchObject({ theme: 'dark', demoMode: false });
    expect(readLastBackupAt()).toBe('2026-10-16T11:10:00.000Z');
    expect(sync.syncNow).toHaveBeenCalledTimes(1);

    // Done closes the sheet; Open Today goes there.
    await user.click(within(done).getByRole('button', { name: 'Open Today' }));
    expect(router.state.location.pathname).toBe(PATHS.today);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('says everything here is also in the backup when it is', async () => {
    await ownDiary();
    const user = userEvent.setup();
    renderBackups();

    const sheet = await openPreview(user);
    expect(within(sheet).getByText('Everything on this phone is also in the backup.')).toBeInTheDocument();
    expect(within(sheet).queryByText(/They will be lost/)).not.toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    expect(await db.meals.count()).toBe(await source.meals.count());
  });

  it('closes the done sheet with Done', async () => {
    await ownDiary();
    const user = userEvent.setup();
    const router = renderBackups();

    const sheet = await openPreview(user);
    await user.click(within(sheet).getByRole('button', { name: 'Restore this backup' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Replace everything' }));
    const done = await screen.findByRole('dialog', { name: 'Backup restored' });
    await user.click(within(done).getByRole('button', { name: 'Done' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe(PATHS.backups);
  });

  it('shows a restored backup as the last export, so the nudge goes quiet', async () => {
    await ownDiary(100);
    const user = userEvent.setup();
    renderBackups();
    await waitFor(() => expect(within(section('Backup file')).getByText('Due')).toBeInTheDocument());

    const file = await backupFileOf(source, { real: true, exportedAt: isoDaysAgo(2) });
    await choose(user, file);
    const sheet = await screen.findByRole('dialog', { name: 'Restore this backup?' });
    expect(within(sheet).getByText('2 days ago')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Restore this backup' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Replace everything' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Backup restored' })).getByRole('button', { name: 'Done' }));

    await waitFor(() => expect(within(section('Backup file')).getByRole('status')).toHaveTextContent('Last export 2 days ago'));
    expect(within(section('Backup file')).queryByText('Due')).not.toBeInTheDocument();
  });
});

/**
 * Makes storing the meals fail once, the way a full disk would: the profile and goals were written
 * by then, so this also shows the transaction taking them back. Returns the spy; restore it to let a retry through.
 */
function failMealsOnce(error: Error) {
  const table = Object.getPrototypeOf(db.meals) as { bulkPut: (this: { name: string }, ...args: unknown[]) => Promise<unknown> };
  const original = table.bulkPut;
  return vi.spyOn(table, 'bulkPut').mockImplementation(function (this: { name: string }, ...args: unknown[]) {
    if (this.name === 'meals') return Promise.reject(error);
    return original.apply(this, args);
  });
}

describe('BackupsScreen Restore on a diary that syncs', () => {
  /** What Sync now saw: how many meals were in the database each time it ran. */
  let seen: number[];

  beforeEach(() => {
    seen = [];
    deployed(SIGNED_IN);
    sync.current.state = { phase: 'idle' };
    sync.syncNow.mockImplementation(async () => {
      seen.push(await db.meals.count());
    });
  });

  async function unsyncedExtra(): Promise<number> {
    await linkedPhone();
    const lunch = await db.meals.get(DEMO_IDS.meals.todayLunch);
    await db.meals.put({ ...(lunch as NonNullable<typeof lunch>), id: 'extra-1' });
    return db.meals.count();
  }

  it('says the account follows, and needs REPLACE typed', async () => {
    const before = await unsyncedExtra();
    const user = userEvent.setup();
    renderBackups();

    const sheet = await openPreview(user);
    expect(
      within(sheet).getByText('Everything on this device, in your account and on your other devices is replaced by this backup.'),
    ).toBeInTheDocument();
    expect(within(sheet).getByText('On this device but not in the backup: 1 meal. They will be lost.')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Export this device first' })).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Restore this backup' }));

    const confirm = await screen.findByRole('alertdialog', { name: 'Replace your diary everywhere?' });
    expect(confirm).toHaveAccessibleDescription(
      "The backup from 16 Oct 2026 replaces every meal, weigh-in, Place and goal on this device, in your account and on your other devices. Anything added since then is lost, and it can't be undone.",
    );
    const replace = within(confirm).getByRole('button', { name: 'Replace everything' });
    expect(replace).toBeDisabled();
    const field = within(confirm).getByRole('textbox');
    await user.type(field, 'replace');
    expect(replace).toBeDisabled();
    await user.clear(field);
    await user.type(field, 'REPLACE');
    expect(replace).toBeEnabled();
    expect(await db.meals.count()).toBe(before);
    expect(sync.syncNow).not.toHaveBeenCalled();

    await user.click(replace);

    const done = await screen.findByRole('dialog', { name: 'Backup restored' });
    expect(within(done).getByText(/^Your backup is on this device: /)).toBeInTheDocument();
    expect(within(done).getByText('Your account and your other devices follow as this device syncs.')).toBeInTheDocument();
    // Caught up first (the phone still had its extra meal), wrote, then asked sync to send the result.
    await waitFor(async () => expect(seen).toEqual([before, await source.meals.count()]));
    expect(await db.meals.get('extra-1')).toBeUndefined();
    expect(await db.syncOutbox.get(['meals', 'extra-1'])).toBeDefined();
    expect((await db.syncMeta.get('sync'))?.link).toEqual(LINK);
  });

  it('stops before writing when the account can not be reached, and tries again', async () => {
    const before = await unsyncedExtra();
    sync.syncNow.mockImplementationOnce(async () => {
      seen.push(await db.meals.count());
      sync.set({ phase: 'offline', error: 'offline' });
    });
    const user = userEvent.setup();
    renderBackups();

    const sheet = await openPreview(user);
    await user.click(within(sheet).getByRole('button', { name: 'Restore this backup' }));
    const confirm = await screen.findByRole('alertdialog');
    await user.type(within(confirm).getByRole('textbox'), 'REPLACE');
    await user.click(within(confirm).getByRole('button', { name: 'Replace everything' }));

    const failed = await screen.findByRole('dialog', { name: "Couldn't reach your account" });
    expect(within(failed).getByRole('alert')).toHaveTextContent(
      "Restoring a file replaces your account's copy too, so it needs a connection first. Nothing was changed.",
    );
    expect(await db.meals.count()).toBe(before);
    expect(await db.meals.get('extra-1')).toBeDefined();
    expect(seen).toEqual([before]);

    // Back online: Try again catches up again, then restores.
    act(() => sync.set({ phase: 'idle' }));
    await user.click(within(failed).getByRole('button', { name: 'Try again' }));
    const done = await screen.findByRole('dialog', { name: 'Backup restored' });
    expect(within(done).getByText('Your account and your other devices follow as this device syncs.')).toBeInTheDocument();
    await waitFor(async () => expect(seen).toEqual([before, before, await source.meals.count()]));
    expect(await db.meals.get('extra-1')).toBeUndefined();
  });

  it('can be cancelled after a failure, leaving the diary as it was', async () => {
    const before = await unsyncedExtra();
    sync.syncNow.mockImplementationOnce(async () => sync.set({ phase: 'offline', error: 'offline' }));
    const user = userEvent.setup();
    renderBackups();

    const sheet = await openPreview(user);
    await user.click(within(sheet).getByRole('button', { name: 'Restore this backup' }));
    const confirm = await screen.findByRole('alertdialog');
    await user.type(within(confirm).getByRole('textbox'), 'REPLACE');
    await user.click(within(confirm).getByRole('button', { name: 'Replace everything' }));
    const failed = await screen.findByRole('dialog', { name: "Couldn't reach your account" });
    await user.click(within(failed).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await db.meals.count()).toBe(before);
  });

  it.each([
    ['needsSignIn', { phase: 'needsSignIn', error: 'needsSignIn' }],
    ['cloudReset', { phase: 'cloudReset', error: 'cloudReset' }],
    ['otherAccount', { phase: 'otherAccount' }],
  ] as const)('sends you to Settings, not to Try again, when the catch-up ends in %s', async (_name, state) => {
    const before = await unsyncedExtra();
    sync.syncNow.mockImplementationOnce(async () => sync.set(state));
    const user = userEvent.setup();
    const router = renderBackups();

    const sheet = await openPreview(user);
    await user.click(within(sheet).getByRole('button', { name: 'Restore this backup' }));
    const confirm = await screen.findByRole('alertdialog');
    await user.type(within(confirm).getByRole('textbox'), 'REPLACE');
    await user.click(within(confirm).getByRole('button', { name: 'Replace everything' }));

    const failed = await screen.findByRole('dialog', { name: 'Sync needs you first' });
    expect(within(failed).getByRole('alert')).toHaveTextContent('Open Settings, then come back to restore a file.');
    expect(within(failed).queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(screen.queryByText(/needs a connection first/)).not.toBeInTheDocument();
    expect(await db.meals.count()).toBe(before);

    await user.click(within(failed).getByRole('button', { name: 'Open Settings' }));
    expect(router.state.location.pathname).toBe(PATHS.settings);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await db.meals.count()).toBe(before);
  });

  it('can not be dismissed while it restores, and finishes when sync does', async () => {
    await linkedPhone();
    const catchingUp = deferred();
    sync.syncNow.mockImplementationOnce(() => catchingUp.promise);
    const user = userEvent.setup();
    renderBackups();

    const sheet = await openPreview(user);
    await user.click(within(sheet).getByRole('button', { name: 'Restore this backup' }));
    const confirm = await screen.findByRole('alertdialog');
    await user.type(within(confirm).getByRole('textbox'), 'REPLACE');
    await user.click(within(confirm).getByRole('button', { name: 'Replace everything' }));

    const restoring = await screen.findByRole('dialog', { name: 'Restoring your diary' });
    expect(within(restoring).getByText('Catching up with your account first. Keep the app open.')).toBeInTheDocument();
    expect(within(restoring).getByRole('progressbar', { name: 'Restoring your diary' })).not.toHaveAttribute('aria-valuenow');
    // No handle button, no Escape, no scrim.
    expect(within(restoring).queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Restoring your diary' })).toBeInTheDocument();
    const scrim = restoring.parentElement?.parentElement?.firstElementChild;
    expect(scrim).toBeInstanceOf(HTMLElement);
    await user.click(scrim as HTMLElement);
    expect(screen.getByRole('dialog', { name: 'Restoring your diary' })).toBeInTheDocument();

    await act(async () => catchingUp.resolve());
    expect(await screen.findByRole('dialog', { name: 'Backup restored' })).toBeInTheDocument();
  });

  it('keeps the diary as it was when the write fails, and offers Try again', async () => {
    await linkedPhone();
    const user = userEvent.setup();
    renderBackups();

    const before = await rowsOf(db);
    const write = failMealsOnce(new Error('disk trouble'));
    const sheet = await openPreview(user);
    await user.click(within(sheet).getByRole('button', { name: 'Restore this backup' }));
    const confirm = await screen.findByRole('alertdialog');
    await user.type(within(confirm).getByRole('textbox'), 'REPLACE');
    await user.click(within(confirm).getByRole('button', { name: 'Replace everything' }));

    const failed = await screen.findByRole('dialog', { name: "Couldn't restore right now" });
    expect(within(failed).getByText('Nothing was changed. Try again.')).toBeInTheDocument();
    expect(await rowsOf(db)).toEqual(before);
    expect(await db.profile.get('me')).toMatchObject({ demoMode: false });

    write.mockRestore();
    await user.click(within(failed).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('dialog', { name: 'Backup restored' })).toBeInTheDocument();
  });

  it('says there is not enough storage, without Try again', async () => {
    await linkedPhone();
    const user = userEvent.setup();
    renderBackups();

    const full = Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' });
    failMealsOnce(full);
    const sheet = await openPreview(user);
    await user.click(within(sheet).getByRole('button', { name: 'Restore this backup' }));
    const confirm = await screen.findByRole('alertdialog');
    await user.type(within(confirm).getByRole('textbox'), 'REPLACE');
    await user.click(within(confirm).getByRole('button', { name: 'Replace everything' }));

    const failed = await screen.findByRole('dialog', { name: 'Not enough storage' });
    expect(within(failed).getByText("There isn't enough storage left on this device for this backup. Nothing was changed.")).toBeInTheDocument();
    expect(within(failed).queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    await user.click(within(failed).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('BackupsScreen when Restore has to wait', () => {
  const choose_ = () => within(section('Restore')).getByRole('button', { name: 'Choose a backup file' });

  it.each<['uploading' | 'restoring']>([['uploading'], ['restoring']])('is disabled while sync is %s the diary', async (phase) => {
    deployed(SIGNED_IN);
    await linkedPhone();
    sync.current.state = { phase, progress: { done: 10, total: 100 } };
    renderBackups();

    await waitFor(() => expect(choose_()).toBeDisabled());
    expect(within(section('Restore')).getByText('Sync is copying your diary. You can restore a file when it finishes.')).toBeInTheDocument();
  });

  it.each<[string, EngineState, SessionState]>([
    ['needs a sign-in', { phase: 'needsSignIn', error: 'needsSignIn' }, SIGNED_IN],
    ['has two diaries to choose between', { phase: 'choose', choice: { cloud: { dataset: 'd', head: 1, counts: { meals: 3 }, lastChangeAt: null }, localMeals: 2 } }, SIGNED_IN],
  ])('is disabled on a linked device that %s', async (_name, engine, session) => {
    deployed(session);
    await linkedPhone();
    sync.current.state = engine;
    renderBackups();

    await waitFor(() => expect(choose_()).toBeDisabled());
    expect(within(section('Restore')).getByText('Sync needs you first. Open Settings, then come back to restore a file.')).toBeInTheDocument();
  });

  it('is not blocked on a phone that is signed out and never linked', async () => {
    deployed({ status: 'signedOut' });
    await ownDiary();
    renderBackups();

    await waitFor(() => expect(within(section('Your account')).getByRole('status')).toHaveTextContent('Sync is off'));
    expect(choose_()).toBeEnabled();
    expect(within(section('Restore')).queryByText(/Sync/)).not.toBeInTheDocument();
  });

  it('is not blocked while the account is simply offline', async () => {
    deployed(SIGNED_IN);
    await linkedPhone();
    sync.current.state = { phase: 'offline', error: 'offline' };
    renderBackups();

    await waitFor(() => expect(within(section('Your account')).getByRole('status')).toHaveTextContent('Offline'));
    expect(choose_()).toBeEnabled();
  });
});

describe('BackupsScreen a file that can not be restored', () => {
  /** A real backup with one thing wrong with it. */
  const corrupted = (mutate: NonNullable<BackupFileOptions['mutate']>) => backupFileOf(source, { real: true, mutate });

  const cases: { name: string; file: () => Promise<File> | File; title: string; body: string; detail?: string }[] = [
    {
      name: 'not JSON',
      file: () => jsonFile('this is not json'),
      title: "That file isn't a backup",
      body: "It isn't a JSON file. Pick one saved by Export now, named like kira-makan-backup-2026-10-16.json.",
    },
    {
      name: 'not a Kira Makan backup',
      file: () => jsonFile(JSON.stringify({ hello: 'world' })),
      title: "That's not a Kira Makan backup",
      body: "The file is JSON, but this app didn't make it. Pick one saved by Export now.",
    },
    {
      name: 'from a newer version',
      file: () => jsonFile(JSON.stringify({ format: BACKUP_FORMAT, version: 2, tables: {} })),
      title: 'This backup is from a newer version',
      body: 'Close the app and open it again to get the latest version, then choose the file again.',
    },
    {
      name: 'damaged',
      file: () =>
        corrupted((b) => {
          delete b.tables.meals?.[11]?.items;
        }),
      title: 'Part of this file is damaged',
      body: 'Nothing was changed. Try an earlier backup.',
      detail: 'meals row 12 has a bad items',
    },
    {
      name: 'without a profile or goals',
      file: () =>
        corrupted((b) => {
          b.tables.goals = [];
          b.tables.goalVersions = [];
          b.tables.goalPeriods = [];
        }),
      title: 'This backup has no diary in it',
      body: "It has no profile or goals, so there's nothing to restore. Nothing was changed.",
    },
    {
      name: 'the sample week',
      file: () => backupFileOf(source),
      title: 'This backup is the sample week',
      body: "Sample data isn't a diary, so it can't replace yours. Nothing was changed.",
    },
    {
      name: 'unreadable',
      file: () => {
        const file = jsonFile('{}');
        Object.defineProperty(file, 'text', { value: () => Promise.reject(new DOMException('gone', 'NotReadableError')) });
        return file;
      },
      title: "Couldn't read that file",
      body: "If it's in the cloud, download it to this phone first, then choose it again.",
    },
  ];

  it.each(cases)('says $name, and changes nothing', async ({ file, title, body, detail }) => {
    await ownDiary();
    const before = await rowsOf(db);
    const user = userEvent.setup();
    renderBackups();

    await choose(user, await file());

    const sheet = await screen.findByRole('dialog', { name: title });
    expect(within(sheet).getByRole('alert')).toHaveTextContent(body);
    if (detail) expect(within(sheet).getByRole('alert')).toHaveTextContent(detail);
    else expect(within(sheet).getByRole('alert').querySelectorAll('p')).toHaveLength(1);
    expect(await rowsOf(db)).toEqual(before);

    // Close leaves everything as it was. (The sheet's grab handle is called Close too; the button is the last.)
    await user.click(within(sheet).getAllByRole('button', { name: 'Close' }).at(-1) as HTMLElement);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await rowsOf(db)).toEqual(before);
  });

  it('opens another file from the problem, and a good one reaches the preview', async () => {
    await ownDiary();
    const user = userEvent.setup();
    renderBackups();

    await choose(user, jsonFile('nope'));
    const problem = await screen.findByRole('dialog', { name: "That file isn't a backup" });
    await user.upload(within(problem).getByLabelText('Backup file'), await backupFileOf(source, { real: true }));

    expect(await screen.findByRole('dialog', { name: 'Restore this backup?' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: "That file isn't a backup" })).not.toBeInTheDocument();
  });

  it('shows the file while it is read, and a stale read never lands after Cancel', async () => {
    await ownDiary();
    const user = userEvent.setup();
    renderBackups();

    const slow = deferred();
    const file = await backupFileOf(source, { real: true, name: 'slow-backup.json' });
    const read = file.text.bind(file);
    Object.defineProperty(file, 'text', { value: async () => (await slow.promise, read()) });
    await choose(user, file);

    const reading = await screen.findByRole('dialog', { name: 'Reading your backup' });
    expect(within(reading).getByText('slow-backup.json')).toBeInTheDocument();
    expect(within(reading).getByText('Checking the file…')).toBeInTheDocument();
    await user.click(within(reading).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await act(async () => slow.resolve());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('BackupsScreen Export first', () => {
  it('saves the file in place, records it, and keeps the preview', async () => {
    await ownDiary(100);
    const user = userEvent.setup();
    renderBackups();

    const sheet = await openPreview(user);
    await user.click(within(sheet).getByRole('button', { name: 'Export this phone first' }));

    const saved = await within(sheet).findByRole('status');
    expect(saved).toHaveTextContent(/^Saved kira-makan-backup-\d{4}-\d{2}-\d{2}\.json$/);
    expect(downloads.names).toEqual([expect.stringMatching(/^kira-makan-backup-\d{4}-\d{2}-\d{2}\.json$/)]);
    const backup = JSON.parse(await downloads.blobs[0]!.text()) as { format: string };
    expect(backup.format).toBe(BACKUP_FORMAT);
    expect(within(sheet).queryByRole('button', { name: /Export this phone first|Exporting/ })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Restore this backup?' })).toBeInTheDocument();
    expect(readLastBackupAt()).not.toBeNull();

    // Restore still works.
    await user.click(within(sheet).getByRole('button', { name: 'Restore this backup' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Replace everything' }));
    expect(await screen.findByRole('dialog', { name: 'Backup restored' })).toBeInTheDocument();
  });

  it('says so when the file can not be made, and offers it again', async () => {
    await ownDiary();
    const user = userEvent.setup();
    renderBackups();

    const sheet = await openPreview(user);
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: () => {
        throw new Error('no storage');
      },
    });
    await user.click(within(sheet).getByRole('button', { name: 'Export this phone first' }));

    await waitFor(() => expect(useUiStore.getState().toast?.message).toBe("Couldn't export right now. Try again."));
    expect(within(sheet).getByRole('button', { name: 'Export this phone first' })).toBeEnabled();
    expect(within(sheet).queryByRole('status')).not.toBeInTheDocument();
  });

  it('says device on a device that syncs', async () => {
    deployed(SIGNED_IN);
    await linkedPhone();
    sync.current.state = { phase: 'idle' };
    const user = userEvent.setup();
    renderBackups();

    const sheet = await openPreview(user);
    expect(within(sheet).getByRole('button', { name: 'Export this device first' })).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: 'Export this phone first' })).not.toBeInTheDocument();
  });
});

describe('BackupsScreen Restore over the sample week', () => {
  it('replaces it without a confirm, and leaves demo', async () => {
    // The sample week's own export record carries a demo timestamp.
    writeLastExport({ at: DEMO_NOW_ISO, kind: 'json' });
    expect(isDemoClock()).toBe(true);
    const user = userEvent.setup();
    renderBackups();

    const sheet = await openPreview(user);
    expect(within(sheet).getByText('This replaces the sample week with your backup.')).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: /Export this/ })).not.toBeInTheDocument();
    expect(within(sheet).queryByText(/They will be lost|is also in the backup/)).not.toBeInTheDocument();

    await user.click(within(sheet).getByRole('button', { name: 'Restore this backup' }));

    const done = await screen.findByRole('dialog', { name: 'Backup restored' });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(within(done).getByText(/The sample week is gone\.$/)).toBeInTheDocument();
    // The sample week turned location on; the restored diary asks for it again, through the primer.
    expect(await db.profile.get('me')).toMatchObject({ demoMode: false, useLocation: false });
    // The screen's clock follows its live profile, which catches up a moment after the restore.
    await waitFor(() => expect(isDemoClock()).toBe(false));
    expect(readLastExport()).toBeNull();
    expect(sync.syncNow).toHaveBeenCalledTimes(1);
    expect(await rowsOf(db, ['profile'])).toEqual(await rowsOf(source, ['profile']));
  });

  it('does not queue the sample week’s rows for an account that never had them', async () => {
    deployed(SIGNED_IN);
    const user = userEvent.setup();
    renderBackups();

    const sheet = await openPreview(user);
    await user.click(within(sheet).getByRole('button', { name: 'Restore this backup' }));
    await screen.findByRole('dialog', { name: 'Backup restored' });

    expect(await db.syncOutbox.count()).toBe(0);
  });
});

describe('BackupsScreen photos', () => {
  const photo = (id: string) => ({ id, blob: new Blob([id], { type: 'image/jpeg' }), thumb: new Blob([id]), createdAt: '2026-10-16T11:10:00.000Z' });

  /** What Export now writes for a photo: both images as data URLs. (jsdom's Blob can't be read back here, so the file is written by hand.) */
  const embedded = (id: string) => ({ id, createdAt: '2026-10-16T11:10:00.000Z', blob: 'data:image/jpeg;base64,/9j/4AAQ', thumb: 'data:image/webp;base64,UklGRg==' });

  it('says a file with photos replaces the photos here', async () => {
    await ownDiary();
    await db.photos.put(photo('old'));
    const user = userEvent.setup();
    renderBackups();

    const withPhotos = await backupFileOf(source, {
      real: true,
      mutate: (b) => {
        b.photos = 'included';
        b.tables.photos = [embedded('p1'), embedded('p2')];
      },
    });
    await choose(user, withPhotos);
    const sheet = await screen.findByRole('dialog', { name: 'Restore this backup?' });
    expect(within(sheet).getByText('Photos: 2 included. They replace the photos on this phone.')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Restore this backup' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Replace everything' }));
    await screen.findByRole('dialog', { name: 'Backup restored' });

    expect((await db.photos.toArray()).map((p) => p.id).sort()).toEqual(['p1', 'p2']);
  });

  it('says a file without photos keeps the ones meals use, and clears the ones nothing uses', async () => {
    await ownDiary();
    const lunch = await source.meals.get(DEMO_IDS.meals.todayLunch);
    await source.meals.put({ ...(lunch as NonNullable<typeof lunch>), photoId: 'kept' });
    await db.photos.bulkPut([photo('kept'), photo('orphan')]);
    const user = userEvent.setup();
    renderBackups();

    const sheet = await openPreview(user);
    expect(within(sheet).getByText('Photos: not in this file. Photos on this phone stay.')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Restore this backup' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Replace everything' }));
    await screen.findByRole('dialog', { name: 'Backup restored' });

    expect((await db.photos.toArray()).map((p) => p.id)).toEqual(['kept']);
  });
});
