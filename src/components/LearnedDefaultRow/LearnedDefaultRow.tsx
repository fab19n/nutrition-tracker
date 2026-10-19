import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import styles from './LearnedDefaultRow.module.css';

export interface LearnedDefaultRowProps {
  /** What it applies to: "Rice (nasi kandar)", "Kuah campur". */
  label: string;
  /** Pre-formatted: "Mamak big, +30%", "Banjir, +80%", "Your version · ~420". */
  value: string;
  /** Opens the item's portion chips. Leave out when there's nothing to pick from. */
  onChange?: () => void;
  onRemove: () => void;
}

/**
 * @design C36 LearnedDefaultRow — "Rice (nasi kandar) · Mamak big, +30%" with Change and Remove.
 * Renders an `<li>`: put rows inside a LearnedDefaultList.
 */
export function LearnedDefaultRow({ label, value, onChange, onRemove }: LearnedDefaultRowProps) {
  return (
    <li className={styles.row}>
      <div className={styles.text}>
        <div className={styles.label}>{label}</div>
        <div className={styles.value}>{value}</div>
      </div>
      <div className={styles.actions}>
        {onChange ? (
          <button type="button" className={styles.change} aria-label={`Change ${label}`} onClick={onChange}>
            Change
          </button>
        ) : null}
        <button type="button" className={styles.remove} aria-label={`Remove ${label}`} onClick={onRemove}>
          <X size={18} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}

export interface LearnedDefaultListProps {
  /** Accessible name of the list, e.g. "What you've taught it". */
  label?: string;
  /** LearnedDefaultRows (or other `<li>` rows, like the oil level). */
  children: ReactNode;
  className?: string;
}

/** @design C36 list — a --card list (radius 20) with hairlines between rows. */
export function LearnedDefaultList({ label, children, className }: LearnedDefaultListProps) {
  return (
    <ul className={[styles.list, className].filter(Boolean).join(' ')} aria-label={label}>
      {children}
    </ul>
  );
}
