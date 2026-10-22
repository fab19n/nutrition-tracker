/**
 * The app's Drive engine (./engine, decision §10.18), built on first use over the app database,
 * Drive REST (./api) and Google's token client (./gis). App.tsx calls startDrive() at start-up;
 * screens use the wrappers below and never build an engine themselves.
 *
 * Without VITE_GOOGLE_CLIENT_ID the engine is inert: it watches nothing, its token source never
 * loads Google's script, and the queue stays empty. Building it loads nothing either: the script
 * loads through prepareDrive(), only on a device that uses Drive (§D20).
 */
import { db } from '@/db/db';
import type { Id } from '@/domain/types';
import { catchUpSync } from '@/sync';
import { createDriveApi } from './api';
import { isDriveConfigured, readGoogleClientId } from './config';
import { createDriveEngine, type AuthResult, type ConnectResult, type DriveEngine, type DriveEngineState, type FetchPhotoResult } from './engine';
import { createGisTokenSource, DriveAuthError, type DriveTokenSource } from './gis';
import { makeLocalThumb, makeSyncThumb } from './thumb';

export type { AuthResult, ConnectResult, DriveEngineState, DriveReason, DriveRunError, FetchPhotoResult } from './engine';
export type { DriveAuthProblem } from './gis';

/** No client id: never ready, loads nothing, opens nothing. */
const inertTokens: DriveTokenSource = {
  ready: () => false,
  load: () => Promise.reject(new DriveAuthError('unavailable', 'Google Drive is not set up in this version of the app')),
  request: () => Promise.reject(new DriveAuthError('notReady')),
};

let engine: DriveEngine | null = null;

function getEngine(): DriveEngine {
  if (!engine) {
    const clientId = readGoogleClientId();
    engine = createDriveEngine({
      db,
      api: createDriveApi(),
      tokens: clientId ? createGisTokenSource(clientId) : inertTokens,
      configured: isDriveConfigured,
      makeThumb: makeSyncThumb,
      makeLocalThumb,
      // Each pointer lands on a copy that has pulled what other devices changed (§10.18 D19).
      catchUp: catchUpSync,
    });
  }
  return engine;
}

/** Starts watching the queue, once (StrictMode can call it twice). Inert without a client id. */
export function startDrive(): void {
  getEngine().start();
}

/** Aborts the run and waits for it (Delete everything). Every stopDrive() needs a resumeDrive(). */
export function stopDrive(): Promise<void> {
  return getEngine().stop();
}

export function resumeDrive(): void {
  getEngine().resume();
}

/** Loads Google's script now, so a later tap can open the window at once. */
export function prepareDrive(): void {
  getEngine().prepare();
}

/** The connect sheet's "Continue with Google". Call it straight from the tap. */
export function connectDrive(): Promise<ConnectResult> {
  return getEngine().connect();
}

/** The card's Continue (Needs you). Call it straight from the tap. */
export function continueDrive(): Promise<AuthResult> {
  return getEngine().continueFromTap();
}

/** The photo sheet's Estimate tap: a new token when one would be used. Never throws, never tells. */
export function renewDriveTokenOnTap(): void {
  getEngine().renewOnTap();
}

/** Disconnect on this device. Photos in Drive stay; nothing is revoked. */
export function disconnectDrive(): Promise<void> {
  return getEngine().disconnect();
}

/** Try again: everything waiting runs now (a full Drive included). */
export function retryDrive(): Promise<void> {
  return getEngine().retry();
}

/** Entry's Show full photo. Call it straight from the tap. */
export function fetchMealPhoto(mealId: Id): Promise<FetchPhotoResult> {
  return getEngine().fetchPhoto(mealId);
}

/** Drops the token held in memory (Delete everything). */
export function forgetDriveToken(): void {
  getEngine().forgetToken();
}

/** For useSyncExternalStore, with getDriveState. */
export function subscribeDrive(listener: () => void): () => void {
  return getEngine().subscribe(listener);
}

export function getDriveState(): DriveEngineState {
  return getEngine().getState();
}

/** Tests only: stop and forget the engine, so the next call builds a new one. */
export async function resetDriveForTests(): Promise<void> {
  const current = engine;
  engine = null;
  await current?.dispose();
}
