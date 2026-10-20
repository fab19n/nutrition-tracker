import type { LucideIcon } from 'lucide-react';
import { CloudAlert, CloudCheck, CloudOff, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Pill, type PillTone } from '@/components/ui/Pill';
import type { SyncCopy } from '@/sync/status';
import styles from './SyncStatus.module.css';

export interface SyncStatusAction {
  id: string;
  label: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  /** Running now: the button is disabled and says so to screen readers. */
  busy?: boolean;
  onPress: () => void;
}

export interface SyncStatusProps {
  tone: SyncCopy['tone'];
  /** "Up to date", "Needs you" */
  pill: string;
  /** "Up to date", "Sign in to keep syncing" */
  title: string;
  /** "Last synced 5 min ago" */
  detail?: string;
  /** "1 change couldn't sync. It stays on this device." Announced as an alert. */
  extra?: string;
  /** "Account · you@example.com", "Last synced · yesterday at 9:40pm" */
  facts?: { label: string; value: string }[];
  /** Entries done of `total`: shown as a bar once the total is known. */
  progress?: { done: number; total: number };
  actions?: SyncStatusAction[];
}

interface ToneSpec {
  Icon: LucideIcon;
  pill: PillTone;
}

const TONES: Record<SyncStatusProps['tone'], ToneSpec> = {
  ok: { Icon: CloudCheck, pill: 'accent' },
  busy: { Icon: LoaderCircle, pill: 'neutral' },
  waiting: { Icon: CloudOff, pill: 'neutral' },
  attention: { Icon: CloudAlert, pill: 'amber' },
  off: { Icon: CloudOff, pill: 'neutral' },
};

/** Done in percent of total, clamped to 0–100. */
function progressPct(done: number, total: number): number {
  return Math.min(100, Math.max(0, (done / total) * 100));
}

/**
 * Sync status card (Settings › Account and sync), modelled on C55 BackupStatus: an icon and pill
 * per tone, the state as the title, a line of detail, a progress bar while backing up, facts and
 * small buttons. Presentational: src/sync/status.ts writes the copy and the screen connects it.
 */
export function SyncStatus({ tone, pill, title, detail, extra, facts = [], progress, actions = [] }: SyncStatusProps) {
  const { Icon, pill: pillTone } = TONES[tone];
  const showProgress = progress !== undefined && progress.total > 0;

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <span className={[styles.icon, tone === 'attention' ? styles.iconAttention : ''].filter(Boolean).join(' ')} aria-hidden="true">
          <Icon size={20} strokeWidth={2} className={tone === 'busy' ? styles.spin : undefined} />
        </span>
        <div className={styles.status} role="status">
          <span className={styles.title}>{title}</span>
          <Pill tone={pillTone} className={styles.pill}>
            {pill}
          </Pill>
        </div>
      </div>

      {detail ? <p className={styles.body}>{detail}</p> : null}

      {showProgress ? (
        <div
          className={styles.track}
          role="progressbar"
          aria-label={title}
          aria-valuemin={0}
          aria-valuemax={progress.total}
          aria-valuenow={Math.min(Math.max(progress.done, 0), progress.total)}
        >
          <div className={styles.fill} style={{ width: `${progressPct(progress.done, progress.total)}%` }} />
        </div>
      ) : null}

      {extra ? (
        <p className={styles.extra} role="alert">
          {extra}
        </p>
      ) : null}

      {facts.length > 0 ? (
        <dl className={styles.facts}>
          {facts.map((fact) => (
            <div key={fact.label} className={styles.fact}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {actions.length > 0 ? (
        <div className={styles.actions}>
          {actions.map((action) => (
            <Button
              key={action.id}
              size="sm"
              variant={action.variant ?? 'primary'}
              onClick={action.onPress}
              disabled={action.busy}
              aria-busy={action.busy || undefined}
            >
              {action.label}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
