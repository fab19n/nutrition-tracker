import type { KiraMakanDb } from '@/db/db';
import type { DayRecord, DayStatusKind, Instant, LogicalDay } from '@/domain/types';

export function getDayRecord(db: KiraMakanDb, day: LogicalDay): Promise<DayRecord | undefined> {
  return db.days.get(day);
}

export async function putDayRecord(db: KiraMakanDb, record: DayRecord): Promise<void> {
  await db.days.put(record);
}

export async function deleteDayRecord(db: KiraMakanDb, day: LogicalDay): Promise<void> {
  await db.days.delete(day);
}

/** Records for days in [from, to] (both inclusive), in day order. Days without a record are absent. */
export function listDayRecordsInRange(db: KiraMakanDb, from: LogicalDay, to: LogicalDay): Promise<DayRecord[]> {
  return db.days.where('logicalDay').between(from, to, true, true).toArray();
}

export function listDayRecordsByStatus(db: KiraMakanDb, status: DayStatusKind): Promise<DayRecord[]> {
  return db.days.where('status').equals(status).sortBy('logicalDay');
}

/** Sets a day's status, keeping its sleep tap. Creates the record if needed. */
export async function setDayStatus(
  db: KiraMakanDb,
  day: LogicalDay,
  status: DayStatusKind,
  confirmedAt?: Instant,
): Promise<DayRecord> {
  return db.transaction('rw', db.days, async () => {
    const existing = await db.days.get(day);
    const record: DayRecord = { ...existing, logicalDay: day, status };
    if (confirmedAt) record.confirmedAt = confirmedAt;
    else delete record.confirmedAt;
    await db.days.put(record);
    return record;
  });
}

/** Records or clears the "Going to sleep" tap (C61). A new record starts unconfirmed. */
export async function setSleepAt(db: KiraMakanDb, day: LogicalDay, sleepAt: Instant | null): Promise<DayRecord> {
  return db.transaction('rw', db.days, async () => {
    const existing = await db.days.get(day);
    const record: DayRecord = existing ? { ...existing } : { logicalDay: day, status: 'unconfirmed' };
    if (sleepAt) record.sleepAt = sleepAt;
    else delete record.sleepAt;
    await db.days.put(record);
    return record;
  });
}
