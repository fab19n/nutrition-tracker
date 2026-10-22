/**
 * Reminders in the service worker (decision §10.19): show each push, open the right screen on a tap,
 * and save a subscription the browser rotated. Pure handlers over a structural worker scope, so the
 * tests drive them with a fake one and the app's tsconfig (DOM, not WebWorker) checks them.
 *
 * - push: always shows something (Chrome requires it); anything unreadable is a plain "Kira Makan".
 *   One tag per kind, so today's check-in replaces yesterday's left in the shade, with renotify, so the
 *   replacement still sounds and pops up (a same-tag notification is otherwise swapped in silently).
 * - notificationclick: an open app window is focused and told to navigate in place ('km-open'), so a
 *   draft on screen survives; otherwise a new window opens. Only NOTIFICATION_PATHS are ever opened.
 * - pushsubscriptionchange: resubscribes with the same key and saves it through push_resubscribe as
 *   anon, proving ownership with the old subscription's auth secret. Every failure is swallowed: the
 *   app reconciles again when it opens ('km-push-changed' tells an open one now).
 */
import { base64UrlToBytes, bytesToBase64Url } from '@/push/base64url';
import { safeNotificationPath } from '@/push/notificationPaths';

export interface SubscriptionLike {
  endpoint: string;
  options?: { applicationServerKey?: ArrayBuffer | null } | null;
  toJSON(): { endpoint?: string; keys?: Record<string, string> };
}

export interface ClientLike {
  url: string;
  focus?: () => Promise<unknown>;
  postMessage(message: unknown): void;
}

interface Waitable {
  waitUntil(promise: Promise<unknown>): void;
}

export interface PushEventLike extends Waitable {
  data: { text(): string } | null;
}

export interface NotificationEventLike extends Waitable {
  notification: { close(): void; data?: unknown };
}

export interface SubscriptionChangeEventLike extends Waitable {
  oldSubscription?: SubscriptionLike | null;
  newSubscription?: SubscriptionLike | null;
}

export interface NotificationOptionsLike {
  body: string;
  tag: string;
  /** Alert again when this replaces a notification with the same tag. */
  renotify: true;
  icon: string;
  data: { url: string; kind: string };
}

export interface WorkerScope {
  location: { origin: string };
  registration: {
    showNotification(title: string, options: NotificationOptionsLike): Promise<void>;
    pushManager: {
      subscribe(options: { userVisibleOnly: boolean; applicationServerKey: Uint8Array<ArrayBuffer> }): Promise<SubscriptionLike>;
      getSubscription(): Promise<SubscriptionLike | null>;
    };
  };
  clients: {
    matchAll(options: { type: 'window'; includeUncontrolled: boolean }): Promise<readonly ClientLike[]>;
    openWindow(url: string): Promise<unknown>;
  };
  addEventListener(type: 'push', listener: (event: PushEventLike) => void): void;
  addEventListener(type: 'notificationclick', listener: (event: NotificationEventLike) => void): void;
  addEventListener(type: 'pushsubscriptionchange', listener: (event: SubscriptionChangeEventLike) => void): void;
}

/** Read at build time from the VITE_ variables (src/sw.ts). */
export interface PushWorkerConfig {
  supabaseUrl?: string;
  supabaseKey?: string;
  vapidKey?: string;
}

export const NOTIFICATION_ICON = '/icons/icon-192.png';
const MAX_TEXT = 200;
const KIND = /^[A-Za-z]{1,24}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && value.length <= MAX_TEXT;
}

/** The notification for a push's text: `{ v: 1, kind, title, body, url }`, or a plain fallback. */
export function notificationFromPush(text: string | null): {
  title: string;
  options: NotificationOptionsLike;
} {
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  if (!isRecord(parsed) || !isText(parsed.title) || !isText(parsed.body)) {
    return {
      title: 'Kira Makan',
      options: { body: "Open the app to see what's new.", tag: 'km-reminder', renotify: true, icon: NOTIFICATION_ICON, data: { url: '/', kind: 'reminder' } },
    };
  }
  const kind = typeof parsed.kind === 'string' && KIND.test(parsed.kind) ? parsed.kind : null;
  return {
    title: parsed.title,
    options: {
      body: parsed.body,
      tag: kind ? `km-${kind}` : 'km-reminder',
      renotify: true,
      icon: NOTIFICATION_ICON,
      data: { url: safeNotificationPath(parsed.url), kind: kind ?? 'reminder' },
    },
  };
}

function sameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

async function windows(scope: WorkerScope): Promise<readonly ClientLike[]> {
  return scope.clients.matchAll({ type: 'window', includeUncontrolled: true });
}

async function openPath(scope: WorkerScope, url: string): Promise<void> {
  const client = (await windows(scope)).find((c) => sameOrigin(c.url, scope.location.origin));
  if (!client) {
    await scope.clients.openWindow(url);
    return;
  }
  try {
    await client.focus?.();
  } catch {
    // Focus can be refused; the app still navigates.
  }
  client.postMessage({ type: 'km-open', url });
}

function keyOf(sub: SubscriptionLike | null | undefined): Uint8Array<ArrayBuffer> | null {
  const key = sub?.options?.applicationServerKey;
  return key ? new Uint8Array(key) : null;
}

async function resubscribe(scope: WorkerScope, event: SubscriptionChangeEventLike, config: PushWorkerConfig, fetchImpl: typeof fetch): Promise<void> {
  const old = event.oldSubscription ?? null;
  const configKey = config.vapidKey ? base64UrlToBytes(config.vapidKey) : null;
  const key = keyOf(old) ?? (configKey ? new Uint8Array(configKey) : null);
  let next = event.newSubscription ?? null;
  if (!next) {
    if (!key) return;
    next = await scope.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  }
  const oldAuth = old?.toJSON().keys?.auth;
  const keys = next.toJSON().keys;
  const usedKey = keyOf(next) ?? key;
  if (!old || !oldAuth || !keys?.p256dh || !keys.auth || !usedKey || !config.supabaseUrl || !config.supabaseKey) return;
  await fetchImpl(`${config.supabaseUrl}/rest/v1/rpc/push_resubscribe`, {
    method: 'POST',
    headers: { apikey: config.supabaseKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      p_old_endpoint: old.endpoint,
      p_old_auth: oldAuth,
      p_endpoint: next.endpoint,
      p_p256dh: keys.p256dh,
      p_auth: keys.auth,
      p_vapid_key: bytesToBase64Url(usedKey),
    }),
  });
}

export function installPushHandlers(scope: WorkerScope, config: PushWorkerConfig, fetchImpl: typeof fetch = fetch): void {
  scope.addEventListener('push', (event) => {
    let text: string | null = null;
    try {
      text = event.data ? event.data.text() : null;
    } catch {
      text = null;
    }
    const { title, options } = notificationFromPush(text);
    event.waitUntil(scope.registration.showNotification(title, options));
  });

  scope.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const data = event.notification.data;
    const url = safeNotificationPath(isRecord(data) ? data.url : undefined);
    event.waitUntil(openPath(scope, url).catch(() => undefined));
  });

  scope.addEventListener('pushsubscriptionchange', (event) => {
    event.waitUntil(
      (async () => {
        try {
          await resubscribe(scope, event, config, fetchImpl);
        } catch {
          // Swallowed: the app checks its subscription when it next opens.
        }
        try {
          for (const client of await windows(scope)) client.postMessage({ type: 'km-push-changed' });
        } catch {
          // No windows to tell.
        }
      })(),
    );
  });
}
