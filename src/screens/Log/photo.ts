/**
 * Meal photos are shrunk on the phone before they're kept (plan §9.6): the long side to about
 * 1,280 px as JPEG (~200–300 KB), plus a small thumbnail for the 52 px MealRow tile.
 * Where the browser can't decode or draw (old engines, tests), the original file is kept.
 */

export const PHOTO_MAX_SIDE = 1280;
export const THUMB_MAX_SIDE = 240;
const PHOTO_QUALITY = 0.8;
const THUMB_QUALITY = 0.7;

export interface CompressedPhoto {
  blob: Blob;
  thumb: Blob;
}

function toJpeg(source: ImageBitmap, maxSide: number, quality: number): Promise<Blob | null> {
  const scale = Math.min(1, maxSide / Math.max(source.width, source.height, 1));
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return Promise.resolve(null);
  context.drawImage(source, 0, 0, width, height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

export async function compressPhoto(file: Blob): Promise<CompressedPhoto> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return { blob: file, thumb: file };
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    try {
      const blob = (await toJpeg(bitmap, PHOTO_MAX_SIDE, PHOTO_QUALITY)) ?? file;
      const thumb = (await toJpeg(bitmap, THUMB_MAX_SIDE, THUMB_QUALITY)) ?? blob;
      return { blob, thumb };
    } finally {
      bitmap.close();
    }
  } catch {
    return { blob: file, thumb: file };
  }
}
