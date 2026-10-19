import { Moon } from 'lucide-react';
import styles from './SleepTap.module.css';

export interface SleepTapProps {
  /** shown — evenings, near your usual sleep time; tapped — "Good night · 1:30am" with Undo. Hidden = don't render. */
  state: 'shown' | 'tapped';
  /** Time of the tap, pre-formatted ("1:30am"). */
  timeLabel?: string;
  onTap: () => void;
  onUndo: () => void;
}

/**
 * @design C61 SleepTap — a quiet "Going to sleep" pill with a moon icon on Today in the evening.
 * Optional; it only feeds the "last meal before sleep" rule and quiet hours.
 */
export function SleepTap({ state, timeLabel, onTap, onUndo }: SleepTapProps) {
  return (
    <div className={styles.wrap}>
      {state === 'shown' ? (
        <button type="button" className={styles.pill} onClick={onTap}>
          <Moon size={16} strokeWidth={2} className={styles.icon} aria-hidden="true" />
          Going to sleep
        </button>
      ) : (
        <div className={[styles.pill, styles.tapped].join(' ')}>
          <Moon size={16} strokeWidth={2} fill="currentColor" className={styles.icon} aria-hidden="true" />
          <span role="status">{timeLabel ? `Good night · ${timeLabel}` : 'Good night'}</span>
          <button type="button" className={styles.undo} onClick={onUndo} aria-label="Undo going to sleep">
            Undo
          </button>
        </div>
      )}
    </div>
  );
}
