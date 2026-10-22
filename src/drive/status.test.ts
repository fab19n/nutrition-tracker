// @vitest-environment node
import type { DriveEngineState } from './engine';
import type { DriveAuthProblem } from './gis';
import {
  authProblemCopy,
  connectedToast,
  describeDrive,
  DRIVE_PRIMER,
  drivePhase,
  photoProblemCopy,
  type DriveCopy,
  type DriveView,
  type PhotoProblem,
} from './status';

const NOW = Date.parse('2026-10-16T11:10:00.000Z');
const TZ = 'Asia/Kuala_Lumpur';
const MINUTE = 60_000;

const BASE: DriveEngineState = {
  configured: true,
  profile: 'real',
  keepPhotos: true,
  connected: true,
  email: 'you@example.com',
  gisReady: true,
  tokenExpiresAt: NOW + 30 * MINUTE,
  authBusy: false,
  running: false,
  online: true,
  counts: { uploads: 0, files: 0, failed: 0 },
};

function state(patch: Partial<DriveEngineState> = {}): DriveEngineState {
  return { ...BASE, ...patch };
}

function view(patch: Partial<DriveEngineState> = {}): DriveView {
  const s = state(patch);
  return { ...s, phase: drivePhase(s, NOW), now: NOW };
}

function copyOf(patch: Partial<DriveEngineState> = {}): DriveCopy {
  return describeDrive(view(patch), TZ);
}

const ids = (copy: DriveCopy) => copy.actions.map((a) => `${a.id}:${a.label}:${a.variant}`);

describe('drivePhase', () => {
  it('takes each rule before the next', () => {
    const waiting = { counts: { uploads: 2, files: 0, failed: 0 } };
    expect(drivePhase(state({ configured: false, profile: 'demo' }), NOW)).toBe('unconfigured');
    expect(drivePhase(state({ profile: 'loading', authBusy: true }), NOW)).toBe('noProfile');
    expect(drivePhase(state({ profile: 'none' }), NOW)).toBe('noProfile');
    expect(drivePhase(state({ profile: 'demo', authBusy: true }), NOW)).toBe('demo');
    expect(drivePhase(state({ authBusy: true, connected: false }), NOW)).toBe('connecting');
    expect(drivePhase(state({ connected: false, running: true }), NOW)).toBe('disconnected');
    expect(drivePhase(state({ running: true, keepPhotos: false }), NOW)).toBe('working');
    expect(drivePhase(state({ keepPhotos: false, ...waiting }), NOW)).toBe('keepOff');
    expect(drivePhase(state({ online: false, error: 'unreachable' }), NOW)).toBe('idle');
    expect(drivePhase(state({ ...waiting, online: false, error: 'unreachable' }), NOW)).toBe('offline');
    expect(drivePhase(state({ ...waiting, error: 'unreachable', tokenExpiresAt: undefined }), NOW)).toBe('error');
    expect(drivePhase(state({ ...waiting, tokenExpiresAt: undefined }), NOW)).toBe('needsTap');
    expect(drivePhase(state(waiting), NOW)).toBe('idle');
    expect(drivePhase(state({ counts: { uploads: 0, files: 1, failed: 0 }, tokenExpiresAt: undefined }), NOW)).toBe('needsTap');
  });

  it('counts a token within a minute of its expiry as none', () => {
    const waiting = { counts: { uploads: 1, files: 0, failed: 0 } };
    expect(drivePhase(state({ ...waiting, tokenExpiresAt: NOW + MINUTE }), NOW)).toBe('needsTap');
    expect(drivePhase(state({ ...waiting, tokenExpiresAt: NOW + MINUTE + 1 }), NOW)).toBe('idle');
  });
});

describe('describeDrive', () => {
  it('demo', () => {
    expect(copyOf({ profile: 'demo', connected: false })).toEqual({
      tone: 'off',
      pill: 'Off',
      title: 'Photo sync is off in demo mode',
      detail: 'Sample data never leaves this device.',
      facts: [],
      actions: [],
    });
  });

  it('disconnected', () => {
    const copy = copyOf({ connected: false, email: undefined, counts: { uploads: 3, files: 0, failed: 2 } });
    expect(copy).toMatchObject({
      tone: 'off',
      pill: 'Off',
      title: 'Photos are on this device only',
      detail:
        'Connect Google Drive to keep meal photos in your own Drive and see them on your other devices. The app can only see files it creates.',
      facts: [],
    });
    expect(copy.extra).toBeUndefined();
    expect(ids(copy)).toEqual(['connect:Connect Google Drive:primary']);
  });

  it('connecting', () => {
    const copy = copyOf({ authBusy: true });
    expect(copy).toEqual({ tone: 'busy', pill: 'Connecting', title: 'Connecting to Google Drive…', detail: 'Finish in the Google window.', facts: [], actions: [] });
  });

  it('working: the progress from two uploads, and Updating for file jobs only', () => {
    expect(copyOf({ running: true, progress: { done: 3, total: 12 } })).toMatchObject({
      tone: 'busy',
      pill: 'Uploading',
      title: 'Uploading photos',
      detail: '3 of 12 photos',
      progress: { done: 3, total: 12 },
      actions: [],
      facts: [{ label: 'Google account', value: 'you@example.com' }],
    });
    const one = copyOf({ running: true, progress: { done: 0, total: 1 } });
    expect(one).toMatchObject({ pill: 'Uploading', title: 'Uploading photos' });
    expect(one.detail).toBeUndefined();
    expect(one.progress).toBeUndefined();
    const files = copyOf({ running: true, counts: { uploads: 0, files: 2, failed: 0 } });
    expect(files).toMatchObject({ tone: 'busy', pill: 'Updating', title: 'Updating Google Drive' });
    expect(files.detail).toBeUndefined();
  });

  it('keepOff', () => {
    const copy = copyOf({ keepPhotos: false });
    expect(copy).toMatchObject({
      tone: 'off',
      pill: 'Off',
      title: 'Photo uploads are off',
      detail: 'Keep photos is off, so nothing uploads. Photos already in Google Drive stay there.',
    });
    expect(ids(copy)).toEqual(['disconnect:Disconnect:ghost']);
  });

  it('idle with nothing waiting, with and without a last upload', () => {
    expect(copyOf({ lastUploadAt: NOW - 5 * MINUTE })).toEqual({
      tone: 'ok',
      pill: 'Up to date',
      title: 'Up to date',
      detail: 'Last photo uploaded 5 min ago',
      facts: [{ label: 'Google account', value: 'you@example.com' }],
      actions: [{ id: 'disconnect', label: 'Disconnect', variant: 'ghost' }],
    });
    expect(copyOf({ email: undefined }).detail).toBe('New meal photos go to the Kira Makan photos folder in your Google Drive.');
    expect(copyOf({ email: undefined }).facts).toEqual([]);
  });

  it('idle with photos about to upload', () => {
    expect(copyOf({ counts: { uploads: 1, files: 0, failed: 0 } })).toMatchObject({
      tone: 'waiting',
      pill: 'Waiting',
      title: '1 photo waiting',
      detail: 'It uploads in a moment.',
      actions: [],
    });
    expect(copyOf({ counts: { uploads: 4, files: 0, failed: 0 } })).toMatchObject({ title: '4 photos waiting', detail: 'They upload in a moment.' });
  });

  it('offline', () => {
    expect(copyOf({ online: false, counts: { uploads: 1, files: 0, failed: 0 } })).toMatchObject({
      tone: 'waiting',
      pill: 'Offline',
      title: 'Offline',
      detail: "1 photo waits on this device and uploads when you're back online.",
      actions: [],
    });
    expect(copyOf({ online: false, counts: { uploads: 3, files: 0, failed: 0 } }).detail).toBe(
      "3 photos wait on this device and upload when you're back online.",
    );
    expect(copyOf({ online: false, counts: { uploads: 0, files: 1, failed: 0 } }).detail).toBe("Changes reach Google Drive when you're back online.");
  });

  it('needsTap', () => {
    const copy = copyOf({ tokenExpiresAt: undefined, counts: { uploads: 3, files: 0, failed: 0 } });
    expect(copy).toMatchObject({
      tone: 'attention',
      pill: 'Needs you',
      title: '3 photos waiting for Google Drive',
      detail: 'Google asks again about once an hour. Tap Continue to carry on.',
    });
    expect(ids(copy)).toEqual(['continue:Continue:primary', 'disconnect:Disconnect:ghost']);
    expect(copyOf({ tokenExpiresAt: undefined, counts: { uploads: 1, files: 0, failed: 0 } }).title).toBe('1 photo waiting for Google Drive');
    expect(copyOf({ tokenExpiresAt: undefined, counts: { uploads: 0, files: 1, failed: 0 } }).title).toBe('Google Drive needs you');
  });

  it("error unreachable: about a minute below 90 s, a few minutes from 90 s", () => {
    const waiting = { error: 'unreachable' as const, counts: { uploads: 2, files: 0, failed: 0 } };
    expect(copyOf({ ...waiting, retryAt: NOW + 89_000 })).toMatchObject({
      tone: 'waiting',
      pill: 'Waiting',
      title: "Can't reach Google Drive",
      detail: 'Your photos are safe on this device. Trying again in about a minute.',
    });
    expect(copyOf({ ...waiting, retryAt: NOW + 90_000 }).detail).toBe('Your photos are safe on this device. Trying again in a few minutes.');
    expect(copyOf(waiting).detail).toBe('Your photos are safe on this device.');
    expect(ids(copyOf(waiting))).toEqual(['retry:Try again:primary']);
  });

  it('error driveFull and failed', () => {
    const waiting = { counts: { uploads: 2, files: 0, failed: 0 } };
    expect(copyOf({ ...waiting, error: 'driveFull' })).toMatchObject({
      tone: 'attention',
      pill: 'Needs you',
      title: 'Your Google Drive is full',
      detail: "Photos wait on this device until there's room. Free up space in Google Drive, then tap Try again.",
    });
    expect(copyOf({ ...waiting, error: 'failed' })).toMatchObject({
      tone: 'waiting',
      pill: 'Waiting',
      title: 'Photo upload stopped on a problem',
      detail: 'Your photos are safe on this device. It keeps trying.',
    });
    expect(ids(copyOf({ ...waiting, error: 'driveFull' }))).toEqual(['retry:Try again:primary']);
  });

  it('says which photos were set aside, once connected', () => {
    expect(copyOf({ counts: { uploads: 0, files: 0, failed: 1 } }).extra).toBe(
      "1 photo couldn't upload. It stays on this device, and the app tries again next time it opens.",
    );
    expect(copyOf({ online: false, counts: { uploads: 1, files: 0, failed: 3 } }).extra).toBe(
      "3 photos couldn't upload. They stay on this device, and the app tries again next time it opens.",
    );
    expect(copyOf({ authBusy: true, counts: { uploads: 0, files: 0, failed: 3 } }).extra).toBeUndefined();
    expect(copyOf({ authBusy: true }).facts).toEqual([]);
  });
});

describe('authProblemCopy', () => {
  const ALL: DriveAuthProblem[] = ['notReady', 'offline', 'popupBlocked', 'popupClosed', 'denied', 'scopeDenied', 'otherAccount', 'unavailable', 'failed'];

  it('says what happened, by where it came from', () => {
    for (const during of ['connect', 'continue', 'photo'] as const) {
      expect(authProblemCopy('notReady', { during })).toBe('Still getting ready. Try again in a moment.');
      expect(authProblemCopy('offline', { during })).toBe("You're offline. Try again when you're back online.");
      expect(authProblemCopy('popupBlocked', { during })).toBe("The Google window didn't open. Try again.");
      expect(authProblemCopy('popupClosed', { during })).toBeNull();
      expect(authProblemCopy('scopeDenied', { during })).toBe("Tick Google Drive on Google's screen, then try again.");
      expect(authProblemCopy('unavailable', { during })).toBe("Couldn't reach Google. Check your connection and try again.");
      expect(authProblemCopy('failed', { during })).toBe("Couldn't connect to Google Drive. Try again.");
    }
    expect(authProblemCopy('denied', { during: 'connect' })).toBe("Google Drive wasn't connected.");
    expect(authProblemCopy('denied', { during: 'continue' })).toBe("Google didn't give access this time. Try again.");
    expect(authProblemCopy('denied', { during: 'photo' })).toBe("Google didn't give access this time. Try again.");
    expect(authProblemCopy('otherAccount', { during: 'continue', email: 'you@example.com' })).toBe(
      "That's a different Google account. Continue with you@example.com, or disconnect first.",
    );
    expect(authProblemCopy('otherAccount', { during: 'photo' })).toBe("That's a different Google account from the one connected here.");
  });

  it('follows the copy rules', () => {
    const lines = ALL.flatMap((p) => [authProblemCopy(p, { during: 'connect' }), authProblemCopy(p, { during: 'continue', email: 'a@b.c' })]);
    for (const line of lines) {
      if (line === null) continue;
      expect(line).not.toMatch(/please|successfully|!/i);
    }
  });
});

describe('photoProblemCopy', () => {
  it('says what a failed fetch means', () => {
    expect(photoProblemCopy('notFound')).toBe(
      "Couldn't find this photo in your Google Drive. It may have been deleted there, or uploaded with another Google account.",
    );
    expect(photoProblemCopy('offline')).toBe("Full photo when you're back online.");
    expect(photoProblemCopy('failed')).toBe("Couldn't get the photo. Try again.");
    expect(photoProblemCopy('notInDrive')).toBeNull();
    expect(photoProblemCopy('notConnected')).toBeNull();
    expect(photoProblemCopy('popupBlocked' satisfies PhotoProblem)).toBe("The Google window didn't open. Try again.");
    expect(photoProblemCopy('denied')).toBe("Google didn't give access this time. Try again.");
    expect(photoProblemCopy('popupClosed')).toBeNull();
  });
});

describe('the connect sheet and toast', () => {
  it('has the primer copy', () => {
    expect(DRIVE_PRIMER).toEqual({
      title: 'Keep meal photos in Google Drive?',
      body:
        'Photos upload to a Kira Makan photos folder in your own Google Drive, so your other devices can show them. The app can only see files it creates. ' +
        'Google asks again about once an hour, so a Google window may open for a moment when you add a photo.',
      allowLabel: 'Continue with Google',
      readyingLabel: 'Getting ready…',
      busyLabel: 'Connecting…',
    });
  });

  it('counts what goes up after connecting', () => {
    expect(connectedToast(0)).toBe('Google Drive connected');
    expect(connectedToast(1)).toBe('Google Drive connected · 1 photo to upload');
    expect(connectedToast(23)).toBe('Google Drive connected · 23 photos to upload');
  });

  it('follows the copy rules in every phase', () => {
    const views: Partial<DriveEngineState>[] = [
      { profile: 'demo' },
      { connected: false },
      { authBusy: true },
      { running: true, progress: { done: 1, total: 4 } },
      { keepPhotos: false },
      {},
      { counts: { uploads: 2, files: 0, failed: 1 } },
      { online: false, counts: { uploads: 2, files: 0, failed: 0 } },
      { tokenExpiresAt: undefined, counts: { uploads: 2, files: 0, failed: 0 } },
      { error: 'unreachable', retryAt: NOW + 5 * MINUTE, counts: { uploads: 2, files: 0, failed: 0 } },
      { error: 'driveFull', counts: { uploads: 2, files: 0, failed: 0 } },
      { error: 'failed', counts: { uploads: 2, files: 0, failed: 0 } },
    ];
    for (const patch of views) {
      const copy = copyOf(patch);
      for (const line of [copy.title, copy.detail, copy.extra, copy.pill, ...copy.actions.map((a) => a.label)]) {
        if (line) expect(line).not.toMatch(/please|successfully|!/i);
      }
    }
    expect(`${DRIVE_PRIMER.title} ${DRIVE_PRIMER.body}`).not.toMatch(/please|successfully|!/i);
  });
});
