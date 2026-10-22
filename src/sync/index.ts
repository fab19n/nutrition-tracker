/**
 * The app's sync engine (./engine), built on first use over the app database, the account's sync
 * functions (./remote) and the shared session (src/auth/session.ts). App.tsx calls startSync() at
 * start-up; screens use the wrappers below and never build an engine themselves.
 *
 * Without Supabase configured the engine stays inert: it listens to nothing and sends nothing.
 * Building it loads nothing either: supabase-js loads only for a stored session or a sign-in.
 */
import { readStoredTheme } from '@/app/theme';
import { ensureSessionStarted, getAuth, isAuthConfigured, readSession, watchSession } from '@/auth/session';
import { hasStoredSession } from '@/auth/supabase';
import { db } from '@/db/db';
import { createSyncEngine, type EngineState, type RestoreResult, type SyncEngine, type SyncProgress } from './engine';
import { createSupabaseRemote } from './remote';

export type { EngineState, RestoreResult, SyncPhase, SyncProgress, SyncReason } from './engine';

let engine: SyncEngine | null = null;

function getEngine(): SyncEngine {
  engine ??= createSyncEngine({
    db,
    remote: createSupabaseRemote(),
    configured: isAuthConfigured,
    // The theme is per device: a profile that arrives by sync takes this one.
    deviceDefaults: () => ({ theme: readStoredTheme() }),
    session: {
      read: readSession,
      watch: watchSession,
      ensureStarted: ensureSessionStarted,
      getAuth,
      hasStored: hasStoredSession,
    },
  });
  return engine;
}

/** Starts syncing, once (StrictMode can call it twice). Inert without Supabase. */
export function startSync(): void {
  getEngine().start();
}

/** Aborts what's running and waits for it (Delete everything). Every stopSync() needs a resumeSync(). */
export function stopSync(): Promise<void> {
  return getEngine().stop();
}

export function resumeSync(): void {
  getEngine().resume();
}

/**
 * "Sync now", and after a sign-in: runs at once, online or not, even while waiting for a new
 * session. Never rejects; the state says how it went.
 */
export function syncNow(): Promise<void> {
  return getEngine().syncNow();
}

/**
 * Pulls what other devices changed before a write made in the background (the Drive photo pointer,
 * §10.18): a cycle now, on a linked device only. Never rejects.
 */
export function catchUpSync(): Promise<void> {
  return getEngine().catchUp();
}

/** Pushes what's queued, waiting at most `timeoutMs` (before signing out). Never rejects. */
export function flushSync(timeoutMs: number): Promise<void> {
  return getEngine().flush(timeoutMs);
}

/**
 * Welcome › Restore from your account, before setup: 'restored' with the meal count, 'empty' (the
 * account holds nothing) or 'uploading' (rows but no profile yet: another device's first upload is
 * part way, so try again shortly). Rejects with a SyncError (or RestoreConflict).
 */
export function restoreFromAccount(onProgress?: (progress: SyncProgress) => void): Promise<RestoreResult> {
  return getEngine().restoreFromAccount(onProgress);
}

/** The choose sheet: "Use the account's data". Rejects when it fails; nothing here changed then. */
export function useAccountData(): Promise<void> {
  return getEngine().useAccountData();
}

/** The choose sheet: "Keep this device's data". Resolves once linked; the upload follows by itself. */
export function keepThisDeviceData(): Promise<void> {
  return getEngine().keepThisDeviceData();
}

/** The choose sheet: "Not now" turns sync off on this device. */
export function notNow(): Promise<void> {
  return getEngine().notNow();
}

/** "Turn on sync". */
export function turnSyncBackOn(): Promise<void> {
  return getEngine().turnSyncBackOn();
}

/** "Switch to this account" (otherAccount). */
export function switchToSignedInAccount(): Promise<void> {
  return getEngine().switchToSignedInAccount();
}

/** "Upload this device's data" (cloudReset). */
export function uploadAfterReset(): Promise<void> {
  return getEngine().uploadAfterReset();
}

/** "Turn off sync" (cloudReset). */
export function turnOffAfterReset(): Promise<void> {
  return getEngine().turnOffAfterReset();
}

/** For useSyncExternalStore, with getEngineState. */
export function subscribeEngine(listener: () => void): () => void {
  return getEngine().subscribe(listener);
}

export function getEngineState(): EngineState {
  return getEngine().getState();
}

/** Tests only: stop and forget the engine, so the next call builds a new one. */
export async function resetSyncForTests(): Promise<void> {
  const current = engine;
  engine = null;
  await current?.dispose();
}
