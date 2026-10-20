// @vitest-environment node
/*
 * The engine against the fake account (./testing/fakeServer), with a fake session and injected
 * timers, locks, online state, window and document. Global fake timers are never used, since
 * fake-indexeddb runs on real ones. An injected 0 ms timer fires on a real macrotask (the engine's
 * yields and its deferred session work run by themselves); longer ones fire only when a test moves
 * the clock with `advance`. `settle` waits until no task holds the lock and no 0 ms timer waits.
 */
import type { AuthInfo, SessionState } from '@/auth/session';
import { createActions } from '@/db/actions';
import { createDb, SYNC_TABLES, type KiraMakanDb } from '@/db/db';
import { setDemoClock } from '@/domain/clock';
import type { MealLog, Profile, WeightLog } from '@/domain/types';
import { createSyncEngine, type EngineState, type SyncEngine, type SyncLocks, type SyncProgress, type SyncTimers } from './engine';
import { SyncError } from './errors';
import { pendingSummary, readMeta } from './local';
import { primaryKeyField, toServerRow, type JsonObject } from './rows';
import { createFakeServer, type FakeCall, type FakeServer } from './testing/fakeServer';

const USER = 'user-1';
const OTHER = 'user-2';
const MINUTE = 60_000;

/** Node's setImmediate: these tests run in Node, but the app's types have no Node globals. */
const { setImmediate: nextTurn } = globalThis as typeof globalThis & { setImmediate: (callback: () => void) => unknown };

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/** The engine's timers on a clock the test moves. */
class FakeTimers implements SyncTimers {
  now: number;
  /** Every delay asked for, in order. */
  readonly delays: number[] = [];
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
    this.delays.push(ms);
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

  /** A 0 ms timer still waiting for its macrotask. */
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

  /** The same without waiting for anything in between: for when a call is being held. */
  tick(ms: number): void {
    const end = this.now + ms;
    while (this.fireNext(end)) {
      // Each due timer fires in turn.
    }
    this.now = end;
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

/** Web Locks for one origin: one holder at a time, in order, and an abortable wait. */
class FakeLocks implements SyncLocks {
  requests = 0;
  private active = 0;
  private held = false;
  private readonly waiting: (() => void)[] = [];

  busy(): boolean {
    return this.active > 0;
  }

  async request(_name: string, options: { signal?: AbortSignal }, callback: () => Promise<void>): Promise<unknown> {
    this.requests += 1;
    this.active += 1;
    try {
      await this.acquire(options.signal);
      try {
        return await callback();
      } finally {
        this.release();
      }
    } finally {
      this.active -= 1;
    }
  }

  private acquire(signal: AbortSignal | undefined): Promise<void> {
    if (!this.held) {
      this.held = true;
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const grant = () => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      };
      const onAbort = () => {
        this.waiting.splice(this.waiting.indexOf(grant), 1);
        reject(new DOMException('The lock request was aborted', 'AbortError'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.waiting.push(grant);
    });
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.held = false;
  }
}

class FakeDocument extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible';

  show(state: DocumentVisibilityState): void {
    this.visibilityState = state;
    this.dispatchEvent(new Event('visibilitychange'));
  }
}

const signedIn = (userId = USER): SessionState => ({ status: 'signedIn', userId, email: `${userId}@example.com` });

/**
 * The session store: `set` tells the watchers synchronously, as onAuthStateChange does, and a
 * signed-in state brings a new token (SIGNED_IN, TOKEN_REFRESHED). `echo` tells them the same
 * session with the same token. With `refreshOnLook`, every getAuth() refreshes the token first
 * and says so, as supabase-js does for a token that runs out.
 */
function fakeSession(initial: SessionState, options: { stored?: boolean; startsAs?: SessionState } = {}) {
  let current = initial;
  let tokens = 0;
  const listeners = new Set<(state: SessionState) => void>();
  const tell = (): void => {
    for (const listener of [...listeners]) listener(current);
  };
  const session = {
    stored: options.stored ?? true,
    refreshOnLook: false,
    set(next: SessionState): void {
      current = next;
      if (next.status === 'signedIn') tokens += 1;
      tell();
    },
    echo: tell,
    read: (): SessionState => current,
    watch: vi.fn((listener: (state: SessionState) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
    ensureStarted: vi.fn(async (): Promise<void> => {
      if (current.status === 'loading' && options.startsAs) session.set(options.startsAs);
    }),
    getAuth: vi.fn(async (): Promise<AuthInfo | null> => {
      if (current.status !== 'signedIn' || !current.userId) return null;
      if (session.refreshOnLook) session.set(current);
      return { token: `token-${current.userId}-${tokens}`, userId: current.userId, ...(current.email ? { email: current.email } : {}) };
    }),
    hasStored: (): boolean => session.stored,
  };
  return session;
}

type FakeSession = ReturnType<typeof fakeSession>;

interface Device {
  db: KiraMakanDb;
  session: FakeSession;
  engine: SyncEngine;
  win: EventTarget;
  doc: FakeDocument;
  flags: { online: boolean; configured: boolean };
}

let timers: FakeTimers;
let locks: FakeLocks;
let server: FakeServer;
/** Every call a device made, including the ones `onCall` failed before they reached the server. */
let attempts: FakeCall[];
/** Runs before each call reaches the server: throw to fail it, return a promise to hold it. */
let onCall: ((call: FakeCall, signal: AbortSignal) => void | Promise<void>) | undefined;
let dbs: KiraMakanDb[];
let engines: SyncEngine[];

beforeEach(() => {
  timers = new FakeTimers(Date.now());
  locks = new FakeLocks();
  server = createFakeServer({ now: timers.clock });
  attempts = [];
  onCall = undefined;
  dbs = [];
  engines = [];
  // No jitter: each wait is exactly the backoff step.
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
});

afterEach(async () => {
  await Promise.all(engines.map((engine) => engine.dispose()));
  const byName = new Map<string, KiraMakanDb>();
  for (const db of dbs) {
    if (byName.has(db.name)) db.close();
    else byName.set(db.name, db);
  }
  await Promise.all([...byName.values()].map((db) => db.delete()));
  vi.restoreAllMocks();
  setDemoClock(false);
});

const busy = (): boolean => locks.busy() || timers.zeroPending();

/**
 * Lets everything in flight finish: no task holds the lock and no 0 ms timer waits, for 50 turns
 * of the event loop (fake-indexeddb works in setImmediate steps), then after one real timer too
 * (Dexie starts a live query on one).
 */
async function settle(): Promise<void> {
  for (let round = 0; round < 100; round += 1) {
    let quiet = 0;
    for (let i = 0; i < 100_000 && quiet < 50; i += 1) {
      await new Promise<void>((resolve) => nextTurn(resolve));
      quiet = busy() ? 0 : quiet + 1;
    }
    if (quiet < 50) break;
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (!busy()) return;
  }
  throw new Error('The engine never settled');
}

function newDb(name = `engine-${crypto.randomUUID()}`): KiraMakanDb {
  const db = createDb(name, { capture: () => true });
  dbs.push(db);
  return db;
}

function device(options: { db?: KiraMakanDb; session?: FakeSession; configured?: boolean; locks?: SyncLocks | null } = {}): Device {
  const db = options.db ?? newDb();
  const session = options.session ?? fakeSession(signedIn());
  const win = new EventTarget();
  const doc = new FakeDocument();
  const flags = { online: true, configured: options.configured ?? true };
  const remote = server.remote({
    clock: timers.clock,
    before: (call, signal) => {
      attempts.push(call);
      return onCall?.(call, signal);
    },
  });
  const engine = createSyncEngine({
    db,
    remote,
    configured: () => flags.configured,
    deviceDefaults: () => ({ theme: 'system' }),
    session,
    clock: timers.clock,
    timers,
    locks: options.locks === undefined ? locks : options.locks,
    online: () => flags.online,
    win,
    doc,
  });
  engines.push(engine);
  return { db, session, engine, win, doc, flags };
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
  setupCompletedAt: '2026-10-01T02:00:00.000Z',
  demoMode: false,
  ...patch,
});
const weight = (id: string, kg: number): WeightLog => ({ id, kg, measuredAt: '2026-10-16T00:05:00.000Z', logicalDay: '2026-10-16' });
const meal = (id: string): MealLog => ({
  id,
  eatenAt: '2026-10-16T04:30:00.000Z',
  logicalDay: '2026-10-16',
  slot: 'lunch',
  name: 'Economy rice',
  items: [],
  method: 'manual',
  finished: 'all',
  createdAt: '2026-10-16T04:31:00.000Z',
  updatedAt: '2026-10-16T04:31:00.000Z',
  syncState: 'local',
});

function setUp(db: KiraMakanDb): Promise<unknown> {
  return createActions(db).completeSetup({
    age: 34,
    sex: 'male',
    heightCm: 172,
    weightKg: 78.6,
    activity: 'light',
    paceKgPerWeek: 0.5,
    dailyMinimumKcal: 1400,
    regulars: [],
    places: [{ name: 'Home', type: 'home' }],
    rolloverHour: 5,
    timeZone: 'Asia/Kuala_Lumpur',
  });
}

/** Another device's diary in the account: a profile and two meals. */
function seedOtherDiary(): void {
  server.seed(
    USER,
    [
      { t: 'profile', k: 'me', data: toServerRow('profile', profile({ rolloverHour: 4 })) },
      { t: 'meals', k: 'cloud-1', data: toServerRow('meals', meal('cloud-1')) },
      { t: 'meals', k: 'cloud-2', data: toServerRow('meals', meal('cloud-2')) },
    ],
    'laptop',
  );
}

/** Every synced row as the account would hold it, by table and key. */
async function snapshotOf(db: KiraMakanDb): Promise<Record<string, Record<string, JsonObject>>> {
  const out: Record<string, Record<string, JsonObject>> = {};
  for (const table of SYNC_TABLES) {
    for (const row of await db.table<Record<string, unknown>, string>(table).toArray()) {
      (out[table] ??= {})[String(row[primaryKeyField(table)])] = toServerRow(table, row);
    }
  }
  return out;
}

async function countAll(db: KiraMakanDb): Promise<number> {
  const counts = await Promise.all(db.tables.map((table) => table.count()));
  return counts.reduce((sum, n) => sum + n, 0);
}

function record(engine: SyncEngine): EngineState[] {
  const states: EngineState[] = [];
  engine.subscribe(() => states.push(engine.getState()));
  return states;
}

function retryDelay(d: Device): number {
  const { retryAt } = d.engine.getState();
  if (retryAt === undefined) throw new Error('No retry is scheduled');
  return retryAt - timers.now;
}

/** Keys sent in pushes, in order. */
function pushedKeys(): string[] {
  return server.calls.filter((c) => c.fn === 'sync_push').flatMap((c) => (c.args.p_changes as { k: string }[]).map((change) => change.k));
}

function fnsSince(from: number): string[] {
  return attempts.slice(from).map((c) => c.fn);
}

function fail(kind: SyncError['kind']): void {
  onCall = () => {
    throw new SyncError(kind, `The account answered ${kind}`);
  };
}

/** Holds the next call to `fn` until its signal aborts. `out` resolves once it is out. */
function hold(fn: FakeCall['fn'] = 'sync_pull'): { out: Promise<void>; aborted: () => boolean } {
  let aborted = false;
  let markOut = (): void => undefined;
  const out = new Promise<void>((resolve) => {
    markOut = resolve;
  });
  onCall = (call, signal) => {
    if (call.fn !== fn) return;
    markOut();
    return new Promise<void>((_, reject) => {
      signal.addEventListener('abort', () => {
        aborted = true;
        reject(new SyncError('aborted'));
      }, { once: true });
    });
  };
  return { out, aborted: () => aborted };
}

/** Set up, started and linked to an empty account, with everything uploaded. */
async function linkedDevice(): Promise<Device> {
  const d = device();
  await setUp(d.db);
  d.engine.start();
  await timers.advance(1_500);
  // A change the link itself queued syncs too.
  await timers.advance(10_000);
  expect(d.engine.getState()).toEqual({ phase: 'idle' });
  expect(await d.db.syncOutbox.count()).toBe(0);
  return d;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('starting', () => {
  it('does nothing at all when Supabase is not configured', async () => {
    const d = device({ configured: false });
    await setUp(d.db);
    d.engine.start();
    d.engine.start();
    await timers.advance(60 * MINUTE);
    d.doc.show('hidden');
    d.doc.show('visible');
    d.win.dispatchEvent(new Event('online'));
    await d.db.weights.put(weight('w1', 80));
    d.engine.request('change');
    await timers.advance(60 * MINUTE);

    expect(attempts).toEqual([]);
    expect(d.session.watch).not.toHaveBeenCalled();
    expect(d.session.ensureStarted).not.toHaveBeenCalled();
    expect(d.session.getAuth).not.toHaveBeenCalled();
    expect(locks.requests).toBe(0);
    expect(d.engine.getState()).toEqual({ phase: 'unconfigured' });
  });

  it('starts once however often start() is called (StrictMode)', async () => {
    const d = device();
    await setUp(d.db);
    d.engine.start();
    d.engine.start();
    await timers.advance(1_500);
    expect(d.session.watch).toHaveBeenCalledTimes(1);
    expect(fnsSince(0).filter((fn) => fn === 'sync_hello')).toHaveLength(1);
    expect(d.engine.getState()).toEqual({ phase: 'idle' });
  });

  it('without a stored session, never starts the session or asks for a token', async () => {
    const session = fakeSession({ status: 'loading' }, { stored: false });
    const d = device({ session });
    await setUp(d.db);
    d.engine.start();
    await timers.advance(10 * MINUTE);
    expect(session.ensureStarted).not.toHaveBeenCalled();
    expect(session.getAuth).not.toHaveBeenCalled();
    expect(attempts).toEqual([]);
    expect(d.engine.getState()).toEqual({ phase: 'signedOut' });
  });

  it('with a stored session, starts it 1.5 s after start-up, then syncs once', async () => {
    const session = fakeSession({ status: 'loading' }, { startsAs: signedIn() });
    const d = device({ session });
    await setUp(d.db);
    d.engine.start();
    await timers.advance(1_400);
    expect(session.ensureStarted).not.toHaveBeenCalled();
    expect(attempts).toEqual([]);
    expect(d.engine.getState()).toEqual({ phase: 'starting' });

    await timers.advance(100);
    expect(session.ensureStarted).toHaveBeenCalledTimes(1);
    expect(fnsSince(0).filter((fn) => fn === 'sync_hello')).toHaveLength(1);
    expect(d.engine.getState()).toEqual({ phase: 'idle' });
  });

  it('never calls the account without a profile, or in demo mode', async () => {
    const d = device();
    d.engine.start();
    await timers.advance(1_500);
    expect(d.engine.getState()).toEqual({ phase: 'noProfile' });
    await d.engine.syncNow();
    expect(d.engine.getState()).toEqual({ phase: 'noProfile' });

    await createActions(d.db).loadDemoData();
    await d.engine.syncNow();
    d.win.dispatchEvent(new Event('online'));
    await timers.advance(10 * MINUTE);
    expect(d.engine.getState()).toEqual({ phase: 'demo' });
    expect(attempts).toEqual([]);
    expect(d.session.getAuth).not.toHaveBeenCalled();
  });
});

describe('the first link', () => {
  it('links to an empty account and uploads everything, with progress', async () => {
    const d = device();
    await setUp(d.db);
    await d.db.weights.bulkPut(Array.from({ length: 300 }, (_, i) => weight(`w${i}`, 70 + i / 10)));
    const total = (await countAll(d.db)) - (await d.db.syncOutbox.count());
    const states = record(d.engine);
    d.engine.start();
    await timers.advance(1_500);

    const uploads = states.flatMap((s) => (s.phase === 'uploading' && s.progress ? [s.progress] : []));
    expect(uploads[0]).toEqual({ done: 0, total });
    expect(uploads).toContainEqual({ done: 200, total });
    expect(uploads.at(-1)).toEqual({ done: total, total });
    expect(d.engine.getState()).toEqual({ phase: 'idle' });

    expect(await snapshotOf(d.db)).toEqual(server.live(USER));
    expect(await d.db.syncOutbox.count()).toBe(0);
    const meta = await readMeta(d.db);
    expect(meta.link).toMatchObject({ userId: USER, email: 'user-1@example.com', dataset: server.dataset(USER), cursor: server.head(USER) });
    expect(meta.lastSyncedAt).toBe(timers.now);
  });

  it('runs on a sign-in after a 0 ms timer, outside the auth callback', async () => {
    const session = fakeSession({ status: 'signedOut' }, { stored: false });
    const d = device({ session });
    await setUp(d.db);
    d.engine.start();
    await timers.advance(1_500);
    expect(d.engine.getState()).toEqual({ phase: 'signedOut' });

    const delays = timers.delays.length;
    session.set(signedIn()); // as supabase-js's onAuthStateChange does, holding its auth lock
    expect(session.getAuth).not.toHaveBeenCalled();
    expect(timers.delays.slice(delays)).toEqual([0]);

    await settle();
    expect(session.getAuth).toHaveBeenCalled();
    expect(d.engine.getState()).toEqual({ phase: 'idle' });
    expect(server.live(USER)).toEqual(await snapshotOf(d.db));
  });

  it('asks which copy to keep when another device uploaded to the empty account first', async () => {
    // Two devices set up apart, both finding the account empty: neither may overwrite the other.
    const laptop = device({ locks: null });
    await setUp(laptop.db);
    const phone = device({ locks: null });
    await setUp(phone.db);
    await phone.db.profile.update('me', { rolloverHour: 3 });
    await phone.db.meals.put(meal('phone-1'));

    // The phone finds the account empty and links; its next call waits while the laptop uploads.
    let release = (): void => undefined;
    let held = false;
    onCall = (call) => {
      if (held || call.fn === 'sync_hello') return;
      held = true;
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    };
    const phoneDone = phone.engine.syncNow();
    await settle();
    expect(held).toBe(true);
    const laptopRows = await snapshotOf(laptop.db);
    await laptop.engine.syncNow();
    expect(laptop.engine.getState()).toEqual({ phase: 'idle' });
    expect(server.live(USER)).toEqual(laptopRows);

    release();
    await phoneDone;
    expect(phone.engine.getState()).toMatchObject({ phase: 'choose', choice: { localMeals: 1, cloud: { counts: { profile: 1 } } } });
    expect(await readMeta(phone.db)).toEqual({ id: 'sync' });
    expect(await phone.db.syncOutbox.count()).toBe(0);
    // Nothing of the phone's reached the account.
    const laptopDevice = (await readMeta(laptop.db)).link?.deviceId;
    expect(server.live(USER)).toEqual(laptopRows);
    expect(server.rows(USER).every((r) => r.deviceId === laptopDevice)).toBe(true);
  });

  /** Every pull fails until `onCall` changes, the look before the first upload (from the head hello saw) first. */
  function failLook(): void {
    onCall = (call) => {
      if (call.fn === 'sync_pull') throw new SyncError('unreachable', 'The connection dropped');
    };
  }

  /** Another device sets up and makes the first upload to the account: what the account holds then. */
  async function laptopUploadsMeanwhile(): Promise<Record<string, Record<string, JsonObject>>> {
    const laptop = device();
    await setUp(laptop.db);
    await laptop.engine.syncNow();
    expect(laptop.engine.getState()).toEqual({ phase: 'idle' });
    const rows = server.live(USER);
    expect(rows).toEqual(await snapshotOf(laptop.db));
    return rows;
  }

  it('a look that fails before the first upload holds every push until a later look passes', async () => {
    const d = device();
    await setUp(d.db);
    failLook();
    await d.engine.syncNow();
    expect(d.engine.getState()).toMatchObject({ phase: 'error', error: 'unreachable', retryAt: timers.now + 10_000 });
    expect((await readMeta(d.db)).link).toMatchObject({ checkPending: true });
    // Signing out (or leaving the app) pushes nothing either.
    await d.engine.flush(5_000);
    expect(fnsSince(0)).toEqual(['sync_hello', 'sync_pull']);

    onCall = undefined;
    const from = attempts.length;
    await timers.advance(10_000);
    // The retry looks first, then uploads.
    expect(attempts[from]).toMatchObject({ fn: 'sync_pull', args: { p_limit: 1 } });
    expect(fnsSince(from + 1)[0]).toBe('sync_push');
    expect(d.engine.getState()).toEqual({ phase: 'idle' });
    expect((await readMeta(d.db)).link?.checkPending).toBeUndefined();
    expect(server.live(USER)).toEqual(await snapshotOf(d.db));
    expect(await d.db.syncOutbox.count()).toBe(0);
  });

  it('asks which copy to keep when another device uploaded while the look kept failing', async () => {
    const phone = device();
    await setUp(phone.db);
    await phone.db.meals.put(meal('phone-1'));
    failLook();
    await phone.engine.syncNow();
    expect(phone.engine.getState()).toMatchObject({ phase: 'error', error: 'unreachable' });

    onCall = undefined;
    const laptopRows = await laptopUploadsMeanwhile();
    await timers.advance(10_000);
    expect(phone.engine.getState()).toMatchObject({ phase: 'choose', choice: { localMeals: 1, cloud: { counts: { profile: 1 } } } });
    // Unlinked with its data kept, and nothing of the phone's reached the account.
    expect(await readMeta(phone.db)).toEqual({ id: 'sync' });
    expect(await phone.db.syncOutbox.count()).toBe(0);
    expect((await phone.db.meals.toArray()).map((m) => m.id)).toEqual(['phone-1']);
    expect(server.live(USER)).toEqual(laptopRows);
    expect(server.calls.filter((c) => c.fn === 'sync_push')).toHaveLength(1); // the laptop's
  });

  it('looks again after the app closed part way through the look, before anything is pushed', async () => {
    const phone = device();
    await setUp(phone.db);
    await phone.db.meals.put(meal('phone-1'));
    const look = hold('sync_pull');
    const done = phone.engine.syncNow();
    await look.out;
    expect((await readMeta(phone.db)).link).toMatchObject({ checkPending: true });
    await phone.engine.dispose();
    await done;
    expect(look.aborted()).toBe(true);

    onCall = undefined;
    const laptopRows = await laptopUploadsMeanwhile();
    const reopened = device({ db: phone.db, session: phone.session });
    reopened.engine.start();
    await timers.advance(1_500);
    expect(reopened.engine.getState()).toMatchObject({ phase: 'choose', choice: { localMeals: 1 } });
    expect(await readMeta(phone.db)).toEqual({ id: 'sync' });
    expect((await phone.db.meals.toArray()).map((m) => m.id)).toEqual(['phone-1']);
    expect(server.live(USER)).toEqual(laptopRows);
    expect(server.calls.filter((c) => c.fn === 'sync_push')).toHaveLength(1);
  });
});

describe('an account that already has a diary', () => {
  async function choosing(): Promise<Device> {
    seedOtherDiary();
    const d = device();
    await setUp(d.db);
    await d.db.meals.put(meal('phone-1'));
    d.engine.start();
    await timers.advance(1_500);
    return d;
  }

  it('asks which copy to keep, and sends or takes nothing until then', async () => {
    const d = await choosing();
    const head = server.head(USER);
    expect(d.engine.getState()).toMatchObject({
      phase: 'choose',
      choice: { localMeals: 1, cloud: { dataset: server.dataset(USER), head, counts: { profile: 1, meals: 2 } } },
    });
    expect(fnsSince(0)).toEqual(['sync_hello']);
    expect((await readMeta(d.db)).link).toBeUndefined();

    // Nothing runs by itself while the user decides.
    await d.db.weights.put(weight('w1', 80));
    d.win.dispatchEvent(new Event('online'));
    await timers.advance(30 * MINUTE);
    expect(fnsSince(0)).toEqual(['sync_hello']);
    expect(server.head(USER)).toBe(head);
  });

  it("useAccountData replaces this phone's diary with the account's, keeping its theme", async () => {
    const d = await choosing();
    await d.db.profile.update('me', { theme: 'dark' });
    await d.engine.useAccountData();

    expect((await d.db.meals.toArray()).map((m) => m.id).sort()).toEqual(['cloud-1', 'cloud-2']);
    expect(await d.db.profile.get('me')).toMatchObject({ rolloverHour: 4, theme: 'dark' });
    expect(await snapshotOf(d.db)).toEqual(server.live(USER));
    expect((await readMeta(d.db)).link).toMatchObject({ userId: USER, dataset: server.dataset(USER), cursor: server.head(USER) });
    expect(await d.db.syncOutbox.count()).toBe(0);
    expect(d.engine.getState()).toEqual({ phase: 'idle' });
    expect(fnsSince(0)).not.toContain('sync_push');
  });

  it('keepThisDeviceData makes the account a copy of this phone', async () => {
    const d = await choosing();
    await d.engine.keepThisDeviceData();
    await settle();

    expect(d.engine.getState()).toEqual({ phase: 'idle' });
    expect(server.live(USER)).toEqual(await snapshotOf(d.db));
    expect(Object.keys(server.live(USER).meals ?? {})).toEqual(['phone-1']);
    expect(server.rows(USER).filter((r) => r.deleted).map((r) => r.key).sort()).toEqual(['cloud-1', 'cloud-2']);
    expect(await d.db.syncOutbox.count()).toBe(0);
  });

  it('a failed choice leaves the question open, with the error', async () => {
    const d = await choosing();
    fail('unreachable');
    await expect(d.engine.keepThisDeviceData()).rejects.toMatchObject({ kind: 'unreachable' });
    expect(d.engine.getState()).toMatchObject({ phase: 'choose', error: 'unreachable', choice: { localMeals: 1 } });
    expect((await readMeta(d.db)).link).toBeUndefined();
    await expect(d.engine.useAccountData()).rejects.toMatchObject({ kind: 'unreachable' });
    expect((await d.db.meals.toArray()).map((m) => m.id)).toEqual(['phone-1']);
  });

  it('notNow turns sync off here until turnSyncBackOn, which asks again', async () => {
    const d = await choosing();
    await d.engine.notNow();
    expect(d.engine.getState()).toEqual({ phase: 'paused' });
    expect((await readMeta(d.db)).paused).toBe(true);

    await d.db.weights.put(weight('w1', 80));
    d.win.dispatchEvent(new Event('online'));
    await timers.advance(30 * MINUTE);
    await d.engine.syncNow();
    expect(fnsSince(0)).toEqual(['sync_hello']);

    await d.engine.turnSyncBackOn();
    await settle();
    expect(d.engine.getState().phase).toBe('choose');
    expect(fnsSince(0)).toEqual(['sync_hello', 'sync_hello']);
    expect((await readMeta(d.db)).paused).toBeUndefined();
  });

  it('a choice made in another tab moves this one on by itself', async () => {
    seedOtherDiary();
    const name = `engine-${crypto.randomUUID()}`;
    const a = device({ db: newDb(name) });
    await setUp(a.db);
    a.engine.start();
    await timers.advance(1_500);
    const b = device({ db: newDb(name), session: a.session });
    b.engine.start();
    await timers.advance(1_500);
    expect(a.engine.getState().phase).toBe('choose');
    expect(b.engine.getState().phase).toBe('choose');

    await b.engine.keepThisDeviceData();
    await settle();
    expect(b.engine.getState()).toEqual({ phase: 'idle' });
    expect(a.engine.getState()).toEqual({ phase: 'idle' });
    expect(server.live(USER)).toEqual(await snapshotOf(a.db));
  });
});

describe('restore before setup', () => {
  it('downloads the account into a new device in one go, with progress', async () => {
    seedOtherDiary();
    server.seed(USER, [{ t: 'meals', k: 'cloud-2', data: null }], 'laptop'); // deleted on the laptop
    const d = device();
    const progress: SyncProgress[] = [];
    const result = await d.engine.restoreFromAccount((p) => progress.push(p));

    expect(result).toEqual({ result: 'restored', meals: 1 });
    expect(await snapshotOf(d.db)).toEqual(server.live(USER));
    expect(await d.db.profile.get('me')).toMatchObject({ rolloverHour: 4, theme: 'system', useLocation: false });
    expect(progress[0]).toEqual({ done: 0, total: 0 });
    expect(progress.at(-1)).toEqual({ done: 2, total: 2 });
    expect((await readMeta(d.db)).link).toMatchObject({ userId: USER, dataset: server.dataset(USER), cursor: server.head(USER) });
    expect(d.engine.getState()).toEqual({ phase: 'idle' });
  });

  it('writes nothing when the account has no diary', async () => {
    server.seed(USER, [{ t: 'weights', k: 'w1', data: null }]); // only a deleted entry
    const d = device();
    expect(await d.engine.restoreFromAccount()).toEqual({ result: 'empty' });
    expect(await countAll(d.db)).toBe(0);
    expect(fnsSince(0)).toEqual(['sync_hello']);
    expect(d.engine.getState()).toEqual({ phase: 'noProfile' });
  });

  it("says so, and writes nothing, while another device's first upload has no profile in yet", async () => {
    server.seed(USER, [{ t: 'weights', k: 'w1', data: toServerRow('weights', weight('w1', 80)) }]);
    const d = device();
    expect(await d.engine.restoreFromAccount()).toEqual({ result: 'uploading' });
    expect(await countAll(d.db)).toBe(0);
    expect(fnsSince(0)).toEqual(['sync_hello']);
    expect(d.engine.getState()).toEqual({ phase: 'noProfile' });
  });

  it('writes nothing when the download fails part way', async () => {
    seedOtherDiary();
    const weights = Array.from({ length: 1_100 }, (_, i) => ({ t: 'weights', k: `w${i}`, data: toServerRow('weights', weight(`w${i}`, 70)) }));
    for (let i = 0; i < weights.length; i += 200) server.seed(USER, weights.slice(i, i + 200));
    onCall = (call) => {
      if (call.fn === 'sync_pull' && call.args.p_after !== 0) throw new SyncError('unreachable', 'The connection dropped');
    };
    const d = device();
    await expect(d.engine.restoreFromAccount()).rejects.toMatchObject({ kind: 'unreachable' });

    expect(fnsSince(0)).toEqual(['sync_hello', 'sync_pull', 'sync_pull']);
    expect(await countAll(d.db)).toBe(0);
    expect(d.engine.getState()).toEqual({ phase: 'noProfile', error: 'unreachable' });
  });

  it('refuses a device that has been set up', async () => {
    seedOtherDiary();
    const d = device();
    await setUp(d.db);
    await expect(d.engine.restoreFromAccount()).rejects.toThrow('This device has been set up');
    expect(attempts).toEqual([]);
  });
});

describe('accounts and sessions', () => {
  it('waits while signed in to another account, and switching links this phone to it', async () => {
    const d = await linkedDevice();
    const from = attempts.length;
    d.session.set(signedIn(OTHER));
    await settle();
    expect(d.engine.getState()).toEqual({ phase: 'otherAccount' });

    await d.db.weights.put(weight('w1', 80));
    d.win.dispatchEvent(new Event('online'));
    await timers.advance(30 * MINUTE);
    expect(fnsSince(from)).toEqual([]); // nothing read from or sent to either account

    await d.engine.switchToSignedInAccount();
    await settle();
    expect(d.engine.getState()).toEqual({ phase: 'idle' });
    expect((await readMeta(d.db)).link).toMatchObject({ userId: OTHER, email: 'user-2@example.com' });
    expect(server.live(OTHER)).toEqual(await snapshotOf(d.db));
    expect(server.live(USER).weights?.w1).toBeUndefined();
  });

  it('keeps the queue while signed out, and picks up again when the same user signs in', async () => {
    const d = await linkedDevice();
    d.session.set({ status: 'signedOut' });
    await settle();
    expect(d.engine.getState()).toEqual({ phase: 'needsSignIn' });

    const from = attempts.length;
    await d.db.weights.put(weight('w1', 80));
    await timers.advance(10 * MINUTE);
    expect(fnsSince(from)).toEqual([]);
    expect(await pendingSummary(d.db)).toMatchObject({ pending: 1 });
    expect((await readMeta(d.db)).link).toMatchObject({ userId: USER });

    d.session.set(signedIn());
    await settle();
    expect(d.engine.getState()).toEqual({ phase: 'idle' });
    expect(server.live(USER).weights?.w1).toMatchObject({ kg: 80 });
    expect(await d.db.syncOutbox.count()).toBe(0);
  });

  it('signing out aborts the cycle that is running', async () => {
    const d = await linkedDevice();
    const pull = hold();
    const done = d.engine.syncNow();
    await pull.out;
    d.session.set({ status: 'signedOut' });
    await done;
    await settle();
    expect(pull.aborted()).toBe(true);
    expect(d.engine.getState()).toEqual({ phase: 'needsSignIn' });
  });

  it('a refused session is retried once, then waits for a new sign-in', async () => {
    const d = await linkedDevice();
    fail('needsSignIn');
    const from = attempts.length;
    await d.engine.syncNow();
    await settle();
    expect(fnsSince(from)).toEqual(['sync_pull', 'sync_pull']);
    expect(d.engine.getState()).toEqual({ phase: 'needsSignIn', error: 'needsSignIn' });

    await d.db.weights.put(weight('w1', 80));
    d.win.dispatchEvent(new Event('online'));
    await timers.advance(30 * MINUTE);
    expect(fnsSince(from)).toHaveLength(2);

    onCall = undefined;
    d.session.set({ status: 'signedOut' });
    d.session.set(signedIn());
    await settle();
    expect(d.engine.getState()).toEqual({ phase: 'idle' });
    expect(server.live(USER).weights?.w1).toBeDefined();
  });

  it('after a refused session, a sign-in again as the same user or a refreshed token syncs again', async () => {
    const d = await linkedDevice();
    fail('needsSignIn');
    await d.engine.syncNow();
    await settle();
    expect(d.engine.getState()).toEqual({ phase: 'needsSignIn', error: 'needsSignIn' });
    await d.db.weights.put(weight('w1', 80));
    await timers.advance(10 * MINUTE);

    // The same user and session state again, as SIGNED_IN or TOKEN_REFRESHED pass it on.
    onCall = undefined;
    d.session.set(signedIn());
    await settle();
    expect(d.engine.getState()).toEqual({ phase: 'idle' });
    expect(server.live(USER).weights?.w1).toBeDefined();
  });

  it('a token refreshed while the retry is out gets a try of its own', async () => {
    const d = await linkedDevice();
    const from = attempts.length;
    let refusals = 0;
    onCall = (call) => {
      if (call.fn !== 'sync_pull' || refusals >= 2) return;
      refusals += 1;
      if (refusals === 2) d.session.set(signedIn()); // TOKEN_REFRESHED, during the retry's call
      throw new SyncError('needsSignIn', 'JWT expired');
    };
    await d.engine.syncNow();
    await settle();
    expect(fnsSince(from)).toEqual(['sync_pull', 'sync_pull', 'sync_pull']);
    expect(d.engine.getState()).toEqual({ phase: 'idle' });
  });

  it('after a refused session, an auth event with the same token asks the account nothing', async () => {
    const d = await linkedDevice();
    fail('needsSignIn');
    await d.engine.syncNow();
    await settle();
    const from = attempts.length;
    d.session.echo(); // USER_UPDATED, say: the same session and the same token
    await settle();
    expect(fnsSince(from)).toEqual([]);
    expect(d.engine.getState()).toEqual({ phase: 'needsSignIn', error: 'needsSignIn' });

    await timers.advance(10 * MINUTE);
    onCall = undefined;
    d.session.set(signedIn()); // a new token
    await settle();
    expect(fnsSince(from)).toEqual(['sync_pull']);
    expect(d.engine.getState()).toEqual({ phase: 'idle' });
  });

  /**
   * Every call refused (the project's JWT signing keys changed, say), and every getAuth()
   * refreshes the token and says so: each look brings a new token and an auth event. `at` gets the
   * time of every call. A fuse turns sync off after 1,000 calls, so a loop that never waits ends.
   */
  function refuseEveryToken(d: Device): number[] {
    const at: number[] = [];
    d.session.refreshOnLook = true;
    onCall = () => {
      at.push(timers.now);
      if (at.length >= 1_000) d.flags.configured = false;
      throw new SyncError('needsSignIn', 'Invalid JWT');
    };
    return at;
  }

  it('a session whose every token is refused runs again on its auth events at the backoff pace, not in a loop', async () => {
    const d = await linkedDevice();
    const start = timers.now;
    const looks = d.session.getAuth.mock.calls.length;
    const at = refuseEveryToken(d);
    await d.engine.syncNow();
    await settle();
    await timers.advance(60 * MINUTE);

    // The try and its one retry, the first run on a new token at once, then a minute apart at
    // least, on the backoff: 1, 1, 2, 5, then every 15 minutes.
    expect(at).toHaveLength(10);
    expect(at.map((t) => (t - start) / 1_000)).toEqual([0, 0, 0, 60, 120, 240, 540, 1_440, 2_340, 3_240]);
    expect(d.session.getAuth.mock.calls.length - looks).toBe(at.length);
    expect(d.engine.getState()).toEqual({ phase: 'needsSignIn', error: 'needsSignIn' });
  });

  it.each([
    {
      how: 'signing out and in again',
      signIn: (d: Device) => {
        d.session.set({ status: 'signedOut' });
        d.session.set(signedIn());
      },
    },
    {
      how: 'signing in again from Settings (the same session, then Sync now)',
      signIn: (d: Device) => {
        d.session.set(signedIn());
        void d.engine.syncNow();
      },
    },
  ])('after a long refusal streak, $how syncs at once', async ({ signIn }) => {
    const d = await linkedDevice();
    const at = refuseEveryToken(d);
    await d.engine.syncNow();
    await timers.advance(60 * MINUTE); // the next run on an auth event is 15 minutes away
    expect(d.engine.getState()).toEqual({ phase: 'needsSignIn', error: 'needsSignIn' });
    expect(at.length).toBeLessThan(15);
    await d.db.weights.put(weight('w1', 80));

    onCall = undefined; // the new sign-in's token is accepted
    signIn(d);
    await settle();
    expect(d.engine.getState()).toEqual({ phase: 'idle' });
    expect(server.live(USER).weights?.w1).toMatchObject({ kg: 80 });
    expect(await d.db.syncOutbox.count()).toBe(0);
  });

  it('the same session again changes nothing while sync is fine', async () => {
    const d = await linkedDevice();
    const from = attempts.length;
    d.session.set(signedIn());
    d.session.set({ status: 'signedIn', userId: USER, email: 'user-1@example.com' });
    await settle();
    expect(fnsSince(from)).toEqual([]);
    expect(d.engine.getState()).toEqual({ phase: 'idle' });
  });

  it('opened offline with the session still stored, waits for the connection, not a sign-in', async () => {
    const d = await linkedDevice();
    // supabase-js couldn't refresh on a bad connection: it says signed out, and keeps the session.
    d.session.getAuth.mockRejectedValueOnce(Object.assign(new Error('Failed to fetch'), { name: 'AuthRetryableFetchError', status: 0 }));
    d.session.set({ status: 'signedOut' });
    await settle();
    expect(d.engine.getState()).toMatchObject({ phase: 'error', error: 'unreachable' });

    // The connection is back: the session refreshes and sync goes on.
    d.session.set(signedIn());
    await settle();
    expect(d.engine.getState()).toEqual({ phase: 'idle' });

    // Gone from storage (the server refused it): now it's a sign-in.
    d.session.stored = false;
    d.session.set({ status: 'signedOut' });
    await settle();
    expect(d.engine.getState()).toEqual({ phase: 'needsSignIn' });
  });

  it('signed out with the session still stored but refused by the server, asks to sign in', async () => {
    const d = await linkedDevice();
    // getAuth() answers null: the session was dropped while it looked.
    d.session.getAuth.mockResolvedValueOnce(null);
    d.session.set({ status: 'signedOut' });
    await settle();
    expect(d.engine.getState()).toEqual({ phase: 'needsSignIn' });
  });
});

describe('when the copy in the account is deleted', () => {
  async function reset(): Promise<Device> {
    const d = await linkedDevice();
    server.wipe(USER);
    await d.db.weights.put(weight('w1', 80));
    await d.engine.syncNow();
    expect(d.engine.getState()).toEqual({ phase: 'cloudReset', error: 'cloudReset' });
    return d;
  }

  it('waits for the user, then uploadAfterReset links again and uploads this phone', async () => {
    const d = await reset();
    const from = attempts.length;
    d.win.dispatchEvent(new Event('online'));
    await timers.advance(30 * MINUTE);
    expect(fnsSince(from)).toEqual([]);
    expect((await readMeta(d.db)).lastError).toMatchObject({ kind: 'cloudReset' });

    await d.engine.uploadAfterReset();
    await settle();
    expect(d.engine.getState()).toEqual({ phase: 'idle' });
    expect((await readMeta(d.db)).link?.dataset).toBe(server.dataset(USER));
    expect(server.live(USER)).toEqual(await snapshotOf(d.db));
    expect(server.live(USER).weights?.w1).toBeDefined();
  });

  it('a pull that finds a new copy says so too', async () => {
    const d = await linkedDevice();
    server.wipe(USER);
    await d.engine.syncNow();
    expect(fnsSince(0).at(-1)).toBe('sync_pull');
    expect(d.engine.getState()).toEqual({ phase: 'cloudReset', error: 'cloudReset' });
  });

  it('turnOffAfterReset turns sync off and keeps the data', async () => {
    const d = await reset();
    const before = await snapshotOf(d.db);
    await d.engine.turnOffAfterReset();
    expect(d.engine.getState()).toEqual({ phase: 'paused' });
    expect(await readMeta(d.db)).toEqual({ id: 'sync', paused: true });
    expect(await snapshotOf(d.db)).toEqual(before);
    expect(server.head(USER)).toBe(0);
  });
});

describe('stopping', () => {
  it('stop() during a slow pull, then resetAll, leaves this phone empty and the account as it was', async () => {
    const d = await linkedDevice();
    const rows = server.rows(USER);
    const pull = hold();
    const done = d.engine.syncNow();
    await pull.out;

    await d.engine.stop();
    expect(pull.aborted()).toBe(true);
    await createActions(d.db).resetAll();
    d.engine.resume();
    await done;
    await settle();

    expect(await countAll(d.db)).toBe(0);
    expect(server.rows(USER)).toEqual(rows);
    expect(d.engine.getState()).toEqual({ phase: 'noProfile' });
  });

  it('nothing runs while stopped, and resume() looks again', async () => {
    const d = await linkedDevice();
    await d.engine.stop();
    const from = attempts.length;
    await d.db.weights.put(weight('w1', 80));
    await d.engine.syncNow();
    await timers.advance(10 * MINUTE);
    expect(fnsSince(from)).toEqual([]);

    d.engine.resume();
    await settle();
    expect(fnsSince(from)).toContain('sync_push');
    expect(server.live(USER).weights?.w1).toBeDefined();
  });
});

describe('triggers', () => {
  it('a change syncs 2 s later, and a run of changes after 10 s at most', async () => {
    const d = await linkedDevice();
    const pushedAt: number[] = [];
    onCall = (call) => {
      if (call.fn === 'sync_push') pushedAt.push(timers.now);
    };
    await d.db.weights.put(weight('w1', 80));
    await timers.advance(1_900);
    expect(pushedAt).toEqual([]);
    await timers.advance(100);
    expect(pushedAt).toHaveLength(1);
    expect(server.live(USER).weights?.w1).toBeDefined();

    const first = timers.now;
    for (let i = 0; i < 8; i += 1) {
      await d.db.weights.put(weight('w2', 80 + i));
      await timers.advance(1_500);
    }
    expect(pushedAt[1]).toBe(first + 10_000);
  });

  it('coming online runs at once and starts the backoff again', async () => {
    const d = await linkedDevice();
    fail('unavailable');
    await d.engine.syncNow();
    await timers.advance(10_000);
    expect(retryDelay(d)).toBe(30_000);

    const from = attempts.length;
    d.win.dispatchEvent(new Event('online'));
    await settle();
    expect(fnsSince(from)).toHaveLength(1);
    expect(retryDelay(d)).toBe(10_000);

    onCall = undefined;
    d.win.dispatchEvent(new Event('online'));
    await settle();
    expect(d.engine.getState()).toEqual({ phase: 'idle' });
  });

  it('coming back to the app syncs when the last try is over 30 s old', async () => {
    const d = await linkedDevice();
    await d.engine.syncNow();
    const from = attempts.length;
    await timers.advance(10_000);
    d.doc.show('hidden');
    d.doc.show('visible');
    await settle();
    expect(fnsSince(from)).toEqual([]);

    await timers.advance(21_000);
    d.doc.show('hidden');
    d.doc.show('visible');
    await settle();
    expect(fnsSince(from)).toEqual(['sync_pull']);
  });

  it('going hidden pushes what is waiting, without pulling', async () => {
    const d = await linkedDevice();
    const from = attempts.length;
    await d.db.weights.put(weight('w1', 80));
    await settle();
    d.doc.show('hidden');
    await settle();
    expect(fnsSince(from)).toEqual(['sync_push']);
    expect(await d.db.syncOutbox.count()).toBe(0);

    await d.db.weights.put(weight('w2', 80));
    await settle();
    d.win.dispatchEvent(new Event('pagehide'));
    await settle();
    expect(fnsSince(from)).toEqual(['sync_push', 'sync_push']);
    expect(server.live(USER).weights?.w2).toBeDefined();

    // Nothing waiting: nothing sent.
    d.doc.show('visible');
    d.doc.show('hidden');
    await settle();
    expect(fnsSince(from)).toEqual(['sync_push', 'sync_push']);
  });

  it('polls every 5 minutes, only while the app is visible', async () => {
    const d = await linkedDevice();
    await d.engine.syncNow();
    let from = attempts.length;
    await timers.advance(5 * MINUTE);
    expect(fnsSince(from)).toEqual(['sync_pull']);

    d.doc.show('hidden');
    from = attempts.length;
    await timers.advance(20 * MINUTE);
    expect(fnsSince(from)).toEqual([]);

    d.doc.show('visible'); // the last try was long ago: syncs now
    await settle();
    expect(fnsSince(from)).toEqual(['sync_pull']);
    await timers.advance(5 * MINUTE);
    expect(fnsSince(from)).toEqual(['sync_pull', 'sync_pull']);
  });

  it('offline, waits for the online event and still looks every 2 minutes', async () => {
    const d = await linkedDevice();
    d.flags.online = false;
    const from = attempts.length;
    await d.db.weights.put(weight('w1', 80));
    await timers.advance(2_000);
    expect(d.engine.getState()).toMatchObject({ phase: 'offline', error: 'offline' });
    expect(retryDelay(d)).toBe(2 * MINUTE);

    await timers.advance(2 * MINUTE); // the probe finds it still offline, without a call
    expect(fnsSince(from)).toEqual([]);
    expect(retryDelay(d)).toBe(2 * MINUTE);

    d.flags.online = true;
    d.win.dispatchEvent(new Event('online'));
    await settle();
    expect(d.engine.getState()).toEqual({ phase: 'idle' });
    expect(server.live(USER).weights?.w1).toBeDefined();
  });

  it('flush pushes what is waiting, and stops waiting once its time is up', async () => {
    const d = await linkedDevice();
    const from = attempts.length;
    await d.db.weights.put(weight('w1', 80));
    await d.engine.flush(5_000);
    expect(fnsSince(from)).toEqual(['sync_push']);
    expect(server.live(USER).weights?.w1).toBeDefined();

    // An account that never answers: flush gives up after 5 s.
    const push = hold('sync_push');
    await d.db.weights.put(weight('w2', 80));
    let flushed = false;
    const flushing = d.engine.flush(5_000).then(() => {
      flushed = true;
    });
    await push.out;
    timers.tick(4_900);
    await Promise.resolve();
    expect(flushed).toBe(false);
    timers.tick(100);
    await flushing;
    expect(flushed).toBe(true);
    await d.engine.stop();
    expect(push.aborted()).toBe(true);
  });

  it('Sync now goes even when the browser says it is offline', async () => {
    const d = await linkedDevice();
    d.flags.online = false;
    const from = attempts.length;
    await d.engine.syncNow();
    expect(fnsSince(from)).toEqual(['sync_pull']);
    expect(d.engine.getState()).toEqual({ phase: 'idle' });
  });
});

describe('failures', () => {
  it('backs off 10 s, 30 s, 2 min, 5 min, then 15 min, and starts again after a success', async () => {
    const d = await linkedDevice();
    fail('unavailable');
    await d.engine.syncNow();
    const waits = [retryDelay(d)];
    for (let i = 0; i < 5; i += 1) {
      await timers.advance(retryDelay(d));
      waits.push(retryDelay(d));
    }
    expect(waits).toEqual([10_000, 30_000, 2 * MINUTE, 5 * MINUTE, 15 * MINUTE, 15 * MINUTE]);
    expect(d.engine.getState()).toMatchObject({ phase: 'error', error: 'unavailable' });
    expect((await readMeta(d.db)).lastError).toEqual({ kind: 'unavailable', at: timers.now });

    onCall = undefined;
    await timers.advance(retryDelay(d));
    expect(d.engine.getState()).toEqual({ phase: 'idle' });
    expect((await readMeta(d.db)).lastError).toBeUndefined();

    fail('unavailable');
    await d.db.weights.put(weight('w1', 80));
    await timers.advance(2_000);
    expect(retryDelay(d)).toBe(10_000);
  });

  it('jitters each wait by up to 20 %', async () => {
    const d = await linkedDevice();
    fail('failed');
    vi.mocked(Math.random).mockReturnValue(0);
    await d.engine.syncNow();
    expect(retryDelay(d)).toBe(8_000);
    vi.mocked(Math.random).mockReturnValue(0.999_999);
    await d.engine.syncNow();
    expect(retryDelay(d)).toBe(12_000);
  });

  it('gets no automatic retry when sync.sql is missing', async () => {
    const d = await linkedDevice();
    fail('notSetUp');
    await d.engine.syncNow();
    expect(d.engine.getState()).toEqual({ phase: 'notSetUp', error: 'notSetUp' });

    const from = attempts.length;
    await d.db.weights.put(weight('w1', 80));
    d.win.dispatchEvent(new Event('online'));
    await timers.advance(60 * MINUTE);
    expect(fnsSince(from)).toEqual([]);

    d.doc.show('hidden');
    d.doc.show('visible');
    await settle();
    expect(fnsSince(from)).toHaveLength(1);
    await d.engine.syncNow();
    expect(fnsSince(from)).toHaveLength(2);
  });

  it('sends the rest of a batch past a refused row, and retries the refused one after a restart', async () => {
    const d = await linkedDevice();
    const bad = 'x'.repeat(201); // longer than the account takes
    await d.db.weights.bulkPut([weight(bad, 80), weight('good', 81)]);
    await d.engine.syncNow();
    expect(server.live(USER).weights?.good).toBeDefined();
    expect(await pendingSummary(d.db)).toMatchObject({ pending: 0, failed: 1 });
    expect(d.engine.getState()).toEqual({ phase: 'idle' });
    const sentBad = () => pushedKeys().filter((k) => k === bad).length;
    expect(sentBad()).toBe(1);

    await d.engine.syncNow();
    expect(sentBad()).toBe(1);

    await d.engine.dispose();
    const restarted = device({ db: d.db, session: d.session });
    restarted.engine.start();
    await timers.advance(1_500);
    expect(sentBad()).toBe(2);
    expect(server.live(USER).weights?.[bad]).toBeUndefined();
    expect(await pendingSummary(d.db)).toMatchObject({ pending: 0, failed: 1 });
  });

  /** A key with half an emoji in it: JSON the account can't read, so it refuses the whole push. */
  const halfEmoji = (id: string): string => `${id}${String.fromCharCode(0xd83c)}`;

  it('finds the rows in a push the account refused whole, sets them aside, and sends the rest', async () => {
    const d = await linkedDevice();
    const before = Object.keys(server.live(USER).weights ?? {});
    const bad = [halfEmoji('w3'), halfEmoji('w6')];
    await d.db.weights.bulkPut(['w1', 'w2', bad[0]!, 'w4', 'w5', bad[1]!, 'w7'].map((id, i) => weight(id, 70 + i)));
    await d.engine.syncNow();

    expect(d.engine.getState()).toEqual({ phase: 'idle' });
    expect(Object.keys(server.live(USER).weights ?? {}).sort()).toEqual([...before, 'w1', 'w2', 'w4', 'w5', 'w7'].sort());
    expect(await pendingSummary(d.db)).toMatchObject({ pending: 0, failed: 2 });
    const failed = await d.db.syncOutbox.filter((e) => e.failedAt !== undefined).toArray();
    expect(failed.map((e) => e.key).sort()).toEqual([...bad].sort());
    expect((await snapshotOf(d.db)).weights).toMatchObject(server.live(USER).weights ?? {});

    // Set aside until the next app start: the next sync doesn't send them again.
    const pushes = server.calls.filter((c) => c.fn === 'sync_push').length;
    await d.engine.syncNow();
    expect(server.calls.filter((c) => c.fn === 'sync_push')).toHaveLength(pushes);
  });

  it('sets aside a single row the account refuses whole', async () => {
    const d = await linkedDevice();
    await d.db.weights.put(weight(halfEmoji('w1'), 80));
    const from = attempts.length;
    await d.engine.syncNow();
    expect(fnsSince(from)).toEqual(['sync_push', 'sync_push', 'sync_pull']); // the row, then an empty push
    expect(d.engine.getState()).toEqual({ phase: 'idle' });
    expect(await pendingSummary(d.db)).toMatchObject({ pending: 0, failed: 1 });
  });

  it('when the account refuses even an empty push, sets nothing aside and backs off', async () => {
    const d = await linkedDevice();
    await d.db.weights.bulkPut([weight('w1', 80), weight('w2', 81)]);
    onCall = (call) => {
      if (call.fn === 'sync_push') throw new SyncError('rejected', 'The account refused the call');
    };
    const from = attempts.length;
    await d.engine.syncNow();
    expect(fnsSince(from)).toEqual(['sync_push', 'sync_push']);
    expect(d.engine.getState()).toMatchObject({ phase: 'error', error: 'rejected', retryAt: timers.now + 10_000 });
    expect(await pendingSummary(d.db)).toMatchObject({ pending: 2, failed: 0 });
  });

  it.each(['unreachable', 'unavailable', 'rejected', 'failed'] as const)('says why a %s cycle failed', async (kind) => {
    const d = await linkedDevice();
    fail(kind);
    await d.engine.syncNow();
    expect(d.engine.getState()).toEqual({ phase: 'error', error: kind, retryAt: timers.now + 10_000 });
  });
});

describe('two tabs', () => {
  it('two engines on one database without locks add no duplicate revisions and end the same', async () => {
    const name = `engine-${crypto.randomUUID()}`;
    const first = device({ db: newDb(name), locks: null });
    await setUp(first.db);
    await first.engine.syncNow();
    const second = device({ db: newDb(name), session: first.session, locks: null });
    const head = server.head(USER);

    let edits = 0;
    for (let round = 0; round < 5; round += 1) {
      await first.db.weights.put(weight(`a${round}`, 70 + round));
      await second.db.weights.put(weight(`b${round}`, 80 + round));
      await second.db.profile.update('me', { rolloverHour: round });
      edits += 3;
      await Promise.all([first.engine.syncNow(), second.engine.syncNow()]);
    }
    await Promise.all([first.engine.syncNow(), second.engine.syncNow()]);

    expect(server.head(USER)).toBe(head + edits);
    const revs = server.rows(USER).map((r) => r.rev);
    expect(new Set(revs).size).toBe(revs.length);
    expect(await snapshotOf(first.db)).toEqual(server.live(USER));
    expect(await first.db.syncOutbox.count()).toBe(0);
    expect(first.engine.getState()).toEqual({ phase: 'idle' });
    expect(second.engine.getState()).toEqual({ phase: 'idle' });
  });
});
