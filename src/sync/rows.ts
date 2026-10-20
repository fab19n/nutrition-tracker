/**
 * How a local row travels (ARCHITECTURE.md §6.2). The account stores each row as JSON, without
 * the fields that belong to this device: a meal's `syncState`, and the profile's theme, location
 * permission and demo flag. A row coming back keeps this device's values for those.
 *
 * `wireHash` is what this device last sent or received for a row (kept in syncRevs), so a write
 * that changes nothing that syncs (a theme toggle, a `syncState` flip) never pushes, and so never
 * beats a real edit made on another device.
 */
import { SCHEMA_V1, SYNC_TABLES, type SyncTable } from '@/db/db';
import type { RowRev } from '@/db/syncTypes';
import type { ThemePreference } from '@/domain/types';

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
export type JsonObject = { [k: string]: Json };

/** This device's values for the profile fields that never sync. */
export interface DeviceDefaults {
  theme: ThemePreference;
}

export const DEVICE_PROFILE_FIELDS = ['theme', 'useLocation', 'demoMode'] as const;

const SYNC_TABLE_SET: ReadonlySet<string> = new Set<string>(SYNC_TABLES);

export function isSyncTable(name: string): name is SyncTable {
  return SYNC_TABLE_SET.has(name);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonObject(value: unknown): value is JsonObject {
  return isRecord(value);
}

/** The primary key property: id, logicalDay (days), weekStart (weekPlans) or ruleId (insightFeedback). */
export function primaryKeyField(table: SyncTable): string {
  return SCHEMA_V1[table].split(',')[0]?.trim() ?? 'id';
}

/**
 * Half a UTF-16 surrogate pair, on its own. With the u flag a whole pair reads as one code point,
 * so only a lone half matches. (String.prototype.toWellFormed needs Firefox 119; Vite's default
 * build target is Firefox 114.)
 */
const LONE_SURROGATE = /\p{Cs}/gu;

/**
 * Postgres can't store U+0000 in jsonb (22P05) or read a lone UTF-16 surrogate (22P02), and one
 * such character would make the server refuse the whole push, every time. Pasted text and a cut
 * through an emoji are the ways one gets in: a NUL is dropped, a lone surrogate becomes U+FFFD.
 */
function storable(_key: string, value: unknown): unknown {
  return typeof value === 'string' ? value.replaceAll('\u0000', '').replace(LONE_SURROGATE, '\uFFFD') : value;
}

/**
 * The row as the account stores it: plain JSON (undefined fields drop), device-only fields removed,
 * every string one Postgres takes. `wireHash` hashes this, so a row is compared as it was sent.
 */
export function toServerRow(table: SyncTable, row: unknown): JsonObject {
  const data: unknown = JSON.parse(JSON.stringify(row ?? null, storable));
  if (!isJsonObject(data)) throw new TypeError(`A ${table} row is not an object`);
  if (table === 'meals') delete data.syncState;
  if (table === 'profile') for (const field of DEVICE_PROFILE_FIELDS) delete data[field];
  return data;
}

/**
 * The local row for what the account holds under `key`, keeping this device's own fields from
 * `local` (the row here now, if any). Null when the data isn't a row of that table under that key:
 * the caller skips it.
 */
export function fromServerRow(table: SyncTable, key: string, data: unknown, local: unknown, defaults: DeviceDefaults): unknown | null {
  if (!isJsonObject(data) || data[primaryKeyField(table)] !== key) return null;
  const mine = isRecord(local) ? local : undefined;
  if (table === 'meals') return { ...data, syncState: mine?.syncState ?? 'synced' };
  if (table === 'profile') {
    // Sync never sets demo mode: the flag stays as it is here (false or absent on a device that syncs).
    const profile: Record<string, unknown> = { ...data, id: 'me', theme: mine?.theme ?? defaults.theme, useLocation: mine?.useLocation ?? false };
    delete profile.demoMode;
    if (mine?.demoMode !== undefined) profile.demoMode = mine.demoMode;
    return profile;
  }
  return { ...data };
}

/** JSON with object keys sorted and undefined fields dropped, so equal rows give equal text. */
export function canonicalJson(value: unknown): string {
  return canonical(value) ?? 'null';
}

function canonical(value: unknown): string | undefined {
  if (value === null) return 'null';
  if (typeof value === 'object' && typeof (value as { toJSON?: unknown }).toJSON === 'function') {
    return canonical((value as { toJSON: () => unknown }).toJSON());
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item) ?? 'null').join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const fields = Object.keys(record)
      .sort()
      .flatMap((k) => {
        const text = canonical(record[k]);
        return text === undefined ? [] : [`${JSON.stringify(k)}:${text}`];
      });
    return `{${fields.join(',')}}`;
  }
  // Strings, numbers (non-finite becomes null) and booleans as JSON writes them; undefined,
  // functions and symbols have no JSON form.
  return JSON.stringify(value);
}

/** cyrb53 (public domain): a fast 53-bit string hash. Not cryptographic; it only spots changes. */
function cyrb53(text: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export function hashJson(value: unknown): string {
  return cyrb53(canonicalJson(value)).toString(36);
}

/** The hash of what a push would send for this row: 'deleted' when the row is missing. */
export function wireHash(table: SyncTable, row: unknown | undefined): string {
  return row === undefined ? 'deleted' : hashJson(toServerRow(table, row));
}

/** Would a push send something? False for no-ops; collectPush and applyPage share this test. */
export function isRealChange(table: SyncTable, row: unknown | undefined, rev: RowRev | undefined): boolean {
  if (row === undefined) {
    // The profile is never deleted in the account, and a row that never synced has nothing to delete.
    if (table === 'profile' || rev === undefined) return false;
    return rev.hash !== 'deleted';
  }
  return rev?.hash !== wireHash(table, row);
}
