/**
 * This device's push record (decision §10.19 D2): the endpoint it saved, for whom and with which key.
 * localStorage, never synced and never exported: an endpoint belongs to one browser. `pending` means
 * the browser subscription exists but the server hasn't confirmed it yet. With storage blocked the
 * record is kept in memory, so it lasts until the app closes.
 */

export const PUSH_RECORD_KEY = 'kira-makan:push';

export interface PushRecord {
  endpoint: string;
  userId: string;
  vapidKey: string;
  /** When the server confirmed it (Date.now()). */
  savedAt?: number;
  pending?: true;
}

/** Used only while localStorage refuses. */
let memory: PushRecord | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parse(value: unknown): PushRecord | null {
  if (!isRecord(value)) return null;
  const { endpoint, userId, vapidKey, savedAt, pending } = value;
  if (typeof endpoint !== 'string' || !endpoint.startsWith('https://')) return null;
  if (typeof userId !== 'string' || userId === '' || typeof vapidKey !== 'string' || vapidKey === '') return null;
  const record: PushRecord = { endpoint, userId, vapidKey };
  if (typeof savedAt === 'number' && Number.isFinite(savedAt)) record.savedAt = savedAt;
  // A record the server never confirmed is pending, whatever it says.
  if (pending === true || record.savedAt === undefined) record.pending = true;
  return record;
}

export function readPushRecord(): PushRecord | null {
  try {
    const raw = window.localStorage.getItem(PUSH_RECORD_KEY);
    return raw ? parse(JSON.parse(raw)) : memory;
  } catch {
    return memory;
  }
}

export function writePushRecord(record: PushRecord): void {
  const clean = parse(record);
  memory = clean;
  try {
    window.localStorage.setItem(PUSH_RECORD_KEY, JSON.stringify(clean));
    memory = null;
  } catch {
    // Private mode or storage blocked: kept in memory.
  }
}

export function clearPushRecord(): void {
  memory = null;
  try {
    window.localStorage.removeItem(PUSH_RECORD_KEY);
  } catch {
    // Nothing stored.
  }
}
