import { useId } from 'react';
import { Download, Share, SquarePlus, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import styles from './InstallPrompt.module.css';

export type InstallPlatform = 'ios' | 'android';

export interface InstallPromptProps {
  platform: InstallPlatform;
  /** Android: triggers the saved `beforeinstallprompt` event. Not used on iOS (no install API). */
  onInstall?: () => void;
  onDismiss: () => void;
  appName?: string;
}

/**
 * @design C59 InstallPrompt — iOS Safari: Share → Add to Home Screen steps; Android Chrome: an Install app button.
 */
export function InstallPrompt({ platform, onInstall, onDismiss, appName = 'Kira Makan' }: InstallPromptProps) {
  const id = useId();
  const titleId = `${id}-title`;
  return (
    <section className={styles.card} aria-labelledby={titleId}>
      <div className={styles.header}>
        <span className={styles.appIcon} aria-hidden="true">
          <span className={styles.appNumber}>570</span>
          <span className={styles.appBar} />
        </span>
        <div className={styles.heading}>
          <h3 id={titleId} className={styles.title}>
            Add {appName} to your home screen
          </h3>
          <p className={styles.body}>It opens like an app and works offline.</p>
        </div>
        <button type="button" className={styles.close} onClick={onDismiss} aria-label="Dismiss">
          <X size={18} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      {platform === 'ios' ? (
        <ol className={styles.steps}>
          <li className={styles.step}>
            <span className={styles.stepNo} aria-hidden="true">
              1
            </span>
            <span>
              Tap <b>Share</b>{' '}
              <Share size={16} strokeWidth={2} className={styles.inlineIcon} aria-hidden="true" /> in the Safari toolbar
            </span>
          </li>
          <li className={styles.step}>
            <span className={styles.stepNo} aria-hidden="true">
              2
            </span>
            <span>
              Choose <b>Add to Home Screen</b>{' '}
              <SquarePlus size={16} strokeWidth={2} className={styles.inlineIcon} aria-hidden="true" />
            </span>
          </li>
        </ol>
      ) : (
        <div className={styles.actions}>
          <Button size="md" icon={<Download size={18} strokeWidth={2} />} onClick={onInstall} disabled={!onInstall}>
            Install app
          </Button>
        </div>
      )}
    </section>
  );
}
