import { act, renderHook, waitFor } from '@testing-library/react';
import type { SessionState } from '@/auth/session';
import { loadDemoData, resetAll } from '@/db/actions';
import { db } from '@/db/db';
import type { OutboxEntry, SyncLink } from '@/db/syncTypes';
import type { EngineState } from './engine';
import { usePendingMealIds, useSyncView } from './hooks';

// The engine and the session are stand-ins: the hooks only read them.
const mocks = vi.hoisted(() => {
  const engineListeners = new Set<() => void>();
  const sessionListeners = new Set<() => void>();
  const state: { engine: EngineState; session: SessionState } = {
    engine: { phase: 'starting' },
    session: { status: 'signedOut' },
  };
  return {
    state,
    engineListeners,
    sessionListeners,
    setEngine(next: EngineState) {
      state.engine = next;
      for (const listener of [...engineListeners]) listener();
    },
    setSession(next: SessionState) {
      state.session = next;
      for (const listener of [...sessionListeners]) listener();
    },
  };
});

vi.mock('@/sync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/sync')>()),
  getEngineState: () => mocks.state.engine,
  subscribeEngine: (listener: () => void) => {
    mocks.engineListeners.add(listener);
    return () => mocks.engineListeners.delete(listener);
  },
}));

// The real useSession would load supabase-js; this one never does.
vi.mock('@/auth/session', async (importOriginal) => {
  const { useSyncExternalStore } = await import('react');
  const subscribe = (listener: () => void) => {
    mocks.sessionListeners.add(listener);
    return () => mocks.sessionListeners.delete(listener);
  };
  const read = () => mocks.state.session;
  return {
    ...(await importOriginal<typeof import('@/auth/session')>()),
    useSession: () => useSyncExternalStore(subscribe, read, read),
  };
});

const NOW = Date.parse('2026-10-16T11:10:00.000Z');

const LINK: SyncLink = {
  userId: 'user-1',
  email: 'you@example.com',
  dataset: 'dataset-1',
  deviceId: 'device-1',
  cursor: 0,
  protocol: 1,
  linkedAt: NOW - 86_400_000,
};

const SIGNED_IN: SessionState = { status: 'signedIn', email: 'you@example.com', userId: 'user-1' };

/** Where supabase-js keeps the session for https://abcdefgh.supabase.co (src/auth/supabase.ts storageKeyFor). */
const STORAGE_KEY = 'kira-makan:sb-abcdefgh-auth';

function entry(table: string, key: string, failedAt?: number): OutboxEntry {
  return { table, key, changedAt: NOW, nonce: `${table}-${key}`, ...(failedAt === undefined ? {} : { failedAt }) };
}

async function link(extra: { lastSyncedAt?: number; paused?: true } = {}) {
  await db.syncMeta.put({ id: 'sync', link: LINK, ...extra });
}

beforeEach(async () => {
  await resetAll();
  mocks.state.engine = { phase: 'starting' };
  mocks.state.session = { status: 'signedOut' };
});

afterEach(async () => {
  await resetAll();
});

describe('useSyncView', () => {
  it('settles signed out before the engine has started', async () => {
    const { result } = renderHook(() => useSyncView());
    await waitFor(() => expect(result.current.phase).toBe('signedOut'));
    expect(result.current).toMatchObject({ pending: 0, failed: 0, linked: false, signedIn: false });
    expect(result.current.sessionEmail).toBeUndefined();
  });

  it('a linked device that is signed out needs a sign-in', async () => {
    await link({ lastSyncedAt: NOW - 60_000 });
    await db.syncOutbox.bulkPut([entry('meals', 'm1'), entry('weights', 'w1')]);
    const { result } = renderHook(() => useSyncView());
    await waitFor(() => expect(result.current.phase).toBe('needsSignIn'));
    expect(result.current).toMatchObject({ pending: 2, linked: true, linkedEmail: 'you@example.com', lastSyncedAt: NOW - 60_000 });
  });

  it("signed out with the session still stored (a refresh that failed offline): the engine's phase, not a sign-in", async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://abcdefgh.supabase.co');
    vi.stubEnv('VITE_SUPABASE_KEY', 'sb_publishable_test_key');
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ access_token: 'access', refresh_token: 'refresh' }));
    mocks.state.engine = { phase: 'offline', error: 'offline', retryAt: NOW + 120_000 };
    await link();
    try {
      const { result } = renderHook(() => useSyncView());
      await waitFor(() => expect(result.current.linked).toBe(true));
      expect(result.current).toMatchObject({ phase: 'offline', error: 'offline', retryAt: NOW + 120_000, signedIn: false });

      // Once the session is gone (the server refused it, or a sign-out), it needs a sign-in.
      window.localStorage.removeItem(STORAGE_KEY);
      act(() => mocks.setSession({ status: 'signedOut' }));
      expect(result.current.phase).toBe('needsSignIn');
      expect(result.current.retryAt).toBeUndefined();
    } finally {
      window.localStorage.removeItem(STORAGE_KEY);
      vi.unstubAllEnvs();
    }
  });

  it("demo mode and sync off here come first, as in the engine's gate", async () => {
    mocks.state.session = SIGNED_IN;
    mocks.state.engine = { phase: 'idle' };
    await link({ paused: true });
    const { result } = renderHook(() => useSyncView());
    await waitFor(() => expect(result.current.phase).toBe('paused'));

    await act(async () => {
      await loadDemoData();
    });
    await waitFor(() => expect(result.current.phase).toBe('demo'));
  });

  it('unconfigured wins over everything', async () => {
    mocks.state.session = { status: 'unconfigured' };
    await link({ paused: true });
    const { result } = renderHook(() => useSyncView());
    expect(result.current.phase).toBe('unconfigured');
    await waitFor(() => expect(result.current.linked).toBe(true));
    expect(result.current.phase).toBe('unconfigured');
  });

  it("otherwise shows the engine's phase with its progress, retry and the queue", async () => {
    mocks.state.session = SIGNED_IN;
    mocks.state.engine = { phase: 'uploading', progress: { done: 200, total: 1840 } };
    await link({ lastSyncedAt: NOW - 5 * 60_000 });
    await db.syncOutbox.bulkPut([entry('meals', 'm1'), entry('meals', 'm2'), entry('places', 'p1', NOW)]);
    const { result } = renderHook(() => useSyncView());
    await waitFor(() => expect(result.current.pending).toBe(2));
    expect(result.current).toMatchObject({
      phase: 'uploading',
      failed: 1,
      linked: true,
      linkedEmail: 'you@example.com',
      signedIn: true,
      sessionEmail: 'you@example.com',
      progress: { done: 200, total: 1840 },
    });
    expect(typeof result.current.now).toBe('number');

    act(() => mocks.setEngine({ phase: 'error', error: 'rejected', retryAt: NOW + 30_000 }));
    expect(result.current).toMatchObject({ phase: 'error', error: 'rejected', retryAt: NOW + 30_000 });
    expect(result.current.progress).toBeUndefined();

    // A phase settled here drops the engine's details: they were for another phase.
    act(() => mocks.setSession({ status: 'signedOut' }));
    expect(result.current.phase).toBe('needsSignIn');
    expect(result.current.retryAt).toBeUndefined();
    expect(result.current.error).toBeUndefined();
    expect(result.current.sessionEmail).toBeUndefined();
    expect(result.current.signedIn).toBe(false);
  });

  it("a refused token keeps the engine's needsSignIn while the session still reads signed in", async () => {
    mocks.state.session = SIGNED_IN;
    mocks.state.engine = { phase: 'needsSignIn', error: 'needsSignIn' };
    await link();
    const { result } = renderHook(() => useSyncView());
    await waitFor(() => expect(result.current.linked).toBe(true));
    expect(result.current).toMatchObject({ phase: 'needsSignIn', error: 'needsSignIn', signedIn: true, sessionEmail: 'you@example.com' });
  });

  it('follows the queue as it changes', async () => {
    mocks.state.session = SIGNED_IN;
    mocks.state.engine = { phase: 'idle' };
    await link();
    const { result } = renderHook(() => useSyncView());
    await waitFor(() => expect(result.current.linked).toBe(true));
    expect(result.current.pending).toBe(0);
    await act(async () => {
      await db.syncOutbox.put(entry('meals', 'm1'));
    });
    await waitFor(() => expect(result.current.pending).toBe(1));
  });

  it('passes the choice through while choosing', async () => {
    mocks.state.session = SIGNED_IN;
    const choice = { cloud: { dataset: 'dataset-2', head: 40, counts: { meals: 30 }, lastChangeAt: null }, localMeals: 12 };
    mocks.state.engine = { phase: 'choose', choice };
    const { result } = renderHook(() => useSyncView());
    await waitFor(() => expect(result.current.phase).toBe('choose'));
    expect(result.current.choice).toBe(choice);
  });
});

describe('usePendingMealIds', () => {
  it('lists queued meals while sync is stuck, and nothing while it works', async () => {
    await link();
    await db.syncOutbox.bulkPut([entry('meals', 'm1'), entry('meals', 'm2', NOW), entry('weights', 'w1')]);
    mocks.state.engine = { phase: 'idle' };
    const { result } = renderHook(() => usePendingMealIds());
    expect(result.current.size).toBe(0);

    act(() => mocks.setEngine({ phase: 'offline' }));
    await waitFor(() => expect([...result.current].sort()).toEqual(['m1', 'm2']));

    act(() => mocks.setEngine({ phase: 'syncing' }));
    await waitFor(() => expect(result.current.size).toBe(0));
  });

  it.each(['offline', 'error', 'needsSignIn', 'notSetUp', 'paused', 'choose', 'otherAccount', 'cloudReset'] as const)(
    'shows them in %s',
    async (phase) => {
      await link();
      await db.syncOutbox.put(entry('meals', 'm1'));
      mocks.state.engine = { phase };
      const { result } = renderHook(() => usePendingMealIds());
      await waitFor(() => expect(result.current.has('m1')).toBe(true));
    },
  );

  it.each(['starting', 'idle', 'syncing', 'uploading', 'restoring', 'demo', 'signedOut', 'unconfigured', 'noProfile'] as const)(
    'shows none in %s',
    async (phase) => {
      await link();
      await db.syncOutbox.put(entry('meals', 'm1'));
      mocks.state.engine = { phase };
      const { result } = renderHook(() => usePendingMealIds());
      // Give the live query time to answer, then check it still has nothing.
      await act(async () => {
        await db.syncMeta.get('sync');
      });
      expect(result.current.size).toBe(0);
    },
  );

  it('shows none before this device is linked', async () => {
    await db.syncOutbox.put(entry('meals', 'm1'));
    mocks.state.engine = { phase: 'offline' };
    const { result } = renderHook(() => usePendingMealIds());
    await act(async () => {
      await db.syncOutbox.count();
    });
    expect(result.current.size).toBe(0);
    await act(async () => {
      await link();
    });
    await waitFor(() => expect(result.current.has('m1')).toBe(true));
  });
});
