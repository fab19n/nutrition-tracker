/**
 * The app's reminders engine (./engine, decision §10.19), built on first use over the real browser
 * (Notification, the service worker's PushManager), the account (./remote), the shared session and
 * localStorage (./local). App.tsx calls startPush() at start-up; screens use the wrappers below.
 *
 * Without Supabase or VITE_VAPID_PUBLIC_KEY the engine is inert: phase 'unconfigured', no listeners,
 * no network.
 */
import { readSession, watchSession } from '@/auth/session';
import { db } from '@/db/db';
import { isPushConfigured, readVapidPublicKey } from './config';
import { createPushEngine, type PushEngine, type PushEngineState, type RegistrationLike, type TurnOnResult } from './engine';
import { clearPushRecord, readPushRecord, writePushRecord } from './local';
import { createSupabasePushRemote, type TestOutcome } from './remote';
import { detectPushSupport, deviceLabel, readPermission } from './support';

export type { PushEngineState, PushPhase, TurnOnResult } from './engine';
export type { TestOutcome } from './remote';

function registration(): Promise<RegistrationLike | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return Promise.resolve(null);
  return navigator.serviceWorker.ready;
}

function requestPermission(): Promise<NotificationPermission> {
  if (typeof window === 'undefined' || !('Notification' in window)) return Promise.resolve('denied');
  return window.Notification.requestPermission();
}

function onVisible(listener: () => void): () => void {
  const handler = () => {
    if (document.visibilityState === 'visible') listener();
  };
  document.addEventListener('visibilitychange', handler);
  return () => document.removeEventListener('visibilitychange', handler);
}

function onOnline(listener: () => void): () => void {
  window.addEventListener('online', listener);
  return () => window.removeEventListener('online', listener);
}

/** Allowing or blocking notifications in the browser's settings while the app is open. */
function onPermissionChange(listener: () => void): () => void {
  let status: PermissionStatus | null = null;
  let stopped = false;
  navigator.permissions
    ?.query({ name: 'notifications' })
    .then((found) => {
      if (stopped) return;
      status = found;
      found.addEventListener('change', listener);
    })
    .catch(() => undefined);
  return () => {
    stopped = true;
    status?.removeEventListener('change', listener);
  };
}

let engine: PushEngine | null = null;

function getEngine(): PushEngine {
  engine ??= createPushEngine({
    configured: isPushConfigured,
    vapidKey: readVapidPublicKey,
    support: () => detectPushSupport(),
    permission: readPermission,
    requestPermission,
    registration,
    remote: createSupabasePushRemote(),
    session: { read: readSession, watch: watchSession },
    isDemo: async () => (await db.profile.get('me'))?.demoMode === true,
    store: { read: readPushRecord, write: writePushRecord, clear: clearPushRecord },
    label: deviceLabel,
    now: () => Date.now(),
    timers: {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    },
    onVisible,
    onOnline,
    onPermissionChange,
  });
  return engine;
}

/** Starts watching, once (StrictMode can call it twice). Inert without Supabase and a VAPID key. */
export function startPush(): void {
  getEngine().start();
}

/** S38's Turn on. Call it straight from the tap: Chrome's prompt needs it. */
export function turnOnPush(): Promise<TurnOnResult> {
  return getEngine().turnOn();
}

/** S38's Turn off: the server row and the browser subscription go. */
export function turnOffPush(): Promise<void> {
  return getEngine().turnOff();
}

/** A test notification to this device. Never rejects. */
export function sendTestPush(): Promise<TestOutcome> {
  return getEngine().test();
}

/** Try again: saves the subscription this device has (no prompt). */
export function retryPush(): Promise<TurnOnResult> {
  return getEngine().retry();
}

/** Set up again: a fresh subscription replaces the old one. */
export function repairPush(): Promise<TurnOnResult> {
  return getEngine().repair();
}

/** Checks this device against the account (S38 opening, a worker message). Never rejects. */
export function refreshPush(): Promise<void> {
  return getEngine().refresh();
}

/** Sign out and Delete everything: removes this device's subscription, waiting at most `timeoutMs`. Never rejects. */
export function forgetPush(timeoutMs = 3_000): Promise<void> {
  return getEngine().forget(timeoutMs);
}

export function getPushState(): PushEngineState {
  return getEngine().getState();
}

/** For useSyncExternalStore, with getPushState. */
export function subscribePush(listener: () => void): () => void {
  return getEngine().subscribe(listener);
}

/** Tests only: forget the engine, so the next call builds a new one. */
export function resetPushForTests(): void {
  engine?.dispose();
  engine = null;
}
