/**
 * Backup files for tests (never imported by the app): a real export of a database, edited
 * if a test needs a broken or older one, wrapped as the File the file picker hands over.
 *
 * userEvent.upload applies the input's `accept`, so every file here is named .json and typed
 * application/json.
 */
import type { KiraMakanDb } from '@/db/db';
import { exportAll } from '@/db/export';
import { DEMO_NOW_ISO } from '@/domain/clock';

/** A parsed backup, for `mutate` to edit before it is written. */
export interface EditableBackup {
  format: string;
  version: number;
  exportedAt: string;
  photos: string;
  tables: Record<string, Record<string, unknown>[]>;
  [key: string]: unknown;
}

export interface BackupFileOptions {
  /** Default 'kira-makan-backup-2026-10-16.json'. */
  name?: string;
  /** A real diary's backup: the demo database's profile says demoMode: false, as a phone's would. */
  real?: boolean;
  /** Includes the photos as data URLs. */
  photos?: boolean;
  /** When the file says it was made. Default: the demo Friday (Fri 16 Oct 2026, 7:10pm), whatever the clock says. */
  exportedAt?: string;
  /** Edits the parsed file before it is written. */
  mutate?: (backup: EditableBackup) => void;
}

export function jsonFile(body: string, name = 'backup.json'): File {
  return new File([body], name, { type: 'application/json' });
}

/** What Export now would save from `db`, as a File. */
export async function backupFileOf(db: KiraMakanDb, options: BackupFileOptions = {}): Promise<File> {
  const blob = await exportAll(db, { includePhotos: options.photos ?? false, exportedAt: options.exportedAt ?? DEMO_NOW_ISO });
  const backup = JSON.parse(await blob.text()) as EditableBackup;
  if (options.real) {
    const profile = backup.tables.profile?.[0];
    if (profile) profile.demoMode = false;
  }
  options.mutate?.(backup);
  return jsonFile(JSON.stringify(backup), options.name ?? 'kira-makan-backup-2026-10-16.json');
}
