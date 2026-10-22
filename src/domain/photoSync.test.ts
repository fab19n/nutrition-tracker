// @vitest-environment node
import {
  drivePointerOf,
  driveFileName,
  isDriveFileId,
  isSyncThumb,
  MAX_UPLOAD_BYTES,
  mealPhotoView,
  photosLabel,
  retryDelayMs,
  squareCrop,
  SYNC_THUMB_LIMIT,
  SYNC_THUMB_PREFIX,
  type MealPhotoInput,
} from './photoSync';
import type { MealLog } from './types';

const FILE_ID = '1AbC_dEf-ghIJkl0123';
const THUMB = `${SYNC_THUMB_PREFIX}/9j/4AAQSkZJRgABAQ==`;

describe('isDriveFileId', () => {
  it('takes a Drive id and refuses anything else', () => {
    expect(isDriveFileId(FILE_ID)).toBe(true);
    expect(isDriveFileId('a'.repeat(200))).toBe(true);
    expect(isDriveFileId('short')).toBe(false);
    expect(isDriveFileId('a'.repeat(201))).toBe(false);
    expect(isDriveFileId('1AbC dEf/ghIJkl0123')).toBe(false);
    expect(isDriveFileId("1AbC'dEfghIJkl0123")).toBe(false);
    expect(isDriveFileId(12345678901)).toBe(false);
    expect(isDriveFileId(undefined)).toBe(false);
  });
});

describe('isSyncThumb', () => {
  it('takes a JPEG data URL of base64', () => {
    expect(isSyncThumb(THUMB)).toBe(true);
    expect(isSyncThumb(`${SYNC_THUMB_PREFIX}${'A'.repeat(SYNC_THUMB_LIMIT - SYNC_THUMB_PREFIX.length)}`)).toBe(true);
  });

  it('refuses another type, a long one, bad base64 and non-strings', () => {
    expect(isSyncThumb('data:image/png;base64,iVBORw0KGgo=')).toBe(false);
    expect(isSyncThumb(`${SYNC_THUMB_PREFIX}${'A'.repeat(SYNC_THUMB_LIMIT - SYNC_THUMB_PREFIX.length + 1)}`)).toBe(false);
    expect(isSyncThumb(`${SYNC_THUMB_PREFIX}abc<script>`)).toBe(false);
    expect(isSyncThumb(`${SYNC_THUMB_PREFIX}abc===`)).toBe(false);
    expect(isSyncThumb(SYNC_THUMB_PREFIX)).toBe(false);
    expect(isSyncThumb(42)).toBe(false);
  });
});

describe('drivePointerOf', () => {
  const of = (photoDrive: unknown) => drivePointerOf({ photoDrive } as Pick<MealLog, 'photoDrive'>);

  it('gives a valid pointer back', () => {
    expect(of({ fileId: FILE_ID, thumb: THUMB })).toEqual({ fileId: FILE_ID, thumb: THUMB });
    expect(of({ fileId: FILE_ID })).toEqual({ fileId: FILE_ID });
  });

  it('drops a bad thumb and keeps the file', () => {
    expect(of({ fileId: FILE_ID, thumb: 'javascript:alert(1)' })).toEqual({ fileId: FILE_ID });
    expect(of({ fileId: FILE_ID, thumb: 7 })).toEqual({ fileId: FILE_ID });
  });

  it('reads a bad file id or a wrong shape as no pointer', () => {
    expect(of({ fileId: 'nope', thumb: THUMB })).toBeUndefined();
    expect(of('1AbC_dEf-ghIJkl0123')).toBeUndefined();
    expect(of([FILE_ID])).toBeUndefined();
    expect(of(null)).toBeUndefined();
    expect(of(undefined)).toBeUndefined();
  });
});

describe('driveFileName', () => {
  const meal = { logicalDay: '2026-10-16', slot: 'dinner' as const, name: 'Nasi kandar ayam goreng' };

  it('names the file by day, slot and meal', () => {
    expect(driveFileName(meal, 'image/jpeg')).toBe('2026-10-16 Dinner - Nasi kandar ayam goreng.jpg');
    expect(driveFileName({ ...meal, slot: 'supper' }, '')).toBe('2026-10-16 Supper - Nasi kandar ayam goreng.jpg');
  });

  it('removes characters a file name cannot hold and collapses spaces', () => {
    expect(driveFileName({ ...meal, name: 'Teh / kopi: "kurang"  manis?*<>|\\\u0007' }, 'image/jpeg')).toBe(
      '2026-10-16 Dinner - Teh kopi kurang manis.jpg',
    );
  });

  it('says Meal when nothing is left', () => {
    expect(driveFileName({ ...meal, name: '  /:*  ' }, 'image/jpeg')).toBe('2026-10-16 Dinner - Meal.jpg');
  });

  it('cuts a long name to 80 characters at a word', () => {
    const long = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
    expect(long.length).toBeGreaterThan(200);
    const name = driveFileName({ ...meal, name: long }, 'image/jpeg');
    const part = name.slice('2026-10-16 Dinner - '.length, -'.jpg'.length);
    expect(part.length).toBeLessThanOrEqual(80);
    expect(long.startsWith(part)).toBe(true);
    expect(long.charAt(part.length)).toBe(' ');
    // No space to cut at: a hard cut.
    expect(driveFileName({ ...meal, name: 'x'.repeat(200) }, 'image/jpeg')).toBe(`2026-10-16 Dinner - ${'x'.repeat(80)}.jpg`);
  });

  it('takes the extension from the type', () => {
    expect(driveFileName(meal, 'image/png').endsWith('.png')).toBe(true);
    expect(driveFileName(meal, 'image/webp').endsWith('.webp')).toBe(true);
    expect(driveFileName(meal, 'image/heic').endsWith('.jpg')).toBe(true);
  });
});

describe('retryDelayMs', () => {
  it('steps 30 s, 2 min, 10 min, 30 min, then every hour', () => {
    const half = () => 0.5;
    expect([1, 2, 3, 4, 5, 6].map((n) => retryDelayMs(n, half))).toEqual([30_000, 120_000, 600_000, 1_800_000, 3_600_000, 3_600_000]);
    expect(retryDelayMs(0, half)).toBe(30_000);
  });

  it('spreads each step by ±20 %', () => {
    expect(retryDelayMs(1, () => 0)).toBe(24_000);
    const top = retryDelayMs(1, () => 0.9999);
    expect(top).toBeLessThan(36_000);
    expect(top).toBeGreaterThan(35_990);
  });
});

describe('squareCrop', () => {
  it('takes the middle square', () => {
    expect(squareCrop(1280, 960)).toEqual({ sx: 160, sy: 0, size: 960 });
    expect(squareCrop(960, 1280)).toEqual({ sx: 0, sy: 160, size: 960 });
    expect(squareCrop(500, 500)).toEqual({ sx: 0, sy: 0, size: 500 });
  });
});

describe('photosLabel', () => {
  it('counts photos', () => {
    expect(photosLabel(1)).toBe('1 photo');
    expect(photosLabel(12)).toBe('12 photos');
    expect(photosLabel(1240)).toBe('1,240 photos');
  });
});

describe('MAX_UPLOAD_BYTES', () => {
  it('is 5 MB', () => {
    expect(MAX_UPLOAD_BYTES).toBe(5_242_880);
  });
});

describe('mealPhotoView', () => {
  const base: MealPhotoInput = { photoId: 'p1', hasLocal: false, drive: 'connected', online: true, waitingForTap: false };
  const pointer = { fileId: FILE_ID, thumb: THUMB };

  it('none without a photo', () => {
    expect(mealPhotoView({ ...base, photoId: undefined, pointer })).toEqual({ kind: 'none' });
  });

  it('local when the photo is on this device, waiting for a tap or not', () => {
    expect(mealPhotoView({ ...base, hasLocal: true, pointer })).toEqual({ kind: 'local', waitingForTap: false });
    expect(mealPhotoView({ ...base, hasLocal: true, waitingForTap: true })).toEqual({ kind: 'local', waitingForTap: true });
  });

  it('remote with a pointer, by what this device can do', () => {
    expect(mealPhotoView({ ...base, pointer })).toEqual({ kind: 'remote', action: 'show' });
    expect(mealPhotoView({ ...base, pointer, online: false })).toEqual({ kind: 'remote', action: 'offline' });
    expect(mealPhotoView({ ...base, pointer, drive: 'disconnected' })).toEqual({ kind: 'remote', action: 'connect' });
    expect(mealPhotoView({ ...base, pointer, drive: 'unconfigured' })).toEqual({ kind: 'remote', action: 'none' });
    expect(mealPhotoView({ ...base, pointer, drive: 'demo' })).toEqual({ kind: 'remote', action: 'none' });
  });

  it('elsewhere with neither', () => {
    expect(mealPhotoView(base)).toEqual({ kind: 'elsewhere', driveConfigured: true });
    expect(mealPhotoView({ ...base, drive: 'disconnected' })).toEqual({ kind: 'elsewhere', driveConfigured: true });
    expect(mealPhotoView({ ...base, drive: 'unconfigured' })).toEqual({ kind: 'elsewhere', driveConfigured: false });
    expect(mealPhotoView({ ...base, drive: 'demo' })).toEqual({ kind: 'elsewhere', driveConfigured: false });
  });
});
