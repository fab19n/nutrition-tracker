import { TriangleAlert } from 'lucide-react';
import styles from './BackupPreview.module.css';

export interface BackupPreviewRow {
  id: string;
  label: string;
  value: string;
}

export interface BackupPreviewNote {
  /** amber: something here will be lost · neutral: nothing will. */
  tone: 'amber' | 'neutral';
  text: string;
}

export interface BackupPreviewProps {
  fileName: string;
  /** "Exported 16 Oct 2026, 7:10pm" or "Export date unknown". */
  exportedLine: string;
  /** "34 days ago" */
  agoLine?: string;
  /** Meals, Weigh-ins, Places… The caller leaves out the ones that are empty. */
  rows: BackupPreviewRow[];
  /** "Meals from 3 Oct 2026 to 16 Oct 2026" */
  spanLine?: string;
  /** "Photos: not in this file. Photos on this phone stay." */
  photosLine: string;
  note?: BackupPreviewNote;
}

/**
 * What is inside a backup file, before it replaces anything (Backups › Restore from a backup
 * file). Presentational: the screen's model writes every line. The amber note says "lost" in words
 * and carries a warning icon; colour alone never says it.
 */
export function BackupPreview({ fileName, exportedLine, agoLine, rows, spanLine, photosLine, note }: BackupPreviewProps) {
  return (
    <div className={styles.card}>
      <p className={styles.fileName} title={fileName}>
        {fileName}
      </p>
      <p className={styles.exported}>{exportedLine}</p>
      {agoLine ? <p className={styles.ago}>{agoLine}</p> : null}

      {rows.length > 0 ? (
        <dl className={styles.rows}>
          {rows.map((row) => (
            <div key={row.id} className={styles.row}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {spanLine ? <p className={styles.line}>{spanLine}</p> : null}
      <p className={styles.line}>{photosLine}</p>

      {note ? (
        note.tone === 'amber' ? (
          <p className={[styles.note, styles.amber].join(' ')}>
            <TriangleAlert size={16} strokeWidth={2} className={styles.noteIcon} aria-hidden="true" />
            <span>{note.text}</span>
          </p>
        ) : (
          <p className={[styles.note, styles.neutral].join(' ')}>{note.text}</p>
        )
      ) : null}
    </div>
  );
}
