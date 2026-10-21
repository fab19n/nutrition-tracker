import { SCHEMA_V1, TABLE_NAMES, type KiraMakanDb, type PhotoRecord, type TableName, type TableRows } from '@/db/db';
import { now } from '@/domain/clock';
import { DEFAULT_TZ, zonedParts } from '@/domain/day';
import { FINISHED_FACTOR, itemMacros, mealMacros, scaleMacros } from '@/domain/meal';
import type { Instant, LogicalDay, MealItem, ThemePreference } from '@/domain/types';

/**
 * Backups and spreadsheet export (plan §19): a complete JSON file that can be imported back,
 * and CSV files (meals, meal items, weights, workouts).
 *
 * Reading a file and writing it are two steps, so a screen can show what is in it first:
 * - `readBackup(file)` checks the file and writes nothing. It throws a BackupImportError whose
 *   reason says why: notJson, notABackup (also a version that is not a number), newerVersion,
 *   badRow (a row of the wrong shape, or a profile whose time zone or rollover hour would break
 *   every date), unreadable (the file can't be read, e.g. cloud-only on Android) or tooBig.
 *   A table the file doesn't list is left alone on restore; a listed empty one empties the table.
 * - `assertRestorable` refuses a file with no diary in it (incomplete) or a sample week
 *   (sampleData). `previewOf` and `compareWithDevice` describe the file against this device.
 * - `restoreBackup` is what the app calls: a full replace in one transaction that keeps this
 *   device's own profile fields (theme, location permission), never turns demo mode on, and prunes
 *   photos no meal points to when the file left photos out. Rows the file lacks are deleted by key
 *   (never clear()), so with sync on the account follows the file.
 * - `importAll` is the raw replace (the file's profile as it is, photos wholesale, no checks
 *   beyond readBackup's) for tools and tests.
 */

export const BACKUP_FORMAT = 'kira-makan-backup';
export const BACKUP_VERSION = 1;

/** A photo in a backup: both images as data URLs. */
export interface BackupPhoto {
  id: string;
  createdAt: Instant;
  blob: string;
  thumb: string;
}

export type BackupTables = { [K in Exclude<TableName, 'photos'>]: TableRows[K][] } & { photos: BackupPhoto[] };

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  exportedAt: Instant;
  /** 'omitted' keeps the file small; photos then stay as they are on import. */
  photos: 'included' | 'omitted';
  tables: BackupTables;
}

export interface ExportOptions {
  includePhotos?: boolean;
  /** Defaults to the app clock (pinned to the demo Friday in demo mode). */
  exportedAt?: Instant;
}

export function backupFilename(day: string): string {
  return `kira-makan-backup-${day}.json`;
}

// ---------------------------------------------------------------------------
// Data URLs (Blob <-> string), without FileReader so it also runs outside the browser
// ---------------------------------------------------------------------------

async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`;
}

/** The image behind a data URL, or null when it isn't one (or its payload doesn't decode). */
function dataUrlToBlob(url: string): Blob | null {
  const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(url);
  if (!match) return null;
  const [, type = '', isBase64, payload = ''] = match;
  try {
    if (!isBase64) return new Blob([decodeURIComponent(payload)], { type });
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// JSON backup
// ---------------------------------------------------------------------------

/** Reads every table in one transaction, so the file is a consistent snapshot. */
export async function exportAll(db: KiraMakanDb, options: ExportOptions = {}): Promise<Blob> {
  const includePhotos = options.includePhotos ?? false;
  const snapshot = await db.transaction('r', db.tables, async () => ({
    profile: await db.profile.toArray(),
    goals: await db.goals.toArray(),
    goalVersions: await db.goalVersions.toArray(),
    goalPeriods: await db.goalPeriods.toArray(),
    meals: await db.meals.toArray(),
    weights: await db.weights.toArray(),
    workouts: await db.workouts.toArray(),
    bonuses: await db.bonuses.toArray(),
    days: await db.days.toArray(),
    weekPlans: await db.weekPlans.toArray(),
    places: await db.places.toArray(),
    usuals: await db.usuals.toArray(),
    pots: await db.pots.toArray(),
    insightFeedback: await db.insightFeedback.toArray(),
    suggestionEvents: await db.suggestionEvents.toArray(),
    personalItems: await db.personalItems.toArray(),
    photoRows: includePhotos ? await db.photos.toArray() : [],
  }));

  // Converting blobs is async work outside Dexie, so it happens after the transaction.
  const { photoRows, ...rest } = snapshot;
  const photos = await Promise.all(
    photoRows.map(async (p: PhotoRecord): Promise<BackupPhoto> => ({
      id: p.id,
      createdAt: p.createdAt,
      blob: await blobToDataUrl(p.blob),
      thumb: await blobToDataUrl(p.thumb),
    })),
  );

  const backup: BackupFile = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: options.exportedAt ?? now().toISOString(),
    photos: includePhotos ? 'included' : 'omitted',
    tables: { ...rest, photos },
  };
  return new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
}

export type BackupImportReason =
  | 'notJson'
  | 'notABackup'
  | 'newerVersion'
  | 'badRow'
  | 'unreadable'
  | 'tooBig'
  | 'incomplete'
  | 'sampleData';

/** Thrown when a file can't be restored. Nothing is changed when this is thrown. */
export class BackupImportError extends Error {
  readonly reason: BackupImportReason;

  constructor(reason: BackupImportReason, message: string) {
    super(message);
    this.name = 'BackupImportError';
    this.reason = reason;
  }
}

export interface ImportSummary {
  exportedAt: Instant;
  photos: 'included' | 'omitted';
  counts: Record<TableName, number>;
}

/** Reading a file this big on a phone can end the tab, so it is refused before it is read. */
export const MAX_BACKUP_BYTES = 128 * 1024 * 1024;

/** A validated file, ready to write. Screens go through previewOf and compareWithDevice. */
export interface ParsedBackup {
  /** '' when the file has none. */
  exportedAt: Instant | '';
  photosIncluded: boolean;
  /** Only the tables the file lists; never 'photos'. */
  rows: Map<TableName, Record<string, unknown>[]>;
  /** Decoded; empty unless photosIncluded. */
  photos: PhotoRecord[];
}

export interface RestoreOptions {
  /** This device's values for the profile fields that never travel; db/ doesn't import app/, so the caller reads the theme. */
  deviceDefaults: { theme: ThemePreference };
}

export interface BackupPreview {
  /** Null when the file has none or it isn't a date. */
  exportedAt: Instant | null;
  photos: 'included' | 'omitted';
  /** Tables the file doesn't list count 0. */
  counts: Record<TableName, number>;
  /** The first and last logical day of the meals. */
  mealDays?: { from: LogicalDay; to: LogicalDay };
  /** The file's profile time zone; DEFAULT_TZ when unusable. */
  timeZone: string;
}

export interface DeviceComparison {
  /** Rows on this device now. */
  meals: number;
  weights: number;
  /** Rows on this device that a restore would remove: their ids aren't in the file. */
  onlyHere: { meals: number; weights: number };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The primary key property of a table ('id', 'logicalDay', 'weekStart', 'ruleId'). */
function primaryKeyOf(table: TableName): string {
  return SCHEMA_V1[table].split(',')[0]?.trim() ?? 'id';
}

function isValidTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== 'string' || timeZone === '') return false;
  try {
    // A bad zone throws a RangeError in every Intl.DateTimeFormat call, so it must not get in.
    new Intl.DateTimeFormat('en', { timeZone });
    return true;
  } catch {
    return false;
  }
}

type FieldType = 'string' | 'number' | 'object' | 'array';

/**
 * The fields screens dereference without a default, by table (types only, no ranges). A table
 * that isn't here (weekPlans) is checked for its key alone.
 */
const ROW_SHAPES: Partial<Record<TableName, Record<string, FieldType>>> = {
  profile: {
    age: 'number',
    sex: 'string',
    heightCm: 'number',
    weightKgAtSetup: 'number',
    activity: 'string',
    timeZone: 'string',
    rolloverHour: 'number',
    dailyMinimumKcal: 'number',
    startedOn: 'string',
  },
  goals: { name: 'string', template: 'string', status: 'string', paceKgPerWeek: 'number', timing: 'object', createdAt: 'string' },
  goalVersions: { goalId: 'string', effectiveFrom: 'string', dailyKcal: 'number' },
  goalPeriods: { goalId: 'string', from: 'string' },
  meals: { eatenAt: 'string', logicalDay: 'string', slot: 'string', name: 'string', items: 'array', finished: 'string' },
  weights: { measuredAt: 'string', logicalDay: 'string', kg: 'number' },
  workouts: { logicalDay: 'string', netKcal: 'number' },
  bonuses: { logicalDay: 'string', kcal: 'number' },
  days: { status: 'string' },
  places: { name: 'string', type: 'string' },
  usuals: { name: 'string', items: 'array' },
  pots: { name: 'string', servingsLeft: 'number', expiresOn: 'string' },
  insightFeedback: { feedback: 'string' },
  suggestionEvents: { at: 'string' },
  personalItems: { name: 'string' },
};

function hasType(value: unknown, type: FieldType): boolean {
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return isRecord(value);
  return typeof value === type;
}

/** "meals row 12 has a bad items": names the table, the row (1-based) and the field. */
function badField(table: TableName, index: number, field: string): BackupImportError {
  return new BackupImportError('badRow', `${table} row ${index + 1} has a bad ${field}`);
}

function checkShape(table: TableName, row: Record<string, unknown>, index: number): void {
  for (const [field, type] of Object.entries(ROW_SHAPES[table] ?? {})) {
    if (!hasType(row[field], type)) throw badField(table, index, field);
  }
  if (table === 'profile') {
    if (row.id !== 'me') throw badField(table, index, 'id');
    if (!isValidTimeZone(row.timeZone)) throw badField(table, index, 'timeZone');
    const hour = row.rolloverHour;
    if (typeof hour !== 'number' || !Number.isInteger(hour) || hour < 0 || hour > 23) throw badField(table, index, 'rolloverHour');
  }
}

function readRows(tables: Record<string, unknown>, table: TableName): Record<string, unknown>[] | undefined {
  const rows = tables[table];
  // A table the file doesn't list is left alone on restore (a hand-edited or older partial file).
  if (rows === undefined) return undefined;
  if (!Array.isArray(rows)) throw new BackupImportError('badRow', `"${table}" is not a list`);
  const key = primaryKeyOf(table);
  return rows.map((row: unknown, index) => {
    if (!isRecord(row) || typeof row[key] !== 'string' || row[key] === '') {
      throw new BackupImportError('badRow', `${table} row ${index + 1} has no ${key}`);
    }
    // The profile's own key is checked with its shape, so the message names the field.
    checkShape(table, row, index);
    return row;
  });
}

function readPhoto(row: unknown, index: number): PhotoRecord {
  if (!isRecord(row)) throw new BackupImportError('badRow', `photos row ${index + 1} is incomplete`);
  const { id, createdAt, blob, thumb } = row;
  if (typeof id !== 'string' || id === '') throw new BackupImportError('badRow', `photos row ${index + 1} has no id`);
  if (typeof createdAt !== 'string') throw badField('photos', index, 'createdAt');
  if (typeof blob !== 'string') throw badField('photos', index, 'blob');
  if (typeof thumb !== 'string') throw badField('photos', index, 'thumb');
  const image = dataUrlToBlob(blob);
  if (!image) throw badField('photos', index, 'blob');
  const small = dataUrlToBlob(thumb);
  if (!small) throw badField('photos', index, 'thumb');
  return { id, createdAt, blob: image, thumb: small };
}

/**
 * Reads and checks a backup file without touching the database. Checks run in this order and the
 * first failure throws a BackupImportError: size, readable, JSON, our format, version, then every
 * row of every table the file lists.
 */
export async function readBackup(file: Blob): Promise<ParsedBackup> {
  if (file.size > MAX_BACKUP_BYTES) throw new BackupImportError('tooBig', 'The file is too big to open here');

  let text: string;
  try {
    text = await file.text();
  } catch {
    throw new BackupImportError('unreadable', 'The file could not be read');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BackupImportError('notJson', 'The file is not JSON');
  }
  if (!isRecord(parsed) || parsed.format !== BACKUP_FORMAT || !isRecord(parsed.tables)) {
    throw new BackupImportError('notABackup', 'The file is not a Kira Makan backup');
  }
  const { version, tables } = parsed;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new BackupImportError('notABackup', 'The file has no backup version');
  }
  if (version > BACKUP_VERSION) {
    throw new BackupImportError('newerVersion', 'The backup comes from a newer version of the app');
  }

  const rows = new Map<TableName, Record<string, unknown>[]>();
  for (const table of TABLE_NAMES) {
    if (table === 'photos') continue;
    const list = readRows(tables, table);
    if (list) rows.set(table, list);
  }

  const photosIncluded = parsed.photos === 'included' && 'photos' in tables;
  let photos: PhotoRecord[] = [];
  if (photosIncluded) {
    if (!Array.isArray(tables.photos)) throw new BackupImportError('badRow', '"photos" is not a list');
    photos = tables.photos.map(readPhoto);
  }

  return { exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : '', photosIncluded, rows, photos };
}

/**
 * Refuses a file that can't become a diary: no profile or goal in it (incomplete, which would also
 * delete this device's profile), or a sample week (sampleData: never a real diary, and the account
 * refuses a demo profile anyway).
 */
export function assertRestorable(backup: ParsedBackup): void {
  const count = (table: TableName): number => backup.rows.get(table)?.length ?? 0;
  if (count('profile') !== 1 || count('goals') < 1 || count('goalVersions') < 1 || count('goalPeriods') < 1) {
    throw new BackupImportError('incomplete', 'The backup has no profile or goal');
  }
  if (backup.rows.get('profile')?.[0]?.demoMode === true) {
    throw new BackupImportError('sampleData', 'The backup is the sample week');
  }
}

const DAY_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

/** What is in the file, for the preview. */
export function previewOf(backup: ParsedBackup): BackupPreview {
  const counts = Object.fromEntries(TABLE_NAMES.map((table) => [table, backup.rows.get(table)?.length ?? 0])) as Record<TableName, number>;
  counts.photos = backup.photos.length;

  const days = (backup.rows.get('meals') ?? []).flatMap((meal) =>
    typeof meal.logicalDay === 'string' && DAY_FORMAT.test(meal.logicalDay) ? [meal.logicalDay] : [],
  );
  const preview: BackupPreview = {
    exportedAt: backup.exportedAt !== '' && Number.isFinite(Date.parse(backup.exportedAt)) ? backup.exportedAt : null,
    photos: backup.photosIncluded ? 'included' : 'omitted',
    counts,
    timeZone: DEFAULT_TZ,
  };
  if (days.length > 0) preview.mealDays = { from: days.reduce((a, b) => (b < a ? b : a)), to: days.reduce((a, b) => (b > a ? b : a)) };
  const zone = backup.rows.get('profile')?.[0]?.timeZone;
  if (isValidTimeZone(zone)) preview.timeZone = zone;
  return preview;
}

/**
 * Meals and weigh-ins on this device that the file lacks (by id), which a restore would remove.
 * A table the file doesn't list is left alone, so it loses nothing.
 */
export async function compareWithDevice(db: KiraMakanDb, backup: ParsedBackup): Promise<DeviceComparison> {
  const { meals, weights } = await db.transaction('r', [db.meals, db.weights], async () => ({
    meals: await db.meals.toCollection().primaryKeys(),
    weights: await db.weights.toCollection().primaryKeys(),
  }));
  const lost = (table: 'meals' | 'weights', keys: readonly string[]): number => {
    const listed = backup.rows.get(table);
    if (!listed) return 0;
    const inFile = new Set(listed.map((row) => row.id));
    return keys.filter((key) => !inFile.has(key)).length;
  };
  return {
    meals: meals.length,
    weights: weights.length,
    onlyHere: { meals: lost('meals', meals), weights: lost('weights', weights) },
  };
}

/**
 * The one writer behind importAll and restoreBackup, in one transaction. For every table the file
 * lists, the rows it lacks are deleted by key (never clear(): a clear isn't synced) and its rows are
 * written. With `device` (a restore) the profile keeps this device's own fields, and photos the
 * file left out stay, minus the ones no meal points to. Photos in the file replace the photos here
 * (they are local only, so none of it is captured).
 */
async function writeBackup(db: KiraMakanDb, backup: ParsedBackup, device?: RestoreOptions): Promise<ImportSummary> {
  const counts = Object.fromEntries(TABLE_NAMES.map((t) => [t, 0])) as Record<TableName, number>;
  await db.transaction('rw', db.tables, async () => {
    // The sample week's profile isn't this device's own: its theme and location setting were never chosen.
    const stored = device ? await db.profile.get('me') : undefined;
    const current = stored && stored.demoMode !== true ? stored : undefined;
    for (const [table, listed] of backup.rows) {
      let list = listed;
      if (device && table === 'profile') {
        list = listed.map((profile) => ({
          ...profile,
          id: 'me',
          theme: current?.theme ?? device.deviceDefaults.theme,
          useLocation: current?.useLocation ?? false,
          demoMode: false,
        }));
      }
      const target = db.table(table);
      const key = primaryKeyOf(table);
      const inFile = new Set(list.map((row) => row[key]));
      const gone = (await target.toCollection().primaryKeys()).filter((k) => !inFile.has(k));
      if (gone.length > 0) await target.bulkDelete(gone);
      await target.bulkPut(list);
      counts[table] = list.length;
    }

    if (backup.photosIncluded) {
      await db.photos.clear();
      await db.photos.bulkPut(backup.photos);
      counts.photos = backup.photos.length;
    } else if (device) {
      // A restore can leave photos no meal points to; photos aren't synced, so nothing else cleans them.
      const referenced = new Set<string>();
      await db.meals.each((meal) => {
        if (meal.photoId) referenced.add(meal.photoId);
      });
      const orphans = (await db.photos.toCollection().primaryKeys()).filter((id) => !referenced.has(id));
      if (orphans.length > 0) await db.photos.bulkDelete(orphans);
    }
  });
  return { exportedAt: backup.exportedAt, photos: backup.photosIncluded ? 'included' : 'omitted', counts };
}

/**
 * Replaces everything with the backup's contents, in one transaction, as the file has it: the
 * file's profile (theme, location and demo flag included) and photos wholesale when it has them.
 * The app calls restoreBackup instead. Rows the file lacks are deleted by key rather than cleared,
 * so with sync on the account follows the file too (clear() never syncs).
 */
export async function importAll(db: KiraMakanDb, file: Blob): Promise<ImportSummary> {
  return writeBackup(db, await readBackup(file));
}

/**
 * Restores a checked file to this device: the file becomes the diary, in one transaction, and the
 * writes are captured so an account follows. This device keeps its own theme and location
 * permission, and demo mode is always off afterwards. A file with no diary or the sample week is refused.
 */
export async function restoreBackup(db: KiraMakanDb, backup: ParsedBackup, options: RestoreOptions): Promise<ImportSummary> {
  assertRestorable(backup);
  return writeBackup(db, backup, options);
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

export interface CsvFile {
  filename: string;
  blob: Blob;
}

type Cell = string | number | boolean | undefined;

/** RFC 4180 quoting, plus a leading quote on text that a spreadsheet would run as a formula. */
function csvCell(value: Cell): string {
  if (value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(header: string[], rows: Cell[][]): Blob {
  const lines = [header, ...rows].map((row) => row.map(csvCell).join(','));
  // The BOM makes Excel read the file as UTF-8 (the minus sign, accented names).
  return new Blob([`﻿${lines.join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' });
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Wall-clock time in the user's zone for spreadsheets: '2026-10-16 19:10'. */
function localTimeFormatter(timeZone: string): (at: Instant) => string {
  return (at) => {
    const p = zonedParts(at, timeZone);
    return `${p.year}-${pad2(p.month)}-${pad2(p.day)} ${pad2(p.hour)}:${pad2(p.minute)}`;
  };
}

function portionLabel(item: MealItem): string | undefined {
  return item.selectedVariant === undefined ? undefined : item.variants?.[item.selectedVariant]?.label;
}

/** Spreadsheet files for meals, meal items, weights and workouts, oldest first. */
export async function exportCsv(db: KiraMakanDb): Promise<CsvFile[]> {
  const { profile, meals, places, weights, workouts } = await db.transaction(
    'r',
    [db.profile, db.meals, db.places, db.weights, db.workouts],
    async () => ({
      profile: await db.profile.get('me'),
      meals: await db.meals.orderBy('eatenAt').toArray(),
      places: await db.places.toArray(),
      weights: await db.weights.orderBy('measuredAt').toArray(),
      workouts: await db.workouts.orderBy('logicalDay').toArray(),
    }),
  );
  const local = localTimeFormatter(profile?.timeZone ?? DEFAULT_TZ);
  const placeName = new Map(places.map((p) => [p.id, p.name]));

  const mealsCsv = toCsv(
    ['id', 'logical_day', 'eaten_at_utc', 'eaten_at_local', 'slot', 'name', 'place', 'method', 'finished', 'kcal', 'protein_g', 'carbs_g', 'fat_g', 'price_rm', 'is_guess', 'text'],
    meals.map((meal) => {
      const t = mealMacros(meal);
      return [
        meal.id,
        meal.logicalDay,
        meal.eatenAt,
        local(meal.eatenAt),
        meal.slot,
        meal.name,
        meal.placeId ? (placeName.get(meal.placeId) ?? '') : '',
        meal.method,
        meal.finished,
        Math.round(t.kcal),
        round1(t.proteinG),
        round1(t.carbsG),
        round1(t.fatG),
        meal.priceRm,
        meal.isGuess ?? false,
        meal.text,
      ];
    }),
  );

  const itemsCsv = toCsv(
    ['meal_id', 'logical_day', 'item_id', 'name', 'catalogue_id', 'portion', 'quantity', 'kcal', 'protein_g', 'carbs_g', 'fat_g', 'uncertainty', 'source', 'edited', 'original_kcal'],
    meals.flatMap((meal) =>
      meal.items.map((item) => {
        // As eaten: a meal finished "half" counts half of each item, so the rows add up to the meal's row.
        const t = scaleMacros(itemMacros(item), FINISHED_FACTOR[meal.finished]);
        const original = item.original ? Math.round(item.original.unitMacros.kcal * item.original.quantity) : undefined;
        return [
          meal.id,
          meal.logicalDay,
          item.id,
          item.name,
          item.catalogueId,
          portionLabel(item),
          item.quantity,
          Math.round(t.kcal),
          round1(t.proteinG),
          round1(t.carbsG),
          round1(t.fatG),
          item.uncertainty,
          item.source,
          item.edited ?? false,
          original,
        ];
      }),
    ),
  );

  const weightsCsv = toCsv(
    ['logical_day', 'measured_at_utc', 'measured_at_local', 'kg'],
    weights.map((w) => [w.logicalDay, w.measuredAt, local(w.measuredAt), w.kg]),
  );

  const workoutsCsv = toCsv(
    ['logical_day', 'type', 'minutes', 'intensity', 'net_kcal'],
    workouts.map((w) => [w.logicalDay, w.type, w.minutes, w.intensity, w.netKcal]),
  );

  return [
    { filename: 'kira-makan-meals.csv', blob: mealsCsv },
    { filename: 'kira-makan-meal-items.csv', blob: itemsCsv },
    { filename: 'kira-makan-weights.csv', blob: weightsCsv },
    { filename: 'kira-makan-workouts.csv', blob: workoutsCsv },
  ];
}
