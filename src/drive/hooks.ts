/**
 * Drive photo sync for screens (decision §10.18).
 *
 * - useDriveView(): what the Settings › Photos and Backups › Meal photos cards show (./status
 *   describeDrive turns it into copy): the engine's state with its phase, re-read on every change
 *   and each minute (the real clock, like useSyncView).
 * - useMealPhoto(meal): what Entry shows for a meal's photo on this device: its own copy, the
 *   thumbnail synced from another device with "Show full photo", or a line saying where the
 *   photo is. Show full photo and Continue call the engine straight from the tap, so Google's
 *   window may open.
 *
 * Neither loads Google's script by itself: useMealPhoto prepares it only when a tap could need it.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useOnline } from '@/app/network';
import { db } from '@/db/db';
import { useObjectUrl } from '@/db/diary';
import { uploadJobId } from '@/db/driveQueue';
import { drivePointerOf, mealPhotoView, type DriveDeviceState, type MealPhotoView } from '@/domain/photoSync';
import type { MealLog } from '@/domain/types';
import { continueDrive, fetchMealPhoto, getDriveState, prepareDrive, subscribeDrive, type DriveEngineState } from './index';
import { authProblemCopy, drivePhase, photoProblemCopy, type DriveView } from './status';

/** "Last photo uploaded 5 min ago" and a token running out move on this often. */
const TICK_MS = 60_000;
/** A token within a minute of its expiry counts as none (the engine's TOKEN_MARGIN_MS). */
const TOKEN_MARGIN_MS = 60_000;

function useDriveState(): DriveEngineState {
  return useSyncExternalStore(subscribeDrive, getDriveState, getDriveState);
}

function useTick(ms: number): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return tick;
}


/** The card's view: engine state + phase, re-read on every change and each minute (real clock, like useSyncView). */
export function useDriveView(): DriveView {
  const state = useDriveState();
  const tick = useTick(TICK_MS);
  // The tick and each change are the reasons to read the clock again (the real one: never demo time).
  const now = useMemo(() => Date.now(), [tick, state]);
  return useMemo(() => ({ ...state, phase: drivePhase(state, now), now }), [state, now]);
}

function deviceState(state: DriveEngineState): DriveDeviceState {
  if (!state.configured) return 'unconfigured';
  if (state.profile === 'demo') return 'demo';
  return state.connected ? 'connected' : 'disconnected';
}

export interface MealPhoto {
  view: MealPhotoView;
  /** Local thumb object URL, else the synced data URL. */
  thumbUrl?: string;
  /** Local full photo object URL (view local). */
  fullUrl?: string;
  /** A fetch or Continue is running from this hook. */
  busy: boolean;
  /** Copy of the last failed fetch or Continue. */
  problem?: string;
  /** From a tap: fetches the full photo (remote) and resolves true when it is here. */
  showFull(): Promise<boolean>;
  /** From a tap: Continue for a local photo that waits for a token. */
  continueUpload(): void;
}

export function useMealPhoto(meal: Pick<MealLog, 'id' | 'photoId' | 'photoDrive'>): MealPhoto {
  const { id: mealId, photoId } = meal;
  const state = useDriveState();
  const online = useOnline();
  const tick = useTick(TICK_MS);
  const local = useLiveQuery(async () => ({ photo: photoId ? await db.photos.get(photoId) : undefined }), [photoId]);
  // A job set aside (Drive refused it, or a file too big) waits for the next start, not for a tap.
  const queued = useLiveQuery(
    async () => {
      const job = photoId ? await db.driveJobs.get(uploadJobId(photoId)) : undefined;
      return job?.kind === 'upload' && job.failedAt === undefined;
    },
    [photoId],
    false,
  );
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);

  const now = useMemo(() => Date.now(), [tick, state]);
  const pointer = drivePointerOf(meal);
  const drive = deviceState(state);
  const tokenValid = state.tokenExpiresAt !== undefined && state.tokenExpiresAt - TOKEN_MARGIN_MS > now;
  const photo = local?.photo;
  // Until the photos table answers, the block shows the hatched thumb as it always did.
  const view: MealPhotoView =
    photoId && local === undefined
      ? { kind: 'local', waitingForTap: false }
      : mealPhotoView({
          photoId,
          pointer,
          hasLocal: photo !== undefined,
          drive,
          online,
          waitingForTap: drive === 'connected' && state.profile === 'real' && state.keepPhotos && queued && !tokenValid,
        });
  const thumbBlob = useObjectUrl(photo?.thumb);
  const fullBlob = useObjectUrl(photo?.blob);

  const wantsGis = (view.kind === 'remote' && view.action === 'show') || (view.kind === 'local' && view.waitingForTap);
  useEffect(() => {
    // Loaded ahead, so the tap can open Google's window at once.
    if (wantsGis) prepareDrive();
  }, [wantsGis]);

  // A problem belongs to the photo it was about.
  const [problemFor, setProblemFor] = useState(photoId);
  if (problemFor !== photoId) {
    setProblemFor(photoId);
    setProblem(undefined);
  }

  const showFull = (): Promise<boolean> => {
    if (view.kind === 'local') return Promise.resolve(true);
    if (view.kind !== 'remote') return Promise.resolve(false);
    // Straight from the tap, before any await.
    const fetching = fetchMealPhoto(mealId);
    setBusy(true);
    return fetching.then((result) => {
      setBusy(false);
      if (result.ok) {
        setProblem(undefined);
        return true;
      }
      setProblem(photoProblemCopy(result.problem) ?? undefined);
      return false;
    });
  };

  const continueUpload = (): void => {
    const continuing = continueDrive();
    setBusy(true);
    void continuing.then((result) => {
      setBusy(false);
      setProblem(result.ok ? undefined : (authProblemCopy(result.problem, { during: 'continue', email: state.email }) ?? undefined));
    });
  };

  return {
    view,
    thumbUrl: photo ? thumbBlob : pointer?.thumb,
    fullUrl: photo ? fullBlob : undefined,
    busy,
    problem,
    showFull,
    continueUpload,
  };
}
