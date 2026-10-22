/**
 * Rows of the Drive photo bookkeeping tables (Dexie version 3, ARCHITECTURE.md §10.18): local only,
 * never exported, never captured, cleared by every wipe. Types only, so db.ts, driveQueue.ts and
 * src/drive can share them without importing each other.
 */
import type { Id } from '@/domain/types';

/** Why a job waits: unreachable (backing off), refused (Drive said no to this request), tooBig, failed (a bug or a local error). */
export type DriveJobProblem = 'unreachable' | 'refused' | 'tooBig' | 'failed';

interface DriveJobBase {
  /** Real-clock ms (Date.now), never the demo clock: jobs never exist in demo. */
  createdAt: number;
  /** Not before this (ms). Backoff and the trash delay move it. */
  notBefore: number;
  /** Failed tries so far (drives the backoff). */
  attempts: number;
  /** Set aside until the next app start (a 4xx the request itself caused, or a file too big). */
  failedAt?: number;
  lastProblem?: DriveJobProblem;
}

/** Upload one meal photo. Key `upload:<photoId>`. */
export interface DriveUploadJob extends DriveJobBase {
  id: string;
  kind: 'upload';
  photoId: Id;
  mealId: Id;
}

/** Bring one Drive file to `trashed`. Key `file:<fileId>`: one job per file, the last wish wins. */
export interface DriveFileJob extends DriveJobBase {
  id: string;
  kind: 'file';
  fileId: string;
  trashed: boolean;
}

export type DriveJob = DriveUploadJob | DriveFileJob;

/** This device's Google Drive connection. One row, id 'drive'; missing = not connected. */
export interface DriveMeta {
  id: 'drive';
  /** Set when connected on this device (ms). */
  connectedAt?: number;
  /** The Google account (Drive about.get), the login hint for later token requests. Never synced. */
  email?: string;
  /** The Kira Makan photos folder, cached. */
  folderId?: string;
  /** When this device last wrote a pointer (ms), for "Last photo uploaded 5 min ago". */
  lastUploadAt?: number;
}
