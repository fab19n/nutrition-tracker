import { readStoredTheme } from '@/app/theme';
import { ensureSessionStarted, getAuth, isAuthConfigured, readSession, watchSession } from '@/auth/session';
import { hasStoredSession } from '@/auth/supabase';
import { db } from '@/db/db';
import type { SyncEngine, SyncEngineDeps } from './engine';
import * as sync from '.';

// The app's sync module must load without supabase-js, and without building the engine.
const mocks = vi.hoisted(() => {
  const engine: SyncEngine = {
    start: vi.fn(),
    dispose: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    resume: vi.fn(),
    request: vi.fn(),
    syncNow: vi.fn(async () => undefined),
    catchUp: vi.fn(async () => undefined),
    flush: vi.fn(async () => undefined),
    restoreFromAccount: vi.fn(async () => ({ result: 'empty' as const })),
    useAccountData: vi.fn(async () => undefined),
    keepThisDeviceData: vi.fn(async () => undefined),
    notNow: vi.fn(async () => undefined),
    turnSyncBackOn: vi.fn(async () => undefined),
    switchToSignedInAccount: vi.fn(async () => undefined),
    uploadAfterReset: vi.fn(async () => undefined),
    turnOffAfterReset: vi.fn(async () => undefined),
    getState: vi.fn(() => ({ phase: 'idle' as const })),
    subscribe: vi.fn(() => () => undefined),
  };
  return { engine, createSyncEngine: vi.fn((_deps: SyncEngineDeps) => engine), supabaseLoaded: false };
});
vi.mock('./engine', () => ({ createSyncEngine: mocks.createSyncEngine }));
vi.mock('@supabase/supabase-js', () => {
  mocks.supabaseLoaded = true;
  return {};
});

afterEach(async () => {
  await sync.resetSyncForTests();
  vi.clearAllMocks();
  window.localStorage.clear();
});

function depsOf(call = 0): SyncEngineDeps {
  const deps = mocks.createSyncEngine.mock.calls[call]?.[0];
  if (!deps) throw new Error('No engine was built');
  return deps;
}

describe('the app sync engine', () => {
  it('builds nothing and loads no supabase-js until first used', () => {
    expect(mocks.createSyncEngine).not.toHaveBeenCalled();
    expect(mocks.supabaseLoaded).toBe(false);
  });

  it('builds one engine over the app database, the shared session and the stored theme', () => {
    sync.startSync();
    sync.startSync();
    expect(mocks.createSyncEngine).toHaveBeenCalledTimes(1);
    expect(mocks.engine.start).toHaveBeenCalledTimes(2); // start() itself is idempotent

    const deps = depsOf();
    expect(deps.db).toBe(db);
    expect(deps.configured).toBe(isAuthConfigured);
    expect(deps.session).toEqual({
      read: readSession,
      watch: watchSession,
      ensureStarted: ensureSessionStarted,
      getAuth,
      hasStored: hasStoredSession,
    });
    expect(deps.deviceDefaults()).toEqual({ theme: readStoredTheme() });
    window.localStorage.setItem('km-theme', 'dark');
    expect(deps.deviceDefaults()).toEqual({ theme: 'dark' });
    expect(mocks.supabaseLoaded).toBe(false);
  });

  it('passes every call through to the engine', async () => {
    const onProgress = vi.fn();
    const listener = vi.fn();
    await sync.stopSync();
    sync.resumeSync();
    await sync.syncNow();
    await sync.catchUpSync();
    await sync.flushSync(5_000);
    await sync.restoreFromAccount(onProgress);
    await sync.useAccountData();
    await sync.keepThisDeviceData();
    await sync.notNow();
    await sync.turnSyncBackOn();
    await sync.switchToSignedInAccount();
    await sync.uploadAfterReset();
    await sync.turnOffAfterReset();
    const unsubscribe = sync.subscribeEngine(listener);

    const { engine } = mocks;
    expect(engine.stop).toHaveBeenCalledTimes(1);
    expect(engine.resume).toHaveBeenCalledTimes(1);
    expect(engine.syncNow).toHaveBeenCalledTimes(1);
    expect(engine.catchUp).toHaveBeenCalledTimes(1);
    expect(engine.flush).toHaveBeenCalledWith(5_000);
    expect(engine.restoreFromAccount).toHaveBeenCalledWith(onProgress);
    for (const method of [engine.useAccountData, engine.keepThisDeviceData, engine.notNow, engine.turnSyncBackOn,
      engine.switchToSignedInAccount, engine.uploadAfterReset, engine.turnOffAfterReset]) {
      expect(method).toHaveBeenCalledTimes(1);
    }
    expect(engine.subscribe).toHaveBeenCalledWith(listener);
    expect(typeof unsubscribe).toBe('function');
    expect(sync.getEngineState()).toEqual({ phase: 'idle' });
    expect(mocks.createSyncEngine).toHaveBeenCalledTimes(1);
  });

  it('passes every restore result on, an upload still under way included', async () => {
    const restore = vi.mocked(mocks.engine.restoreFromAccount);
    restore.mockResolvedValueOnce({ result: 'uploading' });
    restore.mockResolvedValueOnce({ result: 'restored', meals: 3 });
    expect(await sync.restoreFromAccount()).toEqual({ result: 'uploading' });
    expect(await sync.restoreFromAccount()).toEqual({ result: 'restored', meals: 3 });
    expect(await sync.restoreFromAccount()).toEqual({ result: 'empty' });
  });

  it('resetSyncForTests disposes the engine, and the next call builds a new one', async () => {
    sync.startSync();
    await sync.resetSyncForTests();
    expect(mocks.engine.dispose).toHaveBeenCalledTimes(1);
    sync.startSync();
    expect(mocks.createSyncEngine).toHaveBeenCalledTimes(2);
  });
});
