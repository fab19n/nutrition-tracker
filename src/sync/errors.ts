/**
 * Sync failures, by kind (ARCHITECTURE.md §6.2). The engine picks its retry and the Settings card
 * picks its copy from `kind` alone, so every failure is turned into a SyncError where it happens.
 */
import type { SyncErrorKind } from '@/db/syncTypes';

export class SyncError extends Error {
  readonly kind: SyncErrorKind;

  constructor(kind: SyncErrorKind, message?: string, options?: { cause?: unknown }) {
    super(message ?? kind, options);
    this.name = 'SyncError';
    this.kind = kind;
  }
}

export function isSyncError(error: unknown, kind?: SyncErrorKind): error is SyncError {
  return error instanceof SyncError && (kind === undefined || error.kind === kind);
}

function readString(value: unknown, field: string): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const found: unknown = (value as Record<string, unknown>)[field];
  return typeof found === 'string' ? found : undefined;
}

const SIGN_IN_CODES = new Set(['PT401', 'PGRST301', 'PGRST302', 'PGRST303']);
const NOT_SET_UP_CODES = new Set(['PGRST202', 'PGRST205', '42883', '42501']);

/**
 * Classifies a failed call from its HTTP status and the error postgrest-js returned (a plain
 * object with `code`, so never `instanceof`). An abort the caller asked for is 'aborted'; the
 * caller checks its own signal first, since a timeout looks the same from here.
 *
 * First match wins:
 * - status 0 or a TypeError (no answer): 'offline' when the browser says so, else 'unreachable'
 * - 401, PT401 (sync_caller), PGRST301/302/303 (the token): 'needsSignIn'
 * - 404, PGRST202/PGRST205 (no such function), 42883, 42501 (no grant): 'notSetUp', sync.sql isn't in
 * - 409, PT409: 'cloudReset', the account's synced copy was replaced
 * - 429, 5xx (520, 540 and 544 included): 'unavailable'
 * - 400, PT400, 22xxx (a value Postgres refused): 'rejected'
 * - anything else: 'failed'
 */
export function toSyncError(status: number, error: unknown): SyncError {
  const code = readString(error, 'code') ?? '';
  const message = readString(error, 'message');
  const make = (kind: SyncErrorKind) => new SyncError(kind, message, { cause: error });

  if (status === 0 || readString(error, 'name') === 'TypeError') {
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    return make(offline ? 'offline' : 'unreachable');
  }
  // Anonymous and refused (401 with 42501) is a sign-in problem, not a missing grant.
  if (status === 401 || SIGN_IN_CODES.has(code)) return make('needsSignIn');
  if (status === 404 || NOT_SET_UP_CODES.has(code)) return make('notSetUp');
  if (status === 409 || code === 'PT409') return make('cloudReset');
  if (status === 429 || status >= 500) return make('unavailable');
  if (status === 400 || code === 'PT400' || code.startsWith('22')) return make('rejected');
  return make('failed');
}
