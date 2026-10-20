/**
 * The sync engine (ARCHITECTURE.md §6.2): when this device talks to the account, and what it does
 * then. Everything that touches sync state runs as a task, one at a time: a cycle, a restore, or
 * one of the user's choices. Tasks share one promise chain per tab and hold the 'kira-makan-sync'
 * Web Lock across tabs when the browser has one. Correctness never rests on the lock: every apply
 * and acknowledgement in ./local re-checks the link and cursor inside its own transaction.
 *
 * A cycle first checks the gate, in this order: configured, a real profile, not demo, not paused,
 * the session read, signed in, online. A device that isn't linked yet then links (§6.2): an account
 * with no live rows gets this device's data (the first upload, after one last look that no other
 * device got there first; the link keeps `checkPending` until that look passes, and nothing is
 * pushed before), and an account with data waits for the user's choice. A device linked to another
 * account than the signed-in one waits too. Otherwise the cycle pushes the queue, then pulls what
 * changed, and repeats while changes remain (3 rounds at most). A push the account refuses whole is
 * split until the rows it can't take are found and set aside.
 *
 * Triggers: a change (2 s debounce, 10 s at most), coming online, coming back to the app after
 * 30 s, a session change, Sync now, and a poll every 5 minutes while visible. After a refused
 * token, an auth event for the same session runs it again only with another token, and no more
 * than once a minute (then 2, 5 and 15 minutes apart). Going hidden pushes what's queued. Failures
 * back off (10 s up to 15 min) or wait for the user, by kind (./errors).
 *
 * Everything outside the database comes in through SyncEngineDeps, so tests drive the engine with
 * a fake account, session, timers and locks. src/sync/index.ts builds the app's engine.
 */
import { liveQuery } from 'dexie';
import type { AuthInfo, SessionState } from '@/auth/session';
import type { KiraMakanDb } from '@/db/db';
import type { SyncErrorKind, SyncLink, SyncMeta } from '@/db/syncTypes';
import { isSyncError, SyncError, toSyncError } from './errors';
import {
  ackPush,
  applyPage,
  applyRestore,
  bumpProtocolIfNeeded,
  clearCheckPending,
  clearFailedMarks,
  collectPush,
  linkEmptyAccount,
  linkKeepingDevice,
  pendingSummary,
  PUSH_ROWS,
  readMeta,
  recordError,
  recordSuccess,
  RestoreConflict,
  setPaused,
  unlinkKeepingData,
  unlinkUnchecked,
  type PushBatch,
  type RestoreSnapshot,
} from './local';
import type { CloudSummary, PushReply, RemoteCtx, SyncRemote, WireRow } from './remote';
import { hashJson, type DeviceDefaults } from './rows';

export type SyncPhase =
  | 'unconfigured'
  | 'starting'
  | 'noProfile'
  | 'demo'
  | 'paused'
  | 'signedOut'
  | 'needsSignIn'
  | 'choose'
  | 'otherAccount'
  | 'cloudReset'
  | 'notSetUp'
  | 'restoring'
  | 'uploading'
  | 'syncing'
  | 'idle'
  | 'offline'
  | 'error';

export interface SyncProgress {
  done: number;
  total: number;
}

export interface EngineState {
  phase: SyncPhase;
  /**
   * Why the last attempt failed: with offline, error, needsSignIn, notSetUp and cloudReset, or a
   * choice that failed. A cycle that ends in 'error' gives unreachable, unavailable, rejected or failed.
   */
  error?: SyncErrorKind;
  /** 'uploading' (more than 200 changes to send) and 'restoring': entries done of about `total`. */
  progress?: SyncProgress;
  /** 'choose': what the account holds, and how many meals this device has. */
  choice?: { cloud: CloudSummary; localMeals: number };
  /** 'error' and 'offline': when the next automatic try is due (ms, on the engine's clock). */
  retryAt?: number;
}

/**
 * What asked for a cycle: 'change' (the queue grew), 'online', 'visible' (back to the app),
 * 'hidden' (leaving it: push only), 'poll', 'signedIn' (any session change), 'manual' (Sync now),
 * 'retry' (a backoff timer), 'start'.
 */
export type SyncReason = 'start' | 'change' | 'online' | 'visible' | 'hidden' | 'poll' | 'signedIn' | 'manual' | 'retry';

/**
 * 'empty': the account holds no live rows. 'uploading': it holds rows but no profile yet, so
 * another device's first upload is part way (the profile goes first) and a restore would be
 * missing most of the diary.
 */
export type RestoreResult = { result: 'restored'; meals: number } | { result: 'empty' } | { result: 'uploading' };

/** The session as the engine sees it (src/auth/session.ts in the app). */
export interface SyncSession {
  read(): SessionState;
  /**
   * Passive: never starts the client. Called after every auth event, the same session again
   * included (a refreshed token, a sign-in again as the same user). Listeners can run inside
   * supabase-js's auth callback.
   */
  watch(listener: (state: SessionState) => void): () => void;
  ensureStarted(): Promise<void>;
  getAuth(): Promise<AuthInfo | null>;
  /** A session is stored on this device (read without loading supabase-js). */
  hasStored(): boolean;
}

export interface SyncTimers {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** The part of the Web Locks API the engine uses (navigator.locks fits). */
export interface SyncLocks {
  request(name: string, options: { signal?: AbortSignal }, callback: () => Promise<void>): Promise<unknown>;
}

/** What the engine listens to on window (online, pagehide); Window and EventTarget fit. */
export interface EventHost {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

/** What the engine listens to on document (visibilitychange). */
export interface DocumentHost extends EventHost {
  readonly visibilityState: DocumentVisibilityState;
}

export interface SyncEngineDeps {
  db: KiraMakanDb;
  remote: SyncRemote;
  /** Supabase is configured (the deployed app). Without it the engine never starts. */
  configured: () => boolean;
  /** This device's values for the profile fields that never sync. */
  deviceDefaults: () => DeviceDefaults;
  session: SyncSession;
  /** Defaults to Date.now. */
  clock?: () => number;
  /** Defaults to the global setTimeout and clearTimeout. */
  timers?: SyncTimers;
  /** Defaults to navigator.locks when the browser has it. Null runs without a lock. */
  locks?: SyncLocks | null;
  /** Defaults to navigator.onLine. */
  online?: () => boolean;
  /** Default to window and document. */
  win?: EventHost;
  doc?: DocumentHost;
}

export interface SyncEngine {
  /** Starts listening and syncing. Idempotent, and inert when Supabase isn't configured. */
  start(): void;
  /** Stops for good: listeners removed, timers cleared, the running task aborted and awaited. */
  dispose(): Promise<void>;
  /** Aborts the running task and waits for it; nothing runs until every stop() has its resume(). */
  stop(): Promise<void>;
  resume(): void;
  request(reason: SyncReason): void;
  /** Resets the backoff and runs a cycle, online or not. Resolves when it's done (it never rejects). */
  syncNow(): Promise<void>;
  /** One push-only round, given at most `timeoutMs`. Never rejects (before sign-out). */
  flush(timeoutMs: number): Promise<void>;
  /** A new device before setup: downloads the account's diary and writes it in one commit. */
  restoreFromAccount(onProgress?: (progress: SyncProgress) => void): Promise<RestoreResult>;
  /** 'choose': replaces this device's data with the account's. */
  useAccountData(): Promise<void>;
  /** 'choose': links on top of the account and queues this device's data to replace it. */
  keepThisDeviceData(): Promise<void>;
  /** 'choose': turns sync off on this device, linking nothing. */
  notNow(): Promise<void>;
  /** Turns sync back on (the link flow runs again). */
  turnSyncBackOn(): Promise<void>;
  /** 'otherAccount': forgets the old link and links to the signed-in account. */
  switchToSignedInAccount(): Promise<void>;
  /** 'cloudReset': forgets the old link and links again (an emptied account gets this device's data). */
  uploadAfterReset(): Promise<void>;
  /** 'cloudReset': forgets the link and turns sync off on this device. */
  turnOffAfterReset(): Promise<void>;
  getState(): EngineState;
  subscribe(listener: () => void): () => void;
}

const LOCK_NAME = 'kira-makan-sync';
/** Start-up waits this long before loading supabase-js, so the first screen draws first. */
const START_DELAY_MS = 1_500;
const CHANGE_DEBOUNCE_MS = 2_000;
const CHANGE_MAX_WAIT_MS = 10_000;
/** Coming back to the app syncs when the last attempt is older than this. */
const VISIBLE_AFTER_MS = 30_000;
const POLL_MS = 5 * 60_000;
/** While offline the engine still looks again this often (navigator.onLine can be wrong). */
const OFFLINE_PROBE_MS = 2 * 60_000;
const BACKOFF_MS = [10_000, 30_000, 2 * 60_000, 5 * 60_000, 15 * 60_000];
const BACKOFF_CAP_MS = 15 * 60_000;
const JITTER = 0.2;
/** After a refused token, auth events for the same session run it again at most this often. */
const REFUSED_RERUN_MS = 60_000;
/** Per cycle round: at most this many pushes and pulled pages; more work queues another cycle. */
const PUSH_BATCHES = 25;
const PULL_PAGES = 20;
const PULL_LIMIT = 500;
const ROUNDS = 3;
/** A restore pulls bigger pages, and all of them. */
const RESTORE_LIMIT = 1_000;

/** Phases where nothing happens by itself: the user decides. */
const WAITING_FOR_USER: ReadonlySet<SyncPhase> = new Set<SyncPhase>(['choose', 'cloudReset', 'otherAccount']);
const BUSY: ReadonlySet<SyncPhase> = new Set<SyncPhase>(['syncing', 'uploading', 'restoring']);

const noop = (): void => undefined;

function abortedError(message = 'Sync was stopped'): SyncError {
  return new SyncError('aborted', message);
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

function kindOf(error: unknown): SyncErrorKind {
  return isSyncError(error) ? error.kind : 'failed';
}

function sessionKey(state: SessionState): string {
  return `${state.status}:${state.userId ?? ''}`;
}

/** Which link this device has and whether sync is off: what another tab can change under this one. */
function linkKey(meta: SyncMeta | undefined): string {
  const link = meta?.link;
  return `${link ? `${link.userId}/${link.dataset}/${link.deviceId}` : ''}|${meta?.paused ? 'paused' : ''}`;
}

function sameLink(a: SyncLink, b: SyncLink): boolean {
  return a.userId === b.userId && a.dataset === b.dataset && a.deviceId === b.deviceId;
}

function liveTotal(summary: CloudSummary): number {
  return Object.values(summary.counts).reduce<number>((sum, count) => sum + (count ?? 0), 0);
}

function sameState(a: EngineState, b: EngineState): boolean {
  return a.phase === b.phase
    && a.error === b.error
    && a.retryAt === b.retryAt
    && a.choice === b.choice
    && a.progress?.done === b.progress?.done
    && a.progress?.total === b.progress?.total;
}

const browserTimers: SyncTimers = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

function browserLocks(): SyncLocks | null {
  return typeof navigator !== 'undefined' && navigator.locks ? navigator.locks : null;
}

interface TimerSlot {
  armed(): boolean;
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
    armed: () => armed,
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

interface Go {
  auth: AuthInfo;
  /** A short hash of auth.token (the refusal streak compares it). */
  tokenHash: string;
  link: SyncLink | undefined;
}

interface QueuedCycle {
  manual: boolean;
  promise: Promise<void>;
}

interface Observed {
  /** The newest change waiting (the outbox's highest changedAt). */
  last: number | undefined;
  link: string;
}

/**
 * The account refused this session's token, and every try since (a refusal streak). Kept in
 * memory only, and the token only as a short hash: never stored or logged.
 */
interface Refusal {
  /** The hash of the token refused last. */
  token: string | undefined;
  /** An auth event for the same session runs it again no sooner than this (the engine's clock). */
  nextAt: number;
  /** Runs so far on such events: the step into the backoff. */
  reruns: number;
}

export function createSyncEngine(deps: SyncEngineDeps): SyncEngine {
  const { db, remote, session } = deps;
  const clock = deps.clock ?? (() => Date.now());
  const timers = deps.timers ?? browserTimers;
  const locks = deps.locks === undefined ? browserLocks() : deps.locks;
  const online = deps.online ?? (() => typeof navigator === 'undefined' || navigator.onLine !== false);
  const win = deps.win ?? (typeof window === 'undefined' ? undefined : window);
  const doc = deps.doc ?? (typeof document === 'undefined' ? undefined : document);

  let state: EngineState = { phase: deps.configured() ? 'starting' : 'unconfigured' };
  const listeners = new Set<() => void>();

  let started = false;
  /** Started with Supabase configured: triggers count only then. */
  let live = false;
  let disposed = false;
  let stopDepth = 0;
  let chain: Promise<void> = Promise.resolve();
  /** The task holding the chain now. */
  let running: AbortController | null = null;
  /** A cycle waiting its turn: later requests join it. */
  let queued: QueuedCycle | null = null;

  let lastAttemptAt: number | null = null;
  let backoffStep = 0;
  /** The refusal streak's one immediate retry is spent. */
  let signInRetried = false;
  let refusal: Refusal | null = null;
  let relooked = false;
  /** The first upload's progress, kept across cycles until the queue is empty. */
  let upload: SyncProgress | null = null;
  /**
   * The session as the watcher last saw it. Each auth event bumps the epoch and each cycle notes
   * it; `changeEpoch` is the epoch of the last event that changed the session (status or user).
   */
  let seenSession = '';
  let sessionEpoch = 0;
  let changeEpoch = -1;
  let cycleEpoch = -1;
  let observed: Observed | null = null;
  let knownLink = '';
  let changeSince: number | null = null;

  const startSlot = timerSlot(timers);
  const sessionSlot = timerSlot(timers);
  const changeSlot = timerSlot(timers);
  const retrySlot = timerSlot(timers);
  const pollSlot = timerSlot(timers);
  const cleanups: (() => void)[] = [];

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------

  function setState(next: EngineState): void {
    if (sameState(state, next)) return;
    state = next;
    for (const listener of [...listeners]) listener();
  }

  function setPhase(phase: SyncPhase, extra: Omit<EngineState, 'phase'> = {}): void {
    setState({ phase, ...extra });
  }

  /** The gate stopped the cycle: nothing to retry until something changes. */
  function halt(phase: SyncPhase): null {
    resetBackoff();
    setPhase(phase);
    return null;
  }

  function resetBackoff(): void {
    backoffStep = 0;
    retrySlot.clear();
  }

  function succeeded(): void {
    resetBackoff();
    endRefusal();
  }

  /** The refusal streak ends: a cycle went through, someone signed in or out, or Sync now. */
  function endRefusal(): void {
    signInRetried = false;
    refusal = null;
  }

  /** Schedules the next automatic try; returns when it's due. */
  function retryIn(ms: number): number {
    retrySlot.set(ms, () => requestCycle('retry'));
    return clock() + ms;
  }

  function nextBackoff(): number {
    const base = BACKOFF_MS[backoffStep] ?? BACKOFF_CAP_MS;
    backoffStep += 1;
    return Math.round(base * (1 + (Math.random() * 2 - 1) * JITTER));
  }

  // -------------------------------------------------------------------------
  // Tasks
  // -------------------------------------------------------------------------

  /** Holds the sync lock (every tab) around `work` when the browser has one. */
  async function withLock<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    if (!locks) return work();
    let result: { value: T } | undefined;
    try {
      await locks.request(LOCK_NAME, { signal }, async () => {
        result = { value: await work() };
      });
    } catch (error) {
      // Still waiting for another tab when stopped: the lock request is what was aborted.
      if (!result && signal.aborted && !isSyncError(error)) throw abortedError();
      throw error;
    }
    if (!result) throw abortedError();
    return result.value;
  }

  /** Runs `task` after the ones before it. `onTurn` runs when its turn comes, run or not. */
  function enqueue<T>(task: (signal: AbortSignal) => Promise<T>, onTurn?: () => void): Promise<T> {
    const result = chain.then(async () => {
      onTurn?.();
      if (disposed) throw abortedError('Sync has stopped');
      if (stopDepth > 0) throw abortedError();
      const controller = new AbortController();
      running = controller;
      try {
        return await withLock(controller.signal, async () => {
          try {
            return await task(controller.signal);
          } finally {
            // What this task left in syncMeta is this tab's own doing: the link watch skips it.
            try {
              knownLink = linkKey(await readMeta(db));
            } catch {
              // The database closed: nothing to compare with.
            }
          }
        });
      } finally {
        if (running === controller) running = null;
      }
    });
    chain = result.then(noop, noop);
    return result;
  }

  /** A cycle, joined with the one waiting its turn if there is one. Never rejects. */
  function queueCycle(manual: boolean): Promise<void> {
    if (queued) {
      if (manual) queued.manual = true;
      return queued.promise;
    }
    const entry: QueuedCycle = { manual, promise: Promise.resolve() };
    queued = entry;
    entry.promise = enqueue(
      (signal) => cycle(signal, entry.manual),
      () => {
        if (queued === entry) queued = null;
      },
    ).catch(noop);
    return entry.promise;
  }

  /** Whether an automatic trigger may run a cycle in the current phase (§6.2, retry by kind). */
  function blocked(reason: SyncReason): boolean {
    if (reason === 'manual' || reason === 'start' || reason === 'signedIn') return false;
    const { phase, error } = state;
    if (WAITING_FOR_USER.has(phase)) return true;
    // Only start-up, coming back to the app and Sync now look again.
    if (phase === 'notSetUp') return reason !== 'visible';
    // The account refused this session: wait for another one.
    if (phase === 'needsSignIn' && error === 'needsSignIn') return true;
    // A retry is scheduled: changes and polls wait for it.
    if (phase === 'offline' || phase === 'error') return reason === 'change' || reason === 'poll' || reason === 'hidden';
    return false;
  }

  function requestCycle(reason: SyncReason): void {
    if (disposed || blocked(reason)) return;
    if (reason === 'online' || reason === 'visible') resetBackoff();
    void queueCycle(false);
  }

  // -------------------------------------------------------------------------
  // The cycle
  // -------------------------------------------------------------------------

  async function cycle(signal: AbortSignal, manual: boolean): Promise<void> {
    lastAttemptAt = clock();
    cycleEpoch = sessionEpoch;
    const before = state;
    let aborted = false;
    let tokenHash: string | undefined;
    try {
      const go = await gate(signal, manual);
      if (!go) return;
      tokenHash = go.tokenHash;
      if (!go.link) await linkFlow(go.auth, signal);
      else if (go.link.userId !== go.auth.userId) halt('otherAccount');
      else if (go.link.checkPending) await checkedUpload(go.auth, go.link, signal);
      else await rounds(go.link, signal);
    } catch (error) {
      aborted = await failed(error, signal, before, tokenHash);
    } finally {
      if (!aborted) relooked = false;
    }
  }

  /** The gate (§6.2): null when the cycle stops here (the phase says why). */
  async function gate(signal: AbortSignal, manual: boolean): Promise<Go | null> {
    if (!deps.configured()) return halt('unconfigured');
    const profile = await db.profile.get('me');
    if (!profile) return halt('noProfile');
    if (profile.demoMode) return halt('demo');
    const meta = await readMeta(db);
    if (meta.paused) return halt('paused');
    const current = session.read();
    if (current.status === 'unconfigured') return halt('unconfigured');
    // A stored session not read yet: the session change runs the cycle again.
    if (current.status === 'loading' && session.hasStored()) return halt('starting');
    // Signed out with a session still stored: supabase-js reports a refresh that failed on a bad
    // connection that way. getAuth() tells it apart: it rejects for the connection (offline or
    // unreachable), and answers null once the session is gone (the server refused it).
    const ask = current.status === 'signedIn' || (current.status === 'signedOut' && session.hasStored());
    const auth = ask ? await authFor(signal) : null;
    if (!auth) return halt(meta.link ? 'needsSignIn' : 'signedOut');
    const tokenHash = hashJson(auth.token);
    // The account refused this very token: only another one, or Sync now, asks it again.
    if (!manual && refusal?.token === tokenHash) return stillRefused();
    if (!manual && !online()) throw new SyncError('offline', 'The browser is offline');
    return { auth, tokenHash, link: meta.link };
  }

  /** The gate found the token the account refused last: the cycle waits again, asking nothing. */
  function stillRefused(): null {
    retrySlot.clear();
    setPhase('needsSignIn', { error: 'needsSignIn' });
    return null;
  }

  /** getAuth(), cancelled by the signal; a session that can't be checked is offline or unreachable. */
  async function authFor(signal: AbortSignal): Promise<AuthInfo | null> {
    try {
      return await untilAborted(session.getAuth(), signal);
    } catch (error) {
      throw isSyncError(error) ? error : toSyncError(0, error);
    }
  }

  async function requireAuth(signal: AbortSignal): Promise<AuthInfo> {
    const auth = await authFor(signal);
    if (!auth) throw new SyncError('needsSignIn', 'Sign in to sync');
    return auth;
  }

  /**
   * First link (§6.2): signed in with a real profile and no link yet. `again`: the second look,
   * after another device got to the empty account first.
   */
  async function linkFlow(auth: AuthInfo, signal: AbortSignal, again = false): Promise<void> {
    setPhase('syncing');
    const summary = await remote.hello({ userId: auth.userId, signal });
    throwIfAborted(signal);
    if (liveTotal(summary) > 0) {
      // Two diaries can't be merged (two active goals, duplicate Places): the user picks one.
      resetBackoff();
      setPhase('choose', { choice: { cloud: summary, localMeals: await db.meals.count() } });
      return;
    }
    await linkEmptyAccount(db, { userId: auth.userId, email: auth.email, summary, now: clock() });
    upload = null;
    const { link } = await readMeta(db);
    if (!link) throw abortedError('The sync link changed');
    await checkedUpload(auth, link, signal, again);
  }

  /**
   * The first upload to an account that was empty, after one last look. Two devices can both find
   * the account empty, and the later upload would win over the first (its profile included). The
   * link keeps `checkPending` from linkEmptyAccount until a pull from the head hello saw comes back
   * empty, so a look that fails, or a cycle stopped before it, leaves the next cycle to look again
   * before anything is pushed. Anything there means another device got there first: this one
   * unlinks, keeping its data, and the link flow asks which copy to keep.
   */
  async function checkedUpload(auth: AuthInfo, start: SyncLink, signal: AbortSignal, again = false): Promise<void> {
    setPhase('syncing');
    const link = await linkNow(start);
    const page = await remote.pull({ userId: link.userId, signal }, link.cursor, 1);
    throwIfAborted(signal);
    if (page.dataset !== link.dataset || page.rows.length > 0) {
      await unlinkUnchecked(db, link);
      if (again) throw new SyncError('failed', 'Another device is linking to this account');
      await linkFlow(auth, signal, true);
      return;
    }
    await rounds(await clearCheckPending(db, link), signal);
  }

  /** The stored link (with its cursor now), as long as it's still the one the cycle started on. */
  async function linkNow(start: SyncLink): Promise<SyncLink> {
    const { link } = await readMeta(db);
    if (!link || !sameLink(link, start)) throw abortedError('The sync link changed');
    return link;
  }

  /** Push, then pull, while changes remain; then the cycle is done. */
  async function rounds(start: SyncLink, signal: AbortSignal): Promise<void> {
    let more = false;
    let pending = 0;
    for (let round = 0; round < ROUNDS; round += 1) {
      ({ pending } = await pendingSummary(db));
      if (upload) upload = { done: upload.done, total: upload.done + pending };
      else if (pending > PUSH_ROWS) upload = { done: 0, total: pending };
      if (upload) setPhase('uploading', { progress: upload });
      else setPhase('syncing');

      const pushedAll = !(await pushAll(start, signal, true));
      const pulledAll = !(await pullAll(start, signal));
      more = !pushedAll || !pulledAll;
      if (more) break;
      ({ pending } = await pendingSummary(db));
      if (pending === 0) break;
    }
    if (more) {
      // The limits were hit: another cycle goes straight on (the phase stays busy until it does).
      void queueCycle(false);
      return;
    }
    await recordSuccess(db, await linkNow(start), clock());
    if (pending === 0) upload = null;
    succeeded();
    setPhase('idle');
  }

  /** Pushes until the queue is empty: false when it is, true when 25 batches left some. */
  async function pushAll(start: SyncLink, signal: AbortSignal, track: boolean): Promise<boolean> {
    for (let batches = 0; batches < PUSH_BATCHES; batches += 1) {
      throwIfAborted(signal);
      const link = await linkNow(start);
      // The first upload's check hasn't passed: nothing goes (checkedUpload looks first).
      if (link.checkPending) throw abortedError('The first upload has not been checked');
      const batch = await collectPush(db, link);
      if (!batch) return false;
      await send(start, batch, signal);
      if (track && upload) {
        upload = { done: Math.min(upload.total, upload.done + batch.changes.length + batch.noops.length), total: upload.total };
        setPhase('uploading', { progress: upload });
      }
      await pause();
    }
    return (await pendingSummary(db)).pending > 0;
  }

  /** Pushes one batch and records the answer. `checked`: the account already took an empty push. */
  async function send(start: SyncLink, batch: PushBatch, signal: AbortSignal, checked = false): Promise<void> {
    throwIfAborted(signal);
    const link = await linkNow(start);
    // Only rows that need nothing sent: acknowledged without asking the account.
    let reply: PushReply = { dataset: link.dataset, prevHead: link.cursor, head: link.cursor, results: [] };
    if (batch.changes.length > 0) {
      try {
        reply = await remote.push({ userId: link.userId, signal }, link.dataset, link.deviceId, batch.changes);
      } catch (error) {
        if (signal.aborted || !isSyncError(error, 'rejected')) throw error;
        await refused(start, batch, signal, checked);
        return;
      }
      throwIfAborted(signal);
    }
    await ackPush(db, link, batch, reply, deps.deviceDefaults());
  }

  /**
   * The account refused a whole push (400 or 22xxx): a value Postgres can't read, such as half an
   * emoji in a key, fails the call rather than its row. An empty push first checks it was the
   * rows; refused too, it's the call itself, and the cycle fails as any other. Then the batch is
   * halved until each refused part is one row, set aside as a row answered 'invalid' is (failedAt,
   * until the next app start), so every other row still goes and the queue never stalls on it.
   */
  async function refused(start: SyncLink, batch: PushBatch, signal: AbortSignal, checked: boolean): Promise<void> {
    if (!checked) {
      const link = await linkNow(start);
      await remote.push({ userId: link.userId, signal }, link.dataset, link.deviceId, []);
      throwIfAborted(signal);
    }
    if (batch.changes.length === 1) {
      const link = await linkNow(start);
      const reply: PushReply = { dataset: link.dataset, prevHead: link.cursor, head: link.cursor, results: [{ i: 0, s: 'invalid' }] };
      await ackPush(db, link, batch, reply, deps.deviceDefaults());
      return;
    }
    const half = Math.ceil(batch.changes.length / 2);
    // The rows with nothing to send go with the first half.
    await send(start, { changes: batch.changes.slice(0, half), sent: batch.sent.slice(0, half), noops: batch.noops }, signal, true);
    await send(start, { changes: batch.changes.slice(half), sent: batch.sent.slice(half), noops: [] }, signal, true);
  }

  /** Pulls until a short page: false when caught up, true when 20 pages left more. */
  async function pullAll(start: SyncLink, signal: AbortSignal): Promise<boolean> {
    for (let pages = 0; pages < PULL_PAGES; pages += 1) {
      throwIfAborted(signal);
      const link = await linkNow(start);
      const page = await remote.pull({ userId: link.userId, signal }, link.cursor, PULL_LIMIT);
      throwIfAborted(signal);
      if (page.dataset !== link.dataset) throw new SyncError('cloudReset', 'The synced copy in this account changed');
      const { cursor } = await applyPage(db, link, link.cursor, page, PULL_LIMIT, deps.deviceDefaults());
      // Short and applied: caught up. Short but dropped (another tab moved the cursor back): again.
      if (page.rows.length < PULL_LIMIT && cursor >= page.head) return false;
      await pause();
    }
    return true;
  }

  /** Lets the page breathe between batches. */
  function pause(): Promise<void> {
    return new Promise((resolve) => {
      timers.setTimeout(resolve, 0);
    });
  }

  /**
   * Sets the phase for a failed cycle and schedules what's next. True when it was aborted.
   * `tokenHash`: the token the cycle got from getAuth(), for a refusal.
   */
  async function failed(error: unknown, signal: AbortSignal, before: EngineState, tokenHash: string | undefined): Promise<boolean> {
    const kind = signal.aborted ? 'aborted' : kindOf(error);
    if (kind === 'aborted') {
      if (BUSY.has(state.phase)) setState(BUSY.has(before.phase) ? { phase: 'idle' } : before);
      // Not our own stop or sign-out: the link changed under the cycle (another tab, a wipe). Look again, once.
      if (!signal.aborted && !relooked) {
        relooked = true;
        void queueCycle(false);
      }
      return true;
    }
    if (kind === 'needsSignIn') {
      if (!signInRetried) {
        // Once a streak: the next cycle's getAuth() refreshes a token that runs out.
        signInRetried = true;
        void queueCycle(false);
        return false;
      }
      refusal = { token: tokenHash, nextAt: refusal?.nextAt ?? clock(), reruns: refusal?.reruns ?? 0 };
    }
    try {
      await recordError(db, kind, clock());
    } catch {
      // The phase still says it in this tab.
    }
    if (kind === 'offline') {
      setPhase('offline', { error: kind, retryAt: retryIn(OFFLINE_PROBE_MS) });
    } else if (kind === 'needsSignIn' || kind === 'notSetUp' || kind === 'cloudReset') {
      retrySlot.clear();
      setPhase(kind, { error: kind });
    } else {
      setPhase('error', { error: kind, retryAt: retryIn(nextBackoff()) });
    }
    // An auth event came while the refused cycle ran: it gets its turn once the streak allows.
    if (kind === 'needsSignIn' && sessionEpoch > cycleEpoch) sessionSoon();
    return false;
  }

  // -------------------------------------------------------------------------
  // Push only (leaving the app, before sign-out)
  // -------------------------------------------------------------------------

  async function pushOnly(signal: AbortSignal): Promise<void> {
    if (!deps.configured()) return;
    const meta = await readMeta(db);
    const link = meta.link;
    // Unchecked (checkPending): the next cycle looks before anything goes.
    if (!link || meta.paused || link.checkPending) return;
    const profile = await db.profile.get('me');
    if (!profile || profile.demoMode || session.read().status !== 'signedIn') return;
    const auth = await authFor(signal);
    if (!auth || auth.userId !== link.userId) return;
    await pushAll(link, signal, false);
  }

  function pushSoon(): void {
    // A running task pushes anyway; a failing account isn't asked again on the way out.
    if (!live || disposed || stopDepth > 0 || running || observed?.last === undefined || blocked('hidden')) return;
    void enqueue(pushOnly).catch(noop);
  }

  // -------------------------------------------------------------------------
  // Triggers
  // -------------------------------------------------------------------------

  function changeSoon(): void {
    const now = clock();
    changeSince ??= now;
    const wait = Math.max(0, Math.min(CHANGE_DEBOUNCE_MS, changeSince + CHANGE_MAX_WAIT_MS - now));
    changeSlot.set(wait, () => {
      changeSince = null;
      requestCycle('change');
    });
  }

  function visible(): boolean {
    return doc?.visibilityState !== 'hidden';
  }

  function startPoll(): void {
    pollSlot.set(POLL_MS, () => {
      startPoll();
      request('poll');
    });
  }

  function request(reason: SyncReason): void {
    if (!live || disposed) return;
    if (reason === 'change') return changeSoon();
    if (reason === 'hidden') return pushSoon();
    if (reason === 'manual') {
      void syncNow();
      return;
    }
    if (reason === 'visible' && lastAttemptAt !== null && clock() - lastAttemptAt < VISIBLE_AFTER_MS) return;
    requestCycle(reason);
  }

  /** The account refused the last session's token: the engine waits for a new one. */
  function refusedSession(): boolean {
    return state.phase === 'needsSignIn' && state.error === 'needsSignIn';
  }

  function onSession(next: SessionState): void {
    const key = sessionKey(next);
    const changed = key !== seenSession;
    // Signed out again: nothing new.
    if (!changed && next.status !== 'signedIn') return;
    const wasSignedIn = seenSession.startsWith('signedIn:');
    seenSession = key;
    sessionEpoch += 1;
    if (changed) {
      changeEpoch = sessionEpoch;
      // Signed in or out, or someone else now: a refusal streak starts over.
      endRefusal();
    }
    // Signed out, or someone else now: what's running was for the old session.
    if (changed && wasSignedIn) running?.abort();
    sessionSoon();
  }

  /**
   * The cycle for the auth events seen. This can run inside supabase-js's auth callback, where a
   * Supabase call would wait on the lock the callback holds: the cycle starts after it, unless one
   * has started since. The same session again (a refreshed token, a sign-in again as the same user)
   * runs it only when the account refused the last token, and then at the streak's pace: the first
   * time at once, then a minute apart at least, following the backoff (2, 5, then 15 minutes). A
   * session whose every token is refused, with a refresh on every look, can't spin. The gate asks
   * the account only when getAuth() now gives another token than the refused one.
   */
  function sessionSoon(): void {
    // Clamped to the cap, so a clock set back during a streak can't stretch the wait.
    const wait = changeEpoch > cycleEpoch || !refusal ? 0 : Math.min(BACKOFF_CAP_MS, Math.max(0, refusal.nextAt - clock()));
    sessionSlot.set(wait, () => {
      if (changeEpoch > cycleEpoch) {
        requestCycle('signedIn');
        return;
      }
      if (sessionEpoch <= cycleEpoch || !refusedSession()) return;
      if (refusal) {
        refusal.nextAt = clock() + Math.max(REFUSED_RERUN_MS, BACKOFF_MS[refusal.reruns] ?? BACKOFF_CAP_MS);
        refusal.reruns += 1;
      }
      requestCycle('signedIn');
    });
  }

  function onObserved(next: Observed): void {
    const before = observed;
    observed = next;
    if (!before) {
      knownLink = next.link;
      return;
    }
    if (next.last !== undefined && (before.last === undefined || next.last > before.last)) changeSoon();
    if (next.link !== knownLink && !running) {
      // Another tab linked, unlinked or turned sync off (this tab's own tasks update knownLink).
      knownLink = next.link;
      void queueCycle(false);
    } else if (running) {
      knownLink = next.link;
    }
  }

  function listen(target: EventHost | undefined, type: string, listener: () => void): void {
    if (!target) return;
    target.addEventListener(type, listener);
    cleanups.push(() => target.removeEventListener(type, listener));
  }

  // -------------------------------------------------------------------------
  // The user's choices
  // -------------------------------------------------------------------------

  /**
   * A choice as a task. When it fails it rejects, and the state goes back to what it was (or to
   * `fallback`) with `error`; when the device changed under it, the gate looks again.
   */
  function choice<T>(work: (signal: AbortSignal) => Promise<T>, fallback?: EngineState): Promise<T> {
    return enqueue(async (signal) => {
      const before: EngineState = BUSY.has(state.phase) ? { phase: 'idle' } : state;
      try {
        return await work(signal);
      } catch (error) {
        if (error instanceof RestoreConflict || kindOf(error) === 'aborted') {
          setState(before);
          if (!signal.aborted) void queueCycle(false);
        } else {
          setState({ ...(fallback ?? before), error: kindOf(error) });
        }
        throw error;
      }
    });
  }

  /** Every row the account holds (the latest version of each key), page by page from the start. */
  async function download(ctx: RemoteCtx, summary: CloudSummary, report: (progress: SyncProgress) => void): Promise<RestoreSnapshot> {
    const total = liveTotal(summary);
    const rows = new Map<string, WireRow>();
    let after = 0;
    let seen = 0;
    report({ done: 0, total });
    for (;;) {
      throwIfAborted(ctx.signal);
      const page = await remote.pull(ctx, after, RESTORE_LIMIT);
      if (page.dataset !== summary.dataset) throw new SyncError('cloudReset', 'The synced copy in this account changed');
      for (const row of page.rows) {
        const id = `${row.t}\u0000${row.k}`;
        const kept = rows.get(id);
        if (!kept || kept.rev < row.rev) rows.set(id, row);
      }
      seen += page.rows.length;
      report({ done: Math.min(seen, total), total });
      const last = page.rows.at(-1)?.rev;
      // Head and rows come from one snapshot: a short page has seen everything up to head.
      if (page.rows.length < RESTORE_LIMIT || last === undefined) {
        return { dataset: summary.dataset, head: Math.max(page.head, last ?? 0), rows: [...rows.values()] };
      }
      after = last;
    }
  }

  // -------------------------------------------------------------------------
  // The engine
  // -------------------------------------------------------------------------

  function syncNow(): Promise<void> {
    if (disposed) return Promise.resolve();
    resetBackoff();
    endRefusal();
    return queueCycle(true);
  }

  return {
    start() {
      if (started || disposed) return;
      started = true;
      if (!deps.configured()) {
        setPhase('unconfigured');
        return;
      }
      live = true;
      // Once per app start: refused rows get another try, and an older link pulls again once.
      void enqueue(async () => {
        await clearFailedMarks(db);
        await bumpProtocolIfNeeded(db);
      }).catch(noop);

      seenSession = sessionKey(session.read());
      cleanups.push(session.watch(onSession));
      listen(win, 'online', () => request('online'));
      listen(win, 'pagehide', () => request('hidden'));
      listen(doc, 'visibilitychange', () => {
        if (visible()) {
          startPoll();
          request('visible');
        } else {
          pollSlot.clear();
          request('hidden');
        }
      });
      // Fires after every capture, in any tab, and when another tab links or unlinks.
      const subscription = liveQuery(async (): Promise<Observed> => {
        const last = await db.syncOutbox.orderBy('changedAt').lastKey();
        const meta = await db.syncMeta.get('sync');
        return { last: typeof last === 'number' ? last : undefined, link: linkKey(meta) };
      }).subscribe({ next: onObserved, error: noop });
      cleanups.push(() => subscription.unsubscribe());
      if (visible()) startPoll();

      // supabase-js loads only for a stored session; without one, nothing loads until a sign-in.
      startSlot.set(START_DELAY_MS, () => {
        if (session.hasStored()) void session.ensureStarted();
        if (lastAttemptAt === null) requestCycle('start');
      });
    },

    async dispose() {
      if (disposed) return;
      disposed = true;
      for (const cleanup of cleanups.splice(0)) cleanup();
      for (const slot of [startSlot, sessionSlot, changeSlot, retrySlot, pollSlot]) slot.clear();
      running?.abort();
      await chain;
    },

    async stop() {
      stopDepth += 1;
      running?.abort();
      await chain;
    },

    resume() {
      if (stopDepth === 0) return;
      stopDepth -= 1;
      // What was stopped (Delete everything) changed this device: look at it again.
      if (stopDepth === 0 && live && !disposed) void queueCycle(false);
    },

    request,
    syncNow,

    async flush(timeoutMs) {
      if (disposed || stopDepth > 0) return;
      const pushed = enqueue(pushOnly).catch(noop);
      const slot = timerSlot(timers);
      await new Promise<void>((resolve) => {
        slot.set(timeoutMs, resolve);
        void pushed.then(resolve);
      });
      slot.clear();
    },

    restoreFromAccount(onProgress) {
      return choice(async (signal): Promise<RestoreResult> => {
        if (await db.profile.get('me')) throw new RestoreConflict('This device has been set up');
        const auth = await requireAuth(signal);
        const ctx: RemoteCtx = { userId: auth.userId, signal };
        const report = (progress: SyncProgress) => {
          setPhase('restoring', { progress });
          onProgress?.(progress);
        };
        report({ done: 0, total: 0 });
        const summary = await remote.hello(ctx);
        if (!summary.counts.profile) {
          setPhase('noProfile');
          return { result: liveTotal(summary) > 0 ? 'uploading' : 'empty' };
        }
        const snapshot = await download(ctx, summary, report);
        throwIfAborted(signal);
        const { meals } = await applyRestore(db, snapshot, {
          userId: auth.userId,
          email: auth.email,
          expect: 'noProfile',
          defaults: deps.deviceDefaults(),
          now: clock(),
        });
        upload = null;
        succeeded();
        setPhase('idle');
        return { result: 'restored', meals };
      }, { phase: 'noProfile' });
    },

    useAccountData() {
      return choice(async (signal) => {
        const auth = await requireAuth(signal);
        const ctx: RemoteCtx = { userId: auth.userId, signal };
        const report = (progress: SyncProgress) => setPhase('restoring', { progress });
        report({ done: 0, total: 0 });
        const summary = await remote.hello(ctx);
        const snapshot = await download(ctx, summary, report);
        throwIfAborted(signal);
        await applyRestore(db, snapshot, {
          userId: auth.userId,
          email: auth.email,
          expect: 'replace',
          defaults: deps.deviceDefaults(),
          now: clock(),
        });
        upload = null;
        succeeded();
        setPhase('idle');
      });
    },

    async keepThisDeviceData() {
      await choice(async (signal) => {
        const auth = await requireAuth(signal);
        setPhase('syncing');
        const keys = await remote.keys({ userId: auth.userId, signal });
        throwIfAborted(signal);
        await linkKeepingDevice(db, { userId: auth.userId, email: auth.email, keys, now: clock() });
        upload = null;
      });
      // The upload runs as a cycle of its own, with its own retries.
      void queueCycle(false);
    },

    async notNow() {
      await choice(async () => {
        await setPaused(db, true);
        halt('paused');
      });
    },

    async turnSyncBackOn() {
      await choice(async () => {
        await setPaused(db, false);
        upload = null;
      });
      void queueCycle(false);
    },

    async switchToSignedInAccount() {
      await choice(async (signal) => {
        const auth = await requireAuth(signal);
        const { link } = await readMeta(db);
        if (link && link.userId !== auth.userId) await unlinkKeepingData(db);
        upload = null;
      });
      void queueCycle(false);
    },

    async uploadAfterReset() {
      await choice(async () => {
        await unlinkKeepingData(db);
        upload = null;
      });
      void queueCycle(false);
    },

    async turnOffAfterReset() {
      await choice(async () => {
        await unlinkKeepingData(db, { pause: true });
        upload = null;
        halt('paused');
      });
    },

    getState: () => state,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
