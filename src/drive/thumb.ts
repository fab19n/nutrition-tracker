/**
 * Images for Drive photo sync (decision §10.18), drawn on a canvas:
 *
 * - The synced thumbnail: a centre square of the local 240 px thumb as a small JPEG data URL, so a
 *   meal's row shows its photo on every device. It travels with the meal row through sync, so it
 *   must stay small: the first step that fits in 16,000 characters wins.
 * - The local thumbnail of a full photo fetched from Drive (the same 240 px long side the Log
 *   flow keeps, src/screens/Log/photo.ts).
 *
 * Where the browser can't decode or draw (old engines, tests), there is no synced thumbnail and a
 * fetched photo is its own thumbnail.
 */
import { squareCrop, SYNC_THUMB_PREFIX } from '@/domain/photoSync';

export const SYNC_THUMB_STEPS = [
  { side: 128, quality: 0.7 },
  { side: 112, quality: 0.6 },
  { side: 96, quality: 0.5 },
] as const;
export const SYNC_THUMB_MAX_CHARS = 16_000;
/** Same as THUMB_MAX_SIDE in src/screens/Log/photo.ts. */
export const LOCAL_THUMB_SIDE = 240;
const LOCAL_THUMB_QUALITY = 0.7;

function canDraw(): boolean {
  return typeof createImageBitmap === 'function' && typeof document !== 'undefined';
}

/** Centre-square crop to each step's side as a JPEG data URL; the first ≤ 16,000 characters wins. Undefined when none fits or the browser can't draw. */
export async function makeSyncThumb(source: Blob): Promise<string | undefined> {
  if (!canDraw()) return undefined;
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' });
    const { sx, sy, size } = squareCrop(bitmap.width, bitmap.height);
    if (size <= 0) return undefined;
    for (const step of SYNC_THUMB_STEPS) {
      const canvas = document.createElement('canvas');
      canvas.width = step.side;
      canvas.height = step.side;
      const context = canvas.getContext('2d');
      if (!context) return undefined;
      context.drawImage(bitmap, sx, sy, size, size, 0, 0, step.side, step.side);
      const url = canvas.toDataURL('image/jpeg', step.quality);
      // A browser without JPEG encoding answers PNG: that never syncs.
      if (url.startsWith(SYNC_THUMB_PREFIX) && url.length <= SYNC_THUMB_MAX_CHARS) return url;
    }
    return undefined;
  } catch {
    return undefined;
  } finally {
    bitmap?.close();
  }
}

/** A 240 px long-side JPEG for a photo fetched from Drive; the blob itself where the browser can't draw. */
export async function makeLocalThumb(source: Blob): Promise<Blob> {
  if (!canDraw()) return source;
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' });
    const scale = Math.min(1, LOCAL_THUMB_SIDE / Math.max(bitmap.width, bitmap.height, 1));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) return source;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const thumb = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', LOCAL_THUMB_QUALITY));
    return thumb ?? source;
  } catch {
    return source;
  } finally {
    bitmap?.close();
  }
}
