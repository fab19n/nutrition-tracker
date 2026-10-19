import { CloudOff } from 'lucide-react';
import { Banner } from '@/components/Banner/Banner';
import styles from './AppShell.module.css';

export interface OfflineBannerProps {
  offline: boolean;
}

/**
 * @design S46 Offline — neutral C06 Banner at the top of the content while there is no connection.
 * The live region stays mounted (empty while online) so the change is read out when it happens.
 */
export function OfflineBanner({ offline }: OfflineBannerProps) {
  return (
    <div className={offline ? styles.offline : undefined} role="status" aria-live="polite">
      {offline ? (
        <Banner tone="neutral" icon={<CloudOff size={16} strokeWidth={2} />}>
          <b>You&apos;re offline.</b> Logging still works; estimates run when you&apos;re back.
        </Banner>
      ) : null}
    </div>
  );
}
