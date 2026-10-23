/**
 * This device's reminders (S38, decision §10.19): the browser's push subscription, the account's copy
 * of it (push_subscriptions, through ./remote) and the record that ties them together (./local).
 *
 * Every browser and server piece is injected (PushEngineDeps), so the tests drive it with fakes
 * (./testing/fakePush.ts) and ./index.ts builds the app's one engine over the real browser.
 *
 * - turnOn() asks for permission before anything is awaited (Chrome's prompt needs the tap), subscribes
 *   with the VAPID key and saves the subscription for the signed-in user.
 * - refresh() reconciles at start, on sign-in, on coming back after 6 hours, on the worker's message
 *   and when S38 opens: a rotated endpoint or key is saved again, a row the server dropped is replaced.
 *   A save the account hasn't confirmed, or a problem on the card, is looked at again on coming online
 *   and on coming back to the app; while it waits on the connection or the account, also by itself
 *   (30 s, 2 min, 5 min, then every 15 min), so "Waiting for a connection" finishes on its own.
 * - forget() is Sign out and Delete everything: the server row first, then the browser subscription.
 *   Losing the session by itself removes nothing, so reminders keep coming (D15).
 * - Nothing runs without Supabase and a VAPID key: no listeners, no timers, no network.
 */
import type { SessionState } from '@/auth/session';
import type { SyncErrorKind } from '@/db/syncTypes';
import { isSyncError } from '@/sync/errors';
import { isAllowedPushEndpoint } from '../../supabase/functions/_shared/pushHosts.ts';
import { sameBytes } from './base64url';
import { vapidKeyBytes } from './config';
import type { PushRecord } from './local';
import type { PushRemote, PushSubscriptionWire, TestOutcome } from './remote';
import type { PushSupport } from './support';

export type PushPhase =
  | 'unconfigured'
  | 'devServer'
  | 'unsupported'
  | 'iosNeedsInstall'
  | 'demo'
  | 'starting'
  | 'signedOut'
  | 'denied'
  | 'off'
  | 'checking'
  | 'turningOn'
  | 'on'
  | 'problem';

export interface PushEngineState {
  phase: PushPhase;
  permission: NotificationPermission | 'unsupported';
  /** 'problem': why turning on or checking failed. 'unsupportedService': the browser's push service isn't one the server sends to. */
  error?: SyncErrorKind | 'noWorker' | 'unsupportedService';
  /** 'on': what the account says about this device. */
  device?: { lastOkAt?: string; lastError?: string; failures: number };
  /** This device has a saved (or pending) subscription record: reminders may still arrive while signed out. */
  hasRecord: boolean;
  busy?: 'on' | 'off' | 'test' | 'check';
}

export type TurnOnResult = { ok: true } | { ok: false; problem: 'dismissed' | 'denied' | 'refused' | 'noWorker' | 'unsupportedService' | SyncErrorKind };

/** The parts of a PushSubscription the engine uses. */
export interface PushSubscriptionLike {
  endpoint: string;
  options?: { applicationServerKey?: ArrayBuffer | null } | null;
  toJSON(): { endpoint?: string; keys?: Record<string, string> };
  unsubscribe(): Promise<boolean>;
}

export interface PushManagerLike {
  getSubscription(): Promise<PushSubscriptionLike | null>;
  subscribe(options: { userVisibleOnly: boolean; applicationServerKey: Uint8Array<ArrayBuffer> }): Promise<PushSubscriptionLike>;
}

export interface RegistrationLike {
  pushManager: PushManagerLike;
}

export interface PushTimers {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export interface PushEngineDeps {
  configured: () => boolean;
  vapidKey: () => string | null;
  support: () => PushSupport;
  permission: () => NotificationPermission | 'unsupported';
  requestPermission: () => Promise<NotificationPermission>;
  /** The service worker's registration (navigator.serviceWorker.ready); the engine gives up on it after 10 s. */
  registration: () => Promise<RegistrationLike | null>;
  remote: PushRemote;
  session: { read: () => SessionState; watch: (listener: (s: SessionState) => void) => () => void };
  isDemo: () => Promise<boolean>;
  store: { read: () => PushRecord | null; write: (r: PushRecord) => void; clear: () => void };
  label: () => string;
  now: () => number;
  timers: PushTimers;
  /** visibilitychange → visible. */
  onVisible?: (listener: () => void) => () => void;
  /** window 'online'. */
  onOnline?: (listener: () => void) => () => void;
  /** navigator.permissions.query({ name: 'notifications' }).onchange. */
  onPermissionChange?: (listener: () => void) => () => void;
}

export interface PushEngine {
  start(): void;
  getState(): PushEngineState;
  subscribe(listener: () => void): () => void;
  turnOn(): Promise<TurnOnResult>;
  turnOff(): Promise<void>;
  test(): Promise<TestOutcome>;
  retry(): Promise<TurnOnResult>;
  repair(): Promise<TurnOnResult>;
  refresh(): Promise<void>;
  forget(timeoutMs?: number): Promise<void>;
  /** Tests only: drops listeners and timers. */
  dispose(): void;
}

/** Turning on is refused in these: there is nothing to turn on, or nobody to turn it on for. */
const REFUSED: ReadonlySet<PushPhase> = new Set<PushPhase>(['unconfigured', 'devServer', 'unsupported', 'iosNeedsInstall', 'demo', 'starting', 'signedOut']);
const REGISTRATION_TIMEOUT_MS = 10_000;
/** The first check waits a little after the session is read, so start-up stays quick. */
const FIRST_REFRESH_MS = 3_000;
/** Coming back to the app after this long checks again. */
const STALE_MS = 6 * 3_600_000;
/** A confirmed subscription shows a problem only for these; the rest are the connection, and nothing is wrong with it. */
const SAVED_PROBLEMS: ReadonlySet<SyncErrorKind> = new Set<SyncErrorKind>(['notSetUp', 'needsSignIn', 'failed']);
/** A save waiting on these (the card says Waiting) is tried again by itself. */
const WAITING: ReadonlySet<PushEngineState['error']> = new Set<PushEngineState['error']>(['offline', 'unreachable', 'unavailable']);
/** Its delays, then the last one again. */
const RETRY_MS = [30_000, 120_000, 300_000, 900_000] as const;

export function createPushEngine(deps: PushEngineDeps): PushEngine {
  const listeners = new Set<() => void>();
  const cleanups: (() => void)[] = [];
  let snapshot: PushEngineState | null = null;
  let demo = false;
  let problem: PushEngineState['error'];
  let device: PushEngineState['device'];
  let busy: PushEngineState['busy'];
  let refreshing: Promise<void> | null = null;
  let lastRefreshAt = Number.NEGATIVE_INFINITY;
  let started = false;
  let retryStep = 0;
  let cancelRetry: (() => void) | null = null;

  /** The record, when it belongs to the signed-in user. */
  function ownRecord(session: SessionState): PushRecord | null {
    const record = deps.store.read();
    return record && session.status === 'signedIn' && record.userId === session.userId ? record : null;
  }

  function phaseOf(): PushPhase {
    if (!deps.configured()) return 'unconfigured';
    const support = deps.support();
    if (support !== 'supported') return support;
    if (demo) return 'demo';
    const session = deps.session.read();
    if (session.status === 'loading') return 'starting';
    if (session.status !== 'signedIn') return 'signedOut';
    if (deps.permission() === 'denied') return 'denied';
    if (busy === 'on') return 'turningOn';
    // noWorker and a failed subscribe() leave no record, yet the card says what happened.
    if (problem) return 'problem';
    const record = ownRecord(session);
    if (!record) return 'off';
    return record.pending ? 'checking' : 'on';
  }

  function compute(): PushEngineState {
    const phase = phaseOf();
    const state: PushEngineState = { phase, permission: deps.permission(), hasRecord: deps.store.read() !== null };
    if (phase === 'problem' && problem) state.error = problem;
    if (phase === 'on' && device) state.device = device;
    if (busy) state.busy = busy;
    return state;
  }

  function emit(): void {
    snapshot = compute();
    for (const listener of [...listeners]) listener();
  }

  /** Something left to finish: a save the account hasn't confirmed, or a problem on the card. */
  function unsettled(): boolean {
    return phaseOf() === 'problem' || ownRecord(deps.session.read())?.pending === true;
  }

  function after(ms: number, fn: () => void): () => void {
    const handle = deps.timers.setTimeout(fn, ms);
    return () => deps.timers.clearTimeout(handle);
  }

  /** `promise`, or `fallback` once `ms` have passed. */
  function within<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
    return new Promise<T>((resolve) => {
      const cancel = after(ms, () => resolve(fallback));
      promise.then(
        (value) => {
          cancel();
          resolve(value);
        },
        () => {
          cancel();
          resolve(fallback);
        },
      );
    });
  }

  /** While a save waits on the connection or the account, the next look is booked; anything else cancels it. */
  function scheduleRetry(): void {
    cancelRetry?.();
    cancelRetry = null;
    if (!started || phaseOf() !== 'problem' || !WAITING.has(problem) || deps.store.read()?.pending !== true) {
      retryStep = 0;
      return;
    }
    const ms = RETRY_MS[Math.min(retryStep, RETRY_MS.length - 1)] ?? RETRY_MS[0];
    retryStep += 1;
    cancelRetry = after(ms, () => {
      cancelRetry = null;
      void refresh();
    });
  }

  function registration(ms = REGISTRATION_TIMEOUT_MS): Promise<RegistrationLike | null> {
    return within(deps.registration(), ms, null);
  }

  /** Same key, or one the browser doesn't tell (then it is taken as the same). */
  function sameKey(sub: PushSubscriptionLike, key: string): boolean {
    const own = sub.options?.applicationServerKey;
    return !own || sameBytes(new Uint8Array(own), vapidKeyBytes(key));
  }

  function wireOf(sub: PushSubscriptionLike): PushSubscriptionWire | null {
    const keys = sub.toJSON().keys;
    const p256dh = keys?.p256dh;
    const auth = keys?.auth;
    return sub.endpoint && p256dh && auth ? { endpoint: sub.endpoint, p256dh, auth } : null;
  }

  async function unsubscribeBrowser(ms = REGISTRATION_TIMEOUT_MS): Promise<void> {
    try {
      const reg = await registration(ms);
      const sub = await reg?.pushManager.getSubscription();
      await sub?.unsubscribe();
    } catch {
      // Gone already, or the browser refused: nothing left to do here.
    }
  }

  async function forgetLocally(): Promise<void> {
    await unsubscribeBrowser();
    deps.store.clear();
    problem = undefined;
    device = undefined;
  }

  /** Saves `sub` for `userId`: pending first, confirmed once the account has it. */
  async function save(sub: PushSubscriptionLike, key: string, userId: string, replaces?: string): Promise<TurnOnResult> {
    const wire = wireOf(sub);
    if (!wire) {
      problem = 'failed';
      return { ok: false, problem: 'failed' };
    }
    // The server only sends to browser push services (push.sql refuses the rest): don't save one it
    // would refuse, and leave the browser unsubscribed.
    if (!isAllowedPushEndpoint(wire.endpoint)) {
      await unsubscribeBrowser();
      deps.store.clear();
      problem = 'unsupportedService';
      return { ok: false, problem: 'unsupportedService' };
    }
    deps.store.write({ endpoint: wire.endpoint, userId, vapidKey: key, pending: true });
    const opts: Parameters<PushRemote['subscribe']>[1] = { vapidKey: key, label: deps.label() };
    if (replaces && replaces !== wire.endpoint) opts.replaces = replaces;
    try {
      await deps.remote.subscribe(wire, opts);
    } catch (error) {
      // The browser subscription and the pending record stay: Try again (or the next check) saves them.
      const kind = isSyncError(error) ? error.kind : 'failed';
      problem = kind;
      return { ok: false, problem: kind };
    }
    deps.store.write({ endpoint: wire.endpoint, userId, vapidKey: key, savedAt: deps.now() });
    problem = undefined;
    device = { failures: 0 };
    return { ok: true };
  }

  /** Turn on (asking first), Try again (no prompt) and Set up again (a fresh subscription). */
  async function connect(opts: { ask: boolean; fresh: boolean }): Promise<TurnOnResult> {
    // Chrome's prompt needs the tap: it is asked for before anything is awaited.
    const refused = REFUSED.has(phaseOf());
    const asked = opts.ask && !refused && deps.permission() === 'default' ? deps.requestPermission() : null;
    const session = deps.session.read();
    const key = deps.vapidKey();
    if (refused || session.status !== 'signedIn' || !session.userId || !key) return { ok: false, problem: 'refused' };
    const userId = session.userId;

    let permission = deps.permission();
    if (asked) permission = await asked.catch(() => deps.permission());
    if (permission === 'denied') {
      emit();
      return { ok: false, problem: 'denied' };
    }
    if (permission !== 'granted') {
      emit();
      return { ok: false, problem: 'dismissed' };
    }
    if (await deps.isDemo().catch(() => false)) {
      demo = true;
      emit();
      return { ok: false, problem: 'refused' };
    }

    // A test that sets the device up again stays 'test'; anything else shows "Turning on…".
    const before = busy === 'test' ? 'test' : undefined;
    busy = before ?? 'on';
    problem = undefined;
    emit();
    try {
      const reg = await registration();
      if (!reg) {
        problem = 'noWorker';
        return { ok: false, problem: 'noWorker' };
      }
      const previous = deps.store.read();
      let existing = await reg.pushManager.getSubscription();
      if (existing && (opts.fresh || !sameKey(existing, key))) {
        await existing.unsubscribe().catch(() => false);
        existing = null;
      }
      const sub = existing ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKeyBytes(key) }));
      return await save(sub, key, userId, previous && previous.endpoint !== sub.endpoint ? previous.endpoint : undefined);
    } catch {
      // subscribe() refused: the push service couldn't be reached, or the browser said no.
      problem = 'failed';
      return { ok: false, problem: 'failed' };
    } finally {
      busy = before;
      emit();
      scheduleRetry();
    }
  }

  async function freshSubscription(reg: RegistrationLike, old: PushSubscriptionLike | null, key: string, record: PushRecord): Promise<void> {
    if (old) await old.unsubscribe().catch(() => false);
    const next = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: vapidKeyBytes(key) });
    await save(next, key, record.userId, record.endpoint);
  }

  async function runRefresh(): Promise<void> {
    lastRefreshAt = deps.now();
    // Turning on or off, or a test, is already settling it.
    if (busy === 'on' || busy === 'off' || busy === 'test') return;
    if (deps.store.read() && !busy) {
      busy = 'check';
      emit();
    }
    try {
      demo = await deps.isDemo().catch(() => demo);
      const session = deps.session.read();
      const record = ownRecord(session);
      if (REFUSED.has(phaseOf()) || !deps.store.read()) return;
      // 1. Another account's record: forgotten here, and never touched on the server.
      if (!record) {
        await forgetLocally();
        return;
      }
      // 2. Notifications no longer allowed: the subscription is dead, so the row goes too.
      if (deps.permission() !== 'granted') {
        await deps.remote.unsubscribe(record.endpoint).catch(() => undefined);
        await forgetLocally();
        return;
      }
      const key = deps.vapidKey();
      if (!key) return;
      const reg = await registration();
      if (!reg) {
        if (record.pending) problem = 'noWorker';
        return;
      }
      const sub = await reg.pushManager.getSubscription();
      // 3. No subscription, or one made with another key: a fresh one replaces the row.
      if (!sub || !sameKey(sub, key) || record.vapidKey !== key) {
        await freshSubscription(reg, sub, key, record);
        return;
      }
      // 4. The browser rotated it, or the account never confirmed it: saved (again).
      if (sub.endpoint !== record.endpoint || record.pending) {
        await save(sub, key, record.userId, record.endpoint);
        return;
      }
      // 5. Ask the account; a row it dropped (the push service said gone) is replaced.
      const info = await deps.remote.device(record.endpoint);
      if (!info.found) {
        await freshSubscription(reg, sub, key, record);
        return;
      }
      problem = undefined;
      device = { failures: info.failures };
      if (info.lastOkAt) device.lastOkAt = info.lastOkAt;
      if (info.lastError) device.lastError = info.lastError;
    } catch (error) {
      const kind = isSyncError(error) ? error.kind : 'failed';
      const current = deps.store.read();
      if (current && !current.pending && !SAVED_PROBLEMS.has(kind)) return;
      problem = kind;
    } finally {
      if (busy === 'check') busy = undefined;
      emit();
      scheduleRetry();
    }
  }

  function refresh(): Promise<void> {
    refreshing ??= runRefresh().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  return {
    start() {
      if (started) return;
      started = true;
      if (!deps.configured()) return;
      let previous = deps.session.read();
      let read = previous.status !== 'loading';
      if (read) cleanups.push(after(FIRST_REFRESH_MS, () => void refresh()));
      cleanups.push(
        deps.session.watch((next) => {
          const before = previous;
          previous = next;
          emit();
          if (!read) {
            if (next.status === 'loading') return;
            read = true;
            cleanups.push(after(FIRST_REFRESH_MS, () => void refresh()));
            return;
          }
          if (next.status === 'signedIn' && (before.status !== 'signedIn' || before.userId !== next.userId)) {
            // This can run inside supabase-js's onAuthStateChange: the calls wait for it to finish.
            cleanups.push(after(0, () => void refresh()));
          }
        }),
      );
      if (deps.onVisible) {
        cleanups.push(
          deps.onVisible(() => {
            const unfinished = unsettled();
            if (unfinished) retryStep = 0;
            if (unfinished || deps.now() - lastRefreshAt >= STALE_MS) void refresh();
          }),
        );
      }
      if (deps.onOnline) {
        cleanups.push(
          deps.onOnline(() => {
            if (!unsettled()) return;
            retryStep = 0;
            void refresh();
          }),
        );
      }
      cleanups.push(() => cancelRetry?.());
      if (deps.onPermissionChange) cleanups.push(deps.onPermissionChange(() => void refresh()));
      void deps.isDemo().then(
        (value) => {
          demo = value;
          emit();
        },
        () => undefined,
      );
    },

    getState() {
      snapshot ??= compute();
      return snapshot;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    turnOn: () => connect({ ask: true, fresh: false }),
    retry: () => connect({ ask: false, fresh: false }),
    repair: () => connect({ ask: false, fresh: true }),
    refresh,

    async turnOff() {
      const record = deps.store.read();
      busy = 'off';
      emit();
      try {
        // Best effort: if it fails, the push service answers gone on the next send and the server drops the row.
        if (record) await deps.remote.unsubscribe(record.endpoint).catch(() => undefined);
        await unsubscribeBrowser();
      } finally {
        deps.store.clear();
        problem = undefined;
        device = undefined;
        busy = undefined;
        emit();
        scheduleRetry();
      }
    },

    async test() {
      const record = deps.store.read();
      if (!record) return { ok: false, kind: 'notSubscribed' };
      busy = 'test';
      emit();
      try {
        let outcome = await deps.remote.test(record.endpoint);
        const key = deps.vapidKey();
        const stale =
          !outcome.ok &&
          (outcome.kind === 'notSubscribed' || outcome.kind === 'gone' || (outcome.kind === 'keyMismatch' && record.vapidKey !== key));
        if (stale) {
          // The account lost this device, or it was saved with an old key: set it up again, then once more.
          const repaired = await connect({ ask: false, fresh: true });
          const next = deps.store.read();
          if (!repaired.ok) {
            const kind = repaired.problem;
            return kind === 'dismissed' || kind === 'denied' || kind === 'refused' || kind === 'noWorker' || kind === 'unsupportedService' ? outcome : { ok: false, kind };
          }
          if (next) outcome = await deps.remote.test(next.endpoint);
        }
        if (outcome.ok) device = { ...(device ?? { failures: 0 }), failures: 0, lastOkAt: new Date(deps.now()).toISOString() };
        return outcome;
      } finally {
        busy = undefined;
        emit();
      }
    },

    async forget(timeoutMs = 3_000) {
      const record = deps.store.read();
      if (!record) return;
      const deadline = deps.now() + timeoutMs;
      try {
        // The server row first, while the token is still good; then the browser's own subscription.
        await within(
          deps.remote.unsubscribe(record.endpoint).catch(() => undefined),
          timeoutMs,
          undefined,
        );
        await within(unsubscribeBrowser(timeoutMs), Math.max(0, deadline - deps.now()), undefined);
      } finally {
        deps.store.clear();
        problem = undefined;
        device = undefined;
        emit();
        scheduleRetry();
      }
    },

    dispose() {
      for (const cleanup of cleanups.splice(0)) cleanup();
      listeners.clear();
    },
  };
}
