import { describe, expect, it } from 'vitest';
import { TABLE_NAMES } from '@/db/db';
import { BackupImportError, type BackupPreview, type DeviceComparison } from '@/db/export';
import type { BackupStatus } from '@/domain/backup';
import type { DriveEngineState } from '@/drive/engine';
import { describeDrive, drivePhase, type DriveCopy } from '@/drive/status';
import type { SyncPhase } from '@/sync/engine';
import { describeSync, type SyncView } from '@/sync/status';
import {
  accountNote,
  backupActions,
  backupFileCaption,
  backupsRowSub,
  CatchUpFailed,
  confirmCopy,
  deviceWord,
  driveBackupActions,
  exportCardCopy,
  lostNote,
  mealsLabel,
  previewCard,
  previewLead,
  previewRows,
  previewTitle,
  problemCopy,
  restoreBlockedReason,
  restoreReach,
  restoredCopy,
} from './backupsModel';

const TZ = 'Asia/Kuala_Lumpur';
const SAVED_AT = '2026-10-16T11:10:00.000Z';

const NEVER_YOUNG: BackupStatus = { kind: 'never', diaryDays: 10, due: false };
const NEVER_OLD: BackupStatus = { kind: 'never', diaryDays: 40, due: true };
const exported = (days: number, due: boolean): BackupStatus => ({ kind: 'exported', at: SAVED_AT, day: '2026-10-16', days, due });

describe('exportCardCopy', () => {
  it('has nothing yet on a young diary, in a quiet tone', () => {
    for (const linked of [false, true]) {
      expect(exportCardCopy(NEVER_YOUNG, { tz: TZ, word: 'phone', linked })).toEqual({
        tone: 'off',
        pill: 'None yet',
        title: 'No export yet',
        detail: 'Export saves your whole diary as one file you can restore from.',
        icon: 'down',
        action: 'secondary',
      });
    }
  });

  it('says when an old diary has no export, and what a file is for', () => {
    expect(exportCardCopy(NEVER_OLD, { tz: TZ, word: 'phone', linked: false })).toEqual({
      tone: 'attention',
      pill: 'Due',
      title: 'No export yet',
      detail: 'Your diary is 40 days old. A file is a copy that lives outside the app.',
      icon: 'clock',
      action: 'primary',
    });
    expect(exportCardCopy(NEVER_OLD, { tz: TZ, word: 'device', linked: true })).toMatchObject({
      tone: 'attention',
      pill: 'Due',
      title: 'No export yet',
      detail: 'Your diary is 40 days old. Your account has a copy; a file is one that lives outside it.',
      action: 'primary',
    });
  });

  it('shows the last export with its day and time', () => {
    for (const linked of [false, true]) {
      expect(exportCardCopy(exported(0, false), { tz: TZ, word: 'phone', linked })).toEqual({
        tone: 'ok',
        pill: 'Saved',
        title: 'Last export today',
        detail: 'Fri 16 Oct, 7:10pm',
        icon: 'check',
        action: 'secondary',
      });
    }
    expect(exportCardCopy(exported(1, false), { tz: TZ, linked: false }).title).toBe('Last export yesterday');
    expect(exportCardCopy(exported(10, false), { tz: TZ, linked: false }).title).toBe('Last export 10 days ago');
    expect(exportCardCopy(exported(30, false), { tz: 'Europe/London', linked: false }).detail).toBe('Fri 16 Oct, 12:10pm');
  });

  it('says how long it has been, without blame, and what to do', () => {
    expect(exportCardCopy(exported(45, true), { tz: TZ, word: 'phone', linked: false })).toEqual({
      tone: 'attention',
      pill: 'Due',
      title: 'Last export 45 days ago',
      detail: "It's been a while. A fresh file takes a few seconds.",
      icon: 'clock',
      action: 'primary',
    });
    expect(exportCardCopy(exported(45, true), { tz: TZ, word: 'device', linked: true })).toMatchObject({
      pill: 'Due',
      title: 'Last export 45 days ago',
      detail: "It's been a while. Your account keeps a copy; a fresh file doesn't depend on it.",
      action: 'primary',
    });
  });

  it('never blames', () => {
    const words = [NEVER_YOUNG, NEVER_OLD, exported(0, false), exported(45, true)].flatMap((status) =>
      [false, true].map((linked) => JSON.stringify(exportCardCopy(status, { tz: TZ, linked }))),
    );
    for (const text of words) expect(text).not.toMatch(/overdue|forgot|should|please|!/i);
  });
});

describe('backupsRowSub', () => {
  it('shows the nudge on the Settings row', () => {
    expect(backupsRowSub(exported(45, true), true)).toBe('Last export 45 days ago. Time for a new one.');
    expect(backupsRowSub(exported(45, true), false)).toBe('Last export 45 days ago. Time for a new one.');
    expect(backupsRowSub(NEVER_OLD, true)).toBe('No export yet. Time for one.');
    expect(backupsRowSub(NEVER_OLD, false)).toBe('No export yet. Time for one.');
  });

  it('otherwise says what the screen is for, by whether sync exists', () => {
    expect(backupsRowSub(NEVER_YOUNG, true)).toBe('Sync, export and restore');
    expect(backupsRowSub(NEVER_YOUNG, false)).toBe('Export and restore');
    expect(backupsRowSub(exported(10, false), true)).toBe('Sync, export and restore');
    expect(backupsRowSub(exported(10, false), false)).toBe('Export and restore');
  });
});

describe('backupActions', () => {
  const NOW = Date.parse('2026-10-16T11:10:00.000Z');
  const view = (patch: Partial<SyncView> = {}): SyncView => ({
    phase: 'idle',
    pending: 0,
    failed: 0,
    linked: true,
    linkedEmail: 'you@example.com',
    sessionEmail: 'you@example.com',
    signedIn: true,
    lastSyncedAt: NOW - 5 * 60_000,
    now: NOW,
    ...patch,
  });
  const actionsFor = (patch: Partial<SyncView>) => backupActions(describeSync(view(patch), NOW, TZ));

  it('keeps Sync now, which runs in place', () => {
    expect(actionsFor({})).toEqual([{ id: 'syncNow', label: 'Sync now', variant: 'secondary' }]);
    expect(actionsFor({ pending: 3 })).toEqual([{ id: 'syncNow', label: 'Sync now', variant: 'secondary' }]);
  });

  it('keeps Try again, which runs in place, also when Sign out follows it', () => {
    expect(actionsFor({ phase: 'error', error: 'unreachable' })).toEqual([{ id: 'retry', label: 'Try again', variant: 'primary' }]);
    expect(actionsFor({ phase: 'notSetUp' })).toEqual([{ id: 'retry', label: 'Try again', variant: 'primary' }]);
    // A refused token while still signed in: Try again, then Sign out.
    expect(describeSync(view({ phase: 'needsSignIn', signedIn: true }), NOW, TZ).actions.map((a) => a.id)).toEqual(['retry', 'signOut']);
    expect(actionsFor({ phase: 'needsSignIn', signedIn: true })).toEqual([{ id: 'retry', label: 'Try again', variant: 'primary' }]);
  });

  it.each<[string, Partial<SyncView>]>([
    ['Sign in', { phase: 'needsSignIn', signedIn: false, sessionEmail: undefined }],
    ['Choose', { phase: 'choose', linked: false }],
    ['Switch to this account and Sign out', { phase: 'otherAccount', sessionEmail: 'other@example.com' }],
    ["Upload this device's data and Turn off sync", { phase: 'cloudReset' }],
  ])('collapses %s to one primary Open Settings', (_name, patch) => {
    expect(actionsFor(patch)).toEqual([{ id: 'manage', label: 'Open Settings', variant: 'primary' }]);
  });

  it('collapses Turn on sync to one secondary Open Settings', () => {
    expect(describeSync(view({ phase: 'paused' }), NOW, TZ)).toMatchObject({ tone: 'off' });
    expect(actionsFor({ phase: 'paused' })).toEqual([{ id: 'manage', label: 'Open Settings', variant: 'secondary' }]);
  });

  it.each<SyncPhase>(['signedOut', 'demo', 'syncing', 'offline', 'unconfigured', 'noProfile', 'starting', 'uploading', 'restoring'])(
    'gives none for %s',
    (phase) => {
      expect(actionsFor({ phase })).toEqual([]);
    },
  );

  it('never offers Sign in, Sign out, Choose, Switch or Turn on sync here', () => {
    const phases: SyncPhase[] = ['needsSignIn', 'choose', 'otherAccount', 'cloudReset', 'paused', 'error', 'notSetUp', 'idle'];
    for (const phase of phases) {
      for (const signedIn of [false, true]) {
        const labels = actionsFor({ phase, signedIn }).map((a) => a.label);
        for (const label of labels) expect(label).toMatch(/^(Sync now|Try again|Open Settings)$/);
      }
    }
  });
});

describe('accountNote', () => {
  it('says the file is the only copy while signed out, and what demo is', () => {
    expect(accountNote('signedOut')).toBe('Until you sign in, your diary is only on this phone. A backup file is another way to keep a copy.');
    expect(accountNote('demo')).toBe('Backups start once you set up your own diary. A backup file can still replace the sample week.');
  });

  it('has no note for the other phases', () => {
    const others: SyncPhase[] = ['idle', 'offline', 'error', 'paused', 'choose', 'unconfigured', 'noProfile', 'starting'];
    for (const phase of others) expect(accountNote(phase)).toBeUndefined();
  });
});

describe('restoreReach', () => {
  const real = { demoMode: false };

  it('is none without a profile, and sample in demo mode, linked or not', () => {
    expect(restoreReach(undefined, { linked: false, phase: 'noProfile' })).toBe('none');
    expect(restoreReach({ demoMode: true }, { linked: false, phase: 'demo' })).toBe('sample');
    expect(restoreReach({ demoMode: true }, { linked: true, phase: 'idle' })).toBe('sample');
  });

  it('is device for a diary that does not sync', () => {
    expect(restoreReach(real, { linked: false, phase: 'signedOut' })).toBe('device');
    expect(restoreReach({}, { linked: false, phase: 'starting' })).toBe('device');
    expect(restoreReach(real, { linked: false, phase: 'unconfigured' })).toBe('device');
    expect(restoreReach(real, { linked: true, phase: 'paused' })).toBe('device');
    expect(restoreReach(real, { linked: true, phase: 'unconfigured' })).toBe('device');
  });

  it('is account for a linked diary that is not paused', () => {
    for (const phase of ['idle', 'syncing', 'offline', 'error', 'needsSignIn', 'choose', 'otherAccount', 'cloudReset'] as const) {
      expect(restoreReach(real, { linked: true, phase })).toBe('account');
    }
  });
});

describe('restoreBlockedReason', () => {
  const COPYING = 'Sync is copying your diary. You can restore a file when it finishes.';
  const NEEDS_YOU = 'Sync needs you first. Open Settings, then come back to restore a file.';

  it('waits while sync is copying the diary', () => {
    for (const reach of ['none', 'sample', 'device', 'account'] as const) {
      expect(restoreBlockedReason(reach, 'uploading')).toBe(COPYING);
      expect(restoreBlockedReason(reach, 'restoring')).toBe(COPYING);
    }
  });

  it('wants the Needs-you states fixed first, only for a diary that syncs', () => {
    for (const phase of ['needsSignIn', 'otherAccount', 'cloudReset', 'choose', 'notSetUp'] as const) {
      expect(restoreBlockedReason('account', phase)).toBe(NEEDS_YOU);
      for (const reach of ['none', 'sample', 'device'] as const) expect(restoreBlockedReason(reach, phase)).toBeNull();
    }
  });

  it('lets offline, error and idle through', () => {
    for (const phase of ['offline', 'error', 'idle', 'syncing', 'signedOut', 'paused', 'demo', 'starting'] as const) {
      expect(restoreBlockedReason('account', phase)).toBeNull();
      expect(restoreBlockedReason('device', phase)).toBeNull();
    }
  });
});

describe('deviceWord', () => {
  it('says phone until the device syncs', () => {
    expect(deviceWord(false)).toBe('phone');
    expect(deviceWord(true)).toBe('device');
  });
});

describe('problemCopy', () => {
  const ctx = { word: 'phone' } as const;

  it.each([
    ['notJson', "That file isn't a backup", 'It isn\'t a JSON file. Pick one saved by Export now, named like kira-makan-backup-2026-10-16.json.'],
    ['notABackup', "That's not a Kira Makan backup", "The file is JSON, but this app didn't make it. Pick one saved by Export now."],
    ['newerVersion', 'This backup is from a newer version', 'Close the app and open it again to get the latest version, then choose the file again.'],
    ['incomplete', 'This backup has no diary in it', "It has no profile or goals, so there's nothing to restore. Nothing was changed."],
    ['sampleData', 'This backup is the sample week', "Sample data isn't a diary, so it can't replace yours. Nothing was changed."],
    ['tooBig', 'This file is too big to open here', "Backups over 128 MB can't be opened on a phone. Nothing was changed."],
    ['unreadable', "Couldn't read that file", "If it's in the cloud, download it to this phone first, then choose it again."],
  ] as const)('%s', (reason, title, body) => {
    expect(problemCopy(new BackupImportError(reason, 'internal words'), ctx)).toEqual({ title, body, canRetry: true });
  });

  it('shows what is damaged in the file’s own words, and only then', () => {
    expect(problemCopy(new BackupImportError('badRow', 'meals row 12 has a bad items'), ctx)).toEqual({
      title: 'Part of this file is damaged',
      body: 'Nothing was changed. Try an earlier backup.',
      detail: 'meals row 12 has a bad items',
      canRetry: true,
    });
  });

  it('says the disk is full, with the right word, and offers no Try again', () => {
    const full = Object.assign(new Error('full'), { name: 'QuotaExceededError' });
    expect(problemCopy(full, { word: 'phone' })).toEqual({
      title: 'Not enough storage',
      body: "There isn't enough storage left on this phone for this backup. Nothing was changed.",
      canRetry: false,
    });
    expect(problemCopy(full, { word: 'device' }).body).toBe("There isn't enough storage left on this device for this backup. Nothing was changed.");
    // Dexie wraps the browser's error.
    const wrapped = Object.assign(new Error('Dexie'), { name: 'AbortError', inner: full });
    expect(problemCopy(wrapped, ctx).title).toBe('Not enough storage');
  });

  it('says the account could not be reached', () => {
    expect(problemCopy(new CatchUpFailed(), ctx)).toEqual({
      title: "Couldn't reach your account",
      body: "Restoring a file replaces your account's copy too, so it needs a connection first. Nothing was changed.",
      canRetry: true,
    });
  });

  it('sends a catch-up that ended in a Needs-you state to Settings, and keeps the connection message otherwise', () => {
    for (const phase of ['needsSignIn', 'otherAccount', 'cloudReset', 'choose', 'notSetUp'] as const) {
      expect(problemCopy(new CatchUpFailed(phase), ctx)).toEqual({
        title: 'Sync needs you first',
        body: 'Open Settings, then come back to restore a file. Nothing was changed.',
        canRetry: false,
        needsSettings: true,
      });
    }
    for (const phase of ['offline', 'error', 'syncing', 'paused'] as const) {
      expect(problemCopy(new CatchUpFailed(phase), ctx)).toMatchObject({ title: "Couldn't reach your account", canRetry: true });
    }
  });

  it('says a write that failed changed nothing', () => {
    expect(problemCopy(new Error('boom'), ctx)).toEqual({
      title: "Couldn't restore right now",
      body: 'Nothing was changed. Try again.',
      canRetry: true,
    });
    expect(problemCopy('not even an error', ctx).title).toBe("Couldn't restore right now");
  });

  it('never moralises', () => {
    const reasons = ['notJson', 'notABackup', 'newerVersion', 'badRow', 'incomplete', 'sampleData', 'tooBig', 'unreadable'] as const;
    const texts = [...reasons.map((r) => problemCopy(new BackupImportError(r, 'x'), ctx)), problemCopy(new CatchUpFailed(), ctx), problemCopy(new CatchUpFailed('needsSignIn'), ctx), problemCopy(new Error(), ctx)];
    for (const copy of texts) expect(`${copy.title} ${copy.body}`).not.toMatch(/please|sorry|oops|!|your fault/i);
  });
});

describe('the preview', () => {
  const ZERO = Object.fromEntries(TABLE_NAMES.map((table) => [table, 0])) as BackupPreview['counts'];
  const preview = (counts: Partial<BackupPreview['counts']> = {}, rest: Partial<BackupPreview> = {}): BackupPreview => ({
    exportedAt: SAVED_AT,
    photos: 'omitted',
    counts: { ...ZERO, ...counts },
    timeZone: TZ,
    ...rest,
  });
  const comparison = (meals: number, weights: number): DeviceComparison => ({ meals: 100, weights: 20, onlyHere: { meals, weights } });

  describe('title and lead', () => {
    it('is a question when something is replaced', () => {
      expect(previewTitle('none')).toBe('Restore this backup');
      expect(previewTitle('sample')).toBe('Restore this backup?');
      expect(previewTitle('device')).toBe('Restore this backup?');
      expect(previewTitle('account')).toBe('Restore this backup?');
    });

    it('says what the restore does for each reach', () => {
      expect(previewLead('none', 'phone')).toBe('This sets up your diary from the backup.');
      expect(previewLead('sample', 'phone')).toBe('This replaces the sample week with your backup.');
      expect(previewLead('device', 'phone')).toBe('Everything on this phone is replaced by this backup.');
      expect(previewLead('device', 'device')).toBe('Everything on this device is replaced by this backup.');
      expect(previewLead('account', 'device')).toBe(
        'Everything on this device, in your account and on your other devices is replaced by this backup.',
      );
    });
  });

  describe('previewRows', () => {
    it('always shows Meals, even at zero, and hides the other kinds at zero', () => {
      expect(previewRows(preview().counts)).toEqual([{ id: 'meals', label: 'Meals', value: '0' }]);
    });

    it('shows the kinds the file has, in order, with thousands separators', () => {
      const rows = previewRows(preview({ meals: 1240, weights: 62, workouts: 3, places: 12, usuals: 4, pots: 1, goals: 4 }).counts);
      expect(rows.map((r) => [r.label, r.value])).toEqual([
        ['Meals', '1,240'],
        ['Weigh-ins', '62'],
        ['Workouts', '3'],
        ['Places', '12'],
        ['Usuals', '4'],
        ['Pots', '1'],
        ['Goals', '4'],
      ]);
    });

    it('adds the rest up under Other entries', () => {
      const counts = preview({
        meals: 5,
        goalVersions: 4,
        goalPeriods: 2,
        bonuses: 1,
        days: 18,
        weekPlans: 3,
        insightFeedback: 2,
        suggestionEvents: 6,
        personalItems: 3,
        profile: 1,
        photos: 9,
      }).counts;
      expect(previewRows(counts)).toEqual([
        { id: 'meals', label: 'Meals', value: '5' },
        { id: 'other', label: 'Other entries', value: '39' },
      ]);
    });
  });

  describe('lostNote', () => {
    it('says what will be lost, in words', () => {
      expect(lostNote(comparison(12, 3), 'phone')).toEqual({
        tone: 'amber',
        text: 'On this phone but not in the backup: 12 meals and 3 weigh-ins. They will be lost.',
      });
    });

    it('uses singular and leaves out a zero part', () => {
      expect(lostNote(comparison(1, 3), 'device').text).toBe('On this device but not in the backup: 1 meal and 3 weigh-ins. They will be lost.');
      expect(lostNote(comparison(12, 1), 'phone').text).toBe('On this phone but not in the backup: 12 meals and 1 weigh-in. They will be lost.');
      expect(lostNote(comparison(0, 2), 'phone').text).toBe('On this phone but not in the backup: 2 weigh-ins. They will be lost.');
      expect(lostNote(comparison(1240, 0), 'phone').text).toBe('On this phone but not in the backup: 1,240 meals. They will be lost.');
    });

    it('says nothing is lost when everything here is in the file', () => {
      expect(lostNote(comparison(0, 0), 'phone')).toEqual({ tone: 'neutral', text: 'Everything on this phone is also in the backup.' });
      expect(lostNote(comparison(0, 0), 'device').text).toBe('Everything on this device is also in the backup.');
    });
  });

  describe('previewCard', () => {
    const NOW_34_DAYS_ON = new Date('2026-11-19T04:00:00.000Z');
    const card = (over: Partial<Parameters<typeof previewCard>[0]> = {}) =>
      previewCard({ fileName: 'kira-makan-backup-2026-10-16.json', preview: preview({ meals: 3 }), comparison: null, word: 'phone', now: NOW_34_DAYS_ON, ...over });

    it('says when it was exported, and how long ago', () => {
      expect(card()).toMatchObject({
        fileName: 'kira-makan-backup-2026-10-16.json',
        exportedLine: 'Exported 16 Oct 2026, 7:10pm',
        agoLine: '34 days ago',
      });
      expect(card({ now: new Date('2026-10-16T14:00:00.000Z') }).agoLine).toBe('Today');
      expect(card({ now: new Date('2026-10-17T14:00:00.000Z') }).agoLine).toBe('Yesterday');
    });

    it('reads a backup dated after now as today', () => {
      expect(card({ now: new Date('2026-09-01T00:00:00.000Z') }).agoLine).toBe('Today');
    });

    it('counts days in the file’s time zone', () => {
      // 11:10 UTC is 4:10am the next day in Auckland-ish zones; calendar days follow the diary's zone.
      const auckland = preview({ meals: 1 }, { timeZone: 'Pacific/Auckland' });
      expect(card({ preview: auckland }).exportedLine).toBe('Exported 17 Oct 2026, 12:10am');
    });

    it('says the date is unknown without one', () => {
      const none = card({ preview: preview({ meals: 3 }, { exportedAt: null }) });
      expect(none.exportedLine).toBe('Export date unknown');
      expect(none.agoLine).toBeUndefined();
    });

    it('spans the meals, when there are any', () => {
      expect(card({ preview: preview({ meals: 3 }, { mealDays: { from: '2026-03-03', to: '2026-10-16' } }) }).spanLine).toBe(
        'Meals from 3 Mar 2026 to 16 Oct 2026',
      );
      expect(card().spanLine).toBeUndefined();
    });

    it('says what happens to photos', () => {
      expect(card().photosLine).toBe('Photos: not in this file. Photos on this phone stay.');
      expect(card({ word: 'device' }).photosLine).toBe('Photos: not in this file. Photos on this device stay.');
      expect(card({ preview: preview({ meals: 3, photos: 2 }, { photos: 'included' }) }).photosLine).toBe(
        'Photos: 2 included. They replace the photos on this phone.',
      );
      expect(card({ word: 'device', preview: preview({ photos: 1240 }, { photos: 'included' }) }).photosLine).toBe(
        'Photos: 1,240 included. They replace the photos on this device.',
      );
    });

    it('has a note only with a comparison', () => {
      expect(card().note).toBeUndefined();
      expect(card({ comparison: comparison(2, 0) }).note).toEqual({
        tone: 'amber',
        text: 'On this phone but not in the backup: 2 meals. They will be lost.',
      });
      expect(card({ comparison: comparison(0, 0) }).note?.tone).toBe('neutral');
    });

    it('passes the rows on', () => {
      expect(card().rows).toEqual([{ id: 'meals', label: 'Meals', value: '3' }]);
    });
  });
});

describe('confirmCopy', () => {
  const base = { word: 'phone', exportedAt: SAVED_AT, tz: TZ } as const;

  it('asks for a plain confirm on a device that does not sync', () => {
    expect(confirmCopy({ ...base, reach: 'device' })).toEqual({
      title: 'Replace everything on this phone?',
      body: "The backup from 16 Oct 2026 replaces every meal, weigh-in, Place and goal here. Anything added since then is lost, and it can't be undone.",
      confirmLabel: 'Replace everything',
    });
    expect(confirmCopy({ ...base, word: 'device', reach: 'device' }).title).toBe('Replace everything on this device?');
  });

  it('asks to type REPLACE when the account follows', () => {
    expect(confirmCopy({ ...base, word: 'device', reach: 'account' })).toEqual({
      title: 'Replace your diary everywhere?',
      body: "The backup from 16 Oct 2026 replaces every meal, weigh-in, Place and goal on this device, in your account and on your other devices. Anything added since then is lost, and it can't be undone.",
      confirmLabel: 'Replace everything',
      requireTyping: 'REPLACE',
    });
  });

  it('leaves the date out when the file has none', () => {
    expect(confirmCopy({ ...base, reach: 'device', exportedAt: null }).body).toBe(
      "The backup replaces every meal, weigh-in, Place and goal here. Anything added since then is lost, and it can't be undone.",
    );
    expect(confirmCopy({ ...base, reach: 'account', exportedAt: null }).body.startsWith('The backup replaces every meal')).toBe(true);
  });
});

describe('restoredCopy', () => {
  const zero = Object.fromEntries(TABLE_NAMES.map((table) => [table, 0])) as BackupPreview['counts'];
  const counts = (meals: number, weights: number, places: number) => ({ counts: { ...zero, meals, weights, places } });

  it('lists up to three of meals, weigh-ins and Places', () => {
    expect(restoredCopy(counts(1240, 62, 12), 'device', 'phone')).toEqual({
      summary: 'Your backup is on this phone: 1,240 meals, 62 weigh-ins and 12 Places.',
    });
  });

  it('leaves out what the file has none of, and uses singular', () => {
    expect(restoredCopy(counts(1240, 0, 0), 'device', 'phone').summary).toBe('Your backup is on this phone: 1,240 meals.');
    expect(restoredCopy(counts(1, 1, 1), 'device', 'phone').summary).toBe('Your backup is on this phone: 1 meal, 1 weigh-in and 1 Place.');
    expect(restoredCopy(counts(0, 62, 12), 'device', 'phone').summary).toBe('Your backup is on this phone: 62 weigh-ins and 12 Places.');
  });

  it('is short when the file is empty', () => {
    expect(restoredCopy(counts(0, 0, 0), 'device', 'phone').summary).toBe('Your backup is on this phone.');
  });

  it('says the sample week is gone', () => {
    expect(restoredCopy(counts(9, 2, 0), 'sample', 'phone').summary).toBe('Your backup is on this phone: 9 meals and 2 weigh-ins. The sample week is gone.');
    expect(restoredCopy(counts(0, 0, 0), 'sample', 'phone').summary).toBe('Your backup is on this phone. The sample week is gone.');
  });

  it('adds the account line for an account restore only', () => {
    expect(restoredCopy(counts(9, 2, 0), 'account', 'device')).toEqual({
      summary: 'Your backup is on this device: 9 meals and 2 weigh-ins.',
      account: 'Your account and your other devices follow as this device syncs.',
    });
    expect(restoredCopy(counts(9, 2, 0), 'device', 'phone').account).toBeUndefined();
  });
});

describe('mealsLabel', () => {
  it('is singular for one', () => {
    expect(mealsLabel(1)).toBe('1 meal');
    expect(mealsLabel(0)).toBe('0 meals');
    expect(mealsLabel(1240)).toBe('1,240 meals');
  });
});

describe('driveBackupActions', () => {
  const NOW = Date.parse(SAVED_AT);
  const base: DriveEngineState = {
    configured: true,
    profile: 'real',
    keepPhotos: true,
    connected: true,
    email: 'you@example.com',
    gisReady: true,
    tokenExpiresAt: NOW + 30 * 60_000,
    authBusy: false,
    running: false,
    online: true,
    counts: { uploads: 0, files: 0, failed: 0 },
  };
  const copyOf = (patch: Partial<DriveEngineState>): DriveCopy => {
    const state = { ...base, ...patch };
    return describeDrive({ ...state, phase: drivePhase(state, NOW), now: NOW }, TZ);
  };
  const waiting = { counts: { uploads: 2, files: 0, failed: 0 } };

  it('runs Continue and Try again in place', () => {
    expect(driveBackupActions(copyOf({ ...waiting, tokenExpiresAt: undefined }))).toEqual([{ id: 'continue', label: 'Continue', variant: 'primary' }]);
    expect(driveBackupActions(copyOf({ ...waiting, error: 'unreachable' }))).toEqual([{ id: 'retry', label: 'Try again', variant: 'primary' }]);
    expect(driveBackupActions(copyOf({ ...waiting, error: 'driveFull' }))).toEqual([{ id: 'retry', label: 'Try again', variant: 'primary' }]);
  });

  it('makes Connect and Disconnect one Open Settings, primary only when the card needs you', () => {
    expect(driveBackupActions(copyOf({ connected: false }))).toEqual([{ id: 'manage', label: 'Open Settings', variant: 'secondary' }]);
    expect(driveBackupActions(copyOf({}))).toEqual([{ id: 'manage', label: 'Open Settings', variant: 'secondary' }]);
    expect(driveBackupActions(copyOf({ keepPhotos: false }))).toEqual([{ id: 'manage', label: 'Open Settings', variant: 'secondary' }]);
    const attention: DriveCopy = {
      tone: 'attention',
      pill: 'Needs you',
      title: 'x',
      facts: [],
      actions: [{ id: 'connect', label: 'Connect Google Drive', variant: 'primary' }],
    };
    expect(driveBackupActions(attention)).toEqual([{ id: 'manage', label: 'Open Settings', variant: 'primary' }]);
  });

  it('offers nothing where the card has nothing to do', () => {
    expect(driveBackupActions(copyOf({ profile: 'demo' }))).toEqual([]);
    expect(driveBackupActions(copyOf({ running: true }))).toEqual([]);
    expect(driveBackupActions(copyOf(waiting))).toEqual([]);
  });
});

describe('backupFileCaption', () => {
  it('says where the meal photos are', () => {
    expect(backupFileCaption('phone', false)).toBe(
      "The file goes to your downloads. Meal photos stay on this phone and aren't in it. Keep a copy somewhere off this phone.",
    );
    expect(backupFileCaption('device', true)).toBe(
      "The file goes to your downloads. Meal photos aren't in it; they're in your Google Drive. Keep a copy somewhere off this device.",
    );
  });
});
