import { SCHEMA_V1, TABLE_NAMES, type KiraMakanDb, type PhotoRecord, type TableName, type TableRows } from '@/db/db';
import { now } from '@/domain/clock';
import { DEFAULT_TZ, zonedParts } from '@/domain/day';
import { FINISHED_FACTOR, itemMacros, mealMacros, scaleMacros } from '@/domain/meal';
import type { Instant, MealItem } from '@/domain/types';

/**
 * Backups and spreadsheet export (plan §19): a complete JSON file that can be imported back,
 * and CSV files (meals, meal items, weights, workouts).
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

function dataUrlToBlob(url: string): Blob {
  const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(url);
  if (!match) throw new BackupImportError('badRow', 'A photo is not a data URL');
  const [, type = '', isBase64, payload = ''] = match;
  if (!isBase64) return new Blob([decodeURIComponent(payload)], { type });
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
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

export type BackupImportReason = 'notJson' | 'notABackup' | 'newerVersion' | 'badRow';

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The primary key property of a table ('id', 'logicalDay', 'weekStart', 'ruleId'). */
function primaryKeyOf(table: TableName): string {
  return SCHEMA_V1[table].split(',')[0]?.trim() ?? 'id';
}

function readRows(tables: Record<string, unknown>, table: TableName): Record<string, unknown>[] {
  const rows = tables[table] ?? [];
  if (!Array.isArray(rows)) throw new BackupImportError('badRow', `"${table}" is not a list`);
  const key = primaryKeyOf(table);
  return rows.map((row: unknown, index) => {
    if (!isRecord(row) || typeof row[key] !== 'string' || row[key] === '') {
      throw new BackupImportError('badRow', `${table} row ${index + 1} has no ${key}`);
    }
    return row;
  });
}

function readPhoto(row: Record<string, unknown>, index: number): PhotoRecord {
  const { id, createdAt, blob, thumb } = row;
  if (typeof id !== 'string' || typeof createdAt !== 'string' || typeof blob !== 'string' || typeof thumb !== 'string') {
    throw new BackupImportError('badRow', `photos row ${index + 1} is incomplete`);
  }
  return { id, createdAt, blob: dataUrlToBlob(blob), thumb: dataUrlToBlob(thumb) };
}

/**
 * Replaces everything with the backup's contents, in one transaction. When the backup left
 * photos out, the photos already on this device are kept. Rows the file lacks are deleted by key
 * rather than cleared, so with sync on the account follows the file too (clear() never syncs).
 */
export async function importAll(db: KiraMakanDb, file: Blob): Promise<ImportSummary> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new BackupImportError('notJson', 'The file is not JSON');
  }
  if (!isRecord(parsed) || parsed.format !== BACKUP_FORMAT || !isRecord(parsed.tables)) {
    throw new BackupImportError('notABackup', 'The file is not a Kira Makan backup');
  }
  if (typeof parsed.version !== 'number' || parsed.version > BACKUP_VERSION) {
    throw new BackupImportError('newerVersion', 'The backup comes from a newer version of the app');
  }

  const tables = parsed.tables;
  const photosIncluded = parsed.photos === 'included';
  const rows = new Map<TableName, Record<string, unknown>[]>();
  for (const table of TABLE_NAMES) {
    if (table === 'photos' && !photosIncluded) continue;
    rows.set(table, readRows(tables, table));
  }
  const photos = (rows.get('photos') ?? []).map(readPhoto);

  const counts = Object.fromEntries(TABLE_NAMES.map((t) => [t, 0])) as Record<TableName, number>;
  await db.transaction('rw', db.tables, async () => {
    for (const [table, list] of rows) {
      const target = db.table(table);
      if (table === 'photos') {
        // Photos don't sync yet: they are simply replaced.
        await target.clear();
        await db.photos.bulkPut(photos);
      } else {
        const key = primaryKeyOf(table);
        const inFile = new Set(list.map((row) => row[key]));
        const gone = (await target.toCollection().primaryKeys()).filter((k) => !inFile.has(k));
        if (gone.length > 0) await target.bulkDelete(gone);
        // Rows were checked for their key; their shape is trusted as this app's own export.
        await target.bulkPut(list);
      }
      counts[table] = list.length;
    }
  });

  return {
    exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : '',
    photos: photosIncluded ? 'included' : 'omitted',
    counts,
  };
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
