/**
 * When a backup file is worth a nudge (Settings › Backups, S39). Pure: the screens pass the clock
 * in. Only a full backup (JSON) counts; a spreadsheet export restores nothing.
 */
import { daysBetween, logicalDayOf } from './day';
import type { Instant, LogicalDay } from './types';

/** The monthly nudge: due after more than this many calendar days. */
export const BACKUP_NUDGE_DAYS = 30;

export interface BackupStatusInput {
  /** The newest full backup (JSON) on record: an export here, or the file a restore came from. */
  lastBackupAt?: Instant;
  now: Date;
  tz: string;
  /** profile.startedOn: the reference when no backup was ever made. */
  startedOn: LogicalDay;
  mealCount: number;
  /** Demo mode: the sample week isn't worth backing up. */
  demo: boolean;
}

export type BackupStatus =
  | { kind: 'never'; diaryDays: number; due: boolean }
  | { kind: 'exported'; at: Instant; day: LogicalDay; days: number; due: boolean };

/**
 * Where the backups stand. Due means more than BACKUP_NUDGE_DAYS calendar days (in `tz`) since the
 * last backup, or, with none on record, since the diary started; never in demo mode and never
 * while the diary has no meals. A backup dated after `now` (clock skew) reads as today.
 */
export function backupStatus(input: BackupStatusInput): BackupStatus {
  const { lastBackupAt, now, tz, startedOn, mealCount, demo } = input;
  const today = logicalDayOf(now, tz, 0);
  const worthIt = !demo && mealCount > 0;

  if (lastBackupAt !== undefined && Number.isFinite(Date.parse(lastBackupAt))) {
    const day = logicalDayOf(lastBackupAt, tz, 0);
    const days = Math.max(0, daysBetween(day, today));
    return { kind: 'exported', at: lastBackupAt, day, days, due: worthIt && days > BACKUP_NUDGE_DAYS };
  }

  const diaryDays = Math.max(0, daysBetween(startedOn, today));
  return { kind: 'never', diaryDays, due: worthIt && diaryDays > BACKUP_NUDGE_DAYS };
}
