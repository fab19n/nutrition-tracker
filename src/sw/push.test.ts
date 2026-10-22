// @vitest-environment node
// The service worker's reminder handlers against a fake worker scope.
import { bytesToBase64Url } from '@/push/base64url';
import {
  installPushHandlers,
  NOTIFICATION_ICON,
  notificationFromPush,
  type ClientLike,
  type NotificationEventLike,
  type PushEventLike,
  type SubscriptionChangeEventLike,
  type SubscriptionLike,
  type WorkerScope,
} from './push';

const ORIGIN = 'https://kira-makan.vercel.app';
const KEY_BYTES = Uint8Array.from({ length: 65 }, (_, i) => (i === 0 ? 4 : i));
const KEY = bytesToBase64Url(KEY_BYTES);
const CONFIG = { supabaseUrl: 'https://abcdefgh.supabase.co', supabaseKey: 'sb_publishable_test_key', vapidKey: KEY };

function subscription(endpoint: string, keys: { p256dh: string; auth: string }, key: Uint8Array | null = KEY_BYTES): SubscriptionLike {
  return {
    endpoint,
    options: { applicationServerKey: key ? new Uint8Array(key).buffer : null },
    toJSON: () => ({ endpoint, keys }),
  };
}

function client(url: string) {
  return { url, focus: vi.fn<() => Promise<unknown>>(async () => undefined), postMessage: vi.fn<(message: unknown) => void>() } satisfies ClientLike;
}

function fakeScope(windows: ClientLike[] = []) {
  const listeners = new Map<string, (event: never) => void>();
  const fresh = subscription('https://fcm.googleapis.com/fcm/send/new', { p256dh: 'new-p256dh', auth: 'new-auth' });
  const scope = {
    location: { origin: ORIGIN },
    registration: {
      showNotification: vi.fn(async (_title: string, _options: unknown) => undefined),
      pushManager: {
        subscribe: vi.fn(async (_options: { userVisibleOnly: boolean; applicationServerKey: Uint8Array<ArrayBuffer> }) => fresh),
        getSubscription: vi.fn(async () => null),
      },
    },
    clients: {
      matchAll: vi.fn(async (_options: unknown) => windows),
      openWindow: vi.fn(async (_url: string) => null),
    },
    addEventListener: (type: string, listener: (event: never) => void) => listeners.set(type, listener),
  };
  const waits: Promise<unknown>[] = [];
  const dispatch = async (type: string, event: object) => {
    const listener = listeners.get(type);
    if (!listener) throw new Error(`no ${type} listener`);
    listener({ ...event, waitUntil: (p: Promise<unknown>) => waits.push(p) } as never);
    await Promise.all(waits.splice(0));
  };
  return { scope: scope as unknown as WorkerScope & typeof scope, dispatch, fresh };
}

const push = (text: string | null): Omit<PushEventLike, 'waitUntil'> => ({ data: text === null ? null : { text: () => text } });

describe('push', () => {
  it('shows the reminder it was sent', async () => {
    const { scope, dispatch } = fakeScope();
    installPushHandlers(scope, CONFIG);
    await dispatch('push', push(JSON.stringify({ v: 1, kind: 'checkIn', title: 'Quick check', body: "Was yesterday's log complete?", url: '/?sheet=checkin' })));
    expect(scope.registration.showNotification).toHaveBeenCalledWith('Quick check', {
      body: "Was yesterday's log complete?",
      tag: 'km-checkIn',
      renotify: true,
      icon: '/icons/icon-192.png',
      data: { url: '/?sheet=checkin', kind: 'checkIn' },
    });
  });

  it.each([
    ['no data', null],
    ['bad JSON', '{nope'],
    ['no title', JSON.stringify({ v: 1, kind: 'gap', body: 'Dinner time for you?', url: '/' })],
    ['an empty body', JSON.stringify({ v: 1, kind: 'gap', title: 'Gap', body: ' ', url: '/' })],
  ])('still shows something with %s', async (_name, text) => {
    const { scope, dispatch } = fakeScope();
    installPushHandlers(scope, CONFIG);
    await dispatch('push', push(text));
    expect(scope.registration.showNotification).toHaveBeenCalledWith('Kira Makan', {
      body: "Open the app to see what's new.",
      tag: 'km-reminder',
      renotify: true,
      icon: NOTIFICATION_ICON,
      data: { url: '/', kind: 'reminder' },
    });
  });

  // Yesterday's check-in left in the shade has today's tag: without renotify, Chrome on Android swaps
  // it in silently (no sound, vibration or pop-up), and a second test seems never to arrive.
  it.each(['checkIn', 'gap', 'weeklyReview', 'targetSuggestion', 'test'])('alerts again when a %s replaces one of its kind', async (kind) => {
    const { scope, dispatch } = fakeScope();
    installPushHandlers(scope, CONFIG);
    const text = JSON.stringify({ v: 1, kind, title: 'Title', body: 'Body', url: '/' });
    await dispatch('push', push(text));
    await dispatch('push', push(text));
    const shown = scope.registration.showNotification.mock.calls.map(([, options]) => options);
    expect(shown).toEqual([
      expect.objectContaining({ tag: `km-${kind}`, renotify: true }),
      expect.objectContaining({ tag: `km-${kind}`, renotify: true }),
    ]);
  });

  it('opens Today for a path it does not know, and tags an odd kind plainly', () => {
    const shown = notificationFromPush(JSON.stringify({ v: 1, kind: 'check in!', title: 'Hi', body: 'There', url: 'https://evil.example/' }));
    expect(shown.options).toMatchObject({ tag: 'km-reminder', data: { url: '/', kind: 'reminder' } });
    expect(notificationFromPush(JSON.stringify({ v: 1, kind: 'weeklyReview', title: 'x'.repeat(201), body: 'b', url: '/' })).title).toBe('Kira Makan');
  });
});

describe('notificationclick', () => {
  const click = (url: unknown) =>
    ({ notification: { close: vi.fn<() => void>(), data: { url, kind: 'weeklyReview' } } }) satisfies Omit<NotificationEventLike, 'waitUntil'>;

  it('focuses an open app window and tells it where to go', async () => {
    const app = client(`${ORIGIN}/diary`);
    const { scope, dispatch } = fakeScope([app]);
    installPushHandlers(scope, CONFIG);
    const event = click('/insights/weekly');
    await dispatch('notificationclick', event);
    expect(event.notification.close).toHaveBeenCalled();
    expect(scope.clients.matchAll).toHaveBeenCalledWith({ type: 'window', includeUncontrolled: true });
    expect(app.focus).toHaveBeenCalled();
    expect(app.postMessage).toHaveBeenCalledWith({ type: 'km-open', url: '/insights/weekly' });
    expect(app.focus.mock.invocationCallOrder[0] ?? 0).toBeLessThan(app.postMessage.mock.invocationCallOrder[0] ?? 0);
    expect(scope.clients.openWindow).not.toHaveBeenCalled();
  });

  it("ignores another site's window and opens a new one", async () => {
    const other = client('https://example.com/');
    const { scope, dispatch } = fakeScope([other]);
    installPushHandlers(scope, CONFIG);
    await dispatch('notificationclick', click('/?sheet=checkin'));
    expect(other.postMessage).not.toHaveBeenCalled();
    expect(scope.clients.openWindow).toHaveBeenCalledWith('/?sheet=checkin');
  });

  it('opens a window with no app open, and only on a known path', async () => {
    const { scope, dispatch } = fakeScope([]);
    installPushHandlers(scope, CONFIG);
    await dispatch('notificationclick', click('//evil.example'));
    expect(scope.clients.openWindow).toHaveBeenCalledWith('/');
  });
});

describe('pushsubscriptionchange', () => {
  const OLD = subscription('https://fcm.googleapis.com/fcm/send/old', { p256dh: 'old-p256dh', auth: 'old-auth' });
  const NEW = subscription('https://fcm.googleapis.com/fcm/send/rotated', { p256dh: 'rot-p256dh', auth: 'rot-auth' });

  function fetchOk() {
    return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response('{"saved":true}', { status: 200 }));
  }

  it('saves the new subscription as anon, proving it with the old auth secret', async () => {
    const app = client(`${ORIGIN}/`);
    const { scope, dispatch } = fakeScope([app]);
    const fetchMock = fetchOk();
    installPushHandlers(scope, CONFIG, fetchMock as unknown as typeof fetch);
    await dispatch('pushsubscriptionchange', { oldSubscription: OLD, newSubscription: NEW } satisfies Omit<SubscriptionChangeEventLike, 'waitUntil'>);
    expect(scope.registration.pushManager.subscribe).not.toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${CONFIG.supabaseUrl}/rest/v1/rpc/push_resubscribe`);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ apikey: CONFIG.supabaseKey, 'Content-Type': 'application/json' });
    expect(JSON.parse(String(init.body))).toEqual({
      p_old_endpoint: OLD.endpoint,
      p_old_auth: 'old-auth',
      p_endpoint: NEW.endpoint,
      p_p256dh: 'rot-p256dh',
      p_auth: 'rot-auth',
      p_vapid_key: KEY,
    });
    expect(app.postMessage).toHaveBeenCalledWith({ type: 'km-push-changed' });
  });

  it('subscribes again with the old key when the browser gave no new one', async () => {
    const { scope, dispatch, fresh } = fakeScope([]);
    const fetchMock = fetchOk();
    installPushHandlers(scope, CONFIG, fetchMock as unknown as typeof fetch);
    await dispatch('pushsubscriptionchange', { oldSubscription: OLD, newSubscription: null });
    const options = scope.registration.pushManager.subscribe.mock.calls[0]?.[0];
    expect(options?.userVisibleOnly).toBe(true);
    expect(Array.from(options?.applicationServerKey ?? [])).toEqual(Array.from(KEY_BYTES));
    expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))).toMatchObject({ p_endpoint: fresh.endpoint });
  });

  it('calls nothing without the build-time settings, and still tells the app', async () => {
    const app = client(`${ORIGIN}/`);
    const { scope, dispatch } = fakeScope([app]);
    const fetchMock = fetchOk();
    installPushHandlers(scope, {}, fetchMock as unknown as typeof fetch);
    await dispatch('pushsubscriptionchange', { oldSubscription: OLD, newSubscription: NEW });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(app.postMessage).toHaveBeenCalledWith({ type: 'km-push-changed' });
  });

  it('swallows a failed save', async () => {
    const app = client(`${ORIGIN}/`);
    const { scope, dispatch } = fakeScope([app]);
    const fetchMock = vi.fn(async () => Promise.reject(new TypeError('Failed to fetch')));
    installPushHandlers(scope, CONFIG, fetchMock as unknown as typeof fetch);
    await expect(dispatch('pushsubscriptionchange', { oldSubscription: OLD, newSubscription: NEW })).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalled();
    expect(app.postMessage).toHaveBeenCalledWith({ type: 'km-push-changed' });
  });
});
