import { act, renderHook, waitFor } from '@testing-library/react';
import { resetAll } from '@/db/actions';
import { db } from '@/db/db';
import { useMealThumbUrl } from '@/db/diary';
import { SYNC_THUMB_PREFIX } from '@/domain/photoSync';
import type { MealLog } from '@/domain/types';
import type { DriveEngineState, FetchPhotoResult } from './engine';
import { useDriveView, useMealPhoto } from './hooks';

// The engine is a stand-in: the hooks only read it and call its wrappers.
const mocks = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const base = {
    configured: true,
    profile: 'real' as const,
    keepPhotos: true,
    connected: true,
    email: 'you@example.com',
    gisReady: true,
    authBusy: false,
    running: false,
    online: true,
    counts: { uploads: 0, files: 0, failed: 0 },
  };
  const current: { state: DriveEngineState } = { state: base };
  return {
    base,
    current,
    listeners,
    set(patch: Partial<DriveEngineState>) {
      current.state = { ...current.state, ...patch };
      for (const listener of [...listeners]) listener();
    },
    fetchMealPhoto: vi.fn<(mealId: string) => Promise<FetchPhotoResult>>(async () => ({ ok: true })),
    continueDrive: vi.fn(async () => ({ ok: true as const })),
    prepareDrive: vi.fn(),
  };
});

vi.mock('@/drive', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/drive')>()),
  getDriveState: () => mocks.current.state,
  subscribeDrive: (listener: () => void) => {
    mocks.listeners.add(listener);
    return () => mocks.listeners.delete(listener);
  },
  fetchMealPhoto: (mealId: string) => mocks.fetchMealPhoto(mealId),
  continueDrive: () => mocks.continueDrive(),
  prepareDrive: () => mocks.prepareDrive(),
}));

const FILE = 'drive-file-0001';
const THUMB = `${SYNC_THUMB_PREFIX}/9j/4AAQ`;
const NOW = Date.now();

function meal(id: string, extra: Partial<MealLog> = {}): MealLog {
  return {
    id,
    eatenAt: '2026-10-16T12:30:00.000Z',
    logicalDay: '2026-10-16',
    slot: 'dinner',
    name: 'Nasi kandar',
    items: [],
    method: 'photo',
    finished: 'all',
    createdAt: '2026-10-16T12:31:00.000Z',
    updatedAt: '2026-10-16T12:31:00.000Z',
    syncState: 'local',
    ...extra,
  };
}

async function storePhoto(id: string) {
  await db.photos.put({ id, blob: new Blob(['full']), thumb: new Blob(['thumb']), createdAt: '2026-10-16T12:31:00.000Z' });
}

let created: number;

beforeEach(async () => {
  mocks.current.state = { ...mocks.base, tokenExpiresAt: NOW + 30 * 60_000 };
  mocks.fetchMealPhoto.mockReset().mockResolvedValue({ ok: true });
  mocks.continueDrive.mockReset().mockResolvedValue({ ok: true });
  mocks.prepareDrive.mockClear();
  created = 0;
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => {
      created += 1;
      return `blob:test/${created}`;
    }),
  });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  await resetAll();
});

afterEach(async () => {
  vi.useRealTimers();
  Reflect.deleteProperty(URL, 'createObjectURL');
  Reflect.deleteProperty(URL, 'revokeObjectURL');
  await resetAll();
});

describe('useDriveView', () => {
  it('follows the engine', async () => {
    const { result } = renderHook(() => useDriveView());
    expect(result.current).toMatchObject({ phase: 'idle', connected: true, email: 'you@example.com' });
    act(() => mocks.set({ connected: false }));
    expect(result.current.phase).toBe('disconnected');
    act(() => mocks.set({ connected: true, running: true }));
    expect(result.current.phase).toBe('working');
  });

  it('reads the clock again each minute, so a token runs out on the card', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(NOW);
    mocks.current.state = { ...mocks.base, tokenExpiresAt: NOW + 2 * 60_000, counts: { uploads: 1, files: 0, failed: 0 } };
    const { result } = renderHook(() => useDriveView());
    expect(result.current.phase).toBe('idle');
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current.now).toBe(NOW + 60_000);
    expect(result.current.phase).toBe('needsTap');
  });
});

describe('useMealPhoto', () => {
  it('local: this device has the photo', async () => {
    await storePhoto('p1');
    const { result } = renderHook(() => useMealPhoto(meal('m1', { photoId: 'p1', photoDrive: { fileId: FILE, thumb: THUMB } })));
    await waitFor(() => expect(result.current.view).toEqual({ kind: 'local', waitingForTap: false }));
    await waitFor(() => expect(result.current.thumbUrl).toMatch(/^blob:test\//));
    expect(result.current.fullUrl).toMatch(/^blob:test\//);
    expect(await result.current.showFull()).toBe(true);
    expect(mocks.fetchMealPhoto).not.toHaveBeenCalled();
    expect(mocks.prepareDrive).not.toHaveBeenCalled();
  });

  it('local waiting for a tap: queued, and no token; Continue runs from the tap', async () => {
    await storePhoto('p1');
    await db.driveJobs.put({ id: 'upload:p1', kind: 'upload', photoId: 'p1', mealId: 'm1', createdAt: 1, notBefore: 1, attempts: 0 });
    mocks.current.state = { ...mocks.current.state, tokenExpiresAt: undefined };
    mocks.continueDrive.mockResolvedValueOnce({ ok: false, problem: 'popupBlocked' } as never);
    const { result } = renderHook(() => useMealPhoto(meal('m1', { photoId: 'p1' })));
    await waitFor(() => expect(result.current.view).toEqual({ kind: 'local', waitingForTap: true }));
    await waitFor(() => expect(mocks.prepareDrive).toHaveBeenCalled());

    act(() => result.current.continueUpload());
    expect(mocks.continueDrive).toHaveBeenCalledTimes(1);
    expect(result.current.busy).toBe(true);
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(result.current.problem).toBe("The Google window didn't open. Try again.");
  });

  it('local with a set-aside upload: no Continue, since a tap would not upload it', async () => {
    await storePhoto('p1');
    await db.driveJobs.put({
      id: 'upload:p1',
      kind: 'upload',
      photoId: 'p1',
      mealId: 'm1',
      createdAt: 1,
      notBefore: 1,
      attempts: 0,
      failedAt: 2,
      lastProblem: 'refused',
    });
    mocks.current.state = { ...mocks.current.state, tokenExpiresAt: undefined, counts: { uploads: 0, files: 0, failed: 1 } };
    const { result } = renderHook(() => useMealPhoto(meal('m1', { photoId: 'p1' })));
    await waitFor(() => expect(result.current.thumbUrl).toMatch(/^blob:test\//));
    // Let the jobs query answer too, then the photo is still just this device's.
    await act(async () => {
      await db.driveJobs.get('upload:p1');
    });
    expect(result.current.view).toEqual({ kind: 'local', waitingForTap: false });
    expect(mocks.prepareDrive).not.toHaveBeenCalled();
  });

  it('remote: shows the synced thumb, prepares Google, and fetches from the tap', async () => {
    const { result } = renderHook(() => useMealPhoto(meal('m1', { photoId: 'p1', photoDrive: { fileId: FILE, thumb: THUMB } })));
    await waitFor(() => expect(result.current.view).toEqual({ kind: 'remote', action: 'show' }));
    expect(result.current.thumbUrl).toBe(THUMB);
    expect(result.current.fullUrl).toBeUndefined();
    await waitFor(() => expect(mocks.prepareDrive).toHaveBeenCalled());

    let shown: Promise<boolean> = Promise.resolve(false);
    act(() => {
      shown = result.current.showFull();
    });
    expect(mocks.fetchMealPhoto).toHaveBeenCalledWith('m1');
    expect(result.current.busy).toBe(true);
    await act(async () => {
      expect(await shown).toBe(true);
    });
    expect(result.current.busy).toBe(false);
    expect(result.current.problem).toBeUndefined();
  });

  it('remote: a failed fetch says why', async () => {
    mocks.fetchMealPhoto.mockResolvedValueOnce({ ok: false, problem: 'notFound' });
    const { result } = renderHook(() => useMealPhoto(meal('m1', { photoId: 'p1', photoDrive: { fileId: FILE, thumb: THUMB } })));
    await waitFor(() => expect(result.current.view.kind).toBe('remote'));
    let shown: Promise<boolean> = Promise.resolve(true);
    act(() => {
      shown = result.current.showFull();
    });
    await act(async () => {
      expect(await shown).toBe(false);
    });
    expect(result.current.problem).toBe(
      "Couldn't find this photo in your Google Drive. It may have been deleted there, or uploaded with another Google account.",
    );
  });

  it('remote: connect when this device is not connected, offline when offline, none without Drive', async () => {
    const remote = meal('m1', { photoId: 'p1', photoDrive: { fileId: FILE } });
    mocks.current.state = { ...mocks.current.state, connected: false };
    const { result, rerender } = renderHook(() => useMealPhoto(remote));
    await waitFor(() => expect(result.current.view).toEqual({ kind: 'remote', action: 'connect' }));
    expect(result.current.thumbUrl).toBeUndefined();

    act(() => mocks.set({ connected: true }));
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    rerender();
    expect(result.current.view).toEqual({ kind: 'remote', action: 'offline' });
    onLine.mockRestore();

    act(() => mocks.set({ configured: false }));
    expect(result.current.view).toEqual({ kind: 'remote', action: 'none' });
    act(() => mocks.set({ configured: true, profile: 'demo' }));
    expect(result.current.view).toEqual({ kind: 'remote', action: 'none' });
  });

  it('elsewhere: a photo that is on the other device only', async () => {
    const { result } = renderHook(() => useMealPhoto(meal('m1', { photoId: 'p1' })));
    await waitFor(() => expect(result.current.view).toEqual({ kind: 'elsewhere', driveConfigured: true }));
    act(() => mocks.set({ configured: false }));
    expect(result.current.view).toEqual({ kind: 'elsewhere', driveConfigured: false });
    expect(result.current.thumbUrl).toBeUndefined();
  });
});

describe('useMealThumbUrl', () => {
  it('prefers the photo on this device over the synced thumb', async () => {
    await storePhoto('p1');
    const { result } = renderHook(() => useMealThumbUrl({ photoId: 'p1', photoDrive: { fileId: FILE, thumb: THUMB } }));
    await waitFor(() => expect(result.current).toMatch(/^blob:test\//));
  });

  it('shows the synced thumb when the photo is not here', async () => {
    const { result } = renderHook(() => useMealThumbUrl({ photoId: 'p1', photoDrive: { fileId: FILE, thumb: THUMB } }));
    await waitFor(() => expect(result.current).toBe(THUMB));
  });

  it('reads the pointer from the meal for Search', async () => {
    await db.meals.put(meal('m1', { photoId: 'p1', photoDrive: { fileId: FILE, thumb: THUMB } }));
    const { result } = renderHook(() => useMealThumbUrl({ photoId: 'p1', mealId: 'm1' }));
    await waitFor(() => expect(result.current).toBe(THUMB));
  });

  it('ignores a thumb that is not a JPEG data URL, and a meal without a photo', async () => {
    const { result } = renderHook(() => useMealThumbUrl({ photoId: 'p1', photoDrive: { fileId: FILE, thumb: 'javascript:alert(1)' } }));
    const none = renderHook(() => useMealThumbUrl({ photoDrive: { fileId: FILE, thumb: THUMB } }));
    await act(async () => {
      await db.meals.count();
    });
    expect(result.current).toBeUndefined();
    expect(none.result.current).toBeUndefined();
  });
});
