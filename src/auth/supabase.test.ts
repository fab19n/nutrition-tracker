import { createClient } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearStoredSession,
  getSupabase,
  hasStoredSession,
  readSupabaseConfig,
  resetSupabaseForTests,
  sessionStorageAdapter,
  storageKeyFor,
} from './supabase';

vi.mock('@supabase/supabase-js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@supabase/supabase-js')>()),
  createClient: vi.fn(() => ({ auth: {} })),
}));

const SUPABASE_URL = 'https://abcdefgh.supabase.co';
const KEY = 'sb_publishable_test_key';
const STORAGE_KEY = 'kira-makan:sb-abcdefgh-auth';

function configure(url = SUPABASE_URL, key = KEY): void {
  vi.stubEnv('VITE_SUPABASE_URL', url);
  vi.stubEnv('VITE_SUPABASE_KEY', key);
}

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', '');
  vi.stubEnv('VITE_SUPABASE_KEY', '');
  resetSupabaseForTests();
  vi.mocked(createClient).mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  window.localStorage.clear();
  resetSupabaseForTests();
});

describe('readSupabaseConfig', () => {
  it('needs both the URL and the key', () => {
    expect(readSupabaseConfig()).toBeNull();
    vi.stubEnv('VITE_SUPABASE_URL', SUPABASE_URL);
    expect(readSupabaseConfig()).toBeNull();
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_KEY', KEY);
    expect(readSupabaseConfig()).toBeNull();
  });

  it('trims the values and drops a trailing slash', () => {
    configure(` ${SUPABASE_URL}/ `, ` ${KEY} `);
    expect(readSupabaseConfig()).toEqual({ url: SUPABASE_URL, key: KEY });
  });

  it('ignores a URL that is not http(s)', () => {
    configure('not a url');
    expect(readSupabaseConfig()).toBeNull();
    configure('ftp://abcdefgh.supabase.co');
    expect(readSupabaseConfig()).toBeNull();
  });
});

describe('storageKeyFor', () => {
  it('uses the project ref for a hosted project', () => {
    expect(storageKeyFor(SUPABASE_URL)).toBe(STORAGE_KEY);
  });

  it('uses the host and port for a local project', () => {
    expect(storageKeyFor('http://127.0.0.1:54321')).toBe('kira-makan:sb-127-0-0-1-54321-auth');
  });
});

describe('getSupabase', () => {
  it('has no client when Supabase is not configured', async () => {
    expect(await getSupabase()).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });

  it('creates one client with a persisted, code-only session', async () => {
    configure();
    const first = await getSupabase();
    const second = await getSupabase();

    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(createClient).toHaveBeenCalledWith(SUPABASE_URL, KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storage: sessionStorageAdapter,
        storageKey: STORAGE_KEY,
      },
    });
  });

  it('tries again after the client fails to load', async () => {
    configure();
    vi.mocked(createClient).mockImplementationOnce(() => {
      throw new Error('chunk failed to load');
    });

    await expect(getSupabase()).rejects.toThrow('chunk failed to load');
    expect(await getSupabase()).not.toBeNull();
    expect(createClient).toHaveBeenCalledTimes(2);
  });
});

describe('sessionStorageAdapter', () => {
  it('keeps the session in localStorage', () => {
    sessionStorageAdapter.setItem(STORAGE_KEY, '{"access_token":"t"}');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('{"access_token":"t"}');
    expect(sessionStorageAdapter.getItem(STORAGE_KEY)).toBe('{"access_token":"t"}');
    sessionStorageAdapter.removeItem(STORAGE_KEY);
    expect(sessionStorageAdapter.getItem(STORAGE_KEY)).toBeNull();
  });

  it('falls back to memory when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });

    sessionStorageAdapter.setItem(STORAGE_KEY, 'kept in memory');
    expect(sessionStorageAdapter.getItem(STORAGE_KEY)).toBe('kept in memory');
    sessionStorageAdapter.removeItem(STORAGE_KEY);
    expect(sessionStorageAdapter.getItem(STORAGE_KEY)).toBeNull();
  });
});

describe('hasStoredSession', () => {
  it("tells whether this project's session is stored", () => {
    window.localStorage.setItem(STORAGE_KEY, 'session');
    expect(hasStoredSession()).toBe(false);
    configure();
    expect(hasStoredSession()).toBe(true);
    window.localStorage.removeItem(STORAGE_KEY);
    expect(hasStoredSession()).toBe(false);
  });
});

describe('clearStoredSession', () => {
  it("removes this project's stored session only", () => {
    configure();
    window.localStorage.setItem(STORAGE_KEY, 'session');
    window.localStorage.setItem(`${STORAGE_KEY}-user`, 'user');
    window.localStorage.setItem('kira-makan:last-export', 'kept');

    clearStoredSession();

    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(`${STORAGE_KEY}-user`)).toBeNull();
    expect(window.localStorage.getItem('kira-makan:last-export')).toBe('kept');
    expect(hasStoredSession()).toBe(false);
  });
});
