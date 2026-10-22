import { useEffect, useState } from 'react';
import { FileCheck, FileClock, FileDown, HardDrive, type LucideIcon } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';
import { goBack } from '@/app/history';
import { PATHS } from '@/app/paths';
import { isAuthConfigured } from '@/auth/session';
import { FilePickButton } from '@/components/FilePickButton/FilePickButton';
import { SettingsGroup, SettingsRow } from '@/components/SettingsRow/SettingsRow';
import { SyncStatus } from '@/components/SyncStatus/SyncStatus';
import { SubScreenHeader } from '@/components/TopBar/TopBar';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { db } from '@/db/db';
import { useMealCount, useNow, useProfile, useToday } from '@/db/hooks';
import { readLastBackupAt } from '@/db/settings';
import { backupStatus } from '@/domain/backup';
import { continueDrive, prepareDrive, retryDrive } from '@/drive';
import { isDriveConfigured } from '@/drive/config';
import { useDriveView } from '@/drive/hooks';
import { authProblemCopy, describeDrive, type DriveView } from '@/drive/status';
import { saveFullBackup } from '@/screens/More/exportFiles';
import { useUiStore } from '@/state/ui';
import { syncNow, type SyncPhase } from '@/sync';
import { useSyncView } from '@/sync/hooks';
import { describeSync } from '@/sync/status';
import { BackupImportSheet } from './BackupImportSheet';
import {
  accountNote,
  backupActions,
  backupFileCaption,
  deviceWord,
  driveBackupActions,
  exportCardCopy,
  restoreBlockedReason,
  restoreReach,
  type BackupAction,
  type DriveBackupAction,
} from './backupsModel';
import { useBackupImport } from './useBackupImport';
import styles from './BackupsScreen.module.css';

const EXPORT_ICONS: Record<ReturnType<typeof exportCardCopy>['icon'], LucideIcon> = {
  check: FileCheck,
  down: FileDown,
  clock: FileClock,
};

/** The sync card's buttons wait while these run. */
const BUSY_PHASES: ReadonlySet<SyncPhase> = new Set<SyncPhase>(['syncing', 'uploading', 'restoring']);

/**
 * Backups › Meal photos (decision §10.18): the Drive card, read-mostly like the account card.
 * Continue and Try again run in place; Connect and Disconnect are Open Settings.
 */
function MealPhotosSection({ view, tz }: { view: DriveView; tz: string }) {
  const navigate = useNavigate();
  const showToast = useUiStore((s) => s.showToast);
  const [running, setRunning] = useState(false);
  const copy = describeDrive(view, tz);
  const busy = running || view.phase === 'connecting';

  const needsTap = view.phase === 'needsTap';
  useEffect(() => {
    // Loaded ahead, so Continue can open Google's window inside the tap.
    if (needsTap) prepareDrive();
  }, [needsTap]);
  // Until the engine has read the profile there's nothing to say yet.
  if (view.phase === 'unconfigured' || view.phase === 'noProfile') return null;

  const press = (action: DriveBackupAction) => {
    if (action.id === 'manage') {
      navigate(PATHS.settings);
      return;
    }
    if (action.id === 'continue') {
      // Straight from the tap: Google's window opens only inside it.
      const pending = continueDrive();
      setRunning(true);
      void pending.then((result) => {
        setRunning(false);
        const line = result.ok ? null : authProblemCopy(result.problem, { during: 'continue', email: view.email });
        if (line) showToast(line);
      });
      return;
    }
    setRunning(true);
    void retryDrive().finally(() => setRunning(false));
  };

  return (
    <section>
      <SectionHeading inset={20}>Meal photos</SectionHeading>
      <div className={styles.card}>
        <SyncStatus
          {...copy}
          icon={HardDrive}
          actions={driveBackupActions(copy).map((action) => ({ ...action, busy, onPress: () => press(action) }))}
        />
      </div>
    </section>
  );
}

/**
 * S39 Backups: where a copy of the diary lives. The account's sync state (read-only here: Sync now
 * and Try again run in place, everything else is Open Settings), the meal photos in Google Drive
 * when the app has a Google client id, a backup file (Export now, with a quiet monthly nudge), and
 * Restore from a backup file. Meal photos go to Google Drive when it's connected (§10.18).
 */
export default function BackupsScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const profile = useProfile();
  const now = useNow();
  const today = useToday();
  const mealCount = useMealCount();
  const view = useSyncView();
  const driveView = useDriveView();
  const showToast = useUiStore((s) => s.showToast);
  const [lastBackupAt, setLastBackupAt] = useState(readLastBackupAt);
  const [exporting, setExporting] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const authConfigured = isAuthConfigured();
  const word = deviceWord(view.linked);
  const reach = restoreReach(profile, view);
  const backupImport = useBackupImport({
    reach,
    word,
    today,
    onBackupChanged: () => setLastBackupAt(readLastBackupAt()),
  });

  const back = () => (location.key !== 'default' ? goBack(navigate) : navigate(PATHS.settings, { replace: true }));

  const exportNow = async () => {
    setExporting(true);
    try {
      const { filename, record } = await saveFullBackup(db, today);
      showToast(`Backup done · ${filename}`);
      setLastBackupAt(record.at);
    } catch {
      showToast("Couldn't export right now. Try again.");
    } finally {
      setExporting(false);
    }
  };

  /** One sync at a time; it never rejects, the card says how it went. */
  const runSync = async () => {
    setSyncing(true);
    try {
      await syncNow();
    } finally {
      setSyncing(false);
    }
  };

  if (!profile) {
    return (
      <div className={styles.subScreen}>
        <SubScreenHeader title="Backups" onBack={back} />
      </div>
    );
  }

  const status = backupStatus({
    ...(lastBackupAt ? { lastBackupAt } : {}),
    now,
    tz: profile.timeZone,
    startedOn: profile.startedOn,
    mealCount: mealCount ?? 0,
    demo: profile.demoMode === true,
  });
  const exportCopy = exportCardCopy(status, { tz: profile.timeZone, word, linked: view.linked });
  const syncCopy = describeSync(view, view.now, profile.timeZone);
  const syncBusy = syncing || BUSY_PHASES.has(view.phase);
  const note = accountNote(view.phase);
  const blocked = restoreBlockedReason(reach, view.phase);

  const press = (action: BackupAction) => (action.id === 'manage' ? navigate(PATHS.settings) : void runSync());

  return (
    <div className={styles.subScreen}>
      <SubScreenHeader title="Backups" onBack={back} />
      <p className={styles.intro}>
        {authConfigured
          ? 'A second copy of your diary: in your account, and as a file you keep.'
          : 'A copy of your diary as a file you keep, and a way to restore it.'}
      </p>

      {authConfigured ? (
        <section>
          <SectionHeading inset={20}>Your account</SectionHeading>
          <div className={styles.card}>
            <SyncStatus
              {...syncCopy}
              actions={backupActions(syncCopy).map((action) => ({ ...action, busy: syncBusy, onPress: () => press(action) }))}
            />
          </div>
          {note ? <p className={styles.note}>{note}</p> : null}
          {view.phase !== 'demo' && view.phase !== 'noProfile' ? (
            <SettingsGroup>
              <SettingsRow label="Account and sync" sub="Sign-in and sync, in Settings" onPress={() => navigate(PATHS.settings)} />
            </SettingsGroup>
          ) : null}
        </section>
      ) : null}

      {isDriveConfigured() ? <MealPhotosSection view={driveView} tz={profile.timeZone} /> : null}

      <section>
        <SectionHeading inset={20}>Backup file</SectionHeading>
        <div className={styles.card}>
          <SyncStatus
            tone={exportCopy.tone}
            pill={exportCopy.pill}
            title={exportCopy.title}
            detail={exportCopy.detail}
            icon={EXPORT_ICONS[exportCopy.icon]}
            actions={[{ id: 'export', label: 'Export now', variant: exportCopy.action, busy: exporting, onPress: () => void exportNow() }]}
          />
        </div>
        <p className={styles.caption}>{backupFileCaption(word, driveView.connected && isDriveConfigured())}</p>
        <SettingsGroup>
          <SettingsRow
            label="Other export options"
            sub="Spreadsheet files for meals, weights and workouts"
            onPress={() => navigate(PATHS.export)}
          />
        </SettingsGroup>
      </section>

      <section>
        <SectionHeading inset={20}>Restore</SectionHeading>
        <div className={styles.restore}>
          <h3 className={styles.restoreTitle}>Restore from a backup file</h3>
          <p className={styles.restoreBody}>Pick a file saved by Export now. You see what&apos;s in it before anything changes.</p>
          <div className={styles.restoreAction}>
            <FilePickButton variant="secondary" size="md" label="Choose a backup file" onFile={backupImport.choose} disabled={blocked !== null} />
          </div>
          {blocked ? <p className={styles.blocked}>{blocked}</p> : null}
        </div>
      </section>

      <BackupImportSheet flow={backupImport} />
    </div>
  );
}
