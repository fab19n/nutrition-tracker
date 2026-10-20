/*
 * Restore on a new device (ARCHITECTURE.md §6.2): Welcome › Restore from your account ›
 * sign in, and Today opens on the account's diary. The real sync engine (src/sync) runs against the fake
 * account (src/sync/testing/fakeServer), seeded with another phone's diary; the session is a
 * stand-in that signs in without loading supabase-js. Nothing reaches the network.
 */
import { screen, within } from '@testing-library/react';
import type { AuthInfo, SessionState } from '@/auth/session';
import { createActions } from '@/db/actions';
import { createDb, db, SYNC_TABLES } from '@/db/db';
import { logicalDayOf } from '@/domain/day';
import type { MealLog } from '@/domain/types';
import { resetSyncForTests } from '@/sync';
import { readMeta } from '@/sync/local';
import type { SyncRemote } from '@/sync/remote';
import { primaryKeyField, toServerRow, type JsonObject } from '@/sync/rows';
import { createFakeServer, type FakeServer } from '@/sync/testing/fakeServer';
import { findDialog, findHero, nav, setupFlows, SLOW, startApp } from './harness';

const account = vi.hoisted(() => ({
  user: 'user-1',
  email: 'fabian@example.com',
  password: 'correct horse battery staple',
}));

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

/** Stands in for src/auth/session.ts: signed out until the right email and password sign in. */
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
    signIn: async (email: string, password: string) => {
      if (email !== account.email || password !== account.password) {
        throw new actual.SignInError('wrongPassword', actual.SIGN_IN_MESSAGES.wrongPassword);
      }
      auth.set({ status: 'signedIn', email, userId: account.user });
    },
    signOut: async () => auth.set({ status: 'signedOut' }),
  };
});

setupFlows({ demo: false });

const TZ = 'Asia/Kuala_Lumpur';
const ROLLOVER = 5;

let server: FakeServer;

beforeEach(() => {
  // The deployed app: Supabase configured, so the app database records changes as it would.
  vi.stubEnv('VITE_SUPABASE_URL', 'https://abcdefgh.supabase.co');
  vi.stubEnv('VITE_SUPABASE_KEY', 'sb_publishable_test_key');
  server = createFakeServer();
  cloud.holder.remote = server.remote();
  auth.set({ status: 'signedOut' });
});

afterEach(async () => {
  await resetSyncForTests();
  cloud.holder.remote = null;
});

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

type SeedRow = { t: string; k: string; data: JsonObject };

/** Another phone's diary in the account: its setup and today's meals, as that phone pushed them. */
async function seedOtherPhone(meals: MealLog[]): Promise<void> {
  seedRows(await otherPhoneRows(meals));
}

function seedRows(rows: SeedRow[]): void {
  for (let i = 0; i < rows.length; i += 200) server.seed(account.user, rows.slice(i, i + 200), 'phone');
}

/** Another phone's setup and today's meals, as rows that phone would push. */
async function otherPhoneRows(meals: MealLog[]): Promise<SeedRow[]> {
  const phone = createDb(`restore-phone-${crypto.randomUUID()}`);
  try {
    await createActions(phone).completeSetup({
      age: 34,
      sex: 'male',
      heightCm: 172,
      weightKg: 78.6,
      activity: 'light',
      paceKgPerWeek: 0.5,
      dailyMinimumKcal: 1400,
      regulars: [],
      places: [{ name: 'Home', type: 'home' }, { name: 'Nasi kandar near home', type: 'mamak' }],
      rolloverHour: ROLLOVER,
      timeZone: TZ,
    });
    await phone.meals.bulkPut(meals);
    const rows: SeedRow[] = [];
    for (const table of SYNC_TABLES) {
      for (const row of await phone.table<Record<string, unknown>, string>(table).toArray()) {
        rows.push({ t: table, k: String(row[primaryKeyField(table)]), data: toServerRow(table, row) });
      }
    }
    return rows;
  } finally {
    await phone.delete();
  }
}

describe('F · restore from your account', () => {
  it('signs in on Welcome and opens Today on the diary from the account', async () => {
    await seedOtherPhone([mealNow('cloud-1', 'Nasi lemak ayam goreng', 700), mealNow('cloud-2', 'Teh tarik', 160)]);
    const { user, router } = startApp('/');

    // A new phone: Welcome, with restore beside Get started.
    expect(await screen.findByRole('heading', { level: 1, name: 'Kira Makan' }, SLOW)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Restore from your account' }));

    const sheet = await findDialog('Restore from your account');
    expect(within(sheet).getByText('Sign in with the account your diary syncs to.')).toBeInTheDocument();
    await user.type(within(sheet).getByLabelText('Email'), account.email);
    await user.type(within(sheet).getByLabelText('Password'), 'not the password');
    await user.click(within(sheet).getByRole('button', { name: 'Sign in' }));
    expect(await within(sheet).findByRole('alert')).toBeInTheDocument();
    expect(server.calls).toEqual([]);

    await user.clear(within(sheet).getByLabelText('Password'));
    await user.type(within(sheet).getByLabelText('Password'), account.password);
    await user.click(within(sheet).getByRole('button', { name: 'Sign in' }));

    // Signed in, it restores without another tap, and Today opens on the restored diary.
    expect(await findHero(/left today\./)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
    expect(nav()).not.toBeNull();
    expect(await screen.findByText('Nasi lemak ayam goreng', {}, SLOW)).toBeInTheDocument();
    expect(screen.getByText('Teh tarik')).toBeInTheDocument();
    expect(await screen.findByText('Restored · 2 meals', {}, SLOW)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();

    // Everything came over, and this phone is linked to the account from here on.
    expect(server.calls.map((call) => call.fn)).toEqual(['sync_hello', 'sync_pull']);
    expect(await db.meals.count()).toBe(2);
    expect(await db.places.count()).toBe(2);
    const profile = await db.profile.get('me');
    expect(profile).toMatchObject({ rolloverHour: ROLLOVER, timeZone: TZ, theme: 'system', useLocation: false });
    expect(profile?.demoMode).toBeFalsy();
    expect((await readMeta(db)).link).toMatchObject({ userId: account.user, dataset: server.dataset(account.user), cursor: server.head(account.user) });
    expect(await db.syncOutbox.count()).toBe(0);
  });

  it('says when the account has no diary yet, and sets up here instead', async () => {
    const { user } = startApp('/');
    await user.click(await screen.findByRole('button', { name: 'Restore from your account' }, SLOW));

    const sheet = await findDialog('Restore from your account');
    await user.type(within(sheet).getByLabelText('Email'), account.email);
    await user.type(within(sheet).getByLabelText('Password'), account.password);
    await user.click(within(sheet).getByRole('button', { name: 'Sign in' }));

    const empty = await findDialog('Nothing to restore yet');
    expect(within(empty).getByText('This account has no diary yet. Set up here and it syncs from then on.')).toBeInTheDocument();
    expect(await db.profile.count()).toBe(0);

    await user.click(within(empty).getByRole('button', { name: 'Get started' }));
    expect(screen.getByRole('heading', { name: 'About you' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it("waits while another device's first upload is part way, then restores on Try again", async () => {
    // The other phone's upload has sent its meals and Places, but not its profile yet.
    const rows = await otherPhoneRows([mealNow('cloud-1', 'Nasi lemak ayam goreng', 700)]);
    seedRows(rows.filter((row) => row.t !== 'profile'));
    const { user } = startApp('/');
    await user.click(await screen.findByRole('button', { name: 'Restore from your account' }, SLOW));

    const sheet = await findDialog('Restore from your account');
    await user.type(within(sheet).getByLabelText('Email'), account.email);
    await user.type(within(sheet).getByLabelText('Password'), account.password);
    await user.click(within(sheet).getByRole('button', { name: 'Sign in' }));

    const uploading = await findDialog('Your diary is still uploading');
    expect(
      within(uploading).getByText('Another device is still sending your diary. Keep it open, then try again in a minute.'),
    ).toBeInTheDocument();
    // Nothing came over: a diary without its profile would open on missing data.
    expect(await db.profile.count()).toBe(0);
    expect(await db.meals.count()).toBe(0);
    expect((await readMeta(db)).link).toBeUndefined();

    // The upload finishes; Try again restores the whole diary.
    seedRows(rows.filter((row) => row.t === 'profile'));
    await user.click(within(uploading).getByRole('button', { name: 'Try again' }));
    expect(await findHero(/left today\./)).toBeInTheDocument();
    expect(await screen.findByText('Nasi lemak ayam goreng', {}, SLOW)).toBeInTheDocument();
    expect(await screen.findByText('Restored · 1 meal', {}, SLOW)).toBeInTheDocument();
    expect(server.calls.map((call) => call.fn)).toEqual(['sync_hello', 'sync_hello', 'sync_pull']);
  });
});
