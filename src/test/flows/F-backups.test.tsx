/*
 * Backups and restore from a file (S39, ARCHITECTURE.md §6.2 Import): the whole app on a fresh
 * database, with the real sync engine (src/sync) talking to the fake account
 * (src/sync/testing/fakeServer). The session is a stand-in that signs in without loading
 * supabase-js. Nothing reaches the network.
 */
import { screen, waitFor, within } from '@testing-library/react';
import type { AuthInfo, SessionState } from '@/auth/session';
import { completeSetup, resetAll } from '@/db/actions';
import { db, SYNC_TABLES } from '@/db/db';
import { readLastBackupAt, writeLastBackupAt } from '@/db/settings';
import { logicalDayOf } from '@/domain/day';
import type { MealLog } from '@/domain/types';
import { resetSyncForTests, syncNow } from '@/sync';
import { readMeta } from '@/sync/local';
import type { SyncRemote } from '@/sync/remote';
import { primaryKeyField, toServerRow } from '@/sync/rows';
import { createFakeServer, type FakeServer } from '@/sync/testing/fakeServer';
import { backupFileOf } from '@/test/backupFiles';
import { findDialog, findHero, setupFlows, SLOW, startApp } from './harness';

const account = vi.hoisted(() => ({ user: 'user-1', email: 'fabian@example.com' }));

/** The account the app talks to: the test's fake server, through one device's remote. */
const cloud = vi.hoisted(() => {
  const holder: { remote: SyncRemote | null } = { remote: null };
  const remote = (): SyncRemote => {
    if (!holder.remote) throw new Error('No account set up for this test');
    return holder.remote;
  };
  return { holder, remote };
});

vi.mock('@/sync/remote', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/sync/remote')>()),
  createSupabaseRemote: (): SyncRemote => ({
    hello: (ctx) => cloud.remote().hello(ctx),
    pull: (ctx, after, limit) => cloud.remote().pull(ctx, after, limit),
    push: (ctx, dataset, deviceId, changes) => cloud.remote().push(ctx, dataset, deviceId, changes),
    keys: (ctx) => cloud.remote().keys(ctx),
  }),
}));

/** Stands in for src/auth/session.ts: signed out until the test signs in. */
const auth = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  let state: SessionState = { status: 'signedOut' };
  return {
    read: (): SessionState => state,
    set(next: SessionState) {
      state = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
});

vi.mock('@/auth/session', async (importOriginal) => {
  const { useSyncExternalStore } = await import('react');
  const actual = await importOriginal<typeof import('@/auth/session')>();
  return {
    ...actual,
    isAuthConfigured: () => true,
    useSession: () => useSyncExternalStore(auth.subscribe, auth.read, auth.read),
    readSession: () => auth.read(),
    watchSession: (listener: (state: SessionState) => void) => auth.subscribe(() => listener(auth.read())),
    ensureSessionStarted: async () => {},
    getAuth: async (): Promise<AuthInfo | null> => {
      const state = auth.read();
      if (state.status !== 'signedIn' || !state.userId) return null;
      return { token: `token-${state.userId}`, userId: state.userId, ...(state.email ? { email: state.email } : {}) };
    },
    getAccessToken: async () => null,
    signOut: async () => auth.set({ status: 'signedOut' }),
  };
});

setupFlows({ demo: false });

const TZ = 'Asia/Kuala_Lumpur';
const ROLLOVER = 5;
const DAY_MS = 86_400_000;

let server: FakeServer;
let downloads: { blobs: Blob[]; names: string[] };

beforeEach(() => {
  // The deployed app: Supabase configured, so the app database records changes as it would.
  vi.stubEnv('VITE_SUPABASE_URL', 'https://abcdefgh.supabase.co');
  vi.stubEnv('VITE_SUPABASE_KEY', 'sb_publishable_test_key');
  server = createFakeServer();
  cloud.holder.remote = server.remote();
  auth.set({ status: 'signedOut' });
  window.localStorage.clear();

  // jsdom has no object URLs and can't follow <a download>: note what would be saved.
  const blobs: Blob[] = [];
  const names: string[] = [];
  downloads = { blobs, names };
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: (blob: Blob) => {
      blobs.push(blob);
      return `blob:test/${blobs.length}`;
    },
  });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => {} });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    names.push(this.download);
  });
});

afterEach(async () => {
  await resetSyncForTests();
  cloud.holder.remote = null;
  window.localStorage.clear();
});

const SETUP = {
  age: 34,
  sex: 'male' as const,
  heightCm: 172,
  weightKg: 78.6,
  activity: 'light' as const,
  paceKgPerWeek: 0.5,
  dailyMinimumKcal: 1400,
  regulars: [],
  places: [
    { name: 'Home', type: 'home' as const },
    { name: 'Nasi kandar near home', type: 'mamak' as const },
  ],
  rolloverHour: ROLLOVER,
  timeZone: TZ,
};

/** A meal eaten just now, so it's on today's page. */
function mealNow(id: string, name: string, kcal: number): MealLog {
  const at = new Date();
  const stamp = at.toISOString();
  return {
    id,
    eatenAt: stamp,
    logicalDay: logicalDayOf(at, TZ, ROLLOVER),
    slot: 'lunch',
    name,
    items: [
      {
        id: `${id}-item`,
        name,
        unitMacros: { kcal, proteinG: 20, carbsG: 60, fatG: 20 },
        quantity: 1,
        uncertainty: 0.15,
        source: 'catalogue',
      },
    ],
    method: 'manual',
    finished: 'all',
    createdAt: stamp,
    updatedAt: stamp,
    syncState: 'synced',
  };
}

function signIn(): void {
  auth.set({ status: 'signedIn', email: account.email, userId: account.user });
}

/** The account's live meals, by id. */
function cloudMealIds(): string[] {
  return Object.keys(server.live(account.user).meals ?? {}).sort();
}

describe('F · backups and restore from a file', () => {
  it('an account restore makes the account follow the file', async () => {
    // A real phone with 3 meals signs in and links; the empty account takes its upload.
    await completeSetup(SETUP);
    await db.meals.bulkPut([mealNow('m1', 'Nasi lemak', 700), mealNow('m2', 'Teh tarik', 160), mealNow('m3', 'Roti canai', 300)]);
    signIn();
    await syncNow();
    expect(cloudMealIds()).toEqual(['m1', 'm2', 'm3']);
    const linked = (await readMeta(db)).link;
    expect(linked).toMatchObject({ userId: account.user });

    // The backup S0 is this moment: three meals.
    const s0 = await backupFileOf(db, { name: 'kira-makan-backup-S0.json' });
    const s0Meals = ['m1', 'm2', 'm3'];

    // Then two more meals go in and sync, and the phone takes a dark theme.
    await db.meals.bulkPut([mealNow('m4', 'Mee goreng', 650), mealNow('m5', 'Kopi o', 20)]);
    await db.profile.update('me', { theme: 'dark' });
    await syncNow();
    expect(cloudMealIds()).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);

    // Another device adds a meal this phone hasn't pulled yet.
    server.seed(account.user, [{ t: 'meals', k: 'laptop-meal', data: toServerRow('meals', mealNow('laptop-meal', 'Laksa', 500)) }], 'laptop');
    expect(cloudMealIds()).toContain('laptop-meal');
    expect(await db.meals.get('laptop-meal')).toBeUndefined();

    const { user } = startApp('/more/backups');
    expect(await screen.findByRole('heading', { level: 1, name: 'Backups' }, SLOW)).toBeInTheDocument();
    await user.upload(await screen.findByLabelText('Backup file', {}, SLOW), s0);

    // The preview says what this device would lose: the two later meals (not the laptop's, not pulled yet).
    const preview = await findDialog('Restore this backup?');
    expect(
      within(preview).getByText('Everything on this device, in your account and on your other devices is replaced by this backup.'),
    ).toBeInTheDocument();
    expect(within(preview).getByText('On this device but not in the backup: 2 meals. They will be lost.')).toBeInTheDocument();
    await user.click(within(preview).getByRole('button', { name: 'Restore this backup' }));

    const confirm = await screen.findByRole('alertdialog', { name: 'Replace your diary everywhere?' }, SLOW);
    await user.type(within(confirm).getByRole('textbox'), 'REPLACE');
    await user.click(within(confirm).getByRole('button', { name: 'Replace everything' }));

    const done = await findDialog('Backup restored');
    expect(within(done).getByText('Your account and your other devices follow as this device syncs.')).toBeInTheDocument();

    // The phone is the file's diary, in its own theme.
    expect((await db.meals.toArray()).map((m) => m.id).sort()).toEqual(s0Meals);
    expect(await db.profile.get('me')).toMatchObject({ theme: 'dark', demoMode: false });

    // The account follows. The laptop's meal can only be tombstoned if the phone pulled it first: the
    // restore deletes the rows this device holds, so the catch-up ran before it.
    await waitFor(() => expect(cloudMealIds()).toEqual(s0Meals), SLOW);
    for (const id of ['m4', 'm5', 'laptop-meal']) {
      expect(server.rows(account.user).find((row) => row.tbl === 'meals' && row.key === id)).toMatchObject({ deleted: true });
    }

    // The link is as it was, and nothing waits to be sent.
    await waitFor(async () => expect(await db.syncOutbox.count()).toBe(0), SLOW);
    expect((await readMeta(db)).link).toMatchObject({ userId: linked?.userId, dataset: linked?.dataset, deviceId: linked?.deviceId });
    // Every table agrees with the file.
    const live = server.live(account.user);
    for (const table of SYNC_TABLES) {
      const rows = await db.table<Record<string, unknown>, string>(table).toArray();
      expect(Object.keys(live[table] ?? {}).sort()).toEqual(rows.map((row) => String(row[primaryKeyField(table)])).sort());
    }
  });

  it('restores a fresh phone from a file, and signing in afterwards uploads it', async () => {
    // Another phone's diary, exported (the file); this phone is new.
    await completeSetup(SETUP);
    await db.meals.bulkPut([mealNow('f1', 'Nasi lemak ayam goreng', 700), mealNow('f2', 'Teh tarik', 160)]);
    const file = await backupFileOf(db, { name: 'kira-makan-backup-from-laptop.json' });
    const fileMeals = ['f1', 'f2'];
    const fileRows: Record<string, Record<string, unknown>[]> = {};
    for (const table of SYNC_TABLES) fileRows[table] = await db.table<Record<string, unknown>, string>(table).toArray();
    await resetAll();

    const { user, router } = startApp('/');
    expect(await screen.findByRole('heading', { level: 1, name: 'Kira Makan' }, SLOW)).toBeInTheDocument();
    await user.upload(await screen.findByLabelText('Backup file', {}, SLOW), file);

    const sheet = await findDialog('Restore this backup');
    expect(within(sheet).getByText('This sets up your diary from the backup.')).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Restore this backup' }));

    // Today opens on the file's diary.
    expect(await findHero(/left today\./)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
    expect(await screen.findByText('Nasi lemak ayam goreng', {}, SLOW)).toBeInTheDocument();
    expect(await screen.findByText('Restored · 2 meals', {}, SLOW)).toBeInTheDocument();
    expect((await db.meals.toArray()).map((m) => m.id).sort()).toEqual(fileMeals);
    expect(await db.profile.get('me')).toMatchObject({ theme: 'system', useLocation: false, demoMode: false });
    // Not signed in yet: nothing has reached the account.
    expect(server.calls).toEqual([]);

    // Signing in afterwards: the account is empty, so every row of the file uploads and the phone links.
    signIn();
    await syncNow();
    expect((await readMeta(db)).link).toMatchObject({ userId: account.user });
    const live = server.live(account.user);
    for (const table of SYNC_TABLES) {
      const keys = (fileRows[table] ?? []).map((row) => String(row[primaryKeyField(table)])).sort();
      expect(Object.keys(live[table] ?? {}).sort()).toEqual(keys);
    }
    expect(Object.keys(live.meals ?? {}).sort()).toEqual(fileMeals);
    expect(await db.syncOutbox.count()).toBe(0);
  });

  it('nudges in Settings after a month, and Export now makes it go quiet', async () => {
    await completeSetup(SETUP);
    await db.meals.put(mealNow('m1', 'Nasi lemak', 700));
    writeLastBackupAt(new Date(Date.now() - 45 * DAY_MS).toISOString());

    const { user } = startApp('/more/settings');
    const row = await screen.findByRole('button', { name: /^Backups/ }, SLOW);
    await waitFor(() => expect(row).toHaveTextContent('Last export 45 days ago. Time for a new one.'), SLOW);

    await user.click(row);
    expect(await screen.findByRole('heading', { level: 1, name: 'Backups' }, SLOW)).toBeInTheDocument();
    const card = (await screen.findByRole('heading', { level: 2, name: 'Backup file' })).closest('section') as HTMLElement;
    await waitFor(() => expect(within(card).getByRole('status')).toHaveTextContent('Last export 45 days ago'), SLOW);
    expect(within(card).getByText('Due')).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Export now' }));
    await waitFor(() => expect(within(card).getByRole('status')).toHaveTextContent('Last export today'), SLOW);
    expect(downloads.names).toHaveLength(1);
    expect(downloads.names[0]).toMatch(/^kira-makan-backup-\d{4}-\d{2}-\d{2}\.json$/);
    const saved = JSON.parse(await downloads.blobs[0]!.text()) as { tables: { meals: unknown[] } };
    expect(saved.tables.meals).toHaveLength(1);
    expect(readLastBackupAt()).not.toBeNull();

    // Back in Settings the line is the plain one again.
    await user.click(screen.getByRole('button', { name: 'Back' }));
    const quiet = await screen.findByRole('button', { name: /^Backups/ }, SLOW);
    expect(quiet).toHaveTextContent('Sync, export and restore');
    expect(quiet).not.toHaveTextContent('Time for a new one');
  });
});
