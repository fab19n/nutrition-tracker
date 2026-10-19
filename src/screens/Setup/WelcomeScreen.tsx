import { useState } from 'react';
import { CalendarDays, MessageSquareText, SlidersHorizontal } from 'lucide-react';
// CONTRACT: the shell exports usePwaInstall() from src/app/pwa.ts:
// { canPrompt: boolean; platform: 'ios' | 'android' | 'other'; isStandalone: boolean; prompt: () => Promise<void> }
import { usePwaInstall } from '@/app/pwa';
import { InstallPrompt } from '@/components/InstallPrompt/InstallPrompt';
import { Button } from '@/components/ui/Button';
import styles from './Setup.module.css';

export interface WelcomeScreenProps {
  onStart: () => void;
  onExplore: () => void;
  /** The sample week is loading. */
  exploring: boolean;
}

const POINTS = [
  { icon: <MessageSquareText size={18} strokeWidth={2} />, text: 'Log a meal like a message: nasi lemak ayam goreng, teh o ais' },
  { icon: <SlidersHorizontal size={18} strokeWidth={2} />, text: 'Estimates come as ranges you can fix with sikit, normal or banjir' },
  { icon: <CalendarDays size={18} strokeWidth={2} />, text: 'A weekly budget with room for weekend makan' },
] as const;

/** S01 Welcome and install: app name, one line, Get started, the sample week, and C59 InstallPrompt in the browser. */
export function WelcomeScreen({ onStart, onExplore, exploring }: WelcomeScreenProps) {
  const pwa = usePwaInstall();
  const [installDismissed, setInstallDismissed] = useState(false);
  // Installed already: no prompt. Android/desktop only once the browser offers its install event.
  const showInstall = !pwa.isStandalone && !installDismissed && (pwa.platform === 'ios' || pwa.canPrompt);

  return (
    <div className={styles.welcome}>
      <div className={styles.welcomeTop}>
        <span className={styles.appIcon} aria-hidden="true">
          <span className={styles.appNumber}>570</span>
          <span className={styles.appBar} />
        </span>
        <h1 className={styles.appName}>Kira Makan</h1>
        <p className={styles.tagline}>A calorie budget that speaks Malaysian food</p>
        <ul className={styles.points}>
          {POINTS.map((p) => (
            <li key={p.text} className={styles.point}>
              <span className={styles.pointIcon} aria-hidden="true">
                {p.icon}
              </span>
              <span>{p.text}</span>
            </li>
          ))}
        </ul>
      </div>

      {showInstall ? (
        <div className={styles.install}>
          <h2 className="sr-only">Install the app</h2>
          <InstallPrompt
            platform={pwa.platform === 'ios' ? 'ios' : 'android'}
            onInstall={pwa.canPrompt ? () => void pwa.prompt() : undefined}
            onDismiss={() => setInstallDismissed(true)}
          />
        </div>
      ) : null}

      <div className={styles.welcomeFooter}>
        <Button onClick={onStart} disabled={exploring}>
          Get started
        </Button>
        <Button variant="ghost" size="lg" onClick={onExplore} disabled={exploring} aria-busy={exploring || undefined}>
          {exploring ? 'Loading the sample week…' : 'Explore with sample data'}
        </Button>
        <p className={styles.welcomeNote}>About 2 minutes to set up.</p>
      </div>
    </div>
  );
}
