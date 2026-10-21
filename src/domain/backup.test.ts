import { BACKUP_NUDGE_DAYS, backupStatus, type BackupStatusInput } from './backup';

const TZ = 'Asia/Kuala_Lumpur';
/** Wed 21 Oct 2026, 5pm in Kuala Lumpur. */
const NOW = new Date('2026-10-21T09:00:00.000Z');

function input(patch: Partial<BackupStatusInput> = {}): BackupStatusInput {
  return { now: NOW, tz: TZ, startedOn: '2026-10-11', mealCount: 12, demo: false, ...patch };
}

describe('backupStatus', () => {
  it('has a month as its limit', () => {
    expect(BACKUP_NUDGE_DAYS).toBe(30);
  });

  describe('never backed up', () => {
    it('counts the diary days from the start and is not due while young', () => {
      expect(backupStatus(input())).toEqual({ kind: 'never', diaryDays: 10, due: false });
    });

    it('is due from day 31, not before', () => {
      expect(backupStatus(input({ startedOn: '2026-09-21' }))).toEqual({ kind: 'never', diaryDays: 30, due: false });
      expect(backupStatus(input({ startedOn: '2026-09-20' }))).toEqual({ kind: 'never', diaryDays: 31, due: true });
    });

    it('is never due with no meals', () => {
      expect(backupStatus(input({ startedOn: '2025-01-01', mealCount: 0 }))).toEqual({ kind: 'never', diaryDays: 658, due: false });
    });

    it('treats a diary that starts after today (clock skew) as day 0', () => {
      expect(backupStatus(input({ startedOn: '2026-11-02' }))).toEqual({ kind: 'never', diaryDays: 0, due: false });
    });
  });

  describe('backed up', () => {
    it('counts calendar days in the profile time zone', () => {
      // 00:30 on 21 Sep in Kuala Lumpur, still 20 Sep in UTC.
      const lastBackupAt = '2026-09-20T16:30:00.000Z';
      expect(backupStatus(input({ lastBackupAt, now: new Date('2026-10-21T09:00:00.000Z') }))).toEqual({
        kind: 'exported',
        at: lastBackupAt,
        day: '2026-09-21',
        days: 30,
        due: false,
      });
      expect(backupStatus(input({ lastBackupAt, now: new Date('2026-10-22T00:00:00.000Z') }))).toEqual({
        kind: 'exported',
        at: lastBackupAt,
        day: '2026-09-21',
        days: 31,
        due: true,
      });
    });

    it('is today the same day', () => {
      const lastBackupAt = '2026-10-21T02:00:00.000Z';
      expect(backupStatus(input({ lastBackupAt }))).toMatchObject({ kind: 'exported', days: 0, due: false });
    });

    it('is not due with no meals, however old', () => {
      expect(backupStatus(input({ lastBackupAt: '2025-01-01T00:00:00.000Z', mealCount: 0 }))).toMatchObject({ kind: 'exported', due: false });
    });

    it('reads a backup dated after now as today and not due', () => {
      expect(backupStatus(input({ lastBackupAt: '2026-12-25T00:00:00.000Z' }))).toMatchObject({ kind: 'exported', days: 0, due: false });
    });

    it('falls back to the diary when the date can not be read', () => {
      expect(backupStatus(input({ lastBackupAt: 'not a date', startedOn: '2026-09-01' }))).toEqual({ kind: 'never', diaryDays: 50, due: true });
    });
  });

  it('is never due in demo mode', () => {
    expect(backupStatus(input({ demo: true, startedOn: '2025-01-01' }))).toMatchObject({ kind: 'never', due: false });
    expect(backupStatus(input({ demo: true, lastBackupAt: '2025-01-01T00:00:00.000Z' }))).toMatchObject({ kind: 'exported', due: false });
  });
});
