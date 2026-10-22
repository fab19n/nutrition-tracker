/**
 * Meal photos in the user's Google Drive (ARCHITECTURE.md §10.18): the public settings. The OAuth
 * client id comes from VITE_GOOGLE_CLIENT_ID (public by design: it only names the app to Google);
 * without it the app has no Drive card, loads no Google script and queues nothing.
 *
 * Env only: no database or network imports, since src/db/driveQueue.ts imports this file.
 */

/** Only the files this app creates: the photos folder and the photos in it. */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const DRIVE_FOLDER_NAME = 'Kira Makan photos';
export const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client';
export const DRIVE_API = 'https://www.googleapis.com';

const CLIENT_ID = /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/i;

/** The trimmed client id when it looks like one (`<digits>-<chars>.apps.googleusercontent.com`), else null. */
export function readGoogleClientId(): string | null {
  const value: unknown = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  if (typeof value !== 'string') return null;
  const id = value.trim();
  return CLIENT_ID.test(id) ? id : null;
}

export function isDriveConfigured(): boolean {
  return readGoogleClientId() !== null;
}
