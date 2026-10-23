// @vitest-environment node
/*
 * The reminders engine against the fakes in ./testing/fakePush: a PushManager, a registration, the
 * push_* functions, permission, the session, the device's record and timers moved by hand.
 */
import type { SessionState } from '@/auth/session';
import { SyncError } from '@/sync/errors';
import { bytesToBase64Url } from './base64url';
import { createPushEngine, type PushEngineDeps } from './engine';
import type { PushRecord } from './local';
import type { PushSupport } from './support';
import { createFakePushRemote, fakePermission, fakeSession, fakeStore, fakeTimers, FakeRegistration } from './testing/fakePush';

const START = Date.parse('2026-10-22T02:00:00.000Z');
const HOUR = 3_600_000;
const KEY_BYTES = Uint8Array.from({ length: 65 }, (_, i) => (i === 0 ? 4 : i));
const OLD_KEY_BYTES = Uint8Array.from({ length: 65 }, (_, i) => (i === 0 ? 4 : 200 - i));
const KEY = bytesToBase64Url(KEY_BYTES);
const OLD_KEY = bytesToBase64Url(OLD_KEY_BYTES);
const USER = 'user-1';
const SIGNED_IN: SessionState = { status: 'signedIn', userId: USER, email: 'you@example.com' };

interface Options {
  permission?: NotificationPermission | 'unsupported';
  session?: SessionState;
  record?: PushRecord | null;
  ready?: boolean;
  configured?: boolean;
  support?: PushSupport;
  demo?: boolean;
}

function setup(opts: Options = {}) {
  const reg = new FakeRegistration({ ready: opts.ready ?? true });
  const server = createFakePushRemote();
  const permission = fakePermission(opts.permission ?? 'default');
  const session = fakeSession(opts.session ?? SIGNED_IN);
  const store = fakeStore(opts.record ?? null);
  const clock = fakeTimers(START);
  const visible = new Set<() => void>();
  const online = new Set<() => void>();
  const permissionChanges = new Set<() => void>();
  let demo = opts.demo ?? false;
  const deps: PushEngineDeps = {
    configured: () => opts.configured ?? true,
    vapidKey: () => KEY,
    support: () => opts.support ?? 'supported',
    permission: permission.read,
    requestPermission: permission.request,
    registration: vi.fn(() => reg.ready),
    remote: server.remote,
    session: { read: session.read, watch: session.watch },
    isDemo: vi.fn(async () => demo),
    store,
    label: () => 'Android',
    now: clock.now,
    timers: clock.timers,
    onVisible: (listener) => {
      visible.add(listener);
      return () => visible.delete(listener);
    },
    onOnline: (listener) => {
      online.add(listener);
      return () => online.delete(listener);
    },
    onPermissionChange: (listener) => {
      permissionChanges.add(listener);
      return () => permissionChanges.delete(listener);
    },
  };
  const engine = createPushEngine(deps);
  return {
    engine,
    deps,
    reg,
    manager: reg.pushManager,
    server,
    permission,
    session,
    store,
    clock,
    visible,
    online,
    permissionChanges,
    setDemo: (value: boolean) => (demo = value),
  };
}

/** A device that turned reminders on earlier: the browser subscription, the server row and the record. */
function onDevice(opts: Options & { key?: Uint8Array; recordKey?: string; pending?: boolean } = {}) {
  const world = setup({ permission: 'granted', ...opts });
  const sub = world.manager.seed(opts.key ?? KEY_BYTES);
  world.server.rows.set(sub.endpoint, { ...sub.wire(), vapidKey: opts.recordKey ?? KEY, failures: 0 });
  const record: PushRecord = opts.pending
    ? { endpoint: sub.endpoint, userId: USER, vapidKey: opts.recordKey ?? KEY, pending: true }
    : { endpoint: sub.endpoint, userId: USER, vapidKey: opts.recordKey ?? KEY, savedAt: START - HOUR };
  world.store.write(record);
  world.store.write.mockClear();
  return { ...world, sub };
}

describe('turnOn', () => {
  it('asks for permission inside the tap, subscribes with the VAPID key and saves it', async () => {
    const w = setup();
    const turning = w.engine.turnOn();
    // Called before anything was awaited: Chrome shows its prompt only inside the tap.
    expect(w.permission.request).toHaveBeenCalledTimes(1);
    expect(await turning).toEqual({ ok: true });

    expect(w.manager.subscribe).toHaveBeenCalledTimes(1);
    const options = w.manager.subscribe.mock.calls[0]?.[0];
    expect(options?.userVisibleOnly).toBe(true);
    expect(Array.from(options?.applicationServerKey ?? [])).toEqual(Array.from(KEY_BYTES));
    const sub = w.manager.current;
    expect(w.server.remote.subscribe).toHaveBeenCalledWith(sub?.wire(), { vapidKey: KEY, label: 'Android' });
    expect(w.store.read()).toEqual({ endpoint: sub?.endpoint, userId: USER, vapidKey: KEY, savedAt: START });
    expect(w.engine.getState()).toMatchObject({ phase: 'on', permission: 'granted', hasRecord: true, device: { failures: 0 } });
  });

  it('stops when the prompt is closed, and says blocked when it is refused', async () => {
    const dismissed = setup();
    dismissed.permission.answerWith('default');
    expect(await dismissed.engine.turnOn()).toEqual({ ok: false, problem: 'dismissed' });
    expect(dismissed.manager.subscribe).not.toHaveBeenCalled();
    expect(dismissed.engine.getState().phase).toBe('off');

    const denied = setup();
    denied.permission.answerWith('denied');
    expect(await denied.engine.turnOn()).toEqual({ ok: false, problem: 'denied' });
    expect(denied.manager.subscribe).not.toHaveBeenCalled();
    expect(denied.engine.getState().phase).toBe('denied');
  });

  it("never saves a push address the server wouldn't send to, and unsubscribes the browser", async () => {
    const w = setup({ permission: 'granted' });
    w.manager.seed(KEY_BYTES, 'https://push.evil.example/collect');

    expect(await w.engine.turnOn()).toEqual({ ok: false, problem: 'unsupportedService' });
    expect(w.server.remote.subscribe).not.toHaveBeenCalled();
    expect(w.store.read()).toBeNull();
    expect(w.manager.current).toBeNull();
    expect(w.engine.getState()).toMatchObject({ phase: 'problem', error: 'unsupportedService', hasRecord: false });
  });

  it("doesn't ask again once permission is granted", async () => {
    const w = setup({ permission: 'granted' });
    expect(await w.engine.turnOn()).toEqual({ ok: true });
    expect(w.permission.request).not.toHaveBeenCalled();
  });

  it('reuses a subscription made with the same key', async () => {
    const w = setup({ permission: 'granted' });
    const existing = w.manager.seed(KEY_BYTES);
    expect(await w.engine.turnOn()).toEqual({ ok: true });
    expect(w.manager.subscribe).not.toHaveBeenCalled();
    expect(existing.unsubscribe).not.toHaveBeenCalled();
    expect(w.store.read()?.endpoint).toBe(existing.endpoint);
  });

  it('replaces one made with another key, and the row of the recorded endpoint', async () => {
    const w = setup({ permission: 'granted' });
    const old = w.manager.seed(OLD_KEY_BYTES);
    w.store.write({ endpoint: old.endpoint, userId: USER, vapidKey: OLD_KEY, savedAt: START - HOUR });
    expect(await w.engine.turnOn()).toEqual({ ok: true });
    expect(old.unsubscribe).toHaveBeenCalled();
    const fresh = w.manager.current;
    expect(fresh?.endpoint).not.toBe(old.endpoint);
    expect(w.server.remote.subscribe).toHaveBeenCalledWith(fresh?.wire(), { vapidKey: KEY, label: 'Android', replaces: old.endpoint });
  });

  it('keeps the subscription and a pending record when the server refuses, and Try again saves it', async () => {
    const w = setup({ permission: 'granted' });
    w.server.fail.subscribe = new SyncError('notSetUp');
    expect(await w.engine.turnOn()).toEqual({ ok: false, problem: 'notSetUp' });
    const sub = w.manager.current;
    expect(sub?.unsubscribed).toBe(false);
    expect(w.store.read()).toEqual({ endpoint: sub?.endpoint, userId: USER, vapidKey: KEY, pending: true });
    expect(w.engine.getState()).toMatchObject({ phase: 'problem', error: 'notSetUp' });

    delete w.server.fail.subscribe;
    expect(await w.engine.retry()).toEqual({ ok: true });
    expect(w.manager.subscribe).toHaveBeenCalledTimes(1);
    expect(w.store.read()).toEqual({ endpoint: sub?.endpoint, userId: USER, vapidKey: KEY, savedAt: START });
    expect(w.engine.getState().phase).toBe('on');
  });

  it('gives up on a service worker that never gets ready after 10 seconds', async () => {
    const w = setup({ permission: 'granted', ready: false });
    const turning = w.engine.turnOn();
    await w.clock.advance(9_999);
    expect(w.engine.getState()).toMatchObject({ phase: 'turningOn', busy: 'on' });
    await w.clock.advance(1);
    expect(await turning).toEqual({ ok: false, problem: 'noWorker' });
    expect(w.engine.getState()).toMatchObject({ phase: 'problem', error: 'noWorker' });
    expect(w.store.read()).toBeNull();
  });

  it('says what went wrong when the push service refuses to subscribe', async () => {
    const w = setup({ permission: 'granted' });
    w.manager.failSubscribe = new DOMException('Registration failed - push service not available', 'AbortError');
    expect(await w.engine.turnOn()).toEqual({ ok: false, problem: 'failed' });
    expect(w.engine.getState()).toMatchObject({ phase: 'problem', error: 'failed' });
  });

  it.each([
    ['signed out', { session: { status: 'signedOut' } as SessionState }, 'signedOut'],
    ['unconfigured', { configured: false }, 'unconfigured'],
    ['the dev server', { support: 'devServer' as const }, 'devServer'],
  ])('is refused %s, without a prompt', async (_name, opts, phase) => {
    const w = setup(opts);
    expect(w.engine.getState().phase).toBe(phase);
    expect(await w.engine.turnOn()).toEqual({ ok: false, problem: 'refused' });
    expect(w.permission.request).not.toHaveBeenCalled();
    expect(w.manager.subscribe).not.toHaveBeenCalled();
  });

  it('is refused in demo mode', async () => {
    const w = setup({ permission: 'granted', demo: true });
    expect(await w.engine.turnOn()).toEqual({ ok: false, problem: 'refused' });
    expect(w.manager.subscribe).not.toHaveBeenCalled();
    expect(w.engine.getState().phase).toBe('demo');
  });
});

describe('turnOff', () => {
  it('removes the server row and the browser subscription, then the record', async () => {
    const w = onDevice();
    await w.engine.turnOff();
    expect(w.server.remote.unsubscribe).toHaveBeenCalledWith(w.sub.endpoint);
    expect(w.server.rows.size).toBe(0);
    expect(w.sub.unsubscribe).toHaveBeenCalled();
    expect(w.store.read()).toBeNull();
    expect(w.engine.getState().phase).toBe('off');
  });

  it('still clears this device when the server can’t be reached', async () => {
    const w = onDevice();
    w.server.fail.unsubscribe = new SyncError('offline');
    await w.engine.turnOff();
    expect(w.sub.unsubscribe).toHaveBeenCalled();
    expect(w.store.read()).toBeNull();
    expect(w.engine.getState().phase).toBe('off');
  });
});

describe('refresh', () => {
  it('shows what the account says about this device', async () => {
    const w = onDevice();
    const row = w.server.rows.get(w.sub.endpoint);
    if (row) Object.assign(row, { failures: 1, lastOkAt: '2026-10-22T01:00:00.000Z' });
    expect(w.engine.getState().phase).toBe('on');
    const checking = w.engine.refresh();
    expect(w.engine.getState()).toMatchObject({ phase: 'on', busy: 'check' });
    await checking;
    expect(w.engine.getState()).toEqual({
      phase: 'on',
      permission: 'granted',
      hasRecord: true,
      device: { failures: 1, lastOkAt: '2026-10-22T01:00:00.000Z' },
    });
  });

  it('joins a check already running', async () => {
    const w = onDevice();
    await Promise.all([w.engine.refresh(), w.engine.refresh()]);
    expect(w.server.remote.device).toHaveBeenCalledTimes(1);
  });

  it('replaces a row the server dropped with a fresh subscription', async () => {
    const w = onDevice();
    w.server.rows.clear();
    await w.engine.refresh();
    expect(w.sub.unsubscribe).toHaveBeenCalled();
    const fresh = w.manager.current;
    expect(fresh?.endpoint).not.toBe(w.sub.endpoint);
    expect(w.server.remote.subscribe).toHaveBeenCalledWith(fresh?.wire(), { vapidKey: KEY, label: 'Android', replaces: w.sub.endpoint });
    expect(w.store.read()?.endpoint).toBe(fresh?.endpoint);
    expect(w.engine.getState().phase).toBe('on');
  });

  it('saves an endpoint the browser rotated, replacing the old row', async () => {
    const w = onDevice();
    const rotated = w.manager.rotate();
    await w.engine.refresh();
    expect(w.manager.subscribe).not.toHaveBeenCalled();
    expect(w.server.remote.subscribe).toHaveBeenCalledWith(rotated.wire(), { vapidKey: KEY, label: 'Android', replaces: w.sub.endpoint });
    expect([...w.server.rows.keys()]).toEqual([rotated.endpoint]);
    expect(w.store.read()?.endpoint).toBe(rotated.endpoint);
  });

  it('subscribes again when the keys changed', async () => {
    const w = onDevice({ key: OLD_KEY_BYTES, recordKey: OLD_KEY });
    await w.engine.refresh();
    expect(w.sub.unsubscribe).toHaveBeenCalled();
    const fresh = w.manager.current;
    expect(Array.from(new Uint8Array(fresh?.options.applicationServerKey ?? new ArrayBuffer(0)))).toEqual(Array.from(KEY_BYTES));
    expect(w.server.remote.subscribe).toHaveBeenCalledWith(fresh?.wire(), { vapidKey: KEY, label: 'Android', replaces: w.sub.endpoint });
    expect(w.store.read()?.vapidKey).toBe(KEY);
  });

  it("forgets another account's record on this device, without touching the server", async () => {
    const w = onDevice({ session: { status: 'signedIn', userId: 'user-2', email: 'other@example.com' } });
    expect(w.engine.getState().phase).toBe('off');
    await w.engine.refresh();
    expect(w.sub.unsubscribe).toHaveBeenCalled();
    expect(w.server.remote.unsubscribe).not.toHaveBeenCalled();
    expect(w.store.read()).toBeNull();
    expect(w.engine.getState()).toMatchObject({ phase: 'off', hasRecord: false });
  });

  it('clears everything once notifications are blocked', async () => {
    const w = onDevice();
    w.permission.set('denied');
    await w.engine.refresh();
    expect(w.server.remote.unsubscribe).toHaveBeenCalledWith(w.sub.endpoint);
    expect(w.store.read()).toBeNull();
    expect(w.engine.getState().phase).toBe('denied');
  });

  it('keeps a saved subscription on while the account can’t be reached', async () => {
    const w = onDevice();
    w.server.fail.device = new SyncError('offline');
    await w.engine.refresh();
    expect(w.engine.getState()).toMatchObject({ phase: 'on' });
    w.server.fail.device = new SyncError('notSetUp');
    await w.engine.refresh();
    expect(w.engine.getState()).toMatchObject({ phase: 'problem', error: 'notSetUp' });
  });

  it('finishes a pending save, showing Checking until it has', async () => {
    const w = onDevice({ pending: true });
    w.server.rows.clear();
    expect(w.engine.getState().phase).toBe('checking');
    await w.engine.refresh();
    expect(w.server.remote.subscribe).toHaveBeenCalledWith(w.sub.wire(), { vapidKey: KEY, label: 'Android' });
    expect(w.engine.getState().phase).toBe('on');
  });

  it('keeps the record while signed out: reminders may still arrive', async () => {
    const w = onDevice({ session: { status: 'signedOut' } });
    await w.engine.refresh();
    expect(w.store.read()).not.toBeNull();
    expect(w.engine.getState()).toMatchObject({ phase: 'signedOut', hasRecord: true });
    expect(w.server.remote.device).not.toHaveBeenCalled();
  });
});

describe('forget', () => {
  it('removes the server row first, then the browser subscription', async () => {
    const w = onDevice();
    await w.engine.forget();
    expect(w.server.order).toEqual([`unsubscribe ${w.sub.endpoint}`]);
    expect(w.sub.unsubscribe).toHaveBeenCalled();
    expect(w.server.remote.unsubscribe.mock.invocationCallOrder[0] ?? 0).toBeLessThan(w.sub.unsubscribe.mock.invocationCallOrder[0] ?? 0);
    expect(w.store.read()).toBeNull();
  });

  it('never waits more than 3 seconds, and still clears this device', async () => {
    const w = onDevice();
    w.server.hang.unsubscribe = true;
    let done = false;
    const forgetting = w.engine.forget().then(() => (done = true));
    await w.clock.advance(2_999);
    expect(done).toBe(false);
    await w.clock.advance(1);
    await forgetting;
    expect(done).toBe(true);
    expect(w.sub.unsubscribe).toHaveBeenCalled();
    expect(w.store.read()).toBeNull();
  });

  it('does nothing on a device that never turned reminders on', async () => {
    const w = setup();
    await w.engine.forget();
    expect(w.server.remote.unsubscribe).not.toHaveBeenCalled();
  });
});

describe('test', () => {
  it('sends a test and notes it as the last one', async () => {
    const w = onDevice();
    expect(await w.engine.test()).toEqual({ ok: true });
    expect(w.server.remote.test).toHaveBeenCalledWith(w.sub.endpoint);
    expect(w.engine.getState().device?.lastOkAt).toBe(new Date(START).toISOString());
  });

  it('sets the device up again when the account lost it, then tries once more', async () => {
    const w = onDevice();
    w.server.rows.clear();
    w.server.answerTests({ ok: false, kind: 'notSubscribed' });
    expect(await w.engine.test()).toEqual({ ok: true });
    const fresh = w.manager.current;
    expect(fresh?.endpoint).not.toBe(w.sub.endpoint);
    expect(w.server.order).toEqual([`test ${w.sub.endpoint}`, `subscribe ${fresh?.endpoint}`, `test ${fresh?.endpoint}`]);
  });

  it('passes a key mismatch on when this device already has the current key', async () => {
    const w = onDevice();
    w.server.answerTests({ ok: false, kind: 'keyMismatch' });
    expect(await w.engine.test()).toEqual({ ok: false, kind: 'keyMismatch' });
    expect(w.server.remote.test).toHaveBeenCalledTimes(1);
    expect(w.manager.subscribe).not.toHaveBeenCalled();
  });

  it('is busy while it sends', async () => {
    const w = onDevice();
    const sending = w.engine.test();
    expect(w.engine.getState().busy).toBe('test');
    await sending;
    expect(w.engine.getState().busy).toBeUndefined();
  });
});

describe('start', () => {
  it('checks 3 seconds after the session is read, and again on a sign-in', async () => {
    const w = onDevice({ session: { status: 'loading' } });
    w.engine.start();
    await w.clock.advance(10_000);
    expect(w.server.remote.device).not.toHaveBeenCalled();
    w.session.set(SIGNED_IN);
    await w.clock.advance(2_999);
    expect(w.server.remote.device).not.toHaveBeenCalled();
    await w.clock.advance(1);
    expect(w.server.remote.device).toHaveBeenCalledTimes(1);

    w.session.set({ status: 'signedOut' });
    w.session.set(SIGNED_IN);
    await w.clock.advance(0);
    expect(w.server.remote.device).toHaveBeenCalledTimes(2);
  });

  it('checks again on coming back after 6 hours, not after 1', async () => {
    const w = onDevice();
    w.engine.start();
    await w.clock.advance(3_000);
    expect(w.server.remote.device).toHaveBeenCalledTimes(1);
    await w.clock.advance(HOUR);
    for (const listener of w.visible) listener();
    await w.clock.settle();
    expect(w.server.remote.device).toHaveBeenCalledTimes(1);
    await w.clock.advance(5 * HOUR);
    for (const listener of w.visible) listener();
    await w.clock.settle();
    expect(w.server.remote.device).toHaveBeenCalledTimes(2);
  });

  it('checks when the permission changes', async () => {
    const w = onDevice();
    w.engine.start();
    w.permission.set('denied');
    for (const listener of w.permissionChanges) listener();
    await w.clock.settle();
    expect(w.engine.getState().phase).toBe('denied');
    expect(w.store.read()).toBeNull();
  });

  it('reads demo mode at start', async () => {
    const w = setup({ demo: true });
    w.engine.start();
    await w.clock.settle();
    expect(w.engine.getState().phase).toBe('demo');
  });

  it('does nothing at all without Supabase and a VAPID key', async () => {
    const w = setup({ configured: false });
    w.engine.start();
    await w.clock.advance(HOUR);
    expect(w.session.listeners.size).toBe(0);
    expect(w.visible.size).toBe(0);
    expect(w.online.size).toBe(0);
    expect(w.permissionChanges.size).toBe(0);
    expect(w.clock.pendingCount()).toBe(0);
    expect(w.deps.isDemo).not.toHaveBeenCalled();
    expect(w.deps.registration).not.toHaveBeenCalled();
    expect(w.engine.getState().phase).toBe('unconfigured');
  });
});

/** Turned on with the account out of reach: the browser subscription and a pending record, the card on Waiting. */
async function waitingDevice(kind: 'offline' | 'unreachable') {
  const w = setup({ permission: 'granted' });
  w.engine.start();
  await w.clock.advance(3_000);
  w.server.fail.subscribe = new SyncError(kind);
  expect(await w.engine.turnOn()).toEqual({ ok: false, problem: kind });
  expect(w.engine.getState()).toMatchObject({ phase: 'problem', error: kind });
  expect(w.store.read()?.pending).toBe(true);
  return w;
}

describe('waiting for a connection', () => {
  it('finishes turning on when the phone is back online', async () => {
    const w = await waitingDevice('offline');
    delete w.server.fail.subscribe;
    for (const listener of w.online) listener();
    await w.clock.settle();
    expect(w.server.remote.subscribe).toHaveBeenCalledTimes(2);
    expect(w.store.read()).toEqual({ endpoint: w.manager.current?.endpoint, userId: USER, vapidKey: KEY, savedAt: START + 3_000 });
    expect(w.engine.getState()).toMatchObject({ phase: 'on', device: { failures: 0 } });
  });

  it('looks again on coming back to the app, not only after 6 hours', async () => {
    const w = await waitingDevice('unreachable');
    delete w.server.fail.subscribe;
    await w.clock.advance(1_000);
    for (const listener of w.visible) listener();
    await w.clock.settle();
    expect(w.engine.getState().phase).toBe('on');
    expect(w.store.read()?.pending).toBeUndefined();
  });

  it('keeps trying by itself while the account is out of reach, then stops', async () => {
    const w = await waitingDevice('unreachable');
    await w.clock.advance(29_999);
    expect(w.server.remote.subscribe).toHaveBeenCalledTimes(1);
    await w.clock.advance(1);
    expect(w.server.remote.subscribe).toHaveBeenCalledTimes(2);
    await w.clock.advance(120_000);
    expect(w.server.remote.subscribe).toHaveBeenCalledTimes(3);
    expect(w.engine.getState()).toMatchObject({ phase: 'problem', error: 'unreachable' });

    delete w.server.fail.subscribe;
    await w.clock.advance(300_000);
    expect(w.server.remote.subscribe).toHaveBeenCalledTimes(4);
    expect(w.engine.getState().phase).toBe('on');
    expect(w.clock.pendingCount()).toBe(0);
  });

  it('stops trying once signed out', async () => {
    const w = await waitingDevice('unreachable');
    w.session.set({ status: 'signedOut' });
    await w.clock.advance(HOUR);
    expect(w.server.remote.subscribe).toHaveBeenCalledTimes(1);
    expect(w.clock.pendingCount()).toBe(0);
    expect(w.engine.getState()).toMatchObject({ phase: 'signedOut', hasRecord: true });
  });

  it("leaves a problem waiting can't fix to Try again, and does nothing once settled", async () => {
    const w = setup({ permission: 'granted' });
    w.engine.start();
    await w.clock.advance(3_000);
    w.server.fail.subscribe = new SyncError('notSetUp');
    await w.engine.turnOn();
    await w.clock.advance(HOUR);
    expect(w.server.remote.subscribe).toHaveBeenCalledTimes(1);
    expect(w.clock.pendingCount()).toBe(0);

    // Settled (on): coming online asks nothing.
    const on = onDevice();
    on.engine.start();
    await on.clock.advance(3_000);
    for (const listener of on.online) listener();
    await on.clock.settle();
    expect(on.server.remote.device).toHaveBeenCalledTimes(1);
  });
});
