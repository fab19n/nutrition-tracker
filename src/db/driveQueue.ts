/**
 * The Drive photo queue and this device's Drive connection (decision §10.18), over the two local
 * stores of Dexie version 3 (`driveJobs`, `driveMeta`). Nothing here talks to Google: src/drive's
 * engine reads the queue and runs it. Actions (src/db/actions.ts) queue an upload when a meal with
 * a photo is saved and a trash when it is deleted, in the meal's own transaction, so Undo rolls the
 * queue back with the meal.
 *
 * - Jobs exist only when the app has a Google client id and never under the demo clock, and an
 *   upload only once this device is connected. Times are the real clock (Date.now), like sync.
 * - `upload:<photoId>`: upload a meal photo once; `file:<fileId>`: bring a Drive file to
 *   `trashed` (the last wish wins). A job re-validates when it runs, so stale ones drop themselves.
 * - The pointer (`MealLog.photoDrive`) is written only by `recordUpload`, after a successful
 *   upload and once sync has pulled (the engine's `catchUp`): an ordinary captured meal write, so it
 *   reaches other devices through sync, made on a copy that has what they changed.
 */
import { isDemoClock } from '@/domain/clock';
import { drivePointerOf, isSyncThumb } from '@/domain/photoSync';
import type { Id, MealLog, MealPhotoDrive } from '@/domain/types';
import { isDriveConfigured } from '@/drive/config';
import type { KiraMakanDb } from './db';
import type { DriveFileJob, DriveJob, DriveJobProblem, DriveMeta, DriveUploadJob } from './driveTypes';

/** A deleted meal's file goes to Drive's trash this long after the delete, well past the Undo toast. */
export const TRASH_DELAY_MS = 60_000;

export const uploadJobId = (photoId: Id): string => `upload:${photoId}`;
export const fileJobId = (fileId: string): string => `file:${fileId}`;

const UPLOAD_PREFIX = 'upload:';

/** Jobs may exist: a client id, and not the sample week. */
function queueable(): boolean {
  return isDriveConfigured() && !isDemoClock();
}

function setAside(job: DriveJob): boolean {
  return job.failedAt !== undefined;
}

// ---------------------------------------------------------------------------
// Inside a caller's read-write transaction (it names the tables each one needs)
// ---------------------------------------------------------------------------

/**
 * [driveJobs, driveMeta]: queues the meal's photo when configured, not under the demo clock,
 * connected here, and the meal has a photoId and no pointer. An existing job keeps its attempts.
 * True when one is queued.
 */
export async function queueUploadIn(
  db: KiraMakanDb,
  meal: Pick<MealLog, 'id' | 'photoId' | 'photoDrive'>,
  nowMs: number = Date.now(),
): Promise<boolean> {
  if (!queueable() || !meal.photoId || drivePointerOf(meal)) return false;
  const meta = await db.driveMeta.get('drive');
  if (meta?.connectedAt === undefined) return false;
  const id = uploadJobId(meal.photoId);
  const existing = await db.driveJobs.get(id);
  if (existing?.kind === 'upload') {
    if (existing.mealId !== meal.id) await db.driveJobs.put({ ...existing, mealId: meal.id });
    return true;
  }
  const job: DriveUploadJob = { id, kind: 'upload', photoId: meal.photoId, mealId: meal.id, createdAt: nowMs, notBefore: nowMs, attempts: 0 };
  await db.driveJobs.put(job);
  return true;
}

/** [driveJobs]: removes the photo's upload job; returns it (for an undo). */
export async function dropUploadIn(db: KiraMakanDb, photoId: Id): Promise<DriveUploadJob | undefined> {
  const id = uploadJobId(photoId);
  const job = await db.driveJobs.get(id);
  if (job?.kind !== 'upload') return undefined;
  await db.driveJobs.delete(id);
  return job;
}

/** [driveJobs]: wants the file trashed, not before now + delay. Configured and not demo only. Replaces a job for the same file. */
export async function queueTrashIn(db: KiraMakanDb, fileId: string, nowMs: number = Date.now(), delayMs: number = TRASH_DELAY_MS): Promise<void> {
  if (!queueable()) return;
  const job: DriveFileJob = { id: fileJobId(fileId), kind: 'file', fileId, trashed: true, createdAt: nowMs, notBefore: nowMs + delayMs, attempts: 0 };
  await db.driveJobs.put(job);
}

/** [driveJobs]: the undo of a trash: a pending trash job is deleted; none (it ran) → queue { trashed: false } now. */
export async function undoTrashIn(db: KiraMakanDb, fileId: string, nowMs: number = Date.now()): Promise<void> {
  if (!queueable()) return;
  const id = fileJobId(fileId);
  const job = await db.driveJobs.get(id);
  if (job?.kind === 'file') {
    if (job.trashed) await db.driveJobs.delete(id);
    return;
  }
  const restore: DriveFileJob = { id, kind: 'file', fileId, trashed: false, createdAt: nowMs, notBefore: nowMs, attempts: 0 };
  await db.driveJobs.put(restore);
}

// ---------------------------------------------------------------------------
// Own transactions
// ---------------------------------------------------------------------------

/**
 * Queues every photo this device holds whose meal has no pointer yet (connecting, Keep photos back
 * on, each start). Not configured, demo or not connected: 0. Returns how many were added.
 */
export function queueExistingPhotos(db: KiraMakanDb, nowMs: number = Date.now()): Promise<number> {
  if (!queueable()) return Promise.resolve(0);
  return db.transaction('rw', [db.photos, db.meals, db.driveJobs, db.driveMeta], async () => {
    const meta = await db.driveMeta.get('drive');
    if (meta?.connectedAt === undefined) return 0;
    const photoIds = new Set(await db.photos.toCollection().primaryKeys());
    if (photoIds.size === 0) return 0;
    const queued = new Set(await db.driveJobs.where(':id').startsWith(UPLOAD_PREFIX).primaryKeys());
    const meals = await db.meals.filter((m) => m.photoId !== undefined && photoIds.has(m.photoId) && !drivePointerOf(m)).toArray();
    const jobs: DriveUploadJob[] = [];
    for (const meal of meals) {
      if (!meal.photoId) continue;
      const id = uploadJobId(meal.photoId);
      if (queued.has(id)) continue;
      queued.add(id);
      const created = Date.parse(meal.createdAt);
      jobs.push({
        id,
        kind: 'upload',
        photoId: meal.photoId,
        mealId: meal.id,
        createdAt: Number.isFinite(created) ? created : nowMs,
        notBefore: nowMs,
        attempts: 0,
      });
    }
    if (jobs.length > 0) await db.driveJobs.bulkAdd(jobs);
    return jobs.length;
  });
}

/** The connection row, or `{ id: 'drive' }` (not connected) when there is none. */
export async function readDriveMeta(db: KiraMakanDb): Promise<DriveMeta> {
  return (await db.driveMeta.get('drive')) ?? { id: 'drive' };
}

function sameEmail(a: string | undefined, b: string | undefined): boolean {
  return (a ?? '').toLowerCase() === (b ?? '').toLowerCase();
}

/** Connected on this device. The cached folder and last upload stay only for the same Google account. */
export function saveDriveConnection(db: KiraMakanDb, c: { connectedAt: number; email?: string }): Promise<void> {
  return db.transaction('rw', db.driveMeta, async () => {
    const before = await db.driveMeta.get('drive');
    const meta: DriveMeta = { id: 'drive', connectedAt: c.connectedAt };
    if (c.email) meta.email = c.email;
    if (before && sameEmail(before.email, c.email)) {
      if (before.folderId) meta.folderId = before.folderId;
      if (before.lastUploadAt !== undefined) meta.lastUploadAt = before.lastUploadAt;
    }
    await db.driveMeta.put(meta);
  });
}

/** Disconnect on this device: the connection row goes, the queue stays (it resumes on a later connect). */
export async function forgetDriveConnection(db: KiraMakanDb): Promise<void> {
  await db.driveMeta.delete('drive');
}

/** Caches the photos folder (undefined forgets it). Does nothing once disconnected. */
export function rememberFolder(db: KiraMakanDb, folderId: string | undefined): Promise<void> {
  return db.transaction('rw', db.driveMeta, async () => {
    const meta = await db.driveMeta.get('drive');
    if (!meta) return;
    const { folderId: _old, ...rest } = meta;
    await db.driveMeta.put(folderId ? { ...rest, folderId } : rest);
  });
}

/**
 * The jobs due at `nowMs`, in the order they run: file jobs first (oldest first), then uploads
 * newest first (recent meals matter more on the other device). Set-aside jobs are left out, and
 * uploads too unless `uploads`.
 */
export async function dueJobs(db: KiraMakanDb, nowMs: number, opts: { uploads: boolean }): Promise<DriveJob[]> {
  const due = (await db.driveJobs.where('notBefore').belowOrEqual(nowMs).toArray()).filter(
    (job) => !setAside(job) && (opts.uploads || job.kind === 'file'),
  );
  const files = due.filter((job) => job.kind === 'file').sort((a, b) => a.createdAt - b.createdAt);
  const uploads = due.filter((job) => job.kind === 'upload').sort((a, b) => b.createdAt - a.createdAt);
  return [...files, ...uploads];
}

/** When the next job that could run is due (a trash delay or a backoff), or undefined when none waits. */
export async function nextDueAt(db: KiraMakanDb, opts: { uploads: boolean }): Promise<number | undefined> {
  let next: number | undefined;
  await db.driveJobs.each((job) => {
    if (setAside(job) || (!opts.uploads && job.kind === 'upload')) return;
    if (next === undefined || job.notBefore < next) next = job.notBefore;
  });
  return next;
}

export async function rescheduleJob(db: KiraMakanDb, id: string, patch: { attempts: number; notBefore: number; lastProblem: DriveJobProblem }): Promise<void> {
  await db.driveJobs.update(id, patch);
}

/** Set aside until the next app start. */
export async function setAsideJob(db: KiraMakanDb, id: string, nowMs: number, problem: DriveJobProblem): Promise<void> {
  await db.driveJobs.update(id, { failedAt: nowMs, lastProblem: problem });
}

/** At engine start: every set-aside job gets another try, due now. */
export function clearSetAside(db: KiraMakanDb, nowMs: number = Date.now()): Promise<void> {
  return db.transaction('rw', db.driveJobs, async () => {
    const jobs = (await db.driveJobs.toArray()).filter(setAside);
    if (jobs.length === 0) return;
    await db.driveJobs.bulkPut(
      jobs.map((job) => {
        const { failedAt: _failed, ...rest } = job;
        return { ...rest, notBefore: nowMs } as DriveJob;
      }),
    );
  });
}

/**
 * Try again and Continue: every job waiting on a backoff is due now. A deleted meal's trash delay
 * (a file job never tried yet) keeps its time, so Undo stays free; set-aside jobs wait for the
 * next start.
 */
export function releaseAll(db: KiraMakanDb, nowMs: number): Promise<void> {
  return db.transaction('rw', db.driveJobs, async () => {
    const waiting = (await db.driveJobs.where('notBefore').above(nowMs).toArray()).filter(
      (job) => !setAside(job) && (job.kind === 'upload' || job.attempts > 0),
    );
    if (waiting.length > 0) await db.driveJobs.bulkPut(waiting.map((job) => ({ ...job, notBefore: nowMs })));
  });
}

/** Uploads and file jobs still to run (set-aside ones not counted), and the set-aside uploads. */
export async function jobCounts(db: KiraMakanDb): Promise<{ uploads: number; files: number; failed: number }> {
  const counts = { uploads: 0, files: 0, failed: 0 };
  await db.driveJobs.each((job) => {
    if (setAside(job)) {
      if (job.kind === 'upload') counts.failed += 1;
    } else if (job.kind === 'upload') {
      counts.uploads += 1;
    } else {
      counts.files += 1;
    }
  });
  return counts;
}

/** Any meal here points at this file (a trash then waits: Undo, or an upload that found the same file). */
export async function isFileReferenced(db: KiraMakanDb, fileId: string): Promise<boolean> {
  return (await db.meals.filter((m) => drivePointerOf(m)?.fileId === fileId).first()) !== undefined;
}

/** The meal holding the job's photo: by its id, else any meal with that photo (an edit can move it). */
export async function findMealForJob(db: KiraMakanDb, job: DriveUploadJob): Promise<MealLog | undefined> {
  const meal = await db.meals.get(job.mealId);
  if (meal?.photoId === job.photoId) return meal;
  return db.meals.filter((m) => m.photoId === job.photoId).first();
}

/**
 * [meals, driveJobs, driveMeta]: writes the pointer (captured, so it syncs; `updatedAt` stays, it
 * isn't the user's edit), deletes the job, stamps lastUploadAt.
 * 'orphan': no meal holds the photo any more → a trash job for fileId is queued (60 s) instead.
 * 'duplicate': the meal already points at another file → our file is queued for trash.
 */
export function recordUpload(
  db: KiraMakanDb,
  job: DriveUploadJob,
  upload: { fileId: string; thumb?: string },
  nowMs: number = Date.now(),
): Promise<'saved' | 'orphan' | 'duplicate'> {
  return db.transaction('rw', [db.meals, db.driveJobs, db.driveMeta], async () => {
    await db.driveJobs.delete(job.id);
    const meal = await findMealForJob(db, job);
    if (!meal) {
      await queueTrashIn(db, upload.fileId, nowMs);
      return 'orphan';
    }
    const current = drivePointerOf(meal);
    if (current && current.fileId !== upload.fileId) {
      await queueTrashIn(db, upload.fileId, nowMs);
      return 'duplicate';
    }
    if (!current) {
      const pointer: MealPhotoDrive = { fileId: upload.fileId };
      if (isSyncThumb(upload.thumb)) pointer.thumb = upload.thumb;
      await db.meals.put({ ...meal, photoDrive: pointer });
    }
    const meta = await db.driveMeta.get('drive');
    if (meta) await db.driveMeta.put({ ...meta, lastUploadAt: nowMs });
    return 'saved';
  });
}
