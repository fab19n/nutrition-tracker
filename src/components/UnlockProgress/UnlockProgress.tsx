import { Check, ChevronRight } from 'lucide-react';
import { fmtInt } from '@/domain/format';
import styles from './UnlockProgress.module.css';

export interface UnlockProgressProps {
  /** "Timing patterns", "Your real maintenance". */
  label: string;
  /** Complete days logged so far (or what `unit` counts). */
  have: number;
  /** Days needed to unlock. */
  need: number;
  /** What `have` and `need` count: "days" (default), "weigh-ins". */
  unit?: string;
  /** Replaces the right-hand text ("9 of 14 days", "Unlocked"): "Ready", "12 of 30 checked". */
  valueLabel?: string;
  /** Makes the label and value one button, for a row that opens something (the Top dishes check). */
  onPress?: () => void;
  className?: string;
}

export function isUnlocked(have: number, need: number): boolean {
  return have >= need;
}

/** Progress in percent, clamped to 0–100. */
export function unlockPct(have: number, need: number): number {
  if (need <= 0) return 100;
  return Math.min(100, Math.max(0, (have / need) * 100));
}

/** @design C15 UnlockProgress — "9 of 14 days" toward an insight that needs more data. */
export function UnlockProgress({ label, have, need, unit = 'days', valueLabel, onPress, className }: UnlockProgressProps) {
  const unlocked = isUnlocked(have, need);
  const value = unlocked ? (
    <span className={styles.unlocked}>
      <Check size={12} strokeWidth={2.5} aria-hidden="true" />
      {valueLabel ?? 'Unlocked'}
    </span>
  ) : (
    <span className="muted">
      {valueLabel ?? `${fmtInt(have)} of ${fmtInt(need)} ${unit}`}
    </span>
  );
  return (
    <div className={[styles.row, className].filter(Boolean).join(' ')}>
      {onPress ? (
        <button type="button" className={[styles.text, styles.press].join(' ')} onClick={onPress}>
          <span>{label}</span>{' '}
          <span className={styles.value}>
            {value}
            <ChevronRight size={14} strokeWidth={2.5} className="muted" aria-hidden="true" />
          </span>
        </button>
      ) : (
        <div className={styles.text}>
          <span>{label}</span>
          {value}
        </div>
      )}
      <div
        className={styles.track}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={need}
        aria-valuenow={Math.min(have, need)}
      >
        <div className={styles.fill} style={{ width: `${unlockPct(have, need)}%` }} />
      </div>
    </div>
  );
}

export interface UnlockListProps {
  items: UnlockProgressProps[];
  className?: string;
}

/** @design C15 UnlockProgress list — the "Unlocks as you log" card. */
export function UnlockList({ items, className }: UnlockListProps) {
  return (
    <div className={[styles.list, className].filter(Boolean).join(' ')}>
      {items.map((item) => (
        <UnlockProgress key={item.label} {...item} />
      ))}
    </div>
  );
}
