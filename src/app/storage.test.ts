import { renderHook, waitFor } from '@testing-library/react';
import type { Mock } from 'vitest';
import { loadDemoData, resetAll } from '@/db/actions';
import { useBootstrap } from './bootstrap';
import { persistStorage, requestPersistentStorage, storageStatus, type StorageLike } from './storage';

interface FakeStorage {
  persist: Mock<() => Promise<boolean>>;
  persisted: Mock<() => Promise<boolean>>;
  estimate: Mock<() => Promise<StorageEstimate>>;
}

/** A navigator.storage stand-in; `granted` is what persist() answers. */
function fakeStorage(opts: { persisted?: boolean; granted?: boolean } = {}): FakeStorage {
  let persisted = opts.persisted ?? false;
  return {
    persisted: vi.fn(async () => persisted),
    persist: vi.fn(async () => {
      if (opts.granted ?? true) persisted = true;
      return persisted;
    }),
    estimate: vi.fn(async () => ({ usage: 1_234_567, quota: 50_000_000_000 })),
  };
}

function setNavigatorStorage(value: unknown): void {
  Object.defineProperty(navigator, 'storage', { configurable: true, value });
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'storage');
});

describe('persistStorage', () => {
  it('is unsupported without a Storage API', async () => {
    expect(await persistStorage(undefined)).toBe('unsupported');
    expect(await persistStorage({})).toBe('unsupported');
    expect(await persistStorage({ persisted: async () => false })).toBe('unsupported');
  });

  it('does not ask again when storage is already persistent', async () => {
    const storage = fakeStorage({ persisted: true });
    expect(await persistStorage(storage)).toBe('persisted');
    expect(storage.persist).not.toHaveBeenCalled();
  });

  it('asks and reports the answer', async () => {
    expect(await persistStorage(fakeStorage({ granted: true }))).toBe('granted');
    expect(await persistStorage(fakeStorage({ granted: false }))).toBe('notGranted');
  });

  it('asks when persisted() is missing or fails', async () => {
    const persist = vi.fn(async () => true);
    expect(await persistStorage({ persist })).toBe('granted');
    expect(await persistStorage({ persist, persisted: () => Promise.reject(new Error('blocked')) })).toBe('granted');
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it('never throws when persist() rejects or throws', async () => {
    expect(await persistStorage({ persist: () => Promise.reject(new TypeError('opaque origin')) })).toBe('notGranted');
    const throwing: StorageLike = {
      persist: () => {
        throw new TypeError('storage disabled');
      },
    };
    expect(await persistStorage(throwing)).toBe('notGranted');
  });

  it('reads navigator.storage by default', async () => {
    const storage = fakeStorage();
    setNavigatorStorage(storage);
    expect(await persistStorage()).toBe('granted');
    expect(storage.persist).toHaveBeenCalledTimes(1);
  });
});

describe('requestPersistentStorage', () => {
  it('is unsupported when navigator.storage is missing', async () => {
    setNavigatorStorage(undefined);
    expect(await requestPersistentStorage()).toBe('unsupported');
  });

  it('never throws when reading navigator.storage throws', async () => {
    Object.defineProperty(navigator, 'storage', {
      configurable: true,
      get() {
        throw new Error('SecurityError');
      },
    });
    expect(await requestPersistentStorage()).toBe('unsupported');
  });

  it('asks the browser once per launch, however often it is called', async () => {
    const storage = fakeStorage({ granted: false });
    setNavigatorStorage(storage);
    const answers = await Promise.all([requestPersistentStorage(), requestPersistentStorage()]);
    expect(answers).toEqual(['notGranted', 'notGranted']);
    expect(await requestPersistentStorage()).toBe('notGranted');
    expect(storage.persist).toHaveBeenCalledTimes(1);
  });
});

describe('storageStatus', () => {
  it('reports persistence and usage', async () => {
    expect(await storageStatus(fakeStorage({ persisted: true }))).toEqual({
      supported: true,
      persisted: true,
      usageBytes: 1_234_567,
      quotaBytes: 50_000_000_000,
    });
  });

  it('reads navigator.storage by default', async () => {
    setNavigatorStorage(fakeStorage());
    expect(await storageStatus()).toMatchObject({ supported: true, persisted: false });
  });

  it('reports unknowns as null without a Storage API', async () => {
    const empty = { supported: false, persisted: null, usageBytes: null, quotaBytes: null };
    expect(await storageStatus(undefined)).toEqual(empty);
    setNavigatorStorage(undefined);
    expect(await storageStatus()).toEqual(empty);
  });

  it('never throws when the browser calls fail or answer oddly', async () => {
    const failing: StorageLike = {
      persist: async () => true,
      persisted: () => Promise.reject(new Error('blocked')),
      estimate: () => Promise.reject(new Error('blocked')),
    };
    expect(await storageStatus(failing)).toEqual({ supported: true, persisted: null, usageBytes: null, quotaBytes: null });

    const odd = {
      persisted: async () => 'yes',
      estimate: async () => ({ usage: Number.NaN, quota: -1 }),
    } as unknown as StorageLike;
    expect(await storageStatus(odd)).toEqual({ supported: false, persisted: null, usageBytes: null, quotaBytes: null });
  });
});

describe('useBootstrap', () => {
  afterEach(async () => {
    await resetAll();
  });

  it('asks for persistent storage only once a profile exists', async () => {
    await resetAll();
    const storage = fakeStorage();
    setNavigatorStorage(storage);

    const { result, unmount } = renderHook(() => useBootstrap());
    await waitFor(() => expect(result.current).toBe(true));
    expect(storage.persist).not.toHaveBeenCalled();

    await loadDemoData(); // the same moment as finishing setup: the profile appears
    await waitFor(() => expect(storage.persist).toHaveBeenCalledTimes(1));
    unmount();
  });

  it('asks on start-up when the profile is already there', async () => {
    await resetAll();
    await loadDemoData();
    const storage = fakeStorage({ persisted: true });
    setNavigatorStorage(storage);

    const { unmount } = renderHook(() => useBootstrap());
    await waitFor(() => expect(storage.persisted).toHaveBeenCalled());
    expect(storage.persist).not.toHaveBeenCalled();
    unmount();
  });
});
