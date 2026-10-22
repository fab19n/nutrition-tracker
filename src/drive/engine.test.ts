// @vitest-environment node
/*
 * The Drive engine against the fake Drive (./testing/fakeDrive) and the fake token source
 * (./testing/fakeGis), with injected timers, locks, online state, window and document. Global fake
 * timers are never used, since fake-indexeddb runs on real ones: an injected 0 ms timer fires on a
 * real macrotask, longer ones only when a test moves the clock with `advance`. `settle` waits until
 * no run holds the lock, no 0 ms timer waits and nothing has happened for a while.
 */
import { createActions } from '@/db/actions';
import { createDb, type KiraMakanDb } from '@/db/db';
import { fileJobId, queueTrashIn, readDriveMeta, TRASH_DELAY_MS, uploadJobId } from '@/db/driveQueue';
import type { DriveJob } from '@/db/driveTypes';
import { setDemoClock } from '@/domain/clock';
import { SYNC_THUMB_PREFIX } from '@/domain/photoSync';
import type { MealLog, Profile } from '@/domain/types';
import type { DocumentHost, SyncLocks, SyncTimers } from '@/sync/engine';
import { ackPush, applyPage, applyRestore, collectPush, linkEmptyAccount, readMeta, recordSuccess } from '@/sync/local';
import type { RemoteCtx, SyncRemote, WireRow } from '@/sync/remote';
import { createFakeServer, type FakeServer } from '@/sync/testing/fakeServer';
import { createDriveApi } from './api';
import { createDriveEngine, type DriveEngine } from './engine';
import type { DriveToken } from './gis';
import { drivePhase } from './status';
import { createFakeDrive, type FakeDrive, type FakeDriveCall } from './testing/fakeDrive';
import { createFakeTokens, type FakeTokens } from './testing/fakeGis';

const { setImmediate: nextTurn } = globalThis as typeof globalThis & { setImmediate: (callback: () => void) => unknown };

const CLIENT_ID = '123-abc.apps.googleusercontent.com';
const START = Date.parse('2026-10-16T11:10:00.000Z');
const HOUR = 3_600_000;
const THUMB = `${SYNC_THUMB_PREFIX}/9j/4AAQ`;
const EMAIL = 'you@example.com';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

class FakeTimers implements SyncTimers {
  now: number;
  private readonly pending = new Map<number, { at: number; callback: () => void }>();
  private readonly zero = new Set<number>();
  private seq = 0;

  constructor(start: number) {
    this.now = start;
  }

  readonly clock = (): number => this.now;

  setTimeout(callback: () => void, ms: number): number {
    this.seq += 1;
    const id = this.seq;
    this.pending.set(id, { at: this.now + ms, callback });
    if (ms <= 0) {
      this.zero.add(id);
      nextTurn(() => this.fire(id));
    }
    return id;
  }

  clearTimeout(handle: unknown): void {
    if (typeof handle !== 'number') return;
    this.pending.delete(handle);
    this.zero.delete(handle);
  }

  zeroPending(): boolean {
    return this.zero.size > 0;
  }

  /** Moves the clock by `ms`, firing each timer due on the way at its own time. */
  async advance(ms: number): Promise<void> {
    const end = this.now + ms;
    await settle();
    while (this.fireNext(end)) await settle();
    this.now = end;
    await settle();
  }

  private fireNext(end: number): boolean {
    let next: [number, { at: number }] | undefined;
    for (const entry of this.pending) {
      if (entry[1].at <= end && (!next || entry[1].at < next[1].at)) next = entry;
    }
    if (!next) return false;
    this.now = Math.max(this.now, next[1].at);
    this.fire(next[0]);
    return true;
  }

  private fire(id: number): void {
    const timer = this.pending.get(id);
    this.pending.delete(id);
    this.zero.delete(id);
    timer?.callback();
  }
}

/** Web Locks for one origin, and whether a run holds it. */
class FakeLocks implements SyncLocks {
  private active = 0;

  busy(): boolean {
    return this.active > 0;
  }

  async request(_name: string, _options: { signal?: AbortSignal }, callback: () => Promise<void>): Promise<unknown> {
    this.active += 1;
    try {
      return await callback();
    } finally {
      this.active -= 1;
    }
  }
}

class FakeDocument extends EventTarget implements DocumentHost {
  visibilityState: DocumentVisibilityState = 'visible';
}

interface Device {
  db: KiraMakanDb;
  engine: DriveEngine;
  win: EventTarget;
  doc: FakeDocument;
  flags: { online: boolean; configured: boolean };
}

let timers: FakeTimers;
let locks: FakeLocks;
let drive: FakeDrive;
let tokens: FakeTokens;
let dbs: KiraMakanDb[];
let engines: DriveEngine[];
/** Bumped by every Drive call and engine state change: settle waits for it to stand still. */
let activity: number;

beforeEach(() => {
  vi.stubEnv('VITE_GOOGLE_CLIENT_ID', CLIENT_ID);
  timers = new FakeTimers(START);
  locks = new FakeLocks();
  drive = createFakeDrive({ clock: timers.clock, email: EMAIL });
  tokens = createFakeTokens();
  dbs = [];
  engines = [];
  activity = 0;
});

afterEach(async () => {
  await Promise.all(engines.map((engine) => engine.dispose()));
  await Promise.all(dbs.map((db) => db.delete()));
  vi.unstubAllEnvs();
  setDemoClock(false);
});

/** Turns of the event loop until 60 in a row pass with no run holding the lock and nothing new. */
async function quietTurns(): Promise<void> {
  let quiet = 0;
  let seen = activity;
  for (let i = 0; i < 100_000 && quiet < 60; i += 1) {
    await new Promise<void>((resolve) => nextTurn(resolve));
    const busy = locks.busy() || timers.zeroPending() || seen !== activity;
    seen = activity;
    quiet = busy ? 0 : quiet + 1;
  }
}

/**
 * Lets everything in flight finish: quiet turns, a real timer (Dexie starts a live query on one),
 * and quiet turns again, until a whole round passes with nothing happening.
 */
async function settle(): Promise<void> {
  for (let round = 0; round < 200; round += 1) {
    const start = activity;
    await quietTurns();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await quietTurns();
    if (start === activity && !locks.busy() && !timers.zeroPending()) return;
  }
  throw new Error('The engine never settled');
}

function device(options: { db?: KiraMakanDb; configured?: boolean; catchUp?: () => Promise<void> } = {}): Device {
  const db = options.db ?? createDb(`drive-engine-${crypto.randomUUID()}`);
  if (!options.db) dbs.push(db);
  const win = new EventTarget();
  const doc = new FakeDocument();
  const flags = { online: true, configured: options.configured ?? true };
  const fetch: typeof globalThis.fetch = async (input, init) => {
    activity += 1;
    return drive.fetch(input, init);
  };
  const engine = createDriveEngine({
    db,
    api: createDriveApi(fetch),
    tokens,
    configured: () => flags.configured,
    makeThumb: async () => THUMB,
    makeLocalThumb: async () => new Blob(['local-thumb'], { type: 'image/jpeg' }),
    ...(options.catchUp ? { catchUp: options.catchUp } : {}),
    clock: timers.clock,
    random: () => 0.5,
    timers,
    locks,
    online: () => flags.online,
    win,
    doc,
  });
  engine.subscribe(() => {
    activity += 1;
  });
  engines.push(engine);
  return { db, engine, win, doc, flags };
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const profile = (patch: Partial<Profile> = {}): Profile => ({
  id: 'me',
  age: 34,
  sex: 'male',
  heightCm: 172,
  weightKgAtSetup: 78.6,
  activity: 'light',
  timeZone: 'Asia/Kuala_Lumpur',
  rolloverHour: 5,
  weekStartsOn: 1,
  dailyMinimumKcal: 1400,
  theme: 'system',
  keepPhotos: true,
  useLocation: false,
  startedOn: '2026-10-01',
  setupCompletedAt: '2026-10-01T01:00:00.000Z',
  demoMode: false,
  ...patch,
});

function meal(id: string, extra: Partial<MealLog> = {}): MealLog {
  return {
    id,
    eatenAt: '2026-10-16T12:30:00.000Z',
    logicalDay: '2026-10-16',
    slot: 'dinner',
    name: 'Nasi kandar ayam goreng',
    items: [],
    method: 'photo',
    finished: 'all',
    createdAt: '2026-10-16T12:31:00.000Z',
    updatedAt: '2026-10-16T12:31:00.000Z',
    syncState: 'local',
    ...extra,
  };
}

function token(hours = 1): DriveToken {
  return { accessToken: 'token-1', expiresAt: timers.now + hours * HOUR };
}

/** A real profile, connected unless said otherwise. */
async function setUp(db: KiraMakanDb, options: { connected?: boolean; keepPhotos?: boolean; demo?: boolean } = {}): Promise<void> {
  await db.profile.put(profile({ keepPhotos: options.keepPhotos ?? true, demoMode: options.demo ?? false }));
  if (options.connected ?? true) await db.driveMeta.put({ id: 'drive', connectedAt: START - HOUR, email: EMAIL });
}

/** A meal with a stored photo, and (by default) its upload job. */
async function photoMeal(db: KiraMakanDb, id: string, options: { bytes?: BlobPart; queued?: boolean; createdAt?: number } = {}): Promise<MealLog> {
  const photoId = `photo-${id}`;
  const row = meal(id, { photoId });
  await db.meals.put(row);
  await db.photos.put({
    id: photoId,
    blob: new Blob([options.bytes ?? `bytes-${id}`], { type: 'image/jpeg' }),
    thumb: new Blob([`thumb-${id}`], { type: 'image/jpeg' }),
    createdAt: row.createdAt,
  });
  if (options.queued ?? true) {
    const at = options.createdAt ?? timers.now;
    await db.driveJobs.put({ id: uploadJobId(photoId), kind: 'upload', photoId, mealId: id, createdAt: at, notBefore: timers.now, attempts: 0 });
  }
  return row;
}

/** Holds a token, as Continue does. */
async function giveToken(d: Device, hours = 1): Promise<void> {
  tokens.next(token(hours));
  expect(await tokens.tap(() => d.engine.continueFromTap())).toEqual({ ok: true });
  await settle();
}

const phase = (d: Device) => drivePhase(d.engine.getState(), timers.now);
const uploads = (): FakeDriveCall[] => drive.calls.filter((c) => c.method === 'POST' && c.path === '/upload/drive/v3/files');
const patches = (): FakeDriveCall[] => drive.calls.filter((c) => c.method === 'PATCH');

async function job(db: KiraMakanDb, id: string): Promise<DriveJob | undefined> {
  return db.driveJobs.get(id);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('when it does nothing', () => {
  it('is inert without a client id: no watching, no calls', async () => {
    const d = device({ configured: false });
    await setUp(d.db);
    await photoMeal(d.db, 'm1');
    d.engine.start();
    await timers.advance(10_000);
    expect(d.engine.getState()).toMatchObject({ configured: false, profile: 'loading', connected: false });
    expect(phase(d)).toBe('unconfigured');
    expect(await d.engine.connect()).toEqual({ ok: false, problem: 'notReady' });
    d.engine.request('jobs');
    await timers.advance(2_000);
    expect(drive.calls).toEqual([]);
    expect(tokens.loadCalls).toBe(0);
  });

  it('stays out of demo mode: no call, no Connect', async () => {
    const d = device();
    await setUp(d.db, { demo: true });
    await photoMeal(d.db, 'm1');
    d.engine.start();
    await timers.advance(3_000);
    expect(phase(d)).toBe('demo');
    expect(await tokens.tap(() => d.engine.connect())).toEqual({ ok: false, problem: 'notReady' });
    d.engine.prepare();
    d.engine.request('retry');
    await settle();
    expect(drive.calls).toEqual([]);
    expect(tokens.requests).toEqual([]);
    expect(tokens.loadCalls).toBe(0);
  });

  it('calls nothing while this device is not connected', async () => {
    const d = device();
    await setUp(d.db, { connected: false });
    await photoMeal(d.db, 'm1');
    d.engine.start();
    await timers.advance(3_000);
    d.engine.request('jobs');
    await timers.advance(2_000);
    expect(phase(d)).toBe('disconnected');
    expect(drive.calls).toEqual([]);
    expect(tokens.loadCalls).toBe(0);
  });
});

describe('connect and upload', () => {
  it('asks for an account inside the tap, stores the email, and uploads what is here', async () => {
    const d = device();
    await setUp(d.db, { connected: false });
    const row = await photoMeal(d.db, 'm1', { queued: false });
    d.engine.start();
    await settle();

    tokens.next(token());
    const result = await tokens.tap(() => d.engine.connect());
    expect(tokens.requests).toEqual([{ prompt: 'select_account', inTap: true }]);
    expect(result).toEqual({ ok: true, queued: 1 });
    await settle();

    const meta = await readDriveMeta(d.db);
    expect(meta).toMatchObject({ connectedAt: START, email: EMAIL, lastUploadAt: START });
    expect(drive.folders()).toHaveLength(1);
    const folder = drive.folders()[0];
    expect(meta.folderId).toBe(folder?.id);
    const [file] = drive.photos();
    expect(file).toMatchObject({
      name: '2026-10-16 Dinner - Nasi kandar ayam goreng.jpg',
      mimeType: 'image/jpeg',
      parents: [folder?.id],
      appProperties: { kmPhoto: 'photo-m1', kmMeal: 'm1' },
    });
    expect(new TextDecoder().decode(file?.bytes)).toBe('bytes-m1');
    expect((await d.db.meals.get('m1'))?.photoDrive).toEqual({ fileId: file?.id, thumb: THUMB });
    expect((await d.db.meals.get('m1'))?.updatedAt).toBe(row.updatedAt);
    expect(await d.db.driveJobs.count()).toBe(0);
    expect(phase(d)).toBe('idle');
  });

  it('says why a connect failed, and stores nothing', async () => {
    const d = device();
    await setUp(d.db, { connected: false });
    d.engine.start();
    await settle();
    tokens.next('popupBlocked');
    expect(await tokens.tap(() => d.engine.connect())).toEqual({ ok: false, problem: 'popupBlocked' });
    tokens.next('scopeDenied');
    expect(await tokens.tap(() => d.engine.connect())).toEqual({ ok: false, problem: 'scopeDenied' });
    expect(await d.db.driveMeta.count()).toBe(0);

    d.flags.online = false;
    expect(await d.engine.connect()).toEqual({ ok: false, problem: 'offline' });
    tokens.isReady = false;
    d.flags.online = true;
    expect(await d.engine.connect()).toEqual({ ok: false, problem: 'notReady' });
    expect(tokens.requests).toHaveLength(2);
  });

  it('reuses the cached folder on later runs', async () => {
    const d = device();
    await setUp(d.db);
    await photoMeal(d.db, 'm1');
    d.engine.start();
    await settle();
    await giveToken(d);
    await photoMeal(d.db, 'm2');
    d.engine.request('jobs');
    await timers.advance(1_000);

    expect(drive.photos()).toHaveLength(2);
    expect(drive.calls.filter((c) => c.method === 'GET' && c.query.pageSize === '10')).toHaveLength(1);
    expect(drive.calls.filter((c) => c.method === 'POST' && c.path === '/drive/v3/files')).toHaveLength(1);
    const folderId = (await readDriveMeta(d.db)).folderId;
    expect(drive.photos().every((f) => f.parents[0] === folderId)).toBe(true);
  });

  it('uses the oldest of two folders', async () => {
    const d = device();
    await setUp(d.db);
    drive.addFolder('2026-10-10T00:00:00.000Z');
    const oldest = drive.addFolder('2026-10-01T00:00:00.000Z');
    await photoMeal(d.db, 'm1');
    d.engine.start();
    await settle();
    await giveToken(d);
    expect(drive.photos()[0]?.parents).toEqual([oldest.id]);
    expect((await readDriveMeta(d.db)).folderId).toBe(oldest.id);
    expect(drive.folders()).toHaveLength(2);
  });

  it('makes the folder again when it was deleted, and uploads once more', async () => {
    const d = device();
    await setUp(d.db);
    await d.db.driveMeta.update('drive', { folderId: 'deleted-folder-0001' });
    await photoMeal(d.db, 'm1');
    d.engine.start();
    await settle();
    await giveToken(d);
    expect(uploads()).toHaveLength(2);
    expect(drive.folders()).toHaveLength(1);
    expect((await readDriveMeta(d.db)).folderId).toBe(drive.folders()[0]?.id);
    expect((await d.db.meals.get('m1'))?.photoDrive?.fileId).toBe(drive.photos()[0]?.id);
  });

  it('never uploads a photo twice: a file already in Drive is reused', async () => {
    const d = device();
    await setUp(d.db);
    const folder = drive.addFolder('2026-10-01T00:00:00.000Z');
    drive.files.set('existing-file-01', {
      id: 'existing-file-01',
      name: 'a.jpg',
      mimeType: 'image/jpeg',
      parents: [folder.id],
      appProperties: { kmPhoto: 'photo-m1', kmMeal: 'm1' },
      trashed: false,
      createdTime: '2026-10-16T00:00:00.000Z',
    });
    await photoMeal(d.db, 'm1');
    d.engine.start();
    await settle();
    await giveToken(d);
    expect(uploads()).toHaveLength(0);
    expect((await d.db.meals.get('m1'))?.photoDrive).toEqual({ fileId: 'existing-file-01', thumb: THUMB });
  });
});

describe('what stops uploads', () => {
  it('Keep photos off: no uploads, file jobs still run; back on, uploads resume', async () => {
    const d = device();
    await setUp(d.db, { keepPhotos: false });
    await photoMeal(d.db, 'm1');
    drive.files.set('old-file-00001', { id: 'old-file-00001', name: 'x', mimeType: 'image/jpeg', parents: [], appProperties: {}, trashed: false, createdTime: '' });
    await d.db.transaction('rw', d.db.driveJobs, () => queueTrashIn(d.db, 'old-file-00001', timers.now, 0));
    d.engine.start();
    await settle();
    await giveToken(d);

    expect(patches()).toHaveLength(1);
    expect(drive.files.get('old-file-00001')?.trashed).toBe(true);
    expect(uploads()).toHaveLength(0);
    expect(phase(d)).toBe('keepOff');

    await d.db.profile.update('me', { keepPhotos: true });
    await settle();
    expect(uploads()).toHaveLength(1);
    expect(phase(d)).toBe('idle');
  });

  it('offline: no calls until the online event', async () => {
    const d = device();
    await setUp(d.db);
    await photoMeal(d.db, 'm1');
    d.engine.start();
    await settle();
    await giveToken(d);
    expect(uploads()).toHaveLength(1);

    d.flags.online = false;
    d.win.dispatchEvent(new Event('offline'));
    await photoMeal(d.db, 'm2');
    d.engine.request('jobs');
    await timers.advance(2_000);
    expect(uploads()).toHaveLength(1);
    expect(phase(d)).toBe('offline');

    d.flags.online = true;
    d.win.dispatchEvent(new Event('online'));
    await settle();
    expect(uploads()).toHaveLength(2);
    expect(phase(d)).toBe('idle');
  });

  it('no token: Needs you and no window; Continue asks as the connected account', async () => {
    const d = device();
    await setUp(d.db);
    await photoMeal(d.db, 'm1');
    d.engine.start();
    await timers.advance(3_000);
    expect(drive.calls).toEqual([]);
    expect(tokens.requests).toEqual([]);
    expect(phase(d)).toBe('needsTap');

    tokens.next(token());
    expect(await tokens.tap(() => d.engine.continueFromTap())).toEqual({ ok: true });
    expect(tokens.requests).toEqual([{ prompt: '', loginHint: EMAIL, inTap: true }]);
    await settle();
    expect(uploads()).toHaveLength(1);
    expect(phase(d)).toBe('idle');
  });

  it('Continue as another Google account drops the token', async () => {
    const d = device();
    await setUp(d.db);
    await photoMeal(d.db, 'm1');
    d.engine.start();
    await settle();
    drive.email = 'someone@example.com';
    tokens.next(token());
    expect(await tokens.tap(() => d.engine.continueFromTap())).toEqual({ ok: false, problem: 'otherAccount' });
    await settle();
    expect(d.engine.getState().tokenExpiresAt).toBeUndefined();
    expect(uploads()).toHaveLength(0);
    expect(phase(d)).toBe('needsTap');
  });

  it('a token that runs out mid-run: forgotten, Needs you, the job as it was', async () => {
    const d = device();
    await setUp(d.db);
    await photoMeal(d.db, 'm1');
    d.engine.start();
    await settle();
    drive.fail({ method: 'POST', path: /^\/upload\// }, { status: 401, reason: 'authError' });
    await giveToken(d);
    expect(d.engine.getState().tokenExpiresAt).toBeUndefined();
    expect(phase(d)).toBe('needsTap');
    expect(await job(d.db, uploadJobId('photo-m1'))).toMatchObject({ attempts: 0, notBefore: START });
  });

  it('a token about to run out counts as none', async () => {
    const d = device();
    await setUp(d.db);
    await photoMeal(d.db, 'm1', { queued: false });
    d.engine.start();
    await settle();
    await giveToken(d);
    expect(phase(d)).toBe('idle');
    await timers.advance(HOUR - 61_000);
    await photoMeal(d.db, 'm2');
    await timers.advance(1_000);
    expect(phase(d)).toBe('needsTap');
    expect(uploads()).toHaveLength(1);
  });
});

describe('failures', () => {
  it('Drive unavailable backs off 30 s, says so, and the timer tries again', async () => {
    const d = device();
    await setUp(d.db);
    await photoMeal(d.db, 'm1');
    d.engine.start();
    await settle();
    drive.fail({ method: 'POST', path: /^\/upload\// }, { status: 503, reason: 'backendError' });
    await giveToken(d);

    const now = timers.now;
    expect(await job(d.db, uploadJobId('photo-m1'))).toMatchObject({ attempts: 1, notBefore: now + 30_000, lastProblem: 'unreachable' });
    expect(d.engine.getState()).toMatchObject({ error: 'unreachable', retryAt: now + 30_000 });
    expect(phase(d)).toBe('error');

    // Waiting out the backoff: coming online again looks, finds nothing due yet, and keeps saying so.
    d.win.dispatchEvent(new Event('online'));
    await settle();
    expect(uploads()).toHaveLength(1);
    expect(d.engine.getState()).toMatchObject({ error: 'unreachable', retryAt: now + 30_000 });

    await timers.advance(30_000);
    expect(uploads()).toHaveLength(2);
    expect((await d.db.meals.get('m1'))?.photoDrive?.fileId).toBe(drive.photos()[0]?.id);
    expect(d.engine.getState().error).toBeUndefined();
    expect(phase(d)).toBe('idle');
  });

  it('a full Drive stops uploads but not the trash, until Try again', async () => {
    const d = device();
    await setUp(d.db);
    await photoMeal(d.db, 'm1');
    d.engine.start();
    await settle();
    drive.fail({ method: 'POST', path: /^\/upload\// }, { status: 403, reason: 'storageQuotaExceeded' });
    await giveToken(d);
    expect(d.engine.getState().error).toBe('driveFull');
    expect(phase(d)).toBe('error');
    expect(uploads()).toHaveLength(1);

    drive.files.set('old-file-00001', { id: 'old-file-00001', name: 'x', mimeType: 'image/jpeg', parents: [], appProperties: {}, trashed: false, createdTime: '' });
    await d.db.transaction('rw', d.db.driveJobs, () => queueTrashIn(d.db, 'old-file-00001', timers.now, 0));
    d.engine.request('jobs');
    await timers.advance(1_000);
    expect(patches()).toHaveLength(1);
    expect(uploads()).toHaveLength(1);
    expect(d.engine.getState().error).toBe('driveFull');

    await d.engine.retry();
    await settle();
    expect(uploads()).toHaveLength(2);
    expect(d.engine.getState().error).toBeUndefined();
  });

  it('a request Drive refuses is set aside until the next start', async () => {
    const d = device();
    await setUp(d.db);
    await photoMeal(d.db, 'm1');
    d.engine.start();
    await settle();
    drive.fail({ method: 'POST', path: /^\/upload\// }, { status: 400, reason: 'badRequest' });
    await giveToken(d);
    expect(await job(d.db, uploadJobId('photo-m1'))).toMatchObject({ failedAt: timers.now, lastProblem: 'refused' });
    expect(d.engine.getState().counts).toEqual({ uploads: 0, files: 0, failed: 1 });
    expect(phase(d)).toBe('idle');

    await d.engine.dispose();
    const again = device({ db: d.db });
    again.engine.start();
    await settle();
    await giveToken(again);
    await timers.advance(2_000);
    expect(uploads()).toHaveLength(2);
    expect(await d.db.driveJobs.count()).toBe(0);
  });

  it('a photo over 5 MB is set aside without a request', async () => {
    const d = device();
    await setUp(d.db);
    await photoMeal(d.db, 'm1', { bytes: new Uint8Array(6 * 1024 * 1024) });
    d.engine.start();
    await settle();
    await giveToken(d);
    expect(drive.calls.filter((c) => c.path !== '/drive/v3/about')).toEqual([]);
    expect(await job(d.db, uploadJobId('photo-m1'))).toMatchObject({ lastProblem: 'tooBig' });
    expect(d.engine.getState().counts.failed).toBe(1);
  });
});

describe('trash and restore', () => {
  const FILE = 'drive-file-0001';

  beforeEach(() => {
    drive.files.set(FILE, { id: FILE, name: 'x.jpg', mimeType: 'image/jpeg', parents: [], appProperties: { kmPhoto: 'p' }, trashed: false, createdTime: '' });
  });

  it('trashes a deleted meal\'s file a minute later, not before', async () => {
    const d = device();
    await setUp(d.db);
    d.engine.start();
    await settle();
    await giveToken(d);
    await d.db.transaction('rw', d.db.driveJobs, () => queueTrashIn(d.db, FILE, timers.now));
    d.engine.request('jobs');
    await timers.advance(TRASH_DELAY_MS - 5_000);
    expect(patches()).toHaveLength(0);
    expect(drive.files.get(FILE)?.trashed).toBe(false);

    await timers.advance(5_000);
    expect(patches()).toHaveLength(1);
    expect(drive.files.get(FILE)?.trashed).toBe(true);
    expect(await d.db.driveJobs.count()).toBe(0);
  });

  it('drops a trash without a call when a meal points at the file again', async () => {
    const d = device();
    await setUp(d.db);
    await d.db.meals.put(meal('m1', { photoId: 'p', photoDrive: { fileId: FILE } }));
    await d.db.transaction('rw', d.db.driveJobs, () => queueTrashIn(d.db, FILE, timers.now, 0));
    d.engine.start();
    await settle();
    await giveToken(d);
    expect(patches()).toHaveLength(0);
    expect(await d.db.driveJobs.count()).toBe(0);
  });

  it('a file that is gone counts as trashed; a restore untrashes', async () => {
    const d = device();
    await setUp(d.db);
    await d.db.driveJobs.bulkPut([
      { id: fileJobId('gone-file-00001'), kind: 'file', fileId: 'gone-file-00001', trashed: true, createdAt: timers.now, notBefore: timers.now, attempts: 0 },
      { id: fileJobId(FILE), kind: 'file', fileId: FILE, trashed: false, createdAt: timers.now, notBefore: timers.now, attempts: 0 },
    ]);
    drive.files.get(FILE)!.trashed = true;
    d.engine.start();
    await settle();
    await giveToken(d);
    expect(patches()).toHaveLength(2);
    expect(drive.files.get(FILE)?.trashed).toBe(false);
    expect(await d.db.driveJobs.count()).toBe(0);
  });

  it('a meal deleted while its photo uploads: the new file goes to the trash', async () => {
    const d = device();
    await setUp(d.db);
    await photoMeal(d.db, 'm1');
    d.engine.start();
    await settle();

    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    drive.onCall = (call) => (call.method === 'POST' && call.path.startsWith('/upload/') ? held : undefined);
    tokens.next(token());
    const continued = tokens.tap(() => d.engine.continueFromTap());
    await continued;
    for (let i = 0; i < 200 && uploads().length === 0; i += 1) await new Promise<void>((resolve) => nextTurn(resolve));
    expect(uploads()).toHaveLength(1);

    await createActions(d.db).deleteMeal('m1');
    drive.onCall = undefined;
    release();
    await settle();

    const file = drive.photos().find((f) => f.appProperties.kmPhoto === 'photo-m1');
    expect(file).toBeDefined();
    expect(await job(d.db, fileJobId(file?.id ?? ''))).toMatchObject({ kind: 'file', trashed: true });
    expect((await job(d.db, fileJobId(file?.id ?? '')))?.notBefore).toBe(timers.now + TRASH_DELAY_MS);
  });
});

describe('the pointer and sync (§10.18 D19)', () => {
  const USER = 'user-1';
  const DEFAULTS = { theme: 'system' as const };
  const FIXED = 'Nasi kandar ayam goreng, kuah campur';

  interface SyncedDevice {
    db: KiraMakanDb;
    remote: SyncRemote;
  }

  let server: FakeServer;

  beforeEach(() => {
    server = createFakeServer({ now: timers.clock });
    // Capture stamps each change with Date.now: here, the test's clock.
    vi.spyOn(Date, 'now').mockImplementation(() => timers.now);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const ctx = (): RemoteCtx => ({ userId: USER, signal: new AbortController().signal });

  function syncedDevice(name: string): SyncedDevice {
    const db = createDb(`drive-pointer-${name}-${crypto.randomUUID()}`, { capture: () => true });
    dbs.push(db);
    return { db, remote: server.remote({ clock: timers.clock }) };
  }

  async function linkOf(d: SyncedDevice) {
    const { link } = await readMeta(d.db);
    if (!link) throw new Error('Not linked');
    return link;
  }

  /** One cycle as the sync engine runs it: push what's queued, then pull until a short page. */
  async function syncOnce(d: SyncedDevice): Promise<void> {
    for (let round = 0; round < 50; round += 1) {
      const link = await linkOf(d);
      const batch = await collectPush(d.db, link);
      if (!batch) break;
      const reply =
        batch.changes.length > 0
          ? await d.remote.push(ctx(), link.dataset, link.deviceId, batch.changes)
          : { dataset: link.dataset, prevHead: link.cursor, head: link.cursor, results: [] };
      await ackPush(d.db, link, batch, reply, DEFAULTS);
    }
    for (let round = 0; round < 50; round += 1) {
      const link = await linkOf(d);
      const page = await d.remote.pull(ctx(), link.cursor, 500);
      await applyPage(d.db, link, link.cursor, page, 500, DEFAULTS);
      if (page.rows.length < 500) break;
    }
    await recordSuccess(d.db, await linkOf(d), Date.now());
  }

  /** The phone logs a photo meal and uploads its diary; the laptop restores it. Drive hasn't the photo yet. */
  async function phoneAndLaptop(): Promise<{ phone: SyncedDevice; laptop: SyncedDevice }> {
    const phone = syncedDevice('phone');
    const laptop = syncedDevice('laptop');
    await setUp(phone.db);
    await photoMeal(phone.db, 'm1');
    await linkEmptyAccount(phone.db, { userId: USER, summary: await phone.remote.hello(ctx()), now: Date.now() });
    await syncOnce(phone);
    const { dataset } = await laptop.remote.hello(ctx());
    const page = await laptop.remote.pull(ctx(), 0, 1_000);
    const rows: WireRow[] = page.rows;
    await applyRestore(laptop.db, { dataset, head: page.head, rows }, { userId: USER, expect: 'noProfile', defaults: DEFAULTS, now: Date.now() });
    expect(await laptop.db.meals.get('m1')).toMatchObject({ photoId: 'photo-m1' });
    return { phone, laptop };
  }

  /** A minute later the phone's upload goes through, before the phone's own sync has pulled. */
  async function phoneUploads(phone: SyncedDevice): Promise<string> {
    await timers.advance(60_000);
    const d = device({ db: phone.db, catchUp: () => syncOnce(phone) });
    d.engine.start();
    await settle();
    await giveToken(d);
    const [file] = drive.photos();
    if (!file) throw new Error('Nothing uploaded');
    // The pointer write syncs, then the laptop looks.
    await syncOnce(phone);
    return file.id;
  }

  it('an edit made on another device since the last pull stays, with the pointer on top', async () => {
    const { phone, laptop } = await phoneAndLaptop();
    // Back home, the meal logged at the mamak is corrected on the laptop.
    await timers.advance(60_000);
    await laptop.db.meals.update('m1', { name: FIXED, updatedAt: new Date(timers.now).toISOString() });
    await syncOnce(laptop);

    const fileId = await phoneUploads(phone);
    await syncOnce(laptop);
    expect(server.live(USER).meals?.m1).toMatchObject({ name: FIXED, photoDrive: { fileId, thumb: THUMB } });
    for (const db of [phone.db, laptop.db]) {
      expect(await db.meals.get('m1')).toMatchObject({ name: FIXED, photoDrive: { fileId, thumb: THUMB } });
    }
  });

  it('a meal deleted on another device stays deleted, and the uploaded file goes to the trash', async () => {
    const { phone, laptop } = await phoneAndLaptop();
    await timers.advance(60_000);
    await createActions(laptop.db).deleteMeal('m1');
    await syncOnce(laptop);

    const fileId = await phoneUploads(phone);
    await syncOnce(laptop);
    expect(server.live(USER).meals?.m1).toBeUndefined();
    expect(await phone.db.meals.get('m1')).toBeUndefined();
    expect(await laptop.db.meals.get('m1')).toBeUndefined();
    expect(await job(phone.db, fileJobId(fileId))).toMatchObject({ kind: 'file', trashed: true });
  });

  it('waits for the catch-up before the pointer; stopped meanwhile, the next run reuses the file', async () => {
    let holding = true;
    let asked = 0;
    const d = device({
      catchUp: () => {
        asked += 1;
        // While held it never settles: only stop() gets the run out.
        return holding ? new Promise<void>(() => undefined) : Promise.resolve();
      },
    });
    await setUp(d.db);
    await photoMeal(d.db, 'm1');
    d.engine.start();
    await settle();
    tokens.next(token());
    await tokens.tap(() => d.engine.continueFromTap());
    for (let i = 0; i < 500 && asked === 0; i += 1) await new Promise<void>((resolve) => nextTurn(resolve));
    expect(asked).toBe(1);
    expect(drive.photos()).toHaveLength(1);
    expect((await d.db.meals.get('m1'))?.photoDrive).toBeUndefined();

    await d.engine.stop();
    expect(locks.busy()).toBe(false);
    expect(await job(d.db, uploadJobId('photo-m1'))).toMatchObject({ attempts: 0 });

    holding = false;
    d.engine.resume();
    await settle();
    expect(uploads()).toHaveLength(1);
    expect((await d.db.meals.get('m1'))?.photoDrive).toEqual({ fileId: drive.photos()[0]?.id, thumb: THUMB });
  });
});

describe('stop, resume and disconnect', () => {
  it('stop aborts the call in flight and waits; resume carries on', async () => {
    const d = device();
    await setUp(d.db);
    await photoMeal(d.db, 'm1');
    d.engine.start();
    await settle();
    drive.onCall = (call, signal) =>
      call.method === 'POST' && call.path.startsWith('/upload/')
        ? new Promise<void>((_resolve, reject) => signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
        : undefined;
    tokens.next(token());
    await tokens.tap(() => d.engine.continueFromTap());
    for (let i = 0; i < 200 && uploads().length === 0; i += 1) await new Promise<void>((resolve) => nextTurn(resolve));

    await d.engine.stop();
    expect(locks.busy()).toBe(false);
    expect(d.engine.getState().running).toBe(false);
    expect(await job(d.db, uploadJobId('photo-m1'))).toMatchObject({ attempts: 0 });
    expect(d.engine.getState().error).toBeUndefined();

    drive.onCall = undefined;
    d.engine.resume();
    await settle();
    expect(drive.photos()).toHaveLength(1);
  });

  it('disconnect forgets this device\'s connection and token, keeps the queue, and revokes nothing', async () => {
    const d = device();
    await setUp(d.db);
    d.engine.start();
    await settle();
    await giveToken(d);
    await photoMeal(d.db, 'm1');
    const before = drive.calls.length;
    await d.engine.disconnect();
    await settle();
    expect(await d.db.driveMeta.count()).toBe(0);
    expect(await d.db.driveJobs.count()).toBe(1);
    expect(d.engine.getState()).toMatchObject({ connected: false });
    expect(d.engine.getState().tokenExpiresAt).toBeUndefined();
    expect(phase(d)).toBe('disconnected');
    expect(drive.calls.slice(before)).toEqual([]);
  });
});

describe('fetchPhoto', () => {
  const FILE = 'drive-file-0001';

  beforeEach(() => {
    drive.files.set(FILE, {
      id: FILE,
      name: 'x.jpg',
      mimeType: 'image/jpeg',
      parents: [],
      appProperties: {},
      trashed: false,
      createdTime: '',
      bytes: new TextEncoder().encode('full-photo'),
    });
  });

  async function remoteMeal(db: KiraMakanDb, fileId = FILE) {
    await db.meals.put(meal('m1', { photoId: 'p1', photoDrive: { fileId, thumb: THUMB } }));
  }

  it('asks for a token inside the tap, downloads, and keeps the photo here', async () => {
    const d = device();
    await setUp(d.db);
    await remoteMeal(d.db);
    d.engine.start();
    await settle();
    tokens.next(token());
    const result = await tokens.tap(() => d.engine.fetchPhoto('m1'));
    expect(result).toEqual({ ok: true });
    expect(tokens.requests).toEqual([{ prompt: '', loginHint: EMAIL, inTap: true }]);
    const photo = await d.db.photos.get('p1');
    expect(await photo?.blob.text()).toBe('full-photo');
    expect(await photo?.thumb.text()).toBe('local-thumb');
    expect(photo?.createdAt).toBe(new Date(timers.now).toISOString());

    // Here now: no second download.
    const calls = drive.calls.length;
    expect(await d.engine.fetchPhoto('m1')).toEqual({ ok: true });
    expect(drive.calls.length).toBe(calls);
  });

  it('with a token held, asks nothing more', async () => {
    const d = device();
    await setUp(d.db);
    await remoteMeal(d.db);
    d.engine.start();
    await settle();
    await giveToken(d);
    expect(await d.engine.fetchPhoto('m1')).toEqual({ ok: true });
    expect(tokens.requests).toHaveLength(1);
  });

  it('says notFound for a file that is gone, offline, notConnected and notInDrive', async () => {
    const d = device();
    await setUp(d.db);
    await remoteMeal(d.db, 'gone-file-00001');
    await d.db.meals.put(meal('plain', { photoId: 'p2' }));
    d.engine.start();
    await settle();
    await giveToken(d);
    expect(await d.engine.fetchPhoto('m1')).toEqual({ ok: false, problem: 'notFound' });
    expect(await d.engine.fetchPhoto('plain')).toEqual({ ok: false, problem: 'notInDrive' });
    expect(await d.engine.fetchPhoto('missing')).toEqual({ ok: false, problem: 'notInDrive' });

    d.flags.online = false;
    expect(await d.engine.fetchPhoto('m1')).toEqual({ ok: false, problem: 'offline' });
    d.flags.online = true;
    await d.db.driveMeta.clear();
    expect(await d.engine.fetchPhoto('m1')).toEqual({ ok: false, problem: 'notConnected' });
    expect(tokens.requests).toHaveLength(1);
  });

  it('a local copy is enough: no call', async () => {
    const d = device();
    await setUp(d.db);
    await remoteMeal(d.db);
    await d.db.photos.put({ id: 'p1', blob: new Blob(['own']), thumb: new Blob(['t']), createdAt: '2026-10-16T12:31:00.000Z' });
    d.engine.start();
    await settle();
    await giveToken(d);
    const calls = drive.calls.length;
    expect(await d.engine.fetchPhoto('m1')).toEqual({ ok: true });
    expect(drive.calls.length).toBe(calls);
  });
});

describe('renewOnTap', () => {
  it('asks only when connected, keeping photos, online, ready and without a token', async () => {
    const d = device();
    await setUp(d.db);
    d.engine.start();
    await settle();

    tokens.next(token());
    tokens.tap(() => d.engine.renewOnTap());
    expect(tokens.requests).toEqual([{ prompt: '', loginHint: EMAIL, inTap: true }]);
    await settle();
    expect(d.engine.getState().tokenExpiresAt).toBe(timers.now + HOUR);

    // A valid token: nothing.
    tokens.tap(() => d.engine.renewOnTap());
    expect(tokens.requests).toHaveLength(1);
  });

  it('asks nothing offline, with Keep photos off, before GIS is ready, or when not connected', async () => {
    const d = device();
    await setUp(d.db, { keepPhotos: false });
    d.engine.start();
    await settle();
    d.engine.renewOnTap();

    await d.db.profile.update('me', { keepPhotos: true });
    await settle();
    d.flags.online = false;
    d.engine.renewOnTap();
    d.flags.online = true;
    tokens.isReady = false;
    d.engine.renewOnTap();
    tokens.isReady = true;
    await d.db.driveMeta.clear();
    await settle();
    d.engine.renewOnTap();
    expect(tokens.requests).toEqual([]);
  });

  it('swallows a failure', async () => {
    const d = device();
    await setUp(d.db);
    d.engine.start();
    await settle();
    tokens.next('popupBlocked');
    tokens.tap(() => d.engine.renewOnTap());
    await settle();
    expect(d.engine.getState()).toMatchObject({ authBusy: false });
    expect(d.engine.getState().tokenExpiresAt).toBeUndefined();
  });
});

describe("when Google's script fails to load", () => {
  /** Connected, a photo waiting, and the start-up load of GIS failed while the browser said online. */
  async function failedLoad(): Promise<Device> {
    tokens.isReady = false;
    tokens.loads = 'fail';
    const d = device();
    await setUp(d.db);
    await photoMeal(d.db, 'm1');
    d.engine.start();
    await timers.advance(2_000);
    expect(tokens.loadCalls).toBe(1);
    expect(d.engine.getState()).toMatchObject({ gisReady: false, gisFailed: true });
    expect(phase(d)).toBe('needsTap');
    // The connection comes back without an online event (navigator.onLine stayed true).
    tokens.loads = 'ok';
    return d;
  }

  it("Continue says Google couldn't be reached and loads it again; the next Continue works", async () => {
    const d = await failedLoad();
    expect(await tokens.tap(() => d.engine.continueFromTap())).toEqual({ ok: false, problem: 'unavailable' });
    expect(tokens.loadCalls).toBe(2);
    await settle();
    expect(d.engine.getState().gisReady).toBe(true);
    expect(d.engine.getState().gisFailed).toBeUndefined();

    tokens.next(token());
    expect(await tokens.tap(() => d.engine.continueFromTap())).toEqual({ ok: true });
    await settle();
    expect(uploads()).toHaveLength(1);
    expect(phase(d)).toBe('idle');
  });

  it('a load still on its way says notReady, and a tap starts no second one', async () => {
    tokens.isReady = false;
    let finish: () => void = () => undefined;
    const load = vi.spyOn(tokens, 'load').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = () => {
            tokens.isReady = true;
            resolve();
          };
        }),
    );
    const d = device();
    await setUp(d.db);
    d.engine.start();
    await settle();
    d.engine.prepare();
    expect(await tokens.tap(() => d.engine.continueFromTap())).toEqual({ ok: false, problem: 'notReady' });
    expect(load).toHaveBeenCalledTimes(1);
    finish();
    await settle();
    expect(d.engine.getState()).toMatchObject({ gisReady: true });
  });

  it('Show full photo loads it again too, and the next tap downloads', async () => {
    const FILE = 'drive-file-0001';
    drive.files.set(FILE, {
      id: FILE,
      name: 'x.jpg',
      mimeType: 'image/jpeg',
      parents: [],
      appProperties: {},
      trashed: false,
      createdTime: '',
      bytes: new TextEncoder().encode('full-photo'),
    });
    const d = await failedLoad();
    await d.db.meals.put(meal('m2', { photoId: 'p2', photoDrive: { fileId: FILE, thumb: THUMB } }));
    expect(await tokens.tap(() => d.engine.fetchPhoto('m2'))).toEqual({ ok: false, problem: 'unavailable' });
    expect(tokens.loadCalls).toBe(2);
    await settle();

    tokens.next(token());
    expect(await tokens.tap(() => d.engine.fetchPhoto('m2'))).toEqual({ ok: true });
    expect(await (await d.db.photos.get('p2'))?.blob.text()).toBe('full-photo');
  });

  it("the photo sheet's Estimate tap loads it again, asking Google nothing", async () => {
    const d = await failedLoad();
    tokens.tap(() => d.engine.renewOnTap());
    expect(tokens.loadCalls).toBe(2);
    expect(tokens.requests).toEqual([]);
    await settle();
    expect(d.engine.getState().gisReady).toBe(true);
  });

  it('coming back to the app loads it again', async () => {
    const d = await failedLoad();
    d.doc.visibilityState = 'hidden';
    d.doc.dispatchEvent(new Event('visibilitychange'));
    expect(tokens.loadCalls).toBe(1);
    d.doc.visibilityState = 'visible';
    d.doc.dispatchEvent(new Event('visibilitychange'));
    expect(tokens.loadCalls).toBe(2);
    await settle();
    expect(d.engine.getState()).toMatchObject({ gisReady: true });
    expect(d.engine.getState().gisFailed).toBeUndefined();
  });

  it('Connect says so after a failed load, and loads it again', async () => {
    tokens.isReady = false;
    tokens.loads = 'fail';
    const d = device();
    await setUp(d.db, { connected: false });
    d.engine.start();
    await settle();
    // The connect sheet prepares Google when it opens.
    d.engine.prepare();
    await settle();
    expect(d.engine.getState()).toMatchObject({ gisReady: false, gisFailed: true });

    tokens.loads = 'ok';
    expect(await tokens.tap(() => d.engine.connect())).toEqual({ ok: false, problem: 'unavailable' });
    expect(tokens.loadCalls).toBe(2);
    await settle();
    tokens.next(token());
    expect(await tokens.tap(() => d.engine.connect())).toEqual({ ok: true, queued: 0 });
  });
});

describe('start-up', () => {
  it('queues the photos already here and loads GIS once connected', async () => {
    tokens.isReady = false;
    const d = device();
    await setUp(d.db);
    await photoMeal(d.db, 'm1', { queued: false });
    d.engine.start();
    await settle();
    expect(tokens.loadCalls).toBe(0);
    await timers.advance(2_000);
    expect(tokens.loadCalls).toBe(1);
    expect(d.engine.getState().gisReady).toBe(true);
    expect(await job(d.db, uploadJobId('photo-m1'))).toMatchObject({ kind: 'upload', mealId: 'm1' });
    expect(phase(d)).toBe('needsTap');
  });
});
