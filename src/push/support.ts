/**
 * Can this browser get reminders? Web Push needs a service worker (the built app only), the Push API
 * and notifications; on iPhone, only the app opened from the Home Screen gets them.
 */
import { detectPlatform, detectStandalone } from '@/app/pwa';

export type PushSupport = 'supported' | 'unsupported' | 'iosNeedsInstall' | 'devServer';

/** `env.prod` stands in for import.meta.env.PROD (tests). */
export function detectPushSupport(env: { prod?: boolean } = {}): PushSupport {
  const prod = env.prod ?? import.meta.env.PROD;
  if (!prod) return 'devServer';
  const iosBrowser = detectPlatform() === 'ios' && !detectStandalone();
  const hasApis =
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window !== 'undefined' &&
    'PushManager' in window &&
    'Notification' in window;
  if (!hasApis) return iosBrowser ? 'iosNeedsInstall' : 'unsupported';
  return iosBrowser ? 'iosNeedsInstall' : 'supported';
}

/** The browser's notification permission, or 'unsupported' without the Notification API. */
export function readPermission(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return window.Notification.permission;
}

/** How the device shows up on the server (push_subscriptions.label): never the user agent itself. */
export function deviceLabel(): string {
  const platform = detectPlatform();
  if (platform === 'android') return 'Android';
  if (platform === 'ios') return 'iPhone';
  return 'Computer';
}
