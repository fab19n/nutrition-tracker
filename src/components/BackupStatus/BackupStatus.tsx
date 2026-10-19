import type { LucideIcon } from 'lucide-react';
import { CloudAlert, CloudCheck, CloudOff, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Pill, type PillTone } from '@/components/ui/Pill';
import styles from './BackupStatus.module.css';

export type BackupState = 'notConnected' | 'connected' | 'failed' | 'inProgress';

export interface BackupStatusProps {
  state: BackupState;
  /** "Sun 9:00pm" */
  lastBackupLabel?: string;
  /** "Last 12" */
  keepLabel?: string;
  /** Overrides the failure line ("Couldn't reach Google Drive."). */
  errorLabel?: string;
  onConnect?: () => void;
  onBackupNow?: () => void;
  onDisconnect?: () => void;
  onRetry?: () => void;
}

interface StateSpec {
  Icon: LucideIcon;
  badge: string;
  tone: PillTone;
}

const SPECS: Record<BackupState, StateSpec> = {
  notConnected: { Icon: CloudOff, badge: 'Not connected', tone: 'neutral' },
  connected: { Icon: CloudCheck, badge: 'Connected', tone: 'accent' },
  inProgress: { Icon: LoaderCircle, badge: 'Backing up', tone: 'accent' },
  failed: { Icon: CloudAlert, badge: 'Not backed up', tone: 'amber' },
};

/**
 * @design C55 BackupStatus — Google Drive weekly backup card (S39): not connected · connected · in progress ·
 * failed ("Couldn't reach Google Drive. Retry"). Errors use --danger text; nothing here is about food.
 */
export function BackupStatus({
  state,
  lastBackupLabel,
  keepLabel,
  errorLabel = "Couldn't reach Google Drive.",
  onConnect,
  onBackupNow,
  onDisconnect,
  onRetry,
}: BackupStatusProps) {
  const { Icon, badge, tone } = SPECS[state];
  const connected = state !== 'notConnected';

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <span className={[styles.icon, state === 'failed' ? styles.iconError : ''].filter(Boolean).join(' ')} aria-hidden="true">
          <Icon size={20} strokeWidth={2} className={state === 'inProgress' ? styles.spin : undefined} />
        </span>
        <div className={styles.heading}>
          <div className={styles.title}>Google Drive</div>
          <div className={styles.subtitle}>Weekly backup</div>
        </div>
        <span role="status">
          <Pill tone={tone}>{badge}</Pill>
        </span>
      </div>

      {state === 'notConnected' ? (
        <p className={styles.body}>Saves a weekly copy to a folder in your Google Drive. The app can only see files it creates.</p>
      ) : null}

      {state === 'failed' ? (
        <p className={styles.error} role="alert">
          {errorLabel}
        </p>
      ) : null}

      {connected ? (
        <dl className={styles.facts}>
          <div className={styles.fact}>
            <dt>Last backup</dt>
            <dd>{lastBackupLabel ?? 'Not yet'}</dd>
          </div>
          {keepLabel ? (
            <div className={styles.fact}>
              <dt>Keeps</dt>
              <dd>{keepLabel}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      <div className={styles.actions}>
        {state === 'notConnected' ? (
          <Button size="md" onClick={onConnect} disabled={!onConnect}>
            Connect Google Drive
          </Button>
        ) : null}
        {state === 'connected' || state === 'inProgress' ? (
          <Button size="md" variant="secondary" onClick={onBackupNow} disabled={state === 'inProgress' || !onBackupNow}>
            {state === 'inProgress' ? 'Backing up…' : 'Back up now'}
          </Button>
        ) : null}
        {state === 'failed' ? (
          <Button size="md" onClick={onRetry} disabled={!onRetry}>
            Retry
          </Button>
        ) : null}
        {connected && onDisconnect ? (
          <Button size="md" variant="ghost" onClick={onDisconnect}>
            Disconnect
          </Button>
        ) : null}
      </div>
    </div>
  );
}
