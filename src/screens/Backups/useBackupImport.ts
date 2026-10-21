import { useCallback, useEffect, useRef, useState } from 'react';
import { readStoredTheme } from '@/app/theme';
import { syncDemoClock } from '@/db/actions';
import { db } from '@/db/db';
import {
  assertRestorable,
  compareWithDevice,
  previewOf,
  readBackup,
  restoreBackup,
  type BackupPreview,
  type DeviceComparison,
  type ImportSummary,
  type ParsedBackup,
} from '@/db/export';
import { clearLastExport, noteRestoredBackup } from '@/db/settings';
import type { LogicalDay } from '@/domain/types';
import { saveFullBackup } from '@/screens/More/exportFiles';
import { resetUiState, useUiStore } from '@/state/ui';
import { getEngineState, syncNow } from '@/sync';
import { CatchUpFailed, mealsLabel, problemCopy, type DeviceWord, type ProblemCopy, type RestoreReach } from './backupsModel';

export interface BackupImportContext {
  reach: RestoreReach;
  word: DeviceWord;
  /** Export-first needs the logical day for the file name; absent on Welcome. */
  today?: LogicalDay;
  /** Called after this flow records a backup date (Export first, a finished restore), so the screen can look again. */
  onBackupChanged?: () => void;
}

export type ImportStage =
  | { stage: 'idle' }
  | { stage: 'reading'; fileName: string }
  | { stage: 'error'; fileName: string; problem: ProblemCopy }
  | {
      stage: 'preview';
      fileName: string;
      preview: BackupPreview;
      /** What this device holds that the file lacks; null where nothing here is lost (Welcome, the sample week). */
      comparison: DeviceComparison | null;
      /** The file Export first saved, once it has. */
      savedAs: string | null;
      exporting: boolean;
      /** The destructive confirm is open over the preview. */
      confirming: boolean;
    }
  | { stage: 'restoring'; fileName: string; step: 'catchUp' | 'writing' }
  /** `reach` and `word` as they were when the restore started: leaving demo changes them under it. */
  | { stage: 'done'; summary: ImportSummary; reach: RestoreReach; word: DeviceWord }
  | { stage: 'failed'; problem: ProblemCopy };

export interface BackupImportFlow {
  stage: ImportStage;
  /** The sheet is showing: every stage but idle. */
  open: boolean;
  /** False only while restoring: the sheet then ignores the scrim, Escape and Back. */
  dismissible: boolean;
  reach: RestoreReach;
  word: DeviceWord;
  /** The preview offers Export first (a diary that something here would be lost from, and a day to name the file). */
  canExportFirst: boolean;
  choose(file: File): void;
  /** Back to idle (the sheet's close, Cancel, Done). Ignored while restoring. */
  close(): void;
  /** The preview's Restore this backup: the confirm for a diary, the write at once for none and sample. Also Try again after a failure. */
  restore(): void;
  cancelConfirm(): void;
  /** The confirm dialog's Replace everything. */
  confirm(): void;
  exportFirst(): void;
}

/**
 * The flow behind Restore from a backup file (Backups, and Welcome on a fresh install): pick a file,
 * check it without writing, preview it, confirm when a diary is replaced, restore, say how it went.
 * One stage at a time (ImportStage), one restore at a time. The parsed file stays in memory, so Try
 * again after a failure needs no second read. The write is restoreBackup, one transaction: it
 * either all happens or nothing changes.
 *
 * Reach decides the safeguards. On an account (a linked, syncing diary) a restore replaces the
 * account's copy and every other device's, so the account catches up first (otherwise a row
 * another device added, not yet here, would come back after the restore) and the restore stops if
 * it can't. After the write, drafts are cleared (they may point at deleted rows), the demo clock is
 * unpinned (a restore over the sample week leaves demo) and sync is asked to run: it never rejects,
 * and its gate decides what happens (push, first link, or nothing).
 */
export function useBackupImport(context: BackupImportContext): BackupImportFlow {
  const showToast = useUiStore((s) => s.showToast);
  const [stage, setStage] = useState<ImportStage>({ stage: 'idle' });
  const stageRef = useRef<ImportStage>(stage);
  const contextRef = useRef(context);
  const parsed = useRef<ParsedBackup | null>(null);
  const fileName = useRef('');
  /** Counts picks and closes; an answer for an older count is dropped. */
  const token = useRef(0);
  const running = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    contextRef.current = context;
  });

  // The sheet can unmount mid-restore (Welcome's redirect once the profile lands): nothing sets state then.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const go = useCallback((next: ImportStage) => {
    stageRef.current = next;
    if (mounted.current) setStage(next);
  }, []);

  const patchPreview = useCallback(
    (patch: Partial<Extract<ImportStage, { stage: 'preview' }>>) => {
      const current = stageRef.current;
      if (current.stage === 'preview') go({ ...current, ...patch });
    },
    [go],
  );

  const choose = useCallback(
    (file: File) => {
      const now = stageRef.current.stage;
      if (now === 'reading' || now === 'restoring') return;
      token.current += 1;
      const mine = token.current;
      parsed.current = null;
      fileName.current = file.name;
      go({ stage: 'reading', fileName: file.name });
      void (async () => {
        try {
          const backup = await readBackup(file);
          assertRestorable(backup);
          const { reach } = contextRef.current;
          const comparison = reach === 'device' || reach === 'account' ? await compareWithDevice(db, backup) : null;
          if (token.current !== mine) return;
          parsed.current = backup;
          go({ stage: 'preview', fileName: file.name, preview: previewOf(backup), comparison, savedAs: null, exporting: false, confirming: false });
        } catch (error) {
          if (token.current !== mine) return;
          go({ stage: 'error', fileName: file.name, problem: problemCopy(error, { word: contextRef.current.word }) });
        }
      })();
    },
    [go],
  );

  const close = useCallback(() => {
    if (stageRef.current.stage === 'restoring') return;
    token.current += 1;
    parsed.current = null;
    go({ stage: 'idle' });
  }, [go]);

  const write = useCallback(
    async (backup: ParsedBackup): Promise<void> => {
      const { reach, word, onBackupChanged } = contextRef.current;
      const name = fileName.current;
      let summary: ImportSummary;
      try {
        // The sample week's export record carries a demo timestamp: it goes before the diary replaces it.
        if (reach === 'sample') clearLastExport();
        go({ stage: 'restoring', fileName: name, step: reach === 'account' ? 'catchUp' : 'writing' });
        if (reach === 'account') {
          // restoreBackup deletes the rows this device holds that the file lacks, so a row another
          // device added that hasn't arrived here would come back. Catch up first, or stop.
          await syncNow();
          const { phase } = getEngineState();
          if (phase !== 'idle') throw new CatchUpFailed(phase);
          go({ stage: 'restoring', fileName: name, step: 'writing' });
        }
        summary = await restoreBackup(db, backup, { deviceDefaults: { theme: readStoredTheme() } });
      } catch (error) {
        go({ stage: 'failed', problem: problemCopy(error, { word }) });
        return;
      }

      // The data is in. What follows is housekeeping that must not turn the result into a failure.
      parsed.current = null;
      try {
        await syncDemoClock();
        // Drafts may point at deleted rows. This also clears the toast, so the toast comes after.
        resetUiState();
        noteRestoredBackup(summary.exportedAt);
        onBackupChanged?.();
      } catch {
        // The restore itself worked; a missed housekeeping step is not worth a failure screen.
      }
      // Never rejects; the gate decides: push the changes, start the first link, or nothing.
      void syncNow();
      if (reach === 'none') {
        showToast(`Restored · ${mealsLabel(summary.counts.meals)}`);
        go({ stage: 'idle' });
      } else {
        go({ stage: 'done', summary, reach, word });
      }
    },
    [go, showToast],
  );

  const start = useCallback(() => {
    const backup = parsed.current;
    if (!backup || running.current) return;
    running.current = true;
    void write(backup).finally(() => {
      running.current = false;
    });
  }, [write]);

  const restore = useCallback(() => {
    const current = stageRef.current;
    if (current.stage === 'failed') {
      start();
      return;
    }
    if (current.stage !== 'preview' || current.exporting) return;
    const { reach } = contextRef.current;
    if (reach === 'device' || reach === 'account') patchPreview({ confirming: true });
    else start();
  }, [patchPreview, start]);

  const cancelConfirm = useCallback(() => patchPreview({ confirming: false }), [patchPreview]);

  const confirm = useCallback(() => {
    const current = stageRef.current;
    if (current.stage === 'preview' && current.confirming) start();
  }, [start]);

  const exportFirst = useCallback(() => {
    const current = stageRef.current;
    const { reach, today, onBackupChanged } = contextRef.current;
    if (current.stage !== 'preview' || current.exporting || current.savedAs !== null) return;
    if (today === undefined || (reach !== 'device' && reach !== 'account')) return;
    const mine = token.current;
    patchPreview({ exporting: true });
    void (async () => {
      try {
        const { filename } = await saveFullBackup(db, today);
        onBackupChanged?.();
        if (token.current === mine) patchPreview({ exporting: false, savedAs: filename });
      } catch {
        showToast("Couldn't export right now. Try again.");
        if (token.current === mine) patchPreview({ exporting: false });
      }
    })();
  }, [patchPreview, showToast]);

  return {
    stage,
    open: stage.stage !== 'idle',
    dismissible: stage.stage !== 'restoring',
    reach: context.reach,
    word: context.word,
    canExportFirst: context.today !== undefined && (context.reach === 'device' || context.reach === 'account'),
    choose,
    close,
    restore,
    cancelConfirm,
    confirm,
    exportFirst,
  };
}
