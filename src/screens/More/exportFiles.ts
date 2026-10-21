import type { KiraMakanDb } from '@/db/db';
import { backupFilename, exportAll } from '@/db/export';
import { writeLastExport, type LastExport } from '@/db/settings';
import { now } from '@/domain/clock';
import type { LogicalDay } from '@/domain/types';

/** Saves a file through a temporary object URL and an <a download>. */
export function downloadFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before the URL goes.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * The full backup (JSON, no photos) the Export screen and Backups › Export now both make: builds
 * the file, hands it to the browser as kira-makan-backup-<day>.json and records the export. Throws
 * when any step fails; the caller says so.
 */
export async function saveFullBackup(database: KiraMakanDb, day: LogicalDay): Promise<{ filename: string; record: LastExport }> {
  const filename = backupFilename(day);
  downloadFile(await exportAll(database), filename);
  const record: LastExport = { at: now().toISOString(), kind: 'json' };
  writeLastExport(record);
  return { filename, record };
}
