/**
 * Rows of the sync bookkeeping tables (Dexie version 2, ARCHITECTURE.md §6.2). Types only, so
 * db.ts, capture.ts and src/sync can share them without importing each other.
 */

export type SyncErrorKind = 'offline' | 'unreachable' | 'unavailable' | 'notSetUp' | 'needsSignIn'
  | 'cloudReset' | 'rejected' | 'failed' | 'aborted';

/**
 * One per changed `[table+key]`: the push reads the row as it is then (present: put, missing: delete).
 * `seenRev`: the newest revision of the row a pull left to this change (kept through later edits).
 */
export interface OutboxEntry { table: string; key: string; changedAt: number; nonce: string; failedAt?: number; seenRev?: number } // changedAt: Date.now()

/** The account's revision of a row this device last saw or sent. */
export interface RowRev { table: string; key: string; rev: number; hash?: string } // hash of the wire data, 'deleted', or absent (unknown)

/**
 * Which account and synced copy this device follows, and how far it has pulled. `checkPending`:
 * linked to an empty account, and the look that no other device uploaded first hasn't passed yet,
 * so nothing is pushed until it does (ARCHITECTURE.md §6.2).
 */
export interface SyncLink { userId: string; email?: string; dataset: string; deviceId: string; cursor: number; protocol: number; linkedAt: number; checkPending?: true }

/** The single syncMeta row. */
export interface SyncMeta { id: 'sync'; link?: SyncLink; paused?: true; lastSyncedAt?: number; lastError?: { kind: SyncErrorKind; at: number } }
