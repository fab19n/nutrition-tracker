import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { loadDemoData, resetAll } from '@/db/actions';
import { db } from '@/db/db';
import { DEMO_IDS } from '@/db/seed/demo';
import type { AuthResult, DriveEngineState, FetchPhotoResult } from '@/drive';
import { resetUiState, useUiStore } from '@/state/ui';
import EntryScreen from './EntryScreen';

/** Stands in for the Drive engine (src/drive/index.ts): Entry's photo block reads it and calls it from taps. */
const drive = vi.hoisted(() => {
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
    fetchMealPhoto: vi.fn<(mealId: string) => Promise<FetchPhotoResult>>(async () => ({ ok: true })),
    continueDrive: vi.fn<() => Promise<AuthResult>>(async () => ({ ok: true })),
    prepareDrive: vi.fn(),
  };
});

vi.mock('@/drive', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/drive')>()),
  getDriveState: () => drive.current.state,
  subscribeDrive: (listener: () => void) => {
    drive.listeners.add(listener);
    return () => drive.listeners.delete(listener);
  },
  fetchMealPhoto: (mealId: string) => drive.fetchMealPhoto(mealId),
  continueDrive: () => drive.continueDrive(),
  prepareDrive: () => drive.prepareDrive(),
}));

const SLOW = { timeout: 4000 };
const BREAKFAST = DEMO_IDS.meals.todayBreakfast;
const LUNCH = DEMO_IDS.meals.todayLunch;
/** Tue 13 Oct: the nasi kandar order switched back from Mamak big and banjir. */
const EDITED_DINNER = 'meal-2026-10-13-dinner';

function Probe({ name }: { name: string }) {
  const location = useLocation();
  return (
    <div>
      {name} at {location.pathname}
      {location.search}
    </div>
  );
}

function renderEntry(id: string, from?: string) {
  const router = createMemoryRouter(
    [
      { path: '/diary', element: <Probe name="Diary" /> },
      { path: '/diary/entry/:id', element: <EntryScreen /> },
      { path: '/log/review', element: <Probe name="Review" /> },
    ],
    { initialEntries: from ? [from, `/diary/entry/${id}`] : [`/diary/entry/${id}`], initialIndex: from ? 1 : 0 },
  );
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(async () => {
  resetUiState();
  drive.current.state = { ...drive.base, tokenExpiresAt: Date.now() + 30 * 60_000 };
  drive.fetchMealPhoto.mockReset().mockResolvedValue({ ok: true });
  drive.continueDrive.mockReset().mockResolvedValue({ ok: true });
  drive.prepareDrive.mockClear();
  await resetAll();
  await loadDemoData();
});

afterEach(async () => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(URL, 'createObjectURL');
  Reflect.deleteProperty(URL, 'revokeObjectURL');
  await resetAll();
});

describe('EntryScreen (S14)', () => {
  it('shows the meal: meta, Place, price, read-only items, total and range', async () => {
    renderEntry(BREAKFAST);

    expect(screen.getByRole('heading', { level: 1, name: 'Entry' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { level: 2, name: 'Roti canai + teh tarik' }, SLOW)).toBeInTheDocument();
    expect(screen.getByText('Breakfast · Fri 16 Oct · 10:40am')).toBeInTheDocument();
    expect(screen.getByText('“roti canai, teh tarik”')).toBeInTheDocument();
    expect(await screen.findByText('Nasi kandar near home', {}, SLOW)).toBeInTheDocument();
    expect(screen.getByText('RM 4.80')).toBeInTheDocument();
    expect(screen.getByText('Typed')).toBeInTheDocument();
    expect(await screen.findByText('Late for you', {}, SLOW)).toBeInTheDocument();

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0] as HTMLElement).getByText('Roti canai + dhal')).toBeInTheDocument();
    expect(within(items[1] as HTMLElement).getByText('Teh tarik')).toBeInTheDocument();
    expect(within(items[1] as HTMLElement).getByText('Normal')).toBeInTheDocument();

    expect(screen.getByText('~560 kcal')).toBeInTheDocument();
    expect(screen.getByText(/^likely \d[\d,]*–[\d,]+ kcal$/)).toBeInTheDocument();
    expect(screen.queryByText(/edited by you/)).not.toBeInTheDocument();
    // Already one of the demo's Usuals at this Place.
    expect(await screen.findByRole('button', { name: 'In your Usuals' }, SLOW)).toBeDisabled();
  });

  it('shows the history line when items were changed from their estimate', async () => {
    renderEntry(EDITED_DINNER);
    expect(await screen.findByRole('heading', { level: 2, name: 'Nasi kandar ayam goreng' }, SLOW)).toBeInTheDocument();
    expect(screen.getByText('Dinner · Tue 13 Oct · 8:50pm')).toBeInTheDocument();
    expect(screen.getByText('~750 kcal')).toBeInTheDocument();
    expect(screen.getByText('Original estimate ~950 · edited by you')).toBeInTheDocument();
    // Rice and kuah show what you changed them to.
    expect(screen.getAllByText('Normal')).toHaveLength(2);
  });

  it('opens Review in edit mode with the meal as the draft', async () => {
    const user = userEvent.setup();
    const router = renderEntry(LUNCH);
    await user.click(await screen.findByRole('button', { name: 'Edit entry' }, SLOW));

    expect(router.state.location.pathname).toBe('/log/review');
    const draft = useUiStore.getState().reviewDraft;
    expect(draft?.flow).toBe('edit');
    expect(draft?.title).toBe('Edit entry');
    expect(draft?.backTo).toBe(`/diary/entry/${LUNCH}`);
    expect(draft?.meta).toMatchObject({ editingMealId: LUNCH, method: 'plate', placeId: DEMO_IDS.places.kedai, priceRm: 9.5, slot: 'lunch' });
    expect(draft?.items).toHaveLength(5);
  });

  it('duplicates the meal to today, with undo', async () => {
    const user = userEvent.setup();
    renderEntry(BREAKFAST);
    await user.click(await screen.findByRole('button', { name: 'Duplicate' }, SLOW));

    await expect.poll(() => db.meals.where('logicalDay').equals('2026-10-16').count()).toBe(3);
    const toast = useUiStore.getState().toast;
    expect(toast?.message).toBe('Logged again today · ~560 kcal');
    toast?.undo?.();
    await expect.poll(() => db.meals.where('logicalDay').equals('2026-10-16').count()).toBe(2);
  });

  it('logs one copy on a double tap of Duplicate', async () => {
    renderEntry(BREAKFAST);
    const duplicate = await screen.findByRole('button', { name: 'Duplicate' }, SLOW);
    fireEvent.click(duplicate);
    fireEvent.click(duplicate);
    await expect.poll(() => useUiStore.getState().toast?.message).toBe('Logged again today · ~560 kcal');
    expect(await db.meals.where('logicalDay').equals('2026-10-16').count()).toBe(3);
  });

  it('saves the meal as a Usual, with undo', async () => {
    const user = userEvent.setup();
    renderEntry(LUNCH);
    const before = await db.usuals.count();
    await user.click(await screen.findByRole('button', { name: 'Save as Usual' }, SLOW));

    expect(await screen.findByRole('button', { name: 'In your Usuals' }, SLOW)).toBeDisabled();
    expect(await db.usuals.count()).toBe(before + 1);
    const usual = (await db.usuals.toArray()).find((u) => u.name === 'Economy rice');
    expect(usual).toMatchObject({ placeId: DEMO_IDS.places.kedai, slot: 'lunch', useCount: 1 });
    expect(usual?.items.every((i) => i.original === undefined)).toBe(true);

    const toast = useUiStore.getState().toast;
    expect(toast?.message).toBe('Saved as a Usual');
    toast?.undo?.();
    expect(await screen.findByRole('button', { name: 'Save as Usual' }, SLOW)).toBeEnabled();
    expect(await db.usuals.count()).toBe(before);
  });

  it('deletes after confirming, goes back to the diary day and can undo', async () => {
    const user = userEvent.setup();
    const router = renderEntry(EDITED_DINNER);
    await user.click(await screen.findByRole('button', { name: 'Delete entry' }, SLOW));

    const dialog = screen.getByRole('alertdialog', { name: 'Delete this entry?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    // The delete is async; the screen leaves once it has gone through.
    await waitFor(() => expect(router.state.location.pathname).toBe('/diary'));
    expect(router.state.location.search).toBe('?day=2026-10-13');
    expect(await db.meals.get(EDITED_DINNER)).toBeUndefined();
    const toast = useUiStore.getState().toast;
    expect(toast?.message).toBe('Entry deleted');
    toast?.undo?.();
    await expect.poll(async () => (await db.meals.get(EDITED_DINNER))?.id).toBe(EDITED_DINNER);
  });

  it('keeps the entry when the delete is cancelled', async () => {
    const user = userEvent.setup();
    renderEntry(BREAKFAST);
    await user.click(await screen.findByRole('button', { name: 'Delete entry' }, SLOW));
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(await db.meals.get(BREAKFAST)).toBeDefined();
  });

  it('goes back to where it came from', async () => {
    const user = userEvent.setup();
    const router = renderEntry(BREAKFAST, '/diary?day=2026-10-16');
    await screen.findByRole('heading', { level: 2, name: 'Roti canai + teh tarik' }, SLOW);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(router.state.location.pathname).toBe('/diary');
  });

  it('shows a friendly empty state for a missing entry', async () => {
    const user = userEvent.setup();
    const router = renderEntry('no-such-meal');
    expect(await screen.findByRole('heading', { name: "This entry isn't here" }, SLOW)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open diary' }));
    expect(router.state.location.pathname).toBe('/diary');
  });
});

describe('EntryScreen photo (S14, §10.18)', () => {
  const FILE = 'drive-file-0001';
  const THUMB = 'data:image/jpeg;base64,/9j/4AAQ';
  const NAME = 'Roti canai + teh tarik';

  /** jsdom has no object URLs: each blob gets a blob:test URL. */
  function objectUrls() {
    let n = 0;
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => {
        n += 1;
        return `blob:test/${n}`;
      }),
    });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  }

  async function withPhoto(extra: { local?: boolean; pointer?: boolean } = {}) {
    await db.meals.update(BREAKFAST, extra.pointer ? { photoId: 'p1', photoDrive: { fileId: FILE, thumb: THUMB } } : { photoId: 'p1' });
    if (extra.local) await db.photos.put({ id: 'p1', blob: new Blob(['full']), thumb: new Blob(['thumb']), createdAt: '2026-10-16T02:40:00.000Z' });
  }

  it('local: the thumb opens the full photo, and closes it again', async () => {
    objectUrls();
    await withPhoto({ local: true, pointer: true });
    const user = userEvent.setup();
    renderEntry(BREAKFAST);
    const thumb = await screen.findByRole('button', { name: `View photo: ${NAME}` }, SLOW);
    await waitFor(() => expect(thumb.querySelector('img')?.getAttribute('src')).toMatch(/^blob:test\//));
    expect(screen.queryByRole('button', { name: 'Show full photo' })).not.toBeInTheDocument();
    await user.click(thumb);
    const full = await screen.findByRole('button', { name: 'Close photo' });
    expect(within(full).getByRole('img', { name: NAME }).getAttribute('src')).toMatch(/^blob:test\//);
    await user.click(full);
    expect(await screen.findByRole('button', { name: `View photo: ${NAME}` })).toBeInTheDocument();
  });

  it('local, waiting for Google: says so, and Continue runs from the tap', async () => {
    objectUrls();
    await withPhoto({ local: true });
    await db.driveJobs.put({ id: 'upload:p1', kind: 'upload', photoId: 'p1', mealId: BREAKFAST, createdAt: 1, notBefore: 1, attempts: 0 });
    drive.current.state = { ...drive.base, counts: { uploads: 1, files: 0, failed: 0 } };
    drive.continueDrive.mockResolvedValueOnce({ ok: false, problem: 'denied' });
    renderEntry(BREAKFAST);
    expect(await screen.findByText('Waiting for Google Drive.', {}, SLOW)).toHaveAttribute('role', 'status');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(drive.continueDrive).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Google didn't give access this time. Try again.")).toBeInTheDocument();
    expect(screen.queryByText('Waiting for Google Drive.')).not.toBeInTheDocument();
  });

  it('in Google Drive: the synced thumb, and Show full photo fetches it from the tap', async () => {
    objectUrls();
    await withPhoto({ pointer: true });
    let answer: (result: FetchPhotoResult) => void = () => undefined;
    drive.fetchMealPhoto.mockImplementationOnce(
      () =>
        new Promise<FetchPhotoResult>((resolve) => {
          answer = resolve;
        }),
    );
    renderEntry(BREAKFAST);
    const show = await screen.findByRole('button', { name: 'Show full photo' }, SLOW);
    expect(document.querySelector('img[src^="data:image/jpeg;base64,"]')).not.toBeNull();
    await waitFor(() => expect(drive.prepareDrive).toHaveBeenCalled());

    fireEvent.click(show);
    expect(drive.fetchMealPhoto).toHaveBeenCalledWith(BREAKFAST);
    expect(await screen.findByRole('button', { name: 'Getting the photo…' })).toBeDisabled();

    // The engine keeps the photo here, then answers.
    await db.photos.put({ id: 'p1', blob: new Blob(['full']), thumb: new Blob(['thumb']), createdAt: '2026-10-16T02:40:00.000Z' });
    answer({ ok: true });
    const full = await screen.findByRole('button', { name: 'Close photo' }, SLOW);
    expect(within(full).getByRole('img', { name: NAME })).toBeInTheDocument();
  });

  it('in Google Drive: says when the photo is not there, and the button stays', async () => {
    await withPhoto({ pointer: true });
    drive.fetchMealPhoto.mockResolvedValueOnce({ ok: false, problem: 'notFound' });
    const user = userEvent.setup();
    renderEntry(BREAKFAST);
    await user.click(await screen.findByRole('button', { name: 'Show full photo' }, SLOW));
    expect(
      await screen.findByText("Couldn't find this photo in your Google Drive. It may have been deleted there, or uploaded with another Google account."),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show full photo' })).toBeEnabled();
  });

  it('in Google Drive, not connected here: Connect opens the connect sheet', async () => {
    await withPhoto({ pointer: true });
    drive.current.state = { ...drive.base, connected: false };
    const user = userEvent.setup();
    renderEntry(BREAKFAST);
    await user.click(await screen.findByRole('button', { name: 'Connect Google Drive to see full photos' }, SLOW));
    const sheet = await screen.findByRole('dialog', { name: 'Connect Google Drive' });
    expect(within(sheet).getByText('Keep meal photos in Google Drive?')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show full photo' })).not.toBeInTheDocument();
  });

  it('in Google Drive, offline: the full photo waits', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await withPhoto({ pointer: true });
    renderEntry(BREAKFAST);
    expect(await screen.findByText("Full photo when you're back online.", {}, SLOW)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Show full photo' })).not.toBeInTheDocument();
  });

  it('in Google Drive, on a build without Drive: the thumb only', async () => {
    await withPhoto({ pointer: true });
    drive.current.state = { ...drive.base, configured: false, connected: false };
    renderEntry(BREAKFAST);
    await screen.findByRole('heading', { level: 2, name: NAME }, SLOW);
    await waitFor(() => expect(document.querySelector('img[src^="data:image/jpeg;base64,"]')).not.toBeNull());
    expect(screen.queryByRole('button', { name: /full photo|Connect Google Drive/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/other device|device that took it|back online/)).not.toBeInTheDocument();
  });

  it('on the other device only: says it shows once it reaches Google Drive', async () => {
    await withPhoto();
    renderEntry(BREAKFAST);
    expect(await screen.findByText('This photo is on your other device. It shows here once it reaches Google Drive.', {}, SLOW)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /View photo/ })).not.toBeInTheDocument();
  });

  it('on the other device only, on a build without Drive: says it stays on that device', async () => {
    await withPhoto();
    drive.current.state = { ...drive.base, configured: false, connected: false };
    renderEntry(BREAKFAST);
    expect(await screen.findByText('This photo is on the device that took it.', {}, SLOW)).toBeInTheDocument();
  });
});
