/**
 * The Drive engine (decision §10.18): uploads each meal photo once to the user's Google Drive, moves
 * a deleted meal's photo to Drive's trash, and fetches a full photo on a tap, while the app is open
 * and online. Runs go one at a time per tab, inside the 'kira-makan-drive' Web Lock when the
 * browser has one, and the queue lives in Dexie (src/db/driveQueue.ts), so it survives restarts.
 *
 * - Gate, in order: configured → a real profile (not demo) → connected here → not stopped → a due
 *   job → online → a token. Nothing is ever asked of Google by the gate: Google's window opens only
 *   inside a tap (Connect, Continue, a photo, the photo sheet's Estimate), and the card says
 *   "Needs you" when the queue waits for one.
 * - A run takes due jobs one at a time (trash and restore first, then uploads newest first). An
 *   upload looks for the photo's file first (`kmPhoto`), so a retry never uploads twice, waits for
 *   sync to pull what other devices changed (`catchUp`), then writes the meal's pointer with a
 *   small thumbnail (a captured write: it syncs).
 * - Failures by kind: a refused token stops the run (Needs you); no connection waits for `online`;
 *   Drive busy or unreachable backs off (30 s up to every hour); a full Drive stops uploads until
 *   Try again; a request Drive refuses sets that job aside until the next start.
 * - Triggers: start (after 2 s), a queue change (1 s debounce), online, back to the app, a token,
 *   Try again, the backoff or trash-delay timer, and Keep photos or the connection turning on.
 * - Google's script: a load that failed is tried again by the next tap that needs it, coming
 *   online and coming back to the app; until then such a tap answers 'unavailable'.
 *
 * Everything outside the database comes in through DriveEngineDeps, so tests drive it with a fake
 * Drive, token source, timers and online state. src/drive/index.ts builds the app's engine.
 */
import { liveQuery } from 'dexie';
import type { KiraMakanDb } from '@/db/db';
import {
  clearSetAside,
  dueJobs,
  findMealForJob,
  forgetDriveConnection,
  isFileReferenced,
  jobCounts,
  nextDueAt,
  queueExistingPhotos,
  readDriveMeta,
  recordUpload,
  releaseAll,
  rememberFolder,
  rescheduleJob,
  saveDriveConnection,
  setAsideJob,
} from '@/db/driveQueue';
import type { DriveFileJob, DriveJob, DriveMeta, DriveUploadJob } from '@/db/driveTypes';
import { drivePointerOf, driveFileName, MAX_UPLOAD_BYTES, retryDelayMs } from '@/domain/photoSync';
import type { Id, Profile } from '@/domain/types';
import type { DocumentHost, EventHost, SyncLocks, SyncTimers } from '@/sync/engine';
import { DriveError, isDriveError, toDriveError, type DriveApi } from './api';
import { DriveAuthError, type DriveAuthProblem, type DriveToken, type DriveTokenRequest, type DriveTokenSource } from './gis';

export type DriveRunError = 'unreachable' | 'driveFull' | 'failed';

export interface DriveEngineState {
  configured: boolean;
  profile: 'loading' | 'none' | 'demo' | 'real';
  keepPhotos: boolean;
  /** driveMeta.connectedAt set */
  connected: boolean;
  email?: string;
  lastUploadAt?: number;
  gisReady: boolean;
  /**
   * The last load of Google's script failed (offline, blocked, the 15 s timeout): the next tap that
   * needs it, coming online or back to the app loads it again.
   */
  gisFailed?: boolean;
  /** Expiry of the token held in memory (never the token). */
  tokenExpiresAt?: number;
  /** Connect, Continue or a photo's token request is open. */
  authBusy: boolean;
  running: boolean;
  /** Uploads done of those due when the run started (shown from 2). */
  progress?: { done: number; total: number };
  error?: DriveRunError;
  /** 'unreachable': when the next try is due (ms). */
  retryAt?: number;
  online: boolean;
  counts: { uploads: number; files: number; failed: number };
}

export type DriveReason = 'start' | 'jobs' | 'online' | 'visible' | 'token' | 'retry' | 'timer' | 'settings';

export interface DriveEngineDeps {
  db: KiraMakanDb;
  api: DriveApi;
  tokens: DriveTokenSource;
  configured: () => boolean;
  /** makeSyncThumb (./thumb) */
  makeThumb: (source: Blob) => Promise<string | undefined>;
  /** For fetched photos (makeLocalThumb). */
  makeLocalThumb: (source: Blob) => Promise<Blob>;
  /**
   * Pulls what other devices changed (src/sync catchUpSync), awaited after each upload and before
   * its pointer is written: an edit or a delete made elsewhere lands here first, so the pointer goes
   * on top of the edit, or the file goes to the trash (§10.18 D19). Never rejects. None: no sync.
   */
  catchUp?: () => Promise<void>;
  /** Date.now */
  clock?: () => number;
  /** Math.random */
  random?: () => number;
  timers?: SyncTimers;
  /** navigator.locks when present; null runs without a lock. */
  locks?: SyncLocks | null;
  /** navigator.onLine */
  online?: () => boolean;
  win?: EventHost;
  doc?: DocumentHost;
}

export type ConnectResult = { ok: true; queued: number } | { ok: false; problem: DriveAuthProblem };
export type AuthResult = { ok: true } | { ok: false; problem: DriveAuthProblem };
export type FetchPhotoResult =
  | { ok: true }
  | { ok: false; problem: 'notInDrive' | 'notConnected' | 'offline' | 'notFound' | 'failed' | DriveAuthProblem };

export interface DriveEngine {
  /** Idempotent; inert when not configured. */
  start(): void;
  dispose(): Promise<void>;
  /** Aborts the run (AbortController) and waits; nothing runs until resume(). */
  stop(): Promise<void>;
  resume(): void;
  /** Loads GIS now (no-op when not configured, demo, or already loaded). */
  prepare(): void;
  request(reason: DriveReason): void;
  /** Call synchronously from the tap: the token request starts before any await. */
  connect(): Promise<ConnectResult>;
  continueFromTap(): Promise<AuthResult>;
  /** The photo sheet's Estimate tap: asks for a token only when it would be used; never throws, never tells. */
  renewOnTap(): void;
  disconnect(): Promise<void>;
  retry(): Promise<void>;
  /** A meal's full photo from Drive into `photos`; call synchronously from the tap. */
  fetchPhoto(mealId: Id): Promise<FetchPhotoResult>;
  forgetToken(): void;
  getState(): DriveEngineState;
  subscribe(listener: () => void): () => void;
}

export const STARTUP_DELAY_MS = 2_000;
export const JOBS_DEBOUNCE_MS = 1_000;
/** A token within a minute of its expiry counts as none. */
export const TOKEN_MARGIN_MS = 60_000;
export const LOCK_NAME = 'kira-makan-drive';
/** A timer never fires sooner than this after a run (a clock that moved can't spin it). */
const MIN_TIMER_MS = 1_000;

const noop = (): void => undefined;

const browserTimers: SyncTimers = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

function browserLocks(): SyncLocks | null {
  return typeof navigator !== 'undefined' && navigator.locks ? navigator.locks : null;
}

interface TimerSlot {
  set(ms: number, callback: () => void): void;
  clear(): void;
}

/** One timer at a time: setting it again replaces the one waiting. */
function timerSlot(timers: SyncTimers): TimerSlot {
  let handle: unknown;
  let armed = false;
  const clear = () => {
    if (armed) timers.clearTimeout(handle);
    armed = false;
  };
  return {
    set(ms, callback) {
      clear();
      armed = true;
      handle = timers.setTimeout(() => {
        armed = false;
        callback();
      }, ms);
    },
    clear,
  };
}

function sameState(a: DriveEngineState, b: DriveEngineState): boolean {
  return (
    a.configured === b.configured &&
    a.profile === b.profile &&
    a.keepPhotos === b.keepPhotos &&
    a.connected === b.connected &&
    a.email === b.email &&
    a.lastUploadAt === b.lastUploadAt &&
    a.gisReady === b.gisReady &&
    a.gisFailed === b.gisFailed &&
    a.tokenExpiresAt === b.tokenExpiresAt &&
    a.authBusy === b.authBusy &&
    a.running === b.running &&
    a.progress?.done === b.progress?.done &&
    a.progress?.total === b.progress?.total &&
    a.error === b.error &&
    a.retryAt === b.retryAt &&
    a.online === b.online &&
    a.counts.uploads === b.counts.uploads &&
    a.counts.files === b.counts.files &&
    a.counts.failed === b.counts.failed
  );
}

function sameEmail(a: string | undefined, b: string | undefined): boolean {
  return (a ?? '').toLowerCase() === (b ?? '').toLowerCase();
}

function abortedError(): DriveError {
  return new DriveError('aborted');
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortedError();
}

/** The promise, or 'aborted' as soon as the signal fires. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortedError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortedError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/** What a run does after a job fails. */
type AfterFailure = 'continue' | 'stop';

export function createDriveEngine(deps: DriveEngineDeps): DriveEngine {
  const { db, api, tokens } = deps;
  const catchUp = deps.catchUp ?? (() => Promise.resolve());
  const clock = deps.clock ?? (() => Date.now());
  const random = deps.random ?? Math.random;
  const timers = deps.timers ?? browserTimers;
  const locks = deps.locks === undefined ? browserLocks() : deps.locks;
  const online = deps.online ?? (() => typeof navigator === 'undefined' || navigator.onLine !== false);
  const win = deps.win ?? (typeof window === 'undefined' ? undefined : window);
  const doc = deps.doc ?? (typeof document === 'undefined' ? undefined : document);

  let state: DriveEngineState = {
    configured: deps.configured(),
    profile: 'loading',
    keepPhotos: true,
    connected: false,
    gisReady: tokens.ready(),
    authBusy: false,
    running: false,
    online: online(),
    counts: { uploads: 0, files: 0, failed: 0 },
  };
  const listeners = new Set<() => void>();

  let started = false;
  let disposed = false;
  let stopDepth = 0;
  /** The token, in memory only. */
  let token: DriveToken | null = null;
  /** Token requests open now (Connect, Continue, a photo, a renewal). */
  let authOpen = 0;
  /** prepare() was asked for: coming online loads GIS again if it failed. */
  let wantGis = false;
  let loadingGis: Promise<void> | null = null;
  let runPromise: Promise<void> | null = null;
  let rerun = false;
  let current: AbortController | null = null;
  /** Runs in a row that failed outside any job (a database error): the backoff step. */
  let runFailures = 0;
  /** Jobs in a row Drive couldn't take (busy or unreachable), so a long outage backs off as a whole. */
  let unreachableStreak = 0;

  const startSlot = timerSlot(timers);
  const jobsSlot = timerSlot(timers);
  const nextSlot = timerSlot(timers);
  const cleanups: (() => void)[] = [];

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------

  function setState(patch: Partial<DriveEngineState>): void {
    const next: DriveEngineState = { ...state, ...patch };
    for (const key of Object.keys(patch) as (keyof DriveEngineState)[]) {
      if (patch[key] === undefined) delete next[key];
    }
    if (sameState(state, next)) return;
    state = next;
    for (const listener of [...listeners]) listener();
  }

  function validToken(): DriveToken | null {
    return token && token.expiresAt - TOKEN_MARGIN_MS > clock() ? token : null;
  }

  function hold(next: DriveToken): void {
    token = next;
    setState({ tokenExpiresAt: next.expiresAt });
  }

  function forgetToken(): void {
    token = null;
    setState({ tokenExpiresAt: undefined });
  }

  function authStarted(): void {
    authOpen += 1;
    setState({ authBusy: true });
  }

  function authEnded(): void {
    authOpen = Math.max(0, authOpen - 1);
    if (authOpen === 0) setState({ authBusy: false });
  }

  // -------------------------------------------------------------------------
  // GIS
  // -------------------------------------------------------------------------

  function prepare(): void {
    if (disposed || !deps.configured() || state.profile === 'demo') return;
    wantGis = true;
    if (tokens.ready()) {
      setState({ gisReady: true, gisFailed: undefined });
      return;
    }
    if (loadingGis) return;
    setState({ gisFailed: undefined });
    loadingGis = tokens.load().then(
      () => {
        loadingGis = null;
        setState({ gisReady: tokens.ready(), gisFailed: undefined });
      },
      () => {
        // Offline, blocked or too slow: the next tap that needs it, coming online or back to the
        // app loads it again. Meanwhile a tap says Google couldn't be reached.
        loadingGis = null;
        setState({ gisReady: false, gisFailed: true });
      },
    );
  }

  /**
   * For a tap that needs Google's script: null when it's ready. Otherwise the tap loads it again
   * (for the next tap) and gets why it can't open Google's window now: 'unavailable' when the last
   * load failed, 'notReady' while one is still on its way.
   */
  function loadForTap(): 'notReady' | 'unavailable' | null {
    if (tokens.ready()) return null;
    const problem = state.gisFailed ? 'unavailable' : 'notReady';
    prepare();
    return problem;
  }

  // -------------------------------------------------------------------------
  // Runs
  // -------------------------------------------------------------------------

  async function withLock(signal: AbortSignal, work: () => Promise<void>): Promise<void> {
    if (!locks) {
      await work();
      return;
    }
    try {
      await locks.request(LOCK_NAME, { signal }, work);
    } catch (error) {
      // Still waiting for another tab when stopped: the lock request is what was aborted.
      if (signal.aborted && !(error instanceof DriveError)) throw abortedError();
      throw error;
    }
  }

  function schedule(): void {
    if (disposed || stopDepth > 0 || !deps.configured()) return;
    if (runPromise) {
      rerun = true;
      return;
    }
    runPromise = (async () => {
      try {
        do {
          rerun = false;
          await runOnce();
        } while (rerun && !disposed && stopDepth === 0);
      } finally {
        runPromise = null;
      }
    })();
  }

  async function runOnce(): Promise<void> {
    const controller = new AbortController();
    current = controller;
    try {
      await withLock(controller.signal, () => run(controller.signal));
      runFailures = 0;
    } catch (error) {
      if (controller.signal.aborted || isDriveError(error, 'aborted')) {
        setState({ running: false, progress: undefined });
        return;
      }
      // A database error or a bug outside any job: say so, and look again later.
      runFailures += 1;
      const wait = retryDelayMs(runFailures, random);
      nextSlot.set(wait, () => request('retry'));
      setState({ running: false, progress: undefined, error: 'failed', retryAt: clock() + wait });
    } finally {
      if (current === controller) current = null;
    }
  }

  /** Uploads may run: Keep photos on, and Drive not full. */
  function uploadsAllowed(profile: Profile): boolean {
    return profile.keepPhotos && state.error !== 'driveFull';
  }

  /** The gate's database half: a real profile and this device connected, or null. */
  async function readGate(): Promise<{ profile: Profile; meta: DriveMeta } | null> {
    if (!deps.configured()) return null;
    const profile = await db.profile.get('me');
    if (!profile || profile.demoMode) return null;
    const meta = await readDriveMeta(db);
    if (meta.connectedAt === undefined) return null;
    return { profile, meta };
  }

  async function run(signal: AbortSignal): Promise<void> {
    const gate = await readGate();
    if (!gate || stopDepth > 0) return;
    const first = await dueJobs(db, clock(), { uploads: uploadsAllowed(gate.profile) });
    if (first.length === 0) {
      await finish(gate.profile);
      return;
    }
    if (!online()) {
      setState({ online: false });
      return;
    }
    setState({ online: true });
    if (!validToken()) {
      // Needs you: the card's Continue (or the next photo tap) asks Google for a token.
      if (token) forgetToken();
      return;
    }

    const uploads = first.filter((job) => job.kind === 'upload').length;
    setState({ running: true, online: true, progress: uploads > 0 ? { done: 0, total: uploads } : undefined });
    let done = 0;
    for (;;) {
      throwIfAborted(signal);
      const latest = await readGate();
      if (!latest) break;
      const [job] = await dueJobs(db, clock(), { uploads: uploadsAllowed(latest.profile) });
      if (!job) {
        await finish(latest.profile);
        return;
      }
      const live = validToken();
      if (!live) {
        setState({ running: false, progress: undefined });
        return;
      }
      try {
        if (job.kind === 'file') {
          await runFileJob(job, live, signal);
        } else if (await runUpload(job, live, latest.meta, signal)) {
          done += 1;
          if (state.progress) setState({ progress: { done: Math.min(done, state.progress.total), total: state.progress.total } });
        }
        unreachableStreak = 0;
      } catch (error) {
        if ((await failed(job, error, signal)) === 'stop') {
          setState({ running: false, progress: undefined });
          return;
        }
      }
    }
    setState({ running: false, progress: undefined });
  }

  /**
   * No due job is left: clear the run, keep a full Drive's error (and a backoff still being waited
   * out), and wake up for the next delay or backoff.
   */
  async function finish(profile: Profile): Promise<void> {
    const backingOffNow = state.error === 'unreachable' && (state.retryAt ?? 0) > clock();
    if (!backingOffNow) unreachableStreak = 0;
    const next = await nextDueAt(db, { uploads: uploadsAllowed(profile) });
    if (next === undefined) nextSlot.clear();
    else nextSlot.set(Math.max(MIN_TIMER_MS, next - clock()), () => request('timer'));
    setState({
      running: false,
      progress: undefined,
      error: state.error === 'driveFull' ? 'driveFull' : backingOffNow ? 'unreachable' : undefined,
      retryAt: backingOffNow ? state.retryAt : undefined,
    });
  }

  /** Trash or restore one file. Gone, or not ours (forbidden), counts as done. */
  async function runFileJob(job: DriveFileJob, live: DriveToken, signal: AbortSignal): Promise<void> {
    if (job.trashed && (await isFileReferenced(db, job.fileId))) {
      // A meal points at it again (Undo, or an upload that found the same file).
      await db.driveJobs.delete(job.id);
      return;
    }
    try {
      await api.setTrashed(live.accessToken, job.fileId, job.trashed, signal);
    } catch (error) {
      if (!isDriveError(error, 'notFound') && !isDriveError(error, 'forbidden')) throw error;
    }
    await db.transaction('rw', [db.meals, db.driveJobs], async () => {
      const now = await db.driveJobs.get(job.id);
      if (now?.kind === 'file' && now.trashed === job.trashed && now.notBefore === job.notBefore) {
        await db.driveJobs.delete(job.id);
      } else if (!now && job.trashed && (await isFileReferenced(db, job.fileId))) {
        // Undone while the trash was on its way: bring the file back.
        await db.driveJobs.put({ ...job, trashed: false, attempts: 0, notBefore: clock(), createdAt: clock() });
      }
    });
  }

  /** The Kira Makan photos folder: the oldest one when two devices each made one, else a new one. */
  async function ensureFolder(live: DriveToken, signal: AbortSignal): Promise<string> {
    const folders = await api.findFolders(live.accessToken, signal);
    const oldest = [...folders].sort((a, b) => a.createdTime.localeCompare(b.createdTime) || a.id.localeCompare(b.id))[0];
    const id = oldest?.id ?? (await api.createFolder(live.accessToken, signal));
    throwIfAborted(signal);
    await rememberFolder(db, id);
    return id;
  }

  /** Uploads one photo (or finds it already there) and writes the pointer. True when a photo went up. */
  async function runUpload(job: DriveUploadJob, live: DriveToken, meta: DriveMeta, signal: AbortSignal): Promise<boolean> {
    const meal = await findMealForJob(db, job);
    const photo = meal ? await db.photos.get(job.photoId) : undefined;
    if (!meal || drivePointerOf(meal) || !photo) {
      // Nothing left to upload: the meal went, already points at a file, or the photo is gone.
      await db.driveJobs.delete(job.id);
      return false;
    }
    if (photo.blob.size > MAX_UPLOAD_BYTES) {
      await setAsideJob(db, job.id, clock(), 'tooBig');
      return false;
    }

    let fileId = await api.findPhoto(live.accessToken, job.photoId, signal);
    if (!fileId) {
      const input = (folderId: string) => ({
        folderId,
        photoId: job.photoId,
        mealId: meal.id,
        name: driveFileName(meal, photo.blob.type || 'image/jpeg'),
        blob: photo.blob,
      });
      const folderId = meta.folderId ?? (await ensureFolder(live, signal));
      try {
        fileId = await api.uploadPhoto(live.accessToken, input(folderId), signal);
      } catch (error) {
        if (!isDriveError(error, 'notFound')) throw error;
        // The folder was deleted in Drive: make it again, and try once more.
        await rememberFolder(db, undefined);
        fileId = await api.uploadPhoto(live.accessToken, input(await ensureFolder(live, signal)), signal);
      }
    }
    throwIfAborted(signal);
    const thumb = await deps.makeThumb(photo.thumb ?? photo.blob);
    // What other devices changed comes in first: the pointer is an ordinary meal write, and on a
    // copy this device hasn't caught up on, it would beat an edit or a delete made there since.
    // recordUpload re-reads the meal: a pulled edit gets the pointer, a pulled delete the trash.
    await untilAborted(catchUp().catch(noop), signal);
    throwIfAborted(signal);
    await recordUpload(db, job, thumb ? { fileId, thumb } : { fileId }, clock());
    return true;
  }

  /**
   * Backoff for a job Drive couldn't take now: the run stops, and everything waits for the timer
   * (the other jobs would only fail the same way). The step grows with the job's own tries and with
   * the streak of jobs in a row that failed so.
   */
  async function backOff(job: DriveJob): Promise<void> {
    const attempts = job.attempts + 1;
    unreachableStreak += 1;
    const notBefore = clock() + retryDelayMs(Math.max(attempts, unreachableStreak), random);
    await rescheduleJob(db, job.id, { attempts, notBefore, lastProblem: 'unreachable' });
    nextSlot.set(Math.max(MIN_TIMER_MS, notBefore - clock()), () => request('retry'));
    setState({ error: 'unreachable', retryAt: notBefore });
  }

  /** Waiting out a backoff: only the timer, coming online, a token or Try again look again sooner. */
  function backingOff(reason: DriveReason): boolean {
    return (reason === 'jobs' || reason === 'visible' || reason === 'start') && state.error === 'unreachable' && (state.retryAt ?? 0) > clock();
  }

  async function failed(job: DriveJob, error: unknown, signal: AbortSignal): Promise<AfterFailure> {
    if (signal.aborted) return 'stop';
    if (!(error instanceof DriveError)) {
      // A database error or a bug: this job waits for the next start, the rest carry on.
      await setAsideJob(db, job.id, clock(), 'failed');
      setState({ error: 'failed' });
      return 'continue';
    }
    switch (error.kind) {
      case 'aborted':
        return 'stop';
      case 'auth':
        // The token ran out or was revoked: Needs you, and the job stays as it is.
        forgetToken();
        return 'stop';
      case 'network':
        if (!online()) {
          setState({ online: false });
          return 'stop';
        }
        await backOff(job);
        return 'stop';
      case 'rateLimited':
      case 'unavailable':
        await backOff(job);
        return 'stop';
      case 'full':
        if (job.kind === 'upload') {
          setState({ error: 'driveFull' });
          return 'continue';
        }
        await backOff(job);
        return 'stop';
      case 'bad':
      case 'forbidden':
      case 'notFound':
        await setAsideJob(db, job.id, clock(), 'refused');
        return 'continue';
    }
  }

  function request(reason: DriveReason): void {
    if (disposed || backingOff(reason)) return;
    if (reason === 'jobs') {
      jobsSlot.set(JOBS_DEBOUNCE_MS, schedule);
      return;
    }
    schedule();
  }

  // -------------------------------------------------------------------------
  // Start-up and watching
  // -------------------------------------------------------------------------

  async function startup(): Promise<void> {
    const gate = await readGate();
    if (!gate || disposed) return;
    await clearSetAside(db, clock());
    prepare();
    await queueExistingPhotos(db, clock());
    request('start');
  }

  function listen(target: EventHost | undefined, type: string, listener: () => void): void {
    if (!target) return;
    target.addEventListener(type, listener);
    cleanups.push(() => target.removeEventListener(type, listener));
  }

  function watch<T>(query: () => Promise<T>, next: (value: T) => void): void {
    const subscription = liveQuery(query).subscribe({ next, error: noop });
    cleanups.push(() => subscription.unsubscribe());
  }

  /** Keep photos back on, or connected: photos already here go into the queue. */
  function queueAgain(): void {
    void queueExistingPhotos(db, clock())
      .catch(() => 0)
      .then(() => request('settings'));
  }

  // -------------------------------------------------------------------------
  // Token requests from a tap
  // -------------------------------------------------------------------------

  function authProblem(error: unknown): DriveAuthProblem {
    return error instanceof DriveAuthError ? error.problem : 'failed';
  }

  /**
   * Asks Google for a token as the connected account (prompt ''), synchronously. The answer is
   * checked against the stored account: another one is dropped ('otherAccount').
   */
  function askAgain(): Promise<DriveToken> {
    const req: DriveTokenRequest = state.email ? { prompt: '', loginHint: state.email } : { prompt: '' };
    const pending = tokens.request(req);
    return (async () => {
      const answer = await pending;
      const [meta, email] = await Promise.all([readDriveMeta(db), api.aboutEmail(answer.accessToken).catch(() => undefined)]);
      if (meta.email && email && !sameEmail(meta.email, email)) throw new DriveAuthError('otherAccount');
      return answer;
    })();
  }

  function refuse<P extends string>(problem: P): Promise<{ ok: false; problem: P }> {
    return Promise.resolve({ ok: false, problem });
  }

  async function stop(): Promise<void> {
    stopDepth += 1;
    current?.abort();
    await runPromise;
  }

  function resume(): void {
    if (stopDepth === 0) return;
    stopDepth -= 1;
    if (stopDepth === 0 && !disposed) schedule();
  }

  // -------------------------------------------------------------------------
  // The engine
  // -------------------------------------------------------------------------

  return {
    start() {
      if (started || disposed) return;
      started = true;
      const configured = deps.configured();
      setState({ configured });
      if (!configured) return;

      let knownKeep: boolean | undefined;
      let knownConnected: boolean | undefined;
      let knownCounts: string | undefined;

      watch(
        () => db.profile.get('me'),
        (profile) => {
          const keepPhotos = profile?.keepPhotos ?? true;
          setState({ profile: !profile ? 'none' : profile.demoMode ? 'demo' : 'real', keepPhotos });
          if (knownKeep === false && keepPhotos) queueAgain();
          knownKeep = keepPhotos;
        },
      );
      watch(
        () => readDriveMeta(db),
        (meta) => {
          const connected = meta.connectedAt !== undefined;
          setState({ connected, email: meta.email, lastUploadAt: meta.lastUploadAt });
          if (knownConnected === false && connected) queueAgain();
          knownConnected = connected;
        },
      );
      watch(
        () => jobCounts(db),
        (counts) => {
          setState({ counts });
          const key = `${counts.uploads}/${counts.files}/${counts.failed}`;
          if (knownCounts !== undefined && key !== knownCounts) request('jobs');
          knownCounts = key;
        },
      );

      listen(win, 'online', () => {
        setState({ online: true });
        if (wantGis && !tokens.ready()) prepare();
        request('online');
      });
      listen(win, 'offline', () => setState({ online: false }));
      listen(doc, 'visibilitychange', () => {
        if (doc?.visibilityState !== 'visible') return;
        // A load that failed while the app sat in the background gets another go.
        if (wantGis && !tokens.ready()) prepare();
        request('visible');
      });

      startSlot.set(STARTUP_DELAY_MS, () => {
        void startup().catch(noop);
      });
    },

    async dispose() {
      if (disposed) return;
      disposed = true;
      for (const cleanup of cleanups.splice(0)) cleanup();
      for (const slot of [startSlot, jobsSlot, nextSlot]) slot.clear();
      current?.abort();
      await runPromise;
    },

    stop,
    resume,

    prepare,
    request,

    connect() {
      if (!deps.configured() || state.profile === 'demo') return refuse('notReady');
      if (!online()) return refuse('offline');
      const notLoaded = loadForTap();
      if (notLoaded) return refuse(notLoaded);
      authStarted();
      // Synchronously, inside the tap: Chrome opens the window only then.
      const pending = tokens.request({ prompt: 'select_account' });
      return (async (): Promise<ConnectResult> => {
        try {
          const answer = await pending;
          const email = await api.aboutEmail(answer.accessToken).catch(() => undefined);
          await saveDriveConnection(db, email ? { connectedAt: clock(), email } : { connectedAt: clock() });
          hold(answer);
          setState({ connected: true, error: undefined, retryAt: undefined, ...(email ? { email } : {}) });
          const queued = await queueExistingPhotos(db, clock());
          request('token');
          return { ok: true, queued };
        } catch (error) {
          return { ok: false, problem: authProblem(error) };
        } finally {
          authEnded();
        }
      })();
    },

    continueFromTap() {
      if (!state.connected) return refuse('notReady');
      if (!online()) return refuse('offline');
      const notLoaded = loadForTap();
      if (notLoaded) return refuse(notLoaded);
      authStarted();
      const pending = askAgain();
      return (async (): Promise<AuthResult> => {
        try {
          hold(await pending);
          await releaseAll(db, clock());
          setState({ error: undefined, retryAt: undefined });
          request('token');
          return { ok: true };
        } catch (error) {
          return { ok: false, problem: authProblem(error) };
        } finally {
          authEnded();
        }
      })();
    },

    renewOnTap() {
      const wanted =
        deps.configured() &&
        state.profile === 'real' &&
        state.connected &&
        state.keepPhotos &&
        online() &&
        !validToken() &&
        !state.authBusy;
      // Google's script not here (or its last load failed): it loads now, for the next tap.
      if (!wanted || loadForTap()) return;
      authStarted();
      const pending = askAgain();
      void pending
        .then((answer) => {
          hold(answer);
          request('token');
        })
        .catch(noop)
        .finally(authEnded);
    },

    async disconnect() {
      await stop();
      try {
        forgetToken();
        await forgetDriveConnection(db);
        nextSlot.clear();
        setState({ connected: false, error: undefined, retryAt: undefined, running: false, progress: undefined });
      } finally {
        resume();
      }
    },

    async retry() {
      runFailures = 0;
      await releaseAll(db, clock());
      setState({ error: undefined, retryAt: undefined });
      request('retry');
    },

    fetchPhoto(mealId) {
      if (!deps.configured() || state.profile === 'demo') return refuse('notConnected');
      const needsToken = state.connected && online() && !validToken();
      // Google's script isn't here (its last load failed, or it's slow): this tap loads it again.
      const notLoaded = needsToken ? loadForTap() : null;
      // Synchronously, inside the tap, when a token will be needed.
      const pending = needsToken && !notLoaded ? askAgain() : null;
      if (pending) {
        authStarted();
        // Whatever this tap ends with, a token it got is kept for the queue.
        pending.then(hold, noop);
      }
      return (async (): Promise<FetchPhotoResult> => {
        try {
          const meal = await db.meals.get(mealId);
          const pointer = meal ? drivePointerOf(meal) : undefined;
          if (!meal?.photoId || !pointer) return { ok: false, problem: 'notInDrive' };
          if (await db.photos.get(meal.photoId)) return { ok: true };
          const profile = await db.profile.get('me');
          if (!profile || profile.demoMode) return { ok: false, problem: 'notConnected' };
          if ((await readDriveMeta(db)).connectedAt === undefined) return { ok: false, problem: 'notConnected' };
          if (!online()) return { ok: false, problem: 'offline' };
          let live = validToken();
          if (!live) {
            if (!pending) return { ok: false, problem: notLoaded ?? (tokens.ready() ? 'failed' : 'notReady') };
            live = await pending;
            // The queue may have been waiting for a token too.
            request('token');
          }
          const blob = await api.download(live.accessToken, pointer.fileId);
          const thumb = await deps.makeLocalThumb(blob);
          const photoId = meal.photoId;
          await db.transaction('rw', [db.meals, db.photos], async () => {
            const now = await db.meals.get(mealId);
            if (now?.photoId !== photoId || (await db.photos.get(photoId))) return;
            await db.photos.put({ id: photoId, blob, thumb, createdAt: new Date(clock()).toISOString() });
          });
          return { ok: true };
        } catch (error) {
          if (error instanceof DriveAuthError) return { ok: false, problem: error.problem };
          const failure = toDriveError(error);
          switch (failure.kind) {
            case 'notFound':
            case 'forbidden':
              return { ok: false, problem: 'notFound' };
            case 'auth':
              // The next tap asks Google again.
              forgetToken();
              return { ok: false, problem: 'failed' };
            case 'network':
              return { ok: false, problem: online() ? 'failed' : 'offline' };
            default:
              return { ok: false, problem: 'failed' };
          }
        } finally {
          if (pending) authEnded();
        }
      })();
    },

    forgetToken,

    getState: () => state,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
