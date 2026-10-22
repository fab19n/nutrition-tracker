/**
 * What the Drive photo card says (Settings › Photos, Backups › Meal photos) and the lines around
 * it: the phase from the engine's state, the card's copy for each phase, what to say when a token
 * request or a photo fetch fails, the connect sheet's primer and the toast after connecting. Pure,
 * so every phase and count is tested here without a database, an engine or a clock.
 *
 * Actions come back as ids; the screen that shows the card connects each one.
 */
import { fmtAgo, fmtInt } from '@/domain/format';
import { photosLabel } from '@/domain/photoSync';
import type { SyncTone } from '@/sync/status';
import type { DriveEngineState, FetchPhotoResult } from './engine';
import type { DriveAuthProblem } from './gis';

export type DrivePhase =
  | 'unconfigured'
  | 'noProfile'
  | 'demo'
  | 'connecting'
  | 'disconnected'
  | 'working'
  | 'keepOff'
  | 'idle'
  | 'offline'
  | 'error'
  | 'needsTap';

/** The engine's state with its phase, and the real time it was read at (again every minute). */
export interface DriveView extends DriveEngineState {
  phase: DrivePhase;
  now: number;
}

/** A token within a minute of its expiry counts as none (the engine's TOKEN_MARGIN_MS). */
const TOKEN_MARGIN_MS = 60_000;
/** From here a retry is "in a few minutes" rather than "in about a minute". */
const FEW_MINUTES_MS = 90_000;

/** The first that matches, in this order. */
export function drivePhase(s: DriveEngineState, nowMs: number): DrivePhase {
  if (!s.configured) return 'unconfigured';
  if (s.profile === 'none' || s.profile === 'loading') return 'noProfile';
  if (s.profile === 'demo') return 'demo';
  if (s.authBusy) return 'connecting';
  if (!s.connected) return 'disconnected';
  if (s.running) return 'working';
  if (!s.keepPhotos) return 'keepOff';
  if (s.counts.uploads + s.counts.files === 0) return 'idle';
  if (!s.online) return 'offline';
  if (s.error) return 'error';
  if (s.tokenExpiresAt === undefined || s.tokenExpiresAt - TOKEN_MARGIN_MS <= nowMs) return 'needsTap';
  return 'idle';
}

export type DriveActionId = 'connect' | 'continue' | 'retry' | 'disconnect';

export interface DriveAction {
  id: DriveActionId;
  label: string;
  variant: 'primary' | 'secondary' | 'ghost';
}

export interface DriveCopy {
  tone: SyncTone;
  pill: string;
  title: string;
  detail?: string;
  /** Photos set aside: "1 photo couldn't upload…". */
  extra?: string;
  /** "Google account" once connected. */
  facts: { label: string; value: string }[];
  /** 'working' from two uploads: the card's progress bar. */
  progress?: { done: number; total: number };
  actions: DriveAction[];
}

const ACTIONS = {
  connect: { id: 'connect', label: 'Connect Google Drive', variant: 'primary' },
  continue: { id: 'continue', label: 'Continue', variant: 'primary' },
  retry: { id: 'retry', label: 'Try again', variant: 'primary' },
  disconnect: { id: 'disconnect', label: 'Disconnect', variant: 'ghost' },
} as const satisfies Record<DriveActionId, DriveAction>;

/** The phases of a device that is connected (the account and set-aside photos show in these). */
const CONNECTED: ReadonlySet<DrivePhase> = new Set<DrivePhase>(['working', 'keepOff', 'idle', 'offline', 'error', 'needsTap']);

type Body = Omit<DriveCopy, 'facts' | 'extra' | 'actions'> & { actions?: DriveAction[] };

function verb(plural: string, singular: string, n: number): string {
  return n === 1 ? singular : plural;
}

function bodyFor(view: DriveView, tz: string): Body {
  const n = view.counts.uploads;
  switch (view.phase) {
    case 'unconfigured':
    case 'noProfile':
      // The card isn't shown in these.
      return { tone: 'off', pill: 'Off', title: 'Photo sync is off' };
    case 'demo':
      return { tone: 'off', pill: 'Off', title: 'Photo sync is off in demo mode', detail: 'Sample data never leaves this device.' };
    case 'disconnected':
      return {
        tone: 'off',
        pill: 'Off',
        title: 'Photos are on this device only',
        detail:
          'Connect Google Drive to keep meal photos in your own Drive and see them on your other devices. The app can only see files it creates.',
        actions: [ACTIONS.connect],
      };
    case 'connecting':
      return { tone: 'busy', pill: 'Connecting', title: 'Connecting to Google Drive…', detail: 'Finish in the Google window.' };
    case 'working': {
      const total = view.progress?.total ?? 0;
      if (total === 0) return { tone: 'busy', pill: 'Updating', title: 'Updating Google Drive' };
      if (total < 2) return { tone: 'busy', pill: 'Uploading', title: 'Uploading photos' };
      const done = Math.min(Math.max(view.progress?.done ?? 0, 0), total);
      return {
        tone: 'busy',
        pill: 'Uploading',
        title: 'Uploading photos',
        detail: `${fmtInt(done)} of ${fmtInt(total)} photos`,
        progress: { done, total },
      };
    }
    case 'keepOff':
      return {
        tone: 'off',
        pill: 'Off',
        title: 'Photo uploads are off',
        detail: 'Keep photos is off, so nothing uploads. Photos already in Google Drive stay there.',
        actions: [ACTIONS.disconnect],
      };
    case 'idle':
      if (n === 0) {
        return {
          tone: 'ok',
          pill: 'Up to date',
          title: 'Up to date',
          detail:
            view.lastUploadAt !== undefined
              ? `Last photo uploaded ${fmtAgo(view.lastUploadAt, view.now, tz)}`
              : 'New meal photos go to the Kira Makan photos folder in your Google Drive.',
          actions: [ACTIONS.disconnect],
        };
      }
      return {
        tone: 'waiting',
        pill: 'Waiting',
        title: `${photosLabel(n)} waiting`,
        detail: n === 1 ? 'It uploads in a moment.' : 'They upload in a moment.',
      };
    case 'offline':
      return {
        tone: 'waiting',
        pill: 'Offline',
        title: 'Offline',
        detail:
          n > 0
            ? `${photosLabel(n)} ${verb('wait', 'waits', n)} on this device and ${verb('upload', 'uploads', n)} when you're back online.`
            : "Changes reach Google Drive when you're back online.",
      };
    case 'needsTap':
      return {
        tone: 'attention',
        pill: 'Needs you',
        title: n > 0 ? `${photosLabel(n)} waiting for Google Drive` : 'Google Drive needs you',
        detail: 'Google asks again about once an hour. Tap Continue to carry on.',
        actions: [ACTIONS.continue, ACTIONS.disconnect],
      };
    case 'error':
      if (view.error === 'driveFull') {
        return {
          tone: 'attention',
          pill: 'Needs you',
          title: 'Your Google Drive is full',
          detail: "Photos wait on this device until there's room. Free up space in Google Drive, then tap Try again.",
          actions: [ACTIONS.retry],
        };
      }
      if (view.error === 'failed') {
        return {
          tone: 'waiting',
          pill: 'Waiting',
          title: 'Photo upload stopped on a problem',
          detail: 'Your photos are safe on this device. It keeps trying.',
          actions: [ACTIONS.retry],
        };
      }
      return {
        tone: 'waiting',
        pill: 'Waiting',
        title: "Can't reach Google Drive",
        detail: `Your photos are safe on this device.${
          view.retryAt === undefined
            ? ''
            : view.retryAt - view.now >= FEW_MINUTES_MS
              ? ' Trying again in a few minutes.'
              : ' Trying again in about a minute.'
        }`,
        actions: [ACTIONS.retry],
      };
  }
}

/** The Drive card's copy for `view` (useDriveView). `tz` is the profile's zone, for "Last photo uploaded at 9:40pm". */
export function describeDrive(view: DriveView, tz: string): DriveCopy {
  const body = bodyFor(view, tz);
  const copy: DriveCopy = { tone: body.tone, pill: body.pill, title: body.title, facts: [], actions: body.actions ?? [] };
  if (body.detail) copy.detail = body.detail;
  if (body.progress) copy.progress = body.progress;
  if (CONNECTED.has(view.phase)) {
    if (view.email) copy.facts.push({ label: 'Google account', value: view.email });
    const failed = view.counts.failed;
    if (failed > 0) {
      copy.extra = `${photosLabel(failed)} couldn't upload. ${failed === 1 ? 'It stays' : 'They stay'} on this device, and the app tries again next time it opens.`;
    }
  }
  return copy;
}

/** What to say when a token request fails, by where it came from. Null: say nothing (the user closed the window). */
export function authProblemCopy(problem: DriveAuthProblem, ctx: { during: 'connect' | 'continue' | 'photo'; email?: string }): string | null {
  switch (problem) {
    case 'notReady':
      return 'Still getting ready. Try again in a moment.';
    case 'offline':
      return "You're offline. Try again when you're back online.";
    case 'popupBlocked':
      return "The Google window didn't open. Try again.";
    case 'popupClosed':
      return null;
    case 'denied':
      return ctx.during === 'connect' ? "Google Drive wasn't connected." : "Google didn't give access this time. Try again.";
    case 'scopeDenied':
      return "Tick Google Drive on Google's screen, then try again.";
    case 'otherAccount':
      return ctx.email
        ? `That's a different Google account. Continue with ${ctx.email}, or disconnect first.`
        : "That's a different Google account from the one connected here.";
    case 'unavailable':
      return "Couldn't reach Google. Check your connection and try again.";
    case 'failed':
      return "Couldn't connect to Google Drive. Try again.";
  }
}

/** Why a full photo couldn't be fetched (FetchPhotoResult's problems). */
export type PhotoProblem = Extract<FetchPhotoResult, { ok: false }>['problem'];

/** What Entry says when a full photo couldn't be fetched. Null where the photo block already says it. */
export function photoProblemCopy(problem: PhotoProblem): string | null {
  switch (problem) {
    case 'notFound':
      return "Couldn't find this photo in your Google Drive. It may have been deleted there, or uploaded with another Google account.";
    case 'offline':
      return "Full photo when you're back online.";
    case 'failed':
      return "Couldn't get the photo. Try again.";
    case 'notInDrive':
    case 'notConnected':
      return null;
    default:
      return authProblemCopy(problem, { during: 'photo' });
  }
}

/** The C58 primer in the connect sheet. */
export const DRIVE_PRIMER = {
  title: 'Keep meal photos in Google Drive?',
  body:
    'Photos upload to a Kira Makan photos folder in your own Google Drive, so your other devices can show them. ' +
    'The app can only see files it creates. Google asks again about once an hour, so a Google window may open for a moment when you add a photo.',
  allowLabel: 'Continue with Google',
  readyingLabel: 'Getting ready…',
  busyLabel: 'Connecting…',
} as const;

/** The toast after connecting: "Google Drive connected · 3 photos to upload". */
export function connectedToast(queued: number): string {
  return queued > 0 ? `Google Drive connected · ${photosLabel(queued)} to upload` : 'Google Drive connected';
}
