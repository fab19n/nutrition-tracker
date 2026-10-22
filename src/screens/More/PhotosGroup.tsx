import { useEffect, useState } from 'react';
import { HardDrive } from 'lucide-react';
import { ConfirmDialog } from '@/components/ConfirmDialog/ConfirmDialog';
import { SettingsGroup, SettingsRow } from '@/components/SettingsRow/SettingsRow';
import { SyncStatus } from '@/components/SyncStatus/SyncStatus';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { updateProfileSettings } from '@/db/settings';
import { photosLabel } from '@/domain/photoSync';
import type { Profile } from '@/domain/types';
import { continueDrive, disconnectDrive, prepareDrive, retryDrive } from '@/drive';
import { isDriveConfigured } from '@/drive/config';
import { useDriveView } from '@/drive/hooks';
import { authProblemCopy, describeDrive, type DriveActionId } from '@/drive/status';
import { useUiStore } from '@/state/ui';
import { DriveConnectSheet } from './DriveConnectSheet';
import styles from './PhotosGroup.module.css';

export interface PhotosGroupProps {
  profile: Profile;
}

/** "Photos stop uploading from this device. … 3 photos that haven't uploaded stay on this device." (1: "hasn't … stays") */
function disconnectBody(waiting: number): string {
  const base = 'Photos stop uploading from this device. Photos already in Google Drive stay there, and your other devices keep showing them.';
  if (waiting <= 0) return base;
  const verbs = waiting === 1 ? "hasn't uploaded stays" : "haven't uploaded stay";
  return `${base} ${photosLabel(waiting)} that ${verbs} on this device.`;
}

/**
 * Settings › Photos (S19, decision §10.18): Keep photos, and with a Google client id the Drive card
 * (SyncStatus, copy from src/drive/status.ts) with its actions: Connect opens the connect sheet,
 * Continue and Try again run in place, Disconnect asks first. The card prepares Google's script
 * while a tap could need it, so the window opens at once.
 */
export function PhotosGroup({ profile }: PhotosGroupProps) {
  const configured = isDriveConfigured();
  return (
    <section>
      <SectionHeading inset={20}>Photos</SectionHeading>
      <SettingsGroup>
        <KeepPhotosRow profile={profile} />
      </SettingsGroup>
      {configured ? <DriveCard tz={profile.timeZone} /> : null}
    </section>
  );
}

function KeepPhotosRow({ profile }: PhotosGroupProps) {
  const showToast = useUiStore((s) => s.showToast);
  const save = async (keepPhotos: boolean) => {
    try {
      await updateProfileSettings({ keepPhotos });
    } catch {
      showToast("Couldn't save that. Try again.");
    }
  };
  return (
    <SettingsRow
      label="Keep photos"
      sub={profile.keepPhotos ? 'Kept as a visual diary' : 'Photos clear after estimating'}
      toggle={{ checked: profile.keepPhotos, onChange: (keepPhotos) => void save(keepPhotos) }}
    />
  );
}

function DriveCard({ tz }: { tz: string }) {
  const view = useDriveView();
  const showToast = useUiStore((s) => s.showToast);
  const [running, setRunning] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const wantsGis = view.phase === 'disconnected' || view.phase === 'needsTap';
  useEffect(() => {
    if (wantsGis) prepareDrive();
  }, [wantsGis]);

  const copy = describeDrive(view, tz);
  const busy = running || view.phase === 'connecting';
  // Until the engine has read the profile there's nothing to say yet.
  const hidden = view.phase === 'unconfigured' || view.phase === 'noProfile';

  /** One Drive action at a time; `failed` says why it didn't work, when there's something to say. */
  const run = <T,>(pending: Promise<T>, failed: (result: T) => string | null) => {
    setRunning(true);
    void pending
      .then((result) => {
        const line = failed(result);
        if (line) showToast(line);
      })
      .finally(() => setRunning(false));
  };

  const handlers: Record<DriveActionId, () => void> = {
    connect: () => setConnectOpen(true),
    // Straight from the tap: Google's window opens only inside it.
    continue: () => run(continueDrive(), (result) => (result.ok ? null : authProblemCopy(result.problem, { during: 'continue', email: view.email }))),
    retry: () => run(retryDrive(), () => null),
    disconnect: () => setConfirmDisconnect(true),
  };

  const disconnect = () => {
    setConfirmDisconnect(false);
    setRunning(true);
    disconnectDrive()
      .then(
        () => showToast('Google Drive disconnected'),
        () => showToast("Couldn't disconnect. Try again."),
      )
      .finally(() => setRunning(false));
  };

  return (
    <>
      {hidden ? null : (
        <div className={styles.status}>
          <SyncStatus {...copy} icon={HardDrive} actions={copy.actions.map((action) => ({ ...action, busy, onPress: handlers[action.id] }))} />
        </div>
      )}

      <DriveConnectSheet open={connectOpen} onClose={() => setConnectOpen(false)} />

      <ConfirmDialog
        open={confirmDisconnect}
        title="Disconnect Google Drive?"
        body={disconnectBody(view.counts.uploads)}
        confirmLabel="Disconnect"
        onConfirm={disconnect}
        onCancel={() => setConfirmDisconnect(false)}
      />
    </>
  );
}
