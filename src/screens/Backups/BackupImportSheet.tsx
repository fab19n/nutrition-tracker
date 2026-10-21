import { useEffect, useRef } from 'react';
import { Check } from 'lucide-react';
import { useNavigate } from 'react-router';
import { PATHS } from '@/app/paths';
import { BackupPreview } from '@/components/BackupPreview/BackupPreview';
import { BottomSheet, SheetTitle } from '@/components/BottomSheet/BottomSheet';
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog';
import { FilePickButton } from '@/components/FilePickButton/FilePickButton';
import { Button } from '@/components/ui/Button';
import { useNow } from '@/db/hooks';
import { confirmCopy, previewCard, previewLead, previewTitle, restoredCopy, type ProblemCopy } from './backupsModel';
import type { BackupImportFlow, ImportStage } from './useBackupImport';
import styles from './BackupImportSheet.module.css';

const STEP_TEXT = {
  catchUp: 'Catching up with your account first. Keep the app open.',
  writing: 'Replacing your data. Keep the app open.',
} as const;

function sheetTitle(flow: BackupImportFlow): string {
  const { stage } = flow;
  switch (stage.stage) {
    case 'reading':
      return 'Reading your backup';
    case 'error':
    case 'failed':
      return stage.problem.title;
    case 'preview':
      return previewTitle(flow.reach);
    case 'restoring':
      return 'Restoring your diary';
    case 'done':
      return 'Backup restored';
    case 'idle':
      return '';
  }
}

/** A problem's words: the body, and the file's own words for what is damaged. An alert, so it is read out. */
function Problem({ problem }: { problem: ProblemCopy }) {
  return (
    <div role="alert">
      <p className={styles.lead}>{problem.body}</p>
      {problem.detail ? <p className={styles.detail}>{problem.detail}</p> : null}
    </div>
  );
}

type PreviewStage = Extract<ImportStage, { stage: 'preview' }>;

function Preview({ flow, stage }: { flow: BackupImportFlow; stage: PreviewStage }) {
  const now = useNow();
  const { reach, word } = flow;
  const card = previewCard({ fileName: stage.fileName, preview: stage.preview, comparison: stage.comparison, word, now });
  const confirm =
    reach === 'device' || reach === 'account'
      ? confirmCopy({ reach, word, exportedAt: stage.preview.exportedAt, tz: stage.preview.timeZone })
      : null;

  return (
    <>
      <div className={styles.body}>
        <p className={styles.lead}>{previewLead(reach, word)}</p>
        <BackupPreview {...card} />
        <div className={styles.actions}>
          <Button size="lg" onClick={flow.restore} disabled={stage.exporting}>
            Restore this backup
          </Button>
          {flow.canExportFirst && stage.savedAs === null ? (
            <Button variant="ghost" size="md" onClick={flow.exportFirst} disabled={stage.exporting} aria-busy={stage.exporting || undefined}>
              {stage.exporting ? 'Exporting…' : `Export this ${word} first`}
            </Button>
          ) : null}
          {stage.savedAs !== null ? (
            <p className={styles.saved} role="status">
              <Check size={16} strokeWidth={2} aria-hidden="true" />
              <span>Saved {stage.savedAs}</span>
            </p>
          ) : null}
          <Button variant="ghost" size="md" onClick={flow.close}>
            Cancel
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={stage.confirming && confirm !== null}
        title={confirm?.title ?? ''}
        body={confirm?.body ?? ''}
        confirmLabel={confirm?.confirmLabel ?? ''}
        destructive
        requireTyping={confirm?.requireTyping}
        onConfirm={flow.confirm}
        onCancel={flow.cancelConfirm}
      />
    </>
  );
}

/** One sheet for every step of Restore from a backup file. Renders nothing while idle. */
export function BackupImportSheet({ flow }: { flow: BackupImportFlow }) {
  return flow.open ? <OpenImportSheet flow={flow} /> : null;
}

function OpenImportSheet({ flow }: { flow: BackupImportFlow }) {
  const { stage } = flow;
  const navigate = useNavigate();
  const rootRef = useRef<HTMLDivElement>(null);
  const firstStage = useRef(true);
  const confirming = stage.stage === 'preview' && stage.confirming;

  // A new stage (not the first) moves focus to its title, so screen readers hear it and focus
  // never stays on a button that is gone.
  useEffect(() => {
    if (firstStage.current) {
      firstStage.current = false;
      return;
    }
    const heading = rootRef.current?.querySelector('h2');
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    }
  }, [stage.stage]);

  return (
    // Back, Escape and the scrim step back one level: over the destructive confirm they only
    // dismiss the confirm (as its Cancel does), so the loaded file isn't dropped from under it.
    <BottomSheet open onClose={confirming ? flow.cancelConfirm : flow.close} dismissible={flow.dismissible}>
      <div ref={rootRef}>
        <SheetTitle>{sheetTitle(flow)}</SheetTitle>

        {stage.stage === 'reading' ? (
          <div className={styles.body} aria-busy="true">
            <p className={styles.fileName}>{stage.fileName}</p>
            <p className={styles.lead} role="status">
              Checking the file…
            </p>
            <div className={styles.actions}>
              <Button variant="ghost" size="md" onClick={flow.close}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        {stage.stage === 'error' ? (
          <div className={styles.body}>
            <Problem problem={stage.problem} />
            <div className={styles.actions}>
              <FilePickButton variant="primary" size="lg" label="Choose another file" onFile={flow.choose} />
              <Button variant="ghost" size="md" onClick={flow.close}>
                Close
              </Button>
            </div>
          </div>
        ) : null}

        {stage.stage === 'preview' ? <Preview flow={flow} stage={stage} /> : null}

        {stage.stage === 'restoring' ? (
          <div className={styles.body}>
            <p className={styles.lead} role="status">
              {STEP_TEXT[stage.step]}
            </p>
            <div className={styles.track} role="progressbar" aria-label="Restoring your diary">
              <div className={styles.pulse} />
            </div>
          </div>
        ) : null}

        {stage.stage === 'done' ? (
          <DoneBody flow={flow} stage={stage} onOpenToday={() => navigate(PATHS.today)} />
        ) : null}

        {stage.stage === 'failed' ? (
          <div className={styles.body}>
            <Problem problem={stage.problem} />
            <div className={styles.actions}>
              {stage.problem.canRetry ? <Button onClick={flow.restore}>Try again</Button> : null}
              {stage.problem.needsSettings ? (
                <Button
                  onClick={() => {
                    flow.close();
                    navigate(PATHS.settings);
                  }}
                >
                  Open Settings
                </Button>
              ) : null}
              <Button variant="ghost" size="md" onClick={flow.close}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </BottomSheet>
  );
}

function DoneBody({ flow, stage, onOpenToday }: { flow: BackupImportFlow; stage: Extract<ImportStage, { stage: 'done' }>; onOpenToday: () => void }) {
  const copy = restoredCopy(stage.summary, stage.reach, stage.word);
  return (
    <div className={styles.body}>
      <div>
        <p className={styles.lead}>{copy.summary}</p>
        {copy.account ? <p className={[styles.lead, styles.second].join(' ')}>{copy.account}</p> : null}
      </div>
      <div className={styles.actions}>
        <Button onClick={flow.close}>Done</Button>
        <Button
          variant="ghost"
          size="md"
          onClick={() => {
            flow.close();
            onOpenToday();
          }}
        >
          Open Today
        </Button>
      </div>
    </div>
  );
}
