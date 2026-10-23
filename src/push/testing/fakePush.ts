/**
 * The browser's push pieces and the account's push functions in memory, for tests: a PushManager
 * that hands out subscriptions (and refuses another key while one exists, as Chrome does), a
 * registration whose `ready` a test can hold back, the push_* functions, notification permission,
 * the session and timers a test moves by hand. Test-only; never imported by the app.
 */
import { vi } from 'vitest';
import type { SessionState } from '@/auth/session';
import type { SyncError } from '@/sync/errors';
import { bytesToBase64Url, sameBytes } from '../base64url';
import type { PushEngineDeps, PushManagerLike, PushSubscriptionLike, RegistrationLike } from '../engine';
import type { PushRecord } from '../local';
import type { PushDeviceInfo, PushRemote, PushSubscriptionWire, TestOutcome } from '../remote';

let seq = 0;

/** A host the app accepts (supabase/functions/_shared/pushHosts.ts) and not Google's, which stays in src/drive (src/drive/sources.test.ts). */
function nextEndpoint(): string {
  seq += 1;
  return `https://updates.push.services.mozilla.com/wpush/v2/fake-device-${seq}`;
}

function randomKey(length: number): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(length)));
}

export class FakePushSubscription implements PushSubscriptionLike {
  readonly endpoint: string;
  readonly options: { applicationServerKey: ArrayBuffer | null; userVisibleOnly: boolean };
  readonly p256dh = `B${randomKey(64)}`.slice(0, 87);
  readonly auth = randomKey(16);
  unsubscribed = false;
  private readonly manager: FakePushManager | null;

  constructor(manager: FakePushManager | null, key: Uint8Array | null, endpoint: string = nextEndpoint()) {
    this.manager = manager;
    this.endpoint = endpoint;
    this.options = { applicationServerKey: key ? new Uint8Array(key).buffer : null, userVisibleOnly: true };
  }

  toJSON() {
    return { endpoint: this.endpoint, expirationTime: null, keys: { p256dh: this.p256dh, auth: this.auth } };
  }

  readonly unsubscribe = vi.fn(async () => {
    this.unsubscribed = true;
    if (this.manager?.current === this) this.manager.current = null;
    return true;
  });

  wire(): PushSubscriptionWire {
    return { endpoint: this.endpoint, p256dh: this.p256dh, auth: this.auth };
  }
}

export class FakePushManager implements PushManagerLike {
  current: FakePushSubscription | null = null;
  /** The next subscribe() throws this (the push service unreachable). */
  failSubscribe: Error | null = null;

  readonly getSubscription = vi.fn(async (): Promise<FakePushSubscription | null> => this.current);

  readonly subscribe = vi.fn(async (options: { userVisibleOnly: boolean; applicationServerKey: Uint8Array<ArrayBuffer> }): Promise<FakePushSubscription> => {
    if (this.failSubscribe) throw this.failSubscribe;
    if (this.current) {
      const own = this.current.options.applicationServerKey;
      if (own && !sameBytes(new Uint8Array(own), options.applicationServerKey)) {
        throw new DOMException('A subscription with a different applicationServerKey already exists.', 'InvalidStateError');
      }
      return this.current;
    }
    this.current = new FakePushSubscription(this, options.applicationServerKey);
    return this.current;
  });

  /** A subscription the browser already has (made with `key`). */
  seed(key: Uint8Array | null, endpoint?: string): FakePushSubscription {
    this.current = new FakePushSubscription(this, key, endpoint);
    return this.current;
  }

  /** The push service rotated it: same key, a new endpoint. */
  rotate(): FakePushSubscription {
    const key = this.current?.options.applicationServerKey;
    this.current = new FakePushSubscription(this, key ? new Uint8Array(key) : null);
    return this.current;
  }
}

export class FakeRegistration implements RegistrationLike {
  readonly pushManager = new FakePushManager();
  readonly ready: Promise<FakeRegistration>;
  private release: () => void = () => undefined;

  /** `ready: false`: navigator.serviceWorker.ready never resolves until makeReady(). */
  constructor(opts: { ready?: boolean } = {}) {
    this.ready =
      opts.ready === false
        ? new Promise<FakeRegistration>((resolve) => {
            this.release = () => resolve(this);
          })
        : Promise.resolve(this);
  }

  makeReady(): void {
    this.release();
  }
}

export interface FakeRow extends PushSubscriptionWire {
  vapidKey: string;
  label?: string;
  failures: number;
  lastOkAt?: string;
}

/** The push_* functions and the test call in memory. `order` lists every call in turn. */
export function createFakePushRemote() {
  const rows = new Map<string, FakeRow>();
  const order: string[] = [];
  const fail: { subscribe?: SyncError; unsubscribe?: SyncError; device?: SyncError } = {};
  const hang: { unsubscribe?: boolean } = {};
  const testAnswers: TestOutcome[] = [];

  const remote = {
    subscribe: vi.fn(async (sub: PushSubscriptionWire, opts: { vapidKey: string; label?: string; replaces?: string }) => {
      order.push(`subscribe ${sub.endpoint}`);
      if (fail.subscribe) throw fail.subscribe;
      if (opts.replaces) rows.delete(opts.replaces);
      const row: FakeRow = { ...sub, vapidKey: opts.vapidKey, failures: 0 };
      if (opts.label) row.label = opts.label;
      rows.set(sub.endpoint, row);
    }),
    unsubscribe: vi.fn(async (endpoint: string) => {
      order.push(`unsubscribe ${endpoint}`);
      if (hang.unsubscribe) await new Promise<never>(() => undefined);
      if (fail.unsubscribe) throw fail.unsubscribe;
      rows.delete(endpoint);
    }),
    device: vi.fn(async (endpoint: string): Promise<PushDeviceInfo> => {
      order.push(`device ${endpoint}`);
      if (fail.device) throw fail.device;
      const row = rows.get(endpoint);
      if (!row) return { found: false, failures: 0 };
      const info: PushDeviceInfo = { found: true, failures: row.failures, vapidKey: row.vapidKey };
      if (row.lastOkAt) info.lastOkAt = row.lastOkAt;
      return info;
    }),
    test: vi.fn(async (endpoint: string): Promise<TestOutcome> => {
      order.push(`test ${endpoint}`);
      return testAnswers.shift() ?? (rows.has(endpoint) ? { ok: true } : { ok: false, kind: 'notSubscribed' });
    }),
  } satisfies PushRemote;

  return {
    remote,
    rows,
    order,
    fail,
    hang,
    /** The next test() calls answer these, in turn. */
    answerTests(...answers: TestOutcome[]) {
      testAnswers.push(...answers);
    },
  };
}

/** Notification permission, and what the browser's prompt answers. */
export function fakePermission(initial: NotificationPermission | 'unsupported' = 'default') {
  let state = initial;
  let answer: NotificationPermission = 'granted';
  return {
    read: () => state,
    set(next: NotificationPermission | 'unsupported') {
      state = next;
    },
    /** What the prompt answers: 'default' is closing it without choosing. */
    answerWith(next: NotificationPermission) {
      answer = next;
    },
    request: vi.fn(async (): Promise<NotificationPermission> => {
      if (answer !== 'default') state = answer;
      return answer;
    }),
  };
}

/** A session a test moves with set(); watchers hear every change. */
export function fakeSession(initial: SessionState = { status: 'signedIn', userId: 'user-1', email: 'you@example.com' }) {
  let state = initial;
  const listeners = new Set<(s: SessionState) => void>();
  return {
    read: () => state,
    watch: (listener: (s: SessionState) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(next: SessionState) {
      state = next;
      for (const listener of [...listeners]) listener(state);
    },
    listeners,
  };
}

/** The device's record in memory (localStorage stands in elsewhere). */
export function fakeStore(initial: PushRecord | null = null) {
  let record = initial;
  return {
    read: () => (record ? { ...record } : null),
    write: vi.fn((next: PushRecord) => {
      record = { ...next };
    }),
    clear: vi.fn(() => {
      record = null;
    }),
  };
}

/** Timers a test moves by hand; `advance` fires each one due on the way and lets promises settle. */
export function fakeTimers(start: number) {
  let now = start;
  let id = 0;
  const pending = new Map<number, { at: number; fn: () => void }>();

  const settle = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };

  return {
    now: () => now,
    pendingCount: () => pending.size,
    timers: {
      setTimeout: (fn: () => void, ms: number) => {
        id += 1;
        pending.set(id, { at: now + Math.max(0, ms), fn });
        return id;
      },
      clearTimeout: (handle: unknown) => {
        if (typeof handle === 'number') pending.delete(handle);
      },
    } satisfies PushEngineDeps['timers'],
    settle,
    async advance(ms: number): Promise<void> {
      const end = now + ms;
      await settle();
      for (;;) {
        let next: [number, { at: number; fn: () => void }] | undefined;
        for (const entry of pending) if (entry[1].at <= end && (!next || entry[1].at < next[1].at)) next = entry;
        if (!next) break;
        pending.delete(next[0]);
        now = next[1].at;
        next[1].fn();
        await settle();
      }
      now = end;
      await settle();
    },
  };
}
