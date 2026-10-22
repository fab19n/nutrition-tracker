import { useId } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Bell, Camera, HardDrive, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import styles from './PermissionPrimer.module.css';

export type PermissionKind = 'location' | 'notifications' | 'camera' | 'drive';

const ICONS: Record<PermissionKind, LucideIcon> = {
  location: MapPin,
  notifications: Bell,
  camera: Camera,
  drive: HardDrive,
};

export interface PermissionPrimerProps {
  kind: PermissionKind;
  title: string;
  body: string;
  /** Opens the system prompt, e.g. "Allow location". */
  allowLabel: string;
  onAllow: () => void;
  onNotNow: () => void;
  notNowLabel?: string;
  /** The allow button can't be pressed yet ("Getting ready…"). */
  allowDisabled?: boolean;
  /** The allow button's action is running ("Connecting…"): disabled, and says so to screen readers. */
  allowBusy?: boolean;
  /** Why the last try didn't work, under the body ("The Google window didn't open. Try again."). */
  error?: string;
}

/**
 * @design C58 PermissionPrimer — a short explanation shown before the system prompt for location,
 * notifications, camera and Google Drive. Asked only when first needed.
 */
export function PermissionPrimer({
  kind,
  title,
  body,
  allowLabel,
  onAllow,
  onNotNow,
  notNowLabel = 'Not now',
  allowDisabled,
  allowBusy,
  error,
}: PermissionPrimerProps) {
  const id = useId();
  const Icon = ICONS[kind];
  return (
    <section className={styles.card} aria-labelledby={`${id}-title`} aria-describedby={`${id}-body`}>
      <span className={styles.icon} aria-hidden="true">
        <Icon size={24} strokeWidth={2} />
      </span>
      <h3 id={`${id}-title`} className={styles.title}>
        {title}
      </h3>
      <p id={`${id}-body`} className={styles.body}>
        {body}
      </p>
      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}
      <div className={styles.actions}>
        <Button onClick={onAllow} disabled={allowDisabled || allowBusy} aria-busy={allowBusy || undefined}>
          {allowLabel}
        </Button>
        <Button variant="ghost" size="md" onClick={onNotNow}>
          {notNowLabel}
        </Button>
      </div>
    </section>
  );
}
