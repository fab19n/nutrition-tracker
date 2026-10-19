import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import styles from './UsualOrderRow.module.css';

export interface UsualOrderRowProps {
  /** "Nasi kandar ayam goreng". */
  name: string;
  /** Pre-formatted: "Kuah campur · 9 times · ~950 kcal". */
  detail: string;
  /**
   * Already logged today: a "Logged today" check line, and the button reads "Log again" (a
   * second teh o ais is still one tap away).
   */
  logged?: boolean;
  onLog: () => void;
  /** Button text: "Log", "Log 1" (a pot serving). */
  logLabel?: string;
  /** Accessible name of the button; default "Log <name>" ("… again" once logged). */
  actionLabel?: string;
  /** While a log is saving. */
  busy?: boolean;
}

/**
 * @design C35 UsualOrderRow — name (600), a 12px detail line and a "Log" --card2 pill. Once
 * logged today it adds a "Logged today" check line and the pill reads "Log again".
 * Renders an `<li>`: put rows inside a UsualOrderList.
 */
export function UsualOrderRow({ name, detail, logged, onLog, logLabel = 'Log', actionLabel, busy }: UsualOrderRowProps) {
  const label = actionLabel ?? `Log ${name}`;
  return (
    <li className={styles.row}>
      <div className={styles.text}>
        <div className={styles.name}>{name}</div>
        <div className={styles.detail}>{detail}</div>
        {logged ? (
          <div className={styles.logged}>
            <Check size={14} strokeWidth={2.5} aria-hidden="true" />
            Logged today
          </div>
        ) : null}
      </div>
      <Button variant="secondary" size="sm" className={styles.log} aria-label={logged ? `${label} again` : label} disabled={busy} onClick={onLog}>
        {logged ? 'Log again' : logLabel}
      </Button>
    </li>
  );
}

export interface UsualOrderListProps {
  /** Accessible name of the list, e.g. "Your usual orders". */
  label?: string;
  /** UsualOrderRows (or other `<li>` rows). */
  children: ReactNode;
  className?: string;
}

/** @design C35 list — a --card list (radius 20) with hairlines between rows. */
export function UsualOrderList({ label, children, className }: UsualOrderListProps) {
  return (
    <ul className={[styles.list, className].filter(Boolean).join(' ')} aria-label={label}>
      {children}
    </ul>
  );
}
