import { useCallback, useSyncExternalStore } from 'react';

/**
 * PWA plumbing: service-worker registration, the Android install prompt and platform detection
 * for the S01 install step (C59 InstallPrompt).
 *
 * `beforeinstallprompt` fires once, early, and only if someone is listening, so this module starts
 * listening as soon as it is imported (App imports it at start-up).
 */

export type PwaPlatform = 'ios' | 'android' | 'other';

export interface PwaInstall {
  /** A saved install prompt is waiting (Chrome / Android); `prompt()` shows it. */
  canPrompt: boolean;
  platform: PwaPlatform;
  /** Running from the home screen. */
  isStandalone: boolean;
  /** Shows the browser's install dialog. Each saved prompt can be shown once; a no-op without one. */
  prompt: () => Promise<void>;
}

/** Chrome's install event (not in the DOM typings). */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<unknown>;
  readonly userChoice?: Promise<{ outcome: 'accepted' | 'dismissed'; platform?: string }>;
}

type NavigatorLike = Pick<Navigator, 'userAgent' | 'maxTouchPoints'> & { platform?: string; standalone?: boolean };

/** iPhone / iPad (iPadOS reports a Mac with touch) → 'ios'; Android → 'android'; anything else → 'other'. */
export function detectPlatform(nav: NavigatorLike | undefined = typeof navigator === 'undefined' ? undefined : navigator): PwaPlatform {
  if (!nav) return 'other';
  const ua = nav.userAgent ?? '';
  if (/iPad|iPhone|iPod/i.test(ua)) return 'ios';
  if ((nav.platform === 'MacIntel' || /Macintosh/.test(ua)) && (nav.maxTouchPoints ?? 0) > 1) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'other';
}

const STANDALONE_QUERIES = ['(display-mode: standalone)', '(display-mode: fullscreen)', '(display-mode: minimal-ui)'];

/** True when launched from the home screen (display-mode media query, or Safari's navigator.standalone). */
export function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  if ((window.navigator as NavigatorLike).standalone === true) return true;
  if (typeof window.matchMedia !== 'function') return false;
  return STANDALONE_QUERIES.some((q) => window.matchMedia(q).matches);
}

// ---------------------------------------------------------------------------
// Install prompt store
// ---------------------------------------------------------------------------

interface PwaSnapshot {
  canPrompt: boolean;
  platform: PwaPlatform;
  isStandalone: boolean;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
let snapshot: PwaSnapshot = readSnapshot();

function readSnapshot(): PwaSnapshot {
  return { canPrompt: deferredPrompt !== null, platform: detectPlatform(), isStandalone: detectStandalone() };
}

function emit(): void {
  const next = readSnapshot();
  if (next.canPrompt !== snapshot.canPrompt || next.platform !== snapshot.platform || next.isStandalone !== snapshot.isStandalone) {
    snapshot = next;
  }
  for (const listener of listeners) listener();
}

function isInstallEvent(event: Event): event is BeforeInstallPromptEvent {
  return typeof (event as Partial<BeforeInstallPromptEvent>).prompt === 'function';
}

function startListening(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', (event) => {
    if (!isInstallEvent(event)) return;
    // Keep Chrome's mini-infobar quiet; S01 shows our own prompt instead.
    event.preventDefault();
    deferredPrompt = event;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    emit();
  });
  if (typeof window.matchMedia === 'function') {
    for (const q of STANDALONE_QUERIES) window.matchMedia(q).addEventListener?.('change', emit);
  }
}

startListening();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): PwaSnapshot {
  return snapshot;
}

/** Shows the saved install prompt once, then forgets it (the browser allows one use per event). */
export async function promptInstall(): Promise<void> {
  const event = deferredPrompt;
  if (!event) return;
  deferredPrompt = null;
  emit();
  try {
    await event.prompt();
    await event.userChoice;
  } catch {
    // Already used or dismissed by the browser: nothing to do.
  }
}

/** Install state for S01 (C59 InstallPrompt): which version to show, and the Android install action. */
export function usePwaInstall(): PwaInstall {
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const prompt = useCallback(() => promptInstall(), []);
  return { canPrompt: state.canPrompt, platform: state.platform, isStandalone: state.isStandalone, prompt };
}

// ---------------------------------------------------------------------------
// Service worker
// ---------------------------------------------------------------------------

/**
 * Registers the Workbox service worker (vite-plugin-pwa, registerType autoUpdate: a new version
 * activates and reloads by itself). Production builds only; the dev server has no worker.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  import('virtual:pwa-register')
    .then(({ registerSW }) => {
      registerSW({ immediate: true });
    })
    .catch(() => {
      // Offline support is a bonus; the app works without the worker.
    });
}
