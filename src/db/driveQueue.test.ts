// @vitest-environment node
import { setDemoClock } from '@/domain/clock';
import { SYNC_THUMB_PREFIX } from '@/domain/photoSync';
import type { MealLog } from '@/domain/types';
import { createDb, type KiraMakanDb } from './db';
import {
  clearSetAside,
  dropUploadIn,
  dueJobs,
  fileJobId,
  findMealForJob,
  forgetDriveConnection,
  isFileReferenced,
  jobCounts,
  nextDueAt,
  queueExistingPhotos,
  queueTrashIn,
  queueUploadIn,
  readDriveMeta,
  recordUpload,
  releaseAll,
  rememberFolder,
  rescheduleJob,
  saveDriveConnection,
  setAsideJob,
  TRASH_DELAY_MS,
  undoTrashIn,
  uploadJobId,
} from './driveQueue';
import type { DriveFileJob, DriveUploadJob } from './driveTypes';

const CLIENT_ID = '123-abc.apps.googleusercontent.com';
const NOW = Date.parse('2026-10-16T11:10:00.000Z');
const FILE = 'drive-file-0001';
const OTHER_FILE = 'drive-file-0002';
const THUMB = `${SYNC_THUMB_PREFIX}/9j/4AAQ`;

let db: KiraMakanDb;

function meal(id: string, extra: Partial<MealLog> = {}): MealLog {
  return {
    id,
    eatenAt: '2026-10-16T11:00:00.000Z',
    logicalDay: '2026-10-16',
    slot: 'dinner',
    name: 'Nasi kandar',
    items: [],
    method: 'photo',
    finished: 'all',
    createdAt: '2026-10-16T11:01:00.000Z',
    updatedAt: '2026-10-16T11:01:00.000Z',
    syncState: 'local',
    ...extra,
  };
}

function photo(id: string) {
  return { id, blob: new Blob([id], { type: 'image/jpeg' }), thumb: new Blob([id]), createdAt: '2026-10-16T11:00:00.000Z' };
}

function upload(photoId: string, extra: Partial<DriveUploadJob> = {}): DriveUploadJob {
  return { id: uploadJobId(photoId), kind: 'upload', photoId, mealId: `meal-${photoId}`, createdAt: NOW, notBefore: NOW, attempts: 0, ...extra };
}

function fileJob(fileId: string, extra: Partial<DriveFileJob> = {}): DriveFileJob {
  return { id: fileJobId(fileId), kind: 'file', fileId, trashed: true, createdAt: NOW, notBefore: NOW, attempts: 0, ...extra };
}

async function connect(extra: { email?: string; folderId?: string } = {}) {
  await db.driveMeta.put({ id: 'drive', connectedAt: NOW, ...extra });
}

/** Runs `work` in a read-write transaction over the queue tables, as the actions do. */
function inTx<T>(work: () => Promise<T>): Promise<T> {
  return db.transaction('rw', [db.meals, db.driveJobs, db.driveMeta], work);
}

beforeEach(() => {
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', CLIENT_ID);
  db = createDb(`drive-queue-${crypto.randomUUID()}`);
});

afterEach(async () => {
  vi.unstubAllEnvs();
  setDemoClock(false);
  await db.delete();
});

describe('queueUploadIn', () => {
  it('queues the photo of a meal when this device is connected', async () => {
    await connect();
    expect(await inTx(() => queueUploadIn(db, meal('m1', { photoId: 'p1' }), NOW))).toBe(true);
    expect(await db.driveJobs.get('upload:p1')).toEqual({
      id: 'upload:p1',
      kind: 'upload',
      photoId: 'p1',
      mealId: 'm1',
      createdAt: NOW,
      notBefore: NOW,
      attempts: 0,
    });
  });

  it('queues nothing without a client id, a connection, a photo, or with a pointer', async () => {
    expect(await inTx(() => queueUploadIn(db, meal('m1', { photoId: 'p1' }), NOW))).toBe(false);
    await connect();
    expect(await inTx(() => queueUploadIn(db, meal('m2'), NOW))).toBe(false);
    expect(await inTx(() => queueUploadIn(db, meal('m3', { photoId: 'p3', photoDrive: { fileId: FILE } }), NOW))).toBe(false);
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '');
    expect(await inTx(() => queueUploadIn(db, meal('m4', { photoId: 'p4' }), NOW))).toBe(false);
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'not-a-client-id');
    expect(await inTx(() => queueUploadIn(db, meal('m5', { photoId: 'p5' }), NOW))).toBe(false);
    expect(await db.driveJobs.count()).toBe(0);
  });

  it('queues nothing under the demo clock', async () => {
    await connect();
    setDemoClock(true);
    expect(await inTx(() => queueUploadIn(db, meal('m1', { photoId: 'p1' }), NOW))).toBe(false);
    expect(await db.driveJobs.count()).toBe(0);
  });

  it('keeps the attempts of a job already there', async () => {
    await connect();
    await db.driveJobs.put(upload('p1', { attempts: 3, notBefore: NOW + 60_000, mealId: 'old' }));
    expect(await inTx(() => queueUploadIn(db, meal('m1', { photoId: 'p1' }), NOW + 1))).toBe(true);
    expect(await db.driveJobs.get('upload:p1')).toMatchObject({ attempts: 3, notBefore: NOW + 60_000, mealId: 'm1', createdAt: NOW });
  });
});

describe('dropUploadIn', () => {
  it('removes the upload job and hands it back', async () => {
    const job = upload('p1');
    await db.driveJobs.put(job);
    expect(await inTx(() => dropUploadIn(db, 'p1'))).toEqual(job);
    expect(await db.driveJobs.count()).toBe(0);
    expect(await inTx(() => dropUploadIn(db, 'p1'))).toBeUndefined();
  });
});

describe('queueTrashIn and undoTrashIn', () => {
  it('trashes a minute later, replacing a restore for the same file', async () => {
    await db.driveJobs.put(fileJob(FILE, { trashed: false }));
    await inTx(() => queueTrashIn(db, FILE, NOW));
    expect(await db.driveJobs.get(fileJobId(FILE))).toEqual(fileJob(FILE, { notBefore: NOW + TRASH_DELAY_MS }));
    expect(TRASH_DELAY_MS).toBe(60_000);
  });

  it('queues nothing without a client id or under the demo clock', async () => {
    setDemoClock(true);
    await inTx(() => queueTrashIn(db, FILE, NOW));
    setDemoClock(false);
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '');
    await inTx(() => queueTrashIn(db, FILE, NOW));
    expect(await db.driveJobs.count()).toBe(0);
  });

  it('undo deletes a trash that has not run', async () => {
    await inTx(() => queueTrashIn(db, FILE, NOW));
    await inTx(() => undoTrashIn(db, FILE, NOW + 2_000));
    expect(await db.driveJobs.count()).toBe(0);
  });

  it('undo after the trash ran restores the file', async () => {
    await inTx(() => undoTrashIn(db, FILE, NOW + 90_000));
    expect(await db.driveJobs.get(fileJobId(FILE))).toEqual(fileJob(FILE, { trashed: false, createdAt: NOW + 90_000, notBefore: NOW + 90_000 }));
  });
});

describe('queueExistingPhotos', () => {
  it('queues each photo whose meal has no pointer yet, with the meal as its age', async () => {
    await connect();
    await db.photos.bulkPut([photo('p1'), photo('p2'), photo('p3'), photo('p4'), photo('orphan')]);
    await db.meals.bulkPut([
      meal('m1', { photoId: 'p1', createdAt: '2026-10-15T01:00:00.000Z' }),
      meal('m2', { photoId: 'p2', photoDrive: { fileId: FILE } }),
      meal('m3', { photoId: 'p3', createdAt: 'not a date' }),
      meal('m4', { photoId: 'p4' }),
      meal('m5', { photoId: 'not-here' }),
    ]);
    await db.driveJobs.put(upload('p4', { attempts: 2 }));

    expect(await queueExistingPhotos(db, NOW)).toBe(2);
    const jobs = await db.driveJobs.toArray();
    expect(jobs.map((j) => j.id).sort()).toEqual(['upload:p1', 'upload:p3', 'upload:p4']);
    expect(await db.driveJobs.get('upload:p1')).toMatchObject({ mealId: 'm1', createdAt: Date.parse('2026-10-15T01:00:00.000Z'), notBefore: NOW, attempts: 0 });
    expect(await db.driveJobs.get('upload:p3')).toMatchObject({ createdAt: NOW });
    expect(await db.driveJobs.get('upload:p4')).toMatchObject({ attempts: 2 });
    expect(await queueExistingPhotos(db, NOW)).toBe(0);
  });

  it('queues nothing when this device is not connected, or in demo', async () => {
    await db.photos.put(photo('p1'));
    await db.meals.put(meal('m1', { photoId: 'p1' }));
    expect(await queueExistingPhotos(db, NOW)).toBe(0);
    await connect();
    setDemoClock(true);
    expect(await queueExistingPhotos(db, NOW)).toBe(0);
    expect(await db.driveJobs.count()).toBe(0);
  });
});

describe('the connection', () => {
  it('reads as not connected without a row', async () => {
    expect(await readDriveMeta(db)).toEqual({ id: 'drive' });
  });

  it('keeps the folder and last upload for the same account only', async () => {
    await connect({ email: 'You@example.com', folderId: 'folder-1' });
    await db.driveMeta.update('drive', { lastUploadAt: NOW - 5 });
    await saveDriveConnection(db, { connectedAt: NOW + 1, email: 'you@example.com' });
    expect(await readDriveMeta(db)).toEqual({ id: 'drive', connectedAt: NOW + 1, email: 'you@example.com', folderId: 'folder-1', lastUploadAt: NOW - 5 });

    await saveDriveConnection(db, { connectedAt: NOW + 2, email: 'other@example.com' });
    expect(await readDriveMeta(db)).toEqual({ id: 'drive', connectedAt: NOW + 2, email: 'other@example.com' });
  });

  it('forgets the connection and keeps the queue', async () => {
    await connect();
    await db.driveJobs.put(upload('p1'));
    await forgetDriveConnection(db);
    expect(await readDriveMeta(db)).toEqual({ id: 'drive' });
    expect(await db.driveJobs.count()).toBe(1);
  });

  it('remembers and forgets the folder, only while connected', async () => {
    await rememberFolder(db, 'folder-1');
    expect(await db.driveMeta.count()).toBe(0);
    await connect();
    await rememberFolder(db, 'folder-1');
    expect((await readDriveMeta(db)).folderId).toBe('folder-1');
    await rememberFolder(db, undefined);
    expect(await readDriveMeta(db)).toEqual({ id: 'drive', connectedAt: NOW });
  });
});

describe('due jobs', () => {
  beforeEach(async () => {
    await db.driveJobs.bulkPut([
      upload('old', { createdAt: NOW - 3_000 }),
      upload('new', { createdAt: NOW - 1_000 }),
      upload('later', { createdAt: NOW, notBefore: NOW + 30_000 }),
      upload('aside', { createdAt: NOW, failedAt: NOW - 1, lastProblem: 'refused' }),
      fileJob('file-new-00001', { createdAt: NOW - 500 }),
      fileJob('file-old-00001', { createdAt: NOW - 9_000, trashed: false }),
      fileJob('file-wait-0001', { createdAt: NOW, notBefore: NOW + TRASH_DELAY_MS }),
    ]);
  });

  it('runs file jobs first (oldest first), then uploads newest first', async () => {
    expect((await dueJobs(db, NOW, { uploads: true })).map((j) => j.id)).toEqual([
      'file:file-old-00001',
      'file:file-new-00001',
      'upload:new',
      'upload:old',
    ]);
    expect((await dueJobs(db, NOW, { uploads: false })).map((j) => j.id)).toEqual(['file:file-old-00001', 'file:file-new-00001']);
    expect((await dueJobs(db, NOW + TRASH_DELAY_MS, { uploads: true })).map((j) => j.id)).toContain('upload:later');
  });

  it('says when the next one is due', async () => {
    await db.driveJobs.bulkDelete(['upload:old', 'upload:new', 'file:file-new-00001', 'file:file-old-00001']);
    expect(await nextDueAt(db, { uploads: true })).toBe(NOW + 30_000);
    expect(await nextDueAt(db, { uploads: false })).toBe(NOW + TRASH_DELAY_MS);
    await db.driveJobs.clear();
    expect(await nextDueAt(db, { uploads: true })).toBeUndefined();
  });

  it('counts uploads, file jobs and set-aside uploads', async () => {
    expect(await jobCounts(db)).toEqual({ uploads: 3, files: 3, failed: 1 });
  });

  it('reschedules, sets aside and clears the set-aside at start', async () => {
    await rescheduleJob(db, 'upload:old', { attempts: 1, notBefore: NOW + 30_000, lastProblem: 'unreachable' });
    expect(await db.driveJobs.get('upload:old')).toMatchObject({ attempts: 1, notBefore: NOW + 30_000, lastProblem: 'unreachable' });
    await setAsideJob(db, 'upload:new', NOW, 'tooBig');
    expect(await db.driveJobs.get('upload:new')).toMatchObject({ failedAt: NOW, lastProblem: 'tooBig' });
    expect((await jobCounts(db)).failed).toBe(2);

    await clearSetAside(db, NOW + 5);
    const cleared = await db.driveJobs.get('upload:aside');
    expect(cleared?.failedAt).toBeUndefined();
    expect(cleared?.notBefore).toBe(NOW + 5);
    expect((await jobCounts(db)).failed).toBe(0);
  });

  it('releases every job waiting on a backoff, but not a trash delay or a set-aside job', async () => {
    await db.driveJobs.put(fileJob('file-retry-001', { attempts: 2, notBefore: NOW + 600_000 }));
    await releaseAll(db, NOW);
    expect((await db.driveJobs.get('upload:later'))?.notBefore).toBe(NOW);
    expect((await db.driveJobs.get('file:file-retry-001'))?.notBefore).toBe(NOW);
    expect((await db.driveJobs.get('file:file-wait-0001'))?.notBefore).toBe(NOW + TRASH_DELAY_MS);
    expect((await db.driveJobs.get('upload:aside'))?.failedAt).toBe(NOW - 1);
  });
});

describe('meals and files', () => {
  it('knows when a meal points at a file', async () => {
    await db.meals.bulkPut([meal('m1', { photoId: 'p1', photoDrive: { fileId: FILE } }), meal('m2', { photoDrive: { fileId: 'bad' } })]);
    expect(await isFileReferenced(db, FILE)).toBe(true);
    expect(await isFileReferenced(db, OTHER_FILE)).toBe(false);
    expect(await isFileReferenced(db, 'bad')).toBe(false);
  });

  it('finds the meal for a job by id, else by its photo', async () => {
    await db.meals.bulkPut([meal('m1', { photoId: 'p1' }), meal('m2', { photoId: 'p2' })]);
    expect((await findMealForJob(db, upload('p1', { mealId: 'm1' })))?.id).toBe('m1');
    expect((await findMealForJob(db, upload('p2', { mealId: 'gone' })))?.id).toBe('m2');
    expect((await findMealForJob(db, upload('p2', { mealId: 'm1' })))?.id).toBe('m2');
    expect(await findMealForJob(db, upload('p9'))).toBeUndefined();
  });
});

describe('recordUpload', () => {
  it('writes the pointer, keeps updatedAt, removes the job and stamps the upload', async () => {
    await connect();
    const before = meal('m1', { photoId: 'p1' });
    await db.meals.put(before);
    const job = upload('p1', { mealId: 'm1' });
    await db.driveJobs.put(job);

    expect(await recordUpload(db, job, { fileId: FILE, thumb: THUMB }, NOW + 9)).toBe('saved');
    expect(await db.meals.get('m1')).toEqual({ ...before, photoDrive: { fileId: FILE, thumb: THUMB } });
    expect(await db.driveJobs.count()).toBe(0);
    expect((await readDriveMeta(db)).lastUploadAt).toBe(NOW + 9);
  });

  it('writes no thumb that is not a JPEG data URL', async () => {
    await connect();
    await db.meals.put(meal('m1', { photoId: 'p1' }));
    expect(await recordUpload(db, upload('p1', { mealId: 'm1' }), { fileId: FILE, thumb: 'data:image/png;base64,AAAA' }, NOW)).toBe('saved');
    expect((await db.meals.get('m1'))?.photoDrive).toEqual({ fileId: FILE });
  });

  it('queues the new file for trash when the meal is gone', async () => {
    await connect();
    const job = upload('p1', { mealId: 'm1' });
    await db.driveJobs.put(job);
    expect(await recordUpload(db, job, { fileId: FILE }, NOW)).toBe('orphan');
    expect(await db.driveJobs.toArray()).toEqual([fileJob(FILE, { notBefore: NOW + TRASH_DELAY_MS })]);
  });

  it('keeps the pointer already there and trashes the second file', async () => {
    await connect();
    await db.meals.put(meal('m1', { photoId: 'p1', photoDrive: { fileId: OTHER_FILE } }));
    expect(await recordUpload(db, upload('p1', { mealId: 'm1' }), { fileId: FILE }, NOW)).toBe('duplicate');
    expect((await db.meals.get('m1'))?.photoDrive).toEqual({ fileId: OTHER_FILE });
    expect(await db.driveJobs.toArray()).toEqual([fileJob(FILE, { notBefore: NOW + TRASH_DELAY_MS })]);
  });

  it('syncs the pointer write, and never the Drive bookkeeping', async () => {
    const captured = createDb(`drive-capture-${crypto.randomUUID()}`, { capture: () => true });
    try {
      await captured.driveMeta.put({ id: 'drive', connectedAt: NOW });
      await captured.meals.put(meal('m1', { photoId: 'p1' }));
      await captured.syncOutbox.clear();
      const job = upload('p1', { mealId: 'm1' });
      await captured.driveJobs.put(job);
      expect(await recordUpload(captured, job, { fileId: FILE }, NOW)).toBe('saved');
      expect((await captured.syncOutbox.toArray()).map((e) => [e.table, e.key])).toEqual([['meals', 'm1']]);
    } finally {
      await captured.delete();
    }
  });
});
