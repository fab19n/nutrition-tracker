/**
 * Meal photos in the user's Google Drive (decision §10.18), the pure parts: the meal's pointer and
 * its checks, the Drive file name, the retry backoff, the square crop of the synced thumbnail,
 * and what a screen shows for a meal's photo on this device. No DOM, no database.
 */
import { fmtInt } from './format';
import type { Id, MealLog, MealPhotoDrive, MealSlot } from './types';

export const SYNC_THUMB_PREFIX = 'data:image/jpeg;base64,';
/** The read side tolerates up to this; the write side caps the thumbnail at 16,000 characters. */
export const SYNC_THUMB_LIMIT = 20_000;
/** Drive's multipart upload limit. A compressed photo is ~200–300 KB, so only an uncompressible original is over. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
/** Backoff after 1, 2, 3, 4 and 5+ failed tries. */
export const RETRY_STEPS_MS = [30_000, 120_000, 600_000, 1_800_000, 3_600_000] as const;

const FILE_ID = /^[A-Za-z0-9_-]{10,200}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export function isDriveFileId(v: unknown): v is string {
  return typeof v === 'string' && FILE_ID.test(v);
}

/** A JPEG data URL of a sensible size: what the uploading device writes, checked again on every read. */
export function isSyncThumb(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    v.length <= SYNC_THUMB_LIMIT &&
    v.startsWith(SYNC_THUMB_PREFIX) &&
    BASE64.test(v.slice(SYNC_THUMB_PREFIX.length))
  );
}

/** The meal's pointer if valid (an invalid thumb is dropped, an invalid fileId means no pointer). */
export function drivePointerOf(meal: Pick<MealLog, 'photoDrive'>): MealPhotoDrive | undefined {
  const raw: unknown = meal.photoDrive;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const { fileId, thumb } = raw as Record<string, unknown>;
  if (!isDriveFileId(fileId)) return undefined;
  return isSyncThumb(thumb) ? { fileId, thumb } : { fileId };
}

const SLOT_WORD: Record<MealSlot, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
  supper: 'Supper',
};

const NAME_MAX = 80;
// Control characters and what Windows and Drive's desktop sync refuse in a file name.
const NOT_IN_NAMES = /[\u0000-\u001f\u007f/\\:*?"<>|]/g;

function cleanName(name: string): string {
  const clean = name.replace(NOT_IN_NAMES, '').replace(/\s+/g, ' ').trim();
  if (!clean) return 'Meal';
  if (clean.length <= NAME_MAX) return clean;
  const cut = clean.slice(0, NAME_MAX);
  const space = cut.lastIndexOf(' ');
  // At a word boundary when one is near enough; otherwise the hard cut.
  return (space >= NAME_MAX / 2 ? cut.slice(0, space) : cut).trim();
}

function extensionFor(mimeType: string): string {
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/webp') return '.webp';
  return '.jpg';
}

/**
 * "2026-10-16 Dinner - Nasi kandar ayam goreng.jpg": the stored logical day, the slot word, the
 * name cleaned (control characters and / \ : * ? " < > | removed, whitespace collapsed, empty →
 * "Meal"), cut to 80 characters at a word boundary when it can. The extension follows the type.
 * Cosmetic: the app finds its files by appProperties, never by name.
 */
export function driveFileName(meal: Pick<MealLog, 'logicalDay' | 'slot' | 'name'>, mimeType: string): string {
  const slot = SLOT_WORD[meal.slot] ?? 'Meal';
  return `${meal.logicalDay} ${slot} - ${cleanName(meal.name)}${extensionFor(mimeType)}`;
}

/** Backoff after `attempts` failed tries (1-based): 30 s, 2 min, 10 min, 30 min, then every 60 min, × (0.8 + 0.4 × random()). */
export function retryDelayMs(attempts: number, random: () => number): number {
  const step = Math.min(Math.max(Math.floor(attempts), 1), RETRY_STEPS_MS.length) - 1;
  const base = RETRY_STEPS_MS[step] ?? 3_600_000;
  return Math.round(base * (0.8 + 0.4 * random()));
}

/** Source rectangle of a centre square crop: { sx, sy, size } with size = min(w, h). */
export function squareCrop(width: number, height: number): { sx: number; sy: number; size: number } {
  const size = Math.min(width, height);
  return { sx: Math.floor((width - size) / 2), sy: Math.floor((height - size) / 2), size };
}

/** '1 photo', '12 photos', '1,240 photos'. */
export function photosLabel(n: number): string {
  return `${fmtInt(n)} ${n === 1 ? 'photo' : 'photos'}`;
}

/** What this device can do with Drive: no client id, demo mode, not connected here, connected. */
export type DriveDeviceState = 'unconfigured' | 'demo' | 'disconnected' | 'connected';

export interface MealPhotoInput {
  photoId?: Id;
  pointer?: MealPhotoDrive;
  /** A photos row with this id exists here. */
  hasLocal: boolean;
  drive: DriveDeviceState;
  online: boolean;
  /** Connected, Keep photos on, this photo has an upload job (not set aside), and no valid token. */
  waitingForTap: boolean;
}

export type MealPhotoView =
  | { kind: 'none' }
  | { kind: 'local'; waitingForTap: boolean }
  | { kind: 'remote'; action: 'show' | 'connect' | 'offline' | 'none' }
  | { kind: 'elsewhere'; driveConfigured: boolean };

/**
 * none: no photoId · local: a photos row here (own or fetched) · remote: a pointer and no local copy
 * (connected + online → show; connected + offline → offline; disconnected → connect; unconfigured
 * or demo → none) · elsewhere: a photoId with neither (the photo hasn't reached Drive yet, or
 * Drive isn't used).
 */
export function mealPhotoView(input: MealPhotoInput): MealPhotoView {
  if (!input.photoId) return { kind: 'none' };
  if (input.hasLocal) return { kind: 'local', waitingForTap: input.waitingForTap };
  if (input.pointer) {
    switch (input.drive) {
      case 'connected':
        return { kind: 'remote', action: input.online ? 'show' : 'offline' };
      case 'disconnected':
        return { kind: 'remote', action: 'connect' };
      default:
        return { kind: 'remote', action: 'none' };
    }
  }
  return { kind: 'elsewhere', driveConfigured: input.drive === 'connected' || input.drive === 'disconnected' };
}
