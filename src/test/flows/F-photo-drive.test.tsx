/*
 * Meal photos in Google Drive (decision §10.18): the whole app on a real diary, with the real Drive
 * engine (src/drive) talking to the fake Drive (src/drive/testing/fakeDrive) through the fake token
 * source (src/drive/testing/fakeGis). Nothing loads from Google and nothing reaches the network.
 *
 * Connect from Settings › Photos uploads the photo already here; deleting the meal queues its file
 * for Drive's trash a minute later, and Undo takes that back; Delete everything wipes this device
 * and leaves the photo in Drive.
 */
import { act, screen, waitFor, within } from '@testing-library/react';
import { completeSetup } from '@/db/actions';
import { db } from '@/db/db';
import { fileJobId, TRASH_DELAY_MS } from '@/db/driveQueue';
import { logicalDayOf } from '@/domain/day';
import type { MealLog } from '@/domain/types';
import { resetDriveForTests, startDrive } from '@/drive';
import { useUiStore } from '@/state/ui';
import { setupFlows, SLOW, startApp } from './harness';

const CLIENT_ID = '123-abc.apps.googleusercontent.com';
const TZ = 'Asia/Kuala_Lumpur';
const ROLLOVER = 5;

/** The fake Drive and token source, made per test and handed to the app's engine by the mocks below. */
const fakes = vi.hoisted(() => ({
  drive: null as import('@/drive/testing/fakeDrive').FakeDrive | null,
  tokens: null as import('@/drive/testing/fakeGis').FakeTokens | null,
}));

vi.mock('@/drive/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/drive/api')>();
  return {
    ...actual,
    createDriveApi: () =>
      actual.createDriveApi((input, init) => {
        if (!fakes.drive) throw new Error('No fake Drive for this test');
        return fakes.drive.fetch(input, init);
      }),
  };
});

vi.mock('@/drive/gis', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/drive/gis')>();
  return {
    ...actual,
    createGisTokenSource: () => {
      if (!fakes.tokens) throw new Error('No fake token source for this test');
      return fakes.tokens;
    },
  };
});

setupFlows({ demo: false });

const SETUP = {
  age: 34,
  sex: 'male' as const,
  heightCm: 172,
  weightKg: 78.6,
  activity: 'light' as const,
  paceKgPerWeek: 0.5,
  dailyMinimumKcal: 1400,
  regulars: [],
  places: [{ name: 'Home', type: 'home' as const }],
  rolloverHour: ROLLOVER,
  timeZone: TZ,
};

/** A dinner with a photo, eaten just now, so it's on today's page. */
function photoMealNow(id: string, photoId: string): MealLog {
  const at = new Date();
  const stamp = at.toISOString();
  return {
    id,
    eatenAt: stamp,
    logicalDay: logicalDayOf(at, TZ, ROLLOVER),
    slot: 'dinner',
    name: 'Nasi kandar ayam goreng',
    items: [
      { id: `${id}-item`, name: 'Nasi kandar', unitMacros: { kcal: 750, proteinG: 30, carbsG: 90, fatG: 28 }, quantity: 1, uncertainty: 0.2, source: 'catalogue' },
    ],
    method: 'photo',
    photoId,
    finished: 'all',
    createdAt: stamp,
    updatedAt: stamp,
    syncState: 'local',
  };
}

beforeEach(async () => {
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', CLIENT_ID);
  const { createFakeDrive } = await import('@/drive/testing/fakeDrive');
  const { createFakeTokens } = await import('@/drive/testing/fakeGis');
  fakes.drive = createFakeDrive({ email: 'fabian@example.com' });
  fakes.tokens = createFakeTokens();
});

afterEach(async () => {
  await resetDriveForTests();
  fakes.drive = null;
  fakes.tokens = null;
});

describe('F · meal photos in Google Drive', () => {
  it('connects, uploads the photo here, trashes it a minute after a delete, and Delete everything leaves Drive alone', async () => {
    await completeSetup(SETUP);
    await db.photos.put({
      id: 'photo-1',
      blob: new Blob(['jpeg-bytes'], { type: 'image/jpeg' }),
      thumb: new Blob(['thumb-bytes'], { type: 'image/jpeg' }),
      createdAt: new Date().toISOString(),
    });
    await db.meals.put(photoMealNow('dinner-1', 'photo-1'));
    // As App.tsx does at start-up.
    startDrive();

    const drive = fakes.drive;
    const tokens = fakes.tokens;
    if (!drive || !tokens) throw new Error('No fakes');
    const { user, router } = startApp('/more/settings');

    // Settings › Photos › Connect Google Drive › Continue with Google.
    const photos = (await screen.findByRole('heading', { level: 2, name: 'Photos' }, SLOW)).closest('section') as HTMLElement;
    await user.click(await within(photos).findByRole('button', { name: 'Connect Google Drive' }, SLOW));
    const sheet = await screen.findByRole('dialog', { name: 'Connect Google Drive' }, SLOW);
    tokens.next({ accessToken: 'token-1', expiresAt: Date.now() + 3_600_000 });
    await user.click(await within(sheet).findByRole('button', { name: 'Continue with Google' }, SLOW));
    expect(tokens.requests).toEqual([{ prompt: 'select_account', inTap: false }]);

    await waitFor(() => expect(useUiStore.getState().toast?.message).toBe('Google Drive connected · 1 photo to upload'), SLOW);

    // The photo goes to the Kira Makan photos folder, and the meal points at it.
    await waitFor(async () => expect((await db.meals.get('dinner-1'))?.photoDrive).toBeDefined(), SLOW);
    await waitFor(() => expect(within(photos).getByRole('status')).toHaveTextContent('Up to date'), SLOW);
    expect(within(photos).getByText(/^Last photo uploaded/)).toBeInTheDocument();
    expect(within(photos).getByText('fabian@example.com')).toBeInTheDocument();
    const [file] = drive.photos();
    expect(file).toMatchObject({ appProperties: { kmPhoto: 'photo-1', kmMeal: 'dinner-1' }, trashed: false });
    expect(drive.folders().map((f) => f.name)).toEqual(['Kira Makan photos']);
    const fileId = file?.id ?? '';
    expect((await db.meals.get('dinner-1'))?.photoDrive?.fileId).toBe(fileId);

    // Open the entry and delete it: Undo puts it back with nothing queued for Drive's trash.
    await act(() => router.navigate('/diary/entry/dinner-1'));
    await user.click(await screen.findByRole('button', { name: 'Delete entry' }, SLOW));
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Delete this entry?' })).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(useUiStore.getState().toast?.message).toBe('Entry deleted'), SLOW);
    expect(await db.driveJobs.get(fileJobId(fileId))).toMatchObject({ kind: 'file', trashed: true });
    await act(async () => {
      useUiStore.getState().toast?.undo?.();
    });
    await waitFor(async () => expect(await db.meals.get('dinner-1')).toBeDefined(), SLOW);
    await waitFor(async () => expect(await db.driveJobs.get(fileJobId(fileId))).toBeUndefined(), SLOW);
    expect((await db.meals.get('dinner-1'))?.photoDrive?.fileId).toBe(fileId);

    // Delete it again: its file goes to the trash a minute from now.
    await act(() => router.navigate('/diary/entry/dinner-1'));
    await user.click(await screen.findByRole('button', { name: 'Delete entry' }, SLOW));
    const before = Date.now();
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Delete this entry?' })).getByRole('button', { name: 'Delete' }));
    await waitFor(async () => expect(await db.meals.get('dinner-1')).toBeUndefined(), SLOW);
    const trash = await db.driveJobs.get(fileJobId(fileId));
    expect(trash).toMatchObject({ kind: 'file', fileId, trashed: true });
    expect(trash?.notBefore).toBeGreaterThanOrEqual(before + TRASH_DELAY_MS);
    expect(trash?.notBefore).toBeLessThanOrEqual(Date.now() + TRASH_DELAY_MS);

    // Delete everything wipes this device, the Drive bookkeeping with it, and never touches Drive.
    await act(() => router.navigate('/more/settings'));
    await user.click(await screen.findByRole('button', { name: /^Delete everything/ }, SLOW));
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete everything?' }, SLOW);
    expect(dialog).toHaveAccessibleDescription(/Photos in your Google Drive stay there\.$/);
    await user.type(within(dialog).getByRole('textbox'), 'DELETE');
    await user.click(within(dialog).getByRole('button', { name: 'Delete everything' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/setup'), SLOW);
    expect(await db.driveJobs.count()).toBe(0);
    expect(await db.driveMeta.count()).toBe(0);
    expect(drive.files.get(fileId)).toMatchObject({ trashed: false });
    expect(drive.requests('PATCH')).toEqual([]);
  });
});
