/**
 * What the Backups screen says (S39) and when it lets you restore: the export card, the
 * Settings row's sub-line, the sync card's actions here, the problems a backup file can have, and
 * the preview, confirm and result copy of "Restore from a backup file". Pure, so every state and
 * string is tested without a database, an engine or a clock.
 */
import type { BackupPreviewProps, BackupPreviewRow } from '@/components/BackupPreview/BackupPreview';
import { BackupImportError, type BackupPreview, type DeviceComparison, type ImportSummary } from '@/db/export';
import type { BackupStatus } from '@/domain/backup';
import { daysBetween, logicalDayOf } from '@/domain/day';
import { ageText, fmtDateYear, fmtDayShort, fmtInt, fmtTime } from '@/domain/format';
import type { Instant, Profile } from '@/domain/types';
import type { SyncPhase } from '@/sync/engine';
import type { SyncCopy, SyncView } from '@/sync/status';

/** "phone" while the device isn't linked to an account, "device" once it is (a laptop syncs too). */
export type DeviceWord = 'phone' | 'device';

export function deviceWord(linked: boolean): DeviceWord {
  return linked ? 'device' : 'phone';
}

// ---------------------------------------------------------------------------
// The backup-file card and the Settings row
// ---------------------------------------------------------------------------

export interface ExportCardCopy {
  tone: 'ok' | 'off' | 'attention';
  pill: string;
  title: string;
  detail: string;
  /** check: saved · down: none yet · clock: due. The screen maps it to a lucide icon. */
  icon: 'check' | 'down' | 'clock';
  /** Export now is the primary button when a backup is due, secondary otherwise. */
  action: 'primary' | 'secondary';
}

/**
 * The backup-file card. A backup is due after more than 30 days (src/domain/backup.ts), and the
 * words say how long and what to do, never "overdue" or "you forgot". A linked device mentions that
 * its account holds a copy too, so the nudge doesn't read as the only safety there is.
 */
export function exportCardCopy(status: BackupStatus, ctx: { tz: string; linked: boolean; word?: DeviceWord }): ExportCardCopy {
  if (status.kind === 'never') {
    if (!status.due) {
      return {
        tone: 'off',
        pill: 'None yet',
        title: 'No export yet',
        detail: 'Export saves your whole diary as one file you can restore from.',
        icon: 'down',
        action: 'secondary',
      };
    }
    const age = `Your diary is ${fmtInt(status.diaryDays)} days old.`;
    return {
      tone: 'attention',
      pill: 'Due',
      title: 'No export yet',
      detail: ctx.linked
        ? `${age} Your account has a copy; a file is one that lives outside it.`
        : `${age} A file is a copy that lives outside the app.`,
      icon: 'clock',
      action: 'primary',
    };
  }

  if (!status.due) {
    return {
      tone: 'ok',
      pill: 'Saved',
      title: `Last export ${ageText(status.days)}`,
      detail: `${fmtDayShort(status.day)}, ${fmtTime(status.at, ctx.tz)}`,
      icon: 'check',
      action: 'secondary',
    };
  }
  return {
    tone: 'attention',
    pill: 'Due',
    title: `Last export ${ageText(status.days)}`,
    detail: ctx.linked
      ? "It's been a while. Your account keeps a copy; a fresh file doesn't depend on it."
      : "It's been a while. A fresh file takes a few seconds.",
    icon: 'clock',
    action: 'primary',
  };
}

/** The Settings › Backups row's sub-line: the monthly nudge shows here, quietly, and nowhere else outside this screen. */
export function backupsRowSub(status: BackupStatus, authConfigured: boolean): string {
  if (status.due) {
    return status.kind === 'exported'
      ? `Last export ${ageText(status.days)}. Time for a new one.`
      : 'No export yet. Time for one.';
  }
  return authConfigured ? 'Sync, export and restore' : 'Export and restore';
}

// ---------------------------------------------------------------------------
// The sync card on this screen
// ---------------------------------------------------------------------------

export interface BackupAction {
  /** syncNow and retry run in place; manage opens Settings. */
  id: 'syncNow' | 'retry' | 'manage';
  label: string;
  variant: 'primary' | 'secondary' | 'ghost';
}

/**
 * The sync card's buttons here. Sync now and Try again run in place; anything else the card would
 * offer (Sign in, Choose, Switch, Upload, Turn on sync…) is one Open Settings, where those flows
 * and their confirms live. Never Sign in, Sign out, Choose or Switch on this screen.
 */
export function backupActions(copy: SyncCopy): BackupAction[] {
  const inPlace = copy.actions.find((action) => action.id === 'syncNow' || action.id === 'retry');
  if (inPlace && (inPlace.id === 'syncNow' || inPlace.id === 'retry')) {
    return [{ id: inPlace.id, label: inPlace.label, variant: inPlace.variant }];
  }
  if (copy.actions.length > 0) {
    return [{ id: 'manage', label: 'Open Settings', variant: copy.tone === 'attention' ? 'primary' : 'secondary' }];
  }
  return [];
}

/** A line under the sync card for the states where a file matters more than the account. */
export function accountNote(phase: SyncPhase): string | undefined {
  if (phase === 'signedOut') {
    return 'Until you sign in, your diary is only on this phone. A backup file is another way to keep a copy.';
  }
  if (phase === 'demo') {
    return 'Backups start once you set up your own diary. A backup file can still replace the sample week.';
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Who a restore reaches
// ---------------------------------------------------------------------------

/**
 * none: no diary here yet (Welcome) · sample: the demo week · device: a real diary that isn't
 * syncing · account: a diary that syncs, so a restore replaces the account's copy and the other
 * devices' too.
 */
export type RestoreReach = 'none' | 'sample' | 'device' | 'account';

export function restoreReach(profile: Pick<Profile, 'demoMode'> | undefined, view: Pick<SyncView, 'linked' | 'phase'>): RestoreReach {
  if (!profile) return 'none';
  if (profile.demoMode) return 'sample';
  return view.linked && view.phase !== 'paused' && view.phase !== 'unconfigured' ? 'account' : 'device';
}

/** The sync states that wait for the user in Settings before an account restore can be trusted. */
const NEEDS_YOU: ReadonlySet<SyncPhase> = new Set<SyncPhase>(['needsSignIn', 'otherAccount', 'cloudReset', 'choose', 'notSetUp']);

/** Why Choose a backup file is disabled, or null when it isn't. */
export function restoreBlockedReason(reach: RestoreReach, phase: SyncPhase): string | null {
  if (phase === 'uploading' || phase === 'restoring') {
    return 'Sync is copying your diary. You can restore a file when it finishes.';
  }
  if (reach === 'account' && NEEDS_YOU.has(phase)) {
    return 'Sync needs you first. Open Settings, then come back to restore a file.';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Problems
// ---------------------------------------------------------------------------

export interface ProblemCopy {
  title: string;
  body: string;
  /** The file's own words for what is damaged ("meals row 12 has a bad items"). */
  detail?: string;
  /** Try again can help (not for a full disk, nor when Settings has to put sync right first). */
  canRetry: boolean;
  /** Settings is where this gets fixed: the sheet offers Open Settings instead of Try again. */
  needsSettings?: boolean;
}

/**
 * An account restore stopped before writing: the catch-up sync didn't end up to date. `phase` is
 * where the engine stopped, which says whether a connection or Settings is what's missing.
 */
export class CatchUpFailed extends Error {
  constructor(readonly phase?: SyncPhase) {
    super('Sync did not catch up before the restore');
    this.name = 'CatchUpFailed';
  }
}

const FILE_PROBLEMS: Record<BackupImportError['reason'], Omit<ProblemCopy, 'detail' | 'canRetry'>> = {
  notJson: {
    title: "That file isn't a backup",
    body: "It isn't a JSON file. Pick one saved by Export now, named like kira-makan-backup-2026-10-16.json.",
  },
  notABackup: {
    title: "That's not a Kira Makan backup",
    body: "The file is JSON, but this app didn't make it. Pick one saved by Export now.",
  },
  newerVersion: {
    title: 'This backup is from a newer version',
    body: 'Close the app and open it again to get the latest version, then choose the file again.',
  },
  badRow: { title: 'Part of this file is damaged', body: 'Nothing was changed. Try an earlier backup.' },
  incomplete: {
    title: 'This backup has no diary in it',
    body: "It has no profile or goals, so there's nothing to restore. Nothing was changed.",
  },
  sampleData: {
    title: 'This backup is the sample week',
    body: "Sample data isn't a diary, so it can't replace yours. Nothing was changed.",
  },
  tooBig: {
    title: 'This file is too big to open here',
    body: "Backups over 128 MB can't be opened on a phone. Nothing was changed.",
  },
  unreadable: {
    title: "Couldn't read that file",
    body: "If it's in the cloud, download it to this phone first, then choose it again.",
  },
};

function isStorageFull(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e && typeof e === 'object' && depth < 3; depth += 1) {
    if ((e as { name?: unknown }).name === 'QuotaExceededError') return true;
    e = (e as { inner?: unknown }).inner;
  }
  return false;
}

/**
 * What to tell about a file that was refused, or a restore that stopped. Everything says whether
 * anything changed; for a write that failed it is always "Nothing was changed" (one transaction).
 */
export function problemCopy(error: unknown, ctx: { word: DeviceWord }): ProblemCopy {
  if (error instanceof BackupImportError) {
    const copy: ProblemCopy = { ...FILE_PROBLEMS[error.reason], canRetry: true };
    if (error.reason === 'badRow') copy.detail = error.message;
    return copy;
  }
  if (error instanceof CatchUpFailed) {
    // Online and still stuck: the token was refused, the account changed or was reset. Trying again
    // repeats the same answer; signing in or choosing in Settings is the fix.
    if (error.phase && NEEDS_YOU.has(error.phase)) {
      return {
        title: 'Sync needs you first',
        body: 'Open Settings, then come back to restore a file. Nothing was changed.',
        canRetry: false,
        needsSettings: true,
      };
    }
    return {
      title: "Couldn't reach your account",
      body: "Restoring a file replaces your account's copy too, so it needs a connection first. Nothing was changed.",
      canRetry: true,
    };
  }
  if (isStorageFull(error)) {
    return {
      title: 'Not enough storage',
      body: `There isn't enough storage left on this ${ctx.word} for this backup. Nothing was changed.`,
      canRetry: false,
    };
  }
  return { title: "Couldn't restore right now", body: 'Nothing was changed. Try again.', canRetry: true };
}

// ---------------------------------------------------------------------------
// The preview, the confirm and the result
// ---------------------------------------------------------------------------

/** '1 meal', '1,240 meals'. */
export function mealsLabel(n: number): string {
  return `${fmtInt(n)} ${n === 1 ? 'meal' : 'meals'}`;
}

function countLabel(n: number, one: string, many: string): string {
  return `${fmtInt(n)} ${n === 1 ? one : many}`;
}

/** The sheet's title over the preview: a question when something is replaced. */
export function previewTitle(reach: RestoreReach): string {
  return reach === 'none' ? 'Restore this backup' : 'Restore this backup?';
}

/** The line above the preview card: what a restore does. */
export function previewLead(reach: RestoreReach, word: DeviceWord): string {
  switch (reach) {
    case 'none':
      return 'This sets up your diary from the backup.';
    case 'sample':
      return 'This replaces the sample week with your backup.';
    case 'device':
      return `Everything on this ${word} is replaced by this backup.`;
    case 'account':
      return 'Everything on this device, in your account and on your other devices is replaced by this backup.';
  }
}

/** Entries counted together under "Other entries". */
const OTHER_TABLES = [
  'goalVersions',
  'goalPeriods',
  'bonuses',
  'days',
  'weekPlans',
  'insightFeedback',
  'suggestionEvents',
  'personalItems',
] as const;

/** The count rows: Meals always, the others only when the file has some. */
export function previewRows(counts: BackupPreview['counts']): BackupPreviewRow[] {
  const rows: BackupPreviewRow[] = [{ id: 'meals', label: 'Meals', value: fmtInt(counts.meals) }];
  const optional: [string, string, number][] = [
    ['weights', 'Weigh-ins', counts.weights],
    ['workouts', 'Workouts', counts.workouts],
    ['places', 'Places', counts.places],
    ['usuals', 'Usuals', counts.usuals],
    ['pots', 'Pots', counts.pots],
    ['goals', 'Goals', counts.goals],
    ['other', 'Other entries', OTHER_TABLES.reduce((sum, table) => sum + counts[table], 0)],
  ];
  for (const [id, label, count] of optional) {
    if (count > 0) rows.push({ id, label, value: fmtInt(count) });
  }
  return rows;
}

/** "On this phone but not in the backup: 12 meals and 3 weigh-ins. They will be lost." or the all-clear. */
export function lostNote(comparison: DeviceComparison, word: DeviceWord): NonNullable<BackupPreviewProps['note']> {
  const { meals, weights } = comparison.onlyHere;
  const parts = [meals > 0 ? countLabel(meals, 'meal', 'meals') : '', weights > 0 ? countLabel(weights, 'weigh-in', 'weigh-ins') : ''].filter(Boolean);
  if (parts.length === 0) return { tone: 'neutral', text: `Everything on this ${word} is also in the backup.` };
  return { tone: 'amber', text: `On this ${word} but not in the backup: ${parts.join(' and ')}. They will be lost.` };
}

/** The file's export date in its own zone, '16 Oct 2026', for the preview and the confirm. */
function exportedDay(exportedAt: Instant, tz: string): string {
  return logicalDayOf(exportedAt, tz, 0);
}

/**
 * The preview card's lines. `now` is the app clock (useNow), `comparison` is set for a device or an
 * account restore only (where something here can be lost).
 */
export function previewCard(input: {
  fileName: string;
  preview: BackupPreview;
  comparison: DeviceComparison | null;
  word: DeviceWord;
  now: Date;
}): BackupPreviewProps {
  const { fileName, preview, comparison, word, now } = input;
  const props: BackupPreviewProps = {
    fileName,
    exportedLine: 'Export date unknown',
    rows: previewRows(preview.counts),
    photosLine:
      preview.photos === 'included'
        ? `Photos: ${fmtInt(preview.counts.photos)} included. They replace the photos on this ${word}.`
        : `Photos: not in this file. Photos on this ${word} stay.`,
  };

  if (preview.exportedAt) {
    const day = exportedDay(preview.exportedAt, preview.timeZone);
    props.exportedLine = `Exported ${fmtDateYear(day)}, ${fmtTime(preview.exportedAt, preview.timeZone)}`;
    const ago = ageText(Math.max(0, daysBetween(day, logicalDayOf(now, preview.timeZone, 0))));
    props.agoLine = ago.charAt(0).toUpperCase() + ago.slice(1);
  }
  if (preview.mealDays) props.spanLine = `Meals from ${fmtDateYear(preview.mealDays.from)} to ${fmtDateYear(preview.mealDays.to)}`;
  if (comparison) props.note = lostNote(comparison, word);
  return props;
}

export interface ConfirmCopy {
  title: string;
  body: string;
  confirmLabel: string;
  /** Typed to confirm: an account restore reaches every device. */
  requireTyping?: string;
}

/** The destructive confirm over the preview (reach device or account). */
export function confirmCopy(input: { reach: 'device' | 'account'; word: DeviceWord; exportedAt: Instant | null; tz: string }): ConfirmCopy {
  const { reach, word, exportedAt, tz } = input;
  const backup = exportedAt ? `The backup from ${fmtDateYear(exportedDay(exportedAt, tz))}` : 'The backup';
  if (reach === 'account') {
    return {
      title: 'Replace your diary everywhere?',
      body: `${backup} replaces every meal, weigh-in, Place and goal on this device, in your account and on your other devices. Anything added since then is lost, and it can't be undone.`,
      confirmLabel: 'Replace everything',
      requireTyping: 'REPLACE',
    };
  }
  return {
    title: `Replace everything on this ${word}?`,
    body: `${backup} replaces every meal, weigh-in, Place and goal here. Anything added since then is lost, and it can't be undone.`,
    confirmLabel: 'Replace everything',
  };
}

/** 'a', 'a and b', 'a, b and c'. */
function joinAnd(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

export interface RestoredCopy {
  /** "Your backup is on this phone: 1,240 meals, 62 weigh-ins and 12 Places." */
  summary: string;
  /** An account restore: the rest of the account follows. */
  account?: string;
}

/** The result lines once the restore is done. */
export function restoredCopy(summary: Pick<ImportSummary, 'counts'>, reach: RestoreReach, word: DeviceWord): RestoredCopy {
  const { meals, weights, places } = summary.counts;
  const list = joinAnd(
    [
      meals > 0 ? countLabel(meals, 'meal', 'meals') : '',
      weights > 0 ? countLabel(weights, 'weigh-in', 'weigh-ins') : '',
      places > 0 ? countLabel(places, 'Place', 'Places') : '',
    ].filter(Boolean),
  );
  const line = list ? `Your backup is on this ${word}: ${list}.` : `Your backup is on this ${word}.`;
  const copy: RestoredCopy = { summary: reach === 'sample' ? `${line} The sample week is gone.` : line };
  if (reach === 'account') copy.account = 'Your account and your other devices follow as this device syncs.';
  return copy;
}
